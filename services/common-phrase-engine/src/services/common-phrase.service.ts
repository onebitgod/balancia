/**
 * Common Phrase Service
 * Manages common phrases in PostgreSQL and Redis cache
 */

import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import {
  CommonPhrase,
  CommonPhraseCache,
  PhraseCategory,
  CommonPhraseEngineError,
  RedisConfig,
  DatabaseConfig,
  CommonPhraseConfig
} from '../types';

export class CommonPhraseService {
  private pool: Pool;
  private redis: Redis;
  private config: CommonPhraseConfig;
  private redisConfig: RedisConfig;
  private inMemoryCache: CommonPhraseCache | null = null;
  private cacheLoadedAt: Date | null = null;

  constructor(
    dbConfig: DatabaseConfig,
    redisConfig: RedisConfig,
    config: CommonPhraseConfig
  ) {
    this.pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: dbConfig.ssl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      keyPrefix: redisConfig.keyPrefix,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    this.config = config;
    this.redisConfig = redisConfig;
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  async initialize(): Promise<void> {
    try {
      // Test database connection
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      // Test Redis connection
      await this.redis.ping();

      // Load cache into memory
      await this.loadCacheIntoMemory();

      console.log('[CommonPhraseService] Initialized successfully');
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to initialize CommonPhraseService: ${error.message}`,
        'INIT_ERROR'
      );
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.redis.quit();
  }

  // ==========================================================================
  // CACHE MANAGEMENT
  // ==========================================================================

  /**
   * Load common phrases from Redis into in-memory cache
   * L1 cache: In-memory (fastest)
   * L2 cache: Redis (fast)
   * L3 cache: PostgreSQL (slowest, source of truth)
   */
  async loadCacheIntoMemory(): Promise<void> {
    try {
      const cacheKey = 'common_phrases:v1';
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        this.inMemoryCache = JSON.parse(cached);
        this.cacheLoadedAt = new Date();
        console.log(`[CommonPhraseService] Loaded ${Object.keys(this.inMemoryCache).length} phrases into memory`);
      } else {
        // Load from database
        await this.refreshCacheFromDatabase();
      }
    } catch (error) {
      console.error('[CommonPhraseService] Failed to load cache:', error);
      throw error;
    }
  }

  /**
   * Refresh cache from PostgreSQL database
   */
  async refreshCacheFromDatabase(): Promise<void> {
    try {
      const query = `
        SELECT phrase, frequency, category, weight, n_gram_size
        FROM common_phrases
        WHERE frequency >= $1
        ORDER BY frequency DESC
      `;

      const result = await this.pool.query(query, [this.config.frequencyThresholds.somewhatCommon]);

      const cache: CommonPhraseCache = {};
      for (const row of result.rows) {
        cache[row.phrase] = {
          weight: parseFloat(row.weight),
          category: row.category as PhraseCategory
        };
      }

      // Update in-memory cache
      this.inMemoryCache = cache;
      this.cacheLoadedAt = new Date();

      // Update Redis cache
      const cacheKey = 'common_phrases:v1';
      await this.redis.setex(
        cacheKey,
        this.redisConfig.ttl,
        JSON.stringify(cache)
      );

      console.log(`[CommonPhraseService] Refreshed cache with ${Object.keys(cache).length} phrases`);
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to refresh cache: ${error.message}`,
        'CACHE_REFRESH_ERROR'
      );
    }
  }

  /**
   * Get common phrases cache (L1 -> L2 -> L3)
   */
  async getCommonPhrasesCache(): Promise<CommonPhraseCache> {
    // L1: In-memory cache
    if (this.inMemoryCache) {
      return this.inMemoryCache;
    }

    // L2: Redis cache
    const cacheKey = 'common_phrases:v1';
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.inMemoryCache = JSON.parse(cached);
      this.cacheLoadedAt = new Date();
      return this.inMemoryCache;
    }

