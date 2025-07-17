import { Request, Response } from 'express';
import { Knex } from 'knex';
import Redis from 'redis';
import MatchaAdvancedSearch from '@/services/search';
import MatchaRecommendationEngine from '@/services/recommendations';
export declare class ProductController {
    private db;
    private redis;
    private logger;
    private searchService;
    private recommendationService;
    constructor(database: Knex, redisClient: Redis.RedisClientType, searchService: MatchaAdvancedSearch, recommendationService: MatchaRecommendationEngine);
    getProducts: (req: Request, res: Response) => Promise<void>;
    getProductById: (req: Request, res: Response) => Promise<void>;
    searchProducts: (req: Request, res: Response) => Promise<void>;
    getAutocomplete: (req: Request, res: Response) => Promise<void>;
    getSearchSuggestions: (req: Request, res: Response) => Promise<void>;
    getRecommendations: (req: Request, res: Response) => Promise<void>;
    trackRecommendationClick: (req: Request, res: Response) => Promise<void>;
    trackSearchClick: (req: Request, res: Response) => Promise<void>;
    getTrendingProducts: (req: Request, res: Response) => Promise<void>;
    getFeaturedProducts: (req: Request, res: Response) => Promise<void>;
    getProductFilters: (req: Request, res: Response) => Promise<void>;
    private formatProduct;
    private incrementViewCount;
    private trackProductView;
    private trackProductListView;
    private getProductsByIds;
    private createSuccessResponse;
    private createErrorResponse;
}
export declare const productValidations: {
    getProducts: import("express-validator").ValidationChain[];
    getProductById: import("express-validator").ValidationChain[];
    searchProducts: import("express-validator").ValidationChain[];
    getAutocomplete: import("express-validator").ValidationChain[];
    trackSearchClick: import("express-validator").ValidationChain[];
};
export default ProductController;
