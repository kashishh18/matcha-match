// Matcha Match - Recommendations Handler
// Manages AI-powered recommendations and user preferences

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.Recommendations = {
  recommendations: [],
  isLoading: false,
  
  // Initialize recommendations functionality
  init() {
    this.setupRecommendationsButton();
    this.checkAuthAndLoad();
  },
  
  // Setup recommendations button
  setupRecommendationsButton() {
    const recommendationsBtn = document.getElementById('recommendationsBtn');
    
    if (recommendationsBtn) {
      recommendationsBtn.addEventListener('click', () => {
        this.showRecommendations();
      });
    }
  },
  
  // Check if user is authenticated and load recommendations
  checkAuthAndLoad() {
    if (window.MatchaMatch.Auth && window.MatchaMatch.Auth.isAuthenticated) {
      this.loadRecommendations();
    }
  },
  
  // Load recommendations from API
  async loadRecommendations() {
    if (this.isLoading) return;
    
    // Check if user is authenticated
    if (!window.MatchaMatch.Auth || !window.MatchaMatch.Auth.isAuthenticated) {
      this.showAuthRequired();
      return;
    }
    
    this.isLoading = true;
    const recommendationsSection = document.getElementById('recommendationsSection');
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    
    if (!recommendationsSection || !recommendationsGrid) return;
    
    // Show loading state
    recommendationsGrid.innerHTML = this.createLoadingHTML();
    recommendationsSection.style.display = 'block';
    
    try {
      const response = await window.MatchaMatch.API.getRecommendations();
      
      if (response.success && response.data.length > 0) {
        this.recommendations = response.data;
        this.displayRecommendations(response.data);
      } else {
        this.showNoRecommendations();
      }
    } catch (error) {
      console.error('Recommendations error:', error);
      this.showRecommendationsError();
    } finally {
      this.isLoading = false;
    }
  },
  
  // Display recommendations
  displayRecommendations(recommendations) {
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    
    if (!recommendationsGrid) return;
    
    recommendationsGrid.innerHTML = recommendations.map(rec => 
      this.createRecommendationCard(rec)
    ).join('');
    
    // Setup recommendation interactions
    this.setupRecommendationInteractions();
  },
  
  // Create recommendation card HTML
  createRecommendationCard(recommendation) {
    const product = recommendation.product;
    const reason = recommendation.reason;
    
    if (!product) return '';
    
    const confidenceWidth = Math.round(reason.confidence * 100);
    const reasonIcon = this.getReasonIcon(reason.type);
    
    return `
      <div class="recommendation-card" data-recommendation-id="${recommendation.id}">
        <div class="recommendation-reason">
          <i class="fas fa-${reasonIcon}"></i>
          <span>${reason.explanation}</span>
          <div class="confidence-bar">
            <div class="confidence-fill" style="width: ${confidenceWidth}%"></div>
          </div>
        </div>
        
        <div class="recommendation-product">
          <div class="product-image">
            ${this.getProductEmoji(product.grade)}
          </div>
          
          <div class="product-info">
            <h4 class="product-title">${product.name}</h4>
            <p class="product-provider">${product.provider.name}</p>
            <p class="product-description">${product.description}</p>
            
            <div class="product-meta">
              <span class="product-grade">${product.grade}</span>
              <span class="product-origin">${product.origin}</span>
              <span class="product-price">$${product.price.toFixed(2)}</span>
            </div>
            
            <div class="flavor-profiles">
              ${product.flavorProfile.slice(0, 3).map(flavor => `
                <span class="flavor-chip">${flavor}</span>
              `).join('')}
            </div>
            
            <div class="recommendation-actions">
              <button class="btn-primary recommendation-view" data-product-id="${product.id}">
                <i class="fas fa-eye"></i>
                View Details
              </button>
              <button class="btn-secondary recommendation-dismiss" data-recommendation-id="${recommendation.id}">
                <i class="fas fa-times"></i>
                Not Interested
              </button>
            </div>
          </div>
        </div>
        
        <div class="recommendation-meta">
          <span class="algorithm-badge algorithm-${recommendation.algorithm}">
            ${this.getAlgorithmName(recommendation.algorithm)}
          </span>
          <span class="confidence-text">${confidenceWidth}% match</span>
        </div>
      </div>
    `;
  },
  
  // Get emoji for product grade
  getProductEmoji(grade) {
    const emojis = {
      ceremonial: '🍵',
      premium: '⭐',
      culinary: '🍰',
      ingredient: '🥄'
    };
    return emojis[grade] || '🍃';
  },
  
  // Get icon for recommendation reason
  getReasonIcon(reasonType) {
    const icons = {
      similar_users: 'users',
      similar_products: 'clone',
      price_preference: 'dollar-sign',
      flavor_match: 'leaf',
      trending: 'fire'
    };
    return icons[reasonType] || 'magic';
  },
  
  // Get algorithm display name
  getAlgorithmName(algorithm) {
    const names = {
      collaborative: 'Collaborative',
      content_based: 'Content-Based',
      hybrid: 'Hybrid AI'
    };
    return names[algorithm] || 'AI';
  },
  
  // Setup recommendation interactions
  setupRecommendationInteractions() {
    // View product buttons
    document.querySelectorAll('.recommendation-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const productId = btn.dataset.productId;
        const recommendationId = btn.closest('.recommendation-card').dataset.recommendationId;
        
        // Track the click
        this.trackRecommendationClick(recommendationId);
        
        // Show product modal
        if (window.MatchaMatch.Products) {
          window.MatchaMatch.Products.showProductModal(productId);
        }
      });
    });
    
    // Dismiss recommendation buttons
    document.querySelectorAll('.recommendation-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const recommendationId = btn.dataset.recommendationId;
        this.dismissRecommendation(recommendationId);
      });
    });
    
    // Card click (full card clickable)
    document.querySelectorAll('.recommendation-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking on buttons
        if (e.target.closest('button')) return;
        
        const recommendationId = card.dataset.recommendationId;
        const productId = card.querySelector('.recommendation-view').dataset.productId;
        
        // Track the click
        this.trackRecommendationClick(recommendationId);
        
        // Show product modal
        if (window.MatchaMatch.Products) {
          window.MatchaMatch.Products.showProductModal(productId);
        }
      });
    });
  },
  
  // Track recommendation click
  async trackRecommendationClick(recommendationId) {
    try {
      await window.MatchaMatch.API.trackRecommendationClick(recommendationId);
      console.log('Recommendation click tracked:', recommendationId);
    } catch (error) {
      console.error('Error tracking recommendation click:', error);
    }
  },
  
  // Dismiss recommendation
  dismissRecommendation(recommendationId) {
    const card = document.querySelector(`[data-recommendation-id="${recommendationId}"]`);
    
    if (card) {
      // Add dismiss animation
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(100px)';
      
      // Remove from DOM after animation
      setTimeout(() => {
        card.remove();
        
        // Check if any recommendations left
        const remainingCards = document.querySelectorAll('.recommendation-card');
        if (remainingCards.length === 0) {
          this.showNoRecommendations();
        }
      }, 300);
      
      // Remove from local array
      this.recommendations = this.recommendations.filter(rec => rec.id !== recommendationId);
      
      // Show feedback toast
      window.MatchaMatch.Utils.showToast(
        'Recommendation dismissed. This helps us improve your suggestions!',
        'success'
      );
    }
  },
  
  // Show recommendations section
  showRecommendations() {
    const recommendationsSection = document.getElementById('recommendationsSection');
    
    if (recommendationsSection) {
      recommendationsSection.scrollIntoView({ behavior: 'smooth' });
      
      // Load recommendations if not already loaded
      if (this.recommendations.length === 0) {
        this.loadRecommendations();
      }
    }
  },
  
  // Show auth required message
  showAuthRequired() {
    const recommendationsSection = document.getElementById('recommendationsSection');
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    
    if (!recommendationsSection || !recommendationsGrid) return;
    
    recommendationsGrid.innerHTML = `
      <div class="auth-required">
        <div class="auth-required-icon">
          <i class="fas fa-user-lock"></i>
        </div>
        <h3>Sign In for Personalized Recommendations</h3>
        <p>Get AI-powered matcha recommendations tailored to your taste preferences.</p>
        <button class="btn-primary" onclick="window.MatchaMatch.Auth.showAuthModal('login')">
          <i class="fas fa-sign-in-alt"></i>
          Sign In to Get Recommendations
        </button>
      </div>
    `;
    
    recommendationsSection.style.display = 'block';
  },
  
  // Show no recommendations message
  showNoRecommendations() {
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    
    if (!recommendationsGrid) return;
    
    recommendationsGrid.innerHTML = `
      <div class="no-recommendations">
        <div class="no-recommendations-icon">
          <i class="fas fa-magic"></i>
        </div>
        <h3>Building Your Taste Profile</h3>
        <p>Browse and interact with matcha products to get personalized recommendations.</p>
        <button class="btn-secondary" onclick="window.MatchaMatch.Products.loadProducts()">
          <i class="fas fa-search"></i>
          Explore Matcha Products
        </button>
      </div>
    `;
  },
  
  // Show recommendations error
  showRecommendationsError() {
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    
    if (!recommendationsGrid) return;
    
    recommendationsGrid.innerHTML = `
      <div class="recommendations-error">
        <div class="error-icon">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h3>Unable to Load Recommendations</h3>
        <p>There was an error loading your personalized recommendations.</p>
        <button class="btn-primary" onclick="window.MatchaMatch.Recommendations.loadRecommendations()">
          <i class="fas fa-redo"></i>
          Try Again
        </button>
      </div>
    `;
  },
  
  // Create loading HTML
  createLoadingHTML() {
    return `
      <div class="recommendations-loading">
        <div class="loading-spinner"></div>
        <h3>Generating Your Recommendations</h3>
        <p>Our AI is analyzing your preferences to find the perfect matcha matches...</p>
      </div>
    `;
  },
  
  // Refresh recommendations
  async refreshRecommendations() {
    this.recommendations = [];
    await this.loadRecommendations();
  },
  
  // Get recommendation by ID
  getRecommendationById(id) {
    return this.recommendations.find(rec => rec.id === id);
  },
  
  // Update recommendation preferences (called after user actions)
  updatePreferences(productId, action) {
    // This would typically send preference data to the API
    // For now, we'll just log it
    console.log('Updated preferences:', { productId, action });
    
    // Optionally refresh recommendations after significant actions
    if (action === 'purchase' || action === 'favorite') {
      setTimeout(() => {
        this.refreshRecommendations();
      }, 2000);
    }
  }
};
