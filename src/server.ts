import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import Redis from 'redis';
import winston from 'winston';

import { initializeDatabase, checkDatabaseHealth, closeDatabaseConnection } from '@/database/config';
import { WebSocketMessage, ApiResponse } from '@/types';

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
      format: winston.format.simple()
    })
  ]
});

class MatchaMatchServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private db: Knex;
  private redis: Redis.RedisClientType;
  private port: number;
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

  // Initialize all services
  async initialize(): Promise<void> {
    try {
      // Initialize database
      this.db = await initializeDatabase();
      logger.info('Database initialized successfully');

      // Initialize Redis for caching and real-time features
      await this.initializeRedis();
      logger.info('Redis initialized successfully');

      // Setup Express middleware
      this.setupMiddleware();
      logger.info('Express middleware configured');

      // Setup API routes
      this.setupRoutes();
      logger.info('API routes configured');

      // Setup WebSocket handlers for real-time features
      this.setupWebSocketHandlers();
      logger.info('WebSocket handlers configured');

      // Setup error handling
      this.setupErrorHandling();
      logger.info('Error handling configured');

      logger.info('🚀 Matcha Match server initialization complete');
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
      retryDelayOnFailover: 100,
      enableAutoPipelining: true,
      maxRetriesPerRequest: 3,
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      logger.info('✅ Redis connected successfully');
    });

    await this.redis.connect();
  }

  // Setup Express middleware for security and performance
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
      optionsSuccessStatus: 200,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.info(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
        });
        next();
      });
    }

    // Add request ID for tracking
    this.app.use((req, res, next) => {
      req.requestId = Math.random().toString(36).substring(2, 15);
      res.setHeader('X-Request-ID', req.requestId);
      next();
    });
  }

  // Setup API routes
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      const dbHealthy = await checkDatabaseHealth(this.db);
      const redisHealthy = await this.checkRedisHealth();
      
      const health = {
        status: dbHealthy && redisHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealthy ? 'up' : 'down',
          redis: redisHealthy ? 'up' : 'down',
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };

      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    });

    // API version endpoint
    this.app.get('/api/version', (req, res) => {
      res.json({
        version: '1.0.0',
        features: [
          'Real-time stock updates',
          'Smart recommendations with A/B testing',
          'Advanced search with autocomplete'
        ],
        timestamp: new Date().toISOString()
      });
    });

    // Placeholder for future API routes
    this.app.use('/api/auth', (req, res) => {
      res.json({ message: 'Auth routes will be implemented next' });
    });

    this.app.use('/api/products', (req, res) => {
      res.json({ message: 'Product routes will be implemented next' });
    });

    this.app.use('/api/recommendations', (req, res) => {
      res.json({ message: 'Recommendation routes will be implemented next' });
    });

    this.app.use('/api/search', (req, res) => {
      res.json({ message: 'Search routes will be implemented next' });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        timestamp: new Date().toISOString(),
        requestId: req.requestId
      });
    });
  }

  // Setup WebSocket handlers for real-time features
  private setupWebSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info(`User connected: ${socket.id}`);

      // Handle user authentication
      socket.on('authenticate', async (token: string) => {
        try {
          // TODO: Implement JWT token verification
          const userId = 'temp-user-id'; // This will be replaced with actual JWT verification
          this.connectedUsers.set(socket.id, userId);
          
          socket.emit('authenticated', { userId });
          logger.info(`User authenticated: ${userId}`);
        } catch (error) {
          socket.emit('auth_error', { error: 'Invalid token' });
          logger.error('Authentication error:', error);
        }
      });

      // Handle product page viewing (for real-time viewer counts)
      socket.on('view_product', (productId: string) => {
        if (!this.productViewers.has(productId)) {
          this.productViewers.set(productId, new Set());
        }
        
        this.productViewers.get(productId)!.add(socket.id);
        
        // Broadcast viewer count to all users viewing this product
        const viewerCount = this.productViewers.get(productId)!.size;
        this.io.to(`product-${productId}`).emit('viewer_count', {
          productId,
          count: viewerCount
        });

        // Join product-specific room for real-time updates
        socket.join(`product-${productId}`);
        
        logger.info(`User viewing product ${productId}, total viewers: ${viewerCount}`);
      });

      // Handle leaving product page
      socket.on('leave_product', (productId: string) => {
        if (this.productViewers.has(productId)) {
          this.productViewers.get(productId)!.delete(socket.id);
          
          const viewerCount = this.productViewers.get(productId)!.size;
          this.io.to(`product-${productId}`).emit('viewer_count', {
            productId,
            count: viewerCount
          });
        }
        
        socket.leave(`product-${productId}`);
      });

      // Handle stock alerts subscription
      socket.on('subscribe_stock_alerts', (productIds: string[]) => {
        productIds.forEach(productId => {
          socket.join(`stock-alerts-${productId}`);
        });
        
        socket.emit('subscribed_to_alerts', { productIds });
        logger.info(`User subscribed to stock alerts for ${productIds.length} products`);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`User disconnected: ${socket.id}`);
        
        // Clean up user from all product viewers
        this.productViewers.forEach((viewers, productId) => {
          if (viewers.has(socket.id)) {
            viewers.delete(socket.id);
            const viewerCount = viewers.size;
            this.io.to(`product-${productId}`).emit('viewer_count', {
              productId,
              count: viewerCount
            });
          }
        });
        
        // Remove from connected users
        this.connectedUsers.delete(socket.id);
      });
    });
  }

  // Setup error handling
  private setupErrorHandling(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    // Express error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Express error:', error);
      
      const response: ApiResponse<null> = {
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
        timestamp: new Date(),
        requestId: req.requestId
      };
      
      res.status(500).json(response);
    });
  }

  // Check Redis health
  private async checkRedisHealth(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  // Broadcast stock update to all connected clients
  public broadcastStockUpdate(productId: string, stockData: any): void {
    const message: WebSocketMessage = {
      type: 'stock_update',
      data: { productId, ...stockData },
      timestamp: new Date()
    };

    this.io.to(`product-${productId}`).emit('stock_update', message);
    this.io.to(`stock-alerts-${productId}`).emit('stock_alert', message);
  }

  // Broadcast price change to all connected clients
  public broadcastPriceChange(productId: string, priceData: any): void {
    const message: WebSocketMessage = {
      type: 'price_change',
      data: { productId, ...priceData },
      timestamp: new Date()
    };

    this.io.to(`product-${productId}`).emit('price_change', message);
  }

  // Start the server
  async start(): Promise<void> {
    try {
      await this.initialize();
      
      this.server.listen(this.port, () => {
        logger.info(`🚀 Matcha Match server running on port ${this.port}`);
        logger.info(`📡 WebSocket server ready for real-time features`);
        logger.info(`🔍 Health check: http://localhost:${this.port}/health`);
      });
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down server gracefully...');
    
    try {
      // Close WebSocket connections
      this.io.close();
      
      // Close database connection
      await closeDatabaseConnection(this.db);
      
      // Close Redis connection
      await this.redis.quit();
      
      // Close HTTP server
      this.server.close(() => {
        logger.info('✅ Server shutdown complete');
        process.exit(0);
      });
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Initialize and start the server
const server = new MatchaMatchServer();

// Handle graceful shutdown
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

// Start the server
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Export server instance for testing
export default server;
