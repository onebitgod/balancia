/**
 * Text Analysis Service
 * Handles n-gram extraction, common phrase detection, and text preprocessing
 */

import {
  PostAnalysis,
  TextWithWeights,
  CommonPhraseConfig,
  CommonPhraseEngineError,
  PhraseCategory
} from '../types';
import { CommonPhraseService } from './common-phrase.service';

export class TextAnalysisService {
  private config: CommonPhraseConfig;
  private commonPhraseService: CommonPhraseService;

  // Common patterns for detection
  private readonly RETWEET_PATTERNS = /^(RT|via)\s+@|^RT\s*:/i;
  private readonly QUOTE_PATTERN = /["'"](.+?)["'"]/g;
  private readonly URL_PATTERN = /https?:\/\/[^\s]+/g;
  private readonly MENTION_PATTERN = /@\w+/g;
  private readonly HASHTAG_PATTERN = /#\w+/g;
  private readonly NEWS_KEYWORDS = ['breaking', 'announces', 'announces:', 'update:', 'alert:'];

  constructor(
    commonPhraseService: CommonPhraseService,
    config: CommonPhraseConfig
  ) {
    this.commonPhraseService = commonPhraseService;
    this.config = config;
  }

  // ==========================================================================
  // MAIN ANALYSIS PIPELINE
  // ==========================================================================

  /**
   * Analyze a post and return comprehensive analysis
   */
  async analyzePost(postId: string, text: string): Promise<PostAnalysis> {
    try {
      // Clean and normalize text
      const cleanedText = this.cleanText(text);

      // Detect special cases
      const isRetweet = this.isRetweet(text);
      const isNews = this.isNews(text);

      // Extract quotes
      const { textWithoutQuotes, quoteRatio } = this.extractQuotes(cleanedText);
      const hasQuotes = quoteRatio > 0;

      // Tokenize
      const tokens = this.tokenize(textWithoutQuotes);
      const totalWordCount = tokens.length;

      // Extract n-grams
      const nGrams = this.extractNGrams(tokens);

      // Detect common phrases
      const commonPhrasesFound = await this.detectCommonPhrases(nGrams);

      // Calculate common phrase ratio
      const commonPhraseWordCount = this.countCommonPhraseWords(commonPhrasesFound);
      const commonPhraseRatio = totalWordCount > 0 ? commonPhraseWordCount / totalWordCount : 0;

      // Calculate substantive word count
      const substantiveWordCount = totalWordCount - commonPhraseWordCount;

      return {
        postId,
        originalText: text,
        commonPhrasesFound,
        commonPhraseRatio,
        substantiveWordCount,
        totalWordCount,
        hasQuotes,
        quoteRatio,
        isRetweet,
        isNews
      };
    } catch (error) {
      throw new CommonPhraseEngineError(
        `Failed to analyze post: ${error.message}`,
        'ANALYSIS_ERROR'
      );
    }
  }

  /**
   * Generate text with weights for weighted embedding
   */
  async generateTextWithWeights(text: string): Promise<TextWithWeights> {
    const cleanedText = this.cleanText(text);
    const { textWithoutQuotes } = this.extractQuotes(cleanedText);
    const tokens = this.tokenize(textWithoutQuotes);
    const nGrams = this.extractNGrams(tokens);

    // Get weights for all n-grams
    const weights = await this.commonPhraseService.getPhraseWeights(nGrams);

    // Create attention mask (one weight per token)
    const attentionMask = await this.createAttentionMask(tokens, nGrams, weights);

    // Create masked text (remove common phrases)
    const maskedText = await this.createMaskedText(tokens, nGrams);

    return {
      fullText: textWithoutQuotes,
      maskedText,
      attentionMask,
      tokens
    };
  }

  // ==========================================================================
  // N-GRAM EXTRACTION
  // ==========================================================================

  /**
   * Extract all n-grams from tokens
   */
  extractNGrams(tokens: string[]): string[] {
    const nGrams: string[] = [];

    for (const size of this.config.nGramSizes) {
      for (let i = 0; i <= tokens.length - size; i++) {
        const gram = tokens.slice(i, i + size).join(' ');
        nGrams.push(gram);
      }
    }

    return nGrams;
  }

