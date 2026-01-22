const GoogleDriveUploader = require('./googleDrive');
const GCPBucketUploader = require('./gcpBucket');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const uploader = new GoogleDriveUploader();
const gcpUploader = new GCPBucketUploader();
const tokensFile = path.join(__dirname, 'tokens.json');
const tempDir = path.join(__dirname, 'temp');

// Create temp directory for downloads from bucket
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Interval in milliseconds (default: 5 minutes)
const PROCESS_INTERVAL = parseInt(process.env.PROCESS_INTERVAL) || 5 * 60 * 1000;

async function processUploads() {
  console.log(`[${new Date().toISOString()}] Checking for pending uploads...`);
  
  try {
    const result = await processFromBucketToDrive();
    console.log(`[${new Date().toISOString()}] Processed: ${result.processed}, Failed: ${result.failed}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing uploads:`, error.message);
  }
}

async function processFromBucketToDrive() {
  if (!uploader.drive) {
    console.warn('Google Drive not configured, skipping upload processing');
    return { processed: 0, failed: 0 };
  }

  if (!gcpUploader.bucket) {
    console.warn('GCP Bucket not configured, skipping upload processing');
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
      const folder = await uploader.createFolder(folderName);
      folderId = folder.id;
      console.log(`Created folder: ${folderName} (${folderId})`);
    }

    for (const [token, tokenData] of Object.entries(tokens)) {
      for (const upload of tokenData.uploads) {
        if (upload.uploadedToBucket && !upload.uploadedToDrive) {
          try {
            // Download from bucket to temp location
            const tempFilePath = path.join(tempDir, upload.filename);
            await gcpUploader.downloadFile(upload.filename, tempFilePath);
            
            // Upload to Google Drive
            await uploader.uploadFile(
              tempFilePath,
              upload.originalName,
              upload.mimetype,
              folderId
            );
            
            // Delete from bucket and temp file
            await gcpUploader.deleteFile(upload.filename);
            fs.unlinkSync(tempFilePath);
            
            upload.uploadedToDrive = true;
            upload.uploadedToDriveAt = new Date().toISOString();
            processed++;
            
            console.log(`Successfully processed: ${upload.originalName}`);
          } catch (error) {
            console.error(`Failed to process ${upload.originalName}:`, error.message);
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

async function startWorker() {
  console.log('Starting Google Drive upload worker with GCP bucket integration...');
  
  // Initialize Google Drive API and GCP bucket
  const driveInitialized = await uploader.initialize();
  const bucketInitialized = await gcpUploader.initialize();
  
  if (!driveInitialized) {
    console.warn('Google Drive API not initialized. Worker will run but Drive uploads will be skipped.');
  }
  
  if (!bucketInitialized) {
    console.warn('GCP Bucket not initialized. Worker will run but bucket processing will be skipped.');
  }
  
  // Process immediately on start
  await processUploads();
  
  // Then process at regular intervals
  setInterval(processUploads, PROCESS_INTERVAL);
  
  console.log(`Worker running, checking every ${PROCESS_INTERVAL / 1000} seconds`);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down worker...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down worker...');
  process.exit(0);
});

startWorker().catch(error => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
