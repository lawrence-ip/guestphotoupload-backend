# Enhanced QR Code & Token Management

This enhanced system provides secure tokenization and dynamic QR code generation with comprehensive management capabilities.

## 🔐 Secure Token Generation

### Features
- **Crypto-secure tokens**: Uses `crypto.randomBytes()` for token generation
- **HMAC signatures**: Tokens are signed to prevent tampering
- **Token validation**: Format and signature validation on all requests
- **Expiration handling**: Automatic token expiration and refresh capabilities

### Token Format
```
[64-char-hex-string].[16-char-signature]
```

Example: `a1b2c3d4e5f6...abcdef.1a2b3c4d5e6f7890`

## ⚡ Dynamic QR Code Generation

### Customization Options
```javascript
const qrOptions = {
  errorLevel: 'M',        // L, M, Q, H
  quality: 0.92,          // 0.0 - 1.0
  margin: 1,              // Border margin
  darkColor: '#000000',   // QR code color
  lightColor: '#FFFFFF',  // Background color
  width: 256              // Image width in pixels
};
```

### Multiple Formats
- **PNG**: Binary image format for downloads
- **SVG**: Vector format for scalable graphics
- **Data URLs**: Base64 encoded for direct embedding

## 📊 Analytics & Tracking

### Token Analytics
- **Access count**: Track QR code scans/access
- **Generation timestamps**: When QR codes were created
- **Upload statistics**: Files uploaded per token
- **Expiration tracking**: Active/expired status

## 🎯 API Endpoints

### Token Management

#### Create Token with QR Code
```http
POST /api/tokens
Content-Type: application/json
Authorization: Bearer [session]

{
  \"name\": \"Wedding Photos\",
  \"maxUploads\": 100,
  \"expiresIn\": 7,
  \"qrOptions\": {
    \"width\": 512,
    \"darkColor\": \"#2563eb\",
    \"lightColor\": \"#f8fafc\"
  }
}
```

Response:
```json
{
  \"success\": true,
  \"token\": \"a1b2c3d4e5f6789...abcdef.1a2b3c4d5e6f7890\",
  \"tokenId\": 123,
  \"url\": \"https://yourapp.com/upload/a1b2c3d4...\",
  \"qrCode\": \"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...\",
  \"name\": \"Wedding Photos\",
  \"maxUploads\": 100,
  \"expirationDate\": \"2024-01-30T10:00:00.000Z\",
  \"qrOptions\": {
    \"errorLevel\": \"M\",
    \"width\": 512,
    \"darkColor\": \"#2563eb\",
    \"lightColor\": \"#f8fafc\"
  }
}
```

#### Regenerate QR Code
```http
POST /api/tokens/123/regenerate-qr
Content-Type: application/json
Authorization: Bearer [session]

{
  \"qrOptions\": {
    \"width\": 1024,
    \"darkColor\": \"#059669\",
    \"margin\": 2
  }
}
```

#### Get QR Code Image
```http
GET /api/tokens/123/qr?format=png&width=512&download=true
```

```http
GET /api/tokens/123/qr?format=svg&download=false
```

#### Refresh Token Expiration
```http
POST /api/tokens/123/refresh
Content-Type: application/json
Authorization: Bearer [session]

{
  \"expiresIn\": 14
}
```

#### Get Token Analytics
```http
GET /api/tokens/123/analytics
Authorization: Bearer [session]
```

Response:
```json
{
  \"success\": true,
  \"analytics\": {
    \"tokenId\": 123,
    \"name\": \"Wedding Photos\",
    \"createdAt\": \"2024-01-23T10:00:00.000Z\",
    \"expiresAt\": \"2024-01-30T10:00:00.000Z\",
    \"totalUploads\": 45,
    \"maxUploads\": 100,
    \"accessCount\": 127,
    \"qrGeneratedAt\": \"2024-01-23T10:05:00.000Z\",
    \"isActive\": true,
    \"uploads\": [
      {
        \"id\": 1,
        \"filename\": \"IMG_001.jpg\",
        \"uploadedAt\": \"2024-01-23T11:00:00.000Z\",
        \"fileSize\": 2048576,
        \"uploaderName\": \"John Doe\"
      }
    ]
  }
}
```

### Upload with Enhanced Validation
```http
POST /api/upload/a1b2c3d4e5f6789...abcdef.1a2b3c4d5e6f7890
Content-Type: multipart/form-data

files: [file1.jpg, file2.jpg]
guestName: \"John Doe\"
guestMessage: \"Thanks for the great event!\"
```

## 💻 Frontend Integration

