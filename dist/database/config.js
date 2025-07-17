"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeDatabaseConnection = exports.checkDatabaseHealth = exports.initializeDatabase = void 0;
// Database configuration for PostgreSQL with connection pooling
// This handles high-traffic scenarios that FAANG systems need to support
const config = {
    development: {
        client: 'postgresql',
        connection: {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'password',
            database: process.env.DB_NAME || 'matcha_match_dev',
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        },
        pool: {
            min: 2,
            max: 10,
            createTimeoutMillis: 3000,
            acquireTimeoutMillis: 30000,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 100,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: './src/database/migrations',
        },
        seeds: {
            directory: './src/database/seeds',
        },
    },
    production: {
        client: 'postgresql',
        connection: {
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
        },
        pool: {
            min: 2,
            max: 20, // Higher for production load
            createTimeoutMillis: 3000,
            acquireTimeoutMillis: 30000,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 100,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: './src/database/migrations',
        },
        seeds: {
            directory: './src/database/seeds',
        },
    },
};
exports.default = config;
// Initialize database connection with proper error handling
const initializeDatabase = async () => {
    const knex = require('knex');
    const environment = process.env.NODE_ENV || 'development';
    const db = knex(config[environment]);
    try {
        // Test the connection
        await db.raw('SELECT 1');
        console.log(`✅ Database connected successfully (${environment})`);
        // Run migrations automatically
        await db.migrate.latest();
        console.log('✅ Database migrations completed');
        return db;
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        throw error;
    }
};
exports.initializeDatabase = initializeDatabase;
// Database health check for monitoring
const checkDatabaseHealth = async (db) => {
    try {
        await db.raw('SELECT 1');
        return true;
    }
    catch (error) {
        console.error('Database health check failed:', error);
        return false;
    }
};
exports.checkDatabaseHealth = checkDatabaseHealth;
// Graceful shutdown
const closeDatabaseConnection = async (db) => {
    try {
        await db.destroy();
        console.log('✅ Database connection closed gracefully');
    }
    catch (error) {
        console.error('❌ Error closing database connection:', error);
    }
};
exports.closeDatabaseConnection = closeDatabaseConnection;
//# sourceMappingURL=config.js.map