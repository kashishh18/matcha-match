// Matcha Match - Authentication Handler
// Manages user authentication, login/register forms, and user state

window.MatchaMatch = window.MatchaMatch || {};

window.MatchaMatch.Auth = {
  currentUser: null,
  isAuthenticated: false,
  
  // Initialize authentication
  init() {
    this.checkAuthState();
    this.setupAuthModal();
    this.setupAuthButtons();
  },
  
  // Check if user is authenticated
  checkAuthState() {
    const token = localStorage.getItem('auth_token');
    if (token) {
      this.loadUserProfile();
    }
  },
  
  // Load user profile
  async loadUserProfile() {
    try {
      const response = await window.MatchaMatch.API.getProfile();
      if (response.success) {
        this.currentUser = response.data;
        this.isAuthenticated = true;
        this.updateAuthUI();
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
      this.logout();
    }
  },
  
  // Setup authentication modal
  setupAuthModal() {
    const modal = document.getElementById('authModal');
    const closeBtn = document.getElementById('modalClose');
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hideAuthModal();
      });
    }
    
    // Close modal when clicking outside
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideAuthModal();
        }
      });
    }
  },
  
  // Setup authentication buttons
  setupAuthButtons() {
    const authBtn = document.getElementById('authBtn');
    
    if (authBtn) {
      authBtn.addEventListener('click', () => {
        if (this.isAuthenticated) {
          this.logout();
        } else {
          this.showAuthModal('login');
        }
      });
    }
  },
  
  // Show authentication modal
  showAuthModal(mode = 'login') {
    const modal = document.getElementById('authModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    if (!modal || !modalTitle || !modalBody) return;
    
    modalTitle.textContent = mode === 'login' ? 'Sign In to Matcha Match' : 'Create Your Account';
    modalBody.innerHTML = this.getAuthFormHTML(mode);
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Setup form handlers
    this.setupAuthForm(mode);
  },
  
  // Hide authentication modal
  hideAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  },
  
  // Get authentication form HTML
  getAuthFormHTML(mode) {
    if (mode === 'login') {
      return `
        <form id="loginForm" class="auth-form">
          <div class="form-group">
            <label for="loginEmail">Email Address</label>
            <input type="email" id="loginEmail" name="email" required class="form-input">
          </div>
          
          <div class="form-group">
            <label for="loginPassword">Password</label>
            <input type="password" id="loginPassword" name="password" required class="form-input">
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" name="rememberMe">
              <span class="checkmark"></span>
              Remember me
            </label>
          </div>
          
          <button type="submit" class="btn-primary full-width">
            <span class="btn-text">Sign In</span>
            <div class="btn-loader" style="display: none;">
              <div class="spinner"></div>
            </div>
          </button>
          
          <div class="form-links">
            <a href="#" id="showRegisterForm">Don't have an account? Sign up</a>
            <a href="#" id="showForgotPassword">Forgot password?</a>
          </div>
        </form>
      `;
    } else {
      return `
        <form id="registerForm" class="auth-form">
          <div class="form-row">
            <div class="form-group">
              <label for="registerFirstName">First Name</label>
              <input type="text" id="registerFirstName" name="firstName" required class="form-input">
            </div>
            
            <div class="form-group">
              <label for="registerLastName">Last Name</label>
              <input type="text" id="registerLastName" name="lastName" required class="form-input">
            </div>
          </div>
          
          <div class="form-group">
            <label for="registerEmail">Email Address</label>
            <input type="email" id="registerEmail" name="email" required class="form-input">
          </div>
          
          <div class="form-group">
            <label for="registerPassword">Password</label>
            <input type="password" id="registerPassword" name="password" required class="form-input">
            <div class="password-requirements">
              <small>Password must contain at least 8 characters with uppercase, lowercase, number and special character</small>
            </div>
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" name="agreeTerms" required>
              <span class="checkmark"></span>
              I agree to the <a href="#" target="_blank">Terms of Service</a> and <a href="#" target="_blank">Privacy Policy</a>
            </label>
          </div>
          
          <button type="submit" class="btn-primary full-width">
            <span class="btn-text">Create Account</span>
            <div class="btn-loader" style="display: none;">
              <div class="spinner"></div>
            </div>
          </button>
          
          <div class="form-links">
            <a href="#" id="showLoginForm">Already have an account? Sign in</a>
          </div>
        </form>
      `;
    }
  },
  
  // Setup authentication form handlers
  setupAuthForm(mode) {
    const form = document.getElementById(mode === 'login' ? 'loginForm' : 'registerForm');
    
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (mode === 'login') {
          this.handleLogin(form);
        } else {
          this.handleRegister(form);
        }
      });
    }
    
    // Setup form switching
    const showRegisterForm = document.getElementById('showRegisterForm');
    const showLoginForm = document.getElementById('showLoginForm');
    
    if (showRegisterForm) {
      showRegisterForm.addEventListener('click', (e) => {
        e.preventDefault();
        this.showAuthModal('register');
      });
    }
    
    if (showLoginForm) {
      showLoginForm.addEventListener('click', (e) => {
        e.preventDefault();
        this.showAuthModal('login');
      });
    }
  },
  
  // Handle login
  async handleLogin(form) {
    const formData = new FormData(form);
    const credentials = {
      email: formData.get('email'),
      password: formData.get('password'),
      rememberMe: formData.get('rememberMe') === 'on'
    };
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');
    
    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'block';
    
    try {
      const response = await window.MatchaMatch.API.login(credentials);
      
      if (response.success) {
        this.currentUser = response.data.user;
        this.isAuthenticated = true;
        this.updateAuthUI();
        this.hideAuthModal();
        
        window.MatchaMatch.Utils.showToast(
          window.MatchaMatch.SuccessMessages.LOGIN_SUCCESS, 
          'success'
        );
        
        // Reload recommendations if on homepage
        if (window.MatchaMatch.Recommendations) {
          window.MatchaMatch.Recommendations.loadRecommendations();
        }
      }
    } catch (error) {
      window.MatchaMatch.Utils.showToast(
        error.message || window.MatchaMatch.ErrorMessages.INVALID_CREDENTIALS, 
        'error'
      );
    } finally {
      // Reset loading state
      submitBtn.disabled = false;
      btnText.style.display = 'block';
      btnLoader.style.display = 'none';
    }
  },
  
  // Handle registration
  async handleRegister(form) {
    const formData = new FormData(form);
    const userData = {
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      email: formData.get('email'),
      password: formData.get('password')
    };
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');
    
    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'block';
    
    try {
      const response = await window.MatchaMatch.API.register(userData);
      
      if (response.success) {
        this.hideAuthModal();
        
        window.MatchaMatch.Utils.showToast(
          window.MatchaMatch.SuccessMessages.REGISTRATION_SUCCESS, 
          'success'
        );
      }
    } catch (error) {
      window.MatchaMatch.Utils.showToast(
        error.message || window.MatchaMatch.ErrorMessages.GENERIC_ERROR, 
        'error'
      );
    } finally {
      // Reset loading state
      submitBtn.disabled = false;
      btnText.style.display = 'block';
      btnLoader.style.display = 'none';
    }
  },
  
  // Logout user
  async logout() {
    try {
      await window.MatchaMatch.API.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    this.currentUser = null;
    this.isAuthenticated = false;
    this.updateAuthUI();
    
    window.MatchaMatch.Utils.showToast(
      window.MatchaMatch.SuccessMessages.LOGOUT_SUCCESS, 
      'success'
    );
    
    // Clear recommendations
    const recommendationsSection = document.getElementById('recommendationsSection');
    if (recommendationsSection) {
      recommendationsSection.style.display = 'none';
    }
  },
  
  // Update authentication UI
  updateAuthUI() {
    const authBtn = document.getElementById('authBtn');
    const authBtnText = authBtn?.querySelector('span');
    const authBtnIcon = authBtn?.querySelector('i');
    
    if (authBtn && authBtnText && authBtnIcon) {
      if (this.isAuthenticated) {
        authBtnText.textContent = this.currentUser?.firstName || 'Profile';
        authBtnIcon.className = 'fas fa-user-circle';
        authBtn.classList.add('authenticated');
      } else {
        authBtnText.textContent = 'Sign In';
        authBtnIcon.className = 'fas fa-user';
        authBtn.classList.remove('authenticated');
      }
    }
  }
};
