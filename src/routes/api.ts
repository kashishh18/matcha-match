import express from 'express';
import { Knex } from 'knex';
import Redis from 'redis';
import ProductController, { productValidations } from '@/controllers/productController';
import AuthController, { authValidations } from '@/controllers/authController';
import AuthMiddleware from '@/middleware/auth';
import MatchaAdvancedSearch from '@/services/search';
import MatchaRecommendationEngine from '@/services/recommendations';
import MatchaWebScraper from '@/services/scraper';

// Complete API routes for the FAANG-level matcha marketplace
// All features are FREE and accessible to everyone - no premium tiers!

export function createApiRoutes(
  db: Knex,
  redis: Redis.RedisClientType,
  searchService: MatchaAdvancedSearch,
  recommendationService: MatchaRecommendationEngine,
  scraperService: MatchaWebScraper
): express.Router {
  
  const router = express.Router();
  
  // Initialize middleware
  const authMiddleware = new AuthMiddleware(db, redis);
  
  // Initialize controllers
  const productController = new ProductController(db, redis, searchService, recommendationService);
  const authController = new AuthController(db, redis);

  // Apply global middleware to all API routes
  router.use(authMiddleware.validateRequest);
  router.use(authMiddleware.securityHeaders);
  router.use(authMiddleware.corsHandler);
  router.use(authMiddleware.requestLogger);
  router.use(authMiddleware.apiVersioning);
  router.use(authMiddleware.validateContentType(['application/json']));
  router.use(authMiddleware.requestSizeLimit(10 * 1024 * 1024)); // 10MB limit

  // =============================================================================
  // AUTHENTICATION ROUTES - Open to everyone
  // =============================================================================

  // User registration
  router.post('/auth/register', 
    authMiddleware.rateLimit('strict'),
    authValidations.register,
    authController.register
  );

  // User login
  router.post('/auth/login',
    authMiddleware.rateLimit('strict'),
    authValidations.login,
    authController.login
  );

  // Token refresh
  router.post('/auth/refresh',
    authMiddleware.rateLimit('api'),
    authValidations.refreshToken,
    authController.refreshToken
  );

  // User logout
  router.post('/auth/logout',
    authMiddleware.rateLimit('api'),
    authController.logout
  );

  // Email verification
  router.get('/auth/verify/:token',
    authMiddleware.rateLimit('api'),
    authController.verifyEmail
  );

  // Resend verification email
  router.post('/auth/resend-verification',
    authMiddleware.rateLimit('strict'),
    authValidations.resendVerification,
    authController.resendVerification
  );

  // Request password reset
  router.post('/auth/request-password-reset',
    authMiddleware.rateLimit('strict'),
    authValidations.requestPasswordReset,
    authController.requestPasswordReset
  );

  // Reset password
  router.post('/auth/reset-password',
    authMiddleware.rateLimit('strict'),
    authValidations.resetPassword,
    authController.resetPassword
  );

  // Get user profile (requires authentication)
  router.get('/auth/profile',
    authMiddleware.rateLimit('api'),
    authMiddleware.authenticateToken,
    authController.getProfile
  );

  // Update user profile (requires authentication)
  router.put('/auth/profile',
    authMiddleware.rateLimit('api'),
    authMiddleware.authenticateToken,
    authValidations.updateProfile,
    authController.updateProfile
  );

  // =============================================================================
  // PRODUCT ROUTES - Open to everyone (no auth required for browsing)
  // =============================================================================

  // Get all products with filtering and pagination
  router.get('/products',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth, // Optional auth for personalization
    productValidations.getProducts,
    productController.getProducts
  );

  // Get single product by ID
  router.get('/products/:id',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth, // Optional auth for view tracking
    productValidations.getProductById,
    productController.getProductById
  );

  // Get featured products
  router.get('/products/featured',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth,
    productController.getFeaturedProducts
  );

  // Get trending products
  router.get('/products/trending',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth,
    productController.getTrendingProducts
  );

  // Get product filters for UI
  router.get('/products/filters',
    authMiddleware.rateLimit('api'),
    productController.getProductFilters
  );

  // =============================================================================
  // SEARCH ROUTES - Free advanced search for everyone!
  // =============================================================================

  // Advanced search with fuzzy matching and facets
  router.get('/search',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth, // Optional auth for personalized results
    productValidations.searchProducts,
    productController.searchProducts
  );

  // Real-time autocomplete
  router.get('/search/autocomplete',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth,
    productValidations.getAutocomplete,
    productController.getAutocomplete
  );

  // Search suggestions
  router.get('/search/suggestions',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth,
    productController.getSearchSuggestions
  );

  // Track search clicks for analytics
  router.post('/search/track-click',
    authMiddleware.rateLimit('api'),
    authMiddleware.optionalAuth,
    productValidations.trackSearchClick,
    productController.trackSearchClick
  );

  // =============================================================================
  // RECOMMENDATION ROUTES - Free ML recommendations for everyone!
  // =============================================================================

  // Get personalized recommendations (requires authentication)
  router.get('/recommendations',
    authMiddleware.rateLimit('api'),
    authMiddleware.authenticateToken, // Auth required for personalization
    productController.getRecommendations
  );

  // Track recommendation clicks
  router.post('/recommendations/:recommendationId/click',
    authMiddleware.rateLimit('api'),
    authMiddleware.authenticateToken,
    productController.trackRecommendationClick
  );

  // =============================================================================
  // ANALYTICS ROUTES - Basic analytics for everyone
  // =============================================================================

  // Get search analytics (public insights)
  router.get('/analytics/search',
    authMiddleware.rateLimit('api'),
    async (req, res) => {
      try {
        const analytics = await searchService.getSearchAnalytics(7); // Last 7 days
        res.json({
          success: true,
          data: {
            totalSearches: analytics.totalSearches,
            avgResponseTime: analytics.avgResponseTime,
            topQueries: analytics.topQueries.slice(0, 10), // Top 10 only
            popularFilters: analytics.popularFilters
          },
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get search analytics',
          timestamp: new Date()
        });
      }
    }
  );

  // Get recommendation analytics (public insights)
  router.get('/analytics/recommendations',
    authMiddleware.rateLimit('api'),
    async (req, res) => {
      try {
        const analytics = await recommendationService.getRecommendationAnalytics('recommendation_algorithm', 7);
        res.json({
          success: true,
          data: {
            totalRecommendations: analytics.reduce((sum: number, a: any) => sum + a.totalRecommendations, 0),
            avgClickThroughRate: analytics.reduce((sum: number, a: any) => sum + a.clickThroughRate, 0) / analytics.length,
            variants: analytics.map((a: any) => ({
              variant: a.variant,
              clickThroughRate: a.clickThroughRate,
              conversionRate: a.conversionRate
            }))
          },
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get recommendation analytics',
          timestamp: new Date()
        });
      }
    }
  );

  // =============================================================================
  // ADMIN/SYSTEM ROUTES - For system management
  // =============================================================================

  // Manual scraping trigger (could be protected later)
  router.post('/admin/scrape',
    authMiddleware.rateLimit('strict'),
    authMiddleware.authenticateToken,
    async (req, res) => {
      try {
        const { provider } = req.body;
        
        if (provider) {
          await scraperService.scrapeSpecificProvider(provider);
          res.json({
            success: true,
            data: { message: `Scraping completed for ${provider}` },
            timestamp: new Date()
          });
        } else {
          // Scrape all providers (background job)
          scraperService.scrapeAllProviders().catch(error => {
            console.error('Background scraping failed:', error);
          });
          
          res.json({
            success: true,
            data: { message: 'Scraping started in background' },
            timestamp: new Date()
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Scraping failed',
          timestamp: new Date()
        });
      }
    }
  );

  // Get scraping statistics
  router.get('/admin/scrape/stats',
    authMiddleware.rateLimit('api'),
    authMiddleware.authenticateToken,
    async (req, res) => {
      try {
        const stats = await scraperService.getScrapingStats();
        res.json({
          success: true,
          data: stats,
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get scraping stats',
          timestamp: new Date()
        });
      }
    }
  );

  // Rebuild search index
  router.post('/admin/search/rebuild-index',
    authMiddleware.rateLimit('strict'),
    authMiddleware.authenticateToken,
    async (req, res) => {
      try {
        await searchService.rebuildSearchIndex();
        res.json({
          success: true,
          data: { message: 'Search index rebuilt successfully' },
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to rebuild search index',
          timestamp: new Date()
        });
      }
    }
  );

  // Optimize search performance
  router.post('/admin/search/optimize',
    authMiddleware.rateLimit('strict'),
    authMiddleware.authenticateToken,
    async (req, res) => {
      try {
        await searchService.optimizeSearchIndex();
        res.json({
          success: true,
          data: { message: 'Search optimization completed' },
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to optimize search',
          timestamp: new Date()
        });
      }
    }
  );

  // Refresh recommendation caches
  router.post('/admin/recommendations/refresh-cache',
    authMiddleware.rateLimit('strict'),
    authMiddleware.authenticateToken,
    async (req, res) => {
      try {
        await recommendationService.refreshAllCaches();
        res.json({
          success: true,
          data: { message: 'Recommendation caches refreshed' },
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to refresh caches',
          timestamp: new Date()
        });
      }
    }
  );

  // =============================================================================
  // HEALTH CHECK ROUTES - No authentication required
  // =============================================================================

  // Overall system health
  router.get('/health',
    async (req, res) => {
      try {
        const [searchHealth, recommendationHealth, scraperHealth] = await Promise.all([
          searchService.healthCheck(),
          recommendationService.healthCheck(),
          scraperService.healthCheck()
        ]);

        const overallHealth = 
          searchHealth.status === 'healthy' && 
          recommendationHealth.status === 'healthy' && 
          scraperHealth.status === 'healthy';

        res.status(overallHealth ? 200 : 503).json({
          success: overallHealth,
          data: {
            status: overallHealth ? 'healthy' : 'unhealthy',
            services: {
              search: searchHealth,
              recommendations: recommendationHealth,
              scraper: scraperHealth
            },
            timestamp: new Date()
          }
        });
      } catch (error) {
        res.status(503).json({
          success: false,
          error: 'Health check failed',
          timestamp: new Date()
        });
      }
    }
  );

  // Service-specific health checks
  router.get('/health/search',
    async (req, res) => {
      try {
        const health = await searchService.healthCheck();
        res.status(health.status === 'healthy' ? 200 : 503).json({
          success: health.status === 'healthy',
          data: health,
          timestamp: new Date()
        });
      } catch (error) {
        res.status(503).json({
          success: false,
          error: 'Search health check failed',
          timestamp: new Date()
        });
      }
    }
  );

  router.get('/health/recommendations',
    async (req, res) => {
      try {
        const health = await recommendationService.healthCheck();
        res.status(health.status === 'healthy' ? 200 : 503).json({
          success: health.status === 'healthy',
          data: health,
          timestamp: new Date()
        });
      } catch (error) {
        res.status(503).json({
          success: false,
          error: 'Recommendation health check failed',
          timestamp: new Date()
        });
      }
    }
  );

  router.get('/health/scraper',
    async (req, res) => {
      try {
        const health = await scraperService.healthCheck();
        res.status(health.status === 'healthy' ? 200 : 503).json({
          success: health.status === 'healthy',
          data: health,
          timestamp: new Date()
        });
      } catch (error) {
        res.status(503).json({
          success: false,
          error: 'Scraper health check failed',
          timestamp: new Date()
        });
      }
    }
  );

  // =============================================================================
  // ERROR HANDLING - Catch all unhandled routes
  // =============================================================================

  // 404 handler for API routes
  router.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'API endpoint not found',
      data: {
        method: req.method,
        path: req.originalUrl,
        availableEndpoints: [
          'GET /api/products',
          'GET /api/products/:id',
          'GET /api/search',
          'GET /api/search/autocomplete',
          'GET /api/recommendations',
          'POST /api/auth/register',
          'POST /api/auth/login',
          'GET /api/health'
        ]
      },
      timestamp: new Date()
    });
  });

  return router;
}

export default createApiRoutes;
