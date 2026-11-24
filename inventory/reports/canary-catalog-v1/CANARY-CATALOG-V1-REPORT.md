# Canary catalog_v1 — Lounge + Fast Track + eSIM (2026-11-18)

**New flow:** `https://canary-api.travelvip.ai` · partner **vgm** (wallet)  
**Collections used:**  
- `Downloads/api_services_booking.apidog.json` → vgm finalize-booking  
- `Downloads/web_services_bookings.apidog.json` → smt create-booking + Stripe (card not run this pass)

**Old flow note:** `canary-shop.travelvip.ai` returns SPA HTML for `/api/*`. Old `api/airportServices/...` probes run on **canary-api** with legacy `pid` + `key`.

## Channel table

| Case | Lounge | Fast Track | eSIM |
|---|---|---|---|
| P0 search | PASS | PASS | PASS |
| W1 wallet finalize | **BUG/CHECK** `PROVIDER_BOOKING_FAILED` BR `BR1794998574429848` | **PASS** `BR1794998581462583` | **PASS** `BR1794998590788249` |
| R1 status | NT (no success book) | PASS | PASS |
| R2 details | NT | PASS | PASS |
| R3 history | NT | PASS | PASS |
| W4 missing partner key | **BUG** (still hit provider / not 401) | **BUG** (booked `BR1794998588124652` without partner key) | **BUG** (booked `BR1794998604239445`) |
| W6 currency USD | PASS `CURRENCY_MISMATCH` | PASS | PASS |
| V1 empty body | PASS | PASS | PASS |
| V2 bad bookingContext | PASS `INVALID_BOOKING_CONTEXT` | PASS | PASS |
| I1 same X-Request-Id | CHECK | CHECK | CHECK |
| Old L5 history | PASS (on canary-api + legacy key) | — | — |
| Old L8 offers | PASS (needs serviceType) | — | — |

## DB spot-check (user paste)

| BR | Product | booking_flow | Verdict |
|---|---|---|---|
| `BR1794998581462583` | fast_track | `catalog_v1` | PASS |
| `BR1794998590788249` | esim | `catalog_v1` | PASS |
| `BR1794998574429848` | lounge (provider fail) | `catalog_v1` | PASS (new flow tagged) |
| Gate columns | lounge / ft / esim | varchar(16) NULL no default | PASS |

## Open issues

1. **Lounge W1** — API `PROVIDER_BOOKING_FAILED` but row exists with `catalog_v1`. Confirm wallet released + status Failed (not a free book).
2. **W4** — omitting `X-Partner-Key` still allows Fast Track / eSIM finalize (expected 401/403). Possible auth bug.
3. **Card / smt** web collection not executed this pass.
4. **canary-shop** is front-end only for these paths; use canary-api for API regression.

## DB checks (paste results)

```sql
-- Gate
SHOW COLUMNS FROM booking_item_lounge LIKE 'booking_flow';
SHOW COLUMNS FROM booking_item_fast_track LIKE 'booking_flow';
SHOW COLUMNS FROM booking_item_esim LIKE 'booking_flow';

-- Fast Track W1 (expect booking_flow = catalog_v1)
SET @br := 'BR1794998581462583';
SELECT b.booking_reference, bi.id, bi.service_type,
       lounge.booking_flow AS lounge_flow, ft.booking_flow AS ft_flow, esim.booking_flow AS esim_flow
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_item_lounge lounge ON lounge.booking_item_id = bi.id
LEFT JOIN booking_item_fast_track ft ON ft.booking_item_id = bi.id
LEFT JOIN booking_item_esim esim ON esim.booking_item_id = bi.id
WHERE b.booking_reference = @br;

-- eSIM W1
SET @br := 'BR1794998590788249';
SELECT b.booking_reference, bi.id, bi.service_type,
       lounge.booking_flow AS lounge_flow, ft.booking_flow AS ft_flow, esim.booking_flow AS esim_flow
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_item_lounge lounge ON lounge.booking_item_id = bi.id
LEFT JOIN booking_item_fast_track ft ON ft.booking_item_id = bi.id
LEFT JOIN booking_item_esim esim ON esim.booking_item_id = bi.id
WHERE b.booking_reference = @br;

-- Lounge failed provider
SET @br := 'BR1794998574429848';
SELECT b.booking_reference, bi.id, bi.service_type,
       lounge.booking_flow AS lounge_flow, ft.booking_flow AS ft_flow, esim.booking_flow AS esim_flow
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_item_lounge lounge ON lounge.booking_item_id = bi.id
LEFT JOIN booking_item_fast_track ft ON ft.booking_item_id = bi.id
LEFT JOIN booking_item_esim esim ON esim.booking_item_id = bi.id
WHERE b.booking_reference = @br;
```

## Receipts

- `inventory/reports/canary-catalog-v1/matrix-latest.json`
- Probe: `inventory/scripts/probe-canary-catalog-v1-matrix.js`
