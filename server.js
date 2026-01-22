const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const redis = require('redis');
const rateLimit = require('express-rate-limit');
const flash = require('connect-flash');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const passport = require('passport');
const Database = require('./database');
const GCPBucketUploader = require('./gcpBucket');
const GoogleDriveUploader = require('./googleDrive');
const StripeService = require('./stripe');
const RegionalPricing = require('./regionalPricing');
const OAuthConfig = require('./oauth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const gcpUploader = new GCPBucketUploader();

// Initialize database based on environment
let db;
if (process.env.DB_TYPE === 'firestore') {
  const GoogleCloudDatabase = require('./googleCloudDatabase.js');
  db = new GoogleCloudDatabase();
} else {
  const Database = require('./database.js');
  db = new Database();
  db.initialize();
}

const driveUploader = new GoogleDriveUploader(db);
const stripeService = new StripeService();
const regionalPricing = new RegionalPricing();
const oauthConfig = new OAuthConfig(db);

// CORS configuration for frontend-backend separation
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Stripe webhook endpoint (must be before express.json() middleware)
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await stripeService.handleWebhook(event);
    res.json({received: true});
  } catch (error) {
    console.error('Webhook handler failed:', error);
    res.status(500).json({error: 'Webhook handler failed'});
  }
});

// Redis client setup for session storage
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0
});

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis for session storage');
});

// Enhanced session configuration with Redis store
const sessionConfig = {
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on each request
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, // Prevent XSS attacks
    maxAge: parseInt(process.env.SESSION_TIMEOUT) || 7 * 24 * 60 * 60 * 1000, // 7 days default
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  },
  name: 'guestphoto.session' // Custom session name
};

// Fallback to memory store if Redis is not available
redisClient.connect().catch(() => {
  console.log('Redis not available, using memory store for sessions');
  delete sessionConfig.store;
});

app.use(session(sessionConfig));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(flash());

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware
app.use(express.json());

// Create necessary directories
const uploadsDir = path.join(__dirname, 'uploads');
const tokensFile = path.join(__dirname, 'tokens.json');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(tokensFile)) {
  fs.writeFileSync(tokensFile, JSON.stringify({}));
}

// Session cache for quick user lookup
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Enhanced authentication middleware
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
}

// Auto-login middleware to check for valid session
async function autoLogin(req, res, next) {
  if (req.session.userId && !req.user) {
    try {
      // Check cache first
      const cacheKey = `user:${req.session.userId}`;
      const cachedUser = userCache.get(cacheKey);
      
      if (cachedUser && cachedUser.timestamp > Date.now() - CACHE_TTL) {
        req.user = cachedUser.data;
        req.session.lastAccess = new Date();
        await new Promise((resolve, reject) => {
          req.session.save((err) => err ? reject(err) : resolve());
        });
        return next();
      }
      
      // Fetch from database if not in cache
      const user = await db.getUserById(req.session.userId);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name || user.email.split('@')[0],
          subscription_status: user.subscription_status || 'trial',
          subscription_end_date: user.subscription_end_date,
          oauth_provider: user.provider || 'local',
          profile_picture: user.avatar_url
        };
        
        // Cache the user data
        userCache.set(cacheKey, {
          data: req.user,
          timestamp: Date.now()
        });
        
        req.session.lastAccess = new Date();
        await new Promise((resolve, reject) => {
          req.session.save((err) => err ? reject(err) : resolve());
        });
      } else {
        // Invalid session, destroy it
        req.session.destroy();
        userCache.delete(cacheKey);
      }
    } catch (error) {
      console.error('Auto-login error:', error);
    }
  }
  next();
}

// Clear user from cache when needed
function clearUserCache(userId) {
  userCache.delete(`user:${userId}`);
}

// Apply auto-login middleware to all routes
app.use(autoLogin);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication endpoints
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.validateUser(email, password);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.lastAccess = new Date();
    req.session.loginTime = new Date();
    
    // Extend session for "Remember Me"
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }
    
    const userData = {
      id: user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      subscription_status: user.subscription_status || 'trial',
      subscription_end_date: user.subscription_end_date,
      oauth_provider: user.provider || 'local',
      profile_picture: user.avatar_url
    };
    
    // Cache user data
    userCache.set(`user:${user.id}`, {
      data: userData,
      timestamp: Date.now()
    });
    
    req.user = userData;
    
    res.json({ 
      success: true, 
      user: userData,
      sessionId: req.sessionID
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const existingUser = await db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const userId = await db.createUser(email, password);
    const user = await db.getUserById(userId);
    
    // Set session
    req.session.userId = userId;
    req.session.lastAccess = new Date();
    req.session.loginTime = new Date();
    
    const userData = {
      id: user.id,
      email: user.email,
      name: name,
      subscription_status: user.subscription_status || 'trial',
      subscription_end_date: user.subscription_end_date,
      oauth_provider: user.provider || 'local',
      profile_picture: user.avatar_url
    };
    
    // Cache user data
    userCache.set(`user:${userId}`, {
      data: userData,
      timestamp: Date.now()
    });
    
    req.user = userData;
    
    res.json({ 
      success: true, 
      user: userData,
      sessionId: req.sessionID
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', (req, res) => {
  const userId = req.session.userId;
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    
    // Clear user from cache
    if (userId) {
      clearUserCache(userId);
    }
    
    // Clear cookie
    res.clearCookie('guestphoto.session');
    res.json({ success: true });
  });
});

