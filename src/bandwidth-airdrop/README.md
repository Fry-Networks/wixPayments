# Bandwidth Miner Airdrop CLI

One-off operational CLI that scans Wix orders (plus the specified off-platform orders) to automatically mint and email `$FRY Bandwidth Miner` keys to eligible node purchasers. The tool mirrors the safety rails found in the AI Edge Miner CLIs: dry-run analytics by default, strict eligibility evaluation, consolidated customer email delivery, admin-friendly exports, and optional execution mode once you confirm the plan.

## Features

- **Wix order ingestion**: Reads your pre-filtered CSV export (`src/bandwidth-airdrop/wix-eligible-orders/wix-eligible-orders-BM-airdrop.csv` by default) and applies optional email/order filters locally.
- **Eligibility engine**:
  - counts node purchases using both legacy `$FRY …` and modern “Fry …” product names (`Compute`, `Storage`, `Storage Validator`, `Contributor`),
  - requires payment status `PAID`,
  - accepts fulfillment statuses `FULFILLED`, `PARTIALLY_FULFILLED`, `NOT_FULFILLED/UNFULFILLED`,
  - excludes canceled/refunded orders,
  - injects special orders `99137`, `99140`, `HeliumDeploy*` by reading existing node devices from Mongo,
  - ensures one Bandwidth Miner per node (offsetting any already minted keys).
- **Dry-run first**: CLI runs in planning mode unless you pass `--execute`; exports JSON/CSV artifacts for audit.
- **Execution safeguards**: `--execute` requires typing `CONFIRM`. Supports `--skip-email` if you want to mint keys now but email later.
- **Email handling**: Reuses the Gmail transporter + unsubscribe links; groups keys per recipient for safer bulk sending.
- **Gmail safety rails (bulk runs)**: Sends 1 email per recipient (all keys bundled), applies per-recipient pacing, and retries transient/rate-limit errors with exponential backoff (BM airdrop only).
- **Exports**: Writes `bandwidth-airdrop-exports/<timestamp>/` with:
  - `bandwidth-airdrop-report.json` (full payload),
  - `eligible-orders.csv` (per-order summary),
  - `award-plan.csv` (per-email minting plan),
  - `minted-keys.csv` (only on execute; includes raw BM keys—treat as sensitive).

## Prerequisites

- All standard WixPayments env/secret requirements: `npm install`, 1Password CLI (`op signin`), Mongo connection, Gmail OAuth documents.
- For development runs, use the `.1p.env.dev` profile; production runs should use `.1p.env.prod`.

## npm Script

`package.json` exposes the script:

```bash
npm run bandwidth-airdrop
```

Running it **without arguments** opens an interactive menu (similar to the AI Edge Miner CLI) with:

1. **Dry Run + Export** – choose CSV/email/order filters and produce JSON/CSV reports.
2. **Execute Airdrop** – opens a submenu:
   - **Generate Keys Only** (mints keys to Mongo, no emails)
   - **Send Emails Only** (sends only for `email_sent=false` BM airdrop keys; no minting)
3. **Preview Eligibility Stats** – see counts without generating files (optional export afterwards).
4. **Single Order Generate + Send** – target one order number, optionally override the delivery email, cap the quantity, and mint/send just those keys.
5. **Resend Bandwidth Miner Email by Order** – pull all BM keys for an order from Mongo and resend them to the stored email (or an override) without re‑minting anything.
6. **Cleanup BM Airdrop Docs** – remove AEM-only schema fields accidentally set on BM airdrop documents (uses the `mintedKeys` list from an export directory).

Under the hood each option runs:

```bash
op run --env-file ./.1p.env.dev -- \
  node --import ./register-ts-node.js src/bandwidth-airdrop/cli.ts
```

If you prefer to run it headlessly (CI/automation), append flags after `--`, e.g.:

```bash
npm run bandwidth-airdrop -- --csv ./my-wix-export.csv --orders 12345,12346
```

