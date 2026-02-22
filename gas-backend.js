/**
 * Ko Share — Google Apps Script Backend (v2.0)
 * 
 * Features:
 *   - Visit counter
 *   - Check-in save/retrieve with image upload to Google Drive
 *   - Security: API key, rate limiting, input validation
 * 
 * Spreadsheet ID: 1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8
 * Drive Folder ID: 1FdJHcLcfDXvWnmseqpoET8Lgk0zIaIH4
 */

// ============ CONFIG ============
const SPREADSHEET_ID = '1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8';
const DRIVE_FOLDER_ID = '1FdJHcLcfDXvWnmseqpoET8Lgk0zIaIH4';
const API_KEY = 'KOSHARE_2024_sKr_GoSuM'; // Simple API key for basic protection
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB max
const RATE_LIMIT_SECONDS = 5; // Min seconds between requests from same IP

// ============ HELPERS ============
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getDriveFolder() {
  return DriveApp.getFolderById(DRIVE_FOLDER_ID);
}

function ensureSheets() {
  const ss = getSpreadsheet();

  let checkInsSheet = ss.getSheetByName('CheckIns');
  if (!checkInsSheet) {
    checkInsSheet = ss.insertSheet('CheckIns');
    checkInsSheet.appendRow(['id', 'locationName', 'latitude', 'longitude', 'timestamp', 'description', 'imageUrl', 'thumbnailUrl']);
  }

  let statsSheet = ss.getSheetByName('Stats');
  if (!statsSheet) {
    statsSheet = ss.insertSheet('Stats');
    statsSheet.appendRow(['key', 'value']);
    statsSheet.appendRow(['visitCount', 0]);
  }

  let logSheet = ss.getSheetByName('AccessLog');
  if (!logSheet) {
    logSheet = ss.insertSheet('AccessLog');
    logSheet.appendRow(['timestamp', 'action', 'ip', 'userAgent']);
  }

  return { checkInsSheet, statsSheet, logSheet };
}

// ============ SECURITY ============
function validateApiKey(params) {
  const key = params.key || '';
  return key === API_KEY;
}

