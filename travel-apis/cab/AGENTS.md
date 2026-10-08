# Cab API — agent memory

Date synced: **2026-10-08**

Clients: `travel-apis/cab/src` · Scripts: `travel-apis/cab/scripts` · Reports: `travel-apis/cab/reports`

**Merged from:** cab error-contract / property-matrix / multipax / DOB agents (Sep 2026 staging). Full narrative was previously under root `AGENTS.md` Cab section.

## Cab (Error Contract pack — when asked)

Full PDF matrix you shared is saved for automation (not part of hotel/flight `b2b:regression`):

| Artifact | Path |
|---|---|
| Full contract (93 rows) | `travel-apis/cab/src/regression/cab-error-contract-full.json` |
| QA CSV | `Cab API Error Contract - Validations.csv` |
| Runnable cases | `travel-apis/cab/src/regression/errorContractCases.js` |
| Runner | `travel-apis/cab/src/regression/runErrorContract.js` |
| Docs | `docs/CAB-API-ERROR-CONTRACT.md` |

```bash
npm run cab:regression:validate:staging
npm run cab:regression:validate:canary
npm run cab:export:error-contract
```

Open bug (2026-09-03): **HI-1** omit `userId` â†’ HTTP 200 instead of 400 `VALIDATION_ERROR`.

Also open (error-contract staging 2026-09-11): **UB-5** provider booking id mismatch accepted. **SR-9** product now says RENTAL pickupâ‰ drop is by design (P2P booked as rental) — still HTTP 200 + inventory on staging 2026-09-17.

Product-fix retest (`travel-apis/cab/scripts/probe-cab-product-fix-retest.js` â†’ `reports/cab-product-fix-retest.json`, staging **2026-09-17**):
- **Landed:** DOB format/future/HTML â†’ 400 `VALIDATION_ERROR`; title `"Mr,"` / gender `"other"` â†’ 400; `countryCode` `"999"` and `"+999"` â†’ 400 (calling-code table); omit `distanceKm`/`durationMin` â†’ HTTP 400 `SEARCH_REJECTED`; locations `query` comma/HTML â†’ 400 `VALIDATION_ERROR`.
- **Still BUG vs claimed fix:** omit/empty `profile.dob` still books; age vs `paxType` still books (ADT~7y / CHD~25y / INF~8y); garbage `priceId` still books; cancel `cancellationReason` HTML still 200.
- **By design (confirmed):** omit `priceId` books; `isLead:false` books; `otherDetails` HTML books; nationality optional; OUTSTATION/RENTAL status `airportCode` filled (`PNQ`); pickup/drop name special chars still 200; places autocomplete special chars still 200.

Flow+response audit (`travel-apis/cab/scripts/probe-cab-flow-all-types.js` â†’ `reports/cab-flow-all-types-audit.json`):
- Search/fare pricing field is **`priceDetail`** (not `price`) — confirmed live all 4 types. Probe aligned to Postman trees in `reports/cab-response-property-trees.json`.
- OUTSTATION + RENTAL status `airportCode` populated (e.g. `PNQ`) — product says expected (vendor needs it).
- E2E per type (searchâ†’fareâ†’finalizeâ†’Confirmedâ†’cancel): all 4 types PASS on staging.

### Property matrix (staging 2026-09-11)

Probe: `node travel-apis/cab/scripts/probe-cab-property-matrix.js` â†’ `reports/cab-property-matrix.json`.

Full pos/neg per request field + response schema vs Postman trees (locations, places, searchÃ—4 types, fare, finalize, cancel, update-booking, status/details/tracking/history).

Last run (after soft reclass): see report `summary` + `bugThemes`. Top themes: special-char accepted on search name/city; airportCode garbage â†’ HTTP 200 `NOT_FOUND`; distance/duration omit â†’ 200 `VENDOR_REJECTED`; finalize bad `priceId` accepted; weak finalize pax/contact; cancel HTML reason accepted; HI-1; OUTSTATION/RENTAL `airportCode`.

### Multipax limit (staging 2026-09-11)

Probe: `node travel-apis/cab/scripts/probe-cab-multipax-limits.js` â†’ `reports/cab-multipax-limits.json`.

**Hard limit = 1 passenger** on finalize for **all** journey types (AIRPORT_DEPARTURE / ARRIVAL / OUTSTATION / RENTAL).  
2+ ADT, 3 ADT, ADT+CHD, 2 leads â†’ HTTP 400 `VALIDATION_ERROR` *â€œOnly one passenger is allowed for a cab booking.â€*  
0 / omit passengers â†’ 400 *â€œPassenger first name is required.â€* (not a dedicated empty-array message).  
`paxType` allowed: `ADT`, `CHD`, `INF`; garbage â†’ 400 with allowed list.  
Last run: **36 PASS / 0 BUG / 4 NOTE** (NOTE = `isLead:false` hit name-digit validation on fixture `Pax1` before lead rule).

### DOB / birthdate on finalize (staging 2026-09-17 retest)

Probe: `node travel-apis/cab/scripts/probe-cab-dob-validations.js` (full matrix) and `travel-apis/cab/scripts/probe-cab-product-fix-retest.js`.

**Partial fix:** garbage / HTML / wrong format / future DOB â†’ HTTP 400 `VALIDATION_ERROR`.  
**Still BUG:** omit / empty `dob` still HTTP 200 book; age vs `paxType` (ADT/CHD/INF) still HTTP 200 book.

---

## When the user asks for a change

- Prefer existing clients and pack layers; clone/mutate one field.
- Add the case to the matching layer or spawned probe **and** add a row to this file **and** `Travel VIP API — QA Test Suite - Hotel.csv` when applicable.
- Keep hotel/flight pack cases in sync with `D:\Travel VIP B2B API Automation\AGENTS.md` when you change cases.
- Do not add lounge/cab/esim/fast-track or reschedule happy path unless asked.
- Do not run the full E2E pack unless asked (it books multiple live tickets). Smoke/VALIDATE first when checking wiring.



