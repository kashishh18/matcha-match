import { Knex } from 'knex';

// Database migration for FAANG-level matcha recommendation system
// Creates all core tables with proper indexing for performance

export async function up(knex: Knex): Promise<void> {
  // Matcha Providers Table
  await knex.schema.createTable('matcha_providers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable().unique();
    table.string('base_url').notNullable();
    table.boolean('is_active').defaultTo(true);
    table.jsonb('scrape_config').notNullable();
    table.timestamp('last_scraped').nullable();
    table.integer('average_response_time').defaultTo(0);
    table.decimal('success_rate', 5, 2).defaultTo(100.00);
    table.timestamps(true, true);
    
    // Indexes for performance
    table.index(['is_active']);
    table.index(['last_scraped']);
  });

  // Matcha Products Table - Core inventory
  await knex.schema.createTable('matcha_products', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.uuid('provider_id').references('id').inTable('matcha_providers').onDelete('CASCADE');
    table.decimal('price', 10, 2).notNullable();
    table.decimal('original_price', 10, 2).nullable();
    table.boolean('in_stock').defaultTo(true);
    table.integer('stock_count').defaultTo(0);
    table.text('description').nullable();
    table.string('image_url').nullable();
    table.string('product_url').notNullable();
    table.enum('grade', ['ceremonial', 'premium', 'culinary', 'ingredient']).notNullable();
    table.string('origin').notNullable();
    table.jsonb('flavor_profile').notNullable(); // Array of flavor profiles
    table.string('size').notNullable();
    table.integer('weight').notNullable(); // in grams
    table.integer('view_count').defaultTo(0);
    table.integer('purchase_count').defaultTo(0);
    table.timestamp('scraped_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    // Critical indexes for search and filtering performance
    table.index(['provider_id']);
    table.index(['in_stock']);
    table.index(['grade']);
    table.index(['origin']);
    table.index(['price']);
    table.index(['view_count']);
    table.index(['purchase_count']);
    table.index(['scraped_at']);
    
    // Composite indexes for common query patterns
    table.index(['in_stock', 'grade']);
    table.index(['provider_id', 'in_stock']);
    table.index(['price', 'in_stock']);
  });

  // Users Table
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.jsonb('preferences').defaultTo('{}');
    table.boolean('is_email_verified').defaultTo(false);
    table.enum('subscription_tier', ['free', 'premium']).defaultTo('free');
    table.timestamp('last_login').nullable();
    table.timestamps(true, true);
    
    table.index(['email']);
    table.index(['subscription_tier']);
  });

  // Stock Alerts Table - Real-time feature
  await knex.schema.createTable('stock_alerts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.uuid('product_id').references('id').inTable('matcha_products').onDelete('CASCADE');
    table.enum('alert_type', ['back_in_stock', 'price_drop', 'low_stock']).notNullable();
    table.decimal('target_price', 10, 2).nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('triggered_at').nullable();
    table.timestamps(true, true);
    
    // Indexes for real-time alert processing
    table.index(['user_id']);
    table.index(['product_id']);
    table.index(['is_active']);
    table.index(['alert_type']);
    
    // Composite index for alert queries
    table.index(['is_active', 'alert_type']);
  });

  // Recommendations Table - ML feature
  await knex.schema.createTable('recommendations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.uuid('product_id').references('id').inTable('matcha_products').onDelete('CASCADE');
    table.decimal('score', 5, 4).notNullable(); // 0.0000 to 1.0000
    table.jsonb('reason').notNullable(); // RecommendationReason object
    table.enum('algorithm', ['collaborative', 'content_based', 'hybrid']).notNullable();
    table.string('ab_test_group').notNullable();
    table.timestamp('clicked_at').nullable();
    table.timestamp('purchased_at').nullable();
    table.timestamps(true, true);
    
    // Indexes for recommendation serving and analytics
    table.index(['user_id']);
    table.index(['product_id']);
    table.index(['algorithm']);
    table.index(['ab_test_group']);
    table.index(['score']);
    
    // Composite indexes for recommendation queries
    table.index(['user_id', 'score']);
    table.index(['algorithm', 'ab_test_group']);
  });

  // Search Queries Table - Advanced search analytics
  await knex.schema.createTable('search_queries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('query').notNullable();
    table.jsonb('filters').defaultTo('{}');
    table.jsonb('results').defaultTo('[]'); // Array of SearchResult objects
    table.integer('response_time').notNullable(); // milliseconds
    table.decimal('click_through_rate', 5, 4).defaultTo(0);
    table.timestamps(true, true);
    
    // Indexes for search analytics
    table.index(['user_id']);
    table.index(['query']);
    table.index(['response_time']);
    table.index(['click_through_rate']);
    table.index(['created_at']);
  });

  // User Sessions Table
  await knex.schema.createTable('user_sessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('session_token').notNullable().unique();
    table.string('ip_address').notNullable();
    table.text('user_agent').notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('expires_at').notNullable();
    table.timestamps(true, true);
    
    table.index(['user_id']);
    table.index(['session_token']);
    table.index(['is_active']);
    table.index(['expires_at']);
  });

  // A/B Test Experiments Table
  await knex.schema.createTable('ab_test_experiments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable().unique();
    table.text('description').nullable();
    table.jsonb('variants').notNullable(); // Array of ABTestVariant objects
    table.boolean('is_active').defaultTo(false);
    table.timestamp('start_date').notNullable();
    table.timestamp('end_date').nullable();
    table.decimal('traffic_allocation', 5, 2).defaultTo(100.00); // percentage
    table.timestamps(true, true);
    
    table.index(['is_active']);
    table.index(['start_date']);
    table.index(['end_date']);
  });

  // User A/B Test Assignments Table
  await knex.schema.createTable('user_ab_tests', (table) => {
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.uuid('experiment_id').references('id').inTable('ab_test_experiments').onDelete('CASCADE');
    table.string('variant_id').notNullable();
    table.timestamp('assigned_at').defaultTo(knex.fn.now());
    
    table.primary(['user_id', 'experiment_id']);
    table.index(['experiment_id']);
    table.index(['variant_id']);
  });

  // Analytics Events Table
  await knex.schema.createTable('analytics', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('event').notNullable();
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('session_id').notNullable();
    table.jsonb('data').defaultTo('{}');
    table.string('ip_address').notNullable();
    table.text('user_agent').notNullable();
    table.timestamp('timestamp').defaultTo(knex.fn.now());
    
    // Indexes for analytics queries
    table.index(['event']);
    table.index(['user_id']);
    table.index(['session_id']);
    table.index(['timestamp']);
    
    // Composite index for event analysis
    table.index(['event', 'timestamp']);
  });

  console.log('✅ Core tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order to handle foreign key constraints
  await knex.schema.dropTableIfExists('analytics');
  await knex.schema.dropTableIfExists('user_ab_tests');
  await knex.schema.dropTableIfExists('ab_test_experiments');
  await knex.schema.dropTableIfExists('user_sessions');
  await knex.schema.dropTableIfExists('search_queries');
  await knex.schema.dropTableIfExists('recommendations');
  await knex.schema.dropTableIfExists('stock_alerts');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('matcha_products');
  await knex.schema.dropTableIfExists('matcha_providers');
  
  console.log('✅ Core tables dropped successfully');
}
