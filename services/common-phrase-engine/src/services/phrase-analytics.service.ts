/**
 * Phrase Analytics Service
 * Nightly job to identify common phrases from post data
 */

import { Pool } from 'pg';
import {
  CommonPhrase,
  PhraseCategory,
  AnalyticsJobResult,
  CommonPhraseConfig,
  DatabaseConfig,
  CommonPhraseEngineError
} from '../types';
import { TextAnalysisService } from './text-analysis.service';
import { CommonPhraseService } from './common-phrase.service';

export class PhraseAnalyticsService {
  private pool: Pool;
  private textAnalysisService: TextAnalysisService;
  private commonPhraseService: CommonPhraseService;
  private config: CommonPhraseConfig;

  // Phrase categorization patterns
  private readonly CATEGORY_PATTERNS: Record<PhraseCategory, RegExp[]> = {
    [PhraseCategory.GREETING]: [
      /^(good morning|good afternoon|good evening|good night|hello|hi|hey|greetings|howdy)/i,
      /^(have a (great|good|nice|wonderful) day)/i
    ],
    [PhraseCategory.COURTESY]: [
      /^(thank you|thanks|thank|thx|ty)/i,
      /^(you('re| are) welcome|welcome)/i,
      /^(please|kindly)/i,
      /^(excuse me|sorry|pardon)/i
    ],
    [PhraseCategory.REACTION]: [
      /^(lol|lmao|omg|wow|amazing|awesome|cool|nice|great)/i,
      /^(haha|hehe|lmfao)/i,
      /^(congrats|congratulations)/i
    ],
    [PhraseCategory.TEMPORAL]: [
      /^(happy new year|merry christmas|happy birthday|happy holidays)/i,
      /^(happy (monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i,
      /^(good luck|best wishes)/i
    ],
    [PhraseCategory.FILLER]: [
      /^(in my opinion|imo|imho)/i,
      /^(to be honest|tbh|honestly)/i,
      /^(i think|i believe|i feel)/i,
      /^(you know|well|actually|basically)/i
    ],
    [PhraseCategory.PLATFORM]: [
      /^(rt|via|check out|follow)/i,
      /^(link in bio|dm me|tag)/i,
      /^(retweet|share|like)/i
    ]
  };

  constructor(
    dbConfig: DatabaseConfig,
    textAnalysisService: TextAnalysisService,
    commonPhraseService: CommonPhraseService,
    config: CommonPhraseConfig
  ) {
    this.pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: dbConfig.ssl,
      max: 20
    });

    this.textAnalysisService = textAnalysisService;
    this.commonPhraseService = commonPhraseService;
    this.config = config;
  }

  // ==========================================================================
  // MAIN ANALYTICS JOB
  // ==========================================================================

  /**
   * Run the complete analytics job
   * This should be scheduled to run nightly at 2 AM
   */
  async runAnalyticsJob(
    lookbackDays: number = 30,
    batchSize: number = 10000
  ): Promise<AnalyticsJobResult> {
    const startTime = Date.now();

    try {
      console.log('[PhraseAnalytics] Starting analytics job...');

      // Step 1: Get total post count
      const totalPosts = await this.getTotalPostCount(lookbackDays);
      console.log(`[PhraseAnalytics] Analyzing ${totalPosts} posts from last ${lookbackDays} days`);

      // Step 2: Extract n-grams from all posts
      const nGramCounts = await this.extractNGramsFromAllPosts(lookbackDays, batchSize);
      console.log(`[PhraseAnalytics] Extracted ${nGramCounts.size} unique n-grams`);

      // Step 3: Calculate frequencies
      const phraseFrequencies = this.calculateFrequencies(nGramCounts, totalPosts);
      console.log(`[PhraseAnalytics] Calculated frequencies for ${phraseFrequencies.length} phrases`);

      // Step 4: Filter by threshold and categorize
      const commonPhrases = await this.identifyCommonPhrases(phraseFrequencies);
      console.log(`[PhraseAnalytics] Identified ${commonPhrases.length} common phrases`);

      // Step 5: Update database
      await this.updateCommonPhrases(commonPhrases);

      // Step 6: Clean up infrequent phrases
      const deletedCount = await this.commonPhraseService.deleteInfrequentPhrases(
        this.config.frequencyThresholds.somewhatCommon
      );

      // Step 7: Refresh cache
      await this.commonPhraseService.refreshCacheFromDatabase();

      const processingTimeMs = Date.now() - startTime;

      const result: AnalyticsJobResult = {
        totalPosts,
        uniquePhrases: commonPhrases.length,
        veryCommonPhrases: commonPhrases.filter(p => p.frequency >= this.config.frequencyThresholds.veryCommon).length,
        commonPhrases: commonPhrases.filter(p =>
          p.frequency >= this.config.frequencyThresholds.common &&
          p.frequency < this.config.frequencyThresholds.veryCommon
        ).length,
        somewhatCommonPhrases: commonPhrases.filter(p =>
          p.frequency >= this.config.frequencyThresholds.somewhatCommon &&
          p.frequency < this.config.frequencyThresholds.common
        ).length,
        processingTimeMs,
        timestamp: new Date()
      };

      console.log('[PhraseAnalytics] Job completed:', result);
      return result;
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Analytics job failed: ${error.message}`,
        'ANALYTICS_JOB_ERROR'
      );
    }
  }

  // ==========================================================================
  // N-GRAM EXTRACTION
  // ==========================================================================

  /**
   * Extract n-grams from all posts in the database
   */
  private async extractNGramsFromAllPosts(
    lookbackDays: number,
    batchSize: number
  ): Promise<Map<string, number>> {
    const nGramCounts = new Map<string, number>();
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Fetch batch of posts
      const posts = await this.fetchPostBatch(lookbackDays, batchSize, offset);

      if (posts.length === 0) {
        hasMore = false;
        break;
      }

      // Extract n-grams from this batch
      const batchCounts = await this.textAnalysisService.extractNGramsFromPosts(posts);

      // Merge with overall counts
      for (const [gram, count] of batchCounts.entries()) {
        nGramCounts.set(gram, (nGramCounts.get(gram) || 0) + count);
      }

      offset += batchSize;
      console.log(`[PhraseAnalytics] Processed ${offset} posts...`);
    }

    return nGramCounts;
  }

  /**
   * Fetch a batch of posts from the database
   */
  private async fetchPostBatch(
    lookbackDays: number,
    limit: number,
    offset: number
  ): Promise<Array<{ id: string; text: string }>> {
    const query = `
      SELECT id, content as text
      FROM posts
      WHERE created_at >= NOW() - INTERVAL '${lookbackDays} days'
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get total post count for frequency calculation
   */
  private async getTotalPostCount(lookbackDays: number): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM posts
      WHERE created_at >= NOW() - INTERVAL '${lookbackDays} days'
    `;

    const result = await this.pool.query(query);
    return parseInt(result.rows[0].count);
  }

  // ==========================================================================
  // FREQUENCY CALCULATION
  // ==========================================================================

  /**
   * Calculate phrase frequencies
   */
  private calculateFrequencies(
    nGramCounts: Map<string, number>,
    totalPosts: number
  ): Array<{ phrase: string; count: number; frequency: number; nGramSize: number }> {
    const frequencies: Array<{
      phrase: string;
      count: number;
      frequency: number;
      nGramSize: number;
    }> = [];

    for (const [phrase, count] of nGramCounts.entries()) {
      const frequency = count / totalPosts;
      const nGramSize = phrase.split(' ').length;

      frequencies.push({
        phrase,
        count,
        frequency,
        nGramSize
      });
    }

    // Sort by frequency (highest first)
    frequencies.sort((a, b) => b.frequency - a.frequency);

    return frequencies;
  }

  // ==========================================================================
  // COMMON PHRASE IDENTIFICATION
  // ==========================================================================

  /**
   * Identify and categorize common phrases
   */
  private async identifyCommonPhrases(
    frequencies: Array<{ phrase: string; count: number; frequency: number; nGramSize: number }>
  ): Promise<CommonPhrase[]> {
    const commonPhrases: CommonPhrase[] = [];
    const now = new Date();

    for (const item of frequencies) {
      // Only keep phrases above threshold
      if (item.frequency < this.config.frequencyThresholds.somewhatCommon) {
        continue;
      }

      // Categorize the phrase
      const category = this.categorizePhrase(item.phrase);

      // Assign weight based on frequency
      const weight = this.calculateWeight(item.frequency);

      commonPhrases.push({
        phrase: item.phrase,
        frequency: item.frequency,
        category,
        weight,
        nGramSize: item.nGramSize,
        firstSeen: now, // Will be preserved if already exists
        lastUpdated: now,
        postCount: item.count
      });
    }

    return commonPhrases;
  }

  /**
   * Categorize a phrase based on patterns
   */
  private categorizePhrase(phrase: string): PhraseCategory {
    for (const [category, patterns] of Object.entries(this.CATEGORY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(phrase)) {
          return category as PhraseCategory;
        }
      }
    }

    return PhraseCategory.UNKNOWN;
  }

  /**
   * Calculate weight based on frequency
   */
  private calculateWeight(frequency: number): number {
    if (frequency >= this.config.frequencyThresholds.veryCommon) {
      return this.config.weights.veryCommon; // 0.05
    } else if (frequency >= this.config.frequencyThresholds.common) {
      return this.config.weights.common; // 0.2
    } else if (frequency >= this.config.frequencyThresholds.somewhatCommon) {
      return this.config.weights.somewhatCommon; // 0.5
    } else {
      return this.config.weights.unique; // 1.0
    }
  }

  // ==========================================================================
  // DATABASE UPDATES
  // ==========================================================================

  /**
   * Update common phrases in database
   */
  private async updateCommonPhrases(phrases: CommonPhrase[]): Promise<void> {
    await this.commonPhraseService.upsertCommonPhrases(phrases);
  }

  // ==========================================================================
  // MONITORING & REPORTING
  // ==========================================================================

  /**
   * Generate analytics report
   */
  async generateReport(result: AnalyticsJobResult): Promise<string> {
    const stats = await this.commonPhraseService.getDatabaseStats();

    const report = [
      '='.repeat(60),
      'PHRASE ANALYTICS JOB REPORT',
      '='.repeat(60),
      '',
      'Job Summary:',
      `- Timestamp: ${result.timestamp.toISOString()}`,
      `- Processing time: ${(result.processingTimeMs / 1000).toFixed(2)}s`,
      `- Total posts analyzed: ${result.totalPosts.toLocaleString()}`,
      '',
      'Phrase Statistics:',
      `- Total unique phrases: ${result.uniquePhrases.toLocaleString()}`,
      `- Very common (>10%): ${result.veryCommonPhrases}`,
      `- Common (5-10%): ${result.commonPhrases}`,
      `- Somewhat common (3-5%): ${result.somewhatCommonPhrases}`,
      '',
      'Database Statistics:',
      `- Total phrases in DB: ${stats.totalPhrases.toLocaleString()}`,
      `- Very common: ${stats.veryCommon}`,
      `- Common: ${stats.common}`,
      `- Somewhat common: ${stats.somewhatCommon}`,
      '',
      '='.repeat(60)
    ].join('\n');

    return report;
  }

  /**
   * Get top phrases by category
   */
  async getTopPhrasesByCategory(
    category: PhraseCategory,
    limit: number = 20
  ): Promise<CommonPhrase[]> {
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
      WHERE category = $1
      ORDER BY frequency DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [category, limit]);
    return result.rows;
  }

  /**
   * Get trending phrases (frequency increasing)
   */
  async getTrendingPhrases(limit: number = 20): Promise<CommonPhrase[]> {
    // This would require historical tracking
    // For now, return most recently updated
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
      WHERE last_updated >= NOW() - INTERVAL '7 days'
      ORDER BY frequency DESC
      LIMIT $1
    `;

    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  // ==========================================================================
  // SCHEDULING
  // ==========================================================================

  /**
   * Schedule the nightly job (to be called from cron or scheduler)
   */
  scheduleNightlyJob(cronTime: string = '0 2 * * *'): void {
    // This is a placeholder - implement with node-cron or similar
    console.log(`[PhraseAnalytics] Scheduled to run at ${cronTime}`);

    // Example with node-cron:
    // cron.schedule(cronTime, async () => {
    //   try {
    //     const result = await this.runAnalyticsJob();
    //     const report = await this.generateReport(result);
    //     console.log(report);
    //   } catch (error) {
    //     console.error('[PhraseAnalytics] Job failed:', error);
    //   }
    // });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
