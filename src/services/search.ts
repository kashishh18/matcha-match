import { Knex } from 'knex';
import Redis from 'redis';
import winston from 'winston';
import Fuse from 'fuse.js';
import crypto from 'crypto';
import { 
  SearchQuery, 
  SearchFilters, 
  SearchResult, 
  MatchaProduct, 
  MatchaGrade, 
  FlavorProfile 
} from '@/types';

// FAANG-level search system with autocomplete, fuzzy matching, and analytics
// Implements advanced search algorithms with sub-100ms response times

interface SearchIndex {
  id: string;
  name: string;
  description: string;
  grade: MatchaGrade;
  origin: string;
  flavorProfile: FlavorProfile[];
  provider: string;
  price: number;
  inStock: boolean;
  searchableText: string; // Combined text for full-text search
  popularity: number; // View count + purchase count weighted
  tags: string[]; // Generated tags for better matching
}

interface AutocompleteItem {
  text: string;
  type: 'product' | 'brand' | 'origin' | 'flavor' | 'grade';
  frequency: number;
  productCount: number;
}

interface SearchSuggestion {
  query: string;
  frequency: number;
  results: number;
  ctr: number; // Click-through rate
}

interface SearchAnalytics {
  totalSearches: number;
  avgResponseTime: number;
  topQueries: Array<{ query: string; count: number; ctr: number }>;
  zeroResultQueries: Array<{ query: string; count: number }>;
  popularFilters: Record<string, number>;
  conversionRate: number;
}

export class MatchaAdvancedSearch {
  private db: Knex;
  private redis: Redis.RedisClientType;
  private logger: winston.Logger;
  private searchIndex: SearchIndex[] = [];
  private fuseInstance: Fuse<SearchIndex> | null = null;
  private autocompleteIndex: Map<string, AutocompleteItem[]> = new Map();

  // Cache TTL settings
  private readonly CACHE_TTL = {
    search_results: 300, // 5 minutes
    autocomplete: 3600, // 1 hour
    search_index: 1800, // 30 minutes
    analytics: 900 // 15 minutes
  };

  // Search configuration
  private readonly SEARCH_CONFIG = {
    maxResults: 100,
    minQueryLength: 2,
    maxSuggestions: 10,
    fuzzyThreshold: 0.6,
    boostFactors: {
      exactMatch: 2.0,
      nameMatch: 1.8,
      descriptionMatch: 1.2,
      brandMatch: 1.5,
      inStock: 1.3,
      popularity: 1.1
    }
  };

  // Fuse.js configuration for fuzzy search
  private readonly FUSE_OPTIONS: Fuse.IFuseOptions<SearchIndex> = {
    keys: [
      { name: 'name', weight: 0.4 },
      { name: 'description', weight: 0.2 },
      { name: 'provider', weight: 0.2 },
      { name: 'origin', weight: 0.1 },
      { name: 'searchableText', weight: 0.1 }
    ],
    threshold: 0.3, // Lower = more strict matching
    distance: 100,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
    shouldSort: true,
    findAllMatches: false,
    useExtendedSearch: true
  };

  constructor(database: Knex, redisClient: Redis.RedisClientType) {
    this.db = database;
    this.redis = redisClient;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return results.map(r => ({
      query: r.query,
      count: parseInt(r.count)
    }));
  }

  private async getPopularFilters(startDate: Date): Promise<Record<string, number>> {
    const results = await this.db('search_queries')
      .where('created_at', '>', startDate)
      .select('filters');

    const filterCounts: Record<string, number> = {};

    for (const result of results) {
      try {
        const filters = JSON.parse(result.filters);
        
        // Count each filter type
        if (filters.providers?.length > 0) {
          filterCounts['providers'] = (filterCounts['providers'] || 0) + 1;
        }
        if (filters.priceRange) {
          filterCounts['priceRange'] = (filterCounts['priceRange'] || 0) + 1;
        }
        if (filters.grades?.length > 0) {
          filterCounts['grades'] = (filterCounts['grades'] || 0) + 1;
        }
        if (filters.inStockOnly) {
          filterCounts['inStockOnly'] = (filterCounts['inStockOnly'] || 0) + 1;
        }
        if (filters.origins?.length > 0) {
          filterCounts['origins'] = (filterCounts['origins'] || 0) + 1;
        }
        if (filters.flavorProfiles?.length > 0) {
          filterCounts['flavorProfiles'] = (filterCounts['flavorProfiles'] || 0) + 1;
        }
      } catch (error) {
        // Skip invalid JSON
      }
    }

    return filterCounts;
  }

