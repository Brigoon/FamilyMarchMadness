/**
 * Google Apps Script — March Madness Bracket Storage
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project
 * 2. Replace the contents of Code.gs with this entire file
 * 3. Click Deploy → New deployment
 * 4. Choose "Web app" as the type
 * 5. Set "Execute as" to your Google account
 * 6. Set "Who has access" to "Anyone"
 * 7. Click Deploy and copy the web app URL
 * 8. Paste the URL into config.js in your bracket site
 *
 * This script stores bracket submissions in a Google Sheet.
 * Each submission is stored as a row: [timestamp, submitter name, JSON data].
 * Updating a bracket (same name) overwrites the previous entry.
 */

/** Name of the sheet tab to use */
const SHEET_NAME = 'Brackets';

/**
 * Get or create the spreadsheet and sheet.
 * On first run, creates a new spreadsheet and logs its URL.
 */
function getSheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SPREADSHEET_ID');

  if (!ssId) {
    const ss = SpreadsheetApp.create('March Madness Brackets');
    ssId = ss.getId();
    props.setProperty('SPREADSHEET_ID', ssId);
    Logger.log('Created spreadsheet: ' + ss.getUrl());

    const sheet = ss.getActiveSheet();
    sheet.setName(SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Submitter', 'Picks JSON']);
    sheet.setFrozenRows(1);
  }

  const ss = SpreadsheetApp.openById(ssId);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Submitter', 'Picks JSON']);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Handle POST requests — save or update a bracket submission.
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const name = (data.submitter || '').trim();

    if (!name) {
      return jsonResponse({ success: false, error: 'Missing submitter name' });
    }

    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues();

    // Check if this submitter already has an entry (case-insensitive match)
    let existingRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1].toLowerCase() === name.toLowerCase()) {
        existingRow = i + 1; // Sheet rows are 1-indexed
        break;
      }
    }

    const jsonStr = JSON.stringify(data);
    const timestamp = new Date().toISOString();

    if (existingRow > 0) {
      // Update existing entry
      sheet.getRange(existingRow, 1, 1, 3).setValues([[timestamp, name, jsonStr]]);
    } else {
      // Append new entry
      sheet.appendRow([timestamp, name, jsonStr]);
    }

    return jsonResponse({ success: true, message: `Bracket saved for ${name}` });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * Handle GET requests — return all brackets as JSON.
 */
function doGet(e) {
  try {
    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues();
    const brackets = [];

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      try {
        const picks = JSON.parse(rows[i][2]);
        brackets.push(picks);
      } catch (parseErr) {
        // Skip malformed rows
      }
    }

    return jsonResponse(brackets);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

/**
 * Return a JSON response with CORS headers.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