You can also swap the env file to `.1p.env.prod` when executing against production data.

## Common Flags

| Flag | Description |
|------|-------------|
| `--csv path/to/file.csv` | Override the default Wix CSV path. |
| `--execute` | Switches from dry run to live mode (requires confirmation prompt). |
| `--skip-email` | Generates devices but skips Gmail sends (can email later). |
| `--emails email1,email2` | Restrict to specific customer emails. |
| `--orders 123,456` | Restrict to specific order numbers (strings). |
| `--export-dir ./custom-dir` | Override output directory for reports. |

> Tip: combine `--emails` with `--execute --skip-email` to test live minting for a small set of addresses before larger runs.

## Gmail Rate Limiting

Bulk sends are paced and retried only for the Bandwidth Miner airdrop flows (normal runtime emails are unchanged). You can tune behavior via environment variables:

| Env var | Default | Meaning |
|--------|---------|---------|
| `BANDWIDTH_AIRDROP_GMAIL_DELAY_MS` | `1100` | Delay before each recipient email send. |
| `BANDWIDTH_AIRDROP_GMAIL_MAX_RETRIES` | `6` | Retries for transient/rate-limit failures. |
| `BANDWIDTH_AIRDROP_GMAIL_BACKOFF_BASE_MS` | `2000` | Base backoff for exponential retry. |
| `BANDWIDTH_AIRDROP_GMAIL_BACKOFF_MAX_MS` | `60000` | Max delay between retries. |
| `BANDWIDTH_AIRDROP_EMAIL_BATCH_SIZE` | `20` | Number of recipient emails per batch. |
| `BANDWIDTH_AIRDROP_EMAIL_DELAY_BETWEEN_BATCHES_MS` | `15000` | Delay between recipient batches. |

## Example Workflows

### 1. Interactive Dry Run

```bash
npm run bandwidth-airdrop
```

Select option **1**, provide any filters when prompted, and review the exported files before moving to execution.

> **CSV prerequisite**  
> Export the list of BM-eligible orders from Wix into `src/bandwidth-airdrop/wix-eligible-orders/wix-eligible-orders-BM-airdrop.csv` (or provide a custom path when prompted/with `--csv`). The CLI no longer queries the Wix API; it trusts this CSV.

### 2. Headless Dry Run With Custom CSV + Export Directory

```bash
npm run bandwidth-airdrop -- \
  --csv ./my-wix-export.csv \
  --export-dir ./bandwidth-dryruns
```

Review the exported JSON/CSV files to see counts, order reasons for exclusion, and the final minting plan.

### 3. Targeted Live Run (Emails Deferred)

```bash
npm run bandwidth-airdrop -- \
  --execute \
  --skip-email \
  --orders 12345 \
  --emails alice@example.com
```

You will be prompted to type `CONFIRM` before any devices are created. Keys are stored in Mongo; rerun without `--skip-email` or use the resend option to deliver emails later.

### 4. Full Live Run Using Default CSV

```bash
npm run bandwidth-airdrop -- --execute
```

You will still be prompted to type `CONFIRM` before minting begins.

## Output Summary

After every run the CLI logs:

- fulfillment/payment status breakdowns,
- how many orders were eligible vs. excluded (with reasons stored in the export),
- total Bandwidth Miners needed vs. already existing,
- per-email email_send statistics (or skipped counts if unsubscribed or `--skip-email`),
- error array if any key creation or email send failed.

Use the exported JSON to keep an immutable record of what was planned/executed.

## Notes

- Because this is a one-time airdrop, the CLI does not register any cron or server hooks; run it manually whenever you need to reconcile outstanding Bandwidth Miner giveaways.
- The special non-Wix orders are resolved directly from Mongo, so make sure the historical node devices for those orders exist before executing the airdrop.
- For production execution, ensure the Gmail quota can handle the number of emails in one batch.

Happy airdropping! 🎁
