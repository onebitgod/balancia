/**
 * Embedding Service
 * Generates three types of embeddings: full, masked, and weighted
 */

import axios, { AxiosInstance } from 'axios';
import {
  PostEmbeddings,
  PostMetadata,
  PostAnalysis,
  TextWithWeights,
  CommonPhraseEngineError
} from '../types';
import { TextAnalysisService } from './text-analysis.service';

interface EmbeddingModelConfig {
  apiUrl: string;
  apiKey?: string;
  model: string;
  dimensions: number;
  timeout: number;
}

export class EmbeddingService {
  private textAnalysisService: TextAnalysisService;
  private modelConfig: EmbeddingModelConfig;
  private httpClient: AxiosInstance;

  constructor(
    textAnalysisService: TextAnalysisService,
    modelConfig: EmbeddingModelConfig
  ) {
    this.textAnalysisService = textAnalysisService;
    this.modelConfig = modelConfig;

    this.httpClient = axios.create({
      baseURL: modelConfig.apiUrl,
      timeout: modelConfig.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(modelConfig.apiKey && { 'Authorization': `Bearer ${modelConfig.apiKey}` })
      }
    });
  }

  // ==========================================================================
  // MAIN EMBEDDING GENERATION
  // ==========================================================================

  /**
   * Generate all three embeddings for a post
   */
  async generatePostEmbeddings(
    postId: string,
    text: string,
    timestamp: Date = new Date()
  ): Promise<PostEmbeddings> {
    try {
      console.log(`[EmbeddingService] Generating embeddings for post ${postId}`);

      // Step 1: Analyze the post
      const analysis = await this.textAnalysisService.analyzePost(postId, text);

      // Step 2: Generate text with weights
      const textWithWeights = await this.textAnalysisService.generateTextWithWeights(text);

      // Step 3: Generate three embeddings
      const [embeddingFull, embeddingMasked, embeddingWeighted] = await Promise.all([
        this.generateEmbedding(textWithWeights.fullText),
        this.generateEmbedding(textWithWeights.maskedText),
        this.generateWeightedEmbedding(textWithWeights)
      ]);

      // Step 4: Create metadata
      const metadata: PostMetadata = {
        postId,
        commonPhrasesFound: analysis.commonPhrasesFound,
        commonPhraseRatio: analysis.commonPhraseRatio,
        substantiveWordCount: analysis.substantiveWordCount,
        totalWordCount: analysis.totalWordCount,
        hasQuotes: analysis.hasQuotes,
        quoteRatio: analysis.quoteRatio,
        isRetweet: analysis.isRetweet,
        isNews: analysis.isNews,
        timestamp,
        originalText: text
      };

      return {
        postId,
        embeddingFull,
        embeddingMasked,
        embeddingWeighted,
        metadata
      };
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to generate embeddings for post ${postId}: ${error.message}`,
        'EMBEDDING_ERROR'
      );
    }
  }

  // ==========================================================================
  // INDIVIDUAL EMBEDDING METHODS
  // ==========================================================================

  /**
   * Generate standard embedding from text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Handle empty text
      if (!text || text.trim().length === 0) {
        console.warn('[EmbeddingService] Empty text, returning zero vector');
        return new Array(this.modelConfig.dimensions).fill(0);
      }

      const response = await this.httpClient.post('/embeddings', {
        model: this.modelConfig.model,
        input: text,
        dimensions: this.modelConfig.dimensions
      });

      if (!response.data || !response.data.data || !response.data.data[0]) {
        throw new Error('Invalid response from embedding API');
      }

      return response.data.data[0].embedding;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new CommonPhraseEngineError(
          `Embedding API error: ${error.response?.data?.message || error.message}`,
          'EMBEDDING_API_ERROR',
          error.response?.status || 500
        );
      }
      throw error;
    }
  }

  /**
   * Generate weighted embedding using attention mask
   * This is more complex - we need to work with the embedding model differently
   */
  async generateWeightedEmbedding(textWithWeights: TextWithWeights): Promise<number[]> {
    try {
      // Strategy 1: Token-level weighting (if model supports it)
      // This is ideal but requires model-specific implementation

      // Strategy 2: Approximate with token repetition
      // Repeat tokens based on their weight (higher weight = more repetitions)
      const weightedText = this.createWeightedText(
        textWithWeights.tokens,
        textWithWeights.attentionMask
      );

      return this.generateEmbedding(weightedText);
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to generate weighted embedding: ${error.message}`,
        'WEIGHTED_EMBEDDING_ERROR'
      );
    }
  }

  /**
   * Create weighted text by adjusting token presence
   * Higher weight = more emphasis
   * Lower weight = less emphasis (fewer repetitions or removal)
   */
  private createWeightedText(tokens: string[], attentionMask: number[]): string {
    const weightedTokens: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const weight = attentionMask[i];

      if (weight >= 0.8) {
        // High importance: repeat token
        weightedTokens.push(token, token);
      } else if (weight >= 0.5) {
        // Medium importance: include once
        weightedTokens.push(token);
      } else if (weight >= 0.2) {
        // Low importance: include occasionally
        if (Math.random() > 0.5) {
          weightedTokens.push(token);
        }
      }
      // Very low importance (< 0.2): skip token
    }

    return weightedTokens.join(' ');
  }

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  /**
   * Generate embeddings for multiple posts in batch
   */
  async generateBatchEmbeddings(
    posts: Array<{ postId: string; text: string; timestamp?: Date }>
  ): Promise<PostEmbeddings[]> {
    const embeddings: PostEmbeddings[] = [];
    const batchSize = 10; // Process in batches to avoid overwhelming the API

    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(post =>
          this.generatePostEmbeddings(
            post.postId,
            post.text,
            post.timestamp
          )
        )
      );

      embeddings.push(...batchResults);

      console.log(`[EmbeddingService] Processed batch ${i / batchSize + 1}/${Math.ceil(posts.length / batchSize)}`);
    }

    return embeddings;
  }

  // ==========================================================================
  // ALTERNATIVE WEIGHTED EMBEDDING STRATEGIES
  // ==========================================================================

  /**
   * Advanced Strategy: Generate weighted embedding using token-level embeddings
   * This requires a more sophisticated approach with token embeddings
   */
  async generateAdvancedWeightedEmbedding(
    textWithWeights: TextWithWeights
  ): Promise<number[]> {
    try {
      // Get embeddings for individual tokens
      const tokenEmbeddings = await this.generateTokenEmbeddings(textWithWeights.tokens);

      // Apply attention mask to each token embedding
      const weightedEmbeddings = tokenEmbeddings.map((embedding, i) => {
        const weight = textWithWeights.attentionMask[i];
        return embedding.map(val => val * weight);
      });

      // Average the weighted embeddings
      return this.averageEmbeddings(weightedEmbeddings);
    } catch (error) {
      console.warn('[EmbeddingService] Advanced weighted embedding failed, falling back to simple method:', error.message);
      return this.generateWeightedEmbedding(textWithWeights);
    }
  }

  /**
   * Generate embeddings for individual tokens
   */
  private async generateTokenEmbeddings(tokens: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Generate in batches
    const batchSize = 50;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const batchEmbeddings = await Promise.all(
        batch.map(token => this.generateEmbedding(token))
      );

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  /**
   * Average multiple embeddings
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      return new Array(this.modelConfig.dimensions).fill(0);
    }

    const dimensions = embeddings[0].length;
    const averaged = new Array(dimensions).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        averaged[i] += embedding[i];
      }
    }

    // Normalize
    for (let i = 0; i < dimensions; i++) {
      averaged[i] /= embeddings.length;
    }

    return averaged;
  }

  // ==========================================================================
  // SIMILARITY CALCULATION (for testing)
  // ==========================================================================

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Validate embedding dimensions
   */
  validateEmbedding(embedding: number[]): boolean {
    return (
      Array.isArray(embedding) &&
      embedding.length === this.modelConfig.dimensions &&
      embedding.every(val => typeof val === 'number' && !isNaN(val))
    );
  }

  /**
   * Get model information
   */
  getModelInfo(): {
    model: string;
    dimensions: number;
    apiUrl: string;
  } {
    return {
      model: this.modelConfig.model,
      dimensions: this.modelConfig.dimensions,
      apiUrl: this.modelConfig.apiUrl
    };
  }
}
