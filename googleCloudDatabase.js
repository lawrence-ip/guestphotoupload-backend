const { Firestore } = require('@google-cloud/firestore');
const { Logging } = require('@google-cloud/logging');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class GoogleCloudDatabase {
  constructor() {
    // Initialize Firestore
    this.db = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEYFILE
    });
    
    // Initialize Cloud Logging
    this.logging = new Logging({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEYFILE
    });
    
    this.log = this.logging.log('gueststory-app');
    this.collectionPrefix = process.env.FIRESTORE_COLLECTION_PREFIX || 'gueststory';
    
    console.log('Google Cloud Database initialized');
    this.initializeCollections();
  }

  async initializeCollections() {
    // Ensure required collections exist by creating initial documents if needed
    try {
      // Users collection
      const usersRef = this.db.collection(`${this.collectionPrefix}_users`);
      const usersSnapshot = await usersRef.limit(1).get();
      
      // Tokens collection  
      const tokensRef = this.db.collection(`${this.collectionPrefix}_tokens`);
      
      // Uploads collection
      const uploadsRef = this.db.collection(`${this.collectionPrefix}_uploads`);
      
      // Subscriptions collection
      const subscriptionsRef = this.db.collection(`${this.collectionPrefix}_subscriptions`);
      
      // Events collection for logging
      const eventsRef = this.db.collection(`${this.collectionPrefix}_events`);
      
      this.logEvent('system', 'database_initialized', { 
        message: 'Google Cloud Firestore collections initialized' 
      });
      
      console.log('Google Cloud Firestore collections initialized');
    } catch (error) {
      console.error('Error initializing collections:', error);
    }
  }

  // Logging helper
  async logEvent(userId, eventType, data = {}) {
    try {
      const eventData = {
        userId,
        eventType,
        data,
        timestamp: new Date(),
        ip: data.ip || null,
        userAgent: data.userAgent || null
      };

      // Log to Firestore
      await this.db.collection(`${this.collectionPrefix}_events`).add(eventData);
      
      // Log to Cloud Logging
      const metadata = {
        resource: { type: 'global' },
        labels: { 
          userId: userId?.toString() || 'system',
          eventType 
        }
      };
      
      const entry = this.log.entry(metadata, eventData);
      await this.log.write(entry);
    } catch (error) {
      console.error('Error logging event:', error);
    }
  }

  // User management
  async createUser(email, password) {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const userData = {
        email,
        password: hashedPassword,
        provider: 'local',
        createdAt: new Date(),
        subscriptionStatus: 'trial',
        name: email.split('@')[0] // Default name from email
      };
      
      const docRef = await this.db.collection(`${this.collectionPrefix}_users`).add(userData);
      
      await this.logEvent(docRef.id, 'user_created', { email });
      
      return docRef.id;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async getUserById(id) {
    try {
      const doc = await this.db.collection(`${this.collectionPrefix}_users`).doc(id).get();
      if (!doc.exists) {
        return null;
      }
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }

  async getUserByEmail(email) {
    try {
      const snapshot = await this.db.collection(`${this.collectionPrefix}_users`)
        .where('email', '==', email)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return null;
      }
      
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  }

  async validateUser(email, password) {
    try {
      const user = await this.getUserByEmail(email);
      if (!user) {
        await this.logEvent(null, 'login_failed', { email, reason: 'user_not_found' });
        return null;
      }
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        await this.logEvent(user.id, 'login_failed', { email, reason: 'invalid_password' });
        return null;
      }
      
      await this.logEvent(user.id, 'login_success', { email });
      return user;
    } catch (error) {
      console.error('Error validating user:', error);
      throw error;
    }
  }

  // OAuth user methods
  async createOAuthUser(profile, provider) {
    try {
      const userData = {
        email: profile.emails[0].value,
        provider,
        providerId: profile.id,
        name: profile.displayName,
        avatarUrl: profile.photos?.[0]?.value,
        createdAt: new Date(),
        subscriptionStatus: 'trial'
      };
      
      const docRef = await this.db.collection(`${this.collectionPrefix}_users`).add(userData);
      
      await this.logEvent(docRef.id, 'oauth_user_created', { 
        provider, 
        email: userData.email 
      });
      
      return docRef.id;
    } catch (error) {
      console.error('Error creating OAuth user:', error);
      throw error;
    }
  }

  async findOrCreateOAuthUser(profile, provider) {
    try {
      // First try to find by provider ID
      const providerSnapshot = await this.db.collection(`${this.collectionPrefix}_users`)
        .where('provider', '==', provider)
        .where('providerId', '==', profile.id)
        .limit(1)
        .get();
      
      if (!providerSnapshot.empty) {
        const doc = providerSnapshot.docs[0];
        await this.logEvent(doc.id, 'oauth_login', { provider });
        return { id: doc.id, ...doc.data() };
      }
      
      // If not found, try to find by email
      const email = profile.emails[0].value;
      const emailUser = await this.getUserByEmail(email);
      
      if (emailUser) {
        // Link OAuth to existing account
        await this.db.collection(`${this.collectionPrefix}_users`).doc(emailUser.id).update({
          provider,
          providerId: profile.id,
          name: profile.displayName || emailUser.name,
          avatarUrl: profile.photos?.[0]?.value || emailUser.avatarUrl
        });
        
        await this.logEvent(emailUser.id, 'oauth_account_linked', { provider });
        return emailUser;
      }
      
      // Create new OAuth user
      const userId = await this.createOAuthUser(profile, provider);
      return await this.getUserById(userId);
    } catch (error) {
      console.error('Error finding/creating OAuth user:', error);
      throw error;
    }
  }

  // Token management
  async createToken(userId, token, expiresAt, eventName = 'Photo Collection') {
    try {
      const tokenData = {
        userId,
        token,
        eventName,
        maxUploads: 50, // default
        currentUploads: 0,
        expiresAt: expiresAt || null,
        createdAt: new Date(),
        active: true
      };
      
      const docRef = await this.db.collection(`${this.collectionPrefix}_tokens`).add(tokenData);
      
      await this.logEvent(userId, 'token_created', { 
        tokenId: docRef.id, 
        eventName,
        expiresAt 
      });
      
      return docRef.id;
    } catch (error) {
      console.error('Error creating token:', error);
      throw error;
    }
  }

  async getTokenByValue(token) {
    try {
      const snapshot = await this.db.collection(`${this.collectionPrefix}_tokens`)
        .where('token', '==', token)
        .where('active', '==', true)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return null;
      }
      
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Error getting token by value:', error);
      throw error;
    }
  }

  async getUserTokens(userId) {
    try {
      const snapshot = await this.db.collection(`${this.collectionPrefix}_tokens`)
        .where('userId', '==', userId)
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .get();
      
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting user tokens:', error);
      throw error;
    }
  }

  // Upload management
  async createUpload(tokenId, originalName, filename, size, mimetype, guestName = 'Anonymous', guestMessage = '') {
    try {
      const uploadData = {
        tokenId,
        originalName,
        filename,
        size,
        mimetype,
        guestName,
        guestMessage,
        uploadedAt: new Date(),
        status: 'pending'
      };
      
      const docRef = await this.db.collection(`${this.collectionPrefix}_uploads`).add(uploadData);
      
      // Update token's current upload count
      const token = await this.getTokenByValue(tokenId);
      if (token) {
        await this.db.collection(`${this.collectionPrefix}_tokens`).doc(token.id).update({
          currentUploads: token.currentUploads + 1
        });
        
        await this.logEvent(token.userId, 'file_uploaded', { 
          uploadId: docRef.id,
          filename: originalName,
          guestName 
        });
      }
      
      return docRef.id;
    } catch (error) {
      console.error('Error creating upload:', error);
      throw error;
    }
  }

  async getUserUploads(userId) {
    try {
      // Get user's tokens first
      const tokens = await this.getUserTokens(userId);
      const tokenIds = tokens.map(t => t.id);
      
      if (tokenIds.length === 0) {
        return [];
      }
      
      const uploads = [];
      // Firestore 'in' queries are limited to 10 items, so we need to batch
      const batchSize = 10;
      for (let i = 0; i < tokenIds.length; i += batchSize) {
        const batch = tokenIds.slice(i, i + batchSize);
        const snapshot = await this.db.collection(`${this.collectionPrefix}_uploads`)
          .where('tokenId', 'in', batch)
          .orderBy('uploadedAt', 'desc')
          .get();
        
        uploads.push(...snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }
      
      return uploads;
    } catch (error) {
      console.error('Error getting user uploads:', error);
      throw error;
    }
  }

  // Statistics
  async getUserStats(userId) {
    try {
      const tokens = await this.getUserTokens(userId);
      const uploads = await this.getUserUploads(userId);
      
      const activeTokens = tokens.filter(t => 
        !t.expiresAt || new Date(t.expiresAt.toDate()) > new Date()
      ).length;
      
      await this.logEvent(userId, 'stats_viewed', { 
        totalTokens: tokens.length,
        totalUploads: uploads.length,
        activeTokens 
      });
      
      return {
        total_tokens: tokens.length,
        total_uploads: uploads.length,
        active_tokens: activeTokens
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      throw error;
    }
  }

  // Google Drive tokens (for OAuth integration)
  async saveGoogleDriveTokens(userId, accessToken, refreshToken, expiresAt) {
    try {
      const tokenData = {
        userId,
        accessToken,
        refreshToken,
        expiresAt: new Date(expiresAt),
        updatedAt: new Date()
      };
      
      await this.db.collection(`${this.collectionPrefix}_google_drive_tokens`)
        .doc(userId)
        .set(tokenData, { merge: true });
      
      await this.logEvent(userId, 'google_drive_tokens_saved', {});
      
      return true;
    } catch (error) {
      console.error('Error saving Google Drive tokens:', error);
      throw error;
    }
  }

  async getGoogleDriveTokens(userId) {
    try {
      const doc = await this.db.collection(`${this.collectionPrefix}_google_drive_tokens`)
        .doc(userId)
        .get();
      
      if (!doc.exists) {
        return null;
      }
      
      return doc.data();
    } catch (error) {
      console.error('Error getting Google Drive tokens:', error);
      throw error;
    }
  }

  async updateGoogleDriveToken(userId, accessToken, expiresAt) {
    try {
      await this.db.collection(`${this.collectionPrefix}_google_drive_tokens`)
        .doc(userId)
        .update({
          accessToken,
          expiresAt: new Date(expiresAt),
          updatedAt: new Date()
        });
      
      return true;
    } catch (error) {
      console.error('Error updating Google Drive token:', error);
      throw error;
    }
  }

  // Subscription management
  async getSubscriptionByUserId(userId) {
    try {
      const snapshot = await this.db.collection(`${this.collectionPrefix}_subscriptions`)
        .where('userId', '==', userId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return null;
      }
      
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Error getting subscription:', error);
      throw error;
    }
  }

  async createUserSubscription(userId, planId, stripeSubscriptionId = null) {
    try {
      const subscriptionData = {
        userId,
        planId,
        stripeSubscriptionId,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const docRef = await this.db.collection(`${this.collectionPrefix}_subscriptions`)
        .add(subscriptionData);
      
      await this.logEvent(userId, 'subscription_created', { 
        subscriptionId: docRef.id,
        planId 
      });
      
      return docRef.id;
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }
}

module.exports = GoogleCloudDatabase;