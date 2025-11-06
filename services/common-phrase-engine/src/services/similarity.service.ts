/**
 * Similarity Service
 * Implements the decision tree logic for choosing similarity methods
 */

import {
  PostEmbeddings,
  PostAnalysis,
  SimilarityMethod,
  SimilarityDecision,
  SimilarityResult,
  SimilarPost,
  CommonPhraseConfig,
  CommonPhraseEngineError
} from '../types';
import { QdrantService } from './qdrant.service';

export class SimilarityService {
  private qdrantService: QdrantService;
  private config: CommonPhraseConfig;

  constructor(
    qdrantService: QdrantService,
    config: CommonPhraseConfig
  ) {
    this.qdrantService = qdrantService;
    this.config = config;
  }

  // ==========================================================================
  // DECISION TREE
  // ==========================================================================

  /**
   * Decide which similarity method to use based on post analysis
   */
  decideSimilarityMethod(analysis: PostAnalysis): SimilarityDecision {
    // Special Case 1: Retweet/Share - skip check
    if (analysis.isRetweet) {
      return {
        method: SimilarityMethod.SKIP,
        reason: 'intentional_share'
      };
    }

    // Special Case 2: Too short - skip check
    if (analysis.substantiveWordCount < this.config.minSubstantiveWords) {
      return {
        method: SimilarityMethod.SKIP,
        reason: 'too_short'
      };
    }

    // Special Case 3: Contains significant quotes - use masked only
    if (analysis.hasQuotes && analysis.quoteRatio > 0.3) {
      return {
        method: SimilarityMethod.MASKED_ONLY,
        reason: 'contains_quotes'
      };
    }

    // Case 4: Mostly common phrases (> 50%) - use masked only
    if (analysis.commonPhraseRatio > this.config.commonPhraseRatioThresholds.high) {
      return {
        method: SimilarityMethod.MASKED_ONLY,
        reason: 'mostly_common_phrases'
      };
    }

    // Case 5: Medium common phrases (20-50%) - dual check
    if (analysis.commonPhraseRatio > this.config.commonPhraseRatioThresholds.low) {
      return {
        method: SimilarityMethod.DUAL_CHECK,
        reason: 'verify_common_phrase_impact'
      };
    }

    // Case 6: Low common phrases (< 20%) - weighted only (default)
    return {
      method: SimilarityMethod.WEIGHTED_ONLY,
      reason: 'standard_check'
    };
  }

  // ==========================================================================
  // SIMILARITY CALCULATION
  // ==========================================================================

