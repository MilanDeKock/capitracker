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
