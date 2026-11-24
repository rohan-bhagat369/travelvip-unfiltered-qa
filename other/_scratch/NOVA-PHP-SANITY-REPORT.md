# Nova (Node) vs existing Dev (Canary) — Flight / Hotel / Cab sanity

**When:** 2026-11-18  
**Node:** `https://dev-nova-api.travelvip.ai`  
**Existing Dev:** `https://canary-api.travelvip.ai`  
**Partner:** `vgm` · **tierId:** `10546901`  
**Collection/env:** Postman `nova-api` + `nova-api_dev`  
**Probe:** `other/_scratch/nova-php-sanity-compare.mjs` · raw `nova-php-sanity-report.json`

## Verdict

Hotels and Cabs request/response shapes match on successful calls.  
**Blocking auth gap on Node session.**  
**Flight search behaviour / error mapping does not match Canary** for the same payload.

---

## Discrepancies

### 1. Auth session — BUG (blocks native Node product auth)

| Step | Canary | Node |
|------|--------|------|
| `POST /auth/partner/token` | 200 `access_token` | 200 `access_token` |
| `GET /v1/tiers` | 200 → `[10546901]` | 200 → `[10546901]` |
| `POST /v1/auth/session` `{ "tierId": 10546901 }` | **200** `auth_token` | **400** `PARTNER_AUTH_SESSION_ERROR` / `Invalid tierId` |

Same partner secret and tier from the shared Postman Dev env. Node lists the tier, then rejects it on session.

**Workaround used for product probes:** mint `auth_token` on Canary, call Node with Canary JWT + Node `X-Partner-Key`. Node product routes accept that JWT (shared auth trust), which confirms the break is in **Node session minting**, not in partner token or tier listing.

### 2. Flight search — response / error parity DIFF

Same request (collection-aligned; `currency` query + body; no `fareType` unless noted):

`POST /v1/flights/search?lang=en&currency=INR&page=0&perpage=20`  
Body: DEL→BOM one-way, 1 ADT, ECONOMY, preferences.maxStops=2.

| Side | HTTP | Outcome |
|------|------|---------|
| Canary | **400** | `error.code = VENDOR_ERROR` · message `Search failed.` |
| Node | **200** | Success envelope with `progress.state=COMPLETE`, `results[]` (options + displayPricing) |

With `fareType: "CORPORATE"` both returned **400**, but codes differed:

| Side | `error.code` | message |
|------|--------------|---------|
| Canary | `VENDOR_ERROR` | Search failed. |
| Node | `NO_FLIGHTS_FOUND` | No flights available for given criteria |

Node success shape (observed):  
`journeyType`, `tripType`, `currency`, `currencyConversion`, `progress`, `timingReference`, `selection`, `results`, `totalResults`, `filters`, `sorts`, `cacheTimeStamp`, `_meta`  
(`results[0]` → `direction` + `options[]` with `searchId`, pricing, etc.)

Canary did not return a 200 body for this route during the run, so field-level success-shape parity vs Canary could not be confirmed.

### 3. Request contract notes (both sides agree — not Node-only bugs)

These are collection gotchas; Node and Canary return the **same** validation codes when inputs are wrong:

| API | Required |
|-----|----------|
| `GET /v1/flights/airports` | `airport=` (not only free-text) |
| `GET /v1/airportServices/cabs/locations` | `query=` **or** lat/long |
| Cab `pickupDatetime` | UTC `YYYY-MM-DDTHH:MM:SSZ` (**no** millis) |
| Flight search | `currency` on **query** (and body); missing → validation both sides |

---

## Matching areas (PASS)

| Area | Endpoints | Status / shape |
|------|-----------|----------------|
| Flight meta | `GET /v1/flights/airports?airport=BOM…` | Both 200 · keys `status,result,totalResults,_meta` · sample rows align |
| Flight meta | `GET /v1/flights/citySearch?q=Pune…` | Both 200 · keys `status,results,_meta` · rows align |
| Hotel | `GET /v1/hotels/autocomplete?q=mumbai&page=0` | Both 200 · same item keys (`type,title,city,…,entityId,…`) · same totals |
| Hotel | `POST /v1/hotels/search` CITY `357389:IN` | Both 200 · `totalResults=527` · result/price/address keys match |
| Cab | `GET …/cabs/locations?query=Pune` | Both 200 · `locations,_meta` |
| Cab | `POST …/cabs/search` RENTAL | Both 200 · 9 cabs · top/item/vehicle/price keys match (IDs differ per search, expected) |

---

## Suggested engineering follow-ups

1. **Fix Node `POST /v1/auth/session`** for partner `vgm` / tier `10546901` (tier listed but rejected).  
2. **Align flight search:** Canary `VENDOR_ERROR` vs Node 200 / `NO_FLIGHTS_FOUND` — decide intended contract (vendor passthrough vs normalized empty).  
3. Re-run flight search success-shape compare once Canary returns 200 for the same criteria (or point “existing Dev” at a host that still serves search).

---

## How to re-run

```bash
node other/_scratch/nova-php-sanity-compare.mjs
```

Uses Postman Dev env credentials when root `.env` partner keys are missing.