  /**
   * Extract n-grams of specific size
   */
  extractNGramsOfSize(tokens: string[], size: number): string[] {
    const nGrams: string[] = [];

    for (let i = 0; i <= tokens.length - size; i++) {
      const gram = tokens.slice(i, i + size).join(' ');
      nGrams.push(gram);
    }

    return nGrams;
  }

  // ==========================================================================
  // COMMON PHRASE DETECTION
  // ==========================================================================

  /**
   * Detect which n-grams are common phrases
   * Use greedy longest-match approach
   */
  async detectCommonPhrases(nGrams: string[]): Promise<string[]> {
    const commonPhrases: string[] = [];
    const cache = await this.commonPhraseService.getCommonPhrasesCache();

    // Sort by length (longest first) for greedy matching
    const sortedNGrams = [...nGrams].sort((a, b) => b.split(' ').length - a.split(' ').length);

    const matched = new Set<string>();

    for (const gram of sortedNGrams) {
      const normalized = gram.toLowerCase();

      // Skip if already part of a longer matched phrase
      const tokens = gram.split(' ');
      const isSubset = Array.from(matched).some(m => {
        const matchedTokens = m.split(' ');
        return this.isSubsequence(tokens, matchedTokens);
      });

      if (isSubset) continue;

      // Check if common phrase
      if (normalized in cache) {
        commonPhrases.push(gram);
        matched.add(gram);
      }
    }

    return commonPhrases;
  }

  /**
   * Check if array1 is a subsequence of array2
   */
  private isSubsequence(arr1: string[], arr2: string[]): boolean {
    const str1 = arr1.join(' ').toLowerCase();
    const str2 = arr2.join(' ').toLowerCase();
    return str2.includes(str1);
  }

  /**
   * Count total words in common phrases
   */
  private countCommonPhraseWords(phrases: string[]): number {
    let count = 0;
    for (const phrase of phrases) {
      count += phrase.split(' ').length;
    }
    return count;
  }

  // ==========================================================================
  // MASKED TEXT GENERATION
  // ==========================================================================

  /**
   * Create masked text by removing common phrases
   */
  async createMaskedText(tokens: string[], nGrams: string[]): Promise<string> {
    const commonPhrases = await this.detectCommonPhrases(nGrams);

    // Sort by position and length
    const phrasesWithPositions: Array<{ phrase: string; start: number; end: number }> = [];

    for (const phrase of commonPhrases) {
      const phraseTokens = phrase.split(' ');
      const phraseLength = phraseTokens.length;

      // Find all positions where this phrase occurs
      for (let i = 0; i <= tokens.length - phraseLength; i++) {
        const candidate = tokens.slice(i, i + phraseLength).join(' ');
        if (candidate.toLowerCase() === phrase.toLowerCase()) {
          phrasesWithPositions.push({
            phrase,
            start: i,
            end: i + phraseLength
          });
        }
      }
    }

    // Sort by start position
    phrasesWithPositions.sort((a, b) => a.start - b.start);

    // Remove common phrases (greedy, no overlap)
    const maskedTokens: string[] = [];
    let lastEnd = 0;

    for (const { start, end } of phrasesWithPositions) {
      // Skip overlapping phrases
      if (start < lastEnd) continue;

      // Add tokens before this phrase
      maskedTokens.push(...tokens.slice(lastEnd, start));

      // Skip the common phrase tokens
      lastEnd = end;
    }

    // Add remaining tokens
    maskedTokens.push(...tokens.slice(lastEnd));

    return maskedTokens.join(' ').trim();
  }

