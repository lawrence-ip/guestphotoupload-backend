# OAuth2 Setup Guide for GuestStory

GuestStory now supports OAuth2 authentication with Google and Facebook. This allows users to register and login using their existing social media accounts.

## 🔧 Setup Instructions

### 1. Google OAuth Setup

1. **Go to Google Cloud Console**:
   - Visit [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one

2. **Enable Google+ API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it

3. **Create OAuth2 Credentials**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Set authorized redirect URI: `http://localhost:3000/auth/google/callback`
   - For production: `https://yourdomain.com/auth/google/callback`

4. **Copy Credentials**:
   - Copy the Client ID and Client Secret
   - Add them to your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your-google-client-id-here
   GOOGLE_CLIENT_SECRET=your-google-client-secret-here
   ```

### 2. Facebook OAuth Setup

1. **Go to Facebook Developers**:
   - Visit [Facebook for Developers](https://developers.facebook.com/)
   - Create a new app or select existing one

2. **Add Facebook Login Product**:
   - In your app dashboard, click "Add Product"
   - Select "Facebook Login" and set it up

3. **Configure OAuth Settings**:
   - Go to Facebook Login > Settings
   - Add redirect URI: `http://localhost:3000/auth/facebook/callback`
   - For production: `https://yourdomain.com/auth/facebook/callback`

4. **Copy Credentials**:
   - Go to Settings > Basic
   - Copy the App ID and App Secret
   - Add them to your `.env` file:
   ```env
   FACEBOOK_APP_ID=your-facebook-app-id-here
   FACEBOOK_APP_SECRET=your-facebook-app-secret-here
   ```

## 🚀 Features

### What's Included:
- ✅ **Google OAuth2** - Login/register with Google accounts
- ✅ **Facebook OAuth2** - Login/register with Facebook accounts
- ✅ **Automatic Trial Creation** - New OAuth users get free trial automatically
- ✅ **Profile Integration** - Uses OAuth profile data (name, email, avatar)
- ✅ **Seamless Experience** - No password required for OAuth users
- ✅ **Account Linking** - Links OAuth accounts to existing email accounts

### User Experience:
1. **Login/Register Pages** - Shows OAuth buttons when configured
2. **One-Click Registration** - No forms to fill for OAuth users
3. **Profile Pictures** - Automatically imports user avatars
4. **Quick Setup** - OAuth users skip manual account creation

## 🔒 Security Features

- **Secure Token Handling** - Uses Passport.js for OAuth management
- **Session Management** - Integrated with existing session system
- **Profile Verification** - Validates OAuth profiles before account creation
- **Account Protection** - Links OAuth to existing accounts safely

## 🛠️ Development Testing

### Testing OAuth Locally:

1. **Set Test Credentials** in `.env`:
   ```env
   GOOGLE_CLIENT_ID=test-client-id
   GOOGLE_CLIENT_SECRET=test-client-secret
   FACEBOOK_APP_ID=test-app-id
   FACEBOOK_APP_SECRET=test-app-secret
   ```

2. **Check OAuth Status**:
   ```bash
   curl http://localhost:3000/api/oauth/status
   ```

3. **View OAuth Buttons**:
   - Visit `/login` or `/register`
   - OAuth buttons appear when credentials are configured

## 📝 Environment Variables

Add these to your `.env` file:

```env
# OAuth2 Authentication
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
```

## 🔍 Troubleshooting

### Common Issues:

1. **OAuth buttons not showing**:
   - Check that credentials are set in `.env`
   - Restart the server after adding credentials
   - Check browser console for errors

2. **"OAuth authentication failed"**:
   - Verify redirect URLs match in provider settings
   - Check credentials are correct
   - Ensure domain matches (localhost vs production)

3. **Account linking issues**:
   - Check if email already exists in system
   - Verify OAuth provider returns email address
   - Check database OAuth fields are created

### Debug Mode:
Set `NODE_ENV=development` for detailed OAuth error logging.

## 🎯 Production Deployment

For production deployment:

1. **Update Redirect URLs** in OAuth providers:
   - Google: `https://yourdomain.com/auth/google/callback`
   - Facebook: `https://yourdomain.com/auth/facebook/callback`

2. **Use Environment Variables** in production:
   - Never commit OAuth secrets to version control
   - Use your hosting platform's environment variable system

3. **Enable HTTPS** for OAuth callbacks in production

---

## 📞 Support

If you encounter issues with OAuth setup, check the console logs for detailed error messages. The system gracefully degrades when OAuth isn't configured - regular email/password registration still works.