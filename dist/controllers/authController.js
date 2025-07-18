"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authValidations = exports.AuthController = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const express_validator_1 = require("express-validator");
const winston_1 = __importDefault(require("winston"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const rate_limiter_flexible_1 = require("rate-limiter-flexible");
const types_1 = require("@/types");
class AuthController {
    db;
    redis;
    logger;
    emailTransporter;
    loginLimiter;
    registrationLimiter;
    constructor(database, redisClient) {
        this.db = database;
        this.redis = redisClient;
        this.logger = winston_1.default.createLogger({
            level: 'info',
            format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
                return `${timestamp} [${level.toUpperCase()}] AuthController: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            })),
            transports: [
                new winston_1.default.transports.Console(),
                new winston_1.default.transports.File({ filename: 'logs/auth.log' })
            ]
        });
        // Initialize email transporter
        this.emailTransporter = nodemailer_1.default.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT || '587'),
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD,
            },
            tls: {
                rejectUnauthorized: false
            }
        });
        // Rate limiters for security
        this.loginLimiter = new rate_limiter_flexible_1.RateLimiterRedis({
            storeClient: redisClient,
            keyPrefix: 'login_fail',
            points: 5, // Number of attempts
            duration: 900, // Per 15 minutes
            blockDuration: 900, // Block for 15 minutes
        });
        this.registrationLimiter = new rate_limiter_flexible_1.RateLimiterRedis({
            storeClient: redisClient,
            keyPrefix: 'registration',
            points: 3, // Number of registrations
            duration: 3600, // Per hour
            blockDuration: 3600, // Block for 1 hour
        });
    }
    // User registration with email verification
    register = async (req, res) => {
        const startTime = Date.now();
        try {
            // Validate input
            const errors = (0, express_validator_1.validationResult)(req);
            if (!errors.isEmpty()) {
                res.status(400).json(this.createErrorResponse('Validation failed', errors.array()));
                return;
            }
            const { email, password, firstName, lastName, preferences } = req.body;
            // Rate limiting check
            try {
                await this.registrationLimiter.consume(req.ip || "0.0.0.0");
            }
            catch (rateLimiterRes) {
                const secs = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
                res.status(429).json(this.createErrorResponse(`Too many registration attempts. Try again in ${secs} seconds.`));
                return;
            }
            // Check if user already exists
            const existingUser = await this.db('users').where('email', email.toLowerCase()).first();
            if (existingUser) {
                res.status(409).json(this.createErrorResponse('User with this email already exists'));
                return;
            }
            // Hash password
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
            const passwordHash = await bcrypt_1.default.hash(password, saltRounds);
            // Create user preferences with defaults
            const userPreferences = {
                favoriteProviders: [],
                priceRange: { min: 0, max: 100 },
                preferredGrades: [types_1.MatchaGrade.PREMIUM],
                flavorPreferences: [types_1.FlavorProfile.UMAMI, types_1.FlavorProfile.SWEET],
                notificationSettings: {
                    stockAlerts: true,
                    priceDrops: true,
                    newProducts: false,
                    recommendations: true
                },
                allergies: [],
                dietaryRestrictions: [],
                ...preferences
            };
            // Create user
            const [userId] = await this.db('users').insert({
                email: email.toLowerCase(),
                password_hash: passwordHash,
                first_name: firstName,
                last_name: lastName,
                preferences: JSON.stringify(userPreferences),
                is_email_verified: false,
                subscription_tier: 'free',
                created_at: new Date(),
                updated_at: new Date()
            }).returning('id');
            // Generate email verification token
            const verificationToken = crypto_1.default.randomBytes(32).toString('hex');
            await this.redis.setEx(`email_verification:${verificationToken}`, 86400, userId.id); // 24 hours
            // Send verification email
            await this.sendVerificationEmail(email, firstName, verificationToken);
            // Track registration
            await this.trackAuthEvent('user_registered', {
                userId: userId.id,
                email,
                ip: req.ip || "0.0.0.0",
                userAgent: req.get('User-Agent')
            });
            const responseTime = Date.now() - startTime;
            this.logger.info(`User registered successfully: ${email} in ${responseTime}ms`);
            const response = {
                success: true,
                data: {
                    message: 'Registration successful. Please check your email to verify your account.',
                    userId: userId.id
                },
                timestamp: new Date(),
                requestId: req.requestId
            };
            res.status(201).json(response);
        }
        catch (error) {
            this.logger.error('Registration error:', error);
            res.status(500).json(this.createErrorResponse('Registration failed'));
        }
    };
    // User login with JWT tokens
    login = async (req, res) => {
        const startTime = Date.now();
        try {
            const errors = (0, express_validator_1.validationResult)(req);
            if (!errors.isEmpty()) {
                res.status(400).json(this.createErrorResponse('Validation failed', errors.array()));
                return;
            }
            const { email, password, rememberMe = false } = req.body;
            const userKey = `${req.ip || "0.0.0.0"}_${email}`;
            // Rate limiting check
            try {
                await this.loginLimiter.consume(userKey);
            }
            catch (rateLimiterRes) {
                const secs = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
                res.status(429).json(this.createErrorResponse(`Too many login attempts. Try again in ${secs} seconds.`));
                return;
            }
            // Find user
            const user = await this.db('users').where('email', email.toLowerCase()).first();
            if (!user) {
                await this.trackLoginAttempt(email, req.ip || "0.0.0.0", req.get('User-Agent') || '', false);
                res.status(401).json(this.createErrorResponse('Invalid credentials'));
                return;
            }
            // Verify password
            const isValidPassword = await bcrypt_1.default.compare(password, user.password_hash);
            if (!isValidPassword) {
                await this.trackLoginAttempt(email, req.ip || "0.0.0.0", req.get('User-Agent') || '', false);
                res.status(401).json(this.createErrorResponse('Invalid credentials'));
                return;
            }
            // Check if email is verified
            if (!user.is_email_verified) {
                res.status(403).json(this.createErrorResponse('Please verify your email address before logging in'));
                return;
            }
            // Create session
            const sessionId = crypto_1.default.randomUUID();
            const expiresAt = new Date(Date.now() + (rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)); // 30 days or 1 day
            await this.db('user_sessions').insert({
                id: sessionId,
                user_id: user.id,
                session_token: crypto_1.default.randomBytes(64).toString('hex'),
                ip_address: req.ip || "0.0.0.0",
                user_agent: req.get('User-Agent') || '',
                is_active: true,
                expires_at: expiresAt,
                created_at: new Date()
            });
            // Generate JWT tokens
            const accessToken = this.generateAccessToken(user.id, user.email, sessionId);
            const refreshToken = this.generateRefreshToken(user.id, sessionId);
            // Store refresh token in Redis
            await this.redis.setEx(`refresh_token:${refreshToken}`, rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60, // 30 days or 7 days
            JSON.stringify({ userId: user.id, sessionId }));
            // Update last login
            await this.db('users').where('id', user.id).update({
                last_login: new Date(),
                updated_at: new Date()
            });
            // Reset rate limiter on successful login
            await this.loginLimiter.delete(userKey);
            // Track successful login
            await this.trackLoginAttempt(email, req.ip || "0.0.0.0", req.get('User-Agent') || '', true);
            await this.trackAuthEvent('user_login', {
                userId: user.id,
                email,
                ip: req.ip || "0.0.0.0",
                userAgent: req.get('User-Agent'),
                rememberMe
            });
            const responseTime = Date.now() - startTime;
            this.logger.info(`User logged in successfully: ${email} in ${responseTime}ms`);
            const response = {
                success: true,
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        preferences: JSON.parse(user.preferences || '{}'),
                        subscriptionTier: user.subscription_tier,
                        isEmailVerified: user.is_email_verified,
                        createdAt: user.created_at,
                        lastLogin: new Date()
                    },
                    accessToken,
                    refreshToken,
                    expiresIn: 3600 // 1 hour for access token
                },
                timestamp: new Date(),
                requestId: req.requestId
            };
            res.json(response);
        }
        catch (error) {
            this.logger.error('Login error:', error);
            res.status(500).json(this.createErrorResponse('Login failed'));
        }
    };
    // Refresh JWT access token
    refreshToken = async (req, res) => {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken) {
                res.status(400).json(this.createErrorResponse('Refresh token required'));
                return;
            }
            // Get token data from Redis
            const tokenData = await this.redis.get(`refresh_token:${refreshToken}`);
            if (!tokenData) {
                res.status(401).json(this.createErrorResponse('Invalid refresh token'));
                return;
            }
            const { userId, sessionId } = JSON.parse(tokenData);
            // Verify session is still active
            const session = await this.db('user_sessions')
                .where('id', sessionId)
                .where('is_active', true)
                .where('expires_at', '>', new Date())
                .first();
            if (!session) {
                await this.redis.del(`refresh_token:${refreshToken}`);
                res.status(401).json(this.createErrorResponse('Session expired'));
                return;
            }
            // Get user data
            const user = await this.db('users').where('id', userId).first();
            if (!user) {
                res.status(401).json(this.createErrorResponse('User not found'));
                return;
            }
            // Generate new access token
            const newAccessToken = this.generateAccessToken(user.id, user.email, sessionId);
            this.logger.info(`Access token refreshed for user: ${user.email}`);
            res.json(this.createSuccessResponse({
                accessToken: newAccessToken,
                expiresIn: 3600
            }));
        }
        catch (error) {
            this.logger.error('Token refresh error:', error);
            res.status(500).json(this.createErrorResponse('Token refresh failed'));
        }
    };
    // User logout
    logout = async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            const token = authHeader?.split(' ')[1];
            if (token) {
                try {
                    const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
                    // Deactivate session
                    await this.db('user_sessions')
                        .where('id', decoded.sessionId)
                        .update({ is_active: false });
                    // Remove refresh tokens
                    const refreshTokenKeys = await this.redis.keys(`refresh_token:*`);
                    for (const key of refreshTokenKeys) {
                        const tokenData = await this.redis.get(key);
                        if (tokenData) {
                            const { sessionId } = JSON.parse(tokenData);
                            if (sessionId === decoded.sessionId) {
                                await this.redis.del(key);
                            }
                        }
                    }
                    // Track logout
                    await this.trackAuthEvent('user_logout', {
                        userId: decoded.userId,
                        ip: req.ip || "0.0.0.0",
                        userAgent: req.get('User-Agent')
                    });
                    this.logger.info(`User logged out: ${decoded.email}`);
                }
                catch (jwtError) {
                    // Token might be invalid, but still respond success
                    this.logger.warn('Invalid token during logout:', jwtError);
                }
            }
            res.json(this.createSuccessResponse({ message: 'Logged out successfully' }));
        }
        catch (error) {
            this.logger.error('Logout error:', error);
            res.status(500).json(this.createErrorResponse('Logout failed'));
        }
    };
    // Email verification
    verifyEmail = async (req, res) => {
        try {
            const { token } = req.params;
            if (!token) {
                res.status(400).json(this.createErrorResponse('Verification token required'));
                return;
            }
            // Get user ID from token
            const userId = await this.redis.get(`email_verification:${token}`);
            if (!userId) {
                res.status(400).json(this.createErrorResponse('Invalid or expired verification token'));
                return;
            }
            // Update user email verification status
            await this.db('users')
                .where('id', userId)
                .update({
                is_email_verified: true,
                updated_at: new Date()
            });
            // Remove verification token
            await this.redis.del(`email_verification:${token}`);
            // Track email verification
            await this.trackAuthEvent('email_verified', {
                userId,
                ip: req.ip || "0.0.0.0",
                userAgent: req.get('User-Agent')
            });
            this.logger.info(`Email verified for user: ${userId}`);
            res.json(this.createSuccessResponse({ message: 'Email verified successfully' }));
        }
        catch (error) {
            this.logger.error('Email verification error:', error);
            res.status(500).json(this.createErrorResponse('Email verification failed'));
        }
    };
    // Resend verification email
    resendVerification = async (req, res) => {
        try {
            const { email } = req.body;
            const user = await this.db('users').where('email', email.toLowerCase()).first();
            if (!user) {
                // Don't reveal if email exists
                res.json(this.createSuccessResponse({ message: 'If the email exists, a verification link has been sent' }));
                return;
            }
            if (user.is_email_verified) {
                res.status(400).json(this.createErrorResponse('Email is already verified'));
                return;
            }
            // Generate new verification token
            const verificationToken = crypto_1.default.randomBytes(32).toString('hex');
            await this.redis.setEx(`email_verification:${verificationToken}`, 86400, user.id); // 24 hours
            // Send verification email
            await this.sendVerificationEmail(user.email, user.first_name, verificationToken);
            this.logger.info(`Verification email resent to: ${email}`);
            res.json(this.createSuccessResponse({ message: 'Verification email sent' }));
        }
        catch (error) {
            this.logger.error('Resend verification error:', error);
            res.status(500).json(this.createErrorResponse('Failed to resend verification email'));
        }
    };
    // Password reset request
    requestPasswordReset = async (req, res) => {
        try {
            const { email } = req.body;
            const user = await this.db('users').where('email', email.toLowerCase()).first();
            if (!user) {
                // Don't reveal if email exists
                res.json(this.createSuccessResponse({ message: 'If the email exists, a password reset link has been sent' }));
                return;
            }
            // Generate reset token
            const resetToken = crypto_1.default.randomBytes(32).toString('hex');
            await this.redis.setEx(`password_reset:${resetToken}`, 3600, user.id); // 1 hour
            // Send reset email
            await this.sendPasswordResetEmail(user.email, user.first_name, resetToken);
            // Track password reset request
            await this.trackAuthEvent('password_reset_requested', {
                userId: user.id,
                email,
                ip: req.ip || "0.0.0.0",
                userAgent: req.get('User-Agent')
            });
            this.logger.info(`Password reset requested for: ${email}`);
            res.json(this.createSuccessResponse({ message: 'Password reset email sent' }));
        }
        catch (error) {
            this.logger.error('Password reset request error:', error);
            res.status(500).json(this.createErrorResponse('Failed to send password reset email'));
        }
    };
    // Reset password
    resetPassword = async (req, res) => {
        try {
            const { token, newPassword } = req.body;
            if (!token || !newPassword) {
                res.status(400).json(this.createErrorResponse('Token and new password required'));
                return;
            }
            // Get user ID from token
            const userId = await this.redis.get(`password_reset:${token}`);
            if (!userId) {
                res.status(400).json(this.createErrorResponse('Invalid or expired reset token'));
                return;
            }
            // Hash new password
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
            const passwordHash = await bcrypt_1.default.hash(newPassword, saltRounds);
            // Update password
            await this.db('users')
                .where('id', userId)
                .update({
                password_hash: passwordHash,
                updated_at: new Date()
            });
            // Remove reset token
            await this.redis.del(`password_reset:${token}`);
            // Deactivate all user sessions
            await this.db('user_sessions')
                .where('user_id', userId)
                .update({ is_active: false });
            // Remove all refresh tokens for this user
            const refreshTokenKeys = await this.redis.keys(`refresh_token:*`);
            for (const key of refreshTokenKeys) {
                const tokenData = await this.redis.get(key);
                if (tokenData) {
                    const { userId: tokenUserId } = JSON.parse(tokenData);
                    if (tokenUserId === userId) {
                        await this.redis.del(key);
                    }
                }
            }
            // Track password reset
            await this.trackAuthEvent('password_reset_completed', {
                userId,
                ip: req.ip || "0.0.0.0",
                userAgent: req.get('User-Agent')
            });
            this.logger.info(`Password reset completed for user: ${userId}`);
            res.json(this.createSuccessResponse({ message: 'Password reset successfully' }));
        }
        catch (error) {
            this.logger.error('Password reset error:', error);
            res.status(500).json(this.createErrorResponse('Password reset failed'));
        }
    };
    // Get user profile
    getProfile = async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json(this.createErrorResponse('Authentication required'));
                return;
            }
            const user = await this.db('users').where('id', userId).first();
            if (!user) {
                res.status(404).json(this.createErrorResponse('User not found'));
                return;
            }
            const userProfile = {
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
            res.json(this.createSuccessResponse(userProfile));
        }
        catch (error) {
            this.logger.error('Get profile error:', error);
            res.status(500).json(this.createErrorResponse('Failed to get profile'));
        }
    };
    // Update user profile
    updateProfile = async (req, res) => {
        try {
            const errors = (0, express_validator_1.validationResult)(req);
            if (!errors.isEmpty()) {
                res.status(400).json(this.createErrorResponse('Validation failed', errors.array()));
                return;
            }
            const userId = req.user?.id;
            const { firstName, lastName, preferences } = req.body;
            if (!userId) {
                res.status(401).json(this.createErrorResponse('Authentication required'));
                return;
            }
            const updateData = {
                updated_at: new Date()
            };
            if (firstName)
                updateData.first_name = firstName;
            if (lastName)
                updateData.last_name = lastName;
            if (preferences)
                updateData.preferences = JSON.stringify(preferences);
            await this.db('users').where('id', userId).update(updateData);
            // Track profile update
            await this.trackAuthEvent('profile_updated', {
                userId,
                ip: req.ip || "0.0.0.0",
                userAgent: req.get('User-Agent'),
                updatedFields: Object.keys(updateData)
            });
            this.logger.info(`Profile updated for user: ${userId}`);
            res.json(this.createSuccessResponse({ message: 'Profile updated successfully' }));
        }
        catch (error) {
            this.logger.error('Update profile error:', error);
            res.status(500).json(this.createErrorResponse('Failed to update profile'));
        }
    };
    // Helper methods
    generateAccessToken(userId, email, sessionId) {
        return jsonwebtoken_1.default.sign({ userId, email, sessionId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
    }
    generateRefreshToken(userId, sessionId) {
        return jsonwebtoken_1.default.sign({ userId, sessionId, type: 'refresh' }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '30d' });
    }
    async sendVerificationEmail(email, firstName, token) {
        const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
        const mailOptions = {
            from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
            to: email,
            subject: 'Verify Your Matcha Match Account',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Matcha Match, ${firstName}!</h2>
          <p>Thank you for registering with Matcha Match. Please verify your email address to complete your registration.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email Address
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p>${verificationUrl}</p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account with Matcha Match, please ignore this email.</p>
        </div>
      `
        };
        await this.emailTransporter.sendMail(mailOptions);
    }
    async sendPasswordResetEmail(email, firstName, token) {
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
        const mailOptions = {
            from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
            to: email,
            subject: 'Reset Your Matcha Match Password',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hi ${firstName},</p>
          <p>We received a request to reset your password for your Matcha Match account.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #FF6B6B; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p>${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, please ignore this email and your password will remain unchanged.</p>
        </div>
      `
        };
        await this.emailTransporter.sendMail(mailOptions);
    }
    async trackLoginAttempt(email, ip, userAgent, success) {
        try {
            const attempt = {
                email,
                ip,
                userAgent,
                success,
                timestamp: new Date()
            };
            // Store in database for security monitoring
            await this.db('analytics').insert({
                event: 'login_attempt',
                user_id: null,
                session_id: 'auth',
                data: JSON.stringify(attempt),
                ip_address: ip,
                user_agent: userAgent,
                timestamp: new Date()
            });
        }
        catch (error) {
            this.logger.error('Error tracking login attempt:', error);
        }
    }
    async trackAuthEvent(event, data) {
        try {
            await this.db('analytics').insert({
                event,
                user_id: data.userId || null,
                session_id: 'auth',
                data: JSON.stringify(data),
                ip_address: data.ip || '0.0.0.0',
                user_agent: data.userAgent || '',
                timestamp: new Date()
            });
        }
        catch (error) {
            this.logger.error('Error tracking auth event:', error);
        }
    }
    createSuccessResponse(data) {
        return {
            success: true,
            data,
            timestamp: new Date(),
            requestId: Math.random().toString(36).substring(2, 15)
        };
    }
    createErrorResponse(message, details) {
        return {
            success: false,
            error: message,
            data: details || null,
            timestamp: new Date(),
            requestId: Math.random().toString(36).substring(2, 15)
        };
    }
}
exports.AuthController = AuthController;
// Validation middleware for auth endpoints
exports.authValidations = {
    register: [
        (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        (0, express_validator_1.body)('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .withMessage('Password must contain uppercase, lowercase, number and special character'),
        (0, express_validator_1.body)('firstName').isLength({ min: 1, max: 50 }).withMessage('First name required (1-50 characters)'),
        (0, express_validator_1.body)('lastName').isLength({ min: 1, max: 50 }).withMessage('Last name required (1-50 characters)'),
        (0, express_validator_1.body)('preferences').optional().isObject().withMessage('Preferences must be an object')
    ],
    login: [
        (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        (0, express_validator_1.body)('password').notEmpty().withMessage('Password required'),
        (0, express_validator_1.body)('rememberMe').optional().isBoolean().withMessage('Remember me must be boolean')
    ],
    refreshToken: [
        (0, express_validator_1.body)('refreshToken').notEmpty().withMessage('Refresh token required')
    ],
    resendVerification: [
        (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email required')
    ],
    requestPasswordReset: [
        (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email required')
    ],
    resetPassword: [
        (0, express_validator_1.body)('token').notEmpty().withMessage('Reset token required'),
        (0, express_validator_1.body)('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .withMessage('Password must contain uppercase, lowercase, number and special character')
    ],
    updateProfile: [
        (0, express_validator_1.body)('firstName').optional().isLength({ min: 1, max: 50 }).withMessage('First name must be 1-50 characters'),
        (0, express_validator_1.body)('lastName').optional().isLength({ min: 1, max: 50 }).withMessage('Last name must be 1-50 characters'),
        (0, express_validator_1.body)('preferences').optional().isObject().withMessage('Preferences must be an object')
    ]
};
exports.default = AuthController;
//# sourceMappingURL=authController.js.map