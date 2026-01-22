const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class GCPBucketUploader {
  constructor() {
    this.storage = null;
    this.bucket = null;
    this.bucketName = process.env.GCP_BUCKET_NAME || 'guest-uploads-temp';
  }

  /**
   * Initialize Google Cloud Storage with OAuth
   */
  async initialize() {
    try {
      // Only use OAuth2 credentials
      if (process.env.GOOGLE_CREDENTIALS_PATH) {
        this.storage = new Storage({
          keyFilename: process.env.GOOGLE_CREDENTIALS_PATH
        });
      } else {
        console.warn('Google Cloud Storage OAuth credentials not configured.');
        return false;
      }
      
      this.bucket = this.storage.bucket(this.bucketName);
      
      // Check if bucket exists, create if it doesn't
      const [exists] = await this.bucket.exists();
      if (!exists) {
        await this.createBucket();
      }
      
      console.log(`Google Cloud Storage initialized with bucket: ${this.bucketName}`);
      return true;
    } catch (error) {
      console.error('Failed to initialize Google Cloud Storage:', error.message);
      return false;
    }
  }

  /**
   * Create the bucket if it doesn't exist
   */
  async createBucket() {
    try {
      const [bucket] = await this.storage.createBucket(this.bucketName, {
        location: process.env.GCP_BUCKET_LOCATION || 'US',
        storageClass: 'STANDARD',
        lifecycle: {
          rule: [
            {
              action: { type: 'Delete' },
              condition: { age: 7 } // Delete files older than 7 days
            }
          ]
        }
      });
      
      console.log(`Bucket ${this.bucketName} created successfully`);
      return bucket;
    } catch (error) {
      console.error('Error creating bucket:', error.message);
      throw error;
    }
  }

  /**
   * Upload a file to the bucket
   */
  async uploadFile(localFilePath, fileName) {
    if (!this.bucket) {
      throw new Error('Google Cloud Storage not initialized');
    }

    try {
      const file = this.bucket.file(fileName);
      
      await file.save(fs.readFileSync(localFilePath), {
        metadata: {
          contentType: this.getMimeType(fileName)
        }
      });

      console.log(`File uploaded to bucket: ${fileName}`);
      return {
        name: fileName,
        bucket: this.bucketName
      };
    } catch (error) {
      console.error('Error uploading file to bucket:', error.message);
      throw error;
    }
  }

  /**
   * Download a file from the bucket
   */
  async downloadFile(fileName, localPath) {
    if (!this.bucket) {
      throw new Error('Google Cloud Storage not initialized');
    }

    try {
      const file = this.bucket.file(fileName);
      await file.download({ destination: localPath });
      
      console.log(`File downloaded from bucket: ${fileName}`);
      return localPath;
    } catch (error) {
      console.error('Error downloading file from bucket:', error.message);
      throw error;
    }
  }

  /**
   * Delete a file from the bucket
   */
  async deleteFile(fileName) {
    if (!this.bucket) {
      throw new Error('Google Cloud Storage not initialized');
    }

    try {
      const file = this.bucket.file(fileName);
      await file.delete();
      
      console.log(`File deleted from bucket: ${fileName}`);
    } catch (error) {
      console.error('Error deleting file from bucket:', error.message);
      throw error;
    }
  }

  /**
   * List files in the bucket that need to be processed
   */
  async listPendingFiles() {
    if (!this.bucket) {
      throw new Error('Google Cloud Storage not initialized');
    }

    try {
      const [files] = await this.bucket.getFiles();
      return files.map(file => ({
        name: file.name,
        created: file.metadata.timeCreated,
        size: file.metadata.size
      }));
    } catch (error) {
      console.error('Error listing files in bucket:', error.message);
      throw error;
    }
  }

  /**
   * Get MIME type based on file extension
   */
  getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

module.exports = GCPBucketUploader;