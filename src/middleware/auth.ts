import { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import Redis from 'redis';
import jwt from 'jsonwebtoken';
import winston from 'winston';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { ApiResponse, User } from '@/types';

// Production-grade middleware for authentication, authorization, and security
// Implements FAANG-level security practices with JWT validation and rate limiting

interface JWTPayload {
  userId: string;
  email: string;
  sessionId: string;
  iat: number;
  exp: number;
}

// Extend Express Request interface to include user data
declare global {
  namespace Express {
    interface Request {
      user?: Partial<User>;
      requestId: string;
      sessionId?: string;
    }
  }
}

export class AuthMiddleware {
  private db: Knex;
  private redis: Redis.RedisClientType;
  private logger: winston.Logger;
  private apiLimiter: RateLimiterRedis;
  private strictLimiter: RateLimiterRedis;
  private uploadLimiter: RateLimiterRedis;

  constructor(database: Knex, redisClient: Redis.RedisClientType) {
    this.db = database;
    this.redis = redisClient;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] AuthMiddleware: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/auth-middleware.log' })
      ]
    });

    // Rate limiters for different endpoint types
    this.apiLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'api_limit',
      points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000') / 1000, // Convert to seconds
      blockDuration: 900, // Block for 15 minutes
    });

    this.strictLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'strict_limit',
      points: 10, // Lower limit for sensitive operations
      duration: 600, // 10 minutes
      blockDuration: 3600, // Block for 1 hour
    });

    this.uploadLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'upload_limit',
      points: 5, // Very limited uploads
      duration: 3600, // 1 hour
      blockDuration: 7200, // Block for 2 hours
    });
  }

  // JWT Authentication middleware
  authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.split(' ')[1]; // Bearer TOKEN

      if (!token) {
        res.status(401).json(this.createErrorResponse('Access token required'));
        return;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;

      // Check if session is still active
      const session = await this.db('user_sessions')
        .where('id', decoded.sessionId)
        .where('is_active', true)
        .where('expires_at', '>', new Date())
        .first();

      if (!session) {
        res.status(401).json(this.createErrorResponse('Session expired or invalid'));
        return;
      }

      // Get user data
      const user = await this.db('users')
        .where('id', decoded.userId)
        .first();

      if (!user) {
        res.status(401).json(this.createErrorResponse('User not found'));
        return;
      }

      // Check if user is still active/verified
      if (!user.is_email_verified) {
        res.status(403).json(this.createErrorResponse('Email verification required'));
        return;
      }

      // Attach user data to request
      req.user = {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        preferences: JSON.parse(user.preferences || '{}'),
        subscriptionTier: user.subscription_tier,
        isEmailVerified: user.is_email_verified,
        createdAt: user.created_at,
        lastLogin: user.last_login
      };

      req.sessionId = decoded.sessionId;

      // Update session last activity
      await this.updateSessionActivity(decoded.sessionId, req.ip, req.get('User-Agent') || '');

      next();

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json(this.createErrorResponse('Token expired'));
      } else if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json(this.createErrorResponse('Invalid token'));
      } else {
        this.logger.error('Authentication error:', error);
        res.status(500).json(this.createErrorResponse('Authentication failed'));
      }
    }
  };

  // Optional authentication (user data if available, but not required)
  optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.split(' ')[1];

      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
          
          const session = await this.db('user_sessions')
            .where('id', decoded.sessionId)
            .where('is_active', true)
            .where('expires_at', '>', new Date())
            .first();

          if (session) {
            const user = await this.db('users')
              .where('id', decoded.userId)
              .first();

            if (user && user.is_email_verified) {
              req.user = {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                preferences: JSON.parse(user.preferences || '{}'),
                subscriptionTier: user.subscription_tier,
                isEmailVerified: user.is_email_verified,
                createdAt: user.created_at,
                lastLogin: user.last_login
              };
              req.sessionId = decoded.sessionId;
            }
          }
        } catch (error) {
          // Invalid token, but don't fail the request
          this.logger.debug('Optional auth token invalid:', error.message);
        }
      }

      next();

    } catch (error) {
      this.logger.error('Optional auth error:', error);
      next(); // Continue anyway for optional auth
    }
  };

  // Admin/premium user authorization
  requirePremium = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json(this.createErrorResponse('Authentication required'));
      return;
    }

    if (req.user.subscriptionTier !== 'premium') {
      res.status(403).json(this.createErrorResponse('Premium subscription required'));
      return;
    }

    next();
  };

  // Rate limiting middleware
  rateLimit = (limiterType: 'api' | 'strict' | 'upload' = 'api') => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        let limiter: RateLimiterRedis;
        
        switch (limiterType) {
          case 'strict':
            limiter = this.strictLimiter;
            break;
          case 'upload':
            limiter = this.uploadLimiter;
            break;
          default:
            limiter = this.apiLimiter;
        }

        // Use user ID if authenticated, otherwise IP
        const key = req.user?.id || req.ip;
        
        const rateLimiterRes = await limiter.consume(key);
        
        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': limiter.points.toString(),
          'X-RateLimit-Remaining': rateLimiterRes.remainingPoints?.toString() || '0',
          'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString()
        });

        next();

      } catch (rateLimiterRes) {
        const secs = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
        
        res.set({
          'X-RateLimit-Limit': rateLimiterRes.totalHits?.toString() || '0',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
          'Retry-After': secs.toString()
        });

        this.logger.warn(`Rate limit exceeded for ${req.ip} (${req.user?.email || 'anonymous'})`);
        
        res.status(429).json(this.createErrorResponse(
          `Too many requests. Try again in ${secs} seconds.`,
          { retryAfter: secs }
        ));
      }
    };
  };

  // Request validation and sanitization
  validateRequest = (req: Request, res: Response, next: NextFunction): void => {
    // Add request ID for tracking
    req.requestId = Math.random().toString(36).substring(2, 15);
    
    // Sanitize common XSS vectors
    if (req.body) {
      req.body = this.sanitizeObject(req.body);
    }
    
    if (req.query) {
      req.query = this.sanitizeObject(req.query);
    }

    // Log request for monitoring
    this.logger.info(`${req.method} ${req.path}`, {
      requestId: req.requestId,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    next();
  };

  // Security headers middleware
  securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
    // Security headers
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Request-ID': req.requestId
    });

    // HSTS for production
    if (process.env.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    next();
  };

  // CORS preflight handling
  corsHandler = (req: Request, res: Response, next: NextFunction): void => {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'https://localhost:3000'
    ];

    const origin = req.headers.origin;
    
    if (origin && allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
    }

    res.set({
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400' // 24 hours
    });

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    next();
  };

  // Request logging middleware
  requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Log request
    this.logger.info(`→ ${req.method} ${req.path}`, {
      requestId: req.requestId,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer'),
      contentLength: req.get('Content-Length')
    });

    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 400 ? 'error' : 'info';
      
      this.logger.log(level, `← ${req.method} ${req.path} ${res.statusCode}`, {
        requestId: req.requestId,
        userId: req.user?.id,
        statusCode: res.statusCode,
        duration,
        contentLength: res.get('Content-Length')
      });

      // Track analytics
      this.trackRequestAnalytics(req, res, duration);
    });

    next();
  };

  // API versioning middleware
  apiVersioning = (req: Request, res: Response, next: NextFunction): void => {
    const version = req.headers['api-version'] || req.query.v || 'v1';
    
    // Validate API version
    const supportedVersions = ['v1'];
    
    if (!supportedVersions.includes(version as string)) {
      res.status(400).json(this.createErrorResponse('Unsupported API version'));
      return;
    }

    // Add version to request for route handling
    req.apiVersion = version as string;
    res.set('API-Version', version as string);

    next();
  };

  // Content type validation
  validateContentType = (allowedTypes: string[] = ['application/json']) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (req.method === 'GET' || req.method === 'DELETE') {
        next();
        return;
      }

      const contentType = req.get('Content-Type');
      
      if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
        res.status(415).json(this.createErrorResponse(
          `Unsupported content type. Allowed: ${allowedTypes.join(', ')}`
        ));
        return;
      }

      next();
    };
  };

  // Request size limiting
  requestSizeLimit = (maxSize: number = 10 * 1024 * 1024) => { // 10MB default
    return (req: Request, res: Response, next: NextFunction): void => {
      const contentLength = parseInt(req.get('Content-Length') || '0');
      
      if (contentLength > maxSize) {
        res.status(413).json(this.createErrorResponse(
          `Request too large. Maximum size: ${maxSize} bytes`
        ));
        return;
      }

      next();
    };
  };

  // Health check bypass (no auth required)
  healthCheckBypass = (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/health' || req.path === '/api/version') {
      next();
      return;
    }

    // Apply normal auth for other routes
    this.authenticateToken(req, res, next);
  };

  // Session activity tracking
  private async updateSessionActivity(sessionId: string, ip: string, userAgent: string): Promise<void> {
    try {
      // Update last activity time and track IP changes
      await this.db('user_sessions')
        .where('id', sessionId)
        .update({
          ip_address: ip,
          user_agent: userAgent,
          updated_at: new Date()
        });

      // Cache session info for quick lookups
      await this.redis.setEx(`session:${sessionId}`, 3600, JSON.stringify({
        lastActivity: new Date(),
        ip,
        userAgent
      }));

    } catch (error) {
      this.logger.error('Error updating session activity:', error);
    }
  }

  // Request analytics tracking
  private async trackRequestAnalytics(req: Request, res: Response, duration: number): Promise<void> {
    try {
      // Only track API endpoints, not static files
      if (!req.path.startsWith('/api/')) return;

      await this.db('analytics').insert({
        event: 'api_request',
        user_id: req.user?.id || null,
        session_id: req.sessionId || 'anonymous',
        data: JSON.stringify({
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          requestId: req.requestId,
          userAgent: req.get('User-Agent'),
          referer: req.get('Referer')
        }),
        ip_address: req.ip,
        user_agent: req.get('User-Agent') || '',
        timestamp: new Date()
      });

    } catch (error) {
      this.logger.error('Error tracking request analytics:', error);
    }
  }

  // XSS prevention - sanitize input
  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = this.sanitizeObject(value);
    }

    return sanitized;
  }

  private sanitizeString(str: any): any {
    if (typeof str !== 'string') return str;

    // Remove potential XSS vectors
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
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

// Type augmentation for Express Request
declare module 'express' {
  interface Request {
    apiVersion?: string;
  }
}

export default AuthMiddleware;
