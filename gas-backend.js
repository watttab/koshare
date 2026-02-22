/**
 * Ko Share — Google Apps Script Backend (v3.0)
 * 
 * Image storage: Base64 thumbnail stored directly in Google Sheets
 * No Google Drive needed — simpler & more reliable
 * 
 * Spreadsheet ID: 1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8
 */

var SPREADSHEET_ID = '1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8';
var API_KEY = 'KOSHARE_2024_sKr_GoSuM';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheets() {
  var ss = getSpreadsheet();

  var checkInsSheet = ss.getSheetByName('CheckIns');
  if (!checkInsSheet) {
    checkInsSheet = ss.insertSheet('CheckIns');
    checkInsSheet.appendRow(['id', 'locationName', 'latitude', 'longitude', 'timestamp', 'description', 'thumbnail']);
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
    // API key for write ops
    if (['saveCheckIn', 'saveWithImage', 'deleteCheckIn'].indexOf(action) > -1) {
      if ((params.key || '') !== API_KEY) {
        return jsonResponse({ success: false, error: 'Unauthorized' });
      }
    }

    switch (action) {
      case 'incrementVisit':
        result = incrementVisitCount();
        break;

      case 'getStats':
        result = getStats();
        break;

      case 'saveCheckIn':
        var data1;
        if (params.data) {
          data1 = JSON.parse(params.data);
        } else {
          data1 = {
            locationName: params.locationName || '',
            latitude: parseFloat(params.latitude) || 0,
            longitude: parseFloat(params.longitude) || 0,
            description: params.description || ''
          };
        }
        result = saveCheckIn(data1);
        break;

      case 'saveWithImage':
        // Receives check-in data + small base64 thumbnail
        var data2;
        if (params.data) {
          data2 = JSON.parse(params.data);
        } else if (e.postData && e.postData.contents) {
          try {
            data2 = JSON.parse(e.postData.contents);
          } catch (pe) {
            // Form-encoded POST
            data2 = {
              locationName: params.locationName || '',
              latitude: parseFloat(params.latitude) || 0,
              longitude: parseFloat(params.longitude) || 0,
              description: params.description || '',
              thumbnail: params.thumbnail || ''
            };
          }
        }
        if (!data2) {
          result = { success: false, error: 'No data' };
        } else {
          result = saveWithImage(data2);
        }
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
  return { success: true, data: { visitCount: visitCount, totalLocations: totalLocations } };
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

// ============ SAVE CHECK-IN (text only) ============
function saveCheckIn(data) {
  var name = sanitize(data.locationName, 100);
  if (!name) return { success: false, error: 'Name required' };

  var sheets = ensureSheets();
  var id = Utilities.getUuid();
  var ts = new Date().toISOString();

  sheets.checkInsSheet.appendRow([
    id, name,
    parseFloat(data.latitude) || 0,
    parseFloat(data.longitude) || 0,
    ts,
    sanitize(data.description, 300),
    '' // no thumbnail
  ]);

  return {
    success: true,
    data: { id: id, locationName: name, latitude: data.latitude, longitude: data.longitude, timestamp: ts }
  };
}

// ============ SAVE WITH IMAGE (text + base64 thumbnail) ============
function saveWithImage(data) {
  var name = sanitize(data.locationName, 100);
  if (!name) return { success: false, error: 'Name required' };

  var thumbnail = data.thumbnail || '';
  // Validate thumbnail size (max ~50KB of base64)
  if (thumbnail.length > 70000) {
    thumbnail = ''; // Too large, skip
  }

  var sheets = ensureSheets();
  var id = Utilities.getUuid();
  var ts = new Date().toISOString();

  sheets.checkInsSheet.appendRow([
    id, name,
    parseFloat(data.latitude) || 0,
    parseFloat(data.longitude) || 0,
    ts,
    sanitize(data.description, 300),
    thumbnail
  ]);

  return {
    success: true,
    data: {
      id: id,
      locationName: name,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: ts,
      thumbnail: thumbnail ? 'saved' : ''
    }
  };
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

// ============ DELETE ============
function deleteCheckIn(id) {
  if (!id) return { success: false, error: 'ID required' };
  var sheets = ensureSheets();
  var data = sheets.checkInsSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
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