    // L3: Database
    await this.refreshCacheFromDatabase();
    return this.inMemoryCache!;
  }

  // ==========================================================================
  // PHRASE QUERIES
  // ==========================================================================

  /**
   * Check if a phrase is common
   */
  async isCommonPhrase(phrase: string): Promise<boolean> {
    const cache = await this.getCommonPhrasesCache();
    return phrase.toLowerCase() in cache;
  }

  /**
   * Get phrase weight (0.0 - 1.0)
   * Returns 1.0 if phrase is not common
   */
  async getPhraseWeight(phrase: string): Promise<number> {
    const cache = await this.getCommonPhrasesCache();
    const normalized = phrase.toLowerCase();
    return cache[normalized]?.weight ?? 1.0;
  }

  /**
   * Get multiple phrase weights in batch
   */
  async getPhraseWeights(phrases: string[]): Promise<Map<string, number>> {
    const cache = await this.getCommonPhrasesCache();
    const weights = new Map<string, number>();

    for (const phrase of phrases) {
      const normalized = phrase.toLowerCase();
      weights.set(phrase, cache[normalized]?.weight ?? 1.0);
    }

    return weights;
  }

  /**
   * Get phrases by category
   */
  async getPhrasesByCategory(category: PhraseCategory): Promise<string[]> {
    const cacheKey = `common_phrases:by_category:${category}`;

    // Try Redis first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Query database
    const query = `
      SELECT phrase
      FROM common_phrases
      WHERE category = $1
      ORDER BY frequency DESC
    `;

    const result = await this.pool.query(query, [category]);
    const phrases = result.rows.map(row => row.phrase);

    // Cache in Redis
    await this.redis.setex(cacheKey, this.redisConfig.ttl, JSON.stringify(phrases));

    return phrases;
  }

  /**
   * Get all common phrases (for analytics)
   */
  async getAllCommonPhrases(): Promise<CommonPhrase[]> {
    const query = `
      SELECT
        phrase,
        frequency,
        category,
        weight,
        n_gram_size as "nGramSize",
        first_seen as "firstSeen",
        last_updated as "lastUpdated",
        post_count as "postCount"
      FROM common_phrases
      ORDER BY frequency DESC
    `;

    const result = await this.pool.query(query);
    return result.rows;
  }

  // ==========================================================================
  // PHRASE UPDATES (Used by Analytics Service)
  // ==========================================================================

  /**
   * Upsert common phrases (bulk operation)
   */
  async upsertCommonPhrases(phrases: CommonPhrase[]): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (const phrase of phrases) {
        const query = `
          INSERT INTO common_phrases (
            phrase, frequency, category, weight, n_gram_size,
            first_seen, last_updated, post_count
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (phrase)
          DO UPDATE SET
            frequency = EXCLUDED.frequency,
            category = EXCLUDED.category,
            weight = EXCLUDED.weight,
            last_updated = EXCLUDED.last_updated,
            post_count = EXCLUDED.post_count
        `;

        await client.query(query, [
          phrase.phrase,
          phrase.frequency,
          phrase.category,
          phrase.weight,
          phrase.nGramSize,
          phrase.firstSeen,
          phrase.lastUpdated,
          phrase.postCount
        ]);
      }

      await client.query('COMMIT');

      // Invalidate cache after update
      await this.invalidateCache();

      console.log(`[CommonPhraseService] Upserted ${phrases.length} phrases`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new CommonPhraseEngineError(
        `Failed to upsert phrases: ${error.message}`,
        'UPSERT_ERROR'
      );
    } finally {
      client.release();
    }
  }

  /**
   * Delete phrases that no longer meet threshold
   */
  async deleteInfrequentPhrases(minFrequency: number): Promise<number> {
    const query = `
      DELETE FROM common_phrases
      WHERE frequency < $1
      RETURNING phrase
    `;

    const result = await this.pool.query(query, [minFrequency]);
    const deletedCount = result.rowCount || 0;

    if (deletedCount > 0) {
      await this.invalidateCache();
      console.log(`[CommonPhraseService] Deleted ${deletedCount} infrequent phrases`);
    }

    return deletedCount;
  }

  /**
   * Invalidate all caches
   */
  async invalidateCache(): Promise<void> {
    // Clear Redis cache
    const pattern = 'common_phrases:*';
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    // Clear in-memory cache
    this.inMemoryCache = null;
    this.cacheLoadedAt = null;

    console.log('[CommonPhraseService] Cache invalidated');
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalPhrases: number;
    cacheLoadedAt: Date | null;
    categories: Record<PhraseCategory, number>;
  }> {
    const cache = await this.getCommonPhrasesCache();

    const categories: Record<PhraseCategory, number> = {
      [PhraseCategory.GREETING]: 0,
      [PhraseCategory.COURTESY]: 0,
      [PhraseCategory.REACTION]: 0,
      [PhraseCategory.TEMPORAL]: 0,
      [PhraseCategory.FILLER]: 0,
      [PhraseCategory.PLATFORM]: 0,
      [PhraseCategory.UNKNOWN]: 0,
    };

    for (const phrase of Object.values(cache)) {
      categories[phrase.category]++;
    }

    return {
      totalPhrases: Object.keys(cache).length,
      cacheLoadedAt: this.cacheLoadedAt,
      categories
    };
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{
    totalPhrases: number;
    veryCommon: number;
    common: number;
    somewhatCommon: number;
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE frequency >= $1) as very_common,
        COUNT(*) FILTER (WHERE frequency >= $2 AND frequency < $1) as common,
        COUNT(*) FILTER (WHERE frequency >= $3 AND frequency < $2) as somewhat_common
      FROM common_phrases
    `;

    const result = await this.pool.query(query, [
      this.config.frequencyThresholds.veryCommon,
      this.config.frequencyThresholds.common,
      this.config.frequencyThresholds.somewhatCommon
    ]);

    const row = result.rows[0];
    return {
      totalPhrases: parseInt(row.total),
      veryCommon: parseInt(row.very_common),
      common: parseInt(row.common),
      somewhatCommon: parseInt(row.somewhat_common)
    };
  }
}
