// Core type definitions for FAANG-level matcha recommendation system

export interface MatchaProduct {
  id: string;
  name: string;
  provider: MatchaProvider;
  price: number;
  originalPrice?: number;
  inStock: boolean;
  stockCount: number;
  description: string;
  imageUrl: string;
  productUrl: string;
  grade: MatchaGrade;
  origin: string;
  flavorProfile: FlavorProfile;
  size: string;
  weight: number; // in grams
  createdAt: Date;
  updatedAt: Date;
  scrapedAt: Date;
  viewCount: number;
  purchaseCount: number;
}

export interface MatchaProvider {
  id: string;
  name: string;
  baseUrl: string;
  isActive: boolean;
  scrapeConfig: ScrapeConfig;
  lastScraped: Date;
  averageResponseTime: number;
  successRate: number;
}

export interface ScrapeConfig {
  productListUrl: string;
  productSelector: string;
  nameSelector: string;
  priceSelector: string;
  stockSelector: string;
  imageSelector: string;
  descriptionSelector: string;
  headers: Record<string, string>;
  rateLimit: number; // requests per minute
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  preferences: UserPreferences;
  createdAt: Date;
  lastLogin: Date;
  isEmailVerified: boolean;
  subscriptionTier: 'free' | 'premium';
}

export interface UserPreferences {
  favoriteProviders: string[];
  priceRange: {
    min: number;
    max: number;
  };
  preferredGrades: MatchaGrade[];
  flavorPreferences: FlavorProfile[];
  notificationSettings: {
    stockAlerts: boolean;
    priceDrops: boolean;
    newProducts: boolean;
    recommendations: boolean;
  };
  allergies: string[];
  dietaryRestrictions: string[];
}

export interface StockAlert {
  id: string;
  userId: string;
  productId: string;
  alertType: 'back_in_stock' | 'price_drop' | 'low_stock';
  targetPrice?: number;
  isActive: boolean;
  createdAt: Date;
  triggeredAt?: Date;
}

export interface Recommendation {
  id: string;
  userId: string;
  productId: string;
  score: number;
  reason: RecommendationReason;
  algorithm: 'collaborative' | 'content_based' | 'hybrid';
  abTestGroup: string;
  createdAt: Date;
  clickedAt?: Date;
  purchasedAt?: Date;
}

export interface RecommendationReason {
  type: 'similar_users' | 'similar_products' | 'price_preference' | 'flavor_match' | 'trending';
  explanation: string;
  confidence: number;
}

export interface SearchQuery {
  id: string;
  userId?: string;
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  timestamp: Date;
  responseTime: number;
  clickThroughRate: number;
}

export interface SearchFilters {
  providers?: string[];
  priceRange?: {
    min: number;
    max: number;
  };
  grades?: MatchaGrade[];
  inStockOnly?: boolean;
  origins?: string[];
  flavorProfiles?: FlavorProfile[];
  sortBy?: 'relevance' | 'price_low' | 'price_high' | 'rating' | 'newest';
}

export interface SearchResult {
  productId: string;
  relevanceScore: number;
  rank: number;
  clicked: boolean;
}

export interface UserSession {
  id: string;
  userId: string;
  sessionToken: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
  requestId: string;
}

export interface WebSocketMessage {
  type: 'stock_update' | 'price_change' | 'viewer_count' | 'recommendation';
  data: any;
  timestamp: Date;
  userId?: string;
}

export interface ABTestExperiment {
  id: string;
  name: string;
  description: string;
  variants: ABTestVariant[];
  isActive: boolean;
  startDate: Date;
  endDate?: Date;
  trafficAllocation: number; // percentage
}

export interface ABTestVariant {
  id: string;
  name: string;
  weight: number; // percentage of traffic
  config: Record<string, any>;
}

export interface UserABTest {
  userId: string;
  experimentId: string;
  variantId: string;
  assignedAt: Date;
}

export interface Analytics {
  id: string;
  event: string;
  userId?: string;
  sessionId: string;
  data: Record<string, any>;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
}

// Enums for better type safety
export enum MatchaGrade {
  CEREMONIAL = 'ceremonial',
  PREMIUM = 'premium',
  CULINARY = 'culinary',
  INGREDIENT = 'ingredient'
}

export enum FlavorProfile {
  SWEET = 'sweet',
  UMAMI = 'umami',
  BITTER = 'bitter',
  GRASSY = 'grassy',
  NUTTY = 'nutty',
  CREAMY = 'creamy',
  EARTHY = 'earthy',
  FLORAL = 'floral'
}

export enum ProviderStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  RATE_LIMITED = 'rate_limited',
  ERROR = 'error'
}

// Database table interfaces for Knex.js
export interface DatabaseTables {
  matcha_products: MatchaProduct;
  matcha_providers: MatchaProvider;
  users: User;
  stock_alerts: StockAlert;
  recommendations: Recommendation;
  search_queries: SearchQuery;
  user_sessions: UserSession;
  ab_test_experiments: ABTestExperiment;
  user_ab_tests: UserABTest;
  analytics: Analytics;
}
