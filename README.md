# GuestStory Backend API

This is the backend API server for the GuestStory photo collection application.

## Features

- RESTful API endpoints for authentication, file uploads, and user management
- Google OAuth2 integration
- Google Drive integration for photo storage
- Stripe integration for subscriptions
- SQLite database with automatic initialization
- File upload handling with validation
- Session-based authentication
- CORS configuration for frontend-backend separation

## API Endpoints

### Authentication
- `POST /api/login` - User login
- `POST /api/register` - User registration
- `GET /api/logout` - User logout
- `GET /api/user` - Get current user info
- `GET /api/oauth/status` - Check OAuth configuration

### OAuth Routes
- `GET /auth/google` - Google OAuth login
- `GET /auth/google/callback` - Google OAuth callback
- `GET /auth/facebook` - Facebook OAuth login
- `GET /auth/facebook/callback` - Facebook OAuth callback

### Token Management
- `GET /api/tokens` - Get user's upload tokens
- `POST /api/tokens` - Create new upload token
- `GET /api/tokens/:token` - Get token info
- `DELETE /api/tokens/:tokenId` - Delete token

### File Upload
- `POST /api/upload/:token` - Upload photos with guest token
- `GET /api/uploads` - Get user's uploads
- `GET /api/uploads/:token` - Get uploads for specific token

### Subscriptions
- `GET /api/subscription` - Get user subscription
- `GET /api/pricing/:countryCode` - Get pricing for country
- `POST /api/create-checkout-session` - Create Stripe checkout
- `POST /api/create-portal-session` - Create Stripe portal

### Stats
- `GET /api/stats` - Get user statistics
- `GET /api/health` - Health check endpoint

### Google Drive
- `GET /api/drive/status` - Check Drive connection status

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

3. **Required Environment Variables**:
   - `PORT` - Server port (default: 3000)
   - `FRONTEND_URL` - Frontend URL for CORS (default: http://localhost:3001)
   - `SESSION_SECRET` - Secret for session encryption
   - `GOOGLE_CLIENT_ID` - Google OAuth client ID
   - `GOOGLE_CLIENT_SECRET` - Google OAuth client secret

4. **Start the Server**:
   ```bash
   npm start
   ```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Set authorized redirect URI: `http://localhost:3000/auth/google/callback`
4. Add client ID and secret to `.env` file

## Development

- Server runs on port 3000 by default
- Database automatically initializes on first run
- File uploads stored in `uploads/` directory
- Logs are written to console

## Production Deployment

1. **Environment Variables**:
   - Set `NODE_ENV=production`
   - Configure production `FRONTEND_URL`
   - Use secure session secret
   - Configure production OAuth redirect URIs

2. **HTTPS Required**:
   - OAuth callbacks require HTTPS in production
   - Sessions require secure cookies

3. **Database**:
   - SQLite database stored as `app.db`
   - Backup regularly in production

## CORS Configuration

The server is configured to accept requests from:
- Development: `http://localhost:3001`
- Production: Value of `FRONTEND_URL` environment variable

## File Structure

```
├── server.js           # Main API server
├── database.js         # Database operations
├── oauth.js           # OAuth configuration
├── googleDrive.js     # Google Drive integration
├── gcpBucket.js       # Google Cloud Storage
├── stripe.js          # Stripe payment processing
├── regionalPricing.js # Regional pricing logic
├── worker.js          # Background worker process
├── uploads/           # Uploaded files directory
└── package.json       # Dependencies
```
