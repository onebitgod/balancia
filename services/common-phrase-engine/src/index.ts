/**
 * Common Phrase Filtering Engine - Main Entry Point
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as cron from 'node-cron';
import { Config } from './config';
import { CommonPhraseService } from './services/common-phrase.service';
import { TextAnalysisService } from './services/text-analysis.service';
import { EmbeddingService } from './services/embedding.service';
import { QdrantService } from './services/qdrant.service';
import { SimilarityService } from './services/similarity.service';
import { PhraseAnalyticsService } from './services/phrase-analytics.service';
import { OriginalityService } from './services/originality.service';
import { CommonPhraseEngineError } from './types';

// ==========================================================================
// INITIALIZE SERVICES
// ==========================================================================

let commonPhraseService: CommonPhraseService;
let textAnalysisService: TextAnalysisService;
let embeddingService: EmbeddingService;
let qdrantService: QdrantService;
let similarityService: SimilarityService;
let phraseAnalyticsService: PhraseAnalyticsService;
let originalityService: OriginalityService;

async function initializeServices() {
  console.log('Initializing Common Phrase Filtering Engine...');
  console.log(Config.summary());

  // Initialize services in order
  commonPhraseService = new CommonPhraseService(
    Config.database,
    Config.redis,
    Config.commonPhrase
  );
  await commonPhraseService.initialize();

  textAnalysisService = new TextAnalysisService(
    commonPhraseService,
    Config.commonPhrase
  );

  embeddingService = new EmbeddingService(
    textAnalysisService,
    Config.embedding
  );

  qdrantService = new QdrantService(Config.qdrant);
  await qdrantService.initialize();

  similarityService = new SimilarityService(
    qdrantService,
    Config.commonPhrase
  );

  phraseAnalyticsService = new PhraseAnalyticsService(
    Config.database,
    textAnalysisService,
    commonPhraseService,
    Config.commonPhrase
  );

  originalityService = new OriginalityService(
    textAnalysisService,
    embeddingService,
    qdrantService,
    similarityService
  );

  console.log('✅ All services initialized successfully');
}

// ==========================================================================
// EXPRESS APP
// ==========================================================================

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ==========================================================================
// ROUTES
// ==========================================================================

/**
 * Health check
 */
app.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await originalityService.healthCheck();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

/**
 * Check originality of a post
 */
