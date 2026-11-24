# Nova vs Canary — Full Flight / Hotel / Cab payload compare

**When:** 2026-11-18 (~17:35–17:40 IST, retested)  
**Node:** `https://dev-nova-api.travelvip.ai`  
**Canary:** `https://canary-api.travelvip.ai`  
**Partner:** `vgm` · tier `10546901`  
**Auth:** Node `POST /v1/auth/session` still **400 Invalid tierId** → product calls used Canary JWT + Node partner key  
**Live book:** finalize / issue-ticket **not executed** (destructive; set `ALLOW_BOOK=1` to run)

**Coverage:** All unique Flight/Hotel/Cab (+ related callback) routes from Postman `nova-api` collection — request keys exercised, response status/`error.code`/top-level shape compared.

| | Count |
|--|--|
| PASS | 34 |
| WARN | 1 |
| DIFF / BUG | 1 (+ auth + extra flight mid-flow diffs below) |
| SKIPPED | 7 (3 live-book + 4 mid-flow until searchId recovered) |

Raw JSON: `other/_scratch/nova-full-payload-report.json`

---

## Short table for channel

| Domain | Method | Path | Canary | Node | Verdict |
|--------|--------|------|--------|------|---------|
| Auth | POST | `/v1/auth/session` | 200 | 400 `Invalid tierId` | **BUG** |
| Flight | GET | `/v1/flights/airports` | 200 | 200 | PASS |
| Flight | GET | `/v1/flights/airlines` | 200 | 200 | PASS |
| Flight | GET | `/v1/flights/citySearch` | 200 | 200 | PASS |
| Flight | POST | `/v1/flights/search` | 400 `VENDOR_ERROR` *(or 400)* | 200 / 400 `NO_FLIGHTS_FOUND` | **DIFF** |
| Flight | POST | `/v1/flights/details` | 200 (same shape) | 200 | PASS * |
| Flight | POST | `/v1/flights/fareRules` | 400 `VENDOR_ERROR` | 200 | **DIFF** * |
| Flight | POST | `/v1/flights/pricing` | 400 `VENDOR_ERROR` | 404 `SEARCH_ID_NOT_FOUND` | **DIFF** * |
| Flight | POST | `/v1/flights/ssr` | — | — | SKIP (no priceId; pricing failed) |
| Flight | POST | `/v1/flights/seatmap` | 400 `INVALID_REQUEST` / `VENDOR_UNAVAILABLE` | same | PASS (same errors) |
| Flight | POST | `/v1/flights/booking/issue-ticket` | — | — | SKIP (live book) |
| Flight | GET | `/v1/flights/booking/{BR}/status` | 200 / 404 | same | PASS |
| Flight | GET | `/v1/flights/booking/{BR}` | 200 | 200 | PASS |
| Flight | POST | `/v1/flights/booking/{BR}/cancel` | 200 `BOOKING_NOT_FOUND` / `VALIDATION_ERROR` | same codes | PASS |
| Flight | GET | `/v1/flights/bookings/history` | 200 | 200 | PASS |
| Hotel | GET | `/v1/hotels/autocomplete` | 200 | 200 | PASS |
| Hotel | POST | `/v1/hotels/search` | 200 | 200 | PASS |
| Hotel | POST | `/v1/hotels/details` | 200 | 200 | PASS |
| Hotel | POST | `/v1/hotels/prebook` | 200 | 200 | PASS |
| Hotel | POST | `/v1/hotels/finalize-booking` | — | — | SKIP (live book) |
| Hotel | GET | `/v1/hotels/bookings/{BR}/status` | 200 | 200 | PASS |
| Hotel | GET | `/v1/hotels/bookings/{BR}` | 200 | 200 | PASS |
| Hotel | GET | `/v1/hotels/bookings/history` | **200** | **500** `Internal Server Error` | **BUG** |
| Hotel | GET | `/v1/hotels/bookings/{BR}/cancel` | 200 `BOOKING_NOT_FOUND` | same | PASS |
| Cab | GET | `/v1/airportServices/cabs/locations` | 200 | 200 | PASS |
| Cab | POST | `/v1/airportServices/cabs/search` | 200 | 200 | PASS |
| Cab | POST | `/v1/airportServices/cabs/fare` | 200 | 200 | PASS |
| Cab | POST | `/v1/airportServices/cabs/finalize-booking` | — | — | SKIP (live book) |
| Cab | GET | status / details / tracking / cancel (stale BR) | 404 / 200 `BOOKING_NOT_FOUND` | same | PASS |
| Cab | GET | `/v1/airportServices/cabs/booking/history` | 200 | 200 | PASS |
| Ops | POST | flight/hotel/cab update + webhook + request-action | same 401/400/404 envelopes | same | PASS |

\* Mid-flow flight calls re-run with a live Node `searchId` (DEL–BOM `2026-12-15`) after search returned 200 on Node.

---

## Bugs / diffs to fix

### 1. Auth session — BUG
`GET /v1/tiers` → `[10546901]` but `POST /v1/auth/session` `{tierId:10546901}` → **400 Invalid tierId** on Node. Canary 200.

### 2. Hotel booking history — BUG
`GET /v1/hotels/bookings/history?lang=en&currency=INR`  
- Canary: **200** `{status,totalCount,page,perPage,bookings,_meta}`  
- Node: **500** `{"status":500,"info":"Internal Server Error"}` (not standard error envelope)

### 3. Flight search / fareRules / pricing — DIFF
Same DEL→BOM payload:
| API | Canary | Node |
|-----|--------|------|
| search | often `VENDOR_ERROR` | 200 with results **or** `NO_FLIGHTS_FOUND` |
| fareRules | `VENDOR_ERROR` | **200** fareRules payload |
| pricing | `VENDOR_ERROR` | **404** `SEARCH_ID_NOT_FOUND` (even right after successful details on same `searchId`) |

**Node pricing issue:** details succeeds for `searchId`, but pricing immediately says cache missing for that same id → blocks SSR (`priceId` never obtained).

---

## Request payloads covered (keys)

- Flight search: `itinerary, travellers, cabinClass, journeyType, currency, language, preferences, appliedFilters, selection`
- Flight details/fareRules/pricing: `journeyType, selection.selectedSearchIds`
- Flight SSR: `priceId` (blocked)
- Flight seatmap: `currency, requestReference, passengers`
- Hotel search/details: `checkin, checkout, entityId, nationality, type?, rooms`
- Hotel prebook: `bookingCode, requestId`
- Cab search: `journeyType, travelType, pickup, drop, distanceKm, durationMin, pickupDatetime`
- Cab fare: `searchId`

---

## Not executed (by design)

| API | Reason |
|-----|--------|
| `POST .../issue-ticket` | live ticket / wallet |
| `POST .../hotels/finalize-booking` | live hotel book |
| `POST .../cabs/finalize-booking` | live cab book |
| `POST .../ssr` | needs `priceId` from pricing |

Say if you want `ALLOW_BOOK=1` live book parity next.
