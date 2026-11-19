# Mattermost E–I alerts — 2026-11-19

- Channel: `critical-partner-alerts-dev`
- Partner: Vouchagram Partner (`vgm`) · DEV
- Raw: `theta-wallet-mattermost-efi-2026-11-19.json` · `theta-wallet-mattermost-efi-detail-2026-11-19.json`

Expected (changelog):
- **E** → Commit Failed (warn); Hold Released Yes; Provider Called No
- **F** → Commit+Release Failed (critical) only — no twin Commit Failed
- **G** → Refund Failed (critical)
- **H** → Payment Record Missing (warn); Wallet Charged Yes
- **I** → Payment Record Missing + Refund Skipped

## Hotel

| Case | BR | Mattermost | Verdict |
|------|-----|------------|---------|
| E | `BR1795082879986356` | ⚠️ Commit Failed · Hold Released **Yes** · Provider Called **No — booking aborted** | **PASS** |
| F | `BR1795082889920346` | 🚨 Commit and Release Failed · Provider Called No · **no** separate Commit Failed | **PASS** |
| G | — | case not run today (wallet) | **NOT TESTED** |
| H | `BR1795082960448054` | ⚠️ Payment Record Missing · Wallet Charged **Yes** | **PASS** |
| I | `BR1795082930303131` | ⚠️ Payment Record Missing + 🚨 Refund Skipped | **PASS** |

## Flight

| Case | BR | Mattermost | Verdict |
|------|-----|------------|---------|
| E | `BR1795084563564784` | ⚠️ Commit Failed · Hold Released **Yes** · Provider Called **No** · Source issue-ticket | **PASS** |
| F | `BR1795084569811467` | 🚨 Commit and Release Failed · Provider Called No · **no** twin Commit Failed | **PASS** |
| G | `BR1795085536658169` | 🚨 Refund Failed · ₹4,757 | **PASS** |
| H | `BR1795086058563137` (also `BR1795084580431254`) | ⚠️ Payment Record Missing · Wallet Charged **Yes** | **PASS** |
| I | `BR1795085979614259` | ⚠️ Payment Record Missing + 🚨 Refund Skipped | **PASS** |

## Summary
**Mattermost: 9 PASS / 0 BUG / 1 NOT TESTED** (Hotel G)

## DB
**NOT TESTED** — no MySQL/phpMyAdmin credentials in this workspace `.env` (prior Nov-18 DB scores were manual phpMyAdmin on `travelx`). SQL template remains `theta-wallet-charge-first-db-checks.sql`; swap in today's BRs above to finish.
