# Quick Start Guide

## Getting Started in 5 Minutes

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env if needed (default values work for local testing)
```

### 3. Start the Application

**Terminal 1 - Start the web server:**
```bash
npm start
```

**Terminal 2 - Start the background worker:**
```bash
npm run worker
```

### 4. Access the Application
Open your browser to: http://localhost:3000

### 5. Generate a QR Code
1. Click "Generate QR Code" button
2. A QR code will appear with an upload URL
3. Share the QR code or URL with guests

### 6. Upload Photos (Guest Side)
1. Scan the QR code or visit the upload URL
2. Select or drag-and-drop photos/videos
3. Click "Upload Files"
4. See success confirmation

### 7. Monitor Uploads (Admin Side)
- View statistics on the admin page
- Refresh to see updated counts
- "Pending to Drive" shows files waiting to be uploaded to Google Drive

## Google Drive Setup (Optional)

The application works without Google Drive configured - files will be stored in the `uploads/` folder. To enable automatic Google Drive uploads:

### Option A: Service Account (Recommended)
1. Create a Google Cloud project
2. Enable Google Drive API
3. Create a Service Account
4. Download the JSON key
5. Add to `.env`:
```
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```
6. Share your Drive folder with the service account email

### Option B: OAuth2
1. Create OAuth2 credentials in Google Cloud Console
2. Download credentials.json
3. Update `.env`:
```
GOOGLE_CREDENTIALS_PATH=./credentials.json
GOOGLE_TOKEN_PATH=./token.json
```
4. Complete OAuth flow on first run

## Testing Locally

The application is fully functional without Google Drive credentials. Files will:
- ✅ Upload successfully to local temporary storage
- ✅ Be tracked in the token database
- ✅ Show in statistics
- ⚠️ Remain in `uploads/` folder (not transferred to Drive)

## Troubleshooting

**Port already in use:**
```bash
# Change PORT in .env
PORT=3001
```

**Can't upload files:**
- Check file size (max 50MB)
- Verify file type (images/videos only)
- Check browser console for errors

**Worker not uploading to Drive:**
- Verify Google credentials are configured
- Check worker logs for errors
- Ensure service account has Drive access

## Production Deployment

See README.md for detailed deployment instructions for:
- Heroku
- AWS
- Google Cloud Platform
- Other Node.js hosting platforms

## Support

For issues, please check:
1. Server logs (Terminal 1)
2. Worker logs (Terminal 2)
3. Browser console (F12)
4. README.md for full documentation
