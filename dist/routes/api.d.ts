import express from 'express';
import { Knex } from 'knex';
import Redis from 'redis';
import MatchaAdvancedSearch from '@/services/search';
import MatchaRecommendationEngine from '@/services/recommendations';
import MatchaWebScraper from '@/services/scraper';
export declare function createApiRoutes(db: Knex, redis: Redis.RedisClientType, searchService: MatchaAdvancedSearch, recommendationService: MatchaRecommendationEngine, scraperService: MatchaWebScraper): express.Router;
export default createApiRoutes;
