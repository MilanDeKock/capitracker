# Demo data for screenshots

Generic dummy data you can use to take clean screenshots of CapiTracker without exposing real personal finances. One full pay cycle (25 April → 24 May 2026), 38 transactions across realistic SA merchants.

## What to do

### 1. Load the transactions

Easiest path: in the CapiTracker app, click the **Drop CSV** button (or drag `demo/transactions.csv` onto the upload zone).

Alternative: email `demo/transactions.csv` to your demo Gmail account, then hit **Sync Gmail**.

> **CSV sign convention:** This demo file follows Capitec's format — `Money Out` and `Fee` are stored as **negative** numbers. The app's actuals calculation depends on this (spends have `amount < 0`). If you adapt this CSV for another bank, keep the same signing: positive `Money In`, negative `Money Out`, negative `Fee`.

### 2. Set Net Income + Anchor Day

Go to **Setup** tab (or **Budget** tab, top section) and set:

| Setting | Value |
|---|---|
| Net Income | `25000` |
| Anchor Day | `25` |

### 3. Add Budget lines

Go to the **Budget** tab. Enter each line:

| Line | Monthly Budget (R) |
|---|---|
| Rent | 8500 |
| Groceries | 4000 |
| Transport | 2200 |
| Utilities | 1100 |
| Subscriptions | 650 |
| Eating Out | 1200 |
| Savings | 3000 |
| Insurance | 850 |
| Medical | 600 |
| Personal | 700 |
| Reimbursable | 0 |
| Review | 0 |

**Total: R22,800** (leaves a R2,200 surplus on paper)

### 4. Add Rules

Go to the **Rules** tab. Add each rule:

| Line | Type | Match Value |
|---|---|---|
| Rent | desc | happy homes |
| Savings | desc | easyequities |
| Groceries | cat | Groceries |
| Groceries | desc | woolworths |
| Transport | cat | Fuel |
| Transport | cat | Parking |
| Transport | cat | Public Transport |
| Utilities | cat | Electricity |
| Utilities | cat | Telecoms |
| Subscriptions | cat | Digital Subscriptions |
| Eating Out | cat | Restaurants |
| Eating Out | cat | Takeaways |
| Eating Out | cat | Alcohol |
| Insurance | cat | Medical Aid |
| Medical | cat | Pharmacy |
| Personal | cat | Clothing & Shoes |
| Personal | cat | Sport & Hobbies |
| Personal | cat | Household |

These will auto-classify ~35 of the 38 transactions. The leftovers (Reimbursement, the EasyEquities deposit if rule isn't applied, etc.) will sit in **Review** so the classification UX is visible in the screenshot.

### 5. Pick the Running Watch line

On the Dashboard, set the **Running watch** dropdown to **Eating Out**. The cumulative spend (~R1,825) will exceed the R1,200 budget around 14 May, so the last few rows show as red — a clean visual of the over-budget indicator.

## What the data shows

- **Income:** R25,000 salary on 25 April + R500 reimbursement on 24 May
- **Total spending:** ~R22,500 over the cycle
- **Over budget:** Eating Out (R1,825 vs R1,200 budget) — the red-row hero
- **Under budget:** Most other lines
- **Mix of accounts:** 38 transactions across groceries, fuel, restaurants, subscriptions, etc.

## Want to commit this folder?

Currently `.gitignore` excludes `*.csv` at any depth, so `demo/transactions.csv` stays local. If you want to commit it as a reusable fixture for other contributors:

1. Add `!demo/*.csv` to `.gitignore` to allow this folder through.
2. Commit `demo/`.

Otherwise, this is purely your local working directory for screenshots.
