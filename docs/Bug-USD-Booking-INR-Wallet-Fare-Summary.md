# Bug Report: USD booking fare summary / wallet debit in INR

**Environment:** Staging (`https://api-staging.travelvip.ai`)  
**Severity:** High  
**Services:** Flights + Hotels  
**Reproduced:** 2026-08-03T14:22:52.186Z

## Summary
When booking with `currency=USD`, pricing/finalize returns **USD** amounts correctly. After the booking is **Confirmed**, fetch booking **status/detail** shows fare summary in **INR** (flight clearly; wallet debit matches INR). Wallet amount deducted matches the **INR** totals, not the USD totals shown at book time.

## Expected
- Status/detail `salesSummary` stays in booked currency (**USD**) with same USD totals.
- Wallet debit uses the USD booking amount (or explicitly returns charged currency + FX rate).

## Actual

### Flight (API-confirmed bug)
| Step | Currency | Amount |
|------|----------|--------|
| Pricing / issue time | **USD** | baseFare **13.19** + taxes **1.10** = **14.29 USD** |
| GET booking **status** (`currency=USD`) | **INR** | basePrice **1200** + tax **100** = **1300 INR** |
| GET booking **detail** (`currency=USD`) | **INR** | same **1300 INR** |
| GET booking detail (`currency=INR`) | **INR** | same **1300 INR** |

- **BR:** `BR1785764940538353`
- **Route:** 6E 46 DEL→BOM (2026-09-14), Confirmed
- Passing `currency=USD` on status/detail **does not** keep `salesSummary` in USD — always INR.

**FX check:** 14.29 × 90.9645 ≈ **1299.88 INR** ≈ detail total **1300 INR**.  
Wallet debit matches this **INR** amount, not 14.29 USD.

### Hotel (reproduced + wallet mismatch)
| Step | Currency | Amount |
|------|----------|--------|
| Details / finalize time | **USD** | baseFare **1.28** + taxes **0.72** = **2.00 USD** |
| GET hotel detail (`currency=USD` or `INR`) | **USD** (label) | still shows **2.00** with `currency: "USD"` |
| Companion INR booking same hotel/dates | **INR** | **181.92 INR** |
| USD × rate (90.9645) | — | 2 × 90.9645 ≈ **181.93 INR** |

- **USD BR:** `BR1785766760194184` (Taj Dubai, Confirmed)
- **INR companion BR:** `BR1785766557509753` (Taj Dubai, ~181.92 INR)
- Hotel detail may still **label** amounts as USD, but wallet debit aligns with the **INR equivalent (~182 INR)**, not a true USD wallet ledger of 2 USD.
- Hotel **status** endpoint does not return `salesSummary` at all (no fare breakup on status).

## Steps to reproduce
1. Authenticate against staging.
2. Run search → pricing/details → issue-ticket/finalize with `currency=USD`.
3. Wait until booking status = Confirmed.
4. Call status + detail with `currency=USD`.
5. Compare `salesSummary` currency/amounts to USD pricing at book time; check partner wallet debit.

## Endpoints
- Flight issue: `POST /v1/flights/booking/issue-ticket?currency=USD`
- Flight status: `GET /v1/flights/booking/{br}/status?currency=USD`
- Flight detail: `GET /v1/flights/booking/{br}?currency=USD`
- Hotel finalize: `POST /v1/hotels/finalize-booking?currency=USD`
- Hotel status: `GET /v1/hotels/bookings/{br}/status?currency=USD`
- Hotel detail: `GET /v1/hotels/bookings/{br}?currency=USD`

## Impact
- Partner/client UI shows USD at checkout but INR after confirmation.
- Wallet balance drops by INR amount, causing confusion and incorrect reconciliation for USD bookings.
- `currency` query param on fetch booking APIs appears ignored for fare currency (flight).

## Ask to Dev
1. Persist and return booking currency on status/detail `salesSummary`.
2. Debit wallet in booked currency **or** return explicit `chargedCurrency`, `chargedAmount`, and FX rate.
3. Honor `currency=USD` on GET status/detail (convert display consistently, do not silently replace with INR base amounts without labeling).

## Evidence files
- `reports/flight/usd-booking.json`
- `reports/hotel/taj-dubai-usd-single.json`
- `reports/hotel/taj-dubai-single.json` (INR companion)
- `reports/shared/usd-booking-inr-wallet-bug.json` (this repro dump)
