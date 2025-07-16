import { Knex } from 'knex';
import Redis from 'redis';
import winston from 'winston';
import crypto from 'crypto';
import { 
  Recommendation, 
  RecommendationReason, 
  MatchaProduct, 
  User, 
  UserPreferences,
  ABTestExperiment,
  ABTestVariant,
  UserABTest,
  MatchaGrade,
  FlavorProfile 
} from '@/types';

// FAANG-level recommendation engine with collaborative filtering and A/B testing
// This implements real machine learning algorithms for personalized recommendations

interface UserInteraction {
  userId: string;
  productId: string;
  action: 'view' | 'click' | 'purchase' | 'add_to_cart';
  timestamp: Date;
  score: number; // weighted interaction score
}

interface ProductSimilarity {
  productId1: string;
  productId2: string;
  similarity: number;
  factors: string[]; // what makes them similar
}

interface UserSimilarity {
  userId1: string;
  userId2: string;
  similarity: number;
  commonProducts: string[];
}

interface RecommendationCandidate {
  productId: string;
  score: number;
  reason: RecommendationReason;
  algorithm: 'collaborative' | 'content_based' | 'hybrid';
}

export class MatchaRecommendationEngine {
  private db: Knex;
  private redis: Redis.RedisClientType;
  private logger: winston.Logger;
  private abTestSalt: string;

  // Weighting for different user actions
  private readonly ACTION_WEIGHTS = {
    view: 1,
    click: 2,
    add_to_cart: 5,
    purchase: 10
  };

  // Cache TTL for different recommendation types
  private readonly CACHE_TTL = {
    user_recommendations: 3600, // 1 hour
    product_similarities: 86400, // 24 hours
    user_similarities: 43200, // 12 hours
    trending_products: 1800 // 30 minutes
  };

