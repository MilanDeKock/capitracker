# CapiTracker

> To Keep the Budget Lekker.

🪙 **Try it live:** **https://milandekock.github.io/capitracker/**

![Dashboard](demo/dashboard.png)

A single-file budget tracker for South African bank statements. Reads CSVs you email to yourself (or PDF statements Capitec emails you directly, parsed by Gemini AI), classifies transactions with simple rules, and shows you how the current pay cycle is tracking against your budget.

**Two ingest modes:**

- **CSV mode** (built for Capitec). The CSV ingest assumes Capitec's exact column layout. Other SA banks (FNB, Standard Bank, Nedbank, ABSA, TymeBank, etc.) use different column names — adapting CSV ingest to them is per-bank work; PRs welcome.
- **PDF mode via Google Gemini AI** (works for any SA bank). Plug in a free Gemini API key and the AI extracts transactions directly from your bank's PDF statement — Capitec, FNB, Standard Bank, Nedbank, ABSA, TymeBank, Investec, Discovery, or any similar. No per-bank parser needed. See [Setup → AI PDF parsing](#optional-enable-ai-pdf-parsing).

## Why

Most budget apps either cost money or their bank integrations don't work in South Africa (aiii Vault22). This tool bridges most of the gap — you still have to manually email your statement CSV to yourself (use the same Gmail address the Google Sheet is saved under), but the script picks it up automatically from there. Beats manually exporting and importing every month.

It's also **pay-cycle aware**: if you get paid on the 25th, calendar months split your spending in half and the budget-vs-actuals comparison gets skewed. CapiTracker lets you pick the cycle window (default 25th → 25th) so what you see matches how you actually spend.

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

