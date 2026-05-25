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
  // We accept statements from:
  //   1. Yourself (CSVs you forward)                → from:me
  //   2. Any major SA bank's automated email sender → bank domain match
  // Per-attachment filters inside pullStatements_ narrow down to actual
  // statement files, so a broader Gmail query is safe.
  const GMAIL_QUERY  = '(from:me OR from:capitecbank.co.za OR from:fnb.co.za OR from:standardbank.co.za OR from:nedbank.co.za OR from:absa.co.za OR from:tymebank.co.za OR from:investec.com OR from:discoverybank.co.za) newer_than:30d has:attachment';

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
  // EMAIL PULL — gathers statement attachments from Gmail and writes T_RAW.
  // Handles both:
  //   - CSV: account_statement_*.csv (user-forwarded from Capitec app)
  //   - PDF: account_statement.pdf etc. (sent directly by Capitec, parsed
  //          by Gemini if GEMINI_API_KEY is set in Script Properties)
  // ============================================================================
  // How many PDF statements to parse per Sync. Each PDF costs ~2-3 minutes
  // of Gemini time, and Apps Script web app calls cap at 6 minutes total.
  // Parsing the newest one only is plenty for typical use — older statements
  // are already in your Sheet from previous syncs.
  const MAX_PDFS_PER_SYNC = 1;

  // mode = 'all' | 'csv' | 'pdf' — controls which attachments get processed.
  // CSV is fast; PDF goes through Gemini and can take minutes. Buttons in the
  // app split these so users on one source aren't waiting for the other.
  function pullStatements_(mode) {
    mode = mode || 'all';
    const includeCsv = (mode === 'all' || mode === 'csv');
    const includePdf = (mode === 'all' || mode === 'pdf');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(T_RAW);
    if (!sheet) return;

    const threads = GmailApp.search(GMAIL_QUERY, 0, 30);
    const collected = [];
    const seenHashes = new Set();
    let csvCount = 0, pdfCount = 0, pdfTxCount = 0, pdfsParsed = 0;
    const aiEnabled = includePdf && !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        for (const att of msg.getAttachments()) {
          const name = (att.getName() || '').toLowerCase();
          if (att.isGoogleType && att.isGoogleType()) continue;

          // ---- CSV path (existing) ----
          if (includeCsv && name.startsWith('account_statement') && name.endsWith('.csv')) {
            csvCount++;
            let csv;
            try { csv = Utilities.parseCsv(att.getDataAsString()); }
            catch (e) { Logger.log('CSV parse failed for ' + name + ': ' + e); continue; }
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
            continue;
          }

          // ---- PDF path (AI-parsed) ----
          if (name.endsWith('.pdf') && aiEnabled && isBankStatementPdf_(att, msg)) {
            pdfCount++;
            if (pdfsParsed >= MAX_PDFS_PER_SYNC) {
              Logger.log('Skipping PDF (limit ' + MAX_PDFS_PER_SYNC + ' reached): ' + att.getName());
              continue;
            }
            Logger.log('Parsing PDF: ' + att.getName() + ' (' + Math.round(att.getSize() / 1024) + 'KB)');
            try {
              const txs = parseStatementPdf_(att);
              for (const tx of txs) {
                if (!tx.postingDate) continue;
                const mi = Number(tx.moneyIn) || 0;
                const mo = Number(tx.moneyOut) || 0;
                const fe = Number(tx.fee) || 0;
                const desc = (tx.originalDescription || tx.description || '').toString().toLowerCase();
                const hash = tx.postingDate + '|' + desc + '|' + (mi + mo + fe).toFixed(2);
                if (seenHashes.has(hash)) continue;
                seenHashes.add(hash);
                const out = HEADERS[T_RAW].map(h => {
                  if (h === 'Nr')                  return '';
                  if (h === 'Account')             return '';
                  if (h === 'Posting Date')        return tx.postingDate || '';
                  if (h === 'Transaction Date')    return tx.transactionDate || tx.postingDate || '';
                  if (h === 'Description')         return tx.description || '';
                  if (h === 'Original Description')return tx.originalDescription || tx.description || '';
                  if (h === 'Parent Category')     return '';
                  if (h === 'Category')            return '';
                  if (h === 'Money In')            return mi;
                  if (h === 'Money Out')           return mo;
                  if (h === 'Fee')                 return fe;
                  if (h === 'Balance')             return Number(tx.balance) || 0;
                  return '';
                });
                collected.push(out);
                pdfTxCount++;
              }
              pdfsParsed++;
            } catch (e) {
              Logger.log('PDF parse failed for ' + name + ': ' + e);
            }
            continue;
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
    Logger.log('Pulled ' + collected.length + ' rows [mode=' + mode + ']. CSV files: ' + csvCount + ', PDF files: ' + pdfCount + ' (' + pdfTxCount + ' tx from AI parsing)' + (includePdf && !aiEnabled ? ' [AI disabled — set GEMINI_API_KEY]' : ''));
  }

  // Decide whether a PDF looks like a bank statement worth sending to Gemini.
  // Avoids spending API calls on invoices, receipts, random PDFs in your inbox.
  // Bank-agnostic: matches any major SA bank by sender domain or by common
  // statement filename patterns.
  const BANK_DOMAINS_ = [
    'capitec', 'fnb', 'standardbank', 'nedbank', 'absa', 'tymebank',
    'investec', 'discovery', 'sbsa',
  ];
  function isBankStatementPdf_(att, msg) {
    const name = (att.getName() || '').toLowerCase();
    if (name.includes('statement') || name.startsWith('account_')) return true;
    const from = (msg.getFrom() || '').toLowerCase();
    return BANK_DOMAINS_.some(d => from.includes(d));
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
      if (action === 'pull')     { pullStatements_('all'); return jsonOut_(loadAll_()); }
      if (action === 'pull-csv') { pullStatements_('csv'); return jsonOut_(loadAll_()); }
      if (action === 'pull-pdf') { pullStatements_('pdf'); return jsonOut_(loadAll_()); }
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
        case 'chat':
          return jsonOut_(chatWithGemini_(body.messages || [], body.context || {}));
        default:
          return jsonOut_({ ok: false, error: 'unknown action: ' + body.action });
      }
    } catch (err) {
      return jsonOut_({ ok: false, error: String(err) });
    }
  }

  // Prefer the token stored in Script Properties (encrypted, never in code).
  // Falls back to the SHARED_TOKEN constant for backwards compatibility with
  // existing setups. To migrate: open Project Settings → Script Properties,
  // add SHARED_TOKEN = <your-token>, then optionally clear the constant above
  // (set it back to 'CHANGE-ME-TO-A-LONG-RANDOM-STRING'). Rotate without
  // redeploying — Property reads pick up the current value on each request.
  function getSharedToken_() {
    return PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN') || SHARED_TOKEN;
  }

  function checkToken_(t) {
    const expected = getSharedToken_();
    return t && expected && t === expected && expected !== 'CHANGE-ME-TO-A-LONG-RANDOM-STRING';
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
  // AI PDF PARSING (opt-in) — sends PDF statements to Google Gemini, returns
  // structured transactions. Cost: free tier covers ~1500 PDFs/day. Privacy:
  // the PDF bytes are sent to Google's Gemini API; nothing else.
  //
  // ENABLE:
  //   1. Get a key from https://aistudio.google.com (free, ~30 seconds)
  //   2. In the Apps Script editor: gear icon (Project Settings) → scroll
  //      to "Script properties" → "Add script property":
  //         Property: GEMINI_API_KEY
  //         Value:    <your AIza... key>
  //   3. Save & redeploy (Deploy → Manage deployments → ✏ → New version)
  //   4. Run testPdfParse() from the editor to verify the parsing on a
  //      recent PDF. Check View → Executions for the log output.
  // ============================================================================
  const GEMINI_MODEL = 'gemini-2.5-flash';

  const GEMINI_PROMPT = [
    'You are parsing a South African bank statement into structured transaction data.',
    'The statement could be from any SA bank — Capitec, FNB, Standard Bank, Nedbank, ABSA, TymeBank, Investec, Discovery, or similar. The layout, column headings, and terminology vary by bank; infer the structure from context.',
    '',
    'For each transaction row, extract:',
    '- postingDate (YYYY-MM-DD)',
    '- transactionDate (YYYY-MM-DD; same as posting date if not separately shown)',
    '- description (the merchant or transaction description, cleaned up)',
    '- originalDescription (raw description verbatim from the statement)',
    '- moneyIn  (POSITIVE number for deposits/credits, 0 otherwise)',
    '- moneyOut (NEGATIVE number for debits/spending, 0 otherwise)',
    '- fee      (NEGATIVE number for fees, 0 otherwise)',
    '- balance  (running balance after the transaction)',
    '',
    'Many SA banks present amounts as a single signed column (e.g. -100.00) or as "Debit" / "Credit" columns. Map them onto moneyIn / moneyOut / fee with the sign rules above, regardless of the source layout.',
    '',
    'Skip header rows, footer rows, page numbers, totals, summary lines, account holder details, and anything that is not an actual transaction.',
    '',
    'CRITICAL: moneyOut and fee MUST be NEGATIVE numbers. A R100 debit appears as moneyOut: -100. A R5 fee appears as fee: -5. Positive moneyOut values break downstream budget math.',
    '',
    'Return a JSON array.',
  ].join('\n');

  const GEMINI_TX_SCHEMA = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        postingDate:         { type: 'STRING' },
        transactionDate:     { type: 'STRING' },
        description:         { type: 'STRING' },
        originalDescription: { type: 'STRING' },
        moneyIn:             { type: 'NUMBER' },
        moneyOut:            { type: 'NUMBER' },
        fee:                 { type: 'NUMBER' },
        balance:             { type: 'NUMBER' },
      },
      required: ['postingDate', 'description'],
    },
  };

  function getGeminiKey_() {
    const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('No GEMINI_API_KEY in Script Properties. See the comment above this function for setup.');
    return key;
  }

  // Shared retry wrapper for transient Gemini failures (503 = overload,
  // 429 = rate-limit, 500 = generic blip). Tries up to 3 times total with
  // 1s then 2s backoff. Re-throws if still failing or if the error is
  // not retryable (e.g. 400/401/403 — those are our problem, not theirs).
  function geminiFetch_(url, payload) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) Utilities.sleep(1000 * attempt);
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: payload,
        muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      if (code === 200) return res;
      const isRetryable = (code === 503 || code === 429 || code === 500 || code === 502 || code === 504);
      lastErr = 'Gemini API ' + code + ': ' + res.getContentText().slice(0, 400);
      if (!isRetryable) throw new Error(lastErr);
    }
    // All retries exhausted
    if (lastErr && lastErr.indexOf('503') >= 0) {
      throw new Error('Gemini is overloaded right now (still retrying tried 3 times). Please try again in a minute.');
    }
    throw new Error(lastErr || 'Gemini unreachable');
  }

  // Conversational budget assistant. Takes the user's message history plus
  // a snapshot of their current budget/settings/transactions, returns the
  // AI's reply. Same GEMINI_API_KEY as PDF parsing.
  function chatWithGemini_(messages, context) {
    const apiKey = getGeminiKey_();
    if (!messages.length) return { ok: false, error: 'no messages' };

    const systemPrompt = buildChatSystemPrompt_(context);

    // Gemini wants the conversation as contents[] with alternating user/model
    // roles. Inject the system context as a prelude to the first user turn.
    const contents = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const role = m.role === 'assistant' ? 'model' : 'user';
      const text = (i === 0 && role === 'user') ? (systemPrompt + '\n\n' + m.text) : m.text;
      contents.push({ role, parts: [{ text }] });
    }

    const body = {
      contents,
      generationConfig: {
        temperature: 0.3,
        // Gemini 2.5 Flash supports up to ~8K output tokens. 4000 covers any
        // reasonable answer without burning quota. Was 1500 — too tight; long
        // answers were getting chopped mid-sentence.
        maxOutputTokens: 4000,
      },
    };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
    const res = geminiFetch_(url, JSON.stringify(body));
    const data = JSON.parse(res.getContentText());
    const cand = data.candidates && data.candidates[0];
    let text = cand && cand.content && cand.content.parts && cand.content.parts.map(p => p.text || '').join('') || '';
    const finish = cand && cand.finishReason;
    // Append a clear marker if the model stopped because it hit the token cap
    // or was blocked, rather than silently returning a half-formed answer.
    if (finish === 'MAX_TOKENS') {
      text += '\n\n— answer truncated at the token limit. Ask a more specific question, or "continue" to get the rest.';
    } else if (finish === 'SAFETY' || finish === 'RECITATION' || finish === 'BLOCKLIST') {
      text += '\n\n— Gemini stopped because of a content filter (finishReason: ' + finish + '). Try rephrasing.';
    }
    return { ok: true, message: text };
  }

  function buildChatSystemPrompt_(ctx) {
    const lines = [];
    lines.push("You are CapiTracker's friendly budget assistant. The user banks in South Africa and is asking questions about their personal budget.");
    lines.push("");
    lines.push("SCOPE RULES (important):");
    lines.push("- The user picks a SCOPE for the chat (e.g. 'This cycle', 'Last 30 days', 'Last 90 days', 'All history'). Only transactions in that scope are provided in this prompt.");
    lines.push("- Treat 'now', 'so far', 'this month' as referring to the current scope.");
    lines.push("- If the user explicitly asks about a period outside the current scope, say plainly: 'My current scope is <scope> (<dates>). Change the chat scope dropdown at the top of the chat and ask me again, and I'll have that data.'");
    lines.push("- Never invent numbers for periods outside the scope. Always work from the data below.");
    lines.push("");
    lines.push("STYLE:");
    lines.push("- Be concise. Use ZAR formatting (R1 234,56 with en-ZA locale).");
    lines.push("- Answer specifically with numbers when you can.");
    lines.push("- Say 'I don't have that info' rather than guessing.");
    lines.push("");

    if (ctx.budget && ctx.budget.length) {
      lines.push('BUDGET (per pay cycle):');
      for (const b of ctx.budget) lines.push('- ' + b.line + ': R' + b.amount);
      lines.push('');
    }
    if (ctx.settings) {
      lines.push('SETTINGS: net income R' + (ctx.settings.netIncome || 0) + '/cycle, pay-cycle anchor day ' + (ctx.settings.anchorDay || 25) + '.');
      lines.push('');
    }
    const scopeName = ctx.scopeLabel || 'current cycle';
    if (ctx.windowFrom && ctx.windowTo) {
      lines.push('SCOPE: ' + scopeName + ' — ' + ctx.windowFrom + ' to ' + ctx.windowTo + '.');
    } else {
      lines.push('SCOPE: ' + scopeName + ' (all available history).');
    }
    lines.push('');
    if (ctx.transactions && ctx.transactions.length) {
      const hdr = 'TRANSACTIONS IN SCOPE (' + ctx.transactions.length + (ctx.truncated ? ' shown, ' + ctx.totalCount + ' total — truncated for prompt size' : '') + ', csv-like — date | description | amount | budget line):';
      lines.push(hdr);
      for (const t of ctx.transactions) {
        lines.push(t.date + ' | ' + (t.description || '') + ' | ' + (t.amount || 0) + ' | ' + (t.line || ''));
      }
      lines.push('');
    } else {
      lines.push('TRANSACTIONS IN SCOPE: none provided.');
      lines.push('');
    }
    return lines.join('\n');
  }

  function parseStatementPdf_(pdfBlob) {
    const apiKey = getGeminiKey_();
    const pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());

    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
          { text: GEMINI_PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_TX_SCHEMA,
        temperature: 0.0,
      },
    };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
    const res = geminiFetch_(url, JSON.stringify(body));
    const data = JSON.parse(res.getContentText());
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
    if (!text) throw new Error('Unexpected Gemini response shape: ' + JSON.stringify(data).slice(0, 500));
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Gemini returned non-JSON: ' + text.slice(0, 500));
    }
  }

  // List every PDF in your Gmail (last 90 days, from you OR Capitec) so
  // you can see what testPdfParse() might pick up. Run when parsing's
  // grabbing the wrong file.
  function listGmailPdfs() {
    const threads = GmailApp.search('(from:me OR from:noreply@capitecbank.co.za) newer_than:90d has:attachment', 0, 30);
    let count = 0;
    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        for (const att of msg.getAttachments()) {
          const name = att.getName() || '';
          if (!name.toLowerCase().endsWith('.pdf')) continue;
          count++;
          Logger.log(count + '. ' + name + ' (' + Math.round(att.getSize() / 1024) + 'KB, sent ' + msg.getDate().toISOString().slice(0, 10) + ')');
        }
      }
    }
    if (count === 0) Logger.log('No PDF attachments found (from:me, last 90d).');
    else Logger.log('Total: ' + count + ' PDF(s)');
  }

  // Run from the editor (function dropdown → testPdfParse → ▶). Picks the
  // most recent statement-looking PDF in your Gmail and parses it, logging
  // the result. No write to the Sheet — purely for verification.
  // Preference order: PDFs with "statement" or "capitec" in the name,
  // then any PDF as a fallback.
  function testPdfParse() {
    const threads = GmailApp.search('from:me newer_than:90d has:attachment', 0, 30);
    for (const wantStatement of [true, false]) {
      for (const thread of threads) {
        for (const msg of thread.getMessages()) {
          for (const att of msg.getAttachments()) {
            const name = (att.getName() || '').toLowerCase();
            if (!name.endsWith('.pdf')) continue;
            if (wantStatement && !name.includes('statement') && !name.includes('capitec')) continue;
            Logger.log('Parsing: ' + att.getName() + ' (' + Math.round(att.getSize() / 1024) + 'KB)');
            try {
              const txs = parseStatementPdf_(att);
              Logger.log('Parsed ' + txs.length + ' transactions. First 5:');
              Logger.log(JSON.stringify(txs.slice(0, 5), null, 2));
              if (txs.length > 5) Logger.log('... and ' + (txs.length - 5) + ' more.');
            } catch (e) {
              Logger.log('FAILED: ' + e);
            }
            return; // first match only
          }
        }
      }
    }
    Logger.log('No PDF attachments found in Gmail (from:me, last 90 days).');
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
