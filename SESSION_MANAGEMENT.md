# Session Management & Auto-Login

This application implements enhanced session management with auto-login functionality, Redis-based session storage, and intelligent caching.

## Features

### 🔐 Enhanced Session Security
- **Redis Session Storage**: Sessions are stored in Redis for scalability and persistence
- **Secure Cookies**: HttpOnly cookies with proper SameSite settings
- **Session Rotation**: Sessions are refreshed on each request to prevent fixation attacks
- **Rate Limiting**: Protection against brute force attacks on authentication endpoints

### ⚡ Auto-Login Functionality
- **Seamless Authentication**: Users are automatically authenticated if they have a valid session
- **Smart Caching**: User data is cached in memory for 5 minutes to reduce database queries
- **Session Validation**: Sessions are validated on each request with automatic cleanup of invalid sessions

### 🚀 Performance Optimization
- **Memory Caching**: User data is cached to minimize database queries
- **Background Cleanup**: Expired sessions and cache entries are automatically cleaned up
- **Graceful Shutdown**: Proper cleanup of Redis connections and resources

## Configuration

### Environment Variables

```bash
# Session timeout (in milliseconds)
SESSION_TIMEOUT=604800000  # 7 days default

# Redis configuration (optional - falls back to memory store)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# Session secret (CHANGE THIS IN PRODUCTION)
SESSION_SECRET=your-very-secure-session-secret
```

### Redis Setup (Optional)

If Redis is not available, the application will fall back to in-memory session storage:

```bash
# Install Redis (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis connection
redis-cli ping
```

## API Endpoints

### Authentication
- `POST /api/login` - Login with email/password (supports rememberMe option)
- `POST /api/register` - Register new user account
- `POST /api/logout` - Logout and destroy session
- `GET /api/user` - Get current user information

### Session Management
- `GET /api/auth/check` - Check authentication status and session info
- `POST /api/auth/refresh` - Refresh session expiry time
- `GET /api/auth/sessions` - Get current session information

## Usage Examples

### Frontend Auto-Login Check

```javascript
// Check if user is already logged in on app start
async function checkAuthStatus() {
  try {
    const response = await fetch('/api/auth/check', {
      credentials: 'include'
    });
    const data = await response.json();
    
    if (data.authenticated) {
      // User is logged in, update UI
      setUser(data.user);
      setAuthenticated(true);
    }
  } catch (error) {
    console.error('Auth check failed:', error);
  }
}
```

### Login with Remember Me

```javascript
async function login(email, password, rememberMe = false) {
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ email, password, rememberMe })
    });
    
    const data = await response.json();
    if (data.success) {
      setUser(data.user);
      setAuthenticated(true);
    }
  } catch (error) {
    console.error('Login failed:', error);
  }
}
```

### Session Refresh

```javascript
// Refresh session to extend expiry (useful for active users)
async function refreshSession() {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    });
    const data = await response.json();
    console.log('Session refreshed, expires in:', data.expiresIn);
  } catch (error) {
    console.error('Session refresh failed:', error);
  }
}
```

## Security Features

### Rate Limiting
- Login and registration endpoints are rate-limited to 5 attempts per 15 minutes per IP
- Prevents brute force attacks

### Session Security
- Sessions use secure, httpOnly cookies
- Session IDs are regenerated on login
- Sessions are invalidated properly on logout
- Automatic cleanup of expired sessions

### Cache Security
- User data cache has a TTL of 5 minutes
- Cache is cleared on logout
- Background cleanup removes expired entries

## Monitoring

### Session Health
The application provides session information through the `/api/auth/check` endpoint:

```json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name"
  },
  "sessionInfo": {
    "sessionId": "session-id-hash",
    "loginTime": "2024-01-23T10:00:00.000Z",
    "lastAccess": "2024-01-23T10:30:00.000Z",
    "expiresIn": 604800000
  }
}
```

### Logging
The application logs important session events:
- Redis connection status
- Session creation and destruction
- Authentication attempts
- Cache operations

## Troubleshooting

### Redis Connection Issues
If Redis is not available, the application will automatically fall back to memory-based sessions:
```
Redis not available, using memory store for sessions
```

### Session Not Persisting
1. Check that `credentials: 'include'` is set in frontend requests
2. Verify CORS configuration allows credentials
3. Ensure SESSION_SECRET is set and consistent
4. Check Redis connection if using Redis store

### Performance Issues
1. Monitor cache hit rate - should be high for active users
2. Check Redis memory usage if using Redis
3. Monitor session cleanup frequency
4. Consider adjusting CACHE_TTL for your use case

## Production Considerations

1. **Use Redis**: Memory-based sessions don't work with multiple server instances
2. **Secure Session Secret**: Use a strong, random session secret
3. **HTTPS**: Enable secure cookies in production
4. **Session Timeout**: Configure appropriate session timeout for your security requirements
5. **Monitoring**: Monitor Redis performance and session metrics
6. **Backup**: Consider Redis persistence configuration for session data