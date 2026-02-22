/**
 * Ko Share — Google Apps Script Backend (v2.1)
 * 
 * PROVEN WORKING via live API test.
 * GET requests work reliably. POST body is lost due to 302 redirect.
 * Solution: Save text data via GET, upload image separately.
 * 
 * Spreadsheet ID: 1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8
 * Drive Folder ID: 1FdJHcLcfDXvWnmseqpoET8Lgk0zIaIH4
 */

const SPREADSHEET_ID = '1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8';
const DRIVE_FOLDER_ID = '1FdJHcLcfDXvWnmseqpoET8Lgk0zIaIH4';
const API_KEY = 'KOSHARE_2024_sKr_GoSuM';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getDriveFolder() {
  return DriveApp.getFolderById(DRIVE_FOLDER_ID);
}

function ensureSheets() {
  var ss = getSpreadsheet();

  var checkInsSheet = ss.getSheetByName('CheckIns');
  if (!checkInsSheet) {
    checkInsSheet = ss.insertSheet('CheckIns');
    checkInsSheet.appendRow(['id', 'locationName', 'latitude', 'longitude', 'timestamp', 'description', 'imageUrl', 'thumbnailUrl']);
  }

  var statsSheet = ss.getSheetByName('Stats');
  if (!statsSheet) {
    statsSheet = ss.insertSheet('Stats');
    statsSheet.appendRow(['key', 'value']);
    statsSheet.appendRow(['visitCount', 0]);
  }

  return { checkInsSheet: checkInsSheet, statsSheet: statsSheet };
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var params = e.parameter || {};
  var action = params.action || '';
  var result;

  try {
    // API key check for write actions
    var writeActions = ['saveCheckIn', 'uploadImage', 'deleteCheckIn'];
    if (writeActions.indexOf(action) > -1) {
      if ((params.key || '') !== API_KEY) {
        return jsonResponse({ success: false, error: 'Unauthorized' });
      }
    }

    switch (action) {
      case 'getStats':
        result = getStats();
        break;

      case 'incrementVisit':
        result = incrementVisitCount();
        break;

      case 'saveCheckIn':
        var checkInData;
        if (params.data) {
          checkInData = JSON.parse(params.data);
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

      case 'uploadImage':
        // This action receives image data via POST body or GET param
        var imgPayload;
        if (e.postData && e.postData.contents) {
          imgPayload = JSON.parse(e.postData.contents);
        } else if (params.data) {
          imgPayload = JSON.parse(params.data);
        } else {
          imgPayload = { checkInId: params.checkInId || '', imageBase64: params.imageBase64 || '' };
        }
        result = uploadImage(imgPayload);
        break;

      case 'getCheckIns':
        result = getCheckIns();
        break;

      case 'deleteCheckIn':
        result = deleteCheckIn(params.id);
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
  var sheets = ensureSheets();
  var statsData = sheets.statsSheet.getDataRange().getValues();
  var visitCount = 0;

  for (var i = 1; i < statsData.length; i++) {
    if (statsData[i][0] === 'visitCount') {
      visitCount = parseInt(statsData[i][1]) || 0;
    }
  }

  var totalLocations = Math.max(0, sheets.checkInsSheet.getLastRow() - 1);

  return {
    success: true,
    data: { visitCount: visitCount, totalLocations: totalLocations }
  };
}

function incrementVisitCount() {
  var sheets = ensureSheets();
  var statsData = sheets.statsSheet.getDataRange().getValues();

  for (var i = 1; i < statsData.length; i++) {
    if (statsData[i][0] === 'visitCount') {
      var current = parseInt(statsData[i][1]) || 0;
      sheets.statsSheet.getRange(i + 1, 2).setValue(current + 1);
      return { success: true, data: { visitCount: current + 1 } };
    }
  }

  sheets.statsSheet.appendRow(['visitCount', 1]);
  return { success: true, data: { visitCount: 1 } };
}

// ============ SAVE CHECK-IN (text data only, via GET) ============
function saveCheckIn(data) {
  var locationName = sanitize(data.locationName, 100);
  if (!locationName) {
    return { success: false, error: 'Location name required' };
  }

  var lat = parseFloat(data.latitude) || 0;
  var lng = parseFloat(data.longitude) || 0;

  var sheets = ensureSheets();
  var id = Utilities.getUuid();
  var timestamp = new Date().toISOString();
  var description = sanitize(data.description, 300);

  sheets.checkInsSheet.appendRow([id, locationName, lat, lng, timestamp, description, '', '']);

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

// ============ UPLOAD IMAGE (separate action) ============
function uploadImage(payload) {
  var checkInId = payload.checkInId || '';
  var imageBase64 = payload.imageBase64 || '';
  var locationName = payload.locationName || 'image';

  if (!imageBase64) {
    return { success: false, error: 'No image data' };
  }

  // Remove data URL prefix if present
  var base64Data = imageBase64;
  if (base64Data.indexOf(',') !== -1) {
    base64Data = base64Data.split(',')[1];
  }

  var mimeType = 'image/jpeg';
  if (imageBase64.indexOf('data:image/png') === 0) {
    mimeType = 'image/png';
  }

  try {
    var blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      mimeType,
      'KoShare_' + sanitize(locationName, 30).replace(/\s+/g, '_') + '_' + (checkInId ? checkInId.substring(0, 8) : Date.now()) + '.jpg'
    );

    var folder = getDriveFolder();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var imageUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;
    var thumbnailUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';

    // Update the check-in row with image URLs if checkInId provided
    if (checkInId) {
      var sheets = ensureSheets();
      var data = sheets.checkInsSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === checkInId) {
          sheets.checkInsSheet.getRange(i + 1, 7).setValue(imageUrl);
          sheets.checkInsSheet.getRange(i + 1, 8).setValue(thumbnailUrl);
          break;
        }
      }
    }

    return {
      success: true,
      data: { imageUrl: imageUrl, thumbnailUrl: thumbnailUrl, fileId: fileId }
    };
  } catch (err) {
    return { success: false, error: 'Image upload failed: ' + err.toString() };
  }
}

// ============ GET CHECK-INS ============
function getCheckIns() {
  var sheets = ensureSheets();
  var data = sheets.checkInsSheet.getDataRange().getValues();
  var headers = data[0];
  var checkIns = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    checkIns.push(row);
  }

  return { success: true, data: checkIns.reverse() };
}

// ============ DELETE CHECK-IN ============
function deleteCheckIn(id) {
  if (!id) return { success: false, error: 'ID required' };

  var sheets = ensureSheets();
  var data = sheets.checkInsSheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      // Try to delete image from Drive
      var imageUrl = data[i][6];
      if (imageUrl) {
        try {
          var match = imageUrl.match(/id=([^&]+)/);
          if (match) DriveApp.getFileById(match[1]).setTrashed(true);
        } catch (e) { }
      }
      sheets.checkInsSheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
}

// ============ UTILITY ============
function sanitize(str, maxLen) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').replace(/[<>"']/g, '').trim().substring(0, maxLen || 200);
}
