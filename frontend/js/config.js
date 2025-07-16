// Matcha Match - Configuration and Constants
// Central configuration for the entire frontend application

window.MatchaMatch = window.MatchaMatch || {};

// API Configuration
window.MatchaMatch.Config = {
  // API Base URL - Change this when you deploy your backend
  API_BASE_URL: 'http://localhost:3001/api',
  
  // WebSocket URL - Change this when you deploy your backend
  WEBSOCKET_URL: 'http://localhost:3001',
  
  // Application Settings
  APP_NAME: 'Matcha Match',
  VERSION: '1.0.0',
  
  // Pagination
  PRODUCTS_PER_PAGE: 20,
  RECOMMENDATIONS_PER_PAGE: 10,
  
  // Search Configuration
  SEARCH_DEBOUNCE_MS: 300,
  AUTOCOMPLETE_MIN_CHARS: 2,
  AUTOCOMPLETE_MAX_RESULTS: 8,
  
  // Real-time Updates
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 3000,
  
  // Cache TTL (Time To Live)
  CACHE_TTL: {
    PRODUCTS: 5 * 60 * 1000,     // 5 minutes
    SEARCH: 2 * 60 * 1000,       // 2 minutes
    FILTERS: 30 * 60 * 1000,     // 30 minutes
    USER_PROFILE: 10 * 60 * 1000 // 10 minutes
  },
  
  // Animation Timings
  ANIMATION: {
    FAST: 150,
    NORMAL: 300,
    SLOW: 500,
    TOAST_DURATION: 5000,
    MODAL_TRANSITION: 300
  }
};

// API Endpoints
window.MatchaMatch.Endpoints = {
  // Authentication
  AUTH: {
    REGISTER: '/auth/register',
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    PROFILE: '/auth/profile'
  },
  
  // Products
  PRODUCTS: {
    LIST: '/products',
    DETAIL: '/products/:id',
    FEATURED: '/products/featured',
    TRENDING: '/products/trending'
  },
  
  // Search
  SEARCH: {
    MAIN: '/search',
    AUTOCOMPLETE: '/search/autocomplete',
    SUGGESTIONS: '/search/suggestions'
  },
  
  // Recommendations
  RECOMMENDATIONS: {
    GET: '/recommendations'
  },
  
  // Health & System
  HEALTH: '/health'
};

// Error Messages
window.MatchaMatch.ErrorMessages = {
  NETWORK_ERROR: 'Unable to connect to the server. Please check your internet connection.',
  AUTHENTICATION_REQUIRED: 'Please sign in to access this feature.',
  INVALID_CREDENTIALS: 'Invalid email or password. Please try again.',
  SEARCH_FAILED: 'Search request failed. Please try again.',
  LOAD_PRODUCTS_FAILED: 'Failed to load products. Please refresh the page.',
  GENERIC_ERROR: 'Something went wrong. Please try again.'
};

// Success Messages
window.MatchaMatch.SuccessMessages = {
  REGISTRATION_SUCCESS: 'Account created successfully! Please check your email to verify your account.',
  LOGIN_SUCCESS: 'Welcome back! You have been signed in successfully.',
  LOGOUT_SUCCESS: 'You have been signed out successfully.',
  PROFILE_UPDATED: 'Profile updated successfully.'
};
