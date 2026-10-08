# Cab API — Error Contract Validations

**Source (user-shared):** `Cab-API-Error-Contract.pdf`  
**Controller:** `CabBookingController.php` (v3/b2b-api)  
**Saved for automation:** 2026-09-03

## Where things live

| Artifact | Path | Use |
|---|---|---|
| Full PDF matrix (every message you shared) | `src/cab/regression/cab-error-contract-full.json` | Source of truth for all contract rows |
| QA CSV | `Cab API Error Contract - Validations.csv` | Sheet / tracking |
| Automated cases (runnable) | `src/cab/regression/errorContractCases.js` | Pack IDs + expect HTTP/`error.code` |
| Runner | `src/cab/regression/runErrorContract.js` | Executes automated + filter cases |
| Probe CLI | `scripts/probe-cab-error-contract.js` | Live staging/canary |
| Reports | `reports/cab-error-contract-*.json` | Last run (gitignored) |

## Commands

```bash
# Default: VALIDATE + FILTERS + LIVE on current BASE_URL (.env)
npm run cab:regression:validate

# Staging / canary explicitly
npm run cab:regression:validate:staging
npm run cab:regression:validate:canary

# Payload-only (no live book)
node scripts/probe-cab-error-contract.js --tags VALIDATE,FILTERS
```

Env helpers:
- `CAB_BOOKING_REF` — real BR on **same** env for UB-5 (`PROVIDER_BOOKING_ID_MISMATCH`)
- `CAB_WEBHOOK_USER` / `CAB_WEBHOOK_PASS` — WH-1 empty-body with valid Basic Auth

## Error envelope (every controller error)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "…",
    "details": null,
    "timestamp": "2026-08-31T09:12:44Z",
    "request_id": "req-…"
  },
  "_meta": { "correlation_id": "…" }
}
```

Some codes add keys: `availablePackages`, `available`/`required` (paise), `currentStatus`, `cancellationRequest`, `bookingRefId`, `result`.

## Endpoints covered in the saved PDF matrix

1. `GET /v1/airportServices/cabs/locations`
2. `POST /v1/airportServices/cabs/search`
3. `POST /v1/airportServices/cabs/fare`
4. `POST /v1/airportServices/cabs/finalize-booking` (+ wallet / FARE_EXPIRED)
5. `POST /v1/airportServices/cabs/update-booking`
6. `POST /v1/airportServices/cabs/partner-webhook`
7. `GET /v1/airportServices/cabs/{bookingId}/status`
8. `GET /v1/airportServices/cabs/booking/{bookingId}`
9. `GET /v1/airportServices/cabs/tracking/{bookingId}/location`
10. `GET /v1/airportServices/cabs/booking/history`
11. `GET|POST /v1/airportServices/cabs/bookings/{bookingId}/cancel`

Plus **FILTERS** (locations query/coords, places autocomplete) used by partners.

## Automation coverage note

- Rows with `"automated": true` in `cab-error-contract-full.json` are executed by the runner.
- Rows with `"automated": false` are **saved from your PDF** for the pack to grow — add an executor in `runErrorContract.js` when ready.
- Last live open bug (2026-09-03): **HI-1** omit `userId` → HTTP 200 empty list instead of 400 `VALIDATION_ERROR` (staging + canary).

## Import in other scripts

```js
import { CAB_ERROR_CONTRACT_CASES } from '../src/cab/regression/errorContractCases.js';
import full from '../src/cab/regression/cab-error-contract-full.json' with { type: 'json' };
import { runCabErrorContract } from '../src/cab/regression/runErrorContract.js';
```
