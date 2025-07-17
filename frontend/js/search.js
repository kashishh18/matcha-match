// Matcha Match - Search Handler
// Manages search functionality, autocomplete, and filters

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.Search = {
  currentQuery: '',
  currentFilters: {},
  searchTimeout: null,
  autocompleteTimeout: null,
  
  // Initialize search functionality
  init() {
    this.setupGlobalSearch();
    this.setupFilters();
    this.setupAutocomplete();
    this.loadSearchSuggestions();
  },
  
  // Setup global search bar
  setupGlobalSearch() {
    const searchInput = document.getElementById('globalSearch');
    const searchBtn = document.getElementById('searchBtn');
    
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleSearchInput(e.target.value);
      });
      
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.performSearch(e.target.value);
        }
      });
    }
    
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const query = searchInput?.value || '';
        this.performSearch(query);
      });
    }
  },
  
  // Setup filter controls
  setupFilters() {
    this.setupQuickFilters();
    this.setupAdvancedFilters();
    this.setupSortControls();
  },
  
  // Setup quick filter buttons
  setupQuickFilters() {
    const quickFilters = document.getElementById('quickFilters');
    
    if (quickFilters) {
      quickFilters.addEventListener('click', (e) => {
        const filterBtn = e.target.closest('.filter-btn');
        if (filterBtn) {
          const filter = filterBtn.dataset.filter;
          this.handleQuickFilter(filter, filterBtn);
        }
      });
    }
  },
  
  // Setup advanced filters
  setupAdvancedFilters() {
    const priceRange = this.setupPriceRange();
    const originFilter = document.getElementById('originFilter');
    const flavorTags = document.getElementById('flavorTags');
    const inStockOnly = document.getElementById('inStockOnly');
    const clearFilters = document.getElementById('clearFilters');
    
    if (originFilter) {
      originFilter.addEventListener('change', () => {
        this.updateFilters();
      });
    }
    
    if (flavorTags) {
      flavorTags.addEventListener('click', (e) => {
        const flavorTag = e.target.closest('.flavor-tag');
        if (flavorTag) {
          flavorTag.classList.toggle('active');
          this.updateFilters();
        }
      });
    }
    
    if (inStockOnly) {
      inStockOnly.addEventListener('change', () => {
        this.updateFilters();
      });
    }
    
    if (clearFilters) {
      clearFilters.addEventListener('click', () => {
        this.clearAllFilters();
      });
    }
  },
  
  // Setup price range slider
  setupPriceRange() {
    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');
    const priceDisplay = document.getElementById('priceDisplay');
    
    if (minPrice && maxPrice && priceDisplay) {
      const updatePriceDisplay = () => {
        const min = parseInt(minPrice.value);
        const max = parseInt(maxPrice.value);
        
        // Ensure min doesn't exceed max
        if (min > max) {
          minPrice.value = max;
        }
        
        priceDisplay.textContent = `$${minPrice.value} - $${maxPrice.value}`;
        this.updateFilters();
      };
      
      minPrice.addEventListener('input', updatePriceDisplay);
      maxPrice.addEventListener('input', updatePriceDisplay);
      
      // Initial display
      updatePriceDisplay();
    }
  },
  
  // Setup sort controls
  setupSortControls() {
    const sortSelect = document.getElementById('sortSelect');
    
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.currentFilters.sortBy = sortSelect.value;
        this.performSearch(this.currentQuery);
      });
    }
  },
  
  // Setup autocomplete
  setupAutocomplete() {
    const searchInput = document.getElementById('globalSearch');
    const dropdown = document.getElementById('autocompleteDropdown');
    
    if (searchInput && dropdown) {
      searchInput.addEventListener('focus', () => {
        if (searchInput.value.length >= window.MatchaMatch.Config.AUTOCOMPLETE_MIN_CHARS) {
          this.showAutocomplete(searchInput.value);
        }
      });
      
      searchInput.addEventListener('blur', () => {
        // Delay hiding to allow clicks on dropdown items
        setTimeout(() => {
          this.hideAutocomplete();
        }, 200);
      });
      
      // Hide dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
          this.hideAutocomplete();
        }
      });
    }
  },
  
  // Handle search input with debouncing
  handleSearchInput(query) {
    clearTimeout(this.searchTimeout);
    clearTimeout(this.autocompleteTimeout);
    
    // Show autocomplete after minimum characters
    if (query.length >= window.MatchaMatch.Config.AUTOCOMPLETE_MIN_CHARS) {
      this.autocompleteTimeout = setTimeout(() => {
        this.showAutocomplete(query);
      }, 150);
    } else {
      this.hideAutocomplete();
    }
    
    // Debounced search
    this.searchTimeout = setTimeout(() => {
      if (query.length > 0) {
        this.performSearch(query);
      } else {
        this.loadDefaultProducts();
      }
    }, window.MatchaMatch.Config.SEARCH_DEBOUNCE_MS);
  },
  
  // Show autocomplete suggestions
  async showAutocomplete(query) {
    const dropdown = document.getElementById('autocompleteDropdown');
    if (!dropdown) return;
    
    try {
      const response = await window.MatchaMatch.API.getAutocomplete(query);
      
      if (response.success && response.data.length > 0) {
        dropdown.innerHTML = response.data.map(item => `
          <div class="autocomplete-item" data-text="${item.text}" data-type="${item.type}">
            <i class="fas fa-${this.getAutocompleteIcon(item.type)}"></i>
            <span>${item.highlight}</span>
            <small>${item.type}</small>
          </div>
        `).join('');
        
        dropdown.style.display = 'block';
        
        // Add click handlers
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('click', () => {
            const text = item.dataset.text;
            document.getElementById('globalSearch').value = text;
            this.performSearch(text);
            this.hideAutocomplete();
          });
        });
      } else {
        this.hideAutocomplete();
      }
    } catch (error) {
      console.error('Autocomplete error:', error);
      this.hideAutocomplete();
    }
  },
  
  // Hide autocomplete dropdown
  hideAutocomplete() {
    const dropdown = document.getElementById('autocompleteDropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  },
  
  // Get icon for autocomplete item type
  getAutocompleteIcon(type) {
    const icons = {
      product: 'box',
      brand: 'store',
      origin: 'map-marker-alt',
      flavor: 'leaf',
      grade: 'star',
      query: 'search'
    };
    return icons[type] || 'search';
  },
  
  // Handle quick filter selection
  handleQuickFilter(filter, button) {
    // Remove active class from all buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active class to clicked button
    button.classList.add('active');
    
    // Update filters based on selection
    this.clearAllFilters();
    
    switch (filter) {
      case 'all':
        break;
      case 'ceremonial':
        this.currentFilters.grades = ['ceremonial'];
        break;
      case 'premium':
        this.currentFilters.grades = ['premium'];
        break;
      case 'culinary':
        this.currentFilters.grades = ['culinary'];
        break;
      case 'organic':
        this.currentFilters.organic = true;
        break;
      case 'trending':
        this.loadTrendingProducts();
        return;
    }
    
    this.performSearch(this.currentQuery);
  },
  
  // Update filters from form inputs
  updateFilters() {
    const filters = {};
    
    // Price range
    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');
    if (minPrice && maxPrice) {
      filters.minPrice = minPrice.value;
      filters.maxPrice = maxPrice.value;
    }
    
    // Origin
    const originFilter = document.getElementById('originFilter');
    if (originFilter && originFilter.value) {
      filters.origins = [originFilter.value];
    }
    
    // Flavor profiles
    const activeFlavorTags = document.querySelectorAll('.flavor-tag.active');
    if (activeFlavorTags.length > 0) {
      filters.flavorProfiles = Array.from(activeFlavorTags).map(tag => tag.dataset.flavor);
    }
    
    // In stock only
    const inStockOnly = document.getElementById('inStockOnly');
    if (inStockOnly && inStockOnly.checked) {
      filters.inStockOnly = true;
    }
    
    // Sort
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      filters.sortBy = sortSelect.value;
    }
    
    this.currentFilters = filters;
    this.performSearch(this.currentQuery);
  },
  
  // Clear all filters
  clearAllFilters() {
    this.currentFilters = {};
    
    // Reset form inputs
    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');
    const originFilter = document.getElementById('originFilter');
    const flavorTags = document.querySelectorAll('.flavor-tag');
    const inStockOnly = document.getElementById('inStockOnly');
    const priceDisplay = document.getElementById('priceDisplay');
    
    if (minPrice) minPrice.value = 0;
    if (maxPrice) maxPrice.value = 200;
    if (originFilter) originFilter.value = '';
    if (inStockOnly) inStockOnly.checked = false;
    if (priceDisplay) priceDisplay.textContent = '$0 - $200';
    
    flavorTags.forEach(tag => tag.classList.remove('active'));
    
    // Reset to "All Matcha" filter
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');
    
    this.performSearch(this.currentQuery);
  },
  
  // Perform search with current query and filters
  async performSearch(query = '') {
    this.currentQuery = query;
    
    // Update section title
    const sectionTitle = document.getElementById('sectionTitle');
    const sectionSubtitle = document.getElementById('sectionSubtitle');
    
    if (sectionTitle) {
      if (query) {
        sectionTitle.textContent = `Search Results for "${query}"`;
        if (sectionSubtitle) {
          sectionSubtitle.textContent = 'Discover matcha that matches your search';
        }
      } else {
        sectionTitle.textContent = 'Premium Matcha Collection';
        if (sectionSubtitle) {
          sectionSubtitle.textContent = 'Discover exceptional matcha from verified Japanese producers';
        }
      }
    }
    
    // Show loading state
    window.MatchaMatch.Products.showLoading();
    
    try {
      const response = await window.MatchaMatch.API.search(query, this.currentFilters);
      
      if (response.success) {
        window.MatchaMatch.Products.displayProducts(response.data.results);
        this.updateSearchStats(response.data.total);
      } else {
        window.MatchaMatch.Products.showNoResults();
      }
    } catch (error) {
      console.error('Search error:', error);
      window.MatchaMatch.Utils.showToast(
        window.MatchaMatch.ErrorMessages.SEARCH_FAILED, 
        'error'
      );
      window.MatchaMatch.Products.showNoResults();
    }
  },
  
  // Load default products (no search query)
  async loadDefaultProducts() {
    this.currentQuery = '';
    
    // Reset section title
    const sectionTitle = document.getElementById('sectionTitle');
    const sectionSubtitle = document.getElementById('sectionSubtitle');
    
    if (sectionTitle) {
      sectionTitle.textContent = 'Premium Matcha Collection';
    }
    if (sectionSubtitle) {
      sectionSubtitle.textContent = 'Discover exceptional matcha from verified Japanese producers';
    }
    
    // Load products using the Products module
    if (window.MatchaMatch.Products) {
      window.MatchaMatch.Products.loadProducts();
    }
  },
  
  // Load trending products
  async loadTrendingProducts() {
    this.currentQuery = '';
    
    const sectionTitle = document.getElementById('sectionTitle');
    const sectionSubtitle = document.getElementById('sectionSubtitle');
    
    if (sectionTitle) {
      sectionTitle.textContent = 'Trending Matcha';
    }
    if (sectionSubtitle) {
      sectionSubtitle.textContent = 'Popular matcha products that others are loving';
    }
    
    window.MatchaMatch.Products.showLoading();
    
    try {
      const response = await window.MatchaMatch.API.getTrendingProducts();
      
      if (response.success) {
        window.MatchaMatch.Products.displayProducts(response.data);
        this.updateSearchStats(response.data.length);
      } else {
        window.MatchaMatch.Products.showNoResults();
      }
    } catch (error) {
      console.error('Trending products error:', error);
      window.MatchaMatch.Products.showNoResults();
    }
  },
  
  // Load search suggestions
  async loadSearchSuggestions() {
    try {
      const response = await window.MatchaMatch.API.getSearchSuggestions();
      
      if (response.success && response.data.length > 0) {
        // Could display these suggestions somewhere in the UI
        console.log('Search suggestions loaded:', response.data);
      }
    } catch (error) {
      console.error('Search suggestions error:', error);
    }
  },
  
  // Update search statistics
  updateSearchStats(total) {
    const statsBar = document.getElementById('statsBar');
    const totalProducts = document.getElementById('totalProducts');
    
    if (totalProducts) {
      totalProducts.textContent = total;
    }
    
    if (statsBar) {
      statsBar.style.display = total > 0 ? 'block' : 'none';
    }
  }
};
