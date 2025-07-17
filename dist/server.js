"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const redis_1 = __importDefault(require("redis"));
const winston_1 = __importDefault(require("winston"));
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("@/database/config");
const api_1 = __importDefault(require("@/routes/api"));
const search_1 = __importDefault(require("@/services/search"));
const recommendations_1 = __importDefault(require("@/services/recommendations"));
const scraper_1 = __importDefault(require("@/services/scraper"));
// Load environment variables
dotenv_1.default.config();
// Initialize logger for production-grade monitoring
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston_1.default.transports.File({ filename: 'logs/combined.log' }),
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
        })
    ]
});
class MatchaMatchServer {
    app;
    server;
    io;
    db;
    redis;
    port;
    // Service instances
    searchService;
    recommendationService;
    scraperService;
    // Real-time tracking
    connectedUsers = new Map(); // socketId -> userId
    productViewers = new Map(); // productId -> Set of socketIds
    constructor() {
        this.app = (0, express_1.default)();
        this.port = parseInt(process.env.PORT || '3001');
        this.server = (0, http_1.createServer)(this.app);
        this.io = new socket_io_1.Server(this.server, {
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
    async initialize() {
        try {
            logger.info('🚀 Starting Matcha Match server initialization...');
            // Initialize database
            this.db = await (0, config_1.initializeDatabase)();
            logger.info('✅ Database initialized successfully');
            // Initialize Redis
            await this.initializeRedis();
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
        }
        catch (error) {
            logger.error('❌ Server initialization failed:', error);
            throw error;
        }
    }
    // Initialize Redis connection
    async initializeRedis() {
        this.redis = redis_1.default.createClient({
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
    async initializeServices() {
        // Initialize web scraper
        this.scraperService = new scraper_1.default(this.db);
        logger.info('✅ Web scraper service initialized');
        // Initialize search service
        this.searchService = new search_1.default(this.db, this.redis);
        logger.info('✅ Advanced search service initialized');
        // Initialize recommendation engine
        this.recommendationService = new recommendations_1.default(this.db, this.redis);
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
    setupExpressApp() {
        // Trust proxy for accurate IP addresses
        this.app.set('trust proxy', 1);
        // Security middleware
        this.app.use((0, helmet_1.default)({
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
        this.app.use((0, cors_1.default)({
            origin: function (origin, callback) {
                const allowedOrigins = [
                    process.env.FRONTEND_URL || 'http://localhost:3000',
                    'http://localhost:3000',
                    'https://localhost:3000'
                ];
                // Allow requests with no origin (mobile apps, curl, etc.)
                if (!origin)
                    return callback(null, true);
                if (allowedOrigins.includes(origin)) {
                    callback(null, true);
                }
                else {
                    callback(new Error('Not allowed by CORS'));
                }
            },
            credentials: true,
            optionsSuccessStatus: 200,
        }));
        // Body parsing
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
        // API routes
        this.app.use('/api', (0, api_1.default)(this.db, this.redis, this.searchService, this.recommendationService, this.scraperService));
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
    setupWebSocketHandlers() {
        this.io.on('connection', (socket) => {
            logger.info(`🔌 User connected: ${socket.id}`);
            // Handle user authentication
            socket.on('authenticate', async (token) => {
                try {
                    // TODO: Implement JWT token verification when auth is integrated
                    const userId = 'temp-user-id'; // This will be replaced with actual JWT verification
                    this.connectedUsers.set(socket.id, userId);
                    socket.emit('authenticated', { userId, timestamp: new Date() });
                    logger.info(`🔐 User authenticated: ${userId} (${socket.id})`);
                }
                catch (error) {
                    socket.emit('auth_error', { error: 'Invalid token', timestamp: new Date() });
                    logger.error('WebSocket authentication error:', error);
                }
            });
            // Handle product page viewing (for real-time viewer counts)
            socket.on('view_product', (data) => {
                const { productId } = data;
                if (!productId) {
                    socket.emit('error', { message: 'Product ID required' });
                    return;
                }
                if (!this.productViewers.has(productId)) {
                    this.productViewers.set(productId, new Set());
                }
                this.productViewers.get(productId).add(socket.id);
                // Broadcast viewer count to all users viewing this product
                const viewerCount = this.productViewers.get(productId).size;
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
            socket.on('leave_product', (data) => {
                const { productId } = data;
                if (this.productViewers.has(productId)) {
                    this.productViewers.get(productId).delete(socket.id);
                    const viewerCount = this.productViewers.get(productId).size;
                    this.io.to(`product-${productId}`).emit('viewer_count', {
                        productId,
                        count: viewerCount,
                        timestamp: new Date()
                    });
                }
                socket.leave(`product-${productId}`);
            });
            // Handle stock alerts subscription
            socket.on('subscribe_stock_alerts', (data) => {
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
            socket.on('join_search', (data) => {
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
    setupBackgroundJobs() {
        // Scrape matcha providers every 6 hours
        node_cron_1.default.schedule('0 */6 * * *', async () => {
            logger.info('🕷️ Starting scheduled scraping job...');
            try {
                await this.scraperService.scrapeAllProviders();
                logger.info('✅ Scheduled scraping completed successfully');
            }
            catch (error) {
                logger.error('❌ Scheduled scraping failed:', error);
            }
        });
        // Rebuild search index every 2 hours
        node_cron_1.default.schedule('0 */2 * * *', async () => {
            logger.info('🔍 Rebuilding search index...');
            try {
                await this.searchService.rebuildSearchIndex();
                logger.info('✅ Search index rebuilt successfully');
            }
            catch (error) {
                logger.error('❌ Search index rebuild failed:', error);
            }
        });
        // Clean up old data daily at 2 AM
        node_cron_1.default.schedule('0 2 * * *', async () => {
            logger.info('🧹 Starting daily cleanup job...');
            try {
                await Promise.all([
                    this.searchService.cleanupOldSearchData(30),
                    this.recommendationService.cleanupOldRecommendations(30)
                ]);
                logger.info('✅ Daily cleanup completed successfully');
            }
            catch (error) {
                logger.error('❌ Daily cleanup failed:', error);
            }
        });
        // Generate batch recommendations every hour
        node_cron_1.default.schedule('0 * * * *', async () => {
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
            }
            catch (error) {
                logger.error('❌ Batch recommendation generation failed:', error);
            }
        });
        logger.info('⏰ Background jobs scheduled successfully');
    }
    // Setup comprehensive error handling
    setupErrorHandling() {
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
        this.app.use((error, req, res, next) => {
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
                requestId: req.requestId
            });
        });
    }
    // Public method to broadcast stock updates
    broadcastStockUpdate(productId, stockData) {
        const message = {
            type: 'stock_update',
            data: { productId, ...stockData },
            timestamp: new Date()
        };
        this.io.to(`product-${productId}`).emit('stock_update', message);
        this.io.to(`stock-alerts-${productId}`).emit('stock_alert', message);
        logger.info(`📢 Broadcasted stock update for product ${productId}`);
    }
    // Public method to broadcast price changes
    broadcastPriceChange(productId, priceData) {
        const message = {
            type: 'price_change',
            data: { productId, ...priceData },
            timestamp: new Date()
        };
        this.io.to(`product-${productId}`).emit('price_change', message);
        logger.info(`📢 Broadcasted price change for product ${productId}`);
    }
    // Start the server
    async start() {
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
        }
        catch (error) {
            logger.error('💥 Failed to start server:', error);
            process.exit(1);
        }
    }
    // Graceful shutdown
    async shutdown() {
        logger.info('🛑 Shutting down server gracefully...');
        try {
            // Close WebSocket connections
            this.io.close();
            logger.info('✅ WebSocket server closed');
            // Close database connection
            if (this.db) {
                await (0, config_1.closeDatabaseConnection)(this.db);
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
        }
        catch (error) {
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
exports.default = server;
//# sourceMappingURL=server.js.map