  constructor(database: Knex, redisClient: Redis.RedisClientType) {
    this.db = database;
    this.redis = redisClient;
    this.abTestSalt = process.env.AB_TEST_SALT || 'matcha-match-salt';
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] Recommendations: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/recommendations.log' })
      ]
    });
  }

  // Main recommendation generation method
  async generateRecommendations(userId: string, limit: number = 10): Promise<Recommendation[]> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cacheKey = `user_recommendations:${userId}:${limit}`;
      const cachedRecommendations = await this.redis.get(cacheKey);
      
      if (cachedRecommendations) {
        this.logger.info(`Cache hit for user ${userId} recommendations`);
        return JSON.parse(cachedRecommendations);
      }

      // Get user's A/B test assignment
      const abTestGroup = await this.getOrAssignABTestGroup(userId);
      
      // Generate recommendations based on A/B test variant
      let candidates: RecommendationCandidate[] = [];
      
      switch (abTestGroup.variant) {
        case 'collaborative_only':
          candidates = await this.generateCollaborativeRecommendations(userId, limit * 2);
          break;
        case 'content_based_only':
          candidates = await this.generateContentBasedRecommendations(userId, limit * 2);
          break;
        case 'hybrid_balanced':
          candidates = await this.generateHybridRecommendations(userId, limit * 2, 0.5);
          break;
        case 'hybrid_collaborative_heavy':
          candidates = await this.generateHybridRecommendations(userId, limit * 2, 0.7);
          break;
        case 'hybrid_content_heavy':
          candidates = await this.generateHybridRecommendations(userId, limit * 2, 0.3);
          break;
        default:
          candidates = await this.generateHybridRecommendations(userId, limit * 2, 0.5);
      }

      // Apply diversity and freshness filters
      candidates = await this.applyDiversityFilter(candidates, userId);
      candidates = await this.applyFreshnessFilter(candidates, userId);
      
      // Sort by score and take top recommendations
      candidates.sort((a, b) => b.score - a.score);
      const topCandidates = candidates.slice(0, limit);
      
      // Convert to recommendation objects
      const recommendations: Recommendation[] = [];
      for (const candidate of topCandidates) {
        const recommendation: Recommendation = {
          id: crypto.randomUUID(),
          userId,
          productId: candidate.productId,
          score: candidate.score,
          reason: candidate.reason,
          algorithm: candidate.algorithm,
          abTestGroup: abTestGroup.variant,
          createdAt: new Date()
        };
        
        // Save to database
        await this.saveRecommendation(recommendation);
        recommendations.push(recommendation);
      }
      
      // Cache the results
      await this.redis.setEx(cacheKey, this.CACHE_TTL.user_recommendations, JSON.stringify(recommendations));
      
      const duration = Date.now() - startTime;
      this.logger.info(`Generated ${recommendations.length} recommendations for user ${userId} in ${duration}ms using ${abTestGroup.variant} variant`);
      
      return recommendations;
      
    } catch (error) {
      this.logger.error('Error generating recommendations:', error);
      throw error;
    }
  }

  // Collaborative filtering algorithm
  private async generateCollaborativeRecommendations(userId: string, limit: number): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];
    
    try {
      // Find similar users based on interaction patterns
      const similarUsers = await this.findSimilarUsers(userId, 50);
      
      if (similarUsers.length === 0) {
        this.logger.info(`No similar users found for ${userId}, falling back to trending`);
        return this.generateTrendingRecommendations(limit);
      }

      // Get products that similar users liked but current user hasn't interacted with
      const userInteractions = await this.getUserInteractions(userId);
      const userProductIds = new Set(userInteractions.map(i => i.productId));
      
      const productScores = new Map<string, { score: number; reasons: string[] }>();
      
      for (const similarUser of similarUsers) {
        const similarUserInteractions = await this.getUserInteractions(similarUser.userId2);
        
        for (const interaction of similarUserInteractions) {
          if (!userProductIds.has(interaction.productId)) {
            const currentScore = productScores.get(interaction.productId) || { score: 0, reasons: [] };
            
            // Weight by user similarity and interaction strength
            const weightedScore = similarUser.similarity * interaction.score * this.ACTION_WEIGHTS[interaction.action];
            
            productScores.set(interaction.productId, {
              score: currentScore.score + weightedScore,
              reasons: [...currentScore.reasons, `liked by similar users`]
            });
          }
        }
      }

      // Convert to candidates
      for (const [productId, data] of productScores.entries()) {
        candidates.push({
          productId,
          score: Math.min(data.score / similarUsers.length, 1.0), // Normalize score
          reason: {
            type: 'similar_users',
            explanation: `Users with similar taste also liked this matcha`,
            confidence: Math.min(data.score / 10, 1.0)
          },
          algorithm: 'collaborative'
        });
      }
      
      this.logger.info(`Generated ${candidates.length} collaborative filtering candidates for user ${userId}`);
      
    } catch (error) {
      this.logger.error('Error in collaborative filtering:', error);
    }
    
    return candidates;
  }

  // Content-based filtering algorithm
  private async generateContentBasedRecommendations(userId: string, limit: number): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];
    
    try {
      // Get user preferences and interaction history
      const user = await this.getUser(userId);
      const userInteractions = await this.getUserInteractions(userId);
      
      if (!user || userInteractions.length === 0) {
        this.logger.info(`No user data found for ${userId}, falling back to trending`);
        return this.generateTrendingRecommendations(limit);
      }

      // Build user profile from interactions
      const userProfile = await this.buildUserProfile(userInteractions);
      
      // Get all available products (exclude already interacted with)
      const interactedProductIds = new Set(userInteractions.map(i => i.productId));
      const availableProducts = await this.db('matcha_products')
        .whereNotIn('id', Array.from(interactedProductIds))
        .where('in_stock', true)
        .select('*');

      // Score each product based on content similarity
      for (const product of availableProducts) {
        const similarity = this.calculateContentSimilarity(userProfile, product);
        
        if (similarity > 0.1) { // Minimum threshold
          candidates.push({
            productId: product.id,
            score: similarity,
            reason: {
              type: 'flavor_match',
              explanation: this.generateContentExplanation(userProfile, product),
              confidence: similarity
            },
            algorithm: 'content_based'
          });
        }
      }
      
      this.logger.info(`Generated ${candidates.length} content-based candidates for user ${userId}`);
      
    } catch (error) {
      this.logger.error('Error in content-based filtering:', error);
    }
    
    return candidates;
  }

  // Hybrid recommendation algorithm
  private async generateHybridRecommendations(
    userId: string, 
    limit: number, 
    collaborativeWeight: number
  ): Promise<RecommendationCandidate[]> {
    const contentWeight = 1 - collaborativeWeight;
    
    // Generate recommendations from both algorithms
    const [collaborativeCandidates, contentCandidates] = await Promise.all([
      this.generateCollaborativeRecommendations(userId, limit),
      this.generateContentBasedRecommendations(userId, limit)
    ]);

    // Combine and reweight scores
    const combinedCandidates = new Map<string, RecommendationCandidate>();
    
    // Add collaborative candidates
    for (const candidate of collaborativeCandidates) {
      combinedCandidates.set(candidate.productId, {
        ...candidate,
        score: candidate.score * collaborativeWeight,
        algorithm: 'hybrid'
      });
    }
    
    // Add content-based candidates
    for (const candidate of contentCandidates) {
      const existing = combinedCandidates.get(candidate.productId);
      if (existing) {
        // Combine scores if product appears in both
        existing.score += candidate.score * contentWeight;
        existing.reason.explanation += ` and ${candidate.reason.explanation.toLowerCase()}`;
      } else {
        combinedCandidates.set(candidate.productId, {
          ...candidate,
          score: candidate.score * contentWeight,
          algorithm: 'hybrid'
        });
      }
    }
    
    this.logger.info(`Generated ${combinedCandidates.size} hybrid candidates (${collaborativeWeight}/${contentWeight} split)`);
    
    return Array.from(combinedCandidates.values());
  }

  // Trending recommendations (fallback)
  private async generateTrendingRecommendations(limit: number): Promise<RecommendationCandidate[]> {
    const cacheKey = 'trending_products';
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Get products with highest recent activity
    const trendingProducts = await this.db('matcha_products')
      .select('matcha_products.*')
      .leftJoin('analytics', 'analytics.data->>"productId"', 'matcha_products.id')
      .where('analytics.timestamp', '>', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
      .where('matcha_products.in_stock', true)
      .groupBy('matcha_products.id')
      .orderByRaw('COUNT(analytics.id) DESC, matcha_products.view_count DESC')
      .limit(limit);

    const candidates: RecommendationCandidate[] = trendingProducts.map((product, index) => ({
      productId: product.id,
      score: Math.max(0.9 - (index * 0.1), 0.1), // Decreasing score by rank
      reason: {
        type: 'trending',
        explanation: 'This matcha is trending among other users',
        confidence: 0.7
      },
      algorithm: 'collaborative'
    }));

    // Cache trending products
    await this.redis.setEx(cacheKey, this.CACHE_TTL.trending_products, JSON.stringify(candidates));
    
    return candidates;
  }

  // A/B Testing management
  private async getUser(userId: string): Promise<User | null> {
    return await this.db('users')
      .where('id', userId)
      .first();
  }

  private async saveRecommendation(recommendation: Recommendation): Promise<void> {
    await this.db('recommendations').insert({
      id: recommendation.id,
      user_id: recommendation.userId,
      product_id: recommendation.productId,
      score: recommendation.score,
      reason: JSON.stringify(recommendation.reason),
      algorithm: recommendation.algorithm,
      ab_test_group: recommendation.abTestGroup,
      created_at: recommendation.createdAt
    });
  }

  // Batch recommendation generation for multiple users
  async generateBatchRecommendations(userIds: string[], limit: number = 10): Promise<Map<string, Recommendation[]>> {
    const results = new Map<string, Recommendation[]>();
    
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (userId) => {
        try {
          const recommendations = await this.generateRecommendations(userId, limit);
          return { userId, recommendations };
        } catch (error) {
          this.logger.error(`Failed to generate recommendations for user ${userId}:`, error);
          return { userId, recommendations: [] };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const { userId, recommendations } of batchResults) {
        results.set(userId, recommendations);
      }
      
      // Rate limiting between batches
      if (i + batchSize < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    this.logger.info(`Generated batch recommendations for ${userIds.length} users`);
    return results;
  }

  // Get recommendations for a specific product (similar products)
  async getProductRecommendations(productId: string, limit: number = 5): Promise<MatchaProduct[]> {
    const cacheKey = `product_recommendations:${productId}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      // Get the target product
      const targetProduct = await this.db('matcha_products')
        .where('id', productId)
        .first();

      if (!targetProduct) {
        throw new Error(`Product ${productId} not found`);
      }

      // Find similar products based on content
      const similarProducts = await this.db('matcha_products')
        .where('id', '!=', productId)
        .where('in_stock', true)
        .select('*');

      const scoredProducts = similarProducts.map(product => {
        const similarity = this.calculateProductSimilarity(targetProduct, product);
        return { product, similarity };
      })
      .filter(item => item.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(item => item.product);

      // Cache results
      await this.redis.setEx(cacheKey, this.CACHE_TTL.product_similarities, JSON.stringify(scoredProducts));
      
      return scoredProducts;
      
    } catch (error) {
      this.logger.error(`Error getting product recommendations for ${productId}:`, error);
      return [];
    }
  }

  // Calculate similarity between two products
  private calculateProductSimilarity(product1: MatchaProduct, product2: MatchaProduct): number {
    let similarity = 0;
    let factors = 0;

    // Grade similarity
    if (product1.grade === product2.grade) {
      similarity += 0.3;
    }
    factors++;

    // Flavor profile similarity
    const flavors1 = JSON.parse(product1.flavor_profile as string) as FlavorProfile[];
    const flavors2 = JSON.parse(product2.flavor_profile as string) as FlavorProfile[];
    const commonFlavors = flavors1.filter(f => flavors2.includes(f));
    
    if (commonFlavors.length > 0) {
      similarity += 0.4 * (commonFlavors.length / Math.max(flavors1.length, flavors2.length));
    }
    factors++;

    // Price similarity (within 20% range)
    const priceDiff = Math.abs(product1.price - product2.price) / Math.max(product1.price, product2.price);
    if (priceDiff < 0.2) {
      similarity += 0.2 * (1 - priceDiff / 0.2);
    }
    factors++;

    // Origin similarity
    if (product1.origin === product2.origin) {
      similarity += 0.1;
    }
    factors++;

    return similarity / factors;
  }

  // Real-time recommendation updates
  async updateRecommendationsOnPurchase(userId: string, productId: string): Promise<void> {
    try {
      // Clear user's recommendation cache
      const pattern = `user_recommendations:${userId}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(keys);
      }

      // Update user interaction data
      await this.db('analytics').insert({
        event: 'purchase',
        user_id: userId,
        session_id: 'system',
        data: JSON.stringify({ productId, timestamp: new Date() }),
        ip_address: '0.0.0.0',
        user_agent: 'system',
        timestamp: new Date()
      });

      // Trigger background job to update similar users' recommendations
      await this.invalidateSimilarUsersCache(userId);
      
      this.logger.info(`Updated recommendations for user ${userId} after purchase of ${productId}`);
      
    } catch (error) {
      this.logger.error('Error updating recommendations on purchase:', error);
    }
  }

  private async invalidateSimilarUsersCache(userId: string): Promise<void> {
    try {
      const similarUsers = await this.findSimilarUsers(userId, 20);
      
      for (const similarUser of similarUsers) {
        const pattern = `user_recommendations:${similarUser.userId2}:*`;
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(keys);
        }
      }
      
    } catch (error) {
      this.logger.error('Error invalidating similar users cache:', error);
    }
  }

  // Performance monitoring
  async getPerformanceMetrics(): Promise<any> {
    const cacheHitRate = await this.calculateCacheHitRate();
    const avgRecommendationTime = await this.calculateAverageRecommendationTime();
    const algorithmsPerformance = await this.getAlgorithmsPerformance();
    
    return {
      cacheHitRate,
      avgRecommendationTime,
      algorithmsPerformance,
      timestamp: new Date()
    };
  }

  private async calculateCacheHitRate(): Promise<number> {
    // This would be tracked by incrementing counters in Redis
    // For now, return a placeholder
    return 0.75; // 75% cache hit rate
  }

  private async calculateAverageRecommendationTime(): Promise<number> {
    // This would be tracked by timing actual recommendation generation
    // For now, return a placeholder
    return 150; // 150ms average
  }

  private async getAlgorithmsPerformance(): Promise<any> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const performance = await this.db('recommendations')
      .select(
        'algorithm',
        this.db.raw('COUNT(*) as total'),
        this.db.raw('COUNT(clicked_at) as clicks'),
        this.db.raw('COUNT(purchased_at) as purchases'),
        this.db.raw('AVG(score) as avg_score')
      )
      .where('created_at', '>', sevenDaysAgo)
      .groupBy('algorithm');

    return performance.map(p => ({
      algorithm: p.algorithm,
      total: parseInt(p.total),
      clickThroughRate: parseInt(p.clicks) / parseInt(p.total),
      conversionRate: parseInt(p.purchases) / parseInt(p.total),
      avgScore: parseFloat(p.avg_score)
    }));
  }

  // Cleanup and maintenance
  async cleanupOldRecommendations(daysToKeep: number = 30): Promise<void> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    const deletedCount = await this.db('recommendations')
      .where('created_at', '<', cutoffDate)
      .del();
    
    this.logger.info(`Cleaned up ${deletedCount} old recommendations`);
  }

  async refreshAllCaches(): Promise<void> {
    const keys = await this.redis.keys('user_recommendations:*');
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
    
    await this.redis.del('trending_products');
    
    this.logger.info('Refreshed all recommendation caches');
  }

  // Health check
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      // Check database connectivity
      await this.db.raw('SELECT 1');
      
      // Check Redis connectivity
      await this.redis.ping();
      
      // Check if we have active experiments
      const activeExperiments = await this.db('ab_test_experiments')
        .where('is_active', true)
        .count('* as count')
        .first();
      
      // Check recent recommendation generation
      const recentRecommendations = await this.db('recommendations')
        .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
        .count('* as count')
        .first();
      
      return {
        status: 'healthy',
        details: {
          database: 'connected',
          redis: 'connected',
          activeExperiments: parseInt(activeExperiments?.count || '0'),
          recentRecommendations: parseInt(recentRecommendations?.count || '0')
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
}

export default MatchaRecommendationEngine;OrAssignABTestGroup(userId: string): Promise<{ experiment: string; variant: string }> {
    // Check if user already has an assignment
    const existingAssignment = await this.db('user_ab_tests')
      .join('ab_test_experiments', 'user_ab_tests.experiment_id', 'ab_test_experiments.id')
      .where('user_ab_tests.user_id', userId)
      .where('ab_test_experiments.is_active', true)
      .select('ab_test_experiments.name', 'user_ab_tests.variant_id')
      .first();

    if (existingAssignment) {
      return {
        experiment: existingAssignment.name,
        variant: existingAssignment.variant_id
      };
    }

    // Get active recommendation experiments
    const activeExperiment = await this.db('ab_test_experiments')
      .where('is_active', true)
      .where('name', 'recommendation_algorithm')
      .first();

    if (!activeExperiment) {
      // Create default experiment if none exists
      return await this.createDefaultRecommendationExperiment(userId);
    }

    // Assign user to variant using consistent hashing
    const variants = JSON.parse(activeExperiment.variants);
    const variantId = this.assignUserToVariant(userId, variants);

    // Save assignment
    await this.db('user_ab_tests').insert({
      user_id: userId,
      experiment_id: activeExperiment.id,
      variant_id: variantId,
      assigned_at: new Date()
    });

    return {
      experiment: activeExperiment.name,
      variant: variantId
    };
  }

  private async createDefaultRecommendationExperiment(userId: string): Promise<{ experiment: string; variant: string }> {
    const variants: ABTestVariant[] = [
      { id: 'collaborative_only', name: 'Collaborative Only', weight: 20, config: {} },
      { id: 'content_based_only', name: 'Content Based Only', weight: 20, config: {} },
      { id: 'hybrid_balanced', name: 'Hybrid Balanced', weight: 20, config: {} },
      { id: 'hybrid_collaborative_heavy', name: 'Hybrid Collaborative Heavy', weight: 20, config: {} },
      { id: 'hybrid_content_heavy', name: 'Hybrid Content Heavy', weight: 20, config: {} }
    ];

    const [experiment] = await this.db('ab_test_experiments')
      .insert({
        name: 'recommendation_algorithm',
        description: 'A/B test different recommendation algorithms',
        variants: JSON.stringify(variants),
        is_active: true,
        start_date: new Date(),
        traffic_allocation: 100
      })
      .returning('*');

    const variantId = this.assignUserToVariant(userId, variants);

    await this.db('user_ab_tests').insert({
      user_id: userId,
      experiment_id: experiment.id,
      variant_id: variantId,
      assigned_at: new Date()
    });

    return {
      experiment: 'recommendation_algorithm',
      variant: variantId
    };
  }

  private assignUserToVariant(userId: string, variants: ABTestVariant[]): string {
    // Use consistent hashing for stable assignment
    const hash = crypto
      .createHash('md5')
      .update(userId + this.abTestSalt)
      .digest('hex');
    
    const hashValue = parseInt(hash.substring(0, 8), 16);
    const percentage = (hashValue % 100) + 1;
    
    let cumulativeWeight = 0;
    for (const variant of variants) {
      cumulativeWeight += variant.weight;
      if (percentage <= cumulativeWeight) {
        return variant.id;
      }
    }
    
    // Fallback to first variant
    return variants[0].id;
  }

  // User similarity calculation
  private async findSimilarUsers(userId: string, limit: number): Promise<UserSimilarity[]> {
    const cacheKey = `user_similarities:${userId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const userInteractions = await this.getUserInteractions(userId);
    if (userInteractions.length === 0) {
      return [];
    }

    const userProductIds = new Set(userInteractions.map(i => i.productId));
    
    // Find users who interacted with the same products
    const similarUsers = await this.db('analytics')
      .select('data->>"userId" as user_id')
      .whereIn('data->>"productId"', Array.from(userProductIds))
      .where('data->>"userId"', '!=', userId)
      .whereNotNull('data->>"userId"')
      .groupBy('data->>"userId"')
      .havingRaw('COUNT(DISTINCT data->>"productId") >= ?', [Math.min(2, userProductIds.size)])
      .limit(limit * 2);

    const similarities: UserSimilarity[] = [];
    
    for (const similarUser of similarUsers) {
      const otherUserInteractions = await this.getUserInteractions(similarUser.user_id);
      const otherProductIds = new Set(otherUserInteractions.map(i => i.productId));
      
      const commonProducts = Array.from(userProductIds).filter(id => otherProductIds.has(id));
      
      if (commonProducts.length > 0) {
        // Calculate Jaccard similarity
        const unionSize = new Set([...userProductIds, ...otherProductIds]).size;
        const similarity = commonProducts.length / unionSize;
        
        similarities.push({
          userId1: userId,
          userId2: similarUser.user_id,
          similarity,
          commonProducts
        });
      }
    }

    // Sort by similarity and take top users
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topSimilarities = similarities.slice(0, limit);
    
    // Cache results
    await this.redis.setEx(cacheKey, this.CACHE_TTL.user_similarities, JSON.stringify(topSimilarities));
    
    return topSimilarities;
  }

  // Content similarity calculation
  private calculateContentSimilarity(userProfile: any, product: MatchaProduct): number {
    let similarity = 0;
    let factors = 0;

    // Grade preference
    if (userProfile.preferredGrades.includes(product.grade)) {
      similarity += 0.3;
    }
    factors++;

    // Flavor profile matching
    const productFlavors = JSON.parse(product.flavor_profile as string) as FlavorProfile[];
    const commonFlavors = userProfile.flavorPreferences.filter((f: FlavorProfile) => 
      productFlavors.includes(f)
    );
    if (commonFlavors.length > 0) {
      similarity += 0.4 * (commonFlavors.length / Math.max(userProfile.flavorPreferences.length, productFlavors.length));
    }
    factors++;

    // Price range matching
    if (product.price >= userProfile.priceRange.min && product.price <= userProfile.priceRange.max) {
      similarity += 0.2;
    }
    factors++;

    // Origin preference
    if (userProfile.preferredOrigins.includes(product.origin)) {
      similarity += 0.1;
    }
    factors++;

    return similarity / factors;
  }

  // Build user profile from interactions
  private async buildUserProfile(interactions: UserInteraction[]): Promise<any> {
    const productIds = interactions.map(i => i.productId);
    const products = await this.db('matcha_products')
      .whereIn('id', productIds)
      .select('*');

    const profile = {
      preferredGrades: [] as MatchaGrade[],
      flavorPreferences: [] as FlavorProfile[],
      priceRange: { min: 0, max: 1000 },
      preferredOrigins: [] as string[]
    };

    // Analyze grades
    const gradeFreq = new Map<MatchaGrade, number>();
    const flavorFreq = new Map<FlavorProfile, number>();
    const origins = new Set<string>();
    const prices: number[] = [];

    for (const product of products) {
      const interaction = interactions.find(i => i.productId === product.id);
      const weight = interaction ? this.ACTION_WEIGHTS[interaction.action] : 1;

      // Count grades
      gradeFreq.set(product.grade, (gradeFreq.get(product.grade) || 0) + weight);

      // Count flavors
      const flavors = JSON.parse(product.flavor_profile as string) as FlavorProfile[];
      for (const flavor of flavors) {
        flavorFreq.set(flavor, (flavorFreq.get(flavor) || 0) + weight);
      }

      origins.add(product.origin);
      prices.push(product.price);
    }

    // Extract top preferences
    profile.preferredGrades = Array.from(gradeFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([grade]) => grade);

    profile.flavorPreferences = Array.from(flavorFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([flavor]) => flavor);

    profile.preferredOrigins = Array.from(origins);

    // Calculate price range (10th to 90th percentile)
    if (prices.length > 0) {
      prices.sort((a, b) => a - b);
      const minIndex = Math.floor(prices.length * 0.1);
      const maxIndex = Math.floor(prices.length * 0.9);
      profile.priceRange = {
        min: Math.max(0, prices[minIndex] * 0.8),
        max: prices[maxIndex] * 1.2
      };
    }

    return profile;
  }

  // Generate content-based explanation
  private generateContentExplanation(userProfile: any, product: MatchaProduct): string {
    const reasons: string[] = [];

    if (userProfile.preferredGrades.includes(product.grade)) {
      reasons.push(`matches your preference for ${product.grade} grade matcha`);
    }

    const productFlavors = JSON.parse(product.flavor_profile as string) as FlavorProfile[];
    const commonFlavors = userProfile.flavorPreferences.filter((f: FlavorProfile) => 
      productFlavors.includes(f)
    );
    if (commonFlavors.length > 0) {
      reasons.push(`has ${commonFlavors.join(', ')} flavors you enjoy`);
    }

    if (product.price >= userProfile.priceRange.min && product.price <= userProfile.priceRange.max) {
      reasons.push(`fits your preferred price range`);
    }

    return reasons.length > 0 
      ? `This matcha ${reasons.join(' and ')}`
      : 'This matcha matches your taste profile';
  }

  // Apply diversity filter to avoid too similar recommendations
  private async applyDiversityFilter(candidates: RecommendationCandidate[], userId: string): Promise<RecommendationCandidate[]> {
    if (candidates.length <= 5) return candidates;

    const diverseCandidates: RecommendationCandidate[] = [];
    const selectedGrades = new Set<MatchaGrade>();
    const selectedOrigins = new Set<string>();

    // Sort by score first
    candidates.sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      const product = await this.db('matcha_products')
        .where('id', candidate.productId)
        .first();

      if (!product) continue;

      // Ensure diversity in grades and origins
      const gradeCount = Array.from(selectedGrades).filter(g => g === product.grade).length;
      const originCount = Array.from(selectedOrigins).filter(o => o === product.origin).length;

      if (gradeCount < 3 && originCount < 2) {
        diverseCandidates.push(candidate);
        selectedGrades.add(product.grade);
        selectedOrigins.add(product.origin);
      } else if (diverseCandidates.length < 10) {
        // Still add high-scoring items even if not diverse
        diverseCandidates.push(candidate);
      }
    }

    return diverseCandidates;
  }

  // Apply freshness filter to include some newer products
  private async applyFreshnessFilter(candidates: RecommendationCandidate[], userId: string): Promise<RecommendationCandidate[]> {
    // Get some recent products
    const recentProducts = await this.db('matcha_products')
      .where('created_at', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
      .where('in_stock', true)
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('id');

    // Add recent products as candidates with moderate scores
    for (const product of recentProducts) {
      if (!candidates.find(c => c.productId === product.id)) {
        candidates.push({
          productId: product.id,
          score: 0.6,
          reason: {
            type: 'trending',
            explanation: 'This is a newly added matcha you might enjoy',
            confidence: 0.6
          },
          algorithm: 'content_based'
        });
      }
    }

    return candidates;
  }

  // Track recommendation interactions
  async trackRecommendationClick(recommendationId: string): Promise<void> {
    await this.db('recommendations')
      .where('id', recommendationId)
      .update({
        clicked_at: new Date()
      });

    this.logger.info(`Recommendation ${recommendationId} clicked`);
  }

  async trackRecommendationPurchase(recommendationId: string): Promise<void> {
    await this.db('recommendations')
      .where('id', recommendationId)
      .update({
        purchased_at: new Date()
      });

    this.logger.info(`Recommendation ${recommendationId} converted to purchase`);
  }

  // Analytics and A/B test reporting
  async getRecommendationAnalytics(experimentName: string, days: number = 7): Promise<any> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const results = await this.db('recommendations')
      .join('user_ab_tests', 'recommendations.user_id', 'user_ab_tests.user_id')
      .join('ab_test_experiments', 'user_ab_tests.experiment_id', 'ab_test_experiments.id')
      .where('ab_test_experiments.name', experimentName)
      .where('recommendations.created_at', '>', startDate)
      .select(
        'recommendations.ab_test_group as variant',
        this.db.raw('COUNT(*) as total_recommendations'),
        this.db.raw('COUNT(recommendations.clicked_at) as clicks'),
        this.db.raw('COUNT(recommendations.purchased_at) as purchases'),
        this.db.raw('AVG(recommendations.score) as avg_score')
      )
      .groupBy('recommendations.ab_test_group');

    const analytics = results.map(result => ({
      variant: result.variant,
      totalRecommendations: parseInt(result.total_recommendations),
      clicks: parseInt(result.clicks),
      purchases: parseInt(result.purchases),
      clickThroughRate: result.clicks / result.total_recommendations,
      conversionRate: result.purchases / result.total_recommendations,
      avgScore: parseFloat(result.avg_score)
    }));

    return analytics;
  }

  // Utility methods
  private async getUserInteractions(userId: string): Promise<UserInteraction[]> {
    const interactions = await this.db('analytics')
      .where('data->>"userId"', userId)
      .whereIn('event', ['product_view', 'product_click', 'add_to_cart', 'purchase'])
      .select('*')
      .orderBy('timestamp', 'desc')
      .limit(100);

    return interactions.map(interaction => ({
      userId,
      productId: interaction.data.productId,
      action: this.mapEventToAction(interaction.event),
      timestamp: interaction.timestamp,
      score: this.ACTION_WEIGHTS[this.mapEventToAction(interaction.event)]
    }));
  }

  private mapEventToAction(event: string): 'view' | 'click' | 'purchase' | 'add_to_cart' {
    switch (event) {
      case 'product_view': return 'view';
      case 'product_click': return 'click';
      case 'add_to_cart': return 'add_to_cart';
      case 'purchase': return 'purchase';
      default: return 'view';
    }
  }

  private async get
