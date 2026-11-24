# SMT card matrix — delta-api (2026-11-13)

**Base:** `https://delta-api.travelvip.ai` · `pid=smt` · `key=palsgcvgscvvs` · `tier_id=10997401`  
**Auth:** `GET /api/checkGuestLogin` · payment: Stripe CARD  
**DB:** paste per-BR SQL in phpMyAdmin → `travelx` (one by one)

## Scoreboard

| # | Scenario | BR | Status | Stripe PI | Notes |
|---|---|---|---|---|---|
| 1 | **FAIL** (vendor / bad PAN) | `BR1794556749304734` | **PASS** | `pi_3UbFO6EWyGwVPuvk1sit4eud` | Paid then **Failed**; msg path = bad PAN `AAAAA0000A` |
| 1b | Invalid PAN format | — | **PASS** | — | HTTP 400 `VALIDATION_ERROR`, no BR |
| 2 | **CONFIRM** | `BR1794556830640046` | **PASS** | `pi_3UbFPPEWyGwVPuvk0tKLghHx` | Confirmed `SNHAPI00011741` · ₹9400.74 (`940074`) |
| 3 | **DOUBLE book** | same as #2 | **PASS** | same PI | Replay create → same BR/PI; attach `Booking already processed` |
| 4 | **CANCEL** | same as #2 | **PASS** | (expect Stripe refund) | Free cancel · charge 0 · refund 9400.74 → **Cancelled** |

### Discarded / noise
| BR | Why |
|---|---|
| `BR1794556759441491` | Intended confirm but **Failed** — PAN name mismatch (`BhagatOk` vs PAN). Still useful for FAIL DB. |
| Earlier books | `BR1794555145766910`, `BR1794554712975108` — prior confirmed card smokes |

## DB check order (one by one)

1. **FAIL** → `db-BR1794556749304734-FAIL.sql`  
   Expect: booking Failed · stripe payment CAPTURE · then REFUND (auto) · `user_actions` payment_success + booking_failed
2. **CONFIRM+DOUBLE+CANCEL** → `db-BR1794556830640046-CANCEL.sql` (full pack)  
   Or step: CONFIRM.sql → DOUBLE.sql (same BR, one CAPTURE) → CANCEL.sql (cancellation_request + REFUND)
3. Combined: `db-MATRIX-all.sql` (older FAIL + first confirm attempt — prefer files above)

## API expect vs DB

| Scenario | API expect | DB focus |
|---|---|---|
| FAIL after pay | Failed | `payment` stripe + CAPTURE + **REFUND**; status trail → failed |
| CONFIRM | Confirmed once | `confirmed_at` set; `paid_amount` = total; one CAPTURE |
| DOUBLE | same BR, no 2nd charge | **one** payment / one CAPTURE for BR |
| CANCEL | Cancelled + refund | `cancellation_request` + `refund_transaction` + `payment_transaction` REFUND |
