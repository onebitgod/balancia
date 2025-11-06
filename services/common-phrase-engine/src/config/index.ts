/**
 * Configuration for Common Phrase Filtering Engine
 */

import {
  CommonPhraseConfig,
  QdrantConfig,
  RedisConfig,
  DatabaseConfig
} from '../types';

/**
 * Load configuration from environment variables with defaults
 */
export class Config {
  // ==========================================================================
  // COMMON PHRASE CONFIGURATION
  // ==========================================================================

  static commonPhrase: CommonPhraseConfig = {
    frequencyThresholds: {
      veryCommon: parseFloat(process.env.THRESHOLD_VERY_COMMON || '0.10'), // 10%
      common: parseFloat(process.env.THRESHOLD_COMMON || '0.05'), // 5%
      somewhatCommon: parseFloat(process.env.THRESHOLD_SOMEWHAT_COMMON || '0.03') // 3%
    },
    weights: {
      veryCommon: parseFloat(process.env.WEIGHT_VERY_COMMON || '0.05'),
      common: parseFloat(process.env.WEIGHT_COMMON || '0.2'),
      somewhatCommon: parseFloat(process.env.WEIGHT_SOMEWHAT_COMMON || '0.5'),
      unique: parseFloat(process.env.WEIGHT_UNIQUE || '1.0')
    },
    nGramSizes: [1, 2, 3, 4, 5],
    minSubstantiveWords: parseInt(process.env.MIN_SUBSTANTIVE_WORDS || '5'),
    commonPhraseRatioThresholds: {
      low: parseFloat(process.env.RATIO_THRESHOLD_LOW || '0.2'), // 20%
      high: parseFloat(process.env.RATIO_THRESHOLD_HIGH || '0.5') // 50%
    },
    similarityDifferenceThreshold: parseFloat(process.env.SIMILARITY_DIFF_THRESHOLD || '0.15') // 15%
  };

  // ==========================================================================
  // DATABASE CONFIGURATION
  // ==========================================================================

  static database: DatabaseConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'balancia',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true'
  };

  // ==========================================================================
  // REDIS CONFIGURATION
  // ==========================================================================

  static redis: RedisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'cpe:',
    ttl: parseInt(process.env.REDIS_TTL || '86400') // 24 hours
  };

  // ==========================================================================
  // QDRANT CONFIGURATION
  // ==========================================================================

  static qdrant: QdrantConfig = {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collections: {
      weighted: process.env.QDRANT_COLLECTION_WEIGHTED || 'posts_weighted',
      masked: process.env.QDRANT_COLLECTION_MASKED || 'posts_masked',
      full: process.env.QDRANT_COLLECTION_FULL || 'posts_full'
    },
    vectorSize: parseInt(process.env.VECTOR_SIZE || '1536'), // OpenAI ada-002 default
    searchLimit: parseInt(process.env.SEARCH_LIMIT || '10')
  };

  // ==========================================================================
  // EMBEDDING MODEL CONFIGURATION
  // ==========================================================================

  static embedding = {
    apiUrl: process.env.EMBEDDING_API_URL || 'https://api.openai.com/v1',
    apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
    model: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
    timeout: parseInt(process.env.EMBEDDING_TIMEOUT || '30000') // 30 seconds
  };

  // ==========================================================================
  // ANALYTICS JOB CONFIGURATION
  // ==========================================================================

  static analytics = {
    scheduleTime: process.env.ANALYTICS_SCHEDULE_TIME || '0 2 * * *', // 2 AM daily
    lookbackDays: parseInt(process.env.ANALYTICS_LOOKBACK_DAYS || '30'),
    batchSize: parseInt(process.env.ANALYTICS_BATCH_SIZE || '10000')
  };

  // ==========================================================================
  // SERVER CONFIGURATION
  // ==========================================================================

  static server = {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  };

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validate configuration
   */
  static validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate frequency thresholds
    if (this.commonPhrase.frequencyThresholds.veryCommon <= this.commonPhrase.frequencyThresholds.common) {
      errors.push('veryCommon threshold must be greater than common threshold');
    }

    if (this.commonPhrase.frequencyThresholds.common <= this.commonPhrase.frequencyThresholds.somewhatCommon) {
      errors.push('common threshold must be greater than somewhatCommon threshold');
    }

    // Validate weights
    if (this.commonPhrase.weights.veryCommon >= this.commonPhrase.weights.common) {
      errors.push('veryCommon weight must be less than common weight');
    }

    // Validate database config
    if (!this.database.host || !this.database.database || !this.database.user) {
      errors.push('Database configuration is incomplete');
    }

    // Validate Redis config
    if (!this.redis.host) {
      errors.push('Redis host is required');
    }

    // Validate Qdrant config
    if (!this.qdrant.url) {
      errors.push('Qdrant URL is required');
    }

    // Validate embedding config
    if (!this.embedding.apiKey) {
      errors.push('Embedding API key is required');
    }

    // Validate vector size matches
    if (this.qdrant.vectorSize !== this.embedding.dimensions) {
      errors.push('Qdrant vector size must match embedding dimensions');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Print configuration summary
   */
  static summary(): string {
    return `
Common Phrase Filtering Engine Configuration
=============================================

Environment: ${this.server.environment}

Common Phrase Thresholds:
  - Very Common: ${(this.commonPhrase.frequencyThresholds.veryCommon * 100).toFixed(1)}%
  - Common: ${(this.commonPhrase.frequencyThresholds.common * 100).toFixed(1)}%
  - Somewhat Common: ${(this.commonPhrase.frequencyThresholds.somewhatCommon * 100).toFixed(1)}%

Weights:
  - Very Common: ${this.commonPhrase.weights.veryCommon}
  - Common: ${this.commonPhrase.weights.common}
  - Somewhat Common: ${this.commonPhrase.weights.somewhatCommon}
  - Unique: ${this.commonPhrase.weights.unique}

Database:
  - Host: ${this.database.host}:${this.database.port}
  - Database: ${this.database.database}
  - SSL: ${this.database.ssl}

Redis:
  - Host: ${this.redis.host}:${this.redis.port}
  - Key Prefix: ${this.redis.keyPrefix}
  - TTL: ${this.redis.ttl}s

Qdrant:
  - URL: ${this.qdrant.url}
  - Collections: ${Object.values(this.qdrant.collections).join(', ')}
  - Vector Size: ${this.qdrant.vectorSize}

Embedding Model:
  - Model: ${this.embedding.model}
  - Dimensions: ${this.embedding.dimensions}
  - API URL: ${this.embedding.apiUrl}

Analytics:
  - Schedule: ${this.analytics.scheduleTime}
  - Lookback Days: ${this.analytics.lookbackDays}
  - Batch Size: ${this.analytics.batchSize}

Server:
  - Port: ${this.server.port}
  - Host: ${this.server.host}
  - Log Level: ${this.server.logLevel}
`;
  }
}

// Validate configuration on load
const validation = Config.validate();
if (!validation.valid) {
  console.error('Configuration validation failed:');
  validation.errors.forEach(error => console.error(`  - ${error}`));

  if (Config.server.environment === 'production') {
    throw new Error('Invalid configuration in production environment');
  } else {
    console.warn('Continuing with invalid configuration (development mode)');
  }
}
