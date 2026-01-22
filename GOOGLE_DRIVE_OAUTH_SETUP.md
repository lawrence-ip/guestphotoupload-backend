# Google Drive OAuth Integration Guide

## Overview
Your Guest Photo Upload app now uses OAuth2 for seamless Google Drive integration instead of requiring manual credentials.json upload. This provides a much simpler one-click experience for users.

## How It Works

### For Users (Event Organizers)
1. **Login/Register**: Users sign in with Google or Facebook OAuth
2. **Connect Google Drive**: Click "Connect Google Drive" button on dashboard
3. **Automatic Setup**: The system automatically:
   - Requests Google Drive permissions
   - Creates a "GuestStory" folder in their Google Drive
   - Stores auth tokens securely in the database
4. **Upload Ready**: All guest uploads are automatically saved to the GuestStory folder

### For Guests
1. **Scan QR Code**: Access the personalized welcome page
2. **Upload Photos**: Files are directly uploaded to the organizer's Google Drive
3. **Error Handling**: If Drive isn't connected, guests see a helpful message

## Technical Implementation

### Database Changes
- Added `google_drive_tokens` table to store OAuth tokens per user
- Methods for token management: save, get, update, remove tokens

### OAuth Flow
1. **Google OAuth Strategy**: Updated to include Drive scope (`https://www.googleapis.com/auth/drive.file`)
2. **Token Storage**: Access and refresh tokens saved to database during OAuth callback
3. **Token Refresh**: Automatic token refresh when expired using refresh tokens

### Google Drive Service
- **User-Specific Initialization**: Each user's Drive access uses their stored tokens
- **GuestStory Folder**: Automatically created/found for each user
- **Upload Method**: `uploadToGuestStory()` handles folder creation and file upload

### API Endpoints
- `GET /api/drive/status` - Check user's Google Drive connection status
- `GET /api/drive/reconnect` - Force re-authentication for expired tokens
- `POST /api/upload/:token` - Updated to use Google Drive instead of GCP

### Dashboard Integration
- **Connection Status**: Shows connected/not connected/expired states
- **One-Click Connect**: Button redirects to Google OAuth with Drive scopes
- **Visual Feedback**: Clear status indicators and action buttons

## Setup Requirements

### Environment Variables
```env
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

### Google Cloud Console Setup
1. **Create OAuth2 Credentials**:
   - Go to Google Cloud Console
   - Enable Google Drive API
   - Create OAuth 2.0 Client ID (Web Application)
   - Add authorized redirect URIs: `http://localhost:3000/auth/google/callback`

2. **Scopes Required**:
   - `profile` - Basic profile info
   - `email` - User email
   - `https://www.googleapis.com/auth/drive.file` - Drive file access

## User Experience Flow

### Event Organizer Setup
1. **Register/Login** → OAuth with Google/Facebook
2. **Dashboard Access** → See Google Drive status
3. **Connect Drive** → One-click OAuth authorization
4. **Create QR Code** → Generate event-specific upload links
5. **Share with Guests** → QR codes work immediately

### Guest Upload Experience
1. **Scan QR Code** → Access welcome page with event name
2. **Upload Photos** → Drag/drop or select files
3. **Automatic Storage** → Files saved to organizer's GuestStory folder
4. **Success Confirmation** → Upload completion message

## Error Handling

### For Organizers
- **Not Connected**: Clear call-to-action to connect Google Drive
- **Expired Tokens**: Automatic detection with reconnect option
- **API Errors**: Graceful fallback with helpful error messages

### For Guests
- **Drive Not Connected**: Informative message directing them to contact organizer
- **Upload Failures**: Detailed error messages with retry options
- **Token Expired**: Transparent handling with auto-refresh

## Security Features

### Token Management
- **Secure Storage**: Tokens encrypted in database
- **Automatic Refresh**: Expired tokens refreshed automatically
- **Scope Limitation**: Only file creation permissions requested

### Access Control
- **User-Specific**: Each user's tokens are isolated
- **Folder Isolation**: Files only go to user's GuestStory folder
- **Session Management**: Proper authentication required

## Benefits Over Previous System

### For Users
- **No Manual Setup**: No credentials.json files to manage
- **One-Click Experience**: Simple OAuth flow
- **Automatic Management**: Folder creation and token refresh
- **Better Security**: No credentials stored on user devices

### For Developers
- **Simplified Architecture**: No file upload/download for credentials
- **Better Error Handling**: Clear OAuth error states
- **Scalable**: Supports multiple users without conflicts
- **Maintainable**: Standard OAuth patterns

## Migration Notes
- Old credentials.json approach is replaced
- Database automatically creates new token table
- Existing users need to re-authenticate with new OAuth flow
- Previous GCP bucket functionality remains as fallback

## Testing
1. **Start Server**: `npm start`
2. **Open Dashboard**: `http://localhost:3000`
3. **Test OAuth Flow**: Use real Google credentials or test with development keys
4. **Create QR Code**: Generate test upload link
5. **Test Guest Upload**: Use QR code to test upload flow

This implementation provides a production-ready, user-friendly Google Drive integration that scales well and requires minimal setup from users.