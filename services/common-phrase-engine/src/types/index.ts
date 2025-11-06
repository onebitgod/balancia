/**
 * Shared types and interfaces for Common Phrase Filtering Engine
 */

// ============================================================================
// COMMON PHRASE TYPES
// ============================================================================

export interface CommonPhrase {
  phrase: string;
  frequency: number;
  category: PhraseCategory;
  weight: number;
  nGramSize: number;
  firstSeen: Date;
  lastUpdated: Date;
  postCount: number;
}

export enum PhraseCategory {
  GREETING = 'greeting',
  COURTESY = 'courtesy',
  REACTION = 'reaction',
  TEMPORAL = 'temporal',
  FILLER = 'filler',
  PLATFORM = 'platform',
  UNKNOWN = 'unknown'
}

export interface CommonPhraseCache {
  [phrase: string]: {
    weight: number;
    category: PhraseCategory;
  };
}

// ============================================================================
// POST ANALYSIS TYPES
// ============================================================================

export interface PostAnalysis {
  postId: string;
  originalText: string;
  commonPhrasesFound: string[];
  commonPhraseRatio: number;
  substantiveWordCount: number;
  totalWordCount: number;
  hasQuotes: boolean;
  quoteRatio: number;
  isRetweet: boolean;
  isNews: boolean;
}

export interface TextWithWeights {
  fullText: string;
  maskedText: string;
  attentionMask: number[];
  tokens: string[];
}

// ============================================================================
// EMBEDDING TYPES
// ============================================================================

export interface PostEmbeddings {
  postId: string;
  embeddingFull: number[];
  embeddingMasked: number[];
  embeddingWeighted: number[];
  metadata: PostMetadata;
}

export interface PostMetadata {
  postId: string;
  commonPhrasesFound: string[];
  commonPhraseRatio: number;
  substantiveWordCount: number;
  totalWordCount: number;
  hasQuotes: boolean;
  quoteRatio: number;
  isRetweet: boolean;
  isNews: boolean;
  timestamp: Date;
  originalText: string;
}

// ============================================================================
// SIMILARITY TYPES
// ============================================================================

export enum SimilarityMethod {
  WEIGHTED_ONLY = 'weighted_only',
  MASKED_ONLY = 'masked_only',
  DUAL_CHECK = 'dual_check',
  SKIP = 'skip'
}

export interface SimilarityDecision {
  method: SimilarityMethod;
  reason: string;
}

export interface SimilarityResult {
  weightedSimilarity?: number;
  maskedSimilarity?: number;
  finalSimilarity: number;
  methodUsed: SimilarityMethod;
  reason: string;
  similarPosts: SimilarPost[];
}

export interface SimilarPost {
  postId: string;
  similarity: number;
  text: string;
  timestamp: Date;
}

export interface OriginalityResult {
  originalityScore: number;
  methodUsed: SimilarityMethod;
  commonPhrasesDetected: string[];
  substantiveContent: string;
  similarPosts: SimilarPost[];
  metadata: {
    commonPhraseRatio: number;
    substantiveWordCount: number;
    processingTimeMs: number;
  };
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

export interface NGram {
  gram: string;
  count: number;
  size: number;
}

export interface PhraseFrequency {
  phrase: string;
  count: number;
  frequency: number;
  nGramSize: number;
}

export interface AnalyticsJobResult {
  totalPosts: number;
  uniquePhrases: number;
  veryCommonPhrases: number;
  commonPhrases: number;
  somewhatCommonPhrases: number;
  processingTimeMs: number;
  timestamp: Date;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface CommonPhraseConfig {
  frequencyThresholds: {
    veryCommon: number; // 0.10 = 10%
    common: number; // 0.05 = 5%
    somewhatCommon: number; // 0.03 = 3%
  };
  weights: {
    veryCommon: number; // 0.05
    common: number; // 0.2
    somewhatCommon: number; // 0.5
    unique: number; // 1.0
  };
  nGramSizes: number[]; // [1, 2, 3, 4, 5]
  minSubstantiveWords: number; // 5
  commonPhraseRatioThresholds: {
    low: number; // 0.2
    high: number; // 0.5
  };
  similarityDifferenceThreshold: number; // 0.15
}

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collections: {
    weighted: string;
    masked: string;
    full: string;
  };
  vectorSize: number;
  searchLimit: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  ttl: number; // 24 hours in seconds
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class CommonPhraseEngineError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'CommonPhraseEngineError';
  }
}
