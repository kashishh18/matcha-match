// Matcha Match - Products Handler
// Manages product display, loading, and interactions

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.Products = {
  currentPage: 1,
  totalPages: 1,
  isLoading: false,
  viewMode: 'grid',
  
  // Initialize products functionality
  init() {
    this.setupViewToggle();
    this.setupLoadMore();
    this.loadProducts();
    this.loadFeaturedProducts();
  },
  
  // Setup view toggle (grid/list)
  setupViewToggle() {
    const viewBtns = document.querySelectorAll('.view-btn');
    
    viewBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.changeView(view);
        
        // Update active state
        viewBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },
  
  // Setup load more button
  setupLoadMore() {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.loadMoreProducts();
      });
    }
  },
  
  // Change view mode
  changeView(view) {
    this.viewMode = view;
    const productsGrid = document.getElementById('productsGrid');
    
    if (productsGrid) {
      productsGrid.className = view === 'list' ? 'products-list' : 'products-grid';
    }
  },
  
  // Load initial products
  async loadProducts() {
    this.showLoading();
    
    try {
      const response = await window.MatchaMatch.API.getProducts({
        page: 1,
        limit: window.MatchaMatch.Config.PRODUCTS_PER_PAGE
      });
      
      if (response.success) {
        this.displayProducts(response.data.products);
        this.updatePagination(response.data.pagination);
        this.hideLoading();
      } else {
        this.showNoResults();
      }
    } catch (error) {
      console.error('Load products error:', error);
      this.showError();
    }
  },
  
  // Load more products (pagination)
  async loadMoreProducts() {
    if (this.isLoading || this.currentPage >= this.totalPages) return;
    
    this.isLoading = true;
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.innerHTML = `
        <div class="spinner"></div>
        <span>Loading...</span>
      `;
    }
    
    try {
      const response = await window.MatchaMatch.API.getProducts({
        page: this.currentPage + 1,
        limit: window.MatchaMatch.Config.PRODUCTS_PER_PAGE
      });
      
      if (response.success) {
        this.appendProducts(response.data.products);
        this.updatePagination(response.data.pagination);
      }
    } catch (error) {
      console.error('Load more products error:', error);
      window.MatchaMatch.Utils.showToast(
        window.MatchaMatch.ErrorMessages.LOAD_PRODUCTS_FAILED,
        'error'
      );
    } finally {
      this.isLoading = false;
      if (loadMoreBtn) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.innerHTML = `
          <span>Load More Premium Matcha</span>
          <i class="fas fa-arrow-down"></i>
        `;
      }
    }
  },
  
  // Load featured products
  async loadFeaturedProducts() {
    try {
      const response = await window.MatchaMatch.API.getFeaturedProducts();
      
      if (response.success) {
        // Could display these in a special section
        console.log('Featured products loaded:', response.data);
      }
    } catch (error) {
      console.error('Featured products error:', error);
    }
  },
  
  // Display products in grid
  displayProducts(products) {
    const productsGrid = document.getElementById('productsGrid');
    const noResults = document.getElementById('noResults');
    
    if (!productsGrid) return;
    
    if (products.length === 0) {
      this.showNoResults();
      return;
    }
    
    productsGrid.innerHTML = products.map(product => this.createProductCard(product)).join('');
    productsGrid.style.display = 'grid';
    
    if (noResults) {
      noResults.style.display = 'none';
    }
    
    // Setup product interactions
    this.setupProductInteractions();
  },
  
  // Append products for pagination
  appendProducts(products) {
    const productsGrid = document.getElementById('productsGrid');
    
    if (!productsGrid) return;
    
    const newProductsHTML = products.map(product => this.createProductCard(product)).join('');
    productsGrid.insertAdjacentHTML('beforeend', newProductsHTML);
    
    // Setup interactions for new products
    this.setupProductInteractions();
  },
  
  // Create product card HTML
  createProductCard(product) {
    const isOnSale = product.originalPrice && product.originalPrice > product.price;
    const discount = isOnSale ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
    
    return `
      <div class="product-card-item" data-product-id="${product.id}">
        <div class="product-image-container">
          <div class="product-image">
            ${this.getProductEmoji(product.grade)}
          </div>
          
          ${isOnSale ? `<div class="product-badge">-${discount}%</div>` : ''}
          
          <div class="product-actions">
            <button class="action-btn favorite-btn" data-product-id="${product.id}" title="Add to favorites">
              <i class="fas fa-heart"></i>
            </button>
            <button class="action-btn share-btn" data-product-id="${product.id}" title="Share">
              <i class="fas fa-share-alt"></i>
            </button>
          </div>
        </div>
        
        <div class="product-info">
          <div class="product-header">
            <div>
              <h3 class="product-title">${product.name}</h3>
              <p class="product-provider">${product.provider.name}</p>
            </div>
            <div class="product-price ${isOnSale ? 'on-sale' : ''}">
              $${product.price.toFixed(2)}
              ${isOnSale ? `<span class="original-price">$${product.originalPrice.toFixed(2)}</span>` : ''}
            </div>
          </div>
          
          <p class="product-description">${product.description}</p>
          
          <div class="product-meta">
            <span class="product-grade">${product.grade}</span>
            <span class="product-origin">${product.origin}</span>
          </div>
          
          <div class="flavor-profiles">
            ${product.flavorProfile.map(flavor => `
              <span class="flavor-chip">${flavor}</span>
            `).join('')}
          </div>
          
          <div class="product-footer">
            <div class="stock-status ${product.inStock ? 'in-stock' : 'out-of-stock'}">
              <div class="stock-indicator"></div>
              <span>${product.inStock ? 'In Stock' : 'Out of Stock'}</span>
            </div>
            
            <div class="viewers-count" data-product-id="${product.id}">
              <i class="fas fa-eye"></i>
              <span>0 viewing</span>
            </div>
          </div>
        </div>
      </div>
    `;
  },
  
  // Get emoji for product grade
  getProductEmoji(grade) {
    const emojis = {
      ceremonial: '🍵',
      premium: '🌟',
      culinary: '🍰',
      ingredient: '🥄'
    };
    return emojis[grade] || '🍃';
  },
  
  // Setup product interactions
  setupProductInteractions() {
    // Product card clicks
    document.querySelectorAll('.product-card-item').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking on action buttons
        if (e.target.closest('.action-btn')) return;
        
        const productId = card.dataset.productId;
        this.showProductModal(productId);
      });
    });
    
    // Favorite buttons
    document.querySelectorAll('.favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        this.toggleFavorite(productId, btn);
      });
    });
    
    // Share buttons
    document.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        this.shareProduct(productId);
      });
    });
  },
  
  // Show product modal
  async showProductModal(productId) {
    const modal = document.getElementById('productModal');
    const modalBody = document.getElementById('productModalBody');
    
    if (!modal || !modalBody) return;
    
    // Show loading state
    modalBody.innerHTML = `
      <div class="modal-loading">
        <div class="spinner"></div>
        <p>Loading product details...</p>
      </div>
    `;
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    try {
      const response = await window.MatchaMatch.API.getProduct(productId);
      
      if (response.success) {
        const product = response.data.product;
        const similarProducts = response.data.similarProducts || [];
        
        modalBody.innerHTML = this.createProductModalContent(product, similarProducts);
        this.setupProductModal();
      } else {
        modalBody.innerHTML = `
          <div class="modal-error">
            <p>Failed to load product details</p>
            <button class="btn-secondary" onclick="window.MatchaMatch.Products.hideProductModal()">Close</button>
          </div>
        `;
      }
    } catch (error) {
      console.error('Product modal error:', error);
      modalBody.innerHTML = `
        <div class="modal-error">
          <p>Error loading product</p>
          <button class="btn-secondary" onclick="window.MatchaMatch.Products.hideProductModal()">Close</button>
        </div>
      `;
    }
  },
  
  // Hide product modal
  hideProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  },
  
  // Create product modal content
  createProductModalContent(product, similarProducts) {
    const isOnSale = product.originalPrice && product.originalPrice > product.price;
    const discount = isOnSale ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
    
    return `
      <div class="product-modal-content">
        <div class="product-modal-header">
          <div class="product-modal-image">
            ${this.getProductEmoji(product.grade)}
          </div>
          <div class="product-modal-info">
            <h2>${product.name}</h2>
            <p class="product-provider">${product.provider.name}</p>
            <div class="product-price ${isOnSale ? 'on-sale' : ''}">
              $${product.price.toFixed(2)}
              ${isOnSale ? `<span class="original-price">$${product.originalPrice.toFixed(2)}</span>` : ''}
              ${isOnSale ? `<span class="discount-badge">-${discount}%</span>` : ''}
            </div>
          </div>
        </div>
        
        <div class="product-modal-body">
          <div class="product-details">
            <h3>Product Details</h3>
            <p class="product-description">${product.description}</p>
            
            <div class="product-specs">
              <div class="spec-item">
                <strong>Grade:</strong> ${product.grade}
              </div>
              <div class="spec-item">
                <strong>Origin:</strong> ${product.origin}
              </div>
              <div class="spec-item">
                <strong>Size:</strong> ${product.size}
              </div>
              <div class="spec-item">
                <strong>Weight:</strong> ${product.weight}g
              </div>
            </div>
            
            <div class="flavor-profiles">
              <h4>Flavor Profile</h4>
              <div class="flavor-tags">
                ${product.flavorProfile.map(flavor => `
                  <span class="flavor-chip">${flavor}</span>
                `).join('')}
              </div>
            </div>
          </div>
          
          <div class="product-actions-modal">
            <div class="stock-status ${product.inStock ? 'in-stock' : 'out-of-stock'}">
              <div class="stock-indicator"></div>
              <span>${product.inStock ? 'In Stock' : 'Out of Stock'}</span>
            </div>
            
            <button class="btn-primary" ${!product.inStock ? 'disabled' : ''}>
              <i class="fas fa-external-link-alt"></i>
              View on ${product.provider.name}
            </button>
            
            <button class="btn-secondary favorite-btn" data-product-id="${product.id}">
              <i class="fas fa-heart"></i>
              Add to Favorites
            </button>
          </div>
        </div>
        
        ${similarProducts.length > 0 ? `
          <div class="similar-products">
            <h3>Similar Products</h3>
            <div class="similar-products-grid">
              ${similarProducts.slice(0, 4).map(similar => `
                <div class="similar-product-card" data-product-id="${similar.id}">
                  <div class="similar-product-image">${this.getProductEmoji(similar.grade)}</div>
                  <div class="similar-product-info">
                    <h4>${similar.name}</h4>
                    <p>${similar.provider.name}</p>
                    <div class="similar-product-price">$${similar.price.toFixed(2)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },
  
  // Setup product modal interactions
  setupProductModal() {
    const modal = document.getElementById('productModal');
    const closeBtn = document.getElementById('productModalClose');
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hideProductModal();
      });
    }
    
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideProductModal();
        }
      });
    }
    
    // Similar product clicks
    document.querySelectorAll('.similar-product-card').forEach(card => {
      card.addEventListener('click', () => {
        const productId = card.dataset.productId;
        this.showProductModal(productId);
      });
    });
  },
  
  // Toggle favorite
  toggleFavorite(productId, btn) {
    const icon = btn.querySelector('i');
    const isFavorited = icon.classList.contains('fas');
    
    if (isFavorited) {
      icon.classList.remove('fas');
      icon.classList.add('far');
      btn.title = 'Add to favorites';
    } else {
      icon.classList.remove('far');
      icon.classList.add('fas');
      btn.title = 'Remove from favorites';
    }
    
    // Here you would typically save to localStorage or send to API
    console.log('Toggled favorite for product:', productId);
  },
  
  // Share product
  shareProduct(productId) {
    if (navigator.share) {
      navigator.share({
        title: 'Check out this matcha!',
        text: 'I found this amazing matcha on Matcha Match',
        url: window.location.href
      });
    } else {
      // Fallback: copy to clipboard
      const url = `${window.location.origin}?product=${productId}`;
      navigator.clipboard.writeText(url).then(() => {
        window.MatchaMatch.Utils.showToast('Product link copied to clipboard!', 'success');
      });
    }
  },
  
  // Update pagination
  updatePagination(pagination) {
    this.currentPage = pagination.page;
    this.totalPages = pagination.pages;
    
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    if (loadMoreContainer && loadMoreBtn) {
      if (this.currentPage >= this.totalPages) {
        loadMoreContainer.style.display = 'none';
      } else {
        loadMoreContainer.style.display = 'flex';
      }
    }
  },
  
  // Show loading state
  showLoading() {
    const loadingState = document.getElementById('loadingState');
    const productsGrid = document.getElementById('productsGrid');
    const noResults = document.getElementById('noResults');
    
    if (loadingState) loadingState.style.display = 'flex';
    if (productsGrid) productsGrid.style.display = 'none';
    if (noResults) noResults.style.display = 'none';
  },
  
  // Hide loading state
  hideLoading() {
    const loadingState = document.getElementById('loadingState');
    if (loadingState) loadingState.style.display = 'none';
  },
  
  // Show no results state
  showNoResults() {
    const loadingState = document.getElementById('loadingState');
    const productsGrid = document.getElementById('productsGrid');
    const noResults = document.getElementById('noResults');
    
    if (loadingState) loadingState.style.display = 'none';
    if (productsGrid) productsGrid.style.display = 'none';
    if (noResults) noResults.style.display = 'block';
  },
  
  // Show error state
  showError() {
    this.hideLoading();
    window.MatchaMatch.Utils.showToast(
      window.MatchaMatch.ErrorMessages.LOAD_PRODUCTS_FAILED,
      'error'
    );
  }
};
