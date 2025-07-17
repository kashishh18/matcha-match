import { Request, Response } from 'express';
import { Knex } from 'knex';
import Redis from 'redis';
import { body, query, param, validationResult } from 'express-validator';
import winston from 'winston';
import { 
  ApiResponse, 
  MatchaProduct, 
  SearchFilters, 
  MatchaGrade, 
  FlavorProfile 
} from '../types';
import MatchaAdvancedSearch from '@/services/search';
import MatchaRecommendationEngine from '@/services/recommendations';

// Product API controller with comprehensive endpoints for the matcha marketplace
// Implements all 3 FAANG-level features: real-time updates, recommendations, and advanced search

export class ProductController {
  private db: Knex;
  private redis: Redis.RedisClientType;
  private logger: winston.Logger;
  private searchService: MatchaAdvancedSearch;
  private recommendationService: MatchaRecommendationEngine;

  constructor(
    database: Knex, 
    redisClient: Redis.RedisClientType,
    searchService: MatchaAdvancedSearch,
    recommendationService: MatchaRecommendationEngine
  ) {
    this.db = database;
    this.redis = redisClient;
    this.searchService = searchService;
    this.recommendationService = recommendationService;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] ProductController: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/products.log' })
      ]
    });
  }

  // Get all products with filtering, sorting, and pagination
  getProducts = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      // Validate query parameters
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json(this.createErrorResponse('Invalid query parameters', errors.array()));
        return;
      }

      const {
        page = 1,
        limit = 20,
        sortBy = 'name',
        sortOrder = 'asc',
        provider,
        grade,
        origin,
        minPrice,
        maxPrice,
        inStockOnly,
        flavorProfile
      } = req.query;

      // Build filters
      const filters: any = {};
      
      if (provider) filters.provider_id = provider;
      if (grade) filters.grade = grade;
      if (origin) filters.origin = origin;
      if (inStockOnly === 'true') filters.in_stock = true;
      
      // Build query
      let query = this.db('matcha_products')
        .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
        .select(
          'matcha_products.*',
          'matcha_providers.name as provider_name'
        )
        .where(filters);

      // Price range filter
      if (minPrice) query = query.where('price', '>=', Number(minPrice));
      if (maxPrice) query = query.where('price', '<=', Number(maxPrice));

      // Flavor profile filter (JSON contains)
      if (flavorProfile) {
        query = query.whereRaw('JSON_CONTAINS(flavor_profile, ?)', [`"${flavorProfile}"`]);
      }

      // Get total count for pagination
      const totalQuery = query.clone();
      const totalResult = await totalQuery.count('matcha_products.id as count').first();
      const total = parseInt(totalResult?.count as string || '0');

      // Apply sorting
      const validSortFields = ['name', 'price', 'grade', 'created_at', 'view_count', 'purchase_count'];
      const safeSortBy = validSortFields.includes(sortBy as string) ? sortBy as string : 'name';
      const safeSortOrder = sortOrder === 'desc' ? 'desc' : 'asc';
      
      query = query.orderBy(`matcha_products.${safeSortBy}`, safeSortOrder);

      // Apply pagination
      const offset = (Number(page) - 1) * Number(limit);
      query = query.limit(Number(limit)).offset(offset);

      // Execute query
      const products = await query;

      // Track product views for analytics
      await this.trackProductListView(req, products.length);

      const response: ApiResponse<{
        products: MatchaProduct[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          pages: number;
        };
      }> = {
        success: true,
        data: {
          products: products.map(this.formatProduct),
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
          }
        },
        timestamp: new Date(),
        requestId: (req as any).requestId
      };

      const responseTime = Date.now() - startTime;
      this.logger.info(`Retrieved ${products.length} products in ${responseTime}ms`);

      res.json(response);

    } catch (error) {
      this.logger.error('Error getting products:', error);
      res.status(500).json(this.createErrorResponse('Failed to retrieve products'));
    }
  };

  // Get single product by ID with recommendations
  getProductById = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      const { id } = req.params;

      // Get product with provider info
      const product = await this.db('matcha_products')
        .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
        .select(
          'matcha_products.*',
          'matcha_providers.name as provider_name'
        )
        .where('matcha_products.id', id)
        .first();

      if (!product) {
        res.status(404).json(this.createErrorResponse('Product not found'));
        return;
      }

      // Increment view count
      await this.incrementViewCount(id);

      // Get similar products (recommendations)
      const similarProducts = await this.recommendationService.getProductRecommendations(id, 5);

      // Track product view for analytics
      await this.trackProductView(req, id, product.name);

      const response: ApiResponse<{
        product: MatchaProduct;
        similarProducts: MatchaProduct[];
      }> = {
        success: true,
        data: {
          product: this.formatProduct(product),
          similarProducts
        },
        timestamp: new Date(),
        requestId: (req as any).requestId
      };

      const responseTime = Date.now() - startTime;
      this.logger.info(`Retrieved product ${id} in ${responseTime}ms`);

      res.json(response);

    } catch (error) {
      this.logger.error('Error getting product by ID:', error);
      res.status(500).json(this.createErrorResponse('Failed to retrieve product'));
    }
  };

  // Advanced search with autocomplete and facets
  searchProducts = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json(this.createErrorResponse('Invalid search parameters', errors.array()));
        return;
      }

      const {
        q: query = '',
        page = 1,
        limit = 20,
        providers,
        grades,
        origins,
        flavorProfiles,
        minPrice,
        maxPrice,
        inStockOnly,
        sortBy = 'relevance'
      } = req.query;

      // Build search filters
      const filters: SearchFilters = {};
      
      if (providers) {
        filters.providers = Array.isArray(providers) ? providers as string[] : [providers as string];
      }
      
      if (grades) {
        filters.grades = Array.isArray(grades) ? grades as MatchaGrade[] : [grades as MatchaGrade];
      }
      
      if (origins) {
        filters.origins = Array.isArray(origins) ? origins as string[] : [origins as string];
      }
      
      if (flavorProfiles) {
        filters.flavorProfiles = Array.isArray(flavorProfiles) 
          ? flavorProfiles as FlavorProfile[] 
          : [flavorProfiles as FlavorProfile];
      }
      
      if (minPrice || maxPrice) {
        filters.priceRange = {
          min: minPrice ? Number(minPrice) : 0,
          max: maxPrice ? Number(maxPrice) : Infinity
        };
      }
      
      if (inStockOnly === 'true') {
        filters.inStockOnly = true;
      }
      
      if (sortBy) {
        filters.sortBy = sortBy as any;
      }

      // Perform search
      const userId = (req as any).user?.id; // Assuming auth middleware sets (req as any).user
      const offset = (Number(page) - 1) * Number(limit);
      
      const searchResults = await this.searchService.search(
        query as string,
        filters,
        userId,
        Number(limit),
        offset
      );

      // Get search facets for filtering UI
      const facets = await this.searchService.getSearchFacets(query as string, filters);

      const response: ApiResponse<{
        results: MatchaProduct[];
        total: number;
        facets: any;
        pagination: {
          page: number;
          limit: number;
          total: number;
          pages: number;
        };
        analytics: any;
      }> = {
        success: true,
        data: {
          results: searchResults.results,
          total: searchResults.total,
          facets,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: searchResults.total,
            pages: Math.ceil(searchResults.total / Number(limit))
          },
          analytics: searchResults.analytics
        },
        timestamp: new Date(),
        requestId: (req as any).requestId
      };

      res.json(response);

    } catch (error) {
      this.logger.error('Error searching products:', error);
      res.status(500).json(this.createErrorResponse('Search failed'));
    }
  };

  // Autocomplete endpoint for search suggestions
  getAutocomplete = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q: query, limit = 10 } = req.query;

      if (!query || (query as string).length < 1) {
        res.json(this.createSuccessResponse([]));
        return;
      }

      const suggestions = await this.searchService.getAutocomplete(
        query as string,
        Number(limit)
      );

      res.json(this.createSuccessResponse(suggestions));

    } catch (error) {
      this.logger.error('Error getting autocomplete:', error);
      res.status(500).json(this.createErrorResponse('Autocomplete failed'));
    }
  };

  // Get search suggestions for empty search state
  getSearchSuggestions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit = 5 } = req.query;
      const userId = (req as any).user?.id;

      const suggestions = await this.searchService.getSearchSuggestions(userId, Number(limit));

      res.json(this.createSuccessResponse(suggestions));

    } catch (error) {
      this.logger.error('Error getting search suggestions:', error);
      res.status(500).json(this.createErrorResponse('Failed to get suggestions'));
    }
  };

  // Get personalized recommendations for a user
  getRecommendations = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      
      if (!userId) {
        res.status(401).json(this.createErrorResponse('Authentication required for recommendations'));
        return;
      }

      const { limit = 10 } = req.query;

      const recommendations = await this.recommendationService.generateRecommendations(
        userId,
        Number(limit)
      );

      // Get full product details for recommendations
      const productIds = recommendations.map(r => r.productId);
      const products = await this.getProductsByIds(productIds);
      
      // Combine recommendations with product data
      const enrichedRecommendations = recommendations.map(rec => {
        const product = products.find(p => p.id === rec.productId);
        return {
          ...rec,
          product
        };
      }).filter(rec => rec.product); // Only include recommendations with valid products

      res.json(this.createSuccessResponse(enrichedRecommendations));

    } catch (error) {
      this.logger.error('Error getting recommendations:', error);
      res.status(500).json(this.createErrorResponse('Failed to get recommendations'));
    }
  };

  // Track recommendation click
  trackRecommendationClick = async (req: Request, res: Response): Promise<void> => {
    try {
      const { recommendationId } = req.params;

      await this.recommendationService.trackRecommendationClick(recommendationId);

      res.json(this.createSuccessResponse({ tracked: true }));

    } catch (error) {
      this.logger.error('Error tracking recommendation click:', error);
      res.status(500).json(this.createErrorResponse('Failed to track click'));
    }
  };

  // Track search result click
  trackSearchClick = async (req: Request, res: Response): Promise<void> => {
    try {
      const { searchId, productId, position } = req.body;

      await this.searchService.trackSearchClick(searchId, productId, position);

      res.json(this.createSuccessResponse({ tracked: true }));

    } catch (error) {
      this.logger.error('Error tracking search click:', error);
      res.status(500).json(this.createErrorResponse('Failed to track click'));
    }
  };

  // Get trending products
  getTrendingProducts = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit = 10, timeframe = '7d' } = req.query;

      // Calculate trending based on recent views and purchases
      const days = timeframe === '1d' ? 1 : timeframe === '3d' ? 3 : 7;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const trendingProducts = await this.db('matcha_products')
        .leftJoin('analytics', function() {
          this.on('analytics.data->>"productId"', '=', 'matcha_products.id')
              .andOn('analytics.timestamp', '>', startDate.toISOString());
        })
        .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
        .select(
          'matcha_products.*',
          'matcha_providers.name as provider_name',
          this.db.raw('COUNT(analytics.id) as recent_activity')
        )
        .where('matcha_products.in_stock', true)
        .groupBy('matcha_products.id', 'matcha_providers.name')
        .orderByRaw('COUNT(analytics.id) DESC, matcha_products.view_count DESC')
        .limit(Number(limit));

      const formattedProducts = trendingProducts.map(this.formatProduct);

      res.json(this.createSuccessResponse(formattedProducts));

    } catch (error) {
      this.logger.error('Error getting trending products:', error);
      res.status(500).json(this.createErrorResponse('Failed to get trending products'));
    }
  };

  // Get featured products (curated selection)
  getFeaturedProducts = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit = 6 } = req.query;

      // Get featured products based on high ratings, popularity, and availability
      const featuredProducts = await this.db('matcha_products')
        .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
        .select(
          'matcha_products.*',
          'matcha_providers.name as provider_name'
        )
        .where('matcha_products.in_stock', true)
        .where('matcha_products.grade', 'IN', ['ceremonial', 'premium'])
        .orderByRaw('(matcha_products.view_count + matcha_products.purchase_count * 5) DESC')
        .limit(Number(limit));

      const formattedProducts = featuredProducts.map(this.formatProduct);

      res.json(this.createSuccessResponse(formattedProducts));

    } catch (error) {
      this.logger.error('Error getting featured products:', error);
      res.status(500).json(this.createErrorResponse('Failed to get featured products'));
    }
  };

  // Get product filters (for filter UI)
  getProductFilters = async (req: Request, res: Response): Promise<void> => {
    try {
      const cacheKey = 'product_filters';
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        res.json(this.createSuccessResponse(JSON.parse(cached)));
        return;
      }

      // Get all unique filter values
      const [providers, grades, origins, priceRange] = await Promise.all([
        this.db('matcha_providers').select('id', 'name').where('is_active', true),
        this.db.raw('SELECT DISTINCT grade FROM matcha_products ORDER BY grade'),
        this.db.raw('SELECT DISTINCT origin FROM matcha_products ORDER BY origin'),
        this.db('matcha_products').min('price as min').max('price as max').first()
      ]);

      const filters = {
        providers,
        grades: grades.rows?.map((row: any) => row.grade) || Object.values(MatchaGrade),
        origins: origins.rows?.map((row: any) => row.origin) || [],
        flavorProfiles: Object.values(FlavorProfile),
        priceRange: {
          min: Math.floor(priceRange?.min || 0),
          max: Math.ceil(priceRange?.max || 200)
        }
      };

      // Cache for 1 hour
      await this.redis.setEx(cacheKey, 3600, JSON.stringify(filters));

      res.json(this.createSuccessResponse(filters));

    } catch (error) {
      this.logger.error('Error getting product filters:', error);
      res.status(500).json(this.createErrorResponse('Failed to get filters'));
    }
  };

  // Helper methods
  private formatProduct = (product: any): MatchaProduct => {
    return {
      id: product.id,
      name: product.name,
      provider: {
        id: product.provider_id,
        name: product.provider_name || product.provider,
        baseUrl: '',
        isActive: true,
        scrapeConfig: { productListUrl: "", productSelector: "", nameSelector: "", priceSelector: "", stockSelector: "", imageSelector: "", descriptionSelector: "", headers: {}, rateLimit: 60 },
        lastScraped: new Date(),
        averageResponseTime: 0,
        successRate: 100
      },
      price: parseFloat(product.price),
      originalPrice: product.original_price ? parseFloat(product.original_price) : undefined,
      inStock: product.in_stock,
      stockCount: product.stock_count || 0,
      description: product.description || '',
      imageUrl: product.image_url || '',
      productUrl: product.product_url || '',
      grade: product.grade,
      origin: product.origin,
      flavorProfile: JSON.parse(product.flavor_profile || '[]'),
      size: product.size || '',
      weight: product.weight || 0,
      createdAt: new Date(product.created_at),
      updatedAt: new Date(product.updated_at),
      scrapedAt: new Date(product.scraped_at),
      viewCount: product.view_count || 0,
      purchaseCount: product.purchase_count || 0
    };
  };

  private async incrementViewCount(productId: string): Promise<void> {
    try {
      await this.db('matcha_products')
        .where('id', productId)
        .increment('view_count', 1);
    } catch (error) {
      this.logger.error('Error incrementing view count:', error);
    }
  }

  private async trackProductView(req: Request, productId: string, productName: string): Promise<void> {
    try {
      await this.db('analytics').insert({
        event: 'product_view',
        user_id: (req as any).user?.id || null,
        session_id: (req as any).sessionId || 'anonymous',
        data: JSON.stringify({
          productId,
          productName,
          userAgent: req.get('User-Agent'),
          referer: req.get('Referer')
        }),
        ip_address: req.ip,
        user_agent: req.get('User-Agent') || '',
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.error('Error tracking product view:', error);
    }
  }

  private async trackProductListView(req: Request, resultCount: number): Promise<void> {
    try {
      await this.db('analytics').insert({
        event: 'product_list_view',
        user_id: (req as any).user?.id || null,
        session_id: (req as any).sessionId || 'anonymous',
        data: JSON.stringify({
          resultCount,
          filters: req.query,
          userAgent: req.get('User-Agent')
        }),
        ip_address: req.ip,
        user_agent: req.get('User-Agent') || '',
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.error('Error tracking product list view:', error);
    }
  }

  private async getProductsByIds(productIds: string[]): Promise<MatchaProduct[]> {
    const products = await this.db('matcha_products')
      .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
      .select(
        'matcha_products.*',
        'matcha_providers.name as provider_name'
      )
      .whereIn('matcha_products.id', productIds);

    return products.map(this.formatProduct);
  }

  private createSuccessResponse<T>(data: T): ApiResponse<T> {
    return {
      success: true,
      data,
      timestamp: new Date(),
      requestId: Math.random().toString(36).substring(2, 15)
    };
  }

  private createErrorResponse(message: string, details?: any): ApiResponse<null> {
    return {
      success: false,
      error: message,
      data: details || null,
      timestamp: new Date(),
      requestId: Math.random().toString(36).substring(2, 15)
    };
  }
}

// Validation middleware for endpoints
export const productValidations = {
  getProducts: [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('sortBy').optional().isIn(['name', 'price', 'grade', 'created_at', 'view_count', 'purchase_count']),
    query('sortOrder').optional().isIn(['asc', 'desc']),
    query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be non-negative'),
    query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be non-negative'),
    query('inStockOnly').optional().isBoolean()
  ],

  getProductById: [
    param('id').isUUID().withMessage('Product ID must be a valid UUID')
  ],

  searchProducts: [
    query('q').optional().isLength({ max: 200 }).withMessage('Query too long'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be non-negative'),
    query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be non-negative')
  ],

  getAutocomplete: [
    query('q').isLength({ min: 1, max: 100 }).withMessage('Query must be 1-100 characters'),
    query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
  ],

  trackSearchClick: [
    body('searchId').isUUID().withMessage('Search ID must be a valid UUID'),
    body('productId').isUUID().withMessage('Product ID must be a valid UUID'),
    body('position').isInt({ min: 0 }).withMessage('Position must be non-negative integer')
  ]
};

export default ProductController;