app.get('/api/user', requireAuth, async (req, res) => {
  try {
    // Return cached user data from auto-login middleware
    if (req.user) {
      return res.json(req.user);
    }
    
    // Fallback to database query
    const user = await db.getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      subscription_status: user.subscription_status || 'trial',
      subscription_end_date: user.subscription_end_date,
      oauth_provider: user.provider || 'local',
      profile_picture: user.avatar_url
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Session management endpoints
app.get('/api/auth/check', (req, res) => {
  if (req.session.userId && req.user) {
    res.json({
      authenticated: true,
      user: req.user,
      sessionInfo: {
        sessionId: req.sessionID,
        loginTime: req.session.loginTime,
        lastAccess: req.session.lastAccess,
        expiresIn: req.session.cookie.maxAge
      }
    });
  } else {
    res.json({ 
      authenticated: false 
    });
  }
});

app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    // Refresh session expiry
    req.session.lastAccess = new Date();
    
    // Update cache
    const cacheKey = `user:${req.session.userId}`;
    const cachedUser = userCache.get(cacheKey);
    if (cachedUser) {
      userCache.set(cacheKey, {
        data: cachedUser.data,
        timestamp: Date.now()
      });
    }
    
    res.json({ 
      success: true,
      expiresIn: req.session.cookie.maxAge,
      lastAccess: req.session.lastAccess
    });
  } catch (error) {
    console.error('Session refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

app.get('/api/auth/sessions', requireAuth, async (req, res) => {
  try {
    // This would require storing session metadata in database
    // For now, return current session info
    res.json({
      currentSession: {
        sessionId: req.sessionID,
        loginTime: req.session.loginTime,
        lastAccess: req.session.lastAccess,
        userAgent: req.headers['user-agent']
      }
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// OAuth endpoints
app.get('/api/oauth/status', (req, res) => {
  const status = oauthConfig.getOAuthStatus();
  res.json(status);
});

// OAuth authentication routes
app.get('/auth/google', passport.authenticate('google'));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: process.env.FRONTEND_URL + '/login?error=oauth_failed' }),
  (req, res) => {
    req.session.userId = req.user.id;
    res.redirect(process.env.FRONTEND_URL + '/dashboard');
  }
);

// Token management endpoints
app.get('/api/tokens', requireAuth, async (req, res) => {
  try {
    const tokens = await db.getUserTokens(req.session.userId);
    res.json(tokens);
  } catch (error) {
    console.error('Get tokens error:', error);
    res.status(500).json({ error: 'Failed to get tokens' });
  }
});

app.post('/api/tokens', requireAuth, async (req, res) => {
  try {
    const { name, maxUploads, expiresIn } = req.body;
    
    if (!name || !maxUploads) {
      return res.status(400).json({ error: 'Name and maxUploads are required' });
    }

    const user = await db.getUserById(req.session.userId);
    
    if (!user.subscription_status || user.subscription_status === 'inactive') {
      return res.status(403).json({ error: 'Active subscription required to create tokens' });
    }

    const token = uuidv4();
    const expirationDate = expiresIn ? 
      new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : 
      null;

    await db.createToken(req.session.userId, token, expirationDate, name);
    
    const url = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/upload/${token}`;
    const qrCode = await QRCode.toDataURL(url);

    res.json({
      success: true,
      token,
      url,
      qrCode,
      name,
      maxUploads,
      expirationDate
    });
  } catch (error) {
    console.error('Create token error:', error);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

app.get('/api/tokens/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await db.getTokenByValue(token);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }

    if (tokenData.expires_at && new Date() > new Date(tokenData.expires_at)) {
      return res.status(410).json({ error: 'Token expired' });
    }

    const uploads = await db.getUploadsByToken(token);
    
    res.json({
      token: tokenData.token,
      name: tokenData.name,
      maxUploads: tokenData.max_uploads,
      currentUploads: uploads.length,
      expiresAt: tokenData.expires_at,
      isExpired: tokenData.expires_at && new Date() > new Date(tokenData.expires_at),
      canUpload: uploads.length < tokenData.max_uploads
    });
  } catch (error) {
    console.error('Get token info error:', error);
    res.status(500).json({ error: 'Failed to get token info' });
  }
});

app.delete('/api/tokens/:tokenId', requireAuth, async (req, res) => {
  try {
    const { tokenId } = req.params;
    
    // Verify token belongs to user
    const token = await db.getTokenById(tokenId);
    if (!token || token.user_id !== req.session.userId) {
      return res.status(404).json({ error: 'Token not found' });
    }

    await db.deleteToken(tokenId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete token error:', error);
    res.status(500).json({ error: 'Failed to delete token' });
  }
});

// Upload endpoints
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.post('/api/upload/:token', upload.array('photos', 50), async (req, res) => {
  try {
    const { token } = req.params;
    const { guestName, guestMessage } = req.body;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const tokenData = await db.getTokenByValue(token);
    if (!tokenData) {
      return res.status(404).json({ error: 'Invalid upload token' });
    }

    if (tokenData.expires_at && new Date() > new Date(tokenData.expires_at)) {
      return res.status(410).json({ error: 'Upload token has expired' });
    }

    const existingUploads = await db.getUploadsByToken(token);
    const newUploadCount = req.files.length;
    const totalUploads = existingUploads.length + newUploadCount;

    if (totalUploads > tokenData.max_uploads) {
      return res.status(413).json({ 
        error: `Upload limit exceeded. Maximum ${tokenData.max_uploads} files allowed.` 
      });
    }

    const uploadResults = [];
    
    for (const file of req.files) {
      const uploadId = await db.createUpload(
        tokenData.user_id,
        token,
        file.filename,
        file.originalname,
        file.path,
        guestName || 'Anonymous',
        guestMessage || ''
      );
      
      uploadResults.push({
        id: uploadId,
        filename: file.originalname,
        status: 'pending'
      });
    }

    res.json({
      success: true,
      message: `${req.files.length} file(s) uploaded successfully`,
      uploads: uploadResults,
      remainingUploads: tokenData.max_uploads - totalUploads
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.error('Failed to delete file:', unlinkError);
        }
      });
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/api/uploads', requireAuth, async (req, res) => {
  try {
    const uploads = await db.getUserUploads(req.session.userId);
    res.json(uploads);
  } catch (error) {
    console.error('Get uploads error:', error);
    res.status(500).json({ error: 'Failed to get uploads' });
  }
});

app.get('/api/uploads/:token', async (req, res) => {
  try {
    const { token } = req.params;
    // Get token data first to get user ID
    const tokenData = await db.getTokenByValue(token);
    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }
    const uploads = await db.getUserUploads(tokenData.user_id);
    res.json(uploads.filter(u => u.token === token));
  } catch (error) {
    console.error('Get uploads by token error:', error);
    res.status(500).json({ error: 'Failed to get uploads' });
  }
});

// Subscription endpoints
app.get('/api/subscription', requireAuth, async (req, res) => {
  try {
    const subscription = await db.getSubscriptionByUserId(req.session.userId);
    res.json(subscription || { status: 'none' });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

app.get('/api/pricing/:countryCode', async (req, res) => {
  try {
    const { countryCode } = req.params;
    const pricing = await regionalPricing.getPricingForCountry(countryCode);
    res.json(pricing);
  } catch (error) {
    console.error('Get pricing error:', error);
    res.status(500).json({ error: 'Failed to get pricing' });
  }
});

app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({ error: 'Stripe not configured' });
    }

    const { priceId, countryCode } = req.body;
    const user = await db.getUserById(req.session.userId);
    
    const session = await stripeService.createCheckoutSession(
      user.email,
      priceId,
      req.session.userId,
      countryCode,
      process.env.FRONTEND_URL || 'http://localhost:3001'
    );

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/create-portal-session', requireAuth, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({ error: 'Stripe not configured' });
    }

    const subscription = await db.getSubscriptionByUserId(req.session.userId);
    if (!subscription || !subscription.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const session = await stripeService.createPortalSession(
      subscription.stripe_customer_id,
      process.env.FRONTEND_URL || 'http://localhost:3001'
    );

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create portal session error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Google Drive endpoints
app.get('/api/drive/status', requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.session.userId);
    const tokens = await db.getGoogleDriveTokens(req.session.userId);
    
    res.json({ 
      connected: !!tokens,
      hasCredentials: !!user.google_credentials,
      hasToken: !!tokens,
      type: 'oauth'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check drive status' });
  }
});

// Stats endpoints
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const stats = await db.getUserStats(req.session.userId);
    res.json({
      totalTokens: stats.total_tokens || 0,
      totalUploads: stats.total_uploads || 0,
      activeTokens: stats.active_tokens || 0,
      subscriptionStatus: 'trial'
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Initialize database and start server
async function startServer() {
  try {
    // Database initializes in constructor, no need to call initialize()
    console.log('Database initialized');

    app.listen(PORT, () => {
      console.log(`Backend API server running on port ${PORT}`);
      console.log(`Frontend should connect from: ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Session cleanup utilities
function cleanupExpiredSessions() {
  // Clear expired cache entries
  for (const [key, value] of userCache.entries()) {
    if (value.timestamp < Date.now() - CACHE_TTL) {
      userCache.delete(key);
    }
  }
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Close Redis connection
  try {
    await redisClient.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis connection:', error);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  // Close Redis connection
  try {
    await redisClient.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis connection:', error);
  }
  
  process.exit(0);
});

// Clean up expired sessions every 10 minutes
setInterval(cleanupExpiredSessions, 10 * 60 * 1000);

startServer();