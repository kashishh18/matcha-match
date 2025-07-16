// Matcha Match - API Service
// Handles all HTTP requests to the backend API

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.API = {
  // Base configuration
  baseURL: window.MatchaMatch.Config.API_BASE_URL,
  
  // Auth token management
  getAuthToken() {
    return localStorage.getItem('auth_token');
  },
  
  setAuthToken(token) {
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  },
  
  // Generic request handler
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const token = this.getAuthToken();
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    };
    
    const finalOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    };
    
    try {
      const response = await fetch(url, finalOptions);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }
      
      return data;
    } catch (error) {
      console.error('API Request failed:', error);
      throw error;
    }
  },
  
  // Authentication methods
  async register(userData) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },
  
  async login(credentials) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });
    
    if (response.success && response.data.accessToken) {
      this.setAuthToken(response.data.accessToken);
    }
    
    return response;
  },
  
  async logout() {
    const response = await this.request('/auth/logout', {
      method: 'POST'
    });
    
    this.setAuthToken(null);
    return response;
  },
  
  async getProfile() {
    return this.request('/auth/profile');
  },
  
  // Products methods
  async getProducts(filters = {}) {
    const params = new URLSearchParams();
    
    Object.keys(filters).forEach(key => {
      if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
        if (Array.isArray(filters[key])) {
          filters[key].forEach(value => params.append(key, value));
        } else {
          params.append(key, filters[key]);
        }
      }
    });
    
    const queryString = params.toString();
    const endpoint = queryString ? `/products?${queryString}` : '/products';
    
    return this.request(endpoint);
  },
  
  async getProduct(id) {
    return this.request(`/products/${id}`);
  },
  
  async getFeaturedProducts() {
    return this.request('/products/featured');
  },
  
  async getTrendingProducts() {
    return this.request('/products/trending');
  },
  
  // Search methods
  async search(query, filters = {}) {
    const params = new URLSearchParams();
    
    if (query) {
      params.append('q', query);
    }
    
    Object.keys(filters).forEach(key => {
      if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
        if (Array.isArray(filters[key])) {
          filters[key].forEach(value => params.append(key, value));
        } else {
          params.append(key, filters[key]);
        }
      }
    });
    
    const queryString = params.toString();
    const endpoint = queryString ? `/search?${queryString}` : '/search';
    
    return this.request(endpoint);
  },
  
  async getAutocomplete(query) {
    const params = new URLSearchParams({
      q: query,
      limit: window.MatchaMatch.Config.AUTOCOMPLETE_MAX_RESULTS
    });
    
    return this.request(`/search/autocomplete?${params.toString()}`);
  },
  
  async getSearchSuggestions() {
    return this.request('/search/suggestions');
  },
  
  // Recommendations methods
  async getRecommendations() {
    return this.request('/recommendations');
  },
  
  async trackRecommendationClick(recommendationId) {
    return this.request(`/recommendations/${recommendationId}/click`, {
      method: 'POST'
    });
  },
  
  // Health check
  async getHealth() {
    return this.request('/health');
  }
};
