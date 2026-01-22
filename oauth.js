const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

class OAuthConfig {
  constructor(database) {
    this.db = database;
    this.setupPassport();
  }

  setupPassport() {
    // Serialize user for session
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id, done) => {
      try {
        const user = await this.db.getUserById(id);
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    });

    // Google OAuth Strategy
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && 
        !process.env.GOOGLE_CLIENT_ID.includes('demo') && 
        !process.env.GOOGLE_CLIENT_ID.includes('your-')) {
      passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const user = await this.db.findOrCreateOAuthUser(profile, 'google');
          
          // Save Google Drive tokens for the user
          if (accessToken) {
            const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
            await this.db.saveGoogleDriveTokens(user.id, accessToken, refreshToken, expiresAt);
          }
          
          return done(null, user);
        } catch (error) {
          console.error('Google OAuth error:', error);
          return done(error, null);
        }
      }));
    } else {
      console.warn('Google OAuth not configured - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    }
  }

  // Middleware to check if OAuth is configured
  isGoogleConfigured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  isFacebookConfigured() {
    return false; // Facebook OAuth removed
  }

  getOAuthStatus() {
    return {
      google: this.isGoogleConfigured(),
      facebook: false
    };
  }
}

module.exports = OAuthConfig;