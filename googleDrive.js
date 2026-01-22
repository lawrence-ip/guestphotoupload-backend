const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class GoogleDriveUploader {
  constructor(database = null) {
    this.auth = null;
    this.drive = null;
    this.db = database;
  }

  /**
   * Initialize Google Drive API with OAuth2 tokens from database
   */
  async initializeForUser(userId) {
    try {
      if (!this.db) {
        throw new Error('Database instance not provided');
      }

      // Get user's Google Drive tokens from database
      const tokens = await this.db.getGoogleDriveTokens(userId);
      if (!tokens) {
        throw new Error('User has not connected to Google Drive');
      }

      // Check if token is expired
      const now = new Date();
      const expiresAt = new Date(tokens.expires_at);
      
      if (now >= expiresAt && tokens.refresh_token) {
        // Refresh the token
        await this.refreshAccessToken(userId, tokens.refresh_token);
        // Get updated tokens
        const refreshedTokens = await this.db.getGoogleDriveTokens(userId);
        tokens.access_token = refreshedTokens.access_token;
        tokens.expires_at = refreshedTokens.expires_at;
      }

      // Create OAuth2 client
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      oAuth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      });
      
      this.auth = oAuth2Client;
      this.drive = google.drive({ version: 'v3', auth: this.auth });
      
      console.log(`Google Drive API initialized for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Failed to initialize Google Drive API:', error.message);
      return false;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(userId, refreshToken) {
    try {
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      oAuth2Client.setCredentials({
        refresh_token: refreshToken
      });
      
      const { credentials } = await oAuth2Client.refreshAccessToken();
      const expiresAt = new Date(Date.now() + (credentials.expiry_date - Date.now())).toISOString();
      
      await this.db.updateGoogleDriveToken(userId, credentials.access_token, expiresAt);
      
      console.log('Access token refreshed successfully');
      return true;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      return false;
    }
  }

  /**
   * Find or create the GuestStory folder in Google Drive
   */
  async findOrCreateGuestStoryFolder() {
    if (!this.drive) {
      throw new Error('Google Drive API not initialized');
    }

    try {
      const folderName = 'GuestStory';
      
      // Search for existing GuestStory folder
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
      });

      if (response.data.files.length > 0) {
        console.log(`Found existing GuestStory folder: ${response.data.files[0].id}`);
        return response.data.files[0].id;
      }

      // Create new GuestStory folder if it doesn't exist
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };

      const folder = await this.drive.files.create({
        resource: folderMetadata,
        fields: 'id, name'
      });

      console.log(`Created GuestStory folder: ${folder.data.id}`);
      return folder.data.id;
    } catch (error) {
      console.error('Error finding/creating GuestStory folder:', error);
      throw error;
    }
  }

  /**
   * Upload a file to the GuestStory folder in Google Drive
   */
  async uploadToGuestStory(filePath, fileName, mimeType) {
    if (!this.drive) {
      throw new Error('Google Drive API not initialized');
    }

    try {
      // Get or create GuestStory folder
      const guestStoryFolderId = await this.findOrCreateGuestStoryFolder();
      
      // Upload file to GuestStory folder
      return await this.uploadFile(filePath, fileName, mimeType, guestStoryFolderId);
    } catch (error) {
      console.error('Error uploading to GuestStory:', error);
      throw error;
    }
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(filePath, fileName, mimeType, folderId = null) {
    if (!this.drive) {
      throw new Error('Google Drive API not initialized');
    }

    try {
      const fileMetadata = {
        name: fileName,
        ...(folderId && { parents: [folderId] })
      };

      const media = {
        mimeType: mimeType,
        body: fs.createReadStream(filePath)
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink'
      });

      console.log(`File uploaded: ${fileName} (ID: ${response.data.id})`);
      return response.data;
    } catch (error) {
      console.error('Error uploading file to Google Drive:', error.message);
      throw error;
    }
  }

  /**
   * Create a folder in Google Drive
   */
  async createFolder(folderName, parentFolderId = null) {
    if (!this.drive) {
      throw new Error('Google Drive API not initialized');
    }

    try {
      const fileMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentFolderId && { parents: [parentFolderId] })
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name'
      });

      console.log(`Folder created: ${folderName} (ID: ${response.data.id})`);
      return response.data;
    } catch (error) {
      console.error('Error creating folder:', error.message);
      throw error;
    }
  }

  /**
   * Process pending uploads from temporary storage to Google Drive
   */
  async processPendingUploads(tokensFile, uploadsDir) {
    if (!this.drive) {
      console.warn('Google Drive not configured, skipping upload processing');
      return { processed: 0, failed: 0 };
    }

    try {
      const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
      let processed = 0;
      let failed = 0;
      
      // Create a folder for guest uploads if needed
      const folderName = process.env.DRIVE_FOLDER_NAME || 'Guest Uploads';
      let folderId = process.env.DRIVE_FOLDER_ID;
      
      if (!folderId) {
        const folder = await this.createFolder(folderName);
        folderId = folder.id;
        console.log(`Created folder: ${folderName} (${folderId})`);
      }

      for (const [token, tokenData] of Object.entries(tokens)) {
        for (const upload of tokenData.uploads) {
          if (!upload.uploadedToDrive) {
            const filePath = path.join(uploadsDir, upload.filename);
            
            if (fs.existsSync(filePath)) {
              try {
                await this.uploadFile(
                  filePath,
                  upload.originalName,
                  upload.mimetype,
                  folderId
                );
                
                upload.uploadedToDrive = true;
                upload.uploadedToDriveAt = new Date().toISOString();
                processed++;
                
                // Delete local file after successful upload
                fs.unlinkSync(filePath);
                console.log(`Deleted local file: ${upload.filename}`);
              } catch (error) {
                console.error(`Failed to upload ${upload.originalName}:`, error.message);
                failed++;
              }
            } else {
              console.warn(`File not found: ${filePath}`);
              upload.uploadedToDrive = true; // Mark as processed to avoid retrying
              failed++;
            }
          }
        }
      }

      // Save updated token data
      fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
      
      console.log(`Processed ${processed} uploads, ${failed} failed`);
      return { processed, failed };
    } catch (error) {
      console.error('Error processing pending uploads:', error.message);
      throw error;
    }
  }
}

module.exports = GoogleDriveUploader;
