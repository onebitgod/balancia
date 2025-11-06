/**
 * Qdrant Service
 * Interface with Qdrant vector database for storing and searching embeddings
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import {
  PostEmbeddings,
  PostMetadata,
  SimilarPost,
  QdrantConfig,
  CommonPhraseEngineError
} from '../types';

interface QdrantSearchResult {
  id: string;
  score: number;
  payload: PostMetadata;
}

export class QdrantService {
  private client: QdrantClient;
  private config: QdrantConfig;

  constructor(config: QdrantConfig) {
    this.config = config;
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey
    });
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize Qdrant collections
   */
  async initialize(): Promise<void> {
    try {
      await this.createCollectionIfNotExists(this.config.collections.weighted);
      await this.createCollectionIfNotExists(this.config.collections.masked);
      await this.createCollectionIfNotExists(this.config.collections.full);

      console.log('[QdrantService] Initialized successfully');
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to initialize QdrantService: ${error.message}`,
        'QDRANT_INIT_ERROR'
      );
    }
  }

  /**
   * Create collection if it doesn't exist
   */
  private async createCollectionIfNotExists(collectionName: string): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);

      if (!exists) {
        await this.client.createCollection(collectionName, {
          vectors: {
            size: this.config.vectorSize,
            distance: 'Cosine'
          },
          optimizers_config: {
            default_segment_number: 2
          },
          replication_factor: 1
        });

        console.log(`[QdrantService] Created collection: ${collectionName}`);
      }
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to create collection ${collectionName}: ${error.message}`,
        'COLLECTION_CREATE_ERROR'
      );
    }
  }

  // ==========================================================================
  // STORAGE OPERATIONS
  // ==========================================================================

  /**
   * Store post embeddings in all three collections
   */
  async storePostEmbeddings(embeddings: PostEmbeddings): Promise<void> {
    try {
      await Promise.all([
        this.upsertPoint(
          this.config.collections.weighted,
          embeddings.postId,
          embeddings.embeddingWeighted,
          embeddings.metadata
        ),
        this.upsertPoint(
          this.config.collections.masked,
          embeddings.postId,
          embeddings.embeddingMasked,
          embeddings.metadata
        ),
        this.upsertPoint(
          this.config.collections.full,
          embeddings.postId,
          embeddings.embeddingFull,
          embeddings.metadata
        )
      ]);

      console.log(`[QdrantService] Stored embeddings for post ${embeddings.postId}`);
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to store embeddings for post ${embeddings.postId}: ${error.message}`,
        'STORAGE_ERROR'
      );
    }
  }

  /**
   * Upsert a single point into a collection
   */
  private async upsertPoint(
    collectionName: string,
    pointId: string,
    vector: number[],
    payload: PostMetadata
  ): Promise<void> {
    await this.client.upsert(collectionName, {
      wait: true,
      points: [
        {
          id: pointId,
          vector,
          payload: this.serializePayload(payload)
        }
      ]
    });
  }

  /**
   * Store multiple post embeddings in batch
   */
  async storeBatchEmbeddings(embeddings: PostEmbeddings[]): Promise<void> {
    const batchSize = 100;

    for (let i = 0; i < embeddings.length; i += batchSize) {
      const batch = embeddings.slice(i, i + batchSize);

      await Promise.all([
        this.upsertBatch(
          this.config.collections.weighted,
          batch.map(e => ({
            id: e.postId,
            vector: e.embeddingWeighted,
            payload: e.metadata
          }))
        ),
        this.upsertBatch(
          this.config.collections.masked,
          batch.map(e => ({
            id: e.postId,
            vector: e.embeddingMasked,
            payload: e.metadata
          }))
        ),
        this.upsertBatch(
          this.config.collections.full,
          batch.map(e => ({
            id: e.postId,
            vector: e.embeddingFull,
            payload: e.metadata
          }))
        )
      ]);

      console.log(`[QdrantService] Stored batch ${i / batchSize + 1}/${Math.ceil(embeddings.length / batchSize)}`);
    }
  }

  /**
   * Upsert multiple points in batch
   */
  private async upsertBatch(
    collectionName: string,
    points: Array<{ id: string; vector: number[]; payload: PostMetadata }>
  ): Promise<void> {
    await this.client.upsert(collectionName, {
      wait: true,
      points: points.map(p => ({
        id: p.id,
        vector: p.vector,
        payload: this.serializePayload(p.payload)
      }))
    });
  }

  // ==========================================================================
  // SEARCH OPERATIONS
  // ==========================================================================

  /**
   * Search for similar posts in weighted collection
   */
  async searchWeighted(
    vector: number[],
    limit: number = this.config.searchLimit,
    filter?: any
  ): Promise<QdrantSearchResult[]> {
    return this.search(this.config.collections.weighted, vector, limit, filter);
  }

  /**
   * Search for similar posts in masked collection
   */
  async searchMasked(
    vector: number[],
    limit: number = this.config.searchLimit,
    filter?: any
  ): Promise<QdrantSearchResult[]> {
    return this.search(this.config.collections.masked, vector, limit, filter);
  }

  /**
   * Search for similar posts in full collection
   */
  async searchFull(
    vector: number[],
    limit: number = this.config.searchLimit,
    filter?: any
  ): Promise<QdrantSearchResult[]> {
    return this.search(this.config.collections.full, vector, limit, filter);
  }

  /**
   * Generic search method
   */
  private async search(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: any
  ): Promise<QdrantSearchResult[]> {
    try {
      const searchResult = await this.client.search(collectionName, {
        vector,
        limit,
        filter,
        with_payload: true,
        with_vector: false
      });

      return searchResult.map(result => ({
        id: String(result.id),
        score: result.score,
        payload: this.deserializePayload(result.payload as any)
      }));
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Search failed in collection ${collectionName}: ${error.message}`,
        'SEARCH_ERROR'
      );
    }
  }

  /**
   * Search multiple collections in parallel
   */
  async searchMultiple(
    vector: number[],
    collections: string[],
    limit: number = this.config.searchLimit
  ): Promise<Record<string, QdrantSearchResult[]>> {
    const searches = collections.map(async collection => {
      const results = await this.search(collection, vector, limit);
      return { collection, results };
    });

    const allResults = await Promise.all(searches);

    const resultMap: Record<string, QdrantSearchResult[]> = {};
    for (const { collection, results } of allResults) {
      resultMap[collection] = results;
    }

    return resultMap;
  }

  // ==========================================================================
  // DELETE OPERATIONS
  // ==========================================================================

  /**
   * Delete a post from all collections
   */
  async deletePost(postId: string): Promise<void> {
    await Promise.all([
      this.deletePoint(this.config.collections.weighted, postId),
      this.deletePoint(this.config.collections.masked, postId),
      this.deletePoint(this.config.collections.full, postId)
    ]);

    console.log(`[QdrantService] Deleted post ${postId}`);
  }

  /**
   * Delete a point from a collection
   */
  private async deletePoint(collectionName: string, pointId: string): Promise<void> {
    await this.client.delete(collectionName, {
      wait: true,
      points: [pointId]
    });
  }

  /**
   * Delete multiple posts in batch
   */
  async deleteBatchPosts(postIds: string[]): Promise<void> {
    await Promise.all([
      this.deleteBatch(this.config.collections.weighted, postIds),
      this.deleteBatch(this.config.collections.masked, postIds),
      this.deleteBatch(this.config.collections.full, postIds)
    ]);

    console.log(`[QdrantService] Deleted ${postIds.length} posts`);
  }

  /**
   * Delete multiple points from a collection
   */
  private async deleteBatch(collectionName: string, pointIds: string[]): Promise<void> {
    await this.client.delete(collectionName, {
      wait: true,
      points: pointIds
    });
  }

  // ==========================================================================
  // COLLECTION MANAGEMENT
  // ==========================================================================

  /**
   * Get collection info
   */
  async getCollectionInfo(collectionName: string): Promise<any> {
    return this.client.getCollection(collectionName);
  }

  /**
   * Get all collection stats
   */
  async getAllCollectionStats(): Promise<{
    weighted: any;
    masked: any;
    full: any;
  }> {
    const [weighted, masked, full] = await Promise.all([
      this.getCollectionInfo(this.config.collections.weighted),
      this.getCollectionInfo(this.config.collections.masked),
      this.getCollectionInfo(this.config.collections.full)
    ]);

    return { weighted, masked, full };
  }

  /**
   * Clear a collection (delete all points)
   */
  async clearCollection(collectionName: string): Promise<void> {
    await this.client.delete(collectionName, {
      wait: true,
      filter: {} // Empty filter matches all points
    });

    console.log(`[QdrantService] Cleared collection ${collectionName}`);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Serialize payload for storage
   */
  private serializePayload(payload: PostMetadata): any {
    return {
      postId: payload.postId,
      commonPhrasesFound: payload.commonPhrasesFound,
      commonPhraseRatio: payload.commonPhraseRatio,
      substantiveWordCount: payload.substantiveWordCount,
      totalWordCount: payload.totalWordCount,
      hasQuotes: payload.hasQuotes,
      quoteRatio: payload.quoteRatio,
      isRetweet: payload.isRetweet,
      isNews: payload.isNews,
      timestamp: payload.timestamp.toISOString(),
      originalText: payload.originalText
    };
  }

  /**
   * Deserialize payload from storage
   */
  private deserializePayload(payload: any): PostMetadata {
    return {
      postId: payload.postId,
      commonPhrasesFound: payload.commonPhrasesFound || [],
      commonPhraseRatio: payload.commonPhraseRatio || 0,
      substantiveWordCount: payload.substantiveWordCount || 0,
      totalWordCount: payload.totalWordCount || 0,
      hasQuotes: payload.hasQuotes || false,
      quoteRatio: payload.quoteRatio || 0,
      isRetweet: payload.isRetweet || false,
      isNews: payload.isNews || false,
      timestamp: new Date(payload.timestamp),
      originalText: payload.originalText || ''
    };
  }

  /**
   * Convert Qdrant search results to SimilarPost format
   */
  convertToSimilarPosts(results: QdrantSearchResult[]): SimilarPost[] {
    return results.map(result => ({
      postId: result.id,
      similarity: result.score,
      text: result.payload.originalText,
      timestamp: result.payload.timestamp
    }));
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      console.error('[QdrantService] Health check failed:', error);
      return false;
    }
  }
}