  private async getSearchConversionRate(startDate: Date): Promise<number> {
    const totalSearches = await this.getTotalSearches(startDate);
    
    const conversions = await this.db('search_queries')
      .where('created_at', '>', startDate)
      .where('click_through_rate', '>', 0)
      .count('* as count')
      .first();

    const conversionCount = parseInt(conversions?.count || '0');
    
    return totalSearches > 0 ? conversionCount / totalSearches : 0;
  }

  private async getPersonalizedSuggestions(userId: string, limit: number): Promise<SearchSuggestion[]> {
    const userQueries = await this.db('search_queries')
      .where('user_id', userId)
      .where('created_at', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
      .select('query', 'click_through_rate')
      .groupBy('query')
      .orderByRaw('COUNT(*) DESC, AVG(click_through_rate) DESC')
      .limit(limit);

    return userQueries.map(q => ({
      query: q.query,
      frequency: 1, // Simplified
      results: 10, // Estimated
      ctr: q.click_through_rate || 0
    }));
  }

  private async getTrendingSuggestions(limit: number): Promise<SearchSuggestion[]> {
    const trending = await this.db('search_queries')
      .where('created_at', '>', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
      .select('query')
      .groupBy('query')
      .orderByRaw('COUNT(*) DESC')
      .limit(limit)
      .select(
        'query',
        this.db.raw('COUNT(*) as frequency'),
        this.db.raw('AVG(click_through_rate) as ctr')
      );

    return trending.map(t => ({
      query: t.query,
      frequency: parseInt(t.frequency),
      results: 10, // Estimated
      ctr: parseFloat(t.ctr || '0')
    }));
  }

  // Public methods for search result interaction tracking
  async trackSearchClick(searchId: string, productId: string, position: number): Promise<void> {
    try {
      // Update click-through rate for the search
      await this.db('search_queries')
        .where('id', searchId)
        .increment('click_through_rate', 0.1); // Simple increment

      // Track the click event
      await this.db('analytics').insert({
        event: 'search_click',
        user_id: null,
        session_id: 'search-session',
        data: JSON.stringify({
          searchId,
          productId,
          position,
          timestamp: new Date()
        }),
        ip_address: '0.0.0.0',
        user_agent: 'search-service',
        timestamp: new Date()
      });

      this.logger.info(`Search click tracked: ${searchId} -> ${productId} at position ${position}`);

    } catch (error) {
      this.logger.error('Error tracking search click:', error);
    }
  }

  async trackSearchPurchase(searchId: string, productId: string): Promise<void> {
    try {
      // Track the purchase conversion
      await this.db('analytics').insert({
        event: 'search_purchase',
        user_id: null,
        session_id: 'search-session',
        data: JSON.stringify({
          searchId,
          productId,
          timestamp: new Date()
        }),
        ip_address: '0.0.0.0',
        user_agent: 'search-service',
        timestamp: new Date()
      });

      this.logger.info(`Search purchase tracked: ${searchId} -> ${productId}`);

    } catch (error) {
      this.logger.error('Error tracking search purchase:', error);
    }
  }

  // Advanced search features
  async getSearchFacets(query: string = '', filters: SearchFilters = {}): Promise<any> {
    try {
      const cacheKey = `search_facets:${query}:${JSON.stringify(filters)}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Get all products that match the current query and filters
      let baseResults = this.searchIndex;
      
      if (query) {
        const searchResults = await this.performFuzzySearch(query, {});
        baseResults = searchResults;
      }
      
      // Apply existing filters to get the filtered set
      const filteredResults = this.applyFilters(baseResults, filters);
      
      // Calculate facets based on the filtered results
      const facets = {
        providers: this.calculateProviderFacets(filteredResults),
        grades: this.calculateGradeFacets(filteredResults),
        origins: this.calculateOriginFacets(filteredResults),
        flavorProfiles: this.calculateFlavorFacets(filteredResults),
        priceRanges: this.calculatePriceRangeFacets(filteredResults),
        availability: this.calculateAvailabilityFacets(filteredResults)
      };

      // Cache facets
      await this.redis.setEx(cacheKey, this.CACHE_TTL.search_results, JSON.stringify(facets));

      return facets;

    } catch (error) {
      this.logger.error('Error getting search facets:', error);
      return {};
    }
  }

  private calculateProviderFacets(results: SearchIndex[]): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    
    for (const result of results) {
      counts.set(result.provider, (counts.get(result.provider) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private calculateGradeFacets(results: SearchIndex[]): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    
    for (const result of results) {
      counts.set(result.grade, (counts.get(result.grade) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private calculateOriginFacets(results: SearchIndex[]): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    
    for (const result of results) {
      counts.set(result.origin, (counts.get(result.origin) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private calculateFlavorFacets(results: SearchIndex[]): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    
    for (const result of results) {
      for (const flavor of result.flavorProfile) {
        counts.set(flavor, (counts.get(flavor) || 0) + 1);
      }
    }
    
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private calculatePriceRangeFacets(results: SearchIndex[]): Array<{ name: string; min: number; max: number; count: number }> {
    const ranges = [
      { name: 'Under $20', min: 0, max: 20 },
      { name: '$20 - $40', min: 20, max: 40 },
      { name: '$40 - $60', min: 40, max: 60 },
      { name: '$60 - $100', min: 60, max: 100 },
      { name: 'Over $100', min: 100, max: Infinity }
    ];
    
    return ranges.map(range => ({
      ...range,
      count: results.filter(r => r.price >= range.min && r.price < range.max).length
    })).filter(range => range.count > 0);
  }

  private calculateAvailabilityFacets(results: SearchIndex[]): Array<{ name: string; count: number }> {
    const inStock = results.filter(r => r.inStock).length;
    const outOfStock = results.filter(r => !r.inStock).length;
    
    return [
      { name: 'In Stock', count: inStock },
      { name: 'Out of Stock', count: outOfStock }
    ].filter(item => item.count > 0);
  }

  // Search performance optimization
  async optimizeSearchIndex(): Promise<void> {
    try {
      this.logger.info('Optimizing search index...');

      // Rebuild index with latest data
      await this.rebuildSearchIndex();

      // Clear all search-related caches
      const searchKeys = await this.redis.keys('search:*');
      const autocompleteKeys = await this.redis.keys('autocomplete:*');
      const facetKeys = await this.redis.keys('search_facets:*');
      
      const allKeys = [...searchKeys, ...autocompleteKeys, ...facetKeys];
      if (allKeys.length > 0) {
        await this.redis.del(allKeys);
      }

      this.logger.info(`Search index optimized, cleared ${allKeys.length} cache entries`);

    } catch (error) {
      this.logger.error('Error optimizing search index:', error);
    }
  }

  // Health check
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      // Check if search index is loaded
      const indexLoaded = this.searchIndex.length > 0 && this.fuseInstance !== null;
      
      // Check database connectivity
      await this.db.raw('SELECT 1');
      
      // Check Redis connectivity
      await this.redis.ping();
      
      // Test search functionality
      const testSearchStart = Date.now();
      await this.search('matcha', {}, undefined, 1);
      const testSearchTime = Date.now() - testSearchStart;
      
      // Test autocomplete functionality
      const testAutocompleteStart = Date.now();
      await this.getAutocomplete('mat', 1);
      const testAutocompleteTime = Date.now() - testAutocompleteStart;
      
      return {
        status: 'healthy',
        details: {
          database: 'connected',
          redis: 'connected',
          searchIndex: indexLoaded ? 'loaded' : 'not loaded',
          indexSize: this.searchIndex.length,
          testSearchTime,
          testAutocompleteTime,
          avgSearchTime: testSearchTime < 200 ? 'good' : 'slow'
        }
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  // Cleanup methods
  async cleanupOldSearchData(daysToKeep: number = 30): Promise<void> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    const deletedQueries = await this.db('search_queries')
      .where('created_at', '<', cutoffDate)
      .del();
    
    this.logger.info(`Cleaned up ${deletedQueries} old search queries`);
  }

  // Export search data for analysis
  async exportSearchAnalytics(startDate: Date, endDate: Date): Promise<any> {
    const queries = await this.db('search_queries')
      .whereBetween('created_at', [startDate, endDate])
      .select('*')
      .orderBy('created_at', 'desc');

    const analytics = await this.db('analytics')
      .whereBetween('timestamp', [startDate, endDate])
      .whereIn('event', ['search', 'search_click', 'search_purchase'])
      .select('*')
      .orderBy('timestamp', 'desc');

    return {
      queries,
      analytics,
      summary: await this.getSearchAnalytics(Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
    };
  }
}

export default MatchaAdvancedSearch; `${timestamp} [${level.toUpperCase()}] Search: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/search.log' })
      ]
    });

    // Initialize search index on startup
    this.initializeSearchIndex();
  }

