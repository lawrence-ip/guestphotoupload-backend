const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// QR Code Generation Utilities
async function generateDynamicQR(tokenInfo, options = {}) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
  const url = `${baseUrl}/upload/${tokenInfo.token}`;
  
  const qrOptions = {
    errorCorrectionLevel: options.errorLevel || 'M',
    type: 'image/png',
    quality: options.quality || 0.92,
    margin: options.margin || 1,
    color: {
      dark: options.darkColor || '#000000',
      light: options.lightColor || '#FFFFFF'
    },
    width: options.width || 256
  };
  
  const qrCode = await QRCode.toDataURL(url, qrOptions);
  
  // Store QR generation metadata
  await db.updateTokenMetadata(tokenInfo.id, {
    qr_generated_at: new Date().toISOString(),
    qr_options: JSON.stringify(qrOptions),
    access_count: 0
  });
  
  return {
    url,
    qrCode,
    options: qrOptions
  };
}

function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }
  
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  
  const [tokenString, signature] = parts;
  if (tokenString.length !== 64 || signature.length !== 16) {
    return false;
  }
  
  return true;
}

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
    const { name, maxUploads, expiresIn, qrOptions } = req.body;
    
    if (!name || !maxUploads) {
      return res.status(400).json({ error: 'Name and maxUploads are required' });
    }

    const user = await db.getUserById(req.session.userId);
    
    if (!user.subscription_status || user.subscription_status === 'inactive') {
      return res.status(403).json({ error: 'Active subscription required to create tokens' });
    }

    // Generate secure token with crypto
    const tokenData = {
      id: uuidv4(),
      userId: req.session.userId,
      timestamp: Date.now(),
      name: name
    };
    
    const tokenString = crypto.randomBytes(32).toString('hex');
    const signedToken = crypto
      .createHmac('sha256', process.env.TOKEN_SECRET || process.env.SESSION_SECRET)
      .update(JSON.stringify(tokenData))
      .digest('hex');
    
    const secureToken = `${tokenString}.${signedToken.substring(0, 16)}`;
    
    const expirationDate = expiresIn ? 
      new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : 
      null;

    await db.createToken(req.session.userId, secureToken, expirationDate, name);
    
    const tokenInfo = await db.getTokenByValue(secureToken);
    const qrCodeData = await generateDynamicQR(tokenInfo, qrOptions);

    res.json({
      success: true,
      token: secureToken,
      tokenId: tokenInfo.id,
      url: qrCodeData.url,
      qrCode: qrCodeData.qrCode,
      name,
      maxUploads,
      expirationDate,
      qrOptions: qrCodeData.options
    });
  } catch (error) {
    console.error('Create token error:', error);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

// Enhanced QR Code Management Endpoints
app.post('/api/tokens/:tokenId/regenerate-qr', requireAuth, async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { qrOptions } = req.body;
    
    const tokenData = await db.getTokenById(tokenId);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    if (tokenData.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized access to token' });
    }
    
    if (tokenData.expires_at && new Date() > new Date(tokenData.expires_at)) {
      return res.status(410).json({ error: 'Token expired' });
    }
    
    const qrCodeData = await generateDynamicQR(tokenData, qrOptions);
    
    res.json({
      success: true,
      qrCode: qrCodeData.qrCode,
      url: qrCodeData.url,
      options: qrCodeData.options,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Regenerate QR error:', error);
    res.status(500).json({ error: 'Failed to regenerate QR code' });
  }
});

app.get('/api/tokens/:tokenId/qr', async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { format = 'png', download = false } = req.query;
    
    const tokenData = await db.getTokenById(tokenId);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    if (tokenData.expires_at && new Date() > new Date(tokenData.expires_at)) {
      return res.status(410).json({ error: 'Token expired' });
    }
    
    // Increment access count
    await db.incrementTokenAccess(tokenData.id);
    
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const url = `${baseUrl}/upload/${tokenData.token}`;
    
    if (format === 'svg') {
      const qrSvg = await QRCode.toString(url, { type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      if (download) {
        res.setHeader('Content-Disposition', `attachment; filename="qr-${tokenData.event_name.replace(/\\s+/g, '-').toLowerCase()}.svg"`);
      }
      res.send(qrSvg);
    } else {
      const qrPng = await QRCode.toBuffer(url, {
        type: 'png',
        width: parseInt(req.query.width) || 256,
        margin: parseInt(req.query.margin) || 1
      });
      res.setHeader('Content-Type', 'image/png');
      if (download) {
        res.setHeader('Content-Disposition', `attachment; filename="qr-${tokenData.event_name.replace(/\\s+/g, '-').toLowerCase()}.png"`);
      }
      res.send(qrPng);
    }
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

app.post('/api/tokens/:tokenId/refresh', requireAuth, async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { expiresIn } = req.body;
    
    const tokenData = await db.getTokenById(tokenId);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    if (tokenData.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized access to token' });
    }
    
    const newExpirationDate = expiresIn ?
      new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) :
      null;
    
    await db.updateTokenExpiration(tokenId, newExpirationDate);
    
    res.json({
      success: true,
      tokenId,
      expirationDate: newExpirationDate,
      message: 'Token expiration updated successfully'
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

app.get('/api/tokens/:tokenId/analytics', requireAuth, async (req, res) => {
  try {
    const { tokenId } = req.params;
    
    const tokenData = await db.getTokenById(tokenId);
    
    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    if (tokenData.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized access to token' });
    }
    
    const uploads = await db.getUploadsByToken(tokenData.token);
    const analytics = await db.getTokenAnalytics(tokenId);
    
    res.json({
      success: true,
      analytics: {
        tokenId,
        name: tokenData.event_name,
        createdAt: tokenData.created_at,
        expiresAt: tokenData.expires_at,
        totalUploads: uploads.length,
        maxUploads: tokenData.max_uploads,
        accessCount: analytics.access_count || 0,
        qrGeneratedAt: analytics.qr_generated_at,
        isActive: !tokenData.expires_at || new Date() < new Date(tokenData.expires_at),
        uploads: uploads.map(upload => ({
          id: upload.id,
          filename: upload.filename,
          uploadedAt: upload.uploaded_at,
          fileSize: upload.file_size,
          uploaderName: upload.uploader_name
        }))
      }
    });
  } catch (error) {
    console.error('Get token analytics error:', error);
    res.status(500).json({ error: 'Failed to get token analytics' });
  }
});

// Bulk QR Code Operations
app.post('/api/tokens/bulk-create', requireAuth, async (req, res) => {
  try {
    const { tokens, defaultQrOptions } = req.body;
    
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: 'Tokens array is required' });
    }
    
    if (tokens.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 tokens can be created at once' });
    }
    
    const user = await db.getUserById(req.session.userId);
    if (!user.subscription_status || user.subscription_status === 'inactive') {
      return res.status(403).json({ error: 'Active subscription required to create tokens' });
    }
    
    const results = [];
    const errors = [];
    
    for (let i = 0; i < tokens.length; i++) {
      try {
        const tokenConfig = tokens[i];
        const { name, maxUploads, expiresIn, qrOptions } = tokenConfig;
        
        if (!name || !maxUploads) {
          errors.push({ index: i, error: 'Name and maxUploads are required' });
          continue;
        }
        
        // Generate secure token
        const tokenData = {
          id: uuidv4(),
          userId: req.session.userId,
          timestamp: Date.now(),
          name: name
        };
        
        const tokenString = crypto.randomBytes(32).toString('hex');
        const signedToken = crypto
          .createHmac('sha256', process.env.TOKEN_SECRET || process.env.SESSION_SECRET)
          .update(JSON.stringify(tokenData))
          .digest('hex');
        
        const secureToken = `${tokenString}.${signedToken.substring(0, 16)}`;
        
        const expirationDate = expiresIn ? 
          new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : 
          null;
        
        await db.createToken(req.session.userId, secureToken, expirationDate, name);
        const tokenInfo = await db.getTokenByValue(secureToken);
        
        const qrCodeData = await generateDynamicQR(tokenInfo, {
          ...defaultQrOptions,
          ...qrOptions
        });
        
        results.push({
          index: i,
          success: true,
          token: secureToken,
          tokenId: tokenInfo.id,
          url: qrCodeData.url,
          qrCode: qrCodeData.qrCode,
          name,
          maxUploads,
          expirationDate
        });
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }
    
    res.json({
      success: true,
      results,
      errors,
      summary: {
        total: tokens.length,
        successful: results.length,
        failed: errors.length
      }
    });
  } catch (error) {
    console.error('Bulk create tokens error:', error);
    res.status(500).json({ error: 'Failed to create tokens' });
  }
});

app.post('/api/tokens/cleanup-expired', requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.session.userId);
    if (user.email !== process.env.ADMIN_EMAIL && !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const expiredTokens = await db.getExpiredTokens();
    const cleanupResults = await db.cleanupExpiredTokens();
    
    res.json({
      success: true,
      message: 'Expired tokens cleaned up successfully',
      expiredCount: expiredTokens.length,
      cleanupResults
    });
  } catch (error) {
    console.error('Cleanup expired tokens error:', error);
    res.status(500).json({ error: 'Failed to cleanup expired tokens' });
  }
});

app.get('/api/tokens/statistics', requireAuth, async (req, res) => {
  try {
    const stats = await db.getTokenStatistics(req.session.userId);
    
    res.json({
      success: true,
      statistics: {
        totalTokens: stats.total_tokens,
        activeTokens: stats.active_tokens,
        expiredTokens: stats.expired_tokens,
        totalUploads: stats.total_uploads,
        totalAccessCount: stats.total_access_count,
        averageUploadsPerToken: Math.round(stats.total_uploads / (stats.total_tokens || 1) * 100) / 100,
        mostActiveToken: stats.most_active_token
      }
    });
  } catch (error) {
    console.error('Get token statistics error:', error);
    res.status(500).json({ error: 'Failed to get token statistics' });
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
    
    // Validate token format first
    if (!validateToken(token)) {
      return res.status(400).json({ error: 'Invalid token format' });
    }
    
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