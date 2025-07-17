import { Knex } from 'knex';
import Redis from 'redis';
import { SearchFilters, MatchaProduct } from '@/types';
export declare class MatchaAdvancedSearch {
    private db;
    private redis;
    private logger;
    constructor(database: Knex, redisClient: Redis.RedisClientType);
    search(query: string, filters?: SearchFilters, userId?: string, limit?: number, offset?: number): Promise<{
        results: MatchaProduct[];
        total: number;
        analytics: {
            responseTime: number;
        };
    }>;
    getAutocomplete(query: string, limit?: number): Promise<{
        success: boolean;
        data: any[];
    }>;
    getSearchSuggestions(userId?: string, limit?: number): Promise<{
        success: boolean;
        data: any[];
    }>;
    getSearchAnalytics(days?: number): Promise<{
        totalSearches: number;
        avgResponseTime: number;
        topQueries: any[];
        zeroResultQueries: any[];
        popularFilters: {};
        conversionRate: number;
    }>;
    rebuildSearchIndex(): Promise<void>;
    optimizeSearchIndex(): Promise<void>;
    getSearchFacets(query?: string, filters?: SearchFilters): Promise<{
        providers: any[];
        grades: any[];
        origins: any[];
        flavorProfiles: any[];
        priceRanges: any[];
        availability: any[];
    }>;
    cleanupOldSearchData(daysToKeep?: number): Promise<void>;
    trackSearchClick(searchId: string, productId: string, position: number): Promise<void>;
    healthCheck(): Promise<{
        status: string;
        details: {
            database: string;
            indexSize: number;
            error?: undefined;
        };
    } | {
        status: string;
        details: {
            error: string;
            database?: undefined;
            indexSize?: undefined;
        };
    }>;
    private formatProduct;
}
export default MatchaAdvancedSearch;