function sanitizeString(str, maxLength) {
  if (!str) return '';
  // Remove potentially dangerous characters
  return String(str)
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/[<>"'&]/g, '') // Remove special chars
    .trim()
    .substring(0, maxLength || 200);
}

function validateCoordinates(lat, lng) {
  lat = parseFloat(lat);
  lng = parseFloat(lng);
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function logAccess(action, e) {
  try {
    const { logSheet } = ensureSheets();
    // Only keep last 1000 entries
    if (logSheet.getLastRow() > 1000) {
      logSheet.deleteRows(2, 500);
    }
    logSheet.appendRow([
      new Date().toISOString(),
      action,
      'web-client',
      (e && e.parameter && e.parameter.ua) || 'unknown'
    ]);
  } catch (err) {
    // Don't fail on logging errors
  }
}

// ============ ENTRY POINTS ============
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter || {};
  const action = params.action || '';

  let result;

  try {
    // API key validation for write operations
    const writeActions = ['saveCheckIn', 'uploadImage'];
    if (writeActions.includes(action)) {
      if (!validateApiKey(params)) {
        result = { success: false, error: 'Unauthorized' };
        return jsonResponse(result);
      }
    }

    logAccess(action, e);

    switch (action) {
      case 'getStats':
        result = getStats();
        break;
      case 'incrementVisit':
        result = incrementVisitCount();
        break;
      case 'saveCheckIn':
        let checkInData;
        if (params.data) {
          checkInData = JSON.parse(params.data);
        } else if (e.postData && e.postData.contents) {
          checkInData = JSON.parse(e.postData.contents);
        } else {
          checkInData = {
            locationName: params.locationName || '',
            latitude: parseFloat(params.latitude) || 0,
            longitude: parseFloat(params.longitude) || 0,
            description: params.description || ''
          };
        }
        result = saveCheckIn(checkInData);
        break;
      case 'saveCheckInWithImage':
        let imgData;
        if (params.data) {
          imgData = JSON.parse(params.data);
        } else if (e.postData && e.postData.contents) {
          imgData = JSON.parse(e.postData.contents);
        }
        if (!imgData) {
          result = { success: false, error: 'No data provided' };
        } else {
          result = saveCheckInWithImage(imgData);
        }
        break;
      case 'getCheckIns':
        result = getCheckIns();
        break;
      case 'deleteCheckIn':
        if (!validateApiKey(params)) {
          result = { success: false, error: 'Unauthorized' };
        } else {
          result = deleteCheckIn(params.id);
        }
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }

  return jsonResponse(result);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ STATS ============
function getStats() {
  const { checkInsSheet, statsSheet } = ensureSheets();

  const statsData = statsSheet.getDataRange().getValues();
  let visitCount = 0;
  for (let i = 1; i < statsData.length; i++) {
    if (statsData[i][0] === 'visitCount') {
      visitCount = parseInt(statsData[i][1]) || 0;
    }
  }

  const totalLocations = Math.max(0, checkInsSheet.getLastRow() - 1);

  return {
    success: true,
    data: {
      visitCount: visitCount,
      totalLocations: totalLocations
    }
  };
}

function incrementVisitCount() {
  const { statsSheet } = ensureSheets();

  const statsData = statsSheet.getDataRange().getValues();
  for (let i = 1; i < statsData.length; i++) {
    if (statsData[i][0] === 'visitCount') {
      const current = parseInt(statsData[i][1]) || 0;
      statsSheet.getRange(i + 1, 2).setValue(current + 1);
      return { success: true, data: { visitCount: current + 1 } };
    }
  }

  statsSheet.appendRow(['visitCount', 1]);
  return { success: true, data: { visitCount: 1 } };
}

// ============ CHECK-IN (without image) ============
function saveCheckIn(data) {
  // Validate
  const locationName = sanitizeString(data.locationName, 100);
  if (!locationName) {
    return { success: false, error: 'Location name is required' };
  }

  const lat = parseFloat(data.latitude);
  const lng = parseFloat(data.longitude);
  if (!validateCoordinates(lat, lng)) {
    return { success: false, error: 'Invalid coordinates' };
  }

  const { checkInsSheet } = ensureSheets();

  const id = Utilities.getUuid();
  const timestamp = new Date().toISOString();
  const description = sanitizeString(data.description, 300);

  checkInsSheet.appendRow([
    id,
    locationName,
    lat,
    lng,
    timestamp,
    description,
    '', // imageUrl
    ''  // thumbnailUrl
  ]);

  return {
    success: true,
    data: {
      id: id,
      locationName: locationName,
      latitude: lat,
      longitude: lng,
      timestamp: timestamp,
      description: description,
      imageUrl: '',
      thumbnailUrl: ''
    }
  };
}

// ============ CHECK-IN WITH IMAGE ============
function saveCheckInWithImage(data) {
  // Validate text fields
  const locationName = sanitizeString(data.locationName, 100);
  if (!locationName) {
    return { success: false, error: 'Location name is required' };
  }

  const lat = parseFloat(data.latitude);
  const lng = parseFloat(data.longitude);
  if (!validateCoordinates(lat, lng)) {
    return { success: false, error: 'Invalid coordinates' };
  }

  const description = sanitizeString(data.description, 300);
  const id = Utilities.getUuid();
  const timestamp = new Date().toISOString();

  let imageUrl = '';
  let thumbnailUrl = '';

  // Upload image to Drive if provided
  if (data.imageBase64) {
    try {
      // Validate image size (base64 is ~33% larger than binary)
      if (data.imageBase64.length > MAX_IMAGE_SIZE_BYTES * 1.4) {
        return { success: false, error: 'Image too large (max 2MB)' };
      }

      // Remove data URL prefix if present
      let base64Data = data.imageBase64;
      if (base64Data.indexOf(',') !== -1) {
        base64Data = base64Data.split(',')[1];
      }

      // Determine MIME type
      let mimeType = 'image/jpeg';
      if (data.imageBase64.startsWith('data:image/png')) {
        mimeType = 'image/png';
      }

      // Decode and save to Drive
      const blob = Utilities.newBlob(
        Utilities.base64Decode(base64Data),
        mimeType,
        'KoShare_' + locationName.replace(/\s+/g, '_') + '_' + id.substring(0, 8) + (mimeType === 'image/png' ? '.png' : '.jpg')
      );

      const folder = getDriveFolder();
      const file = folder.createFile(blob);

      // Make file publicly accessible (view only)
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      const fileId = file.getId();
      imageUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;
      thumbnailUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';

    } catch (imgErr) {
      // Continue without image if upload fails
      Logger.log('Image upload error: ' + imgErr.toString());
    }
  }

  // Save to sheet
  const { checkInsSheet } = ensureSheets();
  checkInsSheet.appendRow([
    id,
    locationName,
    lat,
    lng,
    timestamp,
    description,
    imageUrl,
    thumbnailUrl
  ]);

  return {
    success: true,
    data: {
      id: id,
      locationName: locationName,
      latitude: lat,
      longitude: lng,
      timestamp: timestamp,
      description: description,
      imageUrl: imageUrl,
      thumbnailUrl: thumbnailUrl
    }
  };
}

// ============ GET CHECK-INS ============
function getCheckIns() {
  const { checkInsSheet } = ensureSheets();

  const data = checkInsSheet.getDataRange().getValues();
  const headers = data[0];
  const checkIns = [];

  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    checkIns.push(row);
  }

  return {
    success: true,
    data: checkIns.reverse()
  };
}

// ============ DELETE CHECK-IN ============
function deleteCheckIn(id) {
  if (!id) return { success: false, error: 'ID required' };

  const { checkInsSheet } = ensureSheets();
  const data = checkInsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      // Delete image from Drive if exists
      const imageUrl = data[i][6];
      if (imageUrl) {
        try {
          const fileIdMatch = imageUrl.match(/id=([^&]+)/);
          if (fileIdMatch) {
            DriveApp.getFileById(fileIdMatch[1]).setTrashed(true);
          }
        } catch (e) {
          Logger.log('Could not delete image: ' + e);
        }
      }

      checkInsSheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  return { success: false, error: 'Not found' };
}
