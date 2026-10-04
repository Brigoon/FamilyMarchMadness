/**
 * Google Apps Script — Steve Madness Bracket Storage (guarded)
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project
 * 2. Replace the contents of Code.gs with this entire file
 * 3. Run the `setup` function once and authorize it. It creates the spreadsheet
 *    with three tabs: Brackets, Config and History.
 * 4. Open the spreadsheet (URL is logged by `setup`) and fill in the Config tab:
 *      Deadline         e.g. 2027-03-18T12:15:00-04:00   (ISO text with UTC offset)
 *      Family Passcode  any phrase you share with the family
 * 5. Click Deploy → New deployment → Web app
 *      Execute as: Me      Who has access: Anyone
 * 6. Paste the web app URL into config.js in your bracket site
 *
 * UPDATING AN EXISTING DEPLOYMENT: Deploy → Manage deployments → Edit (pencil)
 * → Version: New version → Deploy. The URL stays the same.
 *
 * RULES ENFORCED HERE (the browser cannot bypass them):
 *  - A submission needs the family passcode.
 *  - The first submission under a name claims it with a PIN; later edits need that PIN.
 *  - Submissions are rejected once the Deadline (server clock) has passed.
 *  - Other people's picks are hidden from GET until the Deadline has passed.
 *
 * MANUAL OVERRIDES: you own the spreadsheet, so edit it directly at any time.
 * To reset a forgotten PIN, clear the PinSalt and PinHash cells on that row;
 * the next submission with the passcode re-claims the name.
 */

const BRACKETS_SHEET = 'Brackets';
const CONFIG_SHEET = 'Config';
const HISTORY_SHEET = 'History';

const BRACKET_HEADERS = ['Timestamp', 'Submitter', 'Picks JSON', 'PinSalt', 'PinHash'];
const HISTORY_HEADERS = ['Timestamp', 'Submitter', 'Action', 'Picks JSON'];

const MAX_PAYLOAD_CHARS = 20000;
const MAX_NAME_CHARS = 50;
const MAX_TEAM_CHARS = 60;
const PIN_MIN = 4;
const PIN_MAX = 32;
const MAX_FAILURES = 10;
const MAX_GLOBAL_FAILURES = 30;
const FAILURE_WINDOW_SECONDS = 900;

const PUBLIC_CACHE_KEY = 'public-data';
const DEADLINE_CACHE_KEY = 'deadline';
const PUBLIC_CACHE_SECONDS = 60;
const MAX_CACHE_CHARS = 90000;

/** Expected pick counts and slot-id patterns per round. */
const ROUND_RULES = {
  roundOf64:    { count: 32, key: /^[A-Za-z]{2,20}_[1-8]$/ },
  roundOf32:    { count: 16, key: /^[A-Za-z]{2,20}_[1-4]$/ },
  sweetSixteen: { count: 8,  key: /^[A-Za-z]{2,20}_[1-2]$/ },
  eliteEight:   { count: 4,  key: /^[A-Za-z]{2,20}$/ },
  finalFour:    { count: 2,  key: /^FF_[1-2]$/ },
};
const OPENING_ROUND_KEY = /^OR\d{1,2}$/;
const OPENING_ROUND_MAX = 16;

// ─── SHEET ACCESS ────────────────────────────────────────────────────────────

function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SPREADSHEET_ID');
  if (!ssId) {
    const ss = SpreadsheetApp.create('Steve Madness Brackets');
    props.setProperty('SPREADSHEET_ID', ss.getId());
    Logger.log('Created spreadsheet: ' + ss.getUrl());
    return ss;
  }
  return SpreadsheetApp.openById(ssId);
}

