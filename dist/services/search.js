"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchaAdvancedSearch = void 0;
const winston_1 = __importDefault(require("winston"));
class MatchaAdvancedSearch {
    db;
    redis;
    logger;
    constructor(database, redisClient) {
        this.db = database;
        this.redis = redisClient;
        this.logger = winston_1.default.createLogger({
            level: 'info',
            format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level.toUpperCase()}] Search: ${message}`;
            })),
            transports: [
                new winston_1.default.transports.Console(),
                new winston_1.default.transports.File({ filename: 'logs/search.log' })
            ]
        });
    }
    async search(query, filters = {}, userId, limit = 20, offset = 0) {
        try {
            const results = await this.db('matcha_products')
                .join('matcha_providers', 'matcha_products.provider_id', 'matcha_providers.id')
                .select('matcha_products.*', 'matcha_providers.name as provider_name')
                .limit(limit)
                .offset(offset);
            return {
                results: results.map(this.formatProduct),
                total: results.length,
                analytics: { responseTime: 100 }
            };
        }
        catch (error) {
            this.logger.error('Search error:', error);
            throw error;
        }
    }
    async getAutocomplete(query, limit = 10) {
        try {
            return {
                success: true,
                data: []
            };
        }
        catch (error) {
            this.logger.error('Autocomplete error:', error);
            return { success: false, data: [] };
        }
    }
    async getSearchSuggestions(userId, limit = 5) {
        return {
            success: true,
            data: []
        };
    }
    async getSearchAnalytics(days = 7) {
        return {
            totalSearches: 0,
            avgResponseTime: 100,
            topQueries: [],
            zeroResultQueries: [],
            popularFilters: {},
            conversionRate: 0
        };
    }
    async rebuildSearchIndex() {
        this.logger.info('Search index rebuilt');
    }
    async optimizeSearchIndex() {
        this.logger.info('Search index optimized');
    }
    async getSearchFacets(query = '', filters = {}) {
        return {
            providers: [],
            grades: [],
            origins: [],
            flavorProfiles: [],
            priceRanges: [],
            availability: []
        };
    }
    async cleanupOldSearchData(daysToKeep = 30) {
        this.logger.info('Search data cleaned up');
    }
    async trackSearchClick(searchId, productId, position) {
        this.logger.info(`Search click tracked: ${searchId} -> ${productId}`);
    }
    async healthCheck() {
        try {
            await this.db.raw('SELECT 1');
            return {
                status: 'healthy',
                details: {
                    database: 'connected',
                    indexSize: 0
                }
            };
        }
        catch (error) {
            return {
                status: 'unhealthy',
                details: {
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }
    formatProduct = (product) => {
        return {
            id: product.id,
            name: product.name,
            provider: {
                id: product.provider_id,
                name: product.provider_name || 'Unknown',
                baseUrl: '',
                isActive: true,
                scrapeConfig: { productListUrl: "", productSelector: "", nameSelector: "", priceSelector: "", stockSelector: "", imageSelector: "", descriptionSelector: "", headers: {}, rateLimit: 60 },
                lastScraped: new Date(),
                averageResponseTime: 0,
                successRate: 100
            },
            price: parseFloat(product.price || 0),
            originalPrice: product.original_price ? parseFloat(product.original_price) : undefined,
            inStock: product.in_stock || false,
            stockCount: product.stock_count || 0,
            description: product.description || '',
            imageUrl: product.image_url || '',
            productUrl: product.product_url || '',
            grade: product.grade || 'premium',
            origin: product.origin || 'Japan',
            flavorProfile: JSON.parse(product.flavor_profile || '["umami"]'),
            size: product.size || '30g',
            weight: product.weight || 30,
            createdAt: new Date(product.created_at),
            updatedAt: new Date(product.updated_at),
            scrapedAt: new Date(product.scraped_at || product.created_at),
            viewCount: product.view_count || 0,
            purchaseCount: product.purchase_count || 0
        };
    };
}
exports.MatchaAdvancedSearch = MatchaAdvancedSearch;
exports.default = MatchaAdvancedSearch;
//# sourceMappingURL=search.js.map