  // Main search method with comprehensive filtering and ranking
  async search(
    query: string, 
    filters: SearchFilters = {}, 
    userId?: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ results: MatchaProduct[]; total: number; analytics: any }> {
    const startTime = Date.now();
    const searchId = crypto.randomUUID();
    
    try {
      // Normalize and validate query
      const normalizedQuery = this.normalizeQuery(query);
      if (normalizedQuery.length < this.SEARCH_CONFIG.minQueryLength) {
        return { results: [], total: 0, analytics: { responseTime: Date.now() - startTime } };
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(normalizedQuery, filters, limit, offset);
      const cachedResults = await this.redis.get(cacheKey);
      
      if (cachedResults) {
        const parsed = JSON.parse(cachedResults);
        await this.trackSearch(normalizedQuery, filters, parsed.results.length, Date.now() - startTime, userId, true);
        return parsed;
      }

      // Perform the search
      let searchResults: SearchIndex[];
      
      if (normalizedQuery.length === 0) {
        // No query - return filtered results
        searchResults = await this.getFilteredResults(filters);
      } else {
        // Text search with fuzzy matching
        searchResults = await this.performFuzzySearch(normalizedQuery, filters);
      }

      // Apply additional filtering
      searchResults = this.applyFilters(searchResults, filters);
      
      // Rank and sort results
      searchResults = this.rankResults(searchResults, normalizedQuery, filters);
      
      // Apply pagination
      const total = searchResults.length;
      const paginatedResults = searchResults.slice(offset, offset + limit);
      
      // Convert to full product objects
      const productIds = paginatedResults.map(r => r.id);
      const products = await this.getProductsByIds(productIds);
      
      // Preserve search ranking order
      const orderedProducts = paginatedResults
        .map(result => products.find(p => p.id === result.id))
        .filter(p => p !== undefined) as MatchaProduct[];

      const responseTime = Date.now() - startTime;
      const analytics = {
        responseTime,
        total,
        searchId,
        algorithm: normalizedQuery ? 'fuzzy' : 'filtered',
        cacheHit: false
      };

      // Cache results
      const cacheData = { results: orderedProducts, total, analytics };
      await this.redis.setEx(cacheKey, this.CACHE_TTL.search_results, JSON.stringify(cacheData));

      // Track search analytics
      await this.trackSearch(normalizedQuery, filters, total, responseTime, userId, false);

      return cacheData;

    } catch (error) {
      this.logger.error('Search error:', { error, query, filters, searchId });
      throw error;
    }
  }

  // Advanced autocomplete with intelligent suggestions
  async getAutocomplete(
    query: string, 
    limit: number = 10
  ): Promise<Array<{ text: string; type: string; highlight: string }>> {
    const startTime = Date.now();
    
    try {
      const normalizedQuery = this.normalizeQuery(query);
      if (normalizedQuery.length < 1) return [];

      const cacheKey = `autocomplete:${normalizedQuery}:${limit}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const suggestions: Array<{ text: string; type: string; score: number; highlight: string }> = [];

      // Get suggestions from different sources
      await Promise.all([
        this.getProductNameSuggestions(normalizedQuery, suggestions),
        this.getBrandSuggestions(normalizedQuery, suggestions),
        this.getOriginSuggestions(normalizedQuery, suggestions),
        this.getFlavorSuggestions(normalizedQuery, suggestions),
        this.getGradeSuggestions(normalizedQuery, suggestions),
        this.getPopularQuerySuggestions(normalizedQuery, suggestions)
      ]);

      // Remove duplicates and sort by relevance
      const uniqueSuggestions = this.deduplicateSuggestions(suggestions);
      uniqueSuggestions.sort((a, b) => b.score - a.score);

      const result = uniqueSuggestions
        .slice(0, limit)
        .map(s => ({ text: s.text, type: s.type, highlight: s.highlight }));

      // Cache results
      await this.redis.setEx(cacheKey, this.CACHE_TTL.autocomplete, JSON.stringify(result));

      const responseTime = Date.now() - startTime;
      this.logger.info(`Autocomplete generated ${result.length} suggestions in ${responseTime}ms`);

      return result;

    } catch (error) {
      this.logger.error('Autocomplete error:', error);
      return [];
    }
  }

  // Get search suggestions based on user history and trends
  async getSearchSuggestions(userId?: string, limit: number = 5): Promise<SearchSuggestion[]> {
    try {
      const cacheKey = `search_suggestions:${userId || 'global'}:${limit}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      let suggestions: SearchSuggestion[] = [];

      if (userId) {
        // Personalized suggestions based on user's search history
        suggestions = await this.getPersonalizedSuggestions(userId, limit);
      }

      // Fill remaining slots with trending searches
      if (suggestions.length < limit) {
        const trendingSuggestions = await this.getTrendingSuggestions(limit - suggestions.length);
        suggestions.push(...trendingSuggestions);
      }

      // Cache results
      await this.redis.setEx(cacheKey, this.CACHE_TTL.search_results, JSON.stringify(suggestions));

      return suggestions;

    } catch (error) {
      this.logger.error('Error getting search suggestions:', error);
      return [];
    }
  }

  // Real-time search analytics and reporting
  async getSearchAnalytics(days: number = 7): Promise<SearchAnalytics> {
    try {
      const cacheKey = `search_analytics:${days}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Get search statistics
      const [totalSearches, avgResponseTime, topQueries, zeroResultQueries, popularFilters] = await Promise.all([
        this.getTotalSearches(startDate),
        this.getAverageResponseTime(startDate),
        this.getTopQueries(startDate, 10),
        this.getZeroResultQueries(startDate, 10),
        this.getPopularFilters(startDate)
      ]);

      // Calculate conversion rate (searches that led to clicks)
      const conversionRate = await this.getSearchConversionRate(startDate);

      const analytics: SearchAnalytics = {
        totalSearches,
        avgResponseTime,
        topQueries,
        zeroResultQueries,
        popularFilters,
        conversionRate
      };

      // Cache analytics
      await this.redis.setEx(cacheKey, this.CACHE_TTL.analytics, JSON.stringify(analytics));

      return analytics;

    } catch (error) {
      this.logger.error('Error getting search analytics:', error);
      throw error;
    }
  }

  // Initialize and rebuild search index
  private async initializeSearchIndex(): Promise<void> {
    try {
      this.logger.info('Initializing search index...');

      // Check if cached index exists
      const cachedIndex = await this.redis.get('search_index');
      if (cachedIndex) {
        this.searchIndex = JSON.parse(cachedIndex);
        this.fuseInstance = new Fuse(this.searchIndex, this.FUSE_OPTIONS);
        this.logger.info(`Loaded ${this.searchIndex.length} products from cache`);
        return;
      }

      // Build index from database
      await this.rebuildSearchIndex();

    } catch (error) {
      this.logger.error('Error initializing search index:', error);
    }
  }

  async rebuildSearchIndex(): Promise<void> {
    try {
      this.logger.info('Rebuilding search index from database...');

      const products = await this.db('matcha_products')
        .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
        .select(
          'matcha_products.*',
          'matcha_providers.name as provider_name'
        );

      this.searchIndex = products.map(product => {
        const flavorProfile = JSON.parse(product.flavor_profile) as FlavorProfile[];
        const tags = this.generateProductTags(product, flavorProfile);
        
        return {
          id: product.id,
          name: product.name,
          description: product.description || '',
          grade: product.grade,
          origin: product.origin,
          flavorProfile,
          provider: product.provider_name,
          price: product.price,
          inStock: product.in_stock,
          searchableText: this.createSearchableText(product, product.provider_name, flavorProfile),
          popularity: this.calculatePopularity(product.view_count, product.purchase_count),
          tags
        };
      });

      // Initialize Fuse.js with the new index
      this.fuseInstance = new Fuse(this.searchIndex, this.FUSE_OPTIONS);

      // Cache the index
      await this.redis.setEx('search_index', this.CACHE_TTL.search_index, JSON.stringify(this.searchIndex));

      // Build autocomplete index
      await this.buildAutocompleteIndex();

      this.logger.info(`Search index rebuilt with ${this.searchIndex.length} products`);

    } catch (error) {
      this.logger.error('Error rebuilding search index:', error);
      throw error;
    }
  }

  // Fuzzy search implementation
  private async performFuzzySearch(query: string, filters: SearchFilters): Promise<SearchIndex[]> {
    if (!this.fuseInstance) {
      await this.rebuildSearchIndex();
      if (!this.fuseInstance) {
        throw new Error('Search index not available');
      }
    }

    // Perform fuzzy search
    const fuseResults = this.fuseInstance.search(query);
    
    // Convert Fuse results to SearchIndex array with relevance scores
    const results = fuseResults.map(result => ({
      ...result.item,
      relevanceScore: 1 - (result.score || 0), // Invert score (lower Fuse score = higher relevance)
      matches: result.matches
    }));

    return results;
  }

  // Apply filters to search results
  private applyFilters(results: SearchIndex[], filters: SearchFilters): SearchIndex[] {
    let filteredResults = [...results];

    // Provider filter
    if (filters.providers && filters.providers.length > 0) {
      filteredResults = filteredResults.filter(item => 
        filters.providers!.includes(item.provider)
      );
    }

    // Price range filter
    if (filters.priceRange) {
      filteredResults = filteredResults.filter(item => 
        item.price >= (filters.priceRange!.min || 0) && 
        item.price <= (filters.priceRange!.max || Infinity)
      );
    }

    // Grade filter
    if (filters.grades && filters.grades.length > 0) {
      filteredResults = filteredResults.filter(item => 
        filters.grades!.includes(item.grade)
      );
    }

    // In stock filter
    if (filters.inStockOnly) {
      filteredResults = filteredResults.filter(item => item.inStock);
    }

    // Origin filter
    if (filters.origins && filters.origins.length > 0) {
      filteredResults = filteredResults.filter(item => 
        filters.origins!.some(origin => 
          item.origin.toLowerCase().includes(origin.toLowerCase())
        )
      );
    }

    // Flavor profile filter
    if (filters.flavorProfiles && filters.flavorProfiles.length > 0) {
      filteredResults = filteredResults.filter(item => 
        filters.flavorProfiles!.some(flavor => 
          item.flavorProfile.includes(flavor)
        )
      );
    }

    return filteredResults;
  }

  // Advanced ranking algorithm
  private rankResults(results: SearchIndex[], query: string, filters: SearchFilters): SearchIndex[] {
    const queryLower = query.toLowerCase();
    
    return results.map(item => {
      let score = (item as any).relevanceScore || 0.5;
      
      // Exact name match boost
      if (item.name.toLowerCase() === queryLower) {
        score *= this.SEARCH_CONFIG.boostFactors.exactMatch;
      }
      
      // Name contains query boost
      if (item.name.toLowerCase().includes(queryLower)) {
        score *= this.SEARCH_CONFIG.boostFactors.nameMatch;
      }
      
      // Description contains query boost
      if (item.description.toLowerCase().includes(queryLower)) {
        score *= this.SEARCH_CONFIG.boostFactors.descriptionMatch;
      }
      
      // Brand/provider match boost
      if (item.provider.toLowerCase().includes(queryLower)) {
        score *= this.SEARCH_CONFIG.boostFactors.brandMatch;
      }
      
      // In stock boost
      if (item.inStock) {
        score *= this.SEARCH_CONFIG.boostFactors.inStock;
      }
      
      // Popularity boost
      score *= (1 + (item.popularity * this.SEARCH_CONFIG.boostFactors.popularity));
      
      // Price preference boost (if user has price range, boost items in that range)
      if (filters.priceRange) {
        const { min = 0, max = Infinity } = filters.priceRange;
        if (item.price >= min && item.price <= max) {
          score *= 1.1;
        }
      }
      
      return { ...item, finalScore: score };
    })
    .sort((a, b) => (b as any).finalScore - (a as any).finalScore);
  }

  // Autocomplete suggestion methods
  private async getProductNameSuggestions(query: string, suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Promise<void> {
    const matchingProducts = this.searchIndex.filter(item => 
      item.name.toLowerCase().includes(query.toLowerCase())
    );

    for (const product of matchingProducts.slice(0, 5)) {
      const highlight = this.highlightMatch(product.name, query);
      suggestions.push({
        text: product.name,
        type: 'product',
        score: this.calculateSuggestionScore(product.name, query, product.popularity),
        highlight
      });
    }
  }

  private async getBrandSuggestions(query: string, suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Promise<void> {
    const uniqueBrands = [...new Set(this.searchIndex.map(item => item.provider))];
    
    for (const brand of uniqueBrands) {
      if (brand.toLowerCase().includes(query.toLowerCase())) {
        const highlight = this.highlightMatch(brand, query);
        const brandProductCount = this.searchIndex.filter(item => item.provider === brand).length;
        
        suggestions.push({
          text: brand,
          type: 'brand',
          score: this.calculateSuggestionScore(brand, query, brandProductCount * 0.1),
          highlight
        });
      }
    }
  }

  private async getOriginSuggestions(query: string, suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Promise<void> {
    const uniqueOrigins = [...new Set(this.searchIndex.map(item => item.origin))];
    
    for (const origin of uniqueOrigins) {
      if (origin.toLowerCase().includes(query.toLowerCase())) {
        const highlight = this.highlightMatch(origin, query);
        const originProductCount = this.searchIndex.filter(item => item.origin === origin).length;
        
        suggestions.push({
          text: origin,
          type: 'origin',
          score: this.calculateSuggestionScore(origin, query, originProductCount * 0.1),
          highlight
        });
      }
    }
  }

  private async getFlavorSuggestions(query: string, suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Promise<void> {
    const allFlavors = Object.values(FlavorProfile);
    
    for (const flavor of allFlavors) {
      if (flavor.toLowerCase().includes(query.toLowerCase())) {
        const highlight = this.highlightMatch(flavor, query);
        const flavorProductCount = this.searchIndex.filter(item => 
          item.flavorProfile.includes(flavor as FlavorProfile)
        ).length;
        
        suggestions.push({
          text: flavor,
          type: 'flavor',
          score: this.calculateSuggestionScore(flavor, query, flavorProductCount * 0.05),
          highlight
        });
      }
    }
  }

  private async getGradeSuggestions(query: string, suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Promise<void> {
    const allGrades = Object.values(MatchaGrade);
    
    for (const grade of allGrades) {
      if (grade.toLowerCase().includes(query.toLowerCase())) {
        const highlight = this.highlightMatch(grade, query);
        const gradeProductCount = this.searchIndex.filter(item => item.grade === grade).length;
        
        suggestions.push({
          text: grade,
          type: 'grade',
          score: this.calculateSuggestionScore(grade, query, gradeProductCount * 0.1),
          highlight
        });
      }
    }
  }

  private async getPopularQuerySuggestions(query: string, suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Promise<void> {
    // Get popular search queries from analytics
    const popularQueries = await this.db('search_queries')
      .select('query')
      .where('query', 'like', `%${query}%`)
      .groupBy('query')
      .orderByRaw('COUNT(*) DESC')
      .limit(3);

    for (const queryResult of popularQueries) {
      const highlight = this.highlightMatch(queryResult.query, query);
      suggestions.push({
        text: queryResult.query,
        type: 'query',
        score: this.calculateSuggestionScore(queryResult.query, query, 0.3),
        highlight
      });
    }
  }

  // Analytics methods
  private async trackSearch(
    query: string, 
    filters: SearchFilters, 
    resultCount: number, 
    responseTime: number, 
    userId?: string, 
    cacheHit: boolean = false
  ): Promise<void> {
    try {
      const searchId = crypto.randomUUID();
      
      // Save search query
      await this.db('search_queries').insert({
        id: searchId,
        user_id: userId || null,
        query,
        filters: JSON.stringify(filters),
        results: JSON.stringify([]), // Will be updated with actual results if needed
        response_time: responseTime,
        click_through_rate: 0 // Will be updated when user clicks
      });

      // Track in analytics
      await this.db('analytics').insert({
        event: 'search',
        user_id: userId || null,
        session_id: 'search-session',
        data: JSON.stringify({
          query,
          filters,
          resultCount,
          responseTime,
          cacheHit,
          searchId
        }),
        ip_address: '0.0.0.0',
        user_agent: 'search-service',
        timestamp: new Date()
      });

    } catch (error) {
      this.logger.error('Error tracking search:', error);
    }
  }

  // Utility methods
  private normalizeQuery(query: string): string {
    return query
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' '); // Normalize whitespace
  }

  private generateCacheKey(query: string, filters: SearchFilters, limit: number, offset: number): string {
    const filterHash = crypto
      .createHash('md5')
      .update(JSON.stringify(filters))
      .digest('hex');
    
    return `search:${query}:${filterHash}:${limit}:${offset}`;
  }

  private createSearchableText(product: any, provider: string, flavorProfile: FlavorProfile[]): string {
    return [
      product.name,
      product.description,
      provider,
      product.origin,
      product.grade,
      ...flavorProfile,
      product.size
    ].filter(Boolean).join(' ').toLowerCase();
  }

  private generateProductTags(product: any, flavorProfile: FlavorProfile[]): string[] {
    const tags: string[] = [];
    
    // Add grade tag
    tags.push(product.grade);
    
    // Add flavor tags
    tags.push(...flavorProfile);
    
    // Add origin tag
    tags.push(product.origin);
    
    // Add price range tags
    if (product.price < 20) tags.push('budget');
    else if (product.price < 50) tags.push('mid-range');
    else tags.push('premium');
    
    // Add size tags
    if (product.weight < 20) tags.push('small');
    else if (product.weight < 50) tags.push('medium');
    else tags.push('large');
    
    return tags;
  }

  private calculatePopularity(viewCount: number, purchaseCount: number): number {
    return (viewCount * 0.1) + (purchaseCount * 1.0);
  }

  private calculateSuggestionScore(text: string, query: string, popularity: number): number {
    const exactMatch = text.toLowerCase() === query.toLowerCase() ? 1.0 : 0.0;
    const startsWith = text.toLowerCase().startsWith(query.toLowerCase()) ? 0.8 : 0.0;
    const contains = text.toLowerCase().includes(query.toLowerCase()) ? 0.6 : 0.0;
    const popularityScore = Math.min(popularity, 1.0);
    
    return Math.max(exactMatch, startsWith, contains) + (popularityScore * 0.2);
  }

  private highlightMatch(text: string, query: string): string {
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  private deduplicateSuggestions(suggestions: Array<{ text: string; type: string; score: number; highlight: string }>): Array<{ text: string; type: string; score: number; highlight: string }> {
    const seen = new Set<string>();
    return suggestions.filter(suggestion => {
      const key = `${suggestion.text}:${suggestion.type}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async getFilteredResults(filters: SearchFilters): Promise<SearchIndex[]> {
    let results = [...this.searchIndex];
    return this.applyFilters(results, filters);
  }

  private async getProductsByIds(productIds: string[]): Promise<MatchaProduct[]> {
    return await this.db('matcha_products')
      .whereIn('id', productIds)
      .select('*');
  }

  private async buildAutocompleteIndex(): Promise<void> {
    // This would build a more sophisticated autocomplete index
    // For now, we'll use the search index directly in the autocomplete methods
    this.logger.info('Autocomplete index built');
  }

  // Analytics helper methods
  private async getTotalSearches(startDate: Date): Promise<number> {
    const result = await this.db('search_queries')
      .where('created_at', '>', startDate)
      .count('* as count')
      .first();
    
    return parseInt(result?.count || '0');
  }

  private async getAverageResponseTime(startDate: Date): Promise<number> {
    const result = await this.db('search_queries')
      .where('created_at', '>', startDate)
      .avg('response_time as avg')
      .first();
    
    return parseFloat(result?.avg || '0');
  }

  private async getTopQueries(startDate: Date, limit: number): Promise<Array<{ query: string; count: number; ctr: number }>> {
    const results = await this.db('search_queries')
      .select('query')
      .where('created_at', '>', startDate)
      .groupBy('query')
      .orderByRaw('COUNT(*) DESC')
      .limit(limit)
      .select(
        'query',
        this.db.raw('COUNT(*) as count'),
        this.db.raw('AVG(click_through_rate) as ctr')
      );

    return results.map(r => ({
      query: r.query,
      count: parseInt(r.count),
      ctr: parseFloat(r.ctr || '0')
    }));
  }

  private async getZeroResultQueries(startDate: Date, limit: number): Promise<Array<{ query: string; count: number }>> {
    const results = await this.db('search_queries')
      .select('query')
      .where('created_at', '>', startDate)
      .whereRaw("JSON_LENGTH(results) = 0")
      .groupBy('query')
      .orderByRaw('COUNT(*) DESC')
      .limit(limit)
      .select(
        'query',
        this.db.raw('COUNT(*) as count')
      );

    return