/** Get a tab by name, creating it with a header row if missing. */
function getTab(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    // A brand-new spreadsheet has an empty default tab; reuse it for the first tab we need.
    const sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0 && sheets[0].getName() !== name) {
      sheet = sheets[0];
      sheet.setName(name);
    } else {
      sheet = ss.insertSheet(name);
    }
  }
  if (headers) {
    const range = sheet.getRange(1, 1, 1, headers.length);
    if (range.getValues()[0].join('|') !== headers.join('|')) {
      range.setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function getBracketsSheet() {
  return getTab(getSpreadsheet(), BRACKETS_SHEET, BRACKET_HEADERS);
}

function getHistorySheet() {
  return getTab(getSpreadsheet(), HISTORY_SHEET, HISTORY_HEADERS);
}

function getConfigSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) {
    sheet = getTab(ss, CONFIG_SHEET, ['Setting', 'Value', 'Notes']);
    sheet.getRange(2, 1, 2, 3).setValues([
      ['Deadline', '', 'ISO time with UTC offset, e.g. 2027-03-18T12:15:00-04:00'],
      ['Family Passcode', '', 'Shared with the family; required to submit'],
    ]);
    sheet.getRange(2, 2, 2, 1).setNumberFormat('@');
  }
  return sheet;
}

/** Run once from the editor to create all tabs. */
function setup() {
  const brackets = getBracketsSheet();
  // Keep salt/hash as literal text so Sheets never reinterprets them as numbers.
  brackets.getRange(1, 4, brackets.getMaxRows(), 2).setNumberFormat('@');
  getHistorySheet();
  getConfigSheet();
  Logger.log('Ready: ' + getSpreadsheet().getUrl());
}

/** Read the Config tab into { deadline, passcode }. */
function readConfig() {
  const rows = getConfigSheet().getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[String(rows[i][0]).trim().toLowerCase()] = rows[i][1];
  }
  return {
    deadline: parseDeadline(map['deadline']),
    passcode: String(map['family passcode'] == null ? '' : map['family passcode']),
  };
}

/** Accepts a Date cell or ISO text; returns a Date or null. */
function parseDeadline(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

// ─── SECURITY HELPERS ────────────────────────────────────────────────────────

function hashPin(salt, pin) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function failureKey(scope) {
  return 'fail:' + String(scope).toLowerCase();
}

function failureCount(scope) {
  return Number(CacheService.getScriptCache().get(failureKey(scope)) || 0);
}

function recordFailure(scope) {
  CacheService.getScriptCache().put(
    failureKey(scope), String(failureCount(scope) + 1), FAILURE_WINDOW_SECONDS);
}

function clearFailures(scope) {
  CacheService.getScriptCache().remove(failureKey(scope));
}

class RequestError extends Error {}

function normalizeName(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

/** Names are written into cells, so reject anything Sheets could treat as a formula. */
function validateName(name) {
  if (!name) throw new RequestError('Missing submitter name');
  if (name.length > MAX_NAME_CHARS) throw new RequestError('Name is too long');
  if (/^[=+\-@]/.test(name) || /[\u0000-\u001f]/.test(name)) {
    throw new RequestError('Name contains characters that are not allowed');
  }
}

function validatePin(pin) {
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    throw new RequestError(`PIN must be ${PIN_MIN}-${PIN_MAX} characters`);
  }
}

function cleanTeam(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_TEAM_CHARS || /[\u0000-\u001f]/.test(value)) {
    throw new RequestError('Invalid team name in picks');
  }
  return value;
}

/** Returns a sanitized copy of the picks; throws RequestError if malformed. */
function validatePicks(data, name) {
  const clean = { submitter: name };

  const opening = data.openingRound;
  if (!opening || typeof opening !== 'object' || Array.isArray(opening)) {
    throw new RequestError('Invalid opening round picks');
  }
  const openingKeys = Object.keys(opening);
  if (openingKeys.length < 1 || openingKeys.length > OPENING_ROUND_MAX) {
    throw new RequestError('Invalid number of opening round picks');
  }
  clean.openingRound = {};
  for (const k of openingKeys) {
    if (!OPENING_ROUND_KEY.test(k)) throw new RequestError('Invalid opening round slot');
    clean.openingRound[k] = cleanTeam(opening[k]);
  }

  for (const round of Object.keys(ROUND_RULES)) {
    const rule = ROUND_RULES[round];
    const src = data[round];
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
      throw new RequestError(`Invalid ${round} picks`);
    }
    const keys = Object.keys(src);
    if (keys.length !== rule.count) throw new RequestError(`Incomplete ${round} picks`);
    clean[round] = {};
    for (const k of keys) {
      if (!rule.key.test(k)) throw new RequestError(`Invalid ${round} slot`);
      clean[round][k] = cleanTeam(src[k]);
    }
  }

  clean.championship = cleanTeam(data.championship);
  return clean;
}

