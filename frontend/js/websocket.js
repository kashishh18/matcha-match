// Matcha Match - WebSocket Handler
// Manages real-time connections for live updates

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.WebSocket = {
  socket: null,
  isConnected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: window.MatchaMatch.Config.RECONNECT_ATTEMPTS || 5,
  reconnectDelay: window.MatchaMatch.Config.RECONNECT_DELAY || 3000,
  heartbeatInterval: null,
  currentProductId: null,
  
  // Initialize WebSocket connection
  init() {
    this.connect();
    this.setupEventHandlers();
  },
  
  // Connect to WebSocket server
  connect() {
    try {
      const wsUrl = window.MatchaMatch.Config.WEBSOCKET_URL;
      this.socket = io(wsUrl, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay
      });
      
      this.setupSocketEvents();
      console.log('WebSocket connecting to:', wsUrl);
      
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.handleConnectionError();
    }
  },
  
  // Setup Socket.IO event handlers
  setupSocketEvents() {
    if (!this.socket) return;
    
    // Connection established
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
      
      // Authenticate user if logged in
      this.authenticateUser();
      
      // Start heartbeat
      this.startHeartbeat();
    });
    
    // Connection lost
    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      this.isConnected = false;
      this.updateConnectionStatus(false);
      this.stopHeartbeat();
      
      // Attempt to reconnect
      if (reason === 'io server disconnect') {
        this.socket.connect();
      }
    });
    
    // Connection error
    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.handleConnectionError();
    });
    
    // Reconnection attempt
    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('WebSocket reconnection attempt:', attemptNumber);
      this.reconnectAttempts = attemptNumber;
    });
    
    // Reconnection successful
    this.socket.on('reconnect', (attemptNumber) => {
      console.log('WebSocket reconnected after', attemptNumber, 'attempts');
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
    });
    
    // Authentication response
    this.socket.on('authenticated', (data) => {
      console.log('WebSocket authenticated:', data);
    });
    
    this.socket.on('auth_error', (error) => {
      console.error('WebSocket auth error:', error);
    });
    
    // Real-time updates
    this.socket.on('stock_update', (data) => {
      this.handleStockUpdate(data);
    });
    
    this.socket.on('price_change', (data) => {
      this.handlePriceChange(data);
    });
    
    this.socket.on('viewer_count', (data) => {
      this.handleViewerCount(data);
    });
    
    this.socket.on('stock_alert', (data) => {
      this.handleStockAlert(data);
    });
    
    this.socket.on('system_heartbeat', (data) => {
      this.handleSystemHeartbeat(data);
    });
    
    // Pong response
    this.socket.on('pong', (data) => {
      console.log('WebSocket pong received:', data);
    });
  },
  
  // Setup page event handlers
  setupEventHandlers() {
    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.handlePageVisible();
      } else {
        this.handlePageHidden();
      }
    });
    
    // Handle page unload
    window.addEventListener('beforeunload', () => {
      this.disconnect();
    });
    
    // Handle product page changes
    this.watchProductPageChanges();
  },
  
  // Authenticate user with WebSocket
  authenticateUser() {
    if (!this.socket || !this.isConnected) return;
    
    const token = window.MatchaMatch.API.getAuthToken();
    if (token) {
      this.socket.emit('authenticate', token);
    }
  },
  
  // Start heartbeat to keep connection alive
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.isConnected) {
        this.socket.emit('ping');
      }
    }, window.MatchaMatch.Config.HEARTBEAT_INTERVAL);
  },
  
  // Stop heartbeat
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  },
  
  // Handle stock update
  handleStockUpdate(data) {
    console.log('Stock update received:', data);
    
    const productId = data.data.productId;
    const stockData = data.data;
    
    // Update product cards
    const productCards = document.querySelectorAll(`[data-product-id="${productId}"]`);
    productCards.forEach(card => {
      const stockStatus = card.querySelector('.stock-status');
      if (stockStatus) {
        stockStatus.className = `stock-status ${stockData.inStock ? 'in-stock' : 'out-of-stock'}`;
        stockStatus.querySelector('span').textContent = stockData.inStock ? 'In Stock' : 'Out of Stock';
      }
    });
    
    // Show notification for important stock changes
    if (stockData.inStock && stockData.wasOutOfStock) {
      this.showStockNotification(productId, 'Back in Stock!', 'success');
    }
  },
  
  // Handle price change
  handlePriceChange(data) {
    console.log('Price change received:', data);
    
    const productId = data.data.productId;
    const priceData = data.data;
    
    // Update product cards
    const productCards = document.querySelectorAll(`[data-product-id="${productId}"]`);
    productCards.forEach(card => {
      const priceElement = card.querySelector('.product-price');
      if (priceElement) {
        const isDecrease = priceData.price < priceData.previousPrice;
        priceElement.textContent = `$${priceData.price.toFixed(2)}`;
        
        // Add animation for price changes
        priceElement.classList.add(isDecrease ? 'price-decrease' : 'price-increase');
        setTimeout(() => {
          priceElement.classList.remove('price-decrease', 'price-increase');
        }, 2000);
      }
    });
    
    // Show notification for significant price drops
    if (priceData.price < priceData.previousPrice) {
      const discount = ((priceData.previousPrice - priceData.price) / priceData.previousPrice * 100).toFixed(0);
      this.showStockNotification(productId, `Price dropped ${discount}%!`, 'success');
    }
  },
  
  // Handle viewer count update
  handleViewerCount(data) {
    const productId = data.productId;
    const count = data.count;
    
    // Update viewer count displays
    const viewerCounts = document.querySelectorAll(`.viewers-count[data-product-id="${productId}"]`);
    viewerCounts.forEach(element => {
      const span = element.querySelector('span');
      if (span) {
        span.textContent = count === 1 ? '1 person viewing' : `${count} people viewing`;
      }
    });
  },
  
  // Handle stock alert
  handleStockAlert(data) {
    console.log('Stock alert received:', data);
    
    const productData = data.data;
    
    // Show prominent notification
    this.showStockAlert(productData);
  },
  
  // Handle system heartbeat
  handleSystemHeartbeat(data) {
    // Update live statistics
    const liveViewers = document.getElementById('liveViewers');
    const totalProducts = document.getElementById('totalProducts');
    const lastUpdate = document.getElementById('lastUpdate');
    
    if (liveViewers) {
      liveViewers.textContent = data.connectedUsers || 0;
    }
    
    if (lastUpdate) {
      lastUpdate.textContent = 'just now';
    }
    
    // Update connection indicator
    this.updateConnectionStatus(true);
  },
  
  // Watch for product page changes
  watchProductPageChanges() {
    // Observer for product modal opens
    const productModal = document.getElementById('productModal');
    if (productModal) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const isActive = productModal.classList.contains('active');
            if (isActive) {
              // Extract product ID from modal content
              const productId = this.extractProductIdFromModal();
              if (productId) {
                this.viewProduct(productId);
              }
            } else {
              this.leaveCurrentProduct();
            }
          }
        });
      });
      
      observer.observe(productModal, { attributes: true });
    }
  },
  
  // Extract product ID from modal
  extractProductIdFromModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
      const viewBtn = modal.querySelector('.recommendation-view');
      if (viewBtn) {
        return viewBtn.dataset.productId;
      }
    }
    return null;
  },
  
  // Notify server that user is viewing a product
  viewProduct(productId) {
    if (!this.socket || !this.isConnected) return;
    
    // Leave current product if any
    if (this.currentProductId) {
      this.leaveCurrentProduct();
    }
    
    this.currentProductId = productId;
    this.socket.emit('view_product', { productId });
    
    console.log('Viewing product:', productId);
  },
  
  // Notify server that user left current product
  leaveCurrentProduct() {
    if (!this.socket || !this.isConnected || !this.currentProductId) return;
    
    this.socket.emit('leave_product', { productId: this.currentProductId });
    console.log('Left product:', this.currentProductId);
    this.currentProductId = null;
  },
  
  // Subscribe to stock alerts for products
  subscribeToStockAlerts(productIds) {
    if (!this.socket || !this.isConnected) return;
    
    this.socket.emit('subscribe_stock_alerts', { productIds });
    console.log('Subscribed to stock alerts:', productIds);
  },
  
  // Join search analytics room
  joinSearchAnalytics(query) {
    if (!this.socket || !this.isConnected) return;
    
    this.socket.emit('join_search', { query });
  },
  
  // Handle page visible
  handlePageVisible() {
    if (!this.isConnected && this.socket) {
      this.socket.connect();
    }
  },
  
  // Handle page hidden
  handlePageHidden() {
    this.leaveCurrentProduct();
  },
  
  // Handle connection error
  handleConnectionError() {
    this.isConnected = false;
    this.updateConnectionStatus(false);
    
    // Show user-friendly error after multiple failed attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      window.MatchaMatch.Utils.showToast(
        'Real-time updates unavailable. Some features may be limited.',
        'warning'
      );
    }
  },
  
  // Update connection status indicator
  updateConnectionStatus(connected) {
    const statusIndicator = document.getElementById('connectionStatus');
    if (statusIndicator) {
      statusIndicator.className = connected ? 'connected' : 'disconnected';
      statusIndicator.title = connected ? 'Connected - Real-time updates active' : 'Disconnected - Limited functionality';
    }
  },
  
  // Show stock notification
  showStockNotification(productId, message, type = 'info') {
    if (window.MatchaMatch.Utils) {
      window.MatchaMatch.Utils.showToast(message, type);
    }
  },
  
  // Show stock alert
  showStockAlert(productData) {
    // Create a more prominent stock alert
    const alertHTML = `
      <div class="stock-alert">
        <div class="alert-icon">
          <i class="fas fa-bell"></i>
        </div>
        <div class="alert-content">
          <h4>Stock Alert!</h4>
          <p>${productData.name} is now available</p>
          <button class="alert-action" onclick="this.parentElement.parentElement.remove()">
            View Product
          </button>
        </div>
      </div>
    `;
    
    // Add to page or show as toast
    if (window.MatchaMatch.Utils) {
      window.MatchaMatch.Utils.showToast(
        `${productData.name} is back in stock!`,
        'success'
      );
    }
  },
  
  // Disconnect WebSocket
  disconnect() {
    if (this.socket) {
      this.leaveCurrentProduct();
      this.stopHeartbeat();
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
  },
  
  // Get connection status
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      currentProductId: this.currentProductId
    };
  }
};
