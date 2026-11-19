# Theta wallet charge-first — Flight A–J (2026-11-19)

- Base: `https://theta-api.travelvip.ai`
- Partner: `vgm` · tier `10546901`
- Cab: skipped
- Routes used: DEL–GOI / DEL–PNQ / BOM–DEL (inventory flaky; date stepped)
- Raw: `theta-wallet-charge-first-changelog-flight-full-2026-11-19.*` · `…-flight-aij-retry-…` · `…-flight-hd-recheck-…` · Case B: `theta-case-b-k-2026-11-19.json`

| Case | Sim / action | Verdict | Evidence |
|------|--------------|---------|----------|
| A | happy book | **PASS** | `BR1795085917199887` issued (Pending→cancel path); charged −₹4,757 |
| B | low balance | **PASS** | earlier today HTTP 403 `INSUFFICIENT_BALANCE` (need ₹12,414 / avail ₹5,213.31); no charge — not re-forced after top-up |
| C | `provider_reject` | **PASS** | 502 `TICKET_ISSUANCE_FAILED`; `refund.status=SUCCESS` ₹6,552 + walletTxnId; balance restored |
| D | `provider_no_response` | **BUG** | `BR1795086092715867` (and earlier `BR1795085364531396`) became **Confirmed** after Pending polls — expected stay Pending / no supplier success |
| E | `wallet_commit_fail` | **PASS** | 502 `WALLET_COMMIT_FAILED`; balance unchanged |
| F | `wallet_commit_fail,wallet_release_fail` | **PASS** | 502; hold retained (−₹6,552 available) |
| G | `provider_reject,wallet_refund_fail` | **PASS** | 502; `refund.status=FAILED`, walletTxnId null; still charged −₹4,757 |
| H | `wallet_debit_record_fail` | **PASS** | recheck `BR1795086058563137` → **Confirmed**; charged. (Earlier `BR1795084580431254` → Failed flake) |
| I | `provider_reject,wallet_debit_record_fail` | **PASS** | 502; refund FAILED; still charged −₹4,757 |
| J | cancel Case A | **PASS** | cancel Success; `BR1795085917199887` → **Cancelled** (PNR FYDPPW) |
| K | Card/Stripe | **NOT TESTED** | vgm B2B wallet-only; need shop/Stripe partner |

### Summary
**9 PASS / 1 BUG / 1 NOT TESTED** (Flight only; cab skipped)

### Open
1. **Case D BUG** — `provider_no_response` still reaches Confirmed (supplier path not blocked).
2. **Case K** — needs non-wallet / Stripe path.
3. Mattermost / DB alert checks for E/F/G/H/I — not verified from this runner.
