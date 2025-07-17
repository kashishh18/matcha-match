exports.up = async function(knex) {
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
    
    table.index(['is_active']);
    table.index(['last_scraped']);
  });

  // Matcha Products Table
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
    table.jsonb('flavor_profile').notNullable();
    table.string('size').notNullable();
    table.integer('weight').notNullable();
    table.integer('view_count').defaultTo(0);
    table.integer('purchase_count').defaultTo(0);
    table.timestamp('scraped_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    table.index(['provider_id']);
    table.index(['in_stock']);
    table.index(['grade']);
    table.index(['origin']);
    table.index(['price']);
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
  });

  console.log('✅ Core tables created successfully');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('matcha_products');
  await knex.schema.dropTableIfExists('matcha_providers');
  
  console.log('✅ Core tables dropped successfully');
};
