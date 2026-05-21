# CapiTracker

> To Keep the Budget Lekker.

🪙 **Try it live:** **https://milandekock.github.io/capitracker/**

A single-file budget tracker for South African bank statements. Reads CSVs you email to yourself, classifies them with simple rules, and shows you how the current pay cycle is tracking against your budget.

Built and tested against Capitec CSV exports (main account + credit card), but the rule engine is generic — any bank that exports a similar CSV shape should work.

## Why

Most budget apps assume a calendar month. If you get paid on the 25th, a calendar month splits your pay cycle in half and skews the budget-vs-actuals comparison. **CapiTracker uses a configurable pay-cycle window** (default 25th → 25th) so what you see actually matches how you spend.

## How it works

```
Bank emails CSV → Apps Script ingests → Google Sheet (canonical store)
                                              ↓
                                  budget_tracker.html (view + edit)
                                              ↓
                              classified rows posted back to Sheet
```

- **Apps Script** auto-pulls `account_statement_*.csv` attachments from Gmail (last 30 days) into a `Bank Statement` tab.
- **Single-file HTML app** (React via Babel-standalone, no build step) reads from the Sheet, lets you classify unreviewed rows, and posts confirmed classifications back to a `Transactions` tab.
- **Budget, rules, and settings** are persisted to their own tabs in the same Sheet — your phone, laptop, and browser all see the same data.

## Setup (~10 min)

### 1. Create the Google Sheet + Apps Script

1. Create a new Google Sheet. Name it whatever you like.
2. Extensions → Apps Script. Delete the placeholder `Code.gs`.
3. Paste the contents of [`apps_script.gs`](apps_script.gs) into the editor.
4. Change `SHARED_TOKEN` at the top to a long random string (~32 chars; any password generator works).
5. Save (Ctrl+S).
6. Click **Deploy → New deployment → ⚙️ gear → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone with the link**
7. Click **Deploy**. Authorize when prompted. On "Google hasn't verified this app", click **Advanced → Go to project (unsafe) → Allow** — this is normal for your own personal scripts.
8. Copy the **Web App URL**.

### 2. Hook up the HTML app

1. Open [`budget_tracker.html`](budget_tracker.html) in your browser (just double-click — no server needed).
2. Go to the **Setup** tab.
3. Paste the **Web App URL** and the **SHARED_TOKEN** you set in step 1.4.
4. Reload. Your tabs should now load from the Sheet.

### 3. Send your bank CSVs to your Gmail

Whatever email the Sheet/Apps Script lives under — send `account_statement_*.csv` attachments to that address. The Apps Script picks them up on Sheet open (or whenever the app calls "Refresh").

## Features

- **Sheet-backed** — all data lives in your Google Sheet, not in browser storage.
- **Pay-cycle aware** — budget windows align with your pay day, not the calendar month.
- **Rule-based classification** — match by description substring, exact category, or parent category. First match wins.
- **Dedup on import** — re-imports the same CSV without creating duplicate rows.
- **Two-account merge** — main account + credit card both feed into one ledger.
- **Private mode** — blur amounts with one click for screen-sharing.
- **No build step** — single HTML file, React via Babel-standalone, Tailwind via CDN.

## Tech

- Frontend: React 18 (UMD) + Babel-standalone + Tailwind CDN + PapaParse, all loaded from CDNs at runtime.
- Backend: Google Apps Script as a Web App, exposing `doGet` / `doPost` over the Sheet.
- Persistence: Google Sheet (canonical) + browser `localStorage` (Web App URL, token, UI state).

## File layout

```
budget_tracker.html   Main app (open this in a browser)
apps_script.gs        Paste into Apps Script editor inside the Sheet
setup_wizard.html     Optional first-run setup helper
keys.txt              YOUR token + Web App URL (gitignored, do not commit)
```

## License

MIT — see [`LICENSE`](LICENSE).