app.post('/api/check-originality', async (req: Request, res: Response) => {
  try {
    const { postId, text, store = true } = req.body;

    if (!postId || !text) {
      return res.status(400).json({
        error: 'Missing required fields: postId, text'
      });
    }

    const result = await originalityService.checkOriginality(postId, text, store);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Store a post without checking originality
 */
app.post('/api/store-post', async (req: Request, res: Response) => {
  try {
    const { postId, text, timestamp } = req.body;

    if (!postId || !text) {
      return res.status(400).json({
        error: 'Missing required fields: postId, text'
      });
    }

    await originalityService.storePost(
      postId,
      text,
      timestamp ? new Date(timestamp) : undefined
    );

    res.json({
      success: true,
      message: `Post ${postId} stored successfully`
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Batch store posts
 */
app.post('/api/batch-store', async (req: Request, res: Response) => {
  try {
    const { posts } = req.body;

    if (!Array.isArray(posts)) {
      return res.status(400).json({
        error: 'posts must be an array'
      });
    }

    await originalityService.storeBatchPosts(posts);

    res.json({
      success: true,
      message: `${posts.length} posts stored successfully`
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Delete a post
 */
app.delete('/api/posts/:postId', async (req: Request, res: Response) => {
  try {
    const { postId } = req.params;

    await originalityService.deletePost(postId);

    res.json({
      success: true,
      message: `Post ${postId} deleted successfully`
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Analyze a post (without storing)
 */
app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        error: 'Missing required field: text'
      });
    }

    const result = await originalityService.analyzePost(text);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Compare two posts
 */
app.post('/api/compare', async (req: Request, res: Response) => {
  try {
    const { text1, text2 } = req.body;

    if (!text1 || !text2) {
      return res.status(400).json({
        error: 'Missing required fields: text1, text2'
      });
    }

    const result = await originalityService.comparePosts(text1, text2);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Get common phrases by category
 */
app.get('/api/common-phrases/:category', async (req: Request, res: Response) => {
  try {
    const { category } = req.params;

    const phrases = await commonPhraseService.getPhrasesByCategory(category as any);

    res.json({
      success: true,
      data: phrases
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Get all common phrases
 */
app.get('/api/common-phrases', async (req: Request, res: Response) => {
  try {
    const phrases = await commonPhraseService.getAllCommonPhrases();

    res.json({
      success: true,
      data: phrases,
      count: phrases.length
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Get cache statistics
 */
app.get('/api/stats/cache', async (req: Request, res: Response) => {
  try {
    const stats = await commonPhraseService.getCacheStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Get database statistics
 */
app.get('/api/stats/database', async (req: Request, res: Response) => {
  try {
    const stats = await commonPhraseService.getDatabaseStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Get Qdrant collection statistics
 */
app.get('/api/stats/collections', async (req: Request, res: Response) => {
  try {
    const stats = await qdrantService.getAllCollectionStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Run analytics job manually
 */
app.post('/api/analytics/run', async (req: Request, res: Response) => {
  try {
    const { lookbackDays, batchSize } = req.body;

    const result = await phraseAnalyticsService.runAnalyticsJob(
      lookbackDays || Config.analytics.lookbackDays,
      batchSize || Config.analytics.batchSize
    );

    const report = await phraseAnalyticsService.generateReport(result);

    res.json({
      success: true,
      data: result,
      report
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Get top phrases by category
 */
app.get('/api/analytics/top/:category', async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    const { limit = 20 } = req.query;

    const phrases = await phraseAnalyticsService.getTopPhrasesByCategory(
      category as any,
      parseInt(limit as string)
    );

    res.json({
      success: true,
      data: phrases
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Refresh cache
 */
app.post('/api/cache/refresh', async (req: Request, res: Response) => {
  try {
    await commonPhraseService.refreshCacheFromDatabase();

    res.json({
      success: true,
      message: 'Cache refreshed successfully'
    });
  } catch (error) {
    handleError(error, res);
  }
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  handleError(err, res);
});

// ==========================================================================
// ERROR HANDLING
// ==========================================================================

function handleError(error: any, res: Response) {
  if (error instanceof CommonPhraseEngineError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code
    });
  } else {
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

// ==========================================================================
// SCHEDULED JOBS
// ==========================================================================

function scheduleAnalyticsJob() {
  console.log(`Scheduling analytics job: ${Config.analytics.scheduleTime}`);

  cron.schedule(Config.analytics.scheduleTime, async () => {
    try {
      console.log('Starting scheduled analytics job...');

      const result = await phraseAnalyticsService.runAnalyticsJob(
        Config.analytics.lookbackDays,
        Config.analytics.batchSize
      );

      const report = await phraseAnalyticsService.generateReport(result);
      console.log(report);

      console.log('✅ Analytics job completed successfully');
    } catch (error) {
      console.error('❌ Analytics job failed:', error);
    }
  });
}

// ==========================================================================
// STARTUP
// ==========================================================================

async function start() {
  try {
    // Initialize all services
    await initializeServices();

    // Schedule nightly analytics job
    if (Config.server.environment !== 'test') {
      scheduleAnalyticsJob();
    }

    // Start server
    app.listen(Config.server.port, Config.server.host, () => {
      console.log('='.repeat(60));
      console.log(`🚀 Common Phrase Filtering Engine started`);
      console.log(`   Server: http://${Config.server.host}:${Config.server.port}`);
      console.log(`   Environment: ${Config.server.environment}`);
      console.log(`   Analytics Schedule: ${Config.analytics.scheduleTime}`);
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// ==========================================================================
// GRACEFUL SHUTDOWN
// ==========================================================================

async function shutdown() {
  console.log('\nShutting down gracefully...');

  try {
    if (commonPhraseService) {
      await commonPhraseService.close();
    }

    if (phraseAnalyticsService) {
      await phraseAnalyticsService.close();
    }

    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
if (require.main === module) {
  start();
}

export { app, originalityService };
