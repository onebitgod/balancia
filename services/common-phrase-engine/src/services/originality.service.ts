/**
 * Originality Service
 * Main orchestrator for the entire originality checking pipeline
 */

import {
  OriginalityResult,
  PostEmbeddings,
  PostAnalysis,
  SimilarityResult,
  CommonPhraseEngineError
} from '../types';
import { TextAnalysisService } from './text-analysis.service';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { SimilarityService } from './similarity.service';

export class OriginalityService {
  private textAnalysisService: TextAnalysisService;
  private embeddingService: EmbeddingService;
  private qdrantService: QdrantService;
  private similarityService: SimilarityService;

  constructor(
    textAnalysisService: TextAnalysisService,
    embeddingService: EmbeddingService,
    qdrantService: QdrantService,
    similarityService: SimilarityService
  ) {
    this.textAnalysisService = textAnalysisService;
    this.embeddingService = embeddingService;
    this.qdrantService = qdrantService;
    this.similarityService = similarityService;
  }

  // ==========================================================================
  // MAIN ORIGINALITY CHECK PIPELINE
  // ==========================================================================

  /**
   * Complete originality check for a new post
   * This is the main entry point for checking if a post is original
   */
  async checkOriginality(
    postId: string,
    text: string,
    storeInDatabase: boolean = true
  ): Promise<OriginalityResult> {
    const startTime = Date.now();

    try {
      console.log(`[OriginalityService] Checking originality for post ${postId}`);

      // Step 1: Generate embeddings (includes text analysis)
      const embeddings = await this.embeddingService.generatePostEmbeddings(postId, text);

      // Step 2: Create analysis object from metadata
      const analysis = this.createAnalysisFromMetadata(embeddings);

      // Step 3: Decide similarity method
      const decision = this.similarityService.decideSimilarityMethod(analysis);
      console.log(`[OriginalityService] Using method: ${decision.method} (${decision.reason})`);

      // Step 4: Calculate similarity (only if not skipping)
      let similarityResult: SimilarityResult;

      if (storeInDatabase) {
        // Store first, then search (to avoid including this post in results)
        await this.qdrantService.storePostEmbeddings(embeddings);
        similarityResult = await this.similarityService.calculateSimilarity(embeddings, decision);
      } else {
        // Just search without storing
        similarityResult = await this.similarityService.calculateSimilarity(embeddings, decision);
      }

      // Step 5: Calculate originality score
      const originalityScore = (1 - similarityResult.finalSimilarity) * 100;

      // Step 6: Get substantive content
      const substantiveContent = await this.textAnalysisService.getSubstantiveContent(text);

      const processingTimeMs = Date.now() - startTime;

      const result: OriginalityResult = {
        originalityScore,
        methodUsed: similarityResult.methodUsed,
        commonPhrasesDetected: embeddings.metadata.commonPhrasesFound,
        substantiveContent,
        similarPosts: similarityResult.similarPosts,
        metadata: {
          commonPhraseRatio: embeddings.metadata.commonPhraseRatio,
          substantiveWordCount: embeddings.metadata.substantiveWordCount,
          processingTimeMs
        }
      };

      console.log(`[OriginalityService] Originality: ${originalityScore.toFixed(1)}% (${processingTimeMs}ms)`);

      return result;
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to check originality for post ${postId}: ${error.message}`,
        'ORIGINALITY_CHECK_ERROR'
      );
    }
  }

  /**
   * Store post without checking originality (for bulk imports)
   */
  async storePost(postId: string, text: string, timestamp?: Date): Promise<void> {
    try {
      console.log(`[OriginalityService] Storing post ${postId}`);

      const embeddings = await this.embeddingService.generatePostEmbeddings(
        postId,
        text,
        timestamp
      );

      await this.qdrantService.storePostEmbeddings(embeddings);

      console.log(`[OriginalityService] Stored post ${postId}`);
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to store post ${postId}: ${error.message}`,
        'STORE_POST_ERROR'
      );
    }
  }

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  /**
   * Check originality for multiple posts
   */
  async checkBatchOriginality(
    posts: Array<{ postId: string; text: string }>
  ): Promise<Map<string, OriginalityResult>> {
    const results = new Map<string, OriginalityResult>();

    for (const post of posts) {
      try {
        const result = await this.checkOriginality(post.postId, post.text, true);
        results.set(post.postId, result);
      } catch (error) {
        console.error(`[OriginalityService] Failed to check post ${post.postId}:`, error);
      }
    }

    return results;
  }

  /**
   * Store multiple posts without checking originality
   */
  async storeBatchPosts(
    posts: Array<{ postId: string; text: string; timestamp?: Date }>
  ): Promise<void> {
    const batchSize = 50;

    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);

      const embeddings = await this.embeddingService.generateBatchEmbeddings(batch);
      await this.qdrantService.storeBatchEmbeddings(embeddings);

      console.log(`[OriginalityService] Stored batch ${i / batchSize + 1}/${Math.ceil(posts.length / batchSize)}`);
    }
  }

  // ==========================================================================
  // POST MANAGEMENT
  // ==========================================================================

  /**
   * Delete a post from the system
   */
  async deletePost(postId: string): Promise<void> {
    await this.qdrantService.deletePost(postId);
    console.log(`[OriginalityService] Deleted post ${postId}`);
  }

  /**
   * Update a post (delete old, store new)
   */
  async updatePost(postId: string, newText: string): Promise<void> {
    await this.deletePost(postId);
    await this.storePost(postId, newText);
    console.log(`[OriginalityService] Updated post ${postId}`);
  }

  // ==========================================================================
  // ANALYSIS & DEBUGGING
  // ==========================================================================

  /**
   * Analyze a post without storing or checking similarity
   * Useful for debugging and understanding how a post is processed
   */
  async analyzePost(text: string): Promise<{
    analysis: PostAnalysis;
    decision: any;
    explanation: string;
  }> {
    const analysis = await this.textAnalysisService.analyzePost('temp', text);
    const decision = this.similarityService.decideSimilarityMethod(analysis);
    const explanation = this.similarityService.explainDecision(analysis);

    return {
      analysis,
      decision,
      explanation
    };
  }

  /**
   * Compare two posts directly
   */
  async comparePosts(text1: string, text2: string): Promise<{
    fullTextSimilarity: number;
    maskedTextSimilarity: number;
    weightedTextSimilarity: number;
    analysis1: PostAnalysis;
    analysis2: PostAnalysis;
  }> {
    // Generate embeddings for both posts
    const embeddings1 = await this.embeddingService.generatePostEmbeddings('post1', text1);
    const embeddings2 = await this.embeddingService.generatePostEmbeddings('post2', text2);

    // Calculate cosine similarity for all three embedding types
    const fullTextSimilarity = this.embeddingService.cosineSimilarity(
      embeddings1.embeddingFull,
      embeddings2.embeddingFull
    );

    const maskedTextSimilarity = this.embeddingService.cosineSimilarity(
      embeddings1.embeddingMasked,
      embeddings2.embeddingMasked
    );

    const weightedTextSimilarity = this.embeddingService.cosineSimilarity(
      embeddings1.embeddingWeighted,
      embeddings2.embeddingWeighted
    );

    return {
      fullTextSimilarity,
      maskedTextSimilarity,
      weightedTextSimilarity,
      analysis1: this.createAnalysisFromMetadata(embeddings1),
      analysis2: this.createAnalysisFromMetadata(embeddings2)
    };
  }

  /**
   * Get detailed analysis with all embeddings
   */
  async getDetailedAnalysis(postId: string, text: string): Promise<{
    embeddings: PostEmbeddings;
    analysis: PostAnalysis;
    decision: any;
    textWithWeights: any;
  }> {
    const embeddings = await this.embeddingService.generatePostEmbeddings(postId, text);
    const analysis = this.createAnalysisFromMetadata(embeddings);
    const decision = this.similarityService.decideSimilarityMethod(analysis);
    const textWithWeights = await this.textAnalysisService.generateTextWithWeights(text);

    return {
      embeddings,
      analysis,
      decision,
      textWithWeights
    };
  }

  // ==========================================================================
  // STATISTICS & MONITORING
  // ==========================================================================

  /**
   * Get system statistics
   */
  async getStatistics(): Promise<{
    collections: any;
    cacheStats: any;
  }> {
    const [collections, cacheStats] = await Promise.all([
      this.qdrantService.getAllCollectionStats(),
      // commonPhraseService.getCacheStats() would go here
    ]);

    return {
      collections,
      cacheStats
    };
  }

  /**
   * Health check for all services
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    services: {
      qdrant: boolean;
      embedding: boolean;
    };
  }> {
    const qdrantHealth = await this.qdrantService.healthCheck();
    const embeddingHealth = true; // Embedding service doesn't have external dependencies

    const allHealthy = qdrantHealth && embeddingHealth;

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      services: {
        qdrant: qdrantHealth,
        embedding: embeddingHealth
      }
    };
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Create PostAnalysis from PostMetadata
   */
  private createAnalysisFromMetadata(embeddings: PostEmbeddings): PostAnalysis {
    return {
      postId: embeddings.postId,
      originalText: embeddings.metadata.originalText,
      commonPhrasesFound: embeddings.metadata.commonPhrasesFound,
      commonPhraseRatio: embeddings.metadata.commonPhraseRatio,
      substantiveWordCount: embeddings.metadata.substantiveWordCount,
      totalWordCount: embeddings.metadata.totalWordCount,
      hasQuotes: embeddings.metadata.hasQuotes,
      quoteRatio: embeddings.metadata.quoteRatio,
      isRetweet: embeddings.metadata.isRetweet,
      isNews: embeddings.metadata.isNews
    };
  }

  /**
   * Format originality result for display
   */
  formatResult(result: OriginalityResult): string {
    const lines = [
      '='.repeat(60),
      'ORIGINALITY CHECK RESULT',
      '='.repeat(60),
      '',
      `Originality Score: ${result.originalityScore.toFixed(1)}%`,
      `Method Used: ${result.methodUsed}`,
      `Processing Time: ${result.metadata.processingTimeMs}ms`,
      '',
      'Common Phrases Detected:',
      result.commonPhrasesDetected.length > 0
        ? result.commonPhrasesDetected.map(p => `  - "${p}"`).join('\n')
        : '  None',
      '',
      'Substantive Content:',
      `  "${result.substantiveContent}"`,
      '',
      'Metadata:',
      `  - Common Phrase Ratio: ${(result.metadata.commonPhraseRatio * 100).toFixed(1)}%`,
      `  - Substantive Word Count: ${result.metadata.substantiveWordCount}`,
      ''
    ];

    if (result.similarPosts.length > 0) {
      lines.push('Similar Posts Found:');
      for (const post of result.similarPosts) {
        lines.push(`  - Post ${post.postId}: ${(post.similarity * 100).toFixed(1)}% similarity`);
        lines.push(`    "${post.text.substring(0, 80)}..."`);
      }
    } else {
      lines.push('No similar posts found');
    }

    lines.push('', '='.repeat(60));

    return lines.join('\n');
  }
}
