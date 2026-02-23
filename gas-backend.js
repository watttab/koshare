/**
 * Ko Share — Google Apps Script Backend (v4.0)
 * 
 * SCALABILITY:
 * - Thumbnails stored in separate "Thumbnails" sheet
 * - API pagination for getCheckIns (page + limit)
 * - getThumbnail(id) endpoint for lazy loading
 * - CacheService for frequently accessed data
 * 
 * SECURITY:
 * - PIN-based login → session token (24h expiry)
 * - Token required for all write operations
 * - Rate limiting on login attempts
 * - Public read access preserved for sharing
 * 
 * Spreadsheet ID: 1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8
 */

var SPREADSHEET_ID = '1rn9lO6IMlSz_JR5AiA-Mzo0RFCbZUX4rJSBV3dm6Mq8';
var MASTER_KEY = 'KOSHARE_MASTER_2024_xKz';
var TOKEN_EXPIRY = 86400; // 24 hours in seconds
var MAX_LOGIN_ATTEMPTS = 10; // per hour

// ============ INITIALIZATION ============
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheets() {
  var ss = getSpreadsheet();

  var checkInsSheet = ss.getSheetByName('CheckIns');
  if (!checkInsSheet) {
    checkInsSheet = ss.insertSheet('CheckIns');
    checkInsSheet.appendRow(['id', 'locationName', 'latitude', 'longitude', 'timestamp', 'description']);
  }

  var thumbSheet = ss.getSheetByName('Thumbnails');
  if (!thumbSheet) {
    thumbSheet = ss.insertSheet('Thumbnails');
    thumbSheet.appendRow(['id', 'thumbnail']);
  }

  var statsSheet = ss.getSheetByName('Stats');
  if (!statsSheet) {
    statsSheet = ss.insertSheet('Stats');
    statsSheet.appendRow(['key', 'value']);
    statsSheet.appendRow(['visitCount', 0]);
  }

  return { checkInsSheet: checkInsSheet, thumbSheet: thumbSheet, statsSheet: statsSheet };
}

// ============ REQUEST HANDLER ============
function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  var params = e.parameter || {};
  var action = params.action || '';
  var result;

  try {
    // Actions that require login token
    var authActions = ['saveCheckIn', 'saveWithImage', 'deleteCheckIn'];
    if (authActions.indexOf(action) > -1) {
      var token = params.token || '';
      if (!verifyToken(token)) {
        return jsonResponse({ success: false, error: 'กรุณาเข้าสู่ระบบก่อน', code: 'AUTH_REQUIRED' });
      }
    }

    // Master key required for admin actions
    var adminActions = ['setPin'];
    if (adminActions.indexOf(action) > -1) {
      if ((params.masterKey || '') !== MASTER_KEY) {
        return jsonResponse({ success: false, error: 'Unauthorized' });
      }
    }

    switch (action) {
      // === PUBLIC (no auth) ===
      case 'getStats': result = getStats(); break;
      case 'incrementVisit': result = incrementVisitCount(); break;
      case 'getCheckIns': result = getCheckIns(params); break;
      case 'getThumbnail': result = getThumbnail(params.id); break;
      case 'login': result = login(params.pin); break;
      case 'verifyToken': result = doVerifyToken(params.token); break;

      // === AUTH REQUIRED ===
      case 'saveCheckIn': result = saveCheckIn(parseData(params, e)); break;
      case 'saveWithImage': result = saveWithImage(parseData(params, e)); break;
      case 'deleteCheckIn': result = deleteCheckIn(params.id); break;

      // === ADMIN ===
      case 'setPin': result = setPin(params.pin); break;

      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }

  return jsonResponse(result);
}

function parseData(params, e) {
  if (params.data) return JSON.parse(params.data);
  if (e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (x) { }
  }
  return params;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ AUTH: PIN LOGIN ============
function setPin(pin) {
  if (!pin || pin.length < 4 || pin.length > 6) {
    return { success: false, error: 'PIN must be 4-6 digits' };
  }
  var hashed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + '_KOSHARE_SALT');
  var hexHash = hashed.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  PropertiesService.getScriptProperties().setProperty('PIN_HASH', hexHash);
  return { success: true, message: 'PIN set successfully' };
}

function login(pin) {
  if (!pin) return { success: false, error: 'PIN required' };

  // Rate limiting
  var cache = CacheService.getScriptCache();
  var attemptsKey = 'login_attempts';
  var attempts = parseInt(cache.get(attemptsKey) || '0');
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    return { success: false, error: 'เข้าสู่ระบบผิดเกินกำหนด กรุณารอ 1 ชั่วโมง', code: 'RATE_LIMITED' };
  }

  // Check PIN
  var storedHash = PropertiesService.getScriptProperties().getProperty('PIN_HASH');
  if (!storedHash) {
    return { success: false, error: 'ยังไม่ได้ตั้ง PIN — ติดต่อผู้ดูแลระบบ', code: 'NO_PIN' };
  }

  var hashed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + '_KOSHARE_SALT');
  var hexHash = hashed.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');

  if (hexHash !== storedHash) {
    cache.put(attemptsKey, String(attempts + 1), 3600); // 1 hour
    return { success: false, error: 'PIN ไม่ถูกต้อง', code: 'WRONG_PIN' };
  }

  // Generate token
  var token = Utilities.getUuid();
  cache.put('token_' + token, 'valid', TOKEN_EXPIRY);

  // Reset attempts on success
  cache.remove(attemptsKey);

  return { success: true, data: { token: token, expiresIn: TOKEN_EXPIRY } };
}