Send `account_statement_*.csv` attachments to the **same Gmail address** that owns the Apps Script. The script searches its own inbox using `from:me`, so the email must come *from* that address (sent to itself is fine — it's still "from me").

> **Gotcha:** if you have multiple Gmail accounts and forward the CSV from a different one (e.g. work → personal), the script won't find it. Either send from the same account, or edit `GMAIL_QUERY` in your `apps_script.gs` to use `to:me` instead.

The Apps Script picks new attachments up on Sheet open, or whenever the app calls **Sync CSV** (fast, ~5 sec).

### Optional: enable AI PDF parsing

If you'd rather skip the CSV-forwarding step entirely, Capitec emails monthly PDF statements directly. CapiTracker can have Google Gemini extract the transactions from those PDFs for you.

1. Get a free key at [aistudio.google.com](https://aistudio.google.com/app/apikey) (~30 seconds, no card required, free tier handles ~1,500 PDFs/day).
2. Apps Script editor → ⚙️ gear (Project Settings) → scroll to **Script properties** → click **Add script property**:
   - Property: `GEMINI_API_KEY`
   - Value: your `AIza...` key
3. Save & redeploy.
4. In CapiTracker, click the new **Sync PDF (AI)** button. Each PDF takes ~3 minutes to parse — go make a coffee ☕. Transactions appear when it's done.

**You can switch between CSV and PDF flows at any time.** Pick whichever fits your routine. Many users find PDF mode less effort once it's set up (Capitec auto-emails the statement; you just hit Sync PDF when you remember).

## Features

- **Sheet-backed** — all data lives in your Google Sheet, not in browser storage.
- **Pay-cycle aware** — budget windows align with your pay day, not the calendar month.

![Budget configuration](demo/budget.png)

- **Cashflow at a glance** — three-number dashboard card: **Bank balance** (sum of latest balance per account), **Outstanding** (still-to-leave-the-bank commitments for the cycle), **Free now** (what's actually free to spend). Expand for a per-account breakdown with staleness indicators (red if >14 days since last sync, amber if >7).
- **Manual balance adjust** — bank statements lag real-time. Click the bank balance to override it with what your banking app says right now; revert any time with one click. Useful when your card has just been swiped and the statement hasn't caught up.
- **Per-account "flip sign" toggle** — for non-Capitec accounts (some banks represent credit-card debt with the opposite convention). One ⇅ click per account fixes it; survives across syncs.
- **Per-cycle budget overrides** — for one-off cycles (mission trip, holiday month, December). Set a different amount for a single cycle without touching your default budget. Effective budget = defaults + that cycle's overrides + any one-off lines.
- **Running watch** — pick any budget line, see a live running total of spend against it for the current cycle, with red rows once you've gone over.

![Running watch](demo/running-watch.png)

- **AI chat assistant (opt-in, Gemini)** — ask plain-English questions about your budget: "where did most of my money go this cycle?", "am I on track for groceries?", "what's left for eating out?". Scope selector (This cycle / Last 30 / Last 90 / All) controls how much history the model sees. Same Gemini key as PDF parsing — no extra setup.
- **Rule-based classification** — match by description substring, exact category, or parent category. First match wins.

![Transactions classification](demo/transactions.png)

![Classification rules](demo/rules.png)

- **Bulk-edit transactions** — multi-select rows on the Transactions tab and apply a budget line to all of them in one click, or delete a batch from history. For when a single rule mis-tagged twenty rows and you don't want to fix them one at a time.
- **Split transactions across budget lines** — one bank transaction, multiple budget categories. e.g. a R3,000 savings transfer where R2,000 is real savings and R1,000 is a sinking fund. Works on any transaction from the moment it appears — no need to post to history first. Splits feed the dashboard's Budget vs Actual and the Running watch as if they were separate transactions.
- **Move a transaction to a different cycle** — for late-reflecting payments or pre-payments. Click the small cycle pill on any row to remap which pay cycle the transaction counts in (previous / default / next). The actual Posting Date never changes — only which cycle it counts toward in your budget.
- **Apply credits and income to budget lines** — got a R300 gift, refund, or reimbursement? Tag it to a budget line (e.g. "Eating Out") and it reduces that line's actual spend for the cycle. Useful for net-of-refund tracking and treating cash income as an offset to specific categories.
- **AI PDF parsing (optional, opt-in, any SA bank)** — plug in a free Google Gemini API key and CapiTracker extracts transactions directly from any major SA bank's PDF statement (Capitec, FNB, Standard Bank, Nedbank, ABSA, TymeBank, Investec, Discovery). No per-bank parser needed — AI handles layout differences, and Gemini pulls the account number off the statement header so multi-account users see their accounts grouped correctly. Bring-your-own-key; the maintainer never sees your data or pays for your API calls.
- **Two sync modes** — separate **Sync CSV** (fast, ~5 sec) and **Sync PDF (AI)** (slow, ~3 min) buttons so CSV users aren't waiting on AI they don't need.
- **Dedup on import** — re-imports the same CSV without creating duplicate rows.
- **Multi-account merge** — all your accounts (main, credit card, savings, etc.) feed into one ledger, with each row tagged by account.
- **Self-healing Sheet** — schema changes auto-create missing tabs and columns on the next sync. No manual sheet surgery when upgrading the script.
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

## Security model

CapiTracker runs entirely in your own infrastructure: your Google account, your Sheet, your browser. There's no central server, no shared database, and the maintainer never sees your data. But since this tool touches financial data, the trust model is worth understanding.

### What protects your data

- Your **Google account** (with 2FA, hopefully) owns the Sheet that holds your transactions.
- A **single `SHARED_TOKEN`** you choose at setup gates every request from the HTML app to your Apps Script. Wrong token → rejected.
- The token and Web App URL live in your **browser's localStorage**, scoped to `milandekock.github.io`. They don't leave your browser except to hit your own Apps Script.

### Worst case if your token leaks

Someone with your **`SHARED_TOKEN` + Web App URL** can:
- Read every transaction, your budget, your rules, your settings.
- Trigger the Gmail scan and read any matched bank-statement CSVs.
- Overwrite or delete data in your Sheet. *Recoverable via Sheets version history.*

They **cannot:**
- Touch your bank account or move money — there's zero banking API access.
- Read any other Gmail beyond the hardcoded bank-statement query.
- Access any other Google service (Drive, Docs, Calendar, other Sheets).
- Send email from your address.
- Take over your Google account or see your password / 2FA.

**TL;DR — privacy loss is real, financial loss is zero.**

### Recovery (~5 min if it ever happens)

1. Apps Script → Deploy → Manage deployments → **archive** the current one.
2. Set a new `SHARED_TOKEN`. Create a new deployment (new URL).
3. Update your HTML's Setup tab with the new URL + token.
4. Sheet → File → Version history → restore anything that was tampered with.

### Defensive defaults

- Use a long random `SHARED_TOKEN` (32+ chars from a password generator). Don't commit it.
- Turn on **2FA on your Google account** if you haven't.
- Treat the Web App URL as semi-sensitive. It must be "Anyone with the link" for the architecture to work, but it shouldn't be on your public Twitter either.

### Residual risks

- **CDN supply chain.** The HTML loads React, ReactDOM, Babel, and PapaParse from public CDNs. Exact versions are pinned with **Subresource Integrity (SRI)** hashes — if a CDN swaps the file, your browser refuses to execute it. Tailwind's Play CDN serves dynamic CSS and can't be SRI'd, so that remains a small residual risk.
- **Trust in the maintainer.** GitHub Pages serves whatever's on `main`. A compromised maintainer account could push hostile code. Mitigation: 2FA on the maintainer account. For zero-trust users: fork the repo, audit the code, host your own GitHub Pages.
- **Gemini AI (only if you enable PDF parsing).** When you opt in, your PDF statement bytes are sent from your Apps Script to Google's Gemini API for parsing. Google's API data policy: no training on API inputs, 30-day abuse-prevention retention then deletion. Your API key lives in your own Apps Script Properties (encrypted by Google, never in the repo). If you don't set `GEMINI_API_KEY`, nothing gets sent to any AI service — the feature is fully opt-in. CSV-only users have zero AI exposure.

### Reporting a vulnerability

Please don't open public Issues for security problems. See [SECURITY.md](SECURITY.md).

## Contributing — help make this work for everyone

CapiTracker works for any major SA bank in **AI PDF mode** out of the box. CSV mode is still Capitec-only — that's where most contribution work is. Either way, contributions welcome:

- **Test PDF parsing with your bank** — if you bank with FNB, Standard Bank, Nedbank, ABSA, TymeBank, Investec, or Discovery, enable AI mode, run Sync PDF, and tell us how it goes. Worked perfectly? Open an issue confirming "AI mode works on `<bank>`". Hit a snag? Paste the relevant log + a few example rows the AI got wrong, we'll tune the prompt.
- **CSV parsers for other banks** — the CSV ingest in `apps_script.gs` is Capitec-specific. Adding FNB / Standard Bank / etc. is per-bank work — column header mapping, sign conventions. PRs welcome if you'd rather have CSV mode for your bank than rely on AI.
- **Bug reports** — anything weird, broken, or confusing, drop it in [Issues](https://github.com/MilanDeKock/capitracker/issues).
- **Feature ideas** — pay-cycle visualisations, alerts, mobile polish, export options. Open an issue first so we can chat before you build.

**The vision:** a free, open-source budgeting tool that works for every SA bank's CSV. You set it up yourself — which is half the fun — and the data stays in your own Google Sheet. No subscriptions and accounts.

## License

MIT — see [`LICENSE`](LICENSE).
