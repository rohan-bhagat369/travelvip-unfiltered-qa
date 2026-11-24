# Nexus handoff — verify these BRs

**Env:** ak-api + `https://dev-nexus.travelvip.ai` · partner `vgm` · surname `Confirmed`  
**List:** Flight Booking → `/bookings/flights` · search by BR  

API side done 2026-11-19 ~17:10 IST. You own Nexus UI checks.

## Fresh fixtures (use these) — booked 19 Nov ~20:57 IST

**Host:** `https://ak-api.travelvip.ai` · staging vgm creds · surname `Confirmed`

| BR | Type | API status | What to check on Nexus |
|----|------|------------|------------------------|
| **BR1795102051513893** | OW 1ADT PNQ→DEL | **Confirmed** | **A7 recheck** after online cancel · Money Kept (no Other deductions duplicate) |
| **BR1795102053842655** | RT 2ADT PNQ↔DXB | **Confirmed** | **Dev repro:** offline cancel **both** pax → refuse 1 + settle 1 → Money card must not say 2 pax cancelled |

### Prior fixtures (already used)

| BR | Type | API status | What to check on Nexus |
|----|------|------------|------------------------|
| **BR1795088345226462** | OW 1ADT PNQ→DEL | Cancelled (C1) | A7 still showed Other deductions ₹350 |
| **BR1795088348919454** | RT 2ADT PNQ↔DXB | Partly cancelled #99 | Banner retest FIXED |
| **BR1795088373763911** | OW 1ADT PNQ→DEL | **Cancelled** (API) | A12 · A7 still Other deductions |

Open detail via list “Open booking”, or search BR. Cancelled OW detail may be under Cancelled filter.

## Already used earlier (optional re-check)

| BR | Notes |
|----|--------|
| `BR1795087352240506` | OW — API Cancelled earlier |
| `BR1795087355209478` | RT — Nexus offline #97 settled; desk banner bug (claimed all pax cancelled; PAX2 still travelling) |

## Suggested Nexus order

1. Open **BR1795088373763911** (Cancelled) → A12 + refund/money  
2. Open **BR1795088345226462** (OW Confirmed) → B1/B2 → C1 Cancel with airline (if you want live online)  
3. Open **BR1795088348919454** (RT Confirmed) → B3 raise offline → desk E1–E3 → F1  

## API evidence files

- `ak-ow-rt-confirmed.json` — OW+RT Confirmed  
- `api-ow2-cancel.json` — OW API PENALTY+CANCEL → Cancelled  
- `RESULTS.md` — suite results so far  
