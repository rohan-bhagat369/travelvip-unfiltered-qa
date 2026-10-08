# Flight booking — DB mapping checks (`travelx`)

Reusable phpMyAdmin pack for verifying API flight bookings against DB.

**DB:** `travelx` (staging)  
**How:** paste SQL in phpMyAdmin → SQL tab (select `travelx` first)  
**Last verified:** 2026-09-24 · BR `BR1790243528138745` · **core mapping PASS**

Related artifacts:
- SQL twin: `docs/sql/flight-db-mapping-checklist.sql`
- Prior packs: `scripts/book-zeta-db-pack.js`, `scripts/probe-flight-db-pack-staging-p0.js`
- Sheet: `TravelVIP_Flight_DB_TestCases.xlsx` (V001+)

---

## Expected chain (PASS)

```
1 booking
 → 1 booking_item (service_type = flight)
 → flight_journey × legs (OW=1, RT=2)
 → booking_passenger × pax (exactly 1 is_lead=1)
 → flight_journey_passenger cells = journeys × pax
```

Plus money: `booking.total_amount` ≈ `booking_item.total_amount` ≈ `payment.total_amount` (paise).

---

## Schema gotchas (do not use wrong column names)

| Table | Wrong | Correct / notes |
|---|---|---|
| `booking_status_mapping` | `code` | `status_code`, `backend_status`, `user_status` |
| `booking_passenger` | `dob`, `passenger_type` | `date_of_birth`, `role` |
| `flight_journey` | `stops` | use `direction`, `airline_pnr` (no `stops`) |
| `booking` | `currency` | often absent; use `total_amount` only |
| `payment_transaction` | `booking_id`, `txn_type` | join via `payment` → `payment_id`; use `transaction_type` |
| Amounts | assume rupees | booking/item/payment usually **paise** (`735100` = ₹7351) |
| Offers | columns on booking/item | separate tables: `booking_item_offer`, `offer`, `order_discounts` |

`#1142 pma__recent` = phpMyAdmin bookmark ACL noise — ignore.

---

## Checklist

### A — Core mapping

| # | Table | What to check |
|---|---|---|
| A1 | `booking` | `booking_reference`, `confirmed_at` set, `cancelled_at` NULL |
| A2 | `booking_item` | 1 flight item; `version`; status via mapping `300` / CONFIRMED |
| A3 | `booking_passenger` | pax count; names; exactly one `is_lead=1`; `role` |
| A4 | `flight_journey` | 1 row/leg; OD; `airline_pnr` |
| A5 | `flight_journey_passenger` | cell per pax×journey; `eticket_number`, `vendor_pnr`, `pnr_override`; cell status |
| A6 | scorecard | `cells = journeys × pax` → PASS |

### B — Also queried

| # | Table | What to check |
|---|---|---|
| B1 | `booking_status_mapping` | via `current_status_mapping_id` on item + cells |
| B2 | `flight_segment` | connecting ≠ segments × pax |
| B3 | `cancellation_request` | full / partial / return-leg (empty if not cancelled) |
| B4 | `cancellation_passenger` | which pax cancelled |
| B5 | `passenger_meal` / `passenger_baggage` / `passenger_seat` | SSR |
| B6 | `booking_item_flight` | no leftover `refresh%` columns |
| B7 | `payment` + `payment_transaction` | totals + AUTH/CAPTURE |

### C — Price

| # | Check |
|---|---|
| C1 | `booking.total_amount` = `booking_item.total_amount` = `payment.total_amount` |
| C2 | `vendor_price_cents` ≤ total; gap = fee/markup unless offer row exists |
| C3 | `payment_transaction.amount` unit (may be rupees while parent is paise — note it) |

### D — Offer / discount (optional)

| # | Table | What to check |
|---|---|---|
| D1 | `booking_item_offer` | row for `booking_item_id`? `discount_amount` (paise) |
| D2 | `offer` | join on `offer_id` |
| D3 | `order_discounts` | legacy `order_id` / `order_item_id` — **not** flight `booking_id` |

---

## Last verified fixture (2026-09-24)

**BR:** `BR1790243528138745`  
**IDs:** booking `4352` · item `4319` · journey `182` · pax `6179` · cell `211` · payment `3931` · txn `4027`

| Check | Result |
|---|---|
| A1–A6 | **PASS** (OW 1ADT, cells 1×1=1) |
| Status | item + cell `300` CONFIRMED / Confirmed |
| PNR / eticket | journey `7OS9ZG`; cell vendor_pnr `BX24HI0027`; eticket `0985014506148` |
| Price | total **735100** paise (₹7351); vendor **700100**; gap **35000** (₹350) |
| Payment | stripe FULL captured; txn AUTH success amount `7351` (unit NOTE) |
| Offer | **none** — `booking_item_offer` empty for item 4319 |
| Segments / cancel / SSR | NOT TESTED on this BR |

---

## How to re-run for a new BR

1. Set `@br` in `docs/sql/flight-db-mapping-checklist.sql`.
2. Run block A → pin `@booking_id` / `@booking_item_id` from results.
3. Run price + offer blocks.
4. Score with the tables above; append a row under “Run log” below.

### Run log

| Date | BR | Env | Core | Price | Offer | Notes |
|---|---|---|---|---|---|---|
| 2026-09-24 | BR1790243528138745 | travelx / staging | PASS | PASS (txn unit NOTE) | N/A (none) | OW 1ADT DEL→BOM |
| 2026-09-24 | BR1790248015189900 | travelx / staging | PASS | PASS (txn unit NOTE) | **PASS** — offer_id 2374, discount 314 paise | OW 1ADT DEL→BOM; vendor 700100 − 314 = total 699786 |
