# Security policy

## Reporting a vulnerability

If you find a security issue in CapiTracker, **please don't open a public GitHub Issue.**

Use GitHub's private reporting flow instead:

**[Privately report a vulnerability →](https://github.com/MilanDeKock/capitracker/security/advisories/new)**

(You'll need a GitHub account. The report is sent privately to the maintainer.)

I'll respond within a few days. If it's a real issue, I'll credit you in the fix's release notes — with your permission.

## In scope

- Vulnerabilities in code shipped from this repo: `budget_tracker.html`, `setup_wizard.html`, `index.html`, `apps_script.gs`.
- Trust-model issues you think users should know about.

## Out of scope

- Issues in third-party dependencies (React, Tailwind, Babel, PapaParse, Google Apps Script). Report those upstream.
- Issues that require an attacker to already control your Google account or local browser.
- "I lost my own token" — open a regular Issue or DM instead.

## Supported versions

There's one version: the current `main` branch. No patched releases.

## AI PDF parsing — data flow disclosure

If you opt in to AI PDF parsing by setting a `GEMINI_API_KEY` in your Apps Script Properties:

- Your PDF statement bytes are sent from your Apps Script to **Google's Gemini API** for parsing.
- Per [Google's API data policy](https://ai.google.dev/gemini-api/terms): API inputs are **not used to train models**, and are retained for up to 30 days for abuse-prevention then deleted.
- Your API key lives in **your own Apps Script Properties** (encrypted at rest by Google, never in this repo, never visible to the maintainer).
- The feature is **fully opt-in**. If you don't set the key, no data is ever sent to any AI service. CSV-only users have zero AI exposure.

If you don't want this trust relationship, **don't enable the feature** — CapiTracker works exactly as it did before. You can also revoke the API key at [aistudio.google.com](https://aistudio.google.com/app/apikey) at any time.
