# GuestStory - Deployment Guide

This guide covers deploying the GuestStory application with separate frontend and backend repositories.

## Architecture Overview

```
┌─────────────────┐     HTTP/HTTPS      ┌─────────────────┐
│                 │ ─────────────────── │                 │
│    Frontend     │     API Calls       │     Backend     │
│   (Static Site) │ ─────────────────── │  (Node.js API)  │
│                 │                     │                 │
└─────────────────┘                     └─────────────────┘
        │                                         │
        │                                         │
        ▼                                         ▼
   Static Hosting                            Server Hosting
   (Netlify/Vercel)                         (Heroku/Railway)
```

## Prerequisites

1. **Separate Repositories**:
   - `guestphotoupload-frontend` - Frontend application
   - `guestphotoupload-backend` - Backend API

2. **Environment Setup**:
   - Node.js 16+ for backend
   - Modern web browser for frontend

## Backend Deployment

### Option 1: Railway (Recommended)

1. **Prepare Repository**:
   ```bash
   cd guestphotoupload-backend
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-backend-repo-url>
   git push -u origin main
   ```

2. **Deploy to Railway**:
   - Visit [railway.app](https://railway.app)
   - Connect your GitHub repository
   - Set environment variables:
     ```
     NODE_ENV=production
     PORT=3000
     FRONTEND_URL=https://your-frontend-domain.com
     SESSION_SECRET=your-secure-session-secret
     GOOGLE_CLIENT_ID=your-google-client-id
     GOOGLE_CLIENT_SECRET=your-google-client-secret
     ```
   - Railway auto-deploys on commits

3. **Configure OAuth Redirects**:
   - Update Google Cloud Console OAuth settings
   - Add: `https://your-backend-domain.railway.app/auth/google/callback`

### Option 2: Heroku

1. **Install Heroku CLI**:
   ```bash
   npm install -g heroku
   heroku login
   ```

2. **Create and Deploy**:
   ```bash
   cd guestphotoupload-backend
   heroku create your-backend-app-name
   
   # Set environment variables
   heroku config:set NODE_ENV=production
   heroku config:set FRONTEND_URL=https://your-frontend-domain.com
   heroku config:set SESSION_SECRET=your-secure-session-secret
   heroku config:set GOOGLE_CLIENT_ID=your-google-client-id
   heroku config:set GOOGLE_CLIENT_SECRET=your-google-client-secret
   
   git push heroku main
   ```

### Option 3: DigitalOcean App Platform

1. **Connect Repository**:
   - Go to DigitalOcean App Platform
   - Connect your backend repository
   - Configure build and run commands:
     - Build: `npm install`
     - Run: `npm start`

2. **Environment Variables**:
   Set the same variables as above in the App Platform dashboard

## Frontend Deployment

### Option 1: Netlify (Recommended)

1. **Prepare Repository**:
   ```bash
   cd guestphotoupload-frontend
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-frontend-repo-url>
   git push -u origin main
   ```

2. **Deploy to Netlify**:
   - Visit [netlify.com](https://netlify.com)
   - Connect your GitHub repository
   - Build settings:
     - Build command: `npm run build`
     - Publish directory: `.` (root)
   - Deploy automatically on commits

3. **Update Configuration**:
   - Update `config.js` with your backend URL:
     ```javascript
     API_BASE_URL: 'https://your-backend-domain.railway.app'
     ```

### Option 2: Vercel

1. **Connect Repository**:
   ```bash
   cd guestphotoupload-frontend
   npm install -g vercel
   vercel
   ```

2. **Configure**:
   - Vercel auto-detects static site
   - Update config.js with backend URL
   - Redeploy: `vercel --prod`

### Option 3: AWS S3 + CloudFront

1. **Create S3 Bucket**:
   ```bash
   aws s3 mb s3://your-frontend-bucket-name
   aws s3 website s3://your-frontend-bucket-name --index-document index.html
   ```

2. **Upload Files**:
   ```bash
   cd guestphotoupload-frontend
   aws s3 sync . s3://your-frontend-bucket-name --exclude "node_modules/*"
   ```

3. **Configure CloudFront**:
   - Create CloudFront distribution
   - Point to S3 bucket
   - Configure custom domain and SSL

## Configuration Steps

### 1. Update Frontend Configuration

In `guestphotoupload-frontend/config.js`:

```javascript
const CONFIG = {
  API_BASE_URL: 'https://your-backend-domain.com', // Update this
  FRONTEND_URL: window.location.origin,
  // ... rest of config
};
```

### 2. Update Backend CORS

In `guestphotoupload-backend/server.js`, ensure CORS is configured:

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true
}));
```

### 3. OAuth Configuration

Update Google Cloud Console:
- **Authorized JavaScript origins**: 
  - `https://your-frontend-domain.com`