function verifyToken(token) {
  if (!token) return false;
  var cache = CacheService.getScriptCache();
  return cache.get('token_' + token) === 'valid';
}

function doVerifyToken(token) {
  return { success: true, data: { valid: verifyToken(token) } };
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

// ============ CHECK-INS (paginated, no thumbnails) ============
function getCheckIns(params) {
  var sheets = ensureSheets();
  var data = sheets.checkInsSheet.getDataRange().getValues();
  var headers = data[0];
  var allRows = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      // Skip thumbnail/imageUrl columns — served via getThumbnail
      if (headers[j] === 'thumbnail' || headers[j] === 'imageUrl' || headers[j] === 'thumbnailUrl') continue;
      row[headers[j]] = data[i][j];
    }
    allRows.push(row);
  }

  // Reverse (newest first)
  allRows.reverse();

  var total = allRows.length;
  var page = parseInt(params.page) || 1;
  var limit = Math.min(parseInt(params.limit) || 20, 100); // max 100
  var start = (page - 1) * limit;
  var pageItems = allRows.slice(start, start + limit);

  return {
    success: true,
    data: pageItems,
    pagination: {
      page: page,
      limit: limit,
      total: total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

// ============ THUMBNAIL (single item) ============
function getThumbnail(id) {
  if (!id) return { success: false, error: 'ID required' };

  var sheets = ensureSheets();

  // Check Thumbnails sheet first (v4 storage)
  var thumbData = sheets.thumbSheet.getDataRange().getValues();
  for (var i = 1; i < thumbData.length; i++) {
    if (thumbData[i][0] === id && thumbData[i][1]) {
      return { success: true, data: { id: id, thumbnail: thumbData[i][1] } };
    }
  }

  // Fallback: check old CheckIns columns (backward compat with v2/v3 data)
  var ciData = sheets.checkInsSheet.getDataRange().getValues();
  var ciHeaders = ciData[0];
  for (var k = 1; k < ciData.length; k++) {
    if (ciData[k][0] === id) {
      for (var h = 0; h < ciHeaders.length; h++) {
        var colName = ciHeaders[h];
        if ((colName === 'thumbnail' || colName === 'imageUrl') && ciData[k][h]) {
          var val = String(ciData[k][h]);
          if (val.indexOf('data:image') === 0) {
            return { success: true, data: { id: id, thumbnail: val } };
          }
        }
      }
    }
  }

  return { success: true, data: { id: id, thumbnail: '' } };
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
    sanitize(data.description, 300)
  ]);

  return {
    success: true,
    data: { id: id, locationName: name, latitude: data.latitude, longitude: data.longitude, timestamp: ts }
  };
}

// ============ SAVE WITH IMAGE ============
function saveWithImage(data) {
  var name = sanitize(data.locationName, 100);
  if (!name) return { success: false, error: 'Name required' };

  var thumbnail = data.thumbnail || '';
  if (thumbnail.length > 70000) thumbnail = ''; // too large

  var sheets = ensureSheets();
  var id = Utilities.getUuid();
  var ts = new Date().toISOString();

  // Save text data to CheckIns
  sheets.checkInsSheet.appendRow([
    id, name,
    parseFloat(data.latitude) || 0,
    parseFloat(data.longitude) || 0,
    ts,
    sanitize(data.description, 300)
  ]);

  // Save thumbnail to separate Thumbnails sheet
  if (thumbnail) {
    sheets.thumbSheet.appendRow([id, thumbnail]);
  }

  return {
    success: true,
    data: {
      id: id, locationName: name,
      latitude: data.latitude, longitude: data.longitude,
      timestamp: ts, hasThumbnail: !!thumbnail
    }
  };
}

// ============ DELETE ============
function deleteCheckIn(id) {
  if (!id) return { success: false, error: 'ID required' };
  var sheets = ensureSheets();

  // Delete from CheckIns
  var data = sheets.checkInsSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheets.checkInsSheet.deleteRow(i + 1);
      break;
    }
  }

  // Delete from Thumbnails
  var thumbData = sheets.thumbSheet.getDataRange().getValues();
  for (var j = 1; j < thumbData.length; j++) {
    if (thumbData[j][0] === id) {
      sheets.thumbSheet.deleteRow(j + 1);
      break;
    }
  }

  return { success: true };
}

// ============ UTILITY ============
function sanitize(str, maxLen) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').replace(/[<>"']/g, '').trim().substring(0, maxLen || 200);
}
