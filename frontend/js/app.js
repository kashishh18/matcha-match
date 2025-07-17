// Matcha Match - Main Application
// Initializes all components and handles global app functionality

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.App = {
  isInitialized: false,
  
  // Initialize the entire application
  init() {
    if (this.isInitialized) return;
    
    console.log('🍵 Initializing Matcha Match...');
    
    // Initialize core components
    this.initializeComponents();
    
    // Setup global event handlers
    this.setupGlobalHandlers();
    
    // Setup utilities
    this.setupUtilities();
    
    // Initialize navigation
    this.initializeNavigation();
    
    // Initialize hero section
    this.initializeHero();
    
    // Check system health
    this.checkSystemHealth();
    
    this.isInitialized = true;
    console.log('✅ Matcha Match initialized successfully');
  },
  
  // Initialize all components
  initializeComponents() {
    // Initialize authentication first
    if (window.MatchaMatch.Auth) {
      window.MatchaMatch.Auth.init();
    }
    
    // Initialize search functionality
    if (window.MatchaMatch.Search) {
      window.MatchaMatch.Search.init();
    }
    
    // Initialize products
    if (window.MatchaMatch.Products) {
      window.MatchaMatch.Products.init();
    }
    
    // Initialize recommendations
    if (window.MatchaMatch.Recommendations) {
      window.MatchaMatch.Recommendations.init();
    }
    
    // Initialize WebSocket for real-time features
    if (window.MatchaMatch.WebSocket) {
      window.MatchaMatch.WebSocket.init();
    }
  },
  
  // Setup global event handlers
  setupGlobalHandlers() {
    // Handle smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
    
    // Handle scroll effects
    this.setupScrollEffects();
    
    // Handle keyboard shortcuts
    this.setupKeyboardShortcuts();
    
    // Handle mobile menu
    this.setupMobileMenu();
    
    // Handle theme switching (if implemented)
    this.setupThemeToggle();
  },
  
  // Setup utilities
  setupUtilities() {
    // Toast notification system
    window.MatchaMatch.Utils = {
      showToast(message, type = 'info', duration = 5000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        const toastIcon = toast.querySelector('.toast-icon');
        const toastMessage = toast.querySelector('.toast-message');
        
        // Set icon based on type
        const icons = {
          success: 'fas fa-check-circle',
          error: 'fas fa-exclamation-circle',
          warning: 'fas fa-exclamation-triangle',
          info: 'fas fa-info-circle'
        };
        
        toastIcon.className = `toast-icon ${icons[type] || icons.info}`;
        toastMessage.textContent = message;
        
        // Set toast type class
        toast.className = `toast ${type}`;
        
        // Show toast
        toast.classList.add('show');
        
        // Auto hide
        setTimeout(() => {
          toast.classList.remove('show');
        }, duration);
        
        // Setup close button
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
          closeBtn.onclick = () => toast.classList.remove('show');
        }
      },
      
      // Format currency
      formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD'
        }).format(amount);
      },
      
      // Format date
      formatDate(date) {
        return new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }).format(new Date(date));
      },
      
      // Debounce function
      debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      },
      
      // Throttle function
      throttle(func, limit) {
        let inThrottle;
        return function() {
          const args = arguments;
          const context = this;
          if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
          }
        };
      },
      
      // Check if element is in viewport
      isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
      },
      
      // Animate element on scroll
      animateOnScroll(element, animationClass = 'animate-in') {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add(animationClass);
              observer.unobserve(entry.target);
            }
          });
        });
        
        observer.observe(element);
      }
    };
  },
  
  // Initialize navigation
  initializeNavigation() {
    const navbar = document.getElementById('navbar');
    
    if (navbar) {
      // Add scroll effect to navbar
      window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
          navbar.classList.add('scrolled');
        } else {
          navbar.classList.remove('scrolled');
        }
      });
    }
  },
  
  // Initialize hero section
  initializeHero() {
    const exploreBtn = document.getElementById('exploreBtn');
    const watchVideoBtn = document.getElementById('watchVideoBtn');
    
    if (exploreBtn) {
      exploreBtn.addEventListener('click', () => {
        const productsSection = document.querySelector('.products-section');
        if (productsSection) {
          productsSection.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
    
    if (watchVideoBtn) {
      watchVideoBtn.addEventListener('click', () => {
        // Could open a video modal here
        window.MatchaMatch.Utils.showToast('Video feature coming soon!', 'info');
      });
    }
  },
  
  // Setup scroll effects
  setupScrollEffects() {
    // Parallax effect for hero section
    const hero = document.querySelector('.hero');
    if (hero) {
      window.addEventListener('scroll', window.MatchaMatch.Utils.throttle(() => {
        const scrolled = window.pageYOffset;
        const parallax = scrolled * 0.5;
        hero.style.transform = `translateY(${parallax}px)`;
      }, 16));
    }
    
    // Animate elements on scroll
    const animateElements = document.querySelectorAll('.feature-card, .product-card-item');
    animateElements.forEach(element => {
      window.MatchaMatch.Utils.animateOnScroll(element, 'fade-in-up');
    });
  },
  
  // Setup keyboard shortcuts
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Search shortcut (Ctrl/Cmd + K)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('globalSearch');
        if (searchInput) {
          searchInput.focus();
        }
      }
      
      // Escape key to close modals
      if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.active');
        if (activeModal) {
          activeModal.classList.remove('active');
          document.body.style.overflow = '';
        }
      }
    });
  },
  
  // Setup mobile menu
  setupMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navActions = document.querySelector('.nav-actions');
    
    if (mobileMenuBtn && navActions) {
      mobileMenuBtn.addEventListener('click', () => {
        navActions.classList.toggle('mobile-active');
        
        // Toggle icon
        const icon = mobileMenuBtn.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-bars');
          icon.classList.toggle('fa-times');
        }
      });
      
      // Close mobile menu when clicking outside
      document.addEventListener('click', (e) => {
        if (!navActions.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
          navActions.classList.remove('mobile-active');
          const icon = mobileMenuBtn.querySelector('i');
          if (icon) {
            icon.classList.add('fa-bars');
            icon.classList.remove('fa-times');
          }
        }
      });
    }
  },
  
  // Setup theme toggle
  setupThemeToggle() {
    // Check for saved theme or default to light
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Create theme toggle button (if not exists)
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        // Update icon
        const icon = themeToggle.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-moon');
          icon.classList.toggle('fa-sun');
        }
      });
    }
  },
  
  // Check system health
  async checkSystemHealth() {
    try {
      const response = await window.MatchaMatch.API.getHealth();
      
      if (response.success) {
        console.log('✅ System health check passed');
        this.updateSystemStatus('healthy');
      } else {
        console.warn('⚠️ System health check failed');
        this.updateSystemStatus('degraded');
      }
    } catch (error) {
      console.error('❌ System health check error:', error);
      this.updateSystemStatus('error');
    }
  },
  
  // Update system status
  updateSystemStatus(status) {
    const statusIndicator = document.getElementById('systemStatus');
    if (statusIndicator) {
      statusIndicator.className = `system-status ${status}`;
      statusIndicator.title = `System status: ${status}`;
    }
  },
  
  // Handle app errors
  handleError(error, context = 'general') {
    console.error(`Error in ${context}:`, error);
    
    // Show user-friendly error message
    let message = window.MatchaMatch.ErrorMessages.GENERIC_ERROR;
    
    if (error.message) {
      // Check for specific error types
      if (error.message.includes('network') || error.message.includes('fetch')) {
        message = window.MatchaMatch.ErrorMessages.NETWORK_ERROR;
      } else if (error.message.includes('auth')) {
        message = window.MatchaMatch.ErrorMessages.AUTHENTICATION_REQUIRED;
      }
    }
    
    window.MatchaMatch.Utils.showToast(message, 'error');
  },
  
  // Refresh app data
  async refreshApp() {
    try {
      // Refresh products
      if (window.MatchaMatch.Products) {
        await window.MatchaMatch.Products.loadProducts();
      }
      
      // Refresh recommendations
      if (window.MatchaMatch.Recommendations && window.MatchaMatch.Auth.isAuthenticated) {
        await window.MatchaMatch.Recommendations.loadRecommendations();
      }
      
      window.MatchaMatch.Utils.showToast('App refreshed successfully!', 'success');
    } catch (error) {
      this.handleError(error, 'refresh');
    }
  },
  
  // Get app info
  getAppInfo() {
    return {
      name: window.MatchaMatch.Config.APP_NAME,
      version: window.MatchaMatch.Config.VERSION,
      initialized: this.isInitialized,
      components: {
        auth: !!window.MatchaMatch.Auth,
        search: !!window.MatchaMatch.Search,
        products: !!window.MatchaMatch.Products,
        recommendations: !!window.MatchaMatch.Recommendations,
        websocket: !!window.MatchaMatch.WebSocket
      }
    };
  }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.MatchaMatch.App.init();
});

// Handle service worker registration (for PWA features)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker registered:', registration);
      })
      .catch(error => {
        console.log('Service Worker registration failed:', error);
      });
  });
}

// Global error handler
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
  if (window.MatchaMatch.App) {
    window.MatchaMatch.App.handleError(e.error, 'global');
  }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  if (window.MatchaMatch.App) {
    window.MatchaMatch.App.handleError(e.reason, 'promise');
  }
});

// Expose app to global scope for debugging
window.MatchaApp = window.MatchaMatch.App;
