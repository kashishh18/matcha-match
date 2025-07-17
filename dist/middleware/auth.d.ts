import { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import Redis from 'redis';
import { User } from '@/types';
declare global {
    namespace Express {
        interface Request {
            user?: Partial<User>;
            requestId: string;
            sessionId?: string;
        }
    }
}
export declare class AuthMiddleware {
    private db;
    private redis;
    private logger;
    private apiLimiter;
    private strictLimiter;
    private uploadLimiter;
    constructor(database: Knex, redisClient: Redis.RedisClientType);
    authenticateToken: (req: Request, res: Response, next: NextFunction) => Promise<void>;
    optionalAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>;
    requirePremium: (req: Request, res: Response, next: NextFunction) => void;
    rateLimit: (limiterType?: "api" | "strict" | "upload") => (req: Request, res: Response, next: NextFunction) => Promise<void>;
    validateRequest: (req: Request, res: Response, next: NextFunction) => void;
    securityHeaders: (req: Request, res: Response, next: NextFunction) => void;
    corsHandler: (req: Request, res: Response, next: NextFunction) => void;
    requestLogger: (req: Request, res: Response, next: NextFunction) => void;
    apiVersioning: (req: Request, res: Response, next: NextFunction) => void;
    validateContentType: (allowedTypes?: string[]) => (req: Request, res: Response, next: NextFunction) => void;
    requestSizeLimit: (maxSize?: number) => (req: Request, res: Response, next: NextFunction) => void;
    healthCheckBypass: (req: Request, res: Response, next: NextFunction) => void;
    private updateSessionActivity;
    private trackRequestAnalytics;
    private sanitizeObject;
    private sanitizeString;
    private createErrorResponse;
}
declare module 'express' {
    interface Request {
        apiVersion?: string;
    }
}
export default AuthMiddleware;
