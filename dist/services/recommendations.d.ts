import { Knex } from 'knex';
import Redis from 'redis';
import { Recommendation, MatchaProduct } from '@/types';
export declare class MatchaRecommendationEngine {
    private db;
    private redis;
    private logger;
    constructor(database: Knex, redisClient: Redis.RedisClientType);
    generateRecommendations(userId: string, limit?: number): Promise<Recommendation[]>;
    getProductRecommendations(productId: string, limit?: number): Promise<MatchaProduct[]>;
    trackRecommendationClick(recommendationId: string): Promise<void>;
    getRecommendationAnalytics(experimentName: string, days?: number): Promise<any>;
    generateBatchRecommendations(userIds: string[], limit?: number): Promise<Map<string, Recommendation[]>>;
    updateRecommendationsOnPurchase(userId: string, productId: string): Promise<void>;
    refreshAllCaches(): Promise<void>;
    cleanupOldRecommendations(daysToKeep?: number): Promise<void>;
    getPerformanceMetrics(): Promise<any>;
    healthCheck(): Promise<{
        status: string;
        details: any;
    }>;
    private formatProduct;
}
export default MatchaRecommendationEngine;
