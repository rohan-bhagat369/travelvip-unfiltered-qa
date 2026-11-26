# ENG-826 catalog_v1 — PASS report (API + DB) — gamma — 25 Nov 2026

**Env:** `https://gamma-api.travelvip.ai`  
**Partners:** `vgm` (B2B wallet) · `smt` (web/card + Stripe)  
**Task:** [ENG-826](https://tracker.travelvip.ai/tasks/ENG-826)  
**QA:** Rohan · **Dev:** Chaitanya  

**Verdict:** PASS for signoff scope · **0 BUG** · DB checks included  

---

## 1) Wallet (vgm) — PASS

| Case | What | Lounge | Fast Track | eSIM | Evidence |
|---|---|---|---|---|---|
| **W1** | Valid finalize | PASS `BR1795610839130093` | PASS `BR1795610852413742` | PASS `BR1795610867502945` | Pending; `booking_flow=catalog_v1` |
| **W4** | Missing partner key | PASS | PASS | PASS | `MISSING_HEADER` |
| **W6** | Currency mismatch | PASS | PASS | PASS | `CURRENCY_MISMATCH` |
| **W7** | Wallet disabled | PASS | PASS | PASS | `WALLET_UNAVAILABLE` (no BR) |
| Collection **W1** | Apidog body finalize | PASS `BR1795610988365558` | PASS `BR1795610992581719` | — | |

---

## 2) Card / Stripe (smt) — PASS

| Case | What | Lounge | Fast Track | eSIM | Evidence |
|---|---|---|---|---|---|
| **C1** | create-booking + PI | PASS | PASS | PASS | Stripe PI returned |
| **C2** | Pay → booking | PASS `BR1795610988147578` | PASS `BR1795610992626024` | PASS | Collection + remaining |
| **C3** | Webhook-only (no booking call) | PASS | PASS | PASS | Status progressed |
| **C5** | Replay booking | PASS | PASS | PASS | Same BR |
| **C6** | Concurrent book race | PASS | PASS | PASS | `PAYMENT_PROCESSING_CONFLICT` |
| **C7** | Book before pay / unknown | PASS | PASS | PASS | `PAYMENT_TRANSACTION_NOT_FOUND` |
| **C8** | Missing PI | PASS | PASS | PASS | `VALIDATION_ERROR` |
| **C9** | Unknown PI | PASS | PASS | PASS | `PAYMENT_TRANSACTION_NOT_FOUND` |
| **C10** | Wrong product PI | PASS | PASS | PASS | reject |
| **C11** | Other partner payment | PASS | PASS | PASS | reject |

---

## 3) Reads — PASS

| Case | What | Lounge | Fast Track | eSIM |
|---|---|---|---|---|
| **R1** | Status | PASS | PASS | PASS |
| **R2** | Booking details | PASS | PASS | PASS |
| **R3** | History | PASS | PASS | PASS |

---

## 4) update-booking — PASS

| Case | What | Lounge | Fast Track | eSIM | Evidence |
|---|---|---|---|---|---|
| **U1** | → CONFIRMED | PASS | PASS | PASS | |
| **U2** | → CANCELLED | PASS `BR1795610894418515` | PASS | PASS | Refund completed |
| **U3** | → FAILED | PASS `BR1795610896447811` | PASS | PASS | Refund completed |
| **U4** | Double CONFIRMED | PASS | PASS | PASS | |
| **U5** | Confirm after cancel ignored | PASS | PASS | PASS | |
| **U6** | Bad payload | PASS | PASS | PASS | `VALIDATION_ERROR` |
| **U7** | Unknown BR | PASS | PASS | PASS | `BOOKING_NOT_FOUND` |
| **U8** | Partner check | PASS | — | — | FT/eSIM = CHECK (not listed here) |

---

## 5) Acceptance (via update proxy) — PASS

| Case | What | Lounge | Fast Track | eSIM |
|---|---|---|---|---|
| **A1** | Keep on CONFIRMED | PASS | PASS | PASS |
| **A2** | Keep on PENDING | PASS | PASS | PASS |
| **A4** | CONFIRMED + supplier status=0 | PASS | PASS | PASS |

---

## 6) Validations — PASS

| Case | What | Lounge | Fast Track | eSIM |
|---|---|---|---|---|
| **V1** | Required fields | PASS | PASS | PASS |
| **V2** | Bad bookingContext | PASS | PASS | PASS |
| **V3** | Tampered context | PASS | PASS | PASS |
| **V6** | No lead passenger | PASS | PASS | PASS |
| **V7** | Past travelDate | PASS | PASS | N/A (no travelDate) |

---

## 7) Idempotency — PASS

| Case | What | Lounge | Fast Track | eSIM |
|---|---|---|---|---|
| **I3** | Non-identical replay not same | PASS | PASS | PASS |

---

## 8) Old flow — PASS

| Case | What | Result | Evidence |
|---|---|---|---|
| **L1** | Old create (new context) | PASS | Option not in catalog / 400 (key OK) |
| **L2** | Old booking route | PASS | Payment txn not found (route exercised) |
| **L4** | Old updateAirportServiceBooking | PASS | 200 update |
| **L5** | Old booking history | PASS | List OK |
| **L6** | Old list missing serviceType | PASS | `serviceType is required` |
| **L7** | New status on history BR | PASS | Correct product gate |
| **L8** | Legacy key `ojny1swtigd4as` | PASS | Key matched |

---

## 9) DB checks — PASS

| # | Check | Tables / columns | Result | Evidence |
|---|---|---|---|---|
| **DB1** | Column gate | `booking_item_lounge.booking_flow` · `booking_item_fast_track.booking_flow` · `booking_item_esim.booking_flow` | PASS | `varchar(16)` NULL, no default |
| **DB2** | New flow tag | same `booking_flow` | PASS | All 7 W1/C2 BRs = `catalog_v1` on correct product |
| **DB3** | Lead passenger | `booking_item_passenger.is_lead` | PASS | `lead_count=1` on 5 BRs |
| **DB4** | Wallet payment | `payment` · `payment_transaction` | PASS | `provider=wallet`, `captured`, one `CAPTURE/success` each |
| **DB5** | Card payment | `payment` · `payment_transaction` | PASS | `provider=stripe`, `captured`, `AUTH/success` |
| **DB7** | Old flow NULL | product `booking_flow` | PASS | Recent old-path rows still NULL |
| **DB8** | Status history | `booking_item_status_history` + `booking_status_mapping` | PASS* | W1 Pending→Confirmed; U2 Pending→Cancelled |
| **DB9** | Refunds | `refund_transaction` | PASS | Cancel + Failed → `completed`, wallet, amount 305485 |
| **DB10** | Sales summary | `booking_item_sales_summary` | PASS | `paid_amount=total_amount`, `due_amount=0`, `is_current=1` |

\*DB8 CHECK (not in PASS list): `BR1795610894418515` later got **Confirmed** after Cancelled — for Chaitanya.

### DB2 BRs (`booking_flow = catalog_v1`)

| BR | Product | Flow |
|---|---|---|
| `BR1795610839130093` | lounge | `catalog_v1` |
| `BR1795610852413742` | fast_track | `catalog_v1` |
| `BR1795610867502945` | esim | `catalog_v1` |
| `BR1795610988365558` | lounge | `catalog_v1` |
| `BR1795610992581719` | fast_track | `catalog_v1` |
| `BR1795610988147578` | lounge | `catalog_v1` |
| `BR1795610992626024` | fast_track | `catalog_v1` |

### DB4 wallet payments

| BR | payment_id | total_amount | txn | status |
|---|---|---|---|---|
| `BR1795610839130093` | 5352 | 305485 | CAPTURE 5725 | success |
| `BR1795610852413742` | 5357 | 525053 | CAPTURE 5730 | success |
| `BR1795610867502945` | 5362 | 4705 | CAPTURE 5735 | success |

### DB5 card payments

| BR | payment_id | provider | txn | status |
|---|---|---|---|---|
| `BR1795610988147578` | 5411 | stripe | AUTH 5793 | success |
| `BR1795610992626024` | 5413 | stripe | AUTH 5795 | success |

### DB9 refunds

| BR | refund_id | amount | destination | status |
|---|---|---|---|---|
| `BR1795610894418515` | 863 | 305485 | SOURCE | completed |
| `BR1795610896447811` | 864 | 305485 | SOURCE | completed |

---

## Not in this PASS list (still open / CHECK / NT)

| Item | Status |
|---|---|
| W3 low-balance | NOT TESTED (ops) |
| W8 / C12 offers | NOT TESTED (ops) |
| C13 uncaptured auth | NOT TESTED (ops) |
| V8 offer down | NOT TESTED (ops) |
| L3 old webhook | NOT TESTED (ops) |
| W2 fail-sim | CHECK (header ignored) |
| V4 fake offerId | CHECK (offers not on vgm) |
| wallet_ledger | NOT TESTED (no writes since Aug 2026; debit via `payment`) |
| BR1795610894418515 Cancel→Confirmed | CHECK (for Dev) |
| U8 FT/eSIM, I1/I2/I4, C4, W5 | CHECK |

---

## Signoff summary

| Area | Result |
|---|---|
| Wallet book + W7 disabled | PASS |
| Card create / pay / webhook / race | PASS |
| Reads + updates + validations | PASS |
| Old-flow key / routes | PASS |
| DB `catalog_v1` + lead + pay + refund + sales | PASS |
| Open bugs | **None** |
