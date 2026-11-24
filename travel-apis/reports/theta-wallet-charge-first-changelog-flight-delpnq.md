# Theta wallet charge-first — Flight A–J (DEL→PNQ)

- Ran: 2026-11-18
- Base: `https://theta-api.travelvip.ai`
- Route: **DEL → PNQ** · date **2026-12-27** (OW; user also gave return 29 Dec — used for search smoke RT only)
- Fare ~₹5,983 · Partner `vgm`
- Raw: `theta-wallet-charge-first-changelog-flight-delpnq.json` · J follow-up `theta-flight-delpnq-j-d-followup.json`

| Case | Header | Verdict | BR / evidence |
|------|--------|---------|---------------|
| E | `wallet_commit_fail` | **PASS** | HTTP 502 `WALLET_COMMIT_FAILED`; balance unchanged |
| F | `wallet_commit_fail,wallet_release_fail` | **PASS** | HTTP 502; available −₹5,983 (hold retained) |
| C | `provider_reject` | **PASS** | HTTP 502 `TICKET_ISSUANCE_FAILED`; `refund.status=SUCCESS` ₹5983 + walletTxnId; balance restored |
| H | `wallet_debit_record_fail` | **PASS** | `BR1794997429614414` → Confirmed; charged (Mattermost/DB separate) |
| A | (none) | **PASS** | `BR1794997435876435` → **Confirmed**; charged |
| D | `provider_no_response` | **PASS** (recheck) | `BR1795000063318051` stayed **Pending** ×8 polls; wallet −₹5983; no refund. Earlier Confirmed BUG no longer reproduces. Raw: `theta-flight-case-d-pending-recheck.json` |
| G | `provider_reject,wallet_refund_fail` | **PASS** | HTTP 502; `refund.status=FAILED`, walletTxnId null; still charged |
| I | `provider_reject,wallet_debit_record_fail` | **PASS** | HTTP 502; refund FAILED; still charged |
| J + §1.5 wallet credit | cancel A | **PASS** (follow-up) | First probe used invalid `cancelledBy` → 400 (false PASS). Retry `cancelledBy=USER`: cancel Success, status **Cancelled**, wallet **+₹4,619.70** (refund net of penalty) |
| B / K | — | **NOT TESTED** | low-balance partner / Stripe |

### Notes
- Search on other metro routes still `VENDOR_ERROR`; **DEL–PNQ 27 Dec works**.
- Issue path: `POST /api/v2/flights/booking/issue-ticket` + `X-Simulate-Failure`.
- Cancel path: `POST /api/v2/flight/cancel` with `cancelledBy: USER|ADMIN|SYSTEM` only.
- Leftover Confirmed H/D cancelled in cleanup after scoring.