// ─── REQUEST HANDLERS ────────────────────────────────────────────────────────

/**
 * POST body (JSON):
 *   submit: { submitter, passcode, pin, openingRound, roundOf64, ... championship }
 *   load:   { action: 'load', submitter, passcode, pin }
 */
function doPost(e) {
  let lock = null;
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    if (!raw || raw.length > MAX_PAYLOAD_CHARS) throw new RequestError('Invalid request');

    let data;
    try { data = JSON.parse(raw); } catch (_) { throw new RequestError('Invalid request'); }
    if (!data || typeof data !== 'object') throw new RequestError('Invalid request');

    const name = normalizeName(data.submitter);
    validateName(name);
    const pin = String(data.pin == null ? '' : data.pin);
    const isLoad = data.action === 'load';

    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new RequestError('Server is busy, please try again');

    if (failureCount(name) >= MAX_FAILURES || failureCount('*passcode') >= MAX_GLOBAL_FAILURES) {
      throw new RequestError('Too many failed attempts. Try again in 15 minutes.');
    }

    const config = readConfig();
    if (!config.passcode) throw new RequestError('Submissions are not configured yet');
    if (!safeEqual(String(data.passcode == null ? '' : data.passcode), config.passcode)) {
      recordFailure('*passcode');
      throw new RequestError('Incorrect family passcode');
    }

    const sheet = getBracketsSheet();
    const rows = sheet.getDataRange().getValues();
    let existingRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).toLowerCase() === name.toLowerCase()) {
        existingRow = i + 1; // sheet rows are 1-indexed
        break;
      }
    }
    const existing = existingRow > 0 ? rows[existingRow - 1] : null;
    const storedSalt = existing ? String(existing[3] || '') : '';
    const storedHash = existing ? String(existing[4] || '') : '';
    const claimed = !!(storedSalt && storedHash);

    if (isLoad) {
      if (!existing) throw new RequestError('No bracket found for that name');
      verifyPin(name, claimed, storedSalt, storedHash, pin);
      return jsonResponse({ success: true, picks: JSON.parse(existing[2]) });
    }

    if (!config.deadline) throw new RequestError('Submissions are not configured yet');
    if (new Date() >= config.deadline) throw new RequestError('Submissions are closed');

    const picks = validatePicks(data, name);

    let salt = storedSalt;
    let hash = storedHash;
    if (claimed) {
      verifyPin(name, claimed, storedSalt, storedHash, pin);
    } else {
      validatePin(pin);
      salt = Utilities.getUuid();
      hash = hashPin(salt, pin);
    }

    const timestamp = new Date().toISOString();
    const jsonStr = JSON.stringify(picks);
    // Keep the original capitalization of an existing entry.
    const storedName = existing ? String(existing[1]) : name;
    const rowValues = [timestamp, storedName, jsonStr, salt, hash];

    if (existing) {
      sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
    getHistorySheet().appendRow([timestamp, storedName, existing ? 'update' : 'create', jsonStr]);
    clearFailures(name);
    CacheService.getScriptCache().remove(PUBLIC_CACHE_KEY);

    return jsonResponse({ success: true, message: `Bracket saved for ${storedName}` });
  } catch (err) {
    if (err instanceof RequestError) return jsonResponse({ success: false, error: err.message });
    console.error(err);
    return jsonResponse({ success: false, error: 'Unexpected server error' });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function verifyPin(name, claimed, salt, hash, pin) {
  if (!claimed) throw new RequestError('That name has no PIN yet. Submit a bracket to set one.');
  if (!safeEqual(hashPin(salt, pin), hash)) {
    recordFailure(name);
    throw new RequestError('Incorrect PIN for that name');
  }
}

/**
 * GET — returns { deadline, serverTime, open, revealed, brackets }.
 * Until the deadline passes, brackets contain only { submitter }.
 * PINs, salts and the passcode are never returned.
 * ?action=status returns the same shape with no brackets and skips reading them.
 *
 * Reads are cached for PUBLIC_CACHE_SECONDS (a new submission clears the cache),
 * so manual edits in the spreadsheet can take up to a minute to appear.
 */
function doGet(e) {
  try {
    const now = new Date();
    const statusOnly = !!(e && e.parameter && e.parameter.action === 'status');

    const data = statusOnly ? { deadline: readDeadlineCached(), entries: [] } : readPublicData();
    const deadline = data.deadline ? new Date(data.deadline) : null;
    const revealed = !!deadline && now >= deadline;
    const open = !!deadline && !revealed;

    const brackets = [];
    for (const [name, picksJson] of data.entries) {
      if (!revealed) {
        brackets.push({ submitter: name });
        continue;
      }
      try {
        brackets.push(JSON.parse(picksJson));
      } catch (parseErr) {
        // Skip malformed rows
      }
    }

    return jsonResponse({
      deadline: data.deadline,
      serverTime: now.toISOString(),
      open,
      revealed,
      brackets,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Unexpected server error' });
  }
}

function cachePut(key, value) {
  const json = JSON.stringify(value);
  if (json.length < MAX_CACHE_CHARS) {
    CacheService.getScriptCache().put(key, json, PUBLIC_CACHE_SECONDS);
  }
}

function cacheGet(key) {
  const hit = CacheService.getScriptCache().get(key);
  if (!hit) return null;
  try { return JSON.parse(hit); } catch (_) { return null; }
}

/** Deadline as an ISO string (or null); avoids opening the Brackets sheet. */
function readDeadlineCached() {
  const hit = cacheGet(DEADLINE_CACHE_KEY);
  if (hit) return hit.deadline;
  const config = readConfig();
  const deadline = config.deadline ? config.deadline.toISOString() : null;
  cachePut(DEADLINE_CACHE_KEY, { deadline });
  return deadline;
}

/** Deadline plus [name, picksJson] for every bracket row. */
function readPublicData() {
  const hit = cacheGet(PUBLIC_CACHE_KEY);
  if (hit) return hit;
  const config = readConfig();
  const rows = getBracketsSheet().getDataRange().getValues();
  const data = {
    deadline: config.deadline ? config.deadline.toISOString() : null,
    entries: rows.slice(1).filter(r => r[1]).map(r => [String(r[1]), String(r[2])]),
  };
  cachePut(PUBLIC_CACHE_KEY, data);
  cachePut(DEADLINE_CACHE_KEY, { deadline: data.deadline });
  return data;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── SELF TEST (run from the editor; does not touch the spreadsheet) ─────────

function selfTest() {
  const check = (label, ok) => Logger.log((ok ? 'PASS ' : 'FAIL ') + label);
  const throws = fn => { try { fn(); return false; } catch (e) { return e instanceof RequestError; } };

  check('ISO deadline parses', parseDeadline('2027-03-18T12:15:00-04:00') instanceof Date);
  check('blank deadline is null', parseDeadline('') === null);
  check('garbage deadline is null', parseDeadline('soon') === null);
  check('hash is deterministic', hashPin('s', '1234') === hashPin('s', '1234'));
  check('hash depends on pin', hashPin('s', '1234') !== hashPin('s', '1235'));
  check('formula name rejected', throws(() => validateName('=HYPERLINK("x")')));
  check('long name rejected', throws(() => validateName('a'.repeat(51))));
  check('short pin rejected', throws(() => validatePin('12')));

  const regions = ['East', 'West', 'South', 'Midwest'];
  const fill = (n, make) => { const o = {}; for (let i = 1; i <= n; i++) o[make(i)] = 'Team'; return o; };
  const good = {
    openingRound: { OR1: 'A' },
    roundOf64: {}, roundOf32: {}, sweetSixteen: {}, eliteEight: {},
    finalFour: { FF_1: 'A', FF_2: 'B' },
    championship: 'A',
  };
  regions.forEach(r => {
    Object.assign(good.roundOf64, fill(8, i => `${r}_${i}`));
    Object.assign(good.roundOf32, fill(4, i => `${r}_${i}`));
    Object.assign(good.sweetSixteen, fill(2, i => `${r}_${i}`));
    good.eliteEight[r] = 'Team';
  });
  check('valid picks accepted', !throws(() => validatePicks(good, 'Test')));
  const bad = JSON.parse(JSON.stringify(good));
  delete bad.roundOf64.East_1;
  check('incomplete picks rejected', throws(() => validatePicks(bad, 'Test')));
}
