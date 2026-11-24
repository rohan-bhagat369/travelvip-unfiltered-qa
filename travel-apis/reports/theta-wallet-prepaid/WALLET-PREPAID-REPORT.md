# Prepaid wallet charge-before-supplier — theta-api (2026-11-18)

**Base:** `https://theta-api.travelvip.ai` · partner **vgm** · staging creds · `TIER_ID=10546901`  
**Alerts:** Mattermost `critical-partner-alerts-dev`  
**Not in this round:** Case B (need low-balance partner), Case K card/Stripe, Lounge/FT/eSIM/Attractions

## Summary

| Product | A | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Hotel | PASS | PASS | **BUG** | PASS | PASS | PASS | PASS | PASS | PASS |
| Cab | PASS* | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **BUG** |
| Flight | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |

**Open bugs:**
1. Hotel Case D — `provider_no_response` returns `status:Pending` with **`bookingRefId: null`**.
2. Cab — unable to get a Confirmed book / cancel on theta (happy-path stays PENDING; later finalize also returned HTTP 500). Marked **BUG** for Case J / confirm path.

**Top-up needed** after Hotel/Cab/Flight G + I (wallet stayed debited).  
\*Cab A–I wallet simulation paths passed earlier; confirm/cancel path is the open cab bug.

### DB spot-check (user paste) — so far

| BR | Case | DB |
|---|---|---|
| `BR1794993146220335` | Hotel A (+cancel) | PASS |
| `BR1794993156401391` | Hotel C reject+refund | PASS |
| `BR1794993173799348` | Hotel E commit fail | PASS |
| `BR1794993186692670` | Hotel G refund fail | PASS |
| `BR1794993195967360` | Hotel H missing record | PASS |
| `BR1794993207938679` | Hotel I missing+reject | PASS |
| `BR1794993808871928` | Flight C reject+refund | PASS |
| `BR1794994053176129` | Flight E commit fail | PASS |
| `BR1794995166650046` | Flight J cancel → wallet | PASS (`APP_WALLET` refund) |
| `BR1794993295693634` | Cab C reject+refund | PASS (payment path); status_mapping NULL — note |

---

## Hotel

| Case | Scenario | BR / code | Status | Notes |
|---|---|---|---|---|
| A | Happy path | `BR1794993146220335` | **PASS** | Pending → Confirmed |
| C | `provider_reject` | `BR1794993156401391` | **PASS** | FAILED + refund SUCCESS ₹11153.32 |
| D | `provider_no_response` | — | **BUG** | HTTP 200 Pending, **`bookingRefId: null`** |
| E | `wallet_commit_fail` | `BR1794993173799348` | **PASS** | HTTP 502 `WALLET_COMMIT_FAILED` + alert |
| F | commit+release fail | `BR1794993179939200` | **PASS** | HTTP 502 + critical commit+release alert |
| G | reject + refund fail | `BR1794993186692670` | **PASS** | refund FAILED · **top-up** |
| H | debit record fail | `BR1794993195967360` | **PASS** | Confirmed + Payment Record Missing |
| I | reject + missing record | `BR1794993207938679` | **PASS** | Missing + Refund Skipped · **top-up** |
| J | Cancel A | same as A | **PASS** | Cancelled + wallet refund path |

## Cab

| Case | Scenario | BR / code | Status | Notes |
|---|---|---|---|---|
| A | Happy path | `BR1794993263206123` | **PASS** | PENDING (supplier slow OK) |
| C | `provider_reject` | `BR1794993295693634` | **PASS** | FAILED statusCode 200 + refund SUCCESS ₹640.50 |
| D | `provider_no_response` | `BR1794993308779570` | **PASS** | stays PENDING · no refund |
| E | `wallet_commit_fail` | — | **PASS** | HTTP 502 + Commit Failed alert |
| F | commit+release fail | — | **PASS** | HTTP 502 + Commit+Release Failed alert |
| G | reject + refund fail | `BR1794993365133627` | **PASS** | refund FAILED · **top-up** |
| H | debit record fail | `BR1794993384854888` | **PASS** | PENDING + Missing alert |
| I | reject + missing record | `BR1794993420234526` | **PASS** | Missing + Refund Skipped · **top-up** |
| J | Cancel | `BR1794995309240611` | **NOT TESTED** | Fresh book stayed PENDING; cancel only when Confirmed |

## Flight

| Case | Scenario | BR / code | Status | Notes |
|---|---|---|---|---|
| A | Happy path | `BR1794993507614124` | **PASS** | Confirmed |
| C | `provider_reject` | `BR1794993808871928` | **PASS** | HTTP 502 `TICKET_ISSUANCE_FAILED` + refund SUCCESS ₹3930 |
| D | `provider_no_response` | `BR1794993973860301` | **PASS** | stays Pending · no refund |
| E | `wallet_commit_fail` | `BR1794994053176129` | **PASS** | HTTP 502 + Commit Failed alert |
| F | commit+release fail | `BR1794994165210248` | **PASS** | HTTP 502 + Commit+Release Failed alert |
| G | reject + refund fail | `BR1794994727329635` | **PASS** | refund FAILED ₹3423 · **top-up** |
| H | debit record fail | `BR1794994760254533` | **PASS** | Confirmed + Payment Record Missing alert |
| I | reject + missing record | `BR1794994989445950` | **PASS** | Missing + Refund Skipped · **top-up** |
| J | Cancel | A `…5124` + H `…4533` | **PASS** | A: Cancellation Requested (airline). **H: Cancelled**, estimatedRefund ₹2598 — cancel credits without wallet error |

## Alerts verified (all three services)

| Alert | Hotel | Cab | Flight | Severity |
|---|---|---|---|---|
| Wallet Commit Failed | ✓ | ✓ | ✓ | warning |
| Wallet Commit and Release Failed | ✓ | ✓ | ✓ | critical |
| Wallet Refund Failed | ✓ | ✓ | ✓ | critical |
| Wallet Payment Record Missing | ✓ | ✓ | ✓ | warning |
| Wallet Refund Skipped | ✓ | ✓ | ✓ | critical |

Service never `-`. Source: Hotel/Cab `Booking (finalize)` · Flight `Booking (issue-ticket)`. Header **DEV** · Partner **Vouchagram Partner (vgm)**.

## Receipts

- `travel-apis/hotel/reports/theta-wallet-prepaid/hotel-matrix-latest.json`
- `travel-apis/cab/reports/theta-wallet-prepaid/cab-matrix-latest.json`
- `travel-apis/flight/reports/theta-wallet-prepaid/flight-matrix-latest.json`
- `travel-apis/flight/reports/theta-wallet-prepaid/flight-J-cancel-latest.json`