- **Authorized redirect URIs**: 
  - `https://your-backend-domain.com/auth/google/callback`
  - `https://your-backend-domain.com/auth/facebook/callback`

## Environment Variables

### Backend (.env)
```bash
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://your-frontend-domain.com
SESSION_SECRET=your-secure-random-string
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
```

### Frontend
No environment variables needed - configuration is in `config.js`

## Database Setup

The SQLite database will be created automatically on first run. For production:

1. **Development**: Uses local SQLite file
2. **Production**: Consider migrating to PostgreSQL for better performance
3. **Backup**: Implement regular database backups

## SSL/HTTPS Configuration

**Required for production OAuth:**

1. **Frontend**: Hosting platforms (Netlify, Vercel) provide automatic HTTPS
2. **Backend**: Railway, Heroku provide automatic HTTPS
3. **Custom domains**: Configure SSL certificates through your hosting provider

## Testing Deployment

### 1. Health Check
```bash
curl https://your-backend-domain.com/api/health
```

### 2. CORS Test
```bash
curl -H "Origin: https://your-frontend-domain.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     https://your-backend-domain.com/api/login
```

### 3. Frontend Test
- Visit `https://your-frontend-domain.com`
- Check browser console for errors
- Test login flow

## Monitoring and Maintenance

### 1. Logs
- **Railway**: Built-in log viewer
- **Heroku**: `heroku logs --tail`
- **Netlify**: Function logs in dashboard

### 2. Uptime Monitoring
- Use services like UptimeRobot or Pingdom
- Monitor both frontend and backend endpoints

### 3. Error Tracking
- Implement Sentry for error tracking
- Monitor API response times

## Scaling Considerations

### 1. Frontend
- CDN automatically provided by hosting platforms
- Consider image optimization
- Implement service worker for caching

### 2. Backend
- Database: Migrate from SQLite to PostgreSQL
- File storage: Use cloud storage (AWS S3, Google Cloud Storage)
- Caching: Implement Redis for session storage
- Load balancing: Use multiple backend instances

## Troubleshooting

### Common Issues

1. **CORS Errors**:
   - Verify FRONTEND_URL environment variable
   - Check OAuth redirect URLs
   - Ensure credentials are included in requests

2. **Authentication Issues**:
   - Verify session configuration
   - Check OAuth client ID/secret
   - Ensure HTTPS in production

3. **File Upload Failures**:
   - Check file size limits
   - Verify upload directory permissions
   - Monitor disk space

### Debug Commands

```bash
# Check backend health
curl https://your-backend-domain.com/api/health

# Check OAuth configuration
curl https://your-backend-domain.com/api/oauth/status

# Test frontend-backend connection
curl -H "Origin: https://your-frontend-domain.com" \
     https://your-backend-domain.com/api/user
```

## Cost Optimization

### Free Tier Recommendations

1. **Frontend**: Netlify (100GB bandwidth/month)
2. **Backend**: Railway ($5/month with $5 credit)
3. **Database**: Start with SQLite, migrate as needed
4. **Storage**: Google Drive integration (free with user accounts)

### Paid Upgrades

- **Railway Pro**: $20/month for better resources
- **Heroku Hobby**: $7/month per dyno
- **AWS/GCP**: Pay-per-use pricing

This deployment setup provides a scalable, maintainable architecture with clear separation of concerns between frontend and backend services.