  /**
   * Create attention mask for weighted embeddings
   */
  async createAttentionMask(
    tokens: string[],
    nGrams: string[],
    weights: Map<string, number>
  ): Promise<number[]> {
    const attentionMask: number[] = new Array(tokens.length).fill(1.0);

    // For each token, find the longest matching n-gram that includes it
    // and assign that n-gram's weight
    for (let i = 0; i < tokens.length; i++) {
      let minWeight = 1.0;

      // Check n-grams that include this token (from longest to shortest)
      for (const size of [...this.config.nGramSizes].sort((a, b) => b - a)) {
        for (let start = Math.max(0, i - size + 1); start <= i; start++) {
          if (start + size > tokens.length) continue;

          const gram = tokens.slice(start, start + size).join(' ');
          const weight = weights.get(gram);

          if (weight !== undefined && weight < minWeight) {
            minWeight = weight;
            break; // Use longest match
          }
        }

        if (minWeight < 1.0) break; // Found a match
      }

      attentionMask[i] = minWeight;
    }

    return attentionMask;
  }

  // ==========================================================================
  // TEXT PREPROCESSING
  // ==========================================================================

  /**
   * Clean and normalize text
   */
  cleanText(text: string): string {
    // Remove URLs
    let cleaned = text.replace(this.URL_PATTERN, '');

    // Remove mentions (but keep the text readable)
    cleaned = cleaned.replace(this.MENTION_PATTERN, '');

    // Remove hashtags (but keep the text)
    cleaned = cleaned.replace(this.HASHTAG_PATTERN, (match) => match.substring(1));

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  /**
   * Tokenize text into words
   */
  tokenize(text: string): string[] {
    // Simple word tokenization (can be enhanced with NLP library)
    return text
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ') // Keep hyphens and apostrophes
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  /**
   * Extract quotes from text
   */
  extractQuotes(text: string): { textWithoutQuotes: string; quoteRatio: number } {
    const quotes: string[] = [];
    let textWithoutQuotes = text;

    // Find all quoted text
    let match;
    while ((match = this.QUOTE_PATTERN.exec(text)) !== null) {
      quotes.push(match[1]);
      textWithoutQuotes = textWithoutQuotes.replace(match[0], '');
    }

    // Calculate quote ratio
    const quotedChars = quotes.reduce((sum, q) => sum + q.length, 0);
    const totalChars = text.length;
    const quoteRatio = totalChars > 0 ? quotedChars / totalChars : 0;

    return {
      textWithoutQuotes: textWithoutQuotes.trim(),
      quoteRatio
    };
  }

  /**
   * Check if text is a retweet
   */
  isRetweet(text: string): boolean {
    return this.RETWEET_PATTERNS.test(text);
  }

  /**
   * Check if text is news-related
   */
  isNews(text: string): boolean {
    const lowerText = text.toLowerCase();
    return this.NEWS_KEYWORDS.some(keyword => lowerText.includes(keyword));
  }

  // ==========================================================================
  // BATCH OPERATIONS (for Analytics)
  // ==========================================================================

  /**
   * Extract n-grams from multiple posts (for analytics job)
   */
  async extractNGramsFromPosts(posts: Array<{ id: string; text: string }>): Promise<Map<string, number>> {
    const nGramCounts = new Map<string, number>();

    for (const post of posts) {
      const cleanedText = this.cleanText(post.text);
      const { textWithoutQuotes } = this.extractQuotes(cleanedText);
      const tokens = this.tokenize(textWithoutQuotes);
      const nGrams = this.extractNGrams(tokens);

      // Count unique n-grams per post (not total occurrences)
      const uniqueNGrams = new Set(nGrams.map(g => g.toLowerCase()));

      for (const gram of uniqueNGrams) {
        nGramCounts.set(gram, (nGramCounts.get(gram) || 0) + 1);
      }
    }

    return nGramCounts;
  }

  /**
   * Get substantive content (text without common phrases)
   */
  async getSubstantiveContent(text: string): Promise<string> {
    const cleanedText = this.cleanText(text);
    const { textWithoutQuotes } = this.extractQuotes(cleanedText);
    const tokens = this.tokenize(textWithoutQuotes);
    const nGrams = this.extractNGrams(tokens);

    return this.createMaskedText(tokens, nGrams);
  }
}