  /**
   * Calculate similarity based on the decision
   */
  async calculateSimilarity(
    embeddings: PostEmbeddings,
    decision: SimilarityDecision
  ): Promise<SimilarityResult> {
    try {
      switch (decision.method) {
        case SimilarityMethod.SKIP:
          return this.skipSimilarityCheck(decision.reason);

        case SimilarityMethod.WEIGHTED_ONLY:
          return this.calculateWeightedSimilarity(embeddings, decision.reason);

        case SimilarityMethod.MASKED_ONLY:
          return this.calculateMaskedSimilarity(embeddings, decision.reason);

        case SimilarityMethod.DUAL_CHECK:
          return this.calculateDualCheckSimilarity(embeddings, decision.reason);

        default:
          throw new Error(`Unknown similarity method: ${decision.method}`);
      }
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to calculate similarity: ${error.message}`,
        'SIMILARITY_CALC_ERROR'
      );
    }
  }

  /**
   * Skip similarity check (return 100% original)
   */
  private skipSimilarityCheck(reason: string): SimilarityResult {
    return {
      finalSimilarity: 0,
      methodUsed: SimilarityMethod.SKIP,
      reason,
      similarPosts: []
    };
  }

  /**
   * Calculate similarity using weighted embeddings only
   */
  private async calculateWeightedSimilarity(
    embeddings: PostEmbeddings,
    reason: string
  ): Promise<SimilarityResult> {
    const results = await this.qdrantService.searchWeighted(
      embeddings.embeddingWeighted,
      10,
      this.createExcludeFilter(embeddings.postId)
    );

    const maxSimilarity = results.length > 0 ? results[0].score : 0;
    const similarPosts = this.qdrantService.convertToSimilarPosts(results.slice(0, 5));

    return {
      weightedSimilarity: maxSimilarity,
      finalSimilarity: maxSimilarity,
      methodUsed: SimilarityMethod.WEIGHTED_ONLY,
      reason,
      similarPosts
    };
  }

  /**
   * Calculate similarity using masked embeddings only
   */
  private async calculateMaskedSimilarity(
    embeddings: PostEmbeddings,
    reason: string
  ): Promise<SimilarityResult> {
    // If masked text is too short, return 100% original
    if (embeddings.metadata.substantiveWordCount < this.config.minSubstantiveWords) {
      return {
        finalSimilarity: 0,
        methodUsed: SimilarityMethod.MASKED_ONLY,
        reason: 'masked_content_too_short',
        similarPosts: []
      };
    }

    const results = await this.qdrantService.searchMasked(
      embeddings.embeddingMasked,
      10,
      this.createExcludeFilter(embeddings.postId)
    );

    const maxSimilarity = results.length > 0 ? results[0].score : 0;
    const similarPosts = this.qdrantService.convertToSimilarPosts(results.slice(0, 5));

    return {
      maskedSimilarity: maxSimilarity,
      finalSimilarity: maxSimilarity,
      methodUsed: SimilarityMethod.MASKED_ONLY,
      reason,
      similarPosts
    };
  }

  /**
   * Calculate similarity using both weighted and masked (dual check)
   */
  private async calculateDualCheckSimilarity(
    embeddings: PostEmbeddings,
    reason: string
  ): Promise<SimilarityResult> {
    // Search both collections in parallel
    const [weightedResults, maskedResults] = await Promise.all([
      this.qdrantService.searchWeighted(
        embeddings.embeddingWeighted,
        10,
        this.createExcludeFilter(embeddings.postId)
      ),
      this.qdrantService.searchMasked(
        embeddings.embeddingMasked,
        10,
        this.createExcludeFilter(embeddings.postId)
      )
    ]);

    const weightedSimilarity = weightedResults.length > 0 ? weightedResults[0].score : 0;
    const maskedSimilarity = maskedResults.length > 0 ? maskedResults[0].score : 0;

    // Decision logic: If difference is significant, use masked
    const difference = Math.abs(weightedSimilarity - maskedSimilarity);
    const isSignificantDifference = difference > this.config.similarityDifferenceThreshold;

    let finalSimilarity: number;
    let finalReason: string;
    let similarPosts: SimilarPost[];

    if (isSignificantDifference && maskedSimilarity < weightedSimilarity) {
      // Significant difference - common phrases driving similarity
      finalSimilarity = maskedSimilarity;
      finalReason = 'similarity_driven_by_common_phrases';
      similarPosts = this.qdrantService.convertToSimilarPosts(maskedResults.slice(0, 5));
    } else {
      // Similar scores or masked is higher - true content similarity
      finalSimilarity = weightedSimilarity;
      finalReason = 'true_content_similarity';
      similarPosts = this.qdrantService.convertToSimilarPosts(weightedResults.slice(0, 5));
    }

    return {
      weightedSimilarity,
      maskedSimilarity,
      finalSimilarity,
      methodUsed: SimilarityMethod.DUAL_CHECK,
      reason: `${reason} - ${finalReason} (diff: ${(difference * 100).toFixed(1)}%)`,
      similarPosts
    };
  }

  // ==========================================================================
  // BATCH SIMILARITY
  // ==========================================================================

  /**
   * Calculate similarity for multiple posts
   */
  async calculateBatchSimilarity(
    embeddings: PostEmbeddings[]
  ): Promise<Map<string, SimilarityResult>> {
    const results = new Map<string, SimilarityResult>();

    for (const embedding of embeddings) {
      // Analyze to make decision
      const analysis: PostAnalysis = {
        postId: embedding.postId,
        originalText: embedding.metadata.originalText,
        commonPhrasesFound: embedding.metadata.commonPhrasesFound,
        commonPhraseRatio: embedding.metadata.commonPhraseRatio,
        substantiveWordCount: embedding.metadata.substantiveWordCount,
        totalWordCount: embedding.metadata.totalWordCount,
        hasQuotes: embedding.metadata.hasQuotes,
        quoteRatio: embedding.metadata.quoteRatio,
        isRetweet: embedding.metadata.isRetweet,
        isNews: embedding.metadata.isNews
      };

      const decision = this.decideSimilarityMethod(analysis);
      const similarity = await this.calculateSimilarity(embedding, decision);

      results.set(embedding.postId, similarity);
    }

    return results;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Create filter to exclude the current post from search results
   */
  private createExcludeFilter(postId: string): any {
    return {
      must_not: [
        {
          key: 'postId',
          match: { value: postId }
        }
      ]
    };
  }

  /**
   * Get similarity statistics for monitoring
   */
  async getSimilarityStats(embeddings: PostEmbeddings[]): Promise<{
    total: number;
    methodCounts: Record<SimilarityMethod, number>;
    averageSimilarity: number;
    highSimilarityCount: number;
  }> {
    const results = await this.calculateBatchSimilarity(embeddings);

    const methodCounts: Record<SimilarityMethod, number> = {
      [SimilarityMethod.WEIGHTED_ONLY]: 0,
      [SimilarityMethod.MASKED_ONLY]: 0,
      [SimilarityMethod.DUAL_CHECK]: 0,
      [SimilarityMethod.SKIP]: 0
    };

    let totalSimilarity = 0;
    let highSimilarityCount = 0;

    for (const result of results.values()) {
      methodCounts[result.methodUsed]++;
      totalSimilarity += result.finalSimilarity;

      if (result.finalSimilarity > 0.8) {
        highSimilarityCount++;
      }
    }

    return {
      total: embeddings.length,
      methodCounts,
      averageSimilarity: totalSimilarity / embeddings.length,
      highSimilarityCount
    };
  }

  /**
   * Explain decision for debugging
   */
  explainDecision(analysis: PostAnalysis): string {
    const decision = this.decideSimilarityMethod(analysis);

    const explanations: string[] = [
      `Post ID: ${analysis.postId}`,
      `Total words: ${analysis.totalWordCount}`,
      `Substantive words: ${analysis.substantiveWordCount}`,
      `Common phrase ratio: ${(analysis.commonPhraseRatio * 100).toFixed(1)}%`,
      `Common phrases found: ${analysis.commonPhrasesFound.join(', ') || 'none'}`,
      '',
      `Decision: ${decision.method}`,
      `Reason: ${decision.reason}`
    ];

    if (analysis.isRetweet) {
      explanations.push('Note: Detected as retweet/share');
    }

    if (analysis.hasQuotes) {
      explanations.push(`Note: Contains quotes (${(analysis.quoteRatio * 100).toFixed(1)}% of text)`);
    }

    if (analysis.isNews) {
      explanations.push('Note: Detected as news content');
    }

    return explanations.join('\n');
  }
}