### QR Code Display
```javascript
// Create token with custom QR options
async function createTokenWithQR(eventName, maxUploads, qrOptions = {}) {
  const response = await fetch('/api/tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      name: eventName,
      maxUploads,
      expiresIn: 7,
      qrOptions: {
        width: 512,
        darkColor: '#2563eb',
        lightColor: '#f8fafc',
        margin: 2,
        errorLevel: 'H',
        ...qrOptions
      }
    })
  });
  
  const data = await response.json();
  if (data.success) {
    // Display QR code
    document.getElementById('qr-image').src = data.qrCode;
    document.getElementById('upload-url').textContent = data.url;
  }
}

// Regenerate QR code with new styling
async function regenerateQR(tokenId, newOptions) {
  const response = await fetch(`/api/tokens/${tokenId}/regenerate-qr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      qrOptions: newOptions
    })
  });
  
  const data = await response.json();
  if (data.success) {
    document.getElementById('qr-image').src = data.qrCode;
  }
}

// Download QR code in different formats
function downloadQR(tokenId, format = 'png') {
  const link = document.createElement('a');
  link.href = `/api/tokens/${tokenId}/qr?format=${format}&download=true`;
  link.download = `qr-code.${format}`;
  link.click();
}
```

### Token Analytics Dashboard
```javascript
async function loadTokenAnalytics(tokenId) {
  const response = await fetch(`/api/tokens/${tokenId}/analytics`, {
    credentials: 'include'
  });
  
  const data = await response.json();
  if (data.success) {
    const analytics = data.analytics;
    
    // Update dashboard
    document.getElementById('total-uploads').textContent = analytics.totalUploads;
    document.getElementById('max-uploads').textContent = analytics.maxUploads;
    document.getElementById('access-count').textContent = analytics.accessCount;
    document.getElementById('status').textContent = analytics.isActive ? 'Active' : 'Expired';
    
    // Progress bar
    const progress = (analytics.totalUploads / analytics.maxUploads) * 100;
    document.getElementById('upload-progress').style.width = `${progress}%`;
    
    // Upload list
    const uploadsList = document.getElementById('uploads-list');
    uploadsList.innerHTML = analytics.uploads.map(upload => `
      <div class=\"upload-item\">
        <span>${upload.filename}</span>
        <span>${upload.uploaderName}</span>
        <span>${new Date(upload.uploadedAt).toLocaleDateString()}</span>
      </div>
    `).join('');
  }
}
```

## 🔧 Configuration

### Environment Variables
```bash
# Token security
TOKEN_SECRET=your-secure-token-secret-different-from-session-secret

# QR Code defaults
QR_DEFAULT_WIDTH=256
QR_DEFAULT_MARGIN=1
QR_DEFAULT_ERROR_LEVEL=M
```

### QR Code Error Correction Levels
- **L**: ~7% of codewords can be restored
- **M**: ~15% of codewords can be restored (default)
- **Q**: ~25% of codewords can be restored
- **H**: ~30% of codewords can be restored

## 🛡️ Security Features

### Token Validation
- Format validation (64-char hex + 16-char signature)
- HMAC signature verification
- Expiration checking
- User ownership verification

### Rate Limiting
- Upload endpoints are rate-limited
- QR generation has reasonable limits
- Access tracking for monitoring

### Access Control
- All token management requires authentication
- Users can only access their own tokens
- Analytics data is filtered per user

## 📈 Performance Optimizations

### Caching
- QR code generation metadata is cached
- Token validation results are optimized
- Analytics data is computed efficiently

### Database Optimization
- Indexed token lookups
- Efficient analytics queries
- Automatic cleanup of expired tokens

## 🚀 Production Deployment

### Prerequisites
```bash
# Ensure all dependencies are installed
npm install crypto
```

### Database Migration
The system automatically adds required columns:
- `qr_generated_at`: Timestamp of QR generation
- `qr_options`: JSON string of QR customization options
- `access_count`: Number of times QR was accessed
- `updated_at`: Last modification timestamp

### Monitoring
- Monitor QR generation frequency
- Track token usage patterns
- Set up alerts for high access counts
- Regular cleanup of expired tokens

## 🔍 Troubleshooting

### Common Issues

#### Invalid Token Format
```json
{
  \"error\": \"Invalid token format\"
}
```
- Check token length (should be 81 characters total)
- Verify format: `[64-hex].[16-hex]`

#### Token Signature Verification Failed
- Ensure `TOKEN_SECRET` is consistent
- Check for token tampering
- Verify HMAC implementation

#### QR Code Generation Failed
- Check QR options validity
- Verify URL accessibility
- Monitor memory usage for large QR codes

### Debug Mode
Enable debug logging:
```bash
DEBUG=qr,token npm start
```

This will log:
- Token generation and validation
- QR code creation parameters
- Analytics computation details
- Access patterns