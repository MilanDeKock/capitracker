  /**
  * Budget Tracker — Apps Script for a fresh Google Sheet.
  *
  * Three things this script does:
  *   1. onOpen()  — pulls every account_statement_*.csv attachment from your Gmail
  *                  (last 30 days) into the "Bank Statement" tab. Full refresh each time.
  *   2. doGet(e)  — returns JSON of all tabs to the budget_tracker.html app.
  *   3. doPost(e) — handles writes from the app (append history, save budget/rules/settings).
  *
  * SETUP (one-time, ~5 min):
  *   1. Create a new Google Sheet, name it (e.g.) "Budget Tracker 2026".
  *   2. Extensions → Apps Script. Delete the placeholder Code.gs. Paste this whole file.
  *   3. Change SHARED_TOKEN below to a long random string of your choice.
  *      (Any password generator works. ~32 chars. You'll paste the same string into the HTML.)
  *   4. Save (disk icon, Ctrl+S).
  *   5. Click "Deploy" → "New deployment" → gear icon → "Web app".
  *        Description:    anything
  *        Execute as:     Me
  *        Who has access: Anyone with the link
  *      Click "Deploy". Authorize when prompted:
  *        - Pick your Google account.
  *        - On the "Google hasn't verified this app" screen: click "Advanced"
  *          → "Go to Untitled project (unsafe)" → "Allow". This is normal for
  *          your own personal Apps Script projects.
  *      Copy the "Web app URL" that appears. Paste it (and SHARED_TOKEN)
  *      into the budget tracker HTML's Setup tab.
  *   6. Close the Apps Script tab and reload the Sheet. onOpen() fires:
  *      tabs auto-create with sensible defaults, and Gmail starts getting pulled.
  */

  // ============================================================================
  // CONFIG — set these once
  // ============================================================================
  const SHARED_TOKEN = 'CHANGE-ME-TO-A-LONG-RANDOM-STRING';
  const BANK_EMAIL   = 'your-email@example.com';
  // Note: Gmail's filename: operator silently fails on underscores ("account_statement"
  // matches 0 emails even when those CSVs exist), and from:<literal-address> also
  // misbehaves for self-sent mail. from:me + filename:csv is the combo that works.
  // The per-attachment filter inside pullStatements_ narrows down to actual
  // "account_statement_*.csv" files, so a broader Gmail query is safe.
  const GMAIL_QUERY  = 'from:me newer_than:30d has:attachment filename:csv';

  // ============================================================================
  // TAB DEFINITIONS
  // ============================================================================
  const T_RAW      = 'Bank Statement';
  const T_HISTORY  = 'Transactions';
  const T_BUDGET   = 'Budget';
  const T_RULES    = 'Rules';
  const T_SETTINGS = 'Settings';

  const HEADERS = {
    [T_RAW]:      ['Nr','Account','Posting Date','Transaction Date','Description','Original Description','Parent Category','Category','Money In','Money Out','Fee','Balance'],
    [T_HISTORY]:  ['Account','Posting Date','Transaction Date','Description','Original Description','Parent Category','Category','Money In','Money Out','Fee','Line','Splits','Budget Date','Posted At'],
    [T_BUDGET]:   ['Line','Amount'],
    [T_RULES]:    ['Line','Type','Value'],
    [T_SETTINGS]: ['Key','Value'],
  };

  // ============================================================================
  // DEFAULTS (seeded on first run only)
  // ============================================================================
  // Generic example budget — replace with your own categories and amounts.
  // Line names can be in any language; the app preserves them verbatim.
  const DEFAULT_BUDGET = [
    ['Rent', 0],            ['Transport', 0],
    ['Groceries', 0],       ['Utilities', 0],
    ['Subscriptions', 0],   ['Eating Out', 0],
    ['Savings', 0],         ['Medical', 0],
    ['Insurance', 0],       ['Personal', 0],
    ['Reimbursable', 0],    ['Review', 0],
  ];

  // Generic example rules so the Rules tab isn't empty on first run.
  // 'desc' matches a substring of the transaction description (case-insensitive).
  // 'cat'  matches the bank's Category field exactly.
  // 'pcat' matches the bank's Parent Category field exactly.
  // First match wins — order matters.
  const DEFAULT_RULES = [
    ['Rent',          'desc', 'landlord-name-here'],
    ['Subscriptions', 'desc', 'netflix'],
    ['Subscriptions', 'desc', 'spotify'],
    ['Groceries',     'cat',  'Groceries'],
    ['Transport',     'cat',  'Fuel'],
    ['Utilities',     'cat',  'Electricity'],
    ['Eating Out',    'cat',  'Restaurants'],
    ['Eating Out',    'cat',  'Takeaways'],
    ['Medical',       'cat',  'Pharmacy'],
  ];

  const DEFAULT_SETTINGS = [
    ['Net Income', 0],
    ['Anchor Day', 25],
  ];

  // ============================================================================
  // LIFECYCLE
  // ============================================================================
  function onOpen() {
    ensureTabs_();
    try { pullStatements_(); }
    catch (e) { Logger.log('Email pull failed: ' + e); }
  }

  function ensureTabs_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    for (const tabName of [T_RAW, T_HISTORY, T_BUDGET, T_RULES, T_SETTINGS]) {
      if (ss.getSheetByName(tabName)) continue;
      const sheet = ss.insertSheet(tabName);
      const h = HEADERS[tabName];
      sheet.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      seedDefaults_(sheet, tabName);
    }
    migrateSchema_();
  }

  // Add any HEADERS columns that don't exist yet in pre-existing tabs.
  // Idempotent — safe to call on every load. Lets us evolve the schema
  // (e.g. adding "Splits" later) without breaking users' existing sheets.
  function migrateSchema_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    for (const tabName of Object.keys(HEADERS)) {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) continue;
      const expected = HEADERS[tabName];
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim());
      for (const h of expected) {
        if (existing.includes(h)) continue;
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue(h).setFontWeight('bold');
        existing.push(h);
      }
    }
  }

  function seedDefaults_(sheet, tabName) {
    let rows = null;
    if (tabName === T_BUDGET)        rows = DEFAULT_BUDGET;
    else if (tabName === T_RULES)    rows = DEFAULT_RULES;
    else if (tabName === T_SETTINGS) rows = DEFAULT_SETTINGS;
    if (rows && rows.length) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
  }

  // ============================================================================
  // EMAIL PULL — gathers EVERY account_statement_*.csv attachment (both accounts)
  // ============================================================================
  function pullStatements_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(T_RAW);
    if (!sheet) return;

    const threads = GmailApp.search(GMAIL_QUERY, 0, 30);
    const collected = [];
    const seenHashes = new Set();

    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        for (const att of msg.getAttachments()) {
          const name = (att.getName() || '').toLowerCase();
          if (!name.startsWith('account_statement') || !name.endsWith('.csv')) continue;
          if (att.isGoogleType && att.isGoogleType()) continue;

          let csv;
          try { csv = Utilities.parseCsv(att.getDataAsString()); }
          catch (e) { Logger.log('parse failed for ' + name + ': ' + e); continue; }
          if (csv.length < 2) continue;

          const idx = {};
          csv[0].forEach((h, i) => { idx[String(h).trim()] = i; });

          for (let r = 1; r < csv.length; r++) {
            const row = csv[r];
            const postingDate = row[idx['Posting Date']];
            if (!postingDate) continue;
            const out = HEADERS[T_RAW].map(h => {
              if (h === 'Nr') return '';
              if (idx[h] === undefined) return '';
              return row[idx[h]];
            });
            const desc = (row[idx['Original Description']] || row[idx['Description']] || '').toString().toLowerCase();
            const mi = Number(row[idx['Money In']]) || 0;
            const mo = Number(row[idx['Money Out']]) || 0;
            const fe = Number(row[idx['Fee']]) || 0;
            const hash = postingDate + '|' + desc + '|' + (mi + mo + fe).toFixed(2);
            if (seenHashes.has(hash)) continue;
            seenHashes.add(hash);
            collected.push(out);
          }
        }
      }
    }

    // Sort by Posting Date ascending, then assign Nr
    const pdIdx = HEADERS[T_RAW].indexOf('Posting Date');
    collected.sort((a, b) => String(a[pdIdx]).localeCompare(String(b[pdIdx])));
    collected.forEach((row, i) => { row[0] = i + 1; });

    sheet.clearContents();
    const h = HEADERS[T_RAW];
    sheet.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    if (collected.length) {
      sheet.getRange(2, 1, collected.length, h.length).setValues(collected);
    }
    Logger.log('Pulled ' + collected.length + ' rows from ' + threads.length + ' threads.');
  }

  // ============================================================================
  // WEB APP — doGet / doPost
  // ============================================================================
  function doGet(e) {
    const params = (e && e.parameter) || {};
    if (!checkToken_(params.token)) {
      return jsonOut_({ ok: false, error: 'bad token' });
    }
    const action = params.action || 'load';
    try {
      if (action === 'load') return jsonOut_(loadAll_());
      if (action === 'pull') { pullStatements_(); return jsonOut_(loadAll_()); }
      if (action === 'ping') return jsonOut_({ ok: true, message: 'pong' });
      return jsonOut_({ ok: false, error: 'unknown action: ' + action });
    } catch (err) {
      return jsonOut_({ ok: false, error: String(err) });
    }
  }

  function doPost(e) {
    let body;
    try { body = JSON.parse(e && e.postData && e.postData.contents); }
    catch (_) { return jsonOut_({ ok: false, error: 'bad json' }); }
    if (!body) return jsonOut_({ ok: false, error: 'no body' });

    if (!checkToken_(body.token)) {
      return jsonOut_({ ok: false, error: 'bad token' });
    }

    try {
      switch (body.action) {
        case 'append-history':
          return jsonOut_(appendHistory_(body.rows || []));
        case 'update-history':
          return jsonOut_(updateHistoryLine_(body.hash, body.line));
        case 'update-splits':
          return jsonOut_(updateHistorySplits_(body.hash, body.splits || ''));
        case 'update-budget-date':
          return jsonOut_(updateHistoryBudgetDate_(body.hash, body.budgetDate || ''));
        case 'delete-history':
          return jsonOut_(deleteHistoryRow_(body.hash));
        case 'save-budget':
          return jsonOut_(overwriteTab_(T_BUDGET, body.rows || []));
        case 'save-rules':
          return jsonOut_(overwriteTab_(T_RULES, body.rows || []));
        case 'save-settings':
          return jsonOut_(overwriteSettings_(body.settings || {}));
        default:
          return jsonOut_({ ok: false, error: 'unknown action: ' + body.action });
      }
    } catch (err) {
      return jsonOut_({ ok: false, error: String(err) });
    }
  }

  function checkToken_(t) {
    return t && SHARED_TOKEN && t === SHARED_TOKEN;
  }

  function jsonOut_(obj) {
    return ContentService
      .createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ============================================================================
  // READ HELPERS
  // ============================================================================
  function loadAll_() {
    return {
      ok: true,
      rawStatements: readTab_(T_RAW),
      transactions:  readTab_(T_HISTORY),
      budget:        readTab_(T_BUDGET),
      rules:         readTab_(T_RULES),
      settings:      readSettings_(),
    };
  }

  function readTab_(name) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0].map(String);
    const tz = Session.getScriptTimeZone();
    const out = [];
    for (let r = 1; r < data.length; r++) {
      if (data[r].every(v => v === '' || v === null)) continue;
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        let v = data[r][c];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        obj[headers[c]] = v;
      }
      out.push(obj);
    }
    return out;
  }

  function readSettings_() {
    const rows = readTab_(T_SETTINGS);
    const out = {};
    rows.forEach(r => { if (r.Key !== undefined && r.Key !== '') out[String(r.Key)] = r.Value; });
    return out;
  }

  // ============================================================================
  // WRITE HELPERS
  // ============================================================================
  function appendHistory_(rows) {
    if (!rows.length) return { ok: true, appended: 0 };
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(T_HISTORY);
    const existing = readTab_(T_HISTORY);
    const existingHashes = new Set(existing.map(hashRow_));
    const headers = HEADERS[T_HISTORY];
    const now = new Date().toISOString();

    const fresh = rows.filter(r => !existingHashes.has(hashRow_(r)));
    if (!fresh.length) return { ok: true, appended: 0 };

    const arr = fresh.map(r => headers.map(h => {
      if (h === 'Posted At') return now;
      return r[h] !== undefined ? r[h] : '';
    }));
    sheet.getRange(sheet.getLastRow() + 1, 1, arr.length, headers.length).setValues(arr);
    return { ok: true, appended: arr.length };
  }

  function findHistoryRowByHash_(hash) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(T_HISTORY);
    if (!sheet) return { sheet: null, rowIdx: -1, headers: null };
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { sheet, rowIdx: -1, headers: null };
    const headers = data[0].map(String);
    const tz = Session.getScriptTimeZone();
    for (let r = 1; r < data.length; r++) {
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        let v = data[r][c];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        obj[headers[c]] = v;
      }
      if (hashRow_(obj) === hash) return { sheet, rowIdx: r + 1, headers };
    }
    return { sheet, rowIdx: -1, headers };
  }

  function updateHistoryLine_(hash, line) {
    if (!hash || !line) return { ok: false, error: 'hash and line required' };
    const { sheet, rowIdx, headers } = findHistoryRowByHash_(hash);
    if (rowIdx < 0) return { ok: false, error: 'row not found' };
    const lineCol = headers.indexOf('Line');
    if (lineCol < 0) return { ok: false, error: 'no Line column' };
    sheet.getRange(rowIdx, lineCol + 1).setValue(line);
    return { ok: true };
  }

  // Splits is stored as a pipe-delimited string: "Line1:Amount1|Line2:Amount2".
  // Empty string clears the splits and reverts the row to using its single Line.
  function updateHistorySplits_(hash, splits) {
    if (!hash) return { ok: false, error: 'hash required' };
    const { sheet, rowIdx, headers } = findHistoryRowByHash_(hash);
    if (rowIdx < 0) return { ok: false, error: 'row not found' };
    const splitsCol = headers.indexOf('Splits');
    if (splitsCol < 0) return { ok: false, error: 'no Splits column — older sheet, reopen to migrate' };
    sheet.getRange(rowIdx, splitsCol + 1).setValue(splits || '');
    return { ok: true };
  }

  // Budget Date overrides the cycle a row falls into for budgeting purposes,
  // without changing its actual Posting Date. Empty string clears the override.
  function updateHistoryBudgetDate_(hash, budgetDate) {
    if (!hash) return { ok: false, error: 'hash required' };
    const { sheet, rowIdx, headers } = findHistoryRowByHash_(hash);
    if (rowIdx < 0) return { ok: false, error: 'row not found' };
    const col = headers.indexOf('Budget Date');
    if (col < 0) return { ok: false, error: 'no Budget Date column — older sheet, reopen to migrate' };
    sheet.getRange(rowIdx, col + 1).setValue(budgetDate || '');
    return { ok: true };
  }

  function deleteHistoryRow_(hash) {
    if (!hash) return { ok: false, error: 'hash required' };
    const { sheet, rowIdx } = findHistoryRowByHash_(hash);
    if (rowIdx < 0) return { ok: false, error: 'row not found' };
    sheet.deleteRow(rowIdx);
    return { ok: true };
  }

  function hashRow_(r) {
    const mi = Number(r['Money In']) || 0;
    const mo = Number(r['Money Out']) || 0;
    const fe = Number(r['Fee']) || 0;
    const desc = (r['Original Description'] || r['Description'] || '').toString().toLowerCase();
    return [r['Posting Date'], desc, (mi + mo + fe).toFixed(2)].join('|');
  }

  function overwriteTab_(name, rows) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    const headers = HEADERS[name];
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    if (rows.length) {
      const arr = rows.map(r => headers.map(h => r[h] !== undefined ? r[h] : ''));
      sheet.getRange(2, 1, arr.length, headers.length).setValues(arr);
    }
    return { ok: true, saved: rows.length };
  }

  function overwriteSettings_(obj) {
    const rows = Object.keys(obj).map(k => ({ Key: k, Value: obj[k] }));
    return overwriteTab_(T_SETTINGS, rows);
  }

  // ============================================================================
  // DIAGNOSTIC — run manually from the editor to see what Gmail sees
  // ============================================================================
  function gmailDiag() {
    Logger.log('Active user:    ' + Session.getActiveUser().getEmail());
    Logger.log('Effective user: ' + Session.getEffectiveUser().getEmail());

    const queries = [
      'newer_than:7d',
      'newer_than:30d has:attachment',
      'filename:account_statement',
      'filename:account',
      'filename:csv newer_than:30d',
      'from:me newer_than:30d has:attachment',
    ];
    for (const q of queries) {
      const n = GmailApp.search(q, 0, 10).length;
      Logger.log(q + '  →  ' + n + ' threads');
    }

    Logger.log('--- recent threads (last 7d, up to 5) ---');
    const recent = GmailApp.search('newer_than:7d', 0, 5);
    for (const t of recent) {
      const m = t.getMessages()[0];
      const attNames = m.getAttachments().map(a => a.getName()).join(', ') || '(none)';
      Logger.log('  · "' + m.getSubject() + '" from ' + m.getFrom() + ' / attachments: ' + attNames);
    }
  }
