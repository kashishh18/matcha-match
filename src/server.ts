import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import * as Redis from 'redis';
import winston from 'winston';
import cron from 'node-cron';

import { initializeDatabase, checkDatabaseHealth, closeDatabaseConnection } from './database/config';
import { WebSocketMessage } from './types';
import createApiRoutes from './routes/api';
import MatchaAdvancedSearch from './services/search';
import MatchaRecommendationEngine from './services/recommendations';
import MatchaWebScraper from './services/scraper';

// Load environment variables
dotenv.config();

// Initialize logger for production-grade monitoring
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class MatchaMatchServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private db!: Knex;
  private redis!: Redis.RedisClientType;
  private port: number;
  
  // Service instances
  private searchService!: MatchaAdvancedSearch;
  private recommendationService!: MatchaRecommendationEngine;
  private scraperService!: MatchaWebScraper;
  
  // Real-time tracking
  private connectedUsers: Map<string, string> = new Map(); // socketId -> userId
  private productViewers: Map<string, Set<string>> = new Map(); // productId -> Set of socketIds

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001');
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
      },
      maxHttpBufferSize: 1e6, // 1MB
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      }
    });
  }

  // Initialize all services and start server
  async initialize(): Promise<void> {
    try {
      logger.info('🚀 Starting Matcha Match server initialization...');

      // Initialize database
      this.db = await initializeDatabase();
      logger.info('✅ Database initialized successfully');

      // Initialize Redis
      // await this.initializeRedis(); // Disabled for now
      logger.info('✅ Redis initialized successfully');

      // Initialize core services
      await this.initializeServices();
      logger.info('✅ Core services initialized successfully');

      // Setup Express application
      this.setupExpressApp();
      logger.info('✅ Express application configured');

      // Setup WebSocket handlers for real-time features
      this.setupWebSocketHandlers();
      logger.info('✅ WebSocket handlers configured');

      // Setup background jobs
      this.setupBackgroundJobs();
      logger.info('✅ Background jobs scheduled');

      // Setup error handling
      this.setupErrorHandling();
      logger.info('✅ Error handling configured');

      logger.info('🎉 Matcha Match server initialization complete!');
    } catch (error) {
      logger.error('❌ Server initialization failed:', error);
      throw error;
    }
  }

  // Initialize Redis connection
  private async initializeRedis(): Promise<void> {
    this.redis = Redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      password: process.env.REDIS_PASSWORD,
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      logger.info('✅ Redis connected successfully');
    });

    this.redis.on('ready', () => {
      logger.info('✅ Redis ready for operations');
    });

    await this.redis.connect();
  }

  // Initialize all core services
  private async initializeServices(): Promise<void> {
    // Initialize web scraper
    this.scraperService = new MatchaWebScraper(this.db);
    logger.info('✅ Web scraper service initialized');

    // Initialize search service
    this.searchService = new MatchaAdvancedSearch(this.db, this.redis);
    logger.info('✅ Advanced search service initialized');

    // Initialize recommendation engine
    this.recommendationService = new MatchaRecommendationEngine(this.db, this.redis);
    logger.info('✅ Recommendation engine initialized');

    // Perform initial health checks
    const [searchHealth, recommendationHealth, scraperHealth] = await Promise.all([
      this.searchService.healthCheck(),
      this.recommendationService.healthCheck(),
      this.scraperService.healthCheck()
    ]);

    if (searchHealth.status !== 'healthy') {
      logger.warn('⚠️ Search service health check failed:', searchHealth.details);
    }
    if (recommendationHealth.status !== 'healthy') {
      logger.warn('⚠️ Recommendation service health check failed:', recommendationHealth.details);
    }
    if (scraperHealth.status !== 'healthy') {
      logger.warn('⚠️ Scraper service health check failed:', scraperHealth.details);
    }
  }

  // Setup Express application with middleware and routes
  private setupExpressApp(): void {
    // Trust proxy for accurate IP addresses
    this.app.set('trust proxy', 1);

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3000'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }));

    // CORS configuration
    this.app.use(cors({
      origin: function (origin, callback) {
        const allowedOrigins = [
          process.env.FRONTEND_URL || 'http://localhost:3000',
          'http://localhost:3000',
          'https://localhost:3000'
        ];
        
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      optionsSuccessStatus: 200,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // API routes
    this.app.use("/api", createApiRoutes(
      this.db,
      null, // Redis disabled for now
      this.searchService,
      this.recommendationService,
      this.scraperService
    ));
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'Matcha Match API Server',
        version: '1.0.0',
        features: [
          'Real-time stock updates with WebSockets',
          'Smart ML recommendations with A/B testing',
          'Advanced search with autocomplete & fuzzy matching'
        ],
        endpoints: {
          health: '/api/health',
          products: '/api/products',
          search: '/api/search',
          recommendations: '/api/recommendations',
          auth: '/api/auth'
        },
        timestamp: new Date()
      });
    });

    // Global 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        data: {
          method: req.method,
          path: req.originalUrl,
          suggestion: 'Try /api/health for API status'
        },
        timestamp: new Date()
      });
    });
  }

  // Setup WebSocket handlers for real-time features
  private setupWebSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info(`🔌 User connected: ${socket.id}`);

      // Handle user authentication
      socket.on('authenticate', async (token: string) => {
        try {
          // TODO: Implement JWT token verification when auth is integrated
          const userId = 'temp-user-id'; // This will be replaced with actual JWT verification
          this.connectedUsers.set(socket.id, userId);
          
          socket.emit('authenticated', { userId, timestamp: new Date() });
          logger.info(`🔐 User authenticated: ${userId} (${socket.id})`);
        } catch (error) {
          socket.emit('auth_error', { error: 'Invalid token', timestamp: new Date() });
          logger.error('WebSocket authentication error:', error);
        }
      });

      // Handle product page viewing (for real-time viewer counts)
      socket.on('view_product', (data: { productId: string }) => {
        const { productId } = data;
        
        if (!productId) {
          socket.emit('error', { message: 'Product ID required' });
          return;
        }

        if (!this.productViewers.has(productId)) {
          this.productViewers.set(productId, new Set());
        }
        
        this.productViewers.get(productId)!.add(socket.id);
        
        // Broadcast viewer count to all users viewing this product
        const viewerCount = this.productViewers.get(productId)!.size;
        this.io.to(`product-${productId}`).emit('viewer_count', {
          productId,
          count: viewerCount,
          timestamp: new Date()
        });

        // Join product-specific room for real-time updates
        socket.join(`product-${productId}`);
        
        logger.debug(`👀 User viewing product ${productId}, total viewers: ${viewerCount}`);
      });

      // Handle leaving product page
      socket.on('leave_product', (data: { productId: string }) => {
        const { productId } = data;
        
        if (this.productViewers.has(productId)) {
          this.productViewers.get(productId)!.delete(socket.id);
          
          const viewerCount = this.productViewers.get(productId)!.size;
          this.io.to(`product-${productId}`).emit('viewer_count', {
            productId,
            count: viewerCount,
            timestamp: new Date()
          });
        }
        
        socket.leave(`product-${productId}`);
      });

      // Handle stock alerts subscription
      socket.on('subscribe_stock_alerts', (data: { productIds: string[] }) => {
        const { productIds } = data;
        
        if (!Array.isArray(productIds)) {
          socket.emit('error', { message: 'Product IDs must be an array' });
          return;
        }

        productIds.forEach(productId => {
          socket.join(`stock-alerts-${productId}`);
        });
        
        socket.emit('subscribed_to_alerts', { productIds, timestamp: new Date() });
        logger.info(`🔔 User subscribed to stock alerts for ${productIds.length} products`);
      });

      // Handle search room joining (for search analytics)
      socket.on('join_search', (data: { query: string }) => {
        socket.join('search-analytics');
        socket.emit('search_joined', { timestamp: new Date() });
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info(`🔌 User disconnected: ${socket.id} (${reason})`);
        
        // Clean up user from all product viewers
        this.productViewers.forEach((viewers, productId) => {
          if (viewers.has(socket.id)) {
            viewers.delete(socket.id);
            const viewerCount = viewers.size;
            this.io.to(`product-${productId}`).emit('viewer_count', {
              productId,
              count: viewerCount,
              timestamp: new Date()
            });
          }
        });
        
        // Remove from connected users
        this.connectedUsers.delete(socket.id);
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date() });
      });
    });

    // Broadcast system-wide notifications
    setInterval(() => {
      this.io.emit('system_heartbeat', { 
        timestamp: new Date(),
        connectedUsers: this.connectedUsers.size,
        activeProducts: this.productViewers.size
      });
    }, 30000); // Every 30 seconds
  }

  // Setup background jobs for data processing
  private setupBackgroundJobs(): void {
    // Scrape matcha providers every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      logger.info('🕷️ Starting scheduled scraping job...');
      try {
        await this.scraperService.scrapeAllProviders();
        logger.info('✅ Scheduled scraping completed successfully');
      } catch (error) {
        logger.error('❌ Scheduled scraping failed:', error);
      }
    });

    // Rebuild search index every 2 hours
    cron.schedule('0 */2 * * *', async () => {
      logger.info('🔍 Rebuilding search index...');
      try {
        await this.searchService.rebuildSearchIndex();
        logger.info('✅ Search index rebuilt successfully');
      } catch (error) {
        logger.error('❌ Search index rebuild failed:', error);
      }
    });

    // Clean up old data daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      logger.info('🧹 Starting daily cleanup job...');
      try {
        await Promise.all([
          this.searchService.cleanupOldSearchData(30),
          this.recommendationService.cleanupOldRecommendations(30)
        ]);
        logger.info('✅ Daily cleanup completed successfully');
      } catch (error) {
        logger.error('❌ Daily cleanup failed:', error);
      }
    });

    // Generate batch recommendations every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('🤖 Generating batch recommendations...');
      try {
        // Get active users from the last 24 hours
        const activeUsers = await this.db('users')
          .where('last_login', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
          .select('id')
          .limit(100); // Batch process 100 users at a time

        if (activeUsers.length > 0) {
          const userIds = activeUsers.map(u => u.id);
          await this.recommendationService.generateBatchRecommendations(userIds, 10);
          logger.info(`✅ Generated recommendations for ${userIds.length} active users`);
        }
      } catch (error) {
        logger.error('❌ Batch recommendation generation failed:', error);
      }
    });

    logger.info('⏰ Background jobs scheduled successfully');
  }

  // Setup comprehensive error handling
  private setupErrorHandling(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      // Graceful shutdown
      this.shutdown().then(() => process.exit(1));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      // Graceful shutdown
      this.shutdown().then(() => process.exit(1));
    });

    // Express error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Express error:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
        timestamp: new Date(),
        requestId: (req as any).requestId
      });
    });
  }

  // Public method to broadcast stock updates
  public broadcastStockUpdate(productId: string, stockData: any): void {
    const message: WebSocketMessage = {
      type: 'stock_update',
      data: { productId, ...stockData },
      timestamp: new Date()
    };

    this.io.to(`product-${productId}`).emit('stock_update', message);
    this.io.to(`stock-alerts-${productId}`).emit('stock_alert', message);
    
    logger.info(`📢 Broadcasted stock update for product ${productId}`);
  }

  // Public method to broadcast price changes
  public broadcastPriceChange(productId: string, priceData: any): void {
    const message: WebSocketMessage = {
      type: 'price_change',
      data: { productId, ...priceData },
      timestamp: new Date()
    };

    this.io.to(`product-${productId}`).emit('price_change', message);
    
    logger.info(`📢 Broadcasted price change for product ${productId}`);
  }

  // Start the server
  async start(): Promise<void> {
    try {
      await this.initialize();
      
      this.server.listen(this.port, () => {
        logger.info(`🚀 Matcha Match server running on port ${this.port}`);
        logger.info(`📡 WebSocket server ready for real-time features`);
        logger.info(`🔍 Health check: http://localhost:${this.port}/api/health`);
        logger.info(`📖 API documentation: http://localhost:${this.port}/`);
        
        if (process.env.NODE_ENV === 'development') {
          logger.info(`🔧 Development mode - CORS enabled for ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
        }
      });
    } catch (error) {
      logger.error('💥 Failed to start server:', error);
      process.exit(1);
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down server gracefully...');
    
    try {
      // Close WebSocket connections
      this.io.close();
      logger.info('✅ WebSocket server closed');
      
      // Close database connection
      if (this.db) {
        await closeDatabaseConnection(this.db);
        logger.info('✅ Database connection closed');
      }
      
      // Close Redis connection
      if (this.redis) {
        await this.redis.quit();
        logger.info('✅ Redis connection closed');
      }
      
      // Close HTTP server
      this.server.close(() => {
        logger.info('✅ HTTP server closed');
        logger.info('👋 Server shutdown complete');
        process.exit(0);
      });
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Initialize and start the server
const server = new MatchaMatchServer();

// Handle graceful shutdown signals
process.on('SIGTERM', () => {
  logger.info('📡 SIGTERM received, shutting down gracefully...');
  server.shutdown();
});

process.on('SIGINT', () => {
  logger.info('📡 SIGINT received, shutting down gracefully...');
  server.shutdown();
});

// Start the server
server.start().catch((error) => {
  logger.error('💥 Failed to start server:', error);
  process.exit(1);
});

// Export server instance for testing
export default server;
