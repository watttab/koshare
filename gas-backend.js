/**
 * Ko Share — Google Apps Script Backend
 * 
 * Deploy this code to Google Apps Script.
 * Spreadsheet ID: 1hocv8Wg9c3Hr8YXuRuRGB6V_9GkkLQEZjEhUhNvgmfY
 * 
 * Sheets Structure:
 *   - "CheckIns": id | locationName | latitude | longitude | timestamp | description
 *   - "Stats": key | value
 */

const SPREADSHEET_ID = '1hocv8Wg9c3Hr8YXuRuRGB6V_9GkkLQEZjEhUhNvgmfY';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheets() {
  const ss = getSpreadsheet();
  
  let checkInsSheet = ss.getSheetByName('CheckIns');
  if (!checkInsSheet) {
    checkInsSheet = ss.insertSheet('CheckIns');
    checkInsSheet.appendRow(['id', 'locationName', 'latitude', 'longitude', 'timestamp', 'description']);
  }
  
  let statsSheet = ss.getSheetByName('Stats');
  if (!statsSheet) {
    statsSheet = ss.insertSheet('Stats');
    statsSheet.appendRow(['key', 'value']);
    statsSheet.appendRow(['visitCount', 0]);
  }
  
  return { checkInsSheet, statsSheet };
}

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
    switch (action) {
      case 'getStats':
        result = getStats();
        break;
      case 'incrementVisit':
        result = incrementVisitCount();
        break;
      case 'saveCheckIn':
        const postData = JSON.parse(e.postData.contents);
        result = saveCheckIn(postData);
        break;
      case 'getCheckIns':
        result = getCheckIns();
        break;
      default:
        result = { success: false, error: 'Unknown action' };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

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

function saveCheckIn(data) {
  const { checkInsSheet } = ensureSheets();
  
  const id = Utilities.getUuid();
  const timestamp = new Date().toISOString();
  
  checkInsSheet.appendRow([
    id,
    data.locationName || '',
    data.latitude || 0,
    data.longitude || 0,
    timestamp,
    data.description || ''
  ]);
  
  return {
    success: true,
    data: {
      id: id,
      locationName: data.locationName,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: timestamp,
      description: data.description || ''
    }
  };
}

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
