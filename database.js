const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database(path.join(__dirname, 'app.db'));
    this.init();
  }

  init() {
    // Create users table with OAuth support
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        provider TEXT DEFAULT 'local',
        provider_id TEXT,
        name TEXT,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        google_credentials TEXT,
        google_token TEXT,
        drive_folder_name TEXT DEFAULT 'Guest Uploads',
        bucket_name TEXT DEFAULT 'guest-uploads-temp'
      )
    `);

    // Add OAuth columns to existing users table if they don't exist
    this.db.run(`ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'local'`, () => {});
    this.db.run(`ALTER TABLE users ADD COLUMN provider_id TEXT`, () => {});
    this.db.run(`ALTER TABLE users ADD COLUMN name TEXT`, () => {});
    this.db.run(`ALTER TABLE users ADD COLUMN avatar_url TEXT`, () => {});
    
    // Make password nullable for OAuth users
    this.db.run(`CREATE TABLE IF NOT EXISTS users_backup AS SELECT * FROM users`, () => {});

    console.log('Database initialized');
    this.initializeSubscriptionTables();
  }

  initializeSubscriptionTables() {

    // Create tokens table (linked to users)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS upload_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        event_name TEXT DEFAULT 'Photo Collection',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Add event_name column to existing tokens table if it doesn't exist
    this.db.run(`ALTER TABLE upload_tokens ADD COLUMN event_name TEXT DEFAULT 'Photo Collection'`, () => {});

    // Create uploads table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mimetype TEXT NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        uploaded_to_bucket BOOLEAN DEFAULT FALSE,
        uploaded_to_drive BOOLEAN DEFAULT FALSE,
        uploaded_to_drive_at DATETIME,
        FOREIGN KEY (token_id) REFERENCES upload_tokens(id)
      )
    `);

    // Create QR code activities table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS qr_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id INTEGER NOT NULL,
        activity_type TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        guest_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (token_id) REFERENCES upload_tokens(id)
      )
    `);

    // Create Google Drive tokens table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS google_drive_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create subscription plans table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'USD',
        stripe_price_id TEXT UNIQUE,
        max_storage_gb INTEGER NOT NULL,
        max_files INTEGER,
        validity_days INTEGER NOT NULL,
        is_trial BOOLEAN DEFAULT FALSE,
        features TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating subscription_plans table:', err);
      } else {
        console.log('Subscription plans table created successfully');
      }
    });

    // Create user subscriptions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        stripe_subscription_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        current_period_start DATETIME,
        current_period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating user_subscriptions table:', err);
      } else {
        console.log('User subscriptions table created successfully');
      }
    });

    // Create usage tracking table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        subscription_id INTEGER,
        file_count INTEGER DEFAULT 0,
        storage_used_gb DECIMAL(10,4) DEFAULT 0,
        period_start DATETIME,
        period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (subscription_id) REFERENCES user_subscriptions(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating usage_tracking table:', err);
      } else {
        console.log('Usage tracking table created successfully');
        // Initialize default plans after all tables are created
        setTimeout(() => {
          this.initializeDefaultPlans();
        }, 100);
      }
    });
  }

  // User management
  async createUser(email, password) {
    return new Promise((resolve, reject) => {
      const hashedPassword = bcrypt.hashSync(password, 10);
      this.db.run(
        'INSERT INTO users (email, password) VALUES (?, ?)',
        [email, hashedPassword],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getUserById(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // OAuth user methods
  async createOAuthUser(profile, provider) {
    return new Promise((resolve, reject) => {
      const { id, emails, displayName, photos } = profile;
      const email = emails && emails[0] ? emails[0].value : null;
      const avatar_url = photos && photos[0] ? photos[0].value : null;
      
      if (!email) {
        return reject(new Error('No email found in OAuth profile'));
      }

      this.db.run(
        `INSERT INTO users (email, provider, provider_id, name, avatar_url) 
         VALUES (?, ?, ?, ?, ?)`,
        [email, provider, id, displayName, avatar_url],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async findOrCreateOAuthUser(profile, provider) {
    return new Promise(async (resolve, reject) => {
      try {
        const { id, emails, displayName, photos } = profile;
        const email = emails && emails[0] ? emails[0].value : null;
        const avatar_url = photos && photos[0] ? photos[0].value : null;
        
        if (!email) {
          return reject(new Error('No email found in OAuth profile'));
        }

        // First, try to find existing user by provider_id
        this.db.get(
          'SELECT * FROM users WHERE provider = ? AND provider_id = ?',
          [provider, id],
          async (err, existingUser) => {
            if (err) return reject(err);
            
            if (existingUser) {
              // Update user info in case it changed
              this.db.run(
                'UPDATE users SET name = ?, avatar_url = ? WHERE id = ?',
                [displayName, avatar_url, existingUser.id],
                (updateErr) => {
                  if (updateErr) console.error('Error updating user info:', updateErr);
                }
              );
              return resolve(existingUser);
            }

            // Check if user exists with same email but different provider
            this.db.get(
              'SELECT * FROM users WHERE email = ?',
              [email],
              async (emailErr, emailUser) => {
                if (emailErr) return reject(emailErr);
                
                if (emailUser) {
                  // Link OAuth account to existing email user
                  this.db.run(
                    'UPDATE users SET provider_id = ?, name = ?, avatar_url = ? WHERE id = ?',
                    [id, displayName, avatar_url, emailUser.id],
                    (linkErr) => {
                      if (linkErr) return reject(linkErr);
                      resolve(emailUser);
                    }
                  );
                } else {
                  // Create new OAuth user
                  try {
                    const userId = await this.createOAuthUser(profile, provider);
                    const newUser = await this.getUserById(userId);
                    resolve(newUser);
                  } catch (createErr) {
                    reject(createErr);
                  }
                }
              }
            );
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async getUserByProviderId(provider, providerId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE provider = ? AND provider_id = ?',
        [provider, providerId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async validateUser(email, password) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) reject(err);
        else if (user && bcrypt.compareSync(password, user.password)) {
          resolve(user);
        } else {
          resolve(null);
        }
      });
    });
  }

  async updateUserGoogleCredentials(userId, credentials, token, folderName, bucketName) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE users SET 
         google_credentials = ?, 
         google_token = ?, 
         drive_folder_name = ?, 
         bucket_name = ? 
         WHERE id = ?`,
        [credentials, token, folderName, bucketName, userId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // Token management
  async createToken(userId, token, expiresAt, eventName = 'Photo Collection') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO upload_tokens (user_id, token, expires_at, event_name) VALUES (?, ?, ?, ?)',
        [userId, token, expiresAt, eventName],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getTokenByValue(token) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT t.*, u.email, u.drive_folder_name, u.bucket_name 
         FROM upload_tokens t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.token = ?`,
        [token],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getUserTokens(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM upload_tokens WHERE user_id = ? ORDER BY created_at DESC',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async markTokenUsed(tokenId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE upload_tokens SET used = TRUE WHERE id = ?',
        [tokenId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // Upload management
  async createUpload(tokenId, originalName, filename, size, mimetype) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO uploads 
         (token_id, original_name, filename, size, mimetype, uploaded_to_bucket) 
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [tokenId, originalName, filename, size, mimetype],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getUserUploads(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT u.*, t.token 
         FROM uploads u 
         JOIN upload_tokens t ON u.token_id = t.id 
         WHERE t.user_id = ? 
         ORDER BY u.uploaded_at DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async getPendingUploads(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT u.*, t.token 
         FROM uploads u 
         JOIN upload_tokens t ON u.token_id = t.id 
         WHERE t.user_id = ? AND u.uploaded_to_drive = FALSE 
         ORDER BY u.uploaded_at DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async markUploadToDrive(uploadId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE uploads SET uploaded_to_drive = TRUE, uploaded_to_drive_at = CURRENT_TIMESTAMP WHERE id = ?',
        [uploadId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  async getUserStats(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
          COUNT(DISTINCT t.id) as total_tokens,
          COUNT(DISTINCT u.id) as total_uploads,
          COUNT(CASE WHEN u.uploaded_to_drive = FALSE THEN 1 END) as pending_uploads,
          COALESCE(SUM(u.size), 0) as total_storage_used
         FROM upload_tokens t
         LEFT JOIN uploads u ON t.id = u.token_id
         WHERE t.user_id = ?`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows[0] || { total_tokens: 0, total_uploads: 0, pending_uploads: 0, total_storage_used: 0 });
        }
      );
    });
  }

  // QR Code Activity Tracking
  async trackQRActivity(tokenId, activityType, metadata = {}) {
    return new Promise((resolve, reject) => {
      const { ipAddress, userAgent, guestName } = metadata;
      this.db.run(
        `INSERT INTO qr_activities (token_id, activity_type, ip_address, user_agent, guest_name) 
         VALUES (?, ?, ?, ?, ?)`,
        [tokenId, activityType, ipAddress || null, userAgent || null, guestName || null],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getQRActivities(userId, limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
          qa.id,
          qa.activity_type,
          qa.guest_name,
          qa.created_at,
          t.token,
          t.event_name,
          t.created_at as token_created_at,
          COUNT(u.id) as upload_count
         FROM qr_activities qa
         JOIN upload_tokens t ON qa.token_id = t.id
         LEFT JOIN uploads u ON t.id = u.token_id
         WHERE t.user_id = ?
         GROUP BY qa.id
         ORDER BY qa.created_at DESC
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  async getQRStatsByToken(tokenId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
          activity_type,
          COUNT(*) as count,
          MAX(created_at) as last_activity
         FROM qr_activities 
         WHERE token_id = ?
         GROUP BY activity_type
         ORDER BY count DESC`,
        [tokenId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  // Subscription Plans Management
  initializeDefaultPlans() {
    // Check if plans already exist to avoid duplicates
    this.db.get('SELECT COUNT(*) as count FROM subscription_plans', [], (err, result) => {
      if (err || result.count > 0) {
        console.log('Subscription plans already initialized');
        return;
      }

      const defaultPlans = [
        {
          name: 'Free Trial',
          description: '10 photos upload with 7 days validity',
          price: 0.00,
          max_storage_gb: 1, // 1GB for 10 photos
          max_files: 10,
          validity_days: 7,
          is_trial: true,
          features: JSON.stringify(['10 photo uploads', '7 days access', 'GCP to Google Drive'])
        },
        {
          name: 'Photo Plan',
          description: 'Up to 5GB photos with 30 days validity',
          price: 9.99,
          max_storage_gb: 5,
          max_files: null,
          validity_days: 30,
          is_trial: false,
          features: JSON.stringify(['5GB storage', '30 days access', 'Photos only', 'GCP to Google Drive'])
        },
        {
          name: 'Media Plan',
          description: 'Up to 15GB photos and media with 180 days validity',
          price: 29.99,
          max_storage_gb: 15,
          max_files: null,
          validity_days: 180,
          is_trial: false,
          features: JSON.stringify(['15GB storage', '180 days access', 'Photos & Videos', 'GCP to Google Drive', 'Priority support'])
        }
      ];

      defaultPlans.forEach(plan => {
        this.db.run(
          `INSERT INTO subscription_plans 
           (name, description, price, max_storage_gb, max_files, validity_days, is_trial, features) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [plan.name, plan.description, plan.price, plan.max_storage_gb, plan.max_files, plan.validity_days, plan.is_trial, plan.features],
          function(err) {
            if (err) {
              console.error('Error creating plan:', plan.name, err.message);
            } else {
              console.log(`Created plan: ${plan.name}`);
            }
          }
        );
      });
    });
  }

  async getSubscriptionPlans() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM subscription_plans WHERE active = TRUE ORDER BY price ASC',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async getSubscriptionPlan(planId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM subscription_plans WHERE id = ?',
        [planId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getSubscriptionPlanByName(planName) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM subscription_plans WHERE name = ? AND active = TRUE',
        [planName],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  // User Subscription Management
  async createUserSubscription(userId, planId, stripeSubscriptionId = null) {
    return new Promise((resolve, reject) => {
      // First get plan details to set period
      this.getSubscriptionPlan(planId).then(plan => {
        if (!plan) {
          reject(new Error('Plan not found'));
          return;
        }

        const currentPeriodStart = new Date();
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setDate(currentPeriodEnd.getDate() + plan.validity_days);

        // Deactivate any existing subscriptions
        this.db.run(
          'UPDATE user_subscriptions SET status = "cancelled" WHERE user_id = ? AND status = "active"',
          [userId],
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            // Create new subscription
            this.db.run(
              `INSERT INTO user_subscriptions 
               (user_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [userId, planId, stripeSubscriptionId, 'active', currentPeriodStart.toISOString(), currentPeriodEnd.toISOString()],
              function(err) {
                if (err) {
                  reject(err);
                } else {
                  const subscriptionId = this.lastID;
                  // Create initial usage tracking - need to bind this context properly
                  const db = this; // Keep reference to database
                  resolve(subscriptionId); // Resolve immediately, create usage tracking separately
                  
                  // Create usage tracking asynchronously
                  const usageDb = db.db || db; // Handle context properly
                  usageDb.run(
                    `INSERT INTO usage_tracking 
                     (user_id, subscription_id, period_start, period_end)
                     VALUES (?, ?, ?, ?)`,
                    [userId, subscriptionId, currentPeriodStart.toISOString(), currentPeriodEnd.toISOString()],
                    function(err) {
                      if (err) {
                        console.error('Failed to create usage tracking:', err);
                      }
                    }
                  );
                }
              }
            );
          }
        );
      }).catch(reject);
    });
  }

  async getUserSubscription(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT us.*, sp.name, sp.description, sp.price, sp.max_storage_gb, sp.max_files, sp.validity_days, sp.is_trial, sp.features
         FROM user_subscriptions us
         JOIN subscription_plans sp ON us.plan_id = sp.id
         WHERE us.user_id = ? AND us.status = 'active'
         ORDER BY us.created_at DESC LIMIT 1`,
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async createUsageTracking(userId, subscriptionId, periodStart, periodEnd) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO usage_tracking 
         (user_id, subscription_id, period_start, period_end)
         VALUES (?, ?, ?, ?)`,
        [userId, subscriptionId, periodStart.toISOString(), periodEnd.toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async updateUsageTracking(userId, fileSize) {
    return new Promise((resolve, reject) => {
      // Get current subscription
      this.getUserSubscription(userId).then(subscription => {
        if (!subscription) {
          reject(new Error('No active subscription found'));
          return;
        }

        const fileSizeGB = fileSize / (1024 * 1024 * 1024);
        
        this.db.run(
          `UPDATE usage_tracking 
           SET file_count = file_count + 1, 
               storage_used_gb = storage_used_gb + ?, 
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND subscription_id = ?`,
          [fileSizeGB, userId, subscription.id],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      }).catch(reject);
    });
  }

  async checkUsageLimits(userId, fileSize) {
    return new Promise((resolve, reject) => {
      this.getUserSubscription(userId).then(subscription => {
        if (!subscription) {
          resolve({ allowed: false, reason: 'No active subscription' });
          return;
        }

        // Check if subscription is expired
        const now = new Date();
        const expiresAt = new Date(subscription.current_period_end);
        if (now > expiresAt) {
          resolve({ allowed: false, reason: 'Subscription expired' });
          return;
        }

        // Get current usage
        this.db.get(
          `SELECT ut.file_count, ut.storage_used_gb
           FROM usage_tracking ut
           WHERE ut.user_id = ? AND ut.subscription_id = ?`,
          [userId, subscription.id],
          (err, usage) => {
            if (err) {
              reject(err);
              return;
            }

            const currentFiles = usage ? usage.file_count : 0;
            const currentStorageGB = usage ? usage.storage_used_gb : 0;
            const newFileSizeGB = fileSize / (1024 * 1024 * 1024);
            const totalStorageGB = currentStorageGB + newFileSizeGB;

            // Check file count limit
            if (subscription.max_files && currentFiles >= subscription.max_files) {
              resolve({ allowed: false, reason: `File limit exceeded (${subscription.max_files} files)` });
              return;
            }

            // Check storage limit
            if (totalStorageGB > subscription.max_storage_gb) {
              resolve({ allowed: false, reason: `Storage limit exceeded (${subscription.max_storage_gb}GB)` });
              return;
            }

            resolve({ 
              allowed: true, 
              usage: {
                currentFiles,
                currentStorageGB,
                maxFiles: subscription.max_files,
                maxStorageGB: subscription.max_storage_gb
              }
            });
          }
        );
      }).catch(reject);
    });
  }

  // Google Drive Token Management
  async saveGoogleDriveTokens(userId, accessToken, refreshToken, expiresAt) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO google_drive_tokens 
         (user_id, access_token, refresh_token, expires_at, updated_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, accessToken, refreshToken, expiresAt],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getGoogleDriveTokens(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM google_drive_tokens WHERE user_id = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async updateGoogleDriveToken(userId, accessToken, expiresAt) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE google_drive_tokens 
         SET access_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = ?`,
        [accessToken, expiresAt, userId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async removeGoogleDriveTokens(userId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM google_drive_tokens WHERE user_id = ?',
        [userId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }
}

module.exports = Database;