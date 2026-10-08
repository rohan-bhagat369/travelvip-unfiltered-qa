# Flight B2B — agent memory (this domain)

**Paths:** `travel-apis/flight/src` · `travel-apis/flight/scripts` · `travel-apis/flight/reports`  
**Shared:** `shared/lib` · `shared/config`  
**Synced:** **2026-10-08** · Tracker: **ENG-290** · **ENG-297** · **QA-24**

## Merged from other agents
- Body below includes memory from sibling `D:\Travel VIP B2B API Automation\AGENTS.md` (synced **2026-10-07**: ALLOW_BOOK, INVENTORY/RESPSCHEMA tags, L2B date buckets, release gate).
- TBO live books + tripType airports are **this** repo’s flight agent work (Oct 2026).

## Oct 2026 — airports tripType (ENG-297)
- `GET /v1/flights/airports?tripType=domestic|international` — domestic = India-only; international/omit = unfiltered; do not send legacy `domestic=`
- Staging 2026-10-01: **33 PASS / 0 BUG** + leak scan **29 PASS**
- Probe: `travel-apis/flight/scripts/probe-flight-airports-triptype.js`

## Oct 2026 — TBO staging books (QA-24)
| BR | Scenario | Status |
|----|----------|--------|
| BR1791300381444156 | OW DOM BOM–GOI · 2 ADT · SSR | Confirmed |
| BR1791300463267996 | RT DOM BOM–BLR · 2 ADT · SSR | Confirmed |
| BR1791300499871517 | RT INTL DEL–DXB · 2 ADT · SSR | Confirmed |

Failed OW INTL: no PNR / `PNR_NOT_FOUND`; no Mattermost BR alert. Live TBO sessions when user says no loop: **stop + Mattermost**. `INSUFFICIENT_BALANCE` → abort remaining cases.

## Pack entry
- `npm run flight:regression` → `travel-apis/flight/scripts/flight-regression-suite.js`

---
# TravelVIP B2B hotel + flight â€” agent memory

**Read this file first** before changing code, adding cases, or reporting results. Update this file whenever a flow, rule, or case changes so every agent stays on the same page.

- Repo: travel-vip-b2b-api-automation (hotel + flight only)
- Staging: `https://api-staging.travelvip.ai`
- Partner: `vgm` Â· `TIER_ID=10546901` Â· secrets in `.env` (never commit)
- Clients: `travel-apis/hotel/src`, `travel-apis/flight/src`, `shared/lib/authService.js`, `shared/lib/TravelVipClient.js`
- Date this memory was last synced: **2026-10-07** (hotel stay date stepping â‰¥+15)

This workspace is **hotel + flight only**. Lounge, cab, eSIM, fast-track, suburb packs, and one-off book scripts do not live here.

### TravelVIP Tracker (daily work log)

| Work | Tracker task | URL |
|------|----------------|-----|
| **This repo** (Hotel + Flight B2B API automation) | **ENG-290** | https://tracker.travelvip.ai/tasks/ENG-290 |
| Byufuel / Centvis UCO | **QA-19** | https://tracker.travelvip.ai/tasks/QA-19 |
| TravelVIP UI Automation (Playwright) | **QA-22** | https://tracker.travelvip.ai/tasks/QA-22 |
| Personal day index (all projects) | **QA-21** | https://tracker.travelvip.ai/tasks/QA-21 |

**After any testing / pack / probe day on this repo:** post an Activity comment on **ENG-290** (date Â· commands/tags Â· PASS/BUG/NOT TESTED Â· fixture BRs Â· next step). Also add one short line on **QA-21** rollup linking to ENG-290. New product bugs â†’ separate ENG/QA tasks; keep ENG-290 as the hub.

---

## How to work

1. Build or reuse a **valid baseline** payload (search â†’ price / prebook as needed).
2. For each rule: **clone â†’ mutate only that field â†’ call API**.
3. **PASS** = HTTP status + `error.code` match docs. Branch on **`error.code`**, not the message.
4. **BUG** = invalid payload accepted (e.g. HTTP 200 book) **or** wrong code/envelope **or HTTP 500** on bad input.
5. **NOT TESTED** is not a fail (inventory missing, no 2nd partner, Inprogress left, tag not run).
6. Do **not** call a harness row â€œFAILâ€ when the API returned the correct `VALIDATION_ERROR`.
7. Special chars / extra commas / HTML must be **HTTP 4xx with `error.code`**, **never HTTP 500**, never accepted as 200.
8. Save reports under `reports/` (gitignored). Pack probes live under `scripts/probe-*.js`.
9. Never put **Riya** in fareRules, bookingCode, or any request/response we send. Vendor leak = BUG.
10. Do not commit `.env`. Do not commit unless the user asks.

### Reporting format

Give tables: **Rule | How tested | Status (PASS / BUG / NOT TESTED)**. Number rows **1, 2, 3â€¦ per section**. For bugs: Expected vs Actual with **exact payload + response**. Summarize PASS / BUG / NOT TESTED counts.

The HTML report compares the new run with `reports/<suite>-regression/latest.json` before that file is overwritten. **Since the last report** says **This run matches the last run** when every case kept the same status. When a case moved, it is one sentence, such as passed in the last run and failed in this run. That block links to `previous.html`, a copy of the last HTML saved before the new run overwrites `latest.html`. The first run, or a rewrite of the same `ranAt`, says there is no earlier report to compare.

### Error envelope (hotel cancel + flight cancel)

```json
{ "error": { "code": "...", "message": "...", "details": [], "timestamp": "...", "request_id": "..." } }
```

Duplicate-cache (`duplicate: true`) can force HTTP 200 on a replayed error. `scoreReject` and the flight date-format probe mark that **PASS** when the replay still has an `error.code` (for example `BOOKING_NOT_FOUND` or `VALIDATION_ERROR`). HTTP 200 with no error code stays **BUG**. Do not invent a new bug if the first call already failed correctly.

### Auth hop (every live hotel/flight call)

1. `POST /auth/partner/token` â†’ `access_token` + `refresh_token`
2. `POST /auth/partner/refresh` (optional / pack AUTH)
3. `POST /v1/auth/session` with `X-Partner-Key` = partner access_token and body `{ tierId }` â†’ `auth_token`
4. Product calls: `Authorization: Bearer {auth_token}` plus `X-Partner-Key` = partner access_token

Pin one `X-Correlation-ID` for the whole session. Do not replace it from the response.

---

## Commands

| Command | What it runs |
|---|---|
| `npm run b2b:regression` | Hotel then flight. **Books live tickets.** |
| `npm run b2b:regression:smoke` | Autocomplete/search/encrypt/correlation â€” **no book** |
| `npm run hotel:regression` | Hotel default pack |
| `npm run flight:regression` | Flight default pack |
| `npm run hotel:regression:validate` | `--tags AUTH,VALIDATE` |
| `npm run flight:regression:validate` | `--tags AUTH,VALIDATE` |
| `npm run probe:auth` | Token / refresh / session only |
| `npm run probe:flight:faretypes` | Search fareTypes facet + filter (OW + RT). Spawned by `--tags SEARCH` |
| `npm run hotel:regression:deploy` | `--tags UNAVAIL,STARSRP,CHAINBRAND,CHAINBRANDVAL` on **api-staging** (search/details only â€” no book) |
| `npm run hotel:regression:unavail` | `--tags UNAVAIL` |
| `npm run hotel:regression:starsrp` | `--tags STARSRP` |
| `npm run hotel:regression:chainbrand` | `--tags CHAINBRAND` |
| `npm run hotel:regression:chainbrandval` | `--tags CHAINBRANDVAL` (optional name spot-checks) |
| `npm run hotel:regression:negprice` | `--tags NEGPRICE` (search/details â€” no negative baseFare/breakup) |
| `npm run hotel:regression:respschema` | `--tags RESPSCHEMA` (autocompleteâ†’prebook; +finalizeâ†’cancel if ALLOW_BOOK) |
| `npm run flight:regression:respschema` | `--tags RESPSCHEMA` (catalogsâ†’pricing; +issueâ†’cancel if ALLOW_BOOK) |

QA sheet: `Travel VIP API â€” QA Test Suite - Hotel.csv` (rows 157â€“224 = deploy pack cases).

Hotel default tags: `SMOKE,LISTING,STARBOOK,UNAVAIL,STARSRP,CHAINBRAND,CHAINBRANDVAL,NEGPRICE,AUTH,VALIDATE,RESPSCHEMA,ENCRYPT,CORR,PAN,GST,E2E,PRICE,CANCEL`  
Flight default tags: `SMOKE,SEARCH,INVENTORY,AUTH,VALIDATE,RESPSCHEMA,CORR,E2E,PRICE,CANCEL`  
`--tags VALIDATE` also adds `AUTH`. `--tags PRICE` or `CANCEL` also adds `E2E`. Exit **1** if any row is **BUG**.

### ALLOW_BOOK (hotel + flight)

**Only this flag controls live bookings** (not BASE_URL). It defaults to **false** â€” booking
is opt-in, so a runner with no `.env` (CI, a fresh clone) cannot issue real tickets by
omission, and an unparseable value falls back to not booking. `npm run test:e2e` is the one
script that opts in for you; `ALLOW_BOOK=false` / `--no-book` still overrides it. Set in `.env`:

| Value | Effect |
|---|---|
| `true` / `1` | Run E2E / PRICE / CANCEL / PAN / GST + finalize / issue-ticket VALIDATE |
| `false` / `0` | Strip those book tags; skip hotel finalize VALIDATE, flight issue-ticket VALIDATE, and the SEARCH date probe's issue-ticket DOB/passport cases (D1â€“D5, P1â€“P5 â†’ NOT TESTED) |
| unset | Defaults to **false** â€” booking is opt-in |

```bash
# .env
ALLOW_BOOK=false

npm run hotel:regression    # must print: ALLOW_BOOK: false â€¦
npm run flight:regression
```

CLI override: `npm run hotel:regression -- --no-book`

---

## Release gate (differential, discovery only)

Before a production release: `npm run release:gate -- --candidate <rc-url>`. Runs the no-book
API gate (hotel â†’ **prebook**, flight â†’ **pricing**; never finalize / issue-ticket) against
production and the RC, and gates on the **delta**. Live inventory makes an absolute count
meaningless; a case that passed on prod and fails on the RC is the release's fault, a case
that fails on both is the vendor.

| Verdict | Blocks a release? |
|---|---|
| NEW P1 (PASS on baseline â†’ BUG on RC) | **yes** |
| NEW P2 | no â€” reported |
| PRE-EXISTING (BUG on both) | no |
| FIXED | no |
| NOT TESTED on either side | no â€” nothing to attribute |
| KNOWN (unexpired waiver) | no |
| KNOWN (expired waiver) | **yes** |

- Entry: `scripts/run-release-gate.js` (forces `ALLOW_BOOK=false`, refuses `--allow-book`).
  CI: `.github/workflows/release-gate.yml` â€” `workflow_call` from the deploy pipeline or
  `workflow_dispatch`. Output `verdict` = GO / BLOCK.
- Comparator: `src/framework/compareRuns.js`, CLI `scripts/compare-runs.js`
  (`npm run gate:compare`). Reads **pack** reports only (`suite` + `tags[]`); probe JSONs
  in `reports/` are ignored because their rows are already merged into the pack report.
- Severity: `src/framework/priority.js` (`classifyPriority`, shared with the HTML/Excel
  reports). **Editing a rule there changes what blocks a release.**
- Waivers: `tests/data/known-issues.json`. `expires` is mandatory.
- Rows join on `suite + tag + id`, so keep case ids stable; renaming one reads as
  MISSING on the baseline and ADDED on the candidate.
- Post the verdict to **ENG-290** (date Â· RC URL Â· GO/BLOCK Â· new P1/P2 Â· pre-existing).

### No-book safety contract

`tests/contract/no-book-safety.test.js` â€” **do not weaken it.** It runs the full API gate
against an offline fetch mock (`tests/helpers/mockFetch.mjs`) and fails if discovery stops
short of prebook / pricing, or if any request could book: a finalize, a **priced** payload on
issue-ticket, or a cancel aimed at anything but the dummy `BR0000000000000001`. It also
fails when a new probe/layer references a booking endpoint without an `ALLOW_BOOK` guard.

Adding a probe that calls finalize / issue-ticket / cancel: guard it with
`parseAllowBook()` (skip â†’ NOT TESTED rows), or add it to the test's ALLOWLIST with a reason.

Allowed on the no-book path, by design: AUTH stubs on issue-ticket / v2 cancel (fake
`priceId: "x"`, dummy BR), and the POSTBOOK-VALIDATE negatives (malformed cancel/penalty
bodies against the dummy BR). None can create or cancel a booking.

---

## Out of pack unless the user asks

- Hotel **reschedule** (finalize with `reschedulingReferenceId` after cancel)
- Flight **reschedule** (issue-ticket with **both** `reschedulingReferenceId` + `reschedulingPnr`, or neither)
- Flight history paging / status filter
- Cancel penalty formula / wallet math
- Webhooks
- Frontend / marketing

Issue-ticket probe still includes R1â€“R6 (one-sided reschedule fields rejected) with `SKIP_RESCHEDULE=1` on the pack spawn. Do **not** add a reschedule happy path to the default pack.

---

# Hotel

## Booking flow

```
GET  /v1/hotels/autocomplete
POST /v1/hotels/search          â† partner listing contract (pid=vgm)
POST /v1/hotels/details         â† use THIS requestId for prebook
POST /v1/hotels/prebook         { bookingCode, requestId }
POST /v1/hotels/finalize-booking
GET  /v1/hotels/bookings/{BR}/status
GET  /v1/hotels/bookings/{BR}
GET  /v1/hotels/bookings/history
GET  /v1/hotels/bookings/{BR}/penalty-check   â† quote only, does not cancel
GET  /v1/hotels/bookings/{BR}/cancel          â† hotel cancel is GET
```

**Spec path** `POST /api/hotels/v2/availability/listing` is **not deployed** on api-staging (HTTP 404 `"Page not found"`). Listing tests run on **`POST /v1/hotels/search`**. SMOKE still hits the spec URL and **PASS** if 200 or documented 404 (not 500).

Prebook/finalize **must** use the **details** `requestId` (room bookingCodes are scoped to it). Encrypt: bookingCode must not contain `RIYA` or `!TB!RIYA!TB!` and should look encrypted (length > 12).

### Book fixture

- Hotel: **Hilltop Mumbai** `entityId=39627872`
- City search: city `entityId` comes from `GET /v1/hotels/autocomplete?q={city name}` on that environment (type `CITY`). Do not hardcode staging ids such as Mumbai `357389:IN`. `pickCityHit` prefers the market nationality (domestic â†’ `IN`) and aliases (`Delhi` â†’ `New Delhi`) so prod does not pick foreign same-name cities (`115271:CA`, `106541:CA`).
- Stay dates: each hotel pack run advances check-in via `.hotel-date-offset` (gitignored). **First hit of a calendar day = today + 15**; same-day hits step **+16, +17, â€¦** (wrap after 45 back to 15). Always â‰¥15 days from today. Pin with **both** `HOTEL_CHECKIN` and `HOTEL_CHECKOUT` to skip stepping.
- PAN Rohan: `EUIPB1672M` / `Rohan Bhagat`
- PAN Atul (TWONAME only): `ADDPU6247P` / `Atul Ugale`
- Invalid PAN: `BADPAN`
- GST: `27AABCT1429B1Z1` / TravelVIP Technologies Pvt Ltd (see `travel-apis/hotel/src/regression/fixtures.js`)

If finalize stays **Inprogress**: leave the BR, do not keep polling forever. E2E book row is **NOT TESTED** while Inprogress. Confirmed is required for PRICE.2â€“4 and CANCEL.

## Hotel pack cases

### AUTH (token / session) â€” `scripts/probe-auth-payload-validations.js`

| # | Id | API | Rule |
|---|---|---|---|
| 1 | AT0 | `POST /auth/partner/token` | valid partner_id + partner_secret â†’ access_token + refresh_token |
| 2 | AT1â€“AT3 | same | omit partner_id / omit partner_secret / empty body â†’ 4xx |
| 3 | AT4â€“AT8 | same | trailing comma / `!@#$` / `<script>` / quote-semicolon on ids/secrets â†’ 4xx never 500 |
| 4 | RT0 | `POST /auth/partner/refresh` | valid refresh_token â†’ new access_token |
| 5 | RT1â€“RT5 | same | empty / comma / punctuation / HTML / comma-only refresh_token â†’ 4xx |
| 6 | UA0 | `POST /v1/auth/session` | valid X-Partner-Key + tierId â†’ auth_token |
| 7 | UA1â€“UA2 | same | omit / invalid X-Partner-Key â†’ 4xx |
| 8 | UA3â€“UA8 | same | comma/punctuation/HTML on key or tierId â†’ 4xx |

Last live AUTH probe: **24 PASS / 0 BUG**.

### SMOKE

| # | Rule | How |
|---|---|---|
| 1 | Autocomplete city `q=pune` | `GET /v1/hotels/autocomplete` HTTP 200, content[] |
| 2 | Autocomplete hotel `q=hiltop` | HOTEL hit with entityId (Hilltop Mumbai) |
| 3 | Search with pid=vgm | `POST /v1/hotels/search` CITY Mumbai, HTTP 200 availability |
| 4 | Spec listing URL | `POST /api/hotels/v2/availability/listing` â†’ 200 or 404, never 500 |

### LISTING â€” `travel-apis/hotel/scripts/probe-hotel-search-test-pack-catalog-dev.js` on `/v1/hotels/search`

| # | Id | Rule |
|---|---|---|
| 1 | S1 | Sort options advertised: `price_ASC`, `price_DESC` only (no star sort) |
| 2 | S2 | `sort=price_ASC` non-decreasing `price.baseFare` |
| 3 | S3 | `sort=price_DESC` different set vs S2 |
| 4 | S4 | Unknown `sort=rating_DESC` ignored, HTTP 200 |
| 5 | F1 | Star-rating facet present (`df_long_star_rating`; 5/4/3; no 1â€“2) |
| 6 | F2 | One facet value narrows `totalResults` to that count |
| 7 | F3 | Multi-select `fq` uses `;` (4â˜…+5â˜…) |
| 8 | F4 | Facet counts survive a selection |
| 9 | F5 | Filter + `price_ASC` compose |
| 10 | F6 | Valueless `fq` ignored, full total |
| 11 | P1 | Pages chain without gaps/repeats (`offset` 0,5,10 `limit=5`) |
| 12 | P2 | Offset echoed (`offset=7`) |
| 13 | P3 | Non-multiple offset slices the sorted set |
| 14 | P4 | `limit=20` recomputes page count |
| 15 | P5 | Last page `last:true`, fewer than limit |
| 16 | P6 | `offset=9999` empty page, HTTP 200, not error |
| 17 | V1 | `offset=-1` â†’ HTTP 400 `VALIDATION_ERROR` |
| 18 | V2 | `limit=0` â†’ HTTP 400 |
| 19 | V3 | `offset=abc` â†’ HTTP 400 |

**2026-08-15 retest:** pack 21/21 PASS on `/v1/hotels/search`. Spec listing URL still 404.

### STARBOOK â€” `travel-apis/hotel/scripts/probe-hotel-search-star-sort-canary.js`

4â˜… filter + price ASC/DESC on live search. Spawned by hotel `--tags STARBOOK`.

### UNAVAIL â€” `travel-apis/hotel/scripts/probe-hotel-no-availability-and-details.js`

Search + details only. No book.

| # | Id | Rule |
|---|---|---|
| 1 | H-UN1 | Sahara Star HOTEL+6ADT â†’ `available:false`, `price:null` (not old empty envelope) |
| 2 | H-UN2 | Sahara Star HOTEL+1ADT still priced |
| 3 | H-UN3 | Sahara Star details has rooms when available |
| 4â€“11 | H-UN-{city} | 8 cities: available SRP fields + unavail shape + details for first available hotel |
| 12 | H-UN-Mum6 | Mumbai sample HOTEL+6ADT prefers new unavail shape (inventory may flap) |

Sheet: `Travel VIP API â€” QA Test Suite - Hotel.csv` rows 157â€“168. Tag: `--tags UNAVAIL`.

### STARSRP â€” `travel-apis/hotel/scripts/probe-hotel-star-srp-vs-details.js`

Search + details only. 3/4/5â˜… filter on SRP must match Details across 8 Indian cities.

| # | Id | Rule |
|---|---|---|
| 1â€“24 | H-SS-{city}-{3\|4\|5} | Per city per star: SRP `starRating` === Details `starRating` (sample 8 hotels) |

Sheet rows 169â€“192. Tag: `--tags STARSRP`.

### CHAINBRAND â€” `travel-apis/hotel/scripts/probe-hotel-chain-brand-filters-cities.js`

Search only. Chain + Brand new filters + star/GST/free-cancel regression.

| # | Id | Rule |
|---|---|---|
| 1â€“8 | CB-B-{city} | Unfiltered: Chain + Brand facets present |
| 9â€“10 | CB-C-* | Chain filter apply + count; multi-select `;` |
| 11â€“12 | CB-BR-* | Brand filter apply; multi-select |
| 13 | CB-CB-Mumbai | Chain + Brand compose |
| 14â€“16 | CB-EX-* | Star+Chain, GST, Free cancel still work; price_ASC+Chain |
| 17â€“24 | CB-NEG-* | Mumbai chain/brand negatives (unknown, empty, comma, HTML) |

Sheet rows 193â€“218. Tag: `--tags CHAINBRAND`.

### CHAINBRANDVAL â€” `travel-apis/hotel/scripts/probe-hotel-chain-brand-value-verify.js`

Optional search-only spot-checks. **PASS** when filter/count holds (HTTP 200). Vendor display names may not match facet tokens â€” logged as `catalogNotes`, not API BUG (ZUZU, Via-branded Fab, IHCL SeleQtions, etc.).

Sheet rows 219â€“224. Tag: `--tags CHAINBRANDVAL`.

### NEGPRICE â€” `travel-apis/hotel/scripts/probe-hotel-no-negative-prices.js`

Search + details only. No book. Fail if any price breakup field is negative (`baseFare`, `taxes`, `gstAmount`, `convenienceFee`, `totalAmount`, etc.).

Covers **domestic + international**:
- Anchors: Hilltop Mumbai + Towers Rotana (`39657625`)
- Domestic CITY SRP + 3 hotel details each: Mumbai, Delhi, Bangalore, Pune, Goa
- International CITY SRP + 3 hotel details each: Dubai, Singapore, Bangkok, Paris

| # | Id pattern | Rule |
|---|---|---|
| 1â€“2 | H-NP-Hilltop-S/D | Hilltop search + details rooms |
| 3â€“4 | H-NP-Rotana-S/D | Towers Rotana search + details rooms |
| 5+ | H-NP-City-{City}-S | CITY SRP page0: all available hotels non-negative |
| â€¦ | H-NP-City-{City}-D1..D3 | Sampled hotels from that city: details breakup non-negative |

Env: `NEGPRICE_DETAILS_PER_CITY` (default 3), `NEGPRICE_PAGE_SIZE` (default 20).  
Intl cities with empty inventory retry once at +7 days. HTTP 5xx / empty â†’ **NOT TESTED** (not a negative-price BUG).  
Tag: `--tags NEGPRICE`. Run alone: `npm run hotel:regression:negprice`.

### ENCRYPT

| # | Rule |
|---|---|
| 1 | Details bookingCode encrypted (no RIYA / `!TB!`) |
| 2 | Prebook request/response codes encrypted + bookingContext |
| 3 | Finalize uses encrypted bookingCode (from E2E) |
| 4 | Scan details JSON bookingCodes for vendor strings |
| 8+ | Optional `--tags RIYA`: extra dest hotels in `RIYA_HOTELS` |

### RESPSCHEMA â€” response schema autocomplete â†’ cancel

Catalog: `tests/data/hotel/response-schema-cases.json`. Layer: `travel-apis/hotel/src/regression/layers/respSchema.js`.  
`ALLOW_BOOK=false` â†’ stop after **prebook** (finalizeâ†’cancel rows = NOT TESTED).  
`ALLOW_BOOK=true` â†’ continue finalize â†’ status â†’ detail â†’ history â†’ penalty â†’ cancel.  
Run alone: `npm run hotel:regression:respschema`.

| # | Id | API |
|---|---|---|
| 1 | AUTOCOMPLETE-SCHEMA | `GET /v1/hotels/autocomplete` |
| 2 | SEARCH-SCHEMA | `POST /v1/hotels/search` |
| 3 | DETAILS-SCHEMA | `POST /v1/hotels/details` |
| 4 | PREBOOK-SCHEMA | `POST /v1/hotels/prebook` |
| 5 | FINALIZE-SCHEMA | `POST /v1/hotels/finalize-booking` (book only) |
| 6 | STATUS-SCHEMA | `GET /v1/hotels/bookings/{BR}/status` |
| 7 | BOOKING-DETAIL-SCHEMA | `GET /v1/hotels/bookings/{BR}` |
| 8 | HISTORY-SCHEMA | `GET /v1/hotels/bookings/history` |
| 9 | PENALTY-SCHEMA | `GET â€¦/penalty-check` |
| 10 | CANCEL-SCHEMA | `GET â€¦/cancel` |

### VALIDATE â€” `travel-apis/hotel/scripts/probe-hotel-payload-validations.js`

Baseline: valid search â†’ details â†’ prebook (bookingContext) â†’ finalize body, then clone/mutate one field.

**A. Search** `POST /v1/hotels/search`

- Valid YYYY-MM-DD + 1 adult baseline
- Dates: DD-MM-YYYY, slashes, unpadded, 2026-02-30, checkout before checkin, past checkin, checkout >1 year
- Occupancy: adults `"1"` string, 1.5, 0, 7, children decimal, children 5, children without ages, ages length mismatch, age 18, ages as string
- Missing entityId / type; nationality not 2-letter; >6 rooms
- **No-500:** nationality `"IN,"`; entityId with extra punctuation

**B. Details** `POST /v1/hotels/details`

- Same date-format rejects as search (past date may still lookup)

**C. Prebook** `POST /v1/hotels/prebook`

- Blank bookingCode; blank requestId; both missing reported together

**Finalize** `POST /v1/hotels/finalize-booking`

1. Stay dates (same date rules as search; same-day checkin allowed)
2. Guests: Infant type; title case (`MR`/`mr`); Adult `Mstr`; Child `Mr`; title/gender mismatch; digits in firstName; hyphen/apostrophe lastName; firstName `<2`; Child missing age / age 18; future DOB; DOB DD-MM-YYYY; no lead / two leads; Adult DOB under 18; Child DOB 18+
3. **No-500:** firstName/lastName trailing comma; firstName `!@#$`
4. Contact: missing/invalid email; missing countryCode/mobile; +91 not 6â€“9 / not 10 digits; invalid PAN format; PAN without name
5. **No-500:** email with comma; mobile with comma
6. GST: partial block; invalid GSTIN; `gstEmailId` wrong casing; invalid gstMobile
7. Envelope: `error.code/message/details[]/timestamp/request_id`; multiple problems listed together
8. PAN mandatory rate requires panCardNumber; GST-claimable requires gstDetails; child turns 18 during stay

### PAN / GST (live Hilltop prebook)

| # | Rule |
|---|---|
| 7 | `isPANMandatory` present on Hilltop room |
| 3 | Invalid PAN `BADPAN` â†’ 400 `VALIDATION_ERROR`, no BR |
| 4 | Omit panCardName â†’ 400 |
| 6 | Missing PAN when mandatory â†’ 400/fail, not Confirmed |
| 5 | PAN name â‰  lead guest â†’ Failed, not Confirmed |
| 8 | GST-claimable without gstDetails â†’ 400 |
| 2 | TWONAME (optional tag): Rohan then Atul same prebook â†’ 2nd Confirmed, `duplicate:false` |

### E2E / PRICE / CANCEL (Hilltop)

| Tag | # | Rule |
|---|---|---|
| E2E | 1 | Search â†’ details â†’ prebook â†’ finalize **Confirmed** (retry checkin days 28, 35, 21) |
| E2E | 1 | Booking detail roomType present |
| E2E | 6 | History lists BR |
| E2E | 3 | Unknown BR `BR0000000000000001` â†’ 4xx `NOT_FOUND` (not 200) |
| PRICE | 1 | Details `totalAmount` â‰ˆ prebook Â±â‚¹0.05 |
| PRICE | 2 | Prebook â‰ˆ finalize/confirmed |
| PRICE | 3 | Confirmed â‰ˆ GET status |
| PRICE | 4 | Status â‰ˆ GET booking details |
| CANCEL | 7 | Penalty check on Confirmed (does not cancel) |
| CANCEL | 4 | GET cancel â†’ poll status **Cancelled** |
| CANCEL | 5 | Cancel already-Cancelled â†’ 4xx |

---

# Flight

## Booking flow

```
GET  /v1/flights/airports | /airlines | /citySearch
POST /v1/flights/search          â† poll until options / progress complete
POST /v1/flights/details         { journeyType, selection.selectedSearchIds }
POST /v1/flights/pricing         â†’ priceId (+ bookingContext)
POST /v1/flights/fareRules
POST /v1/flights/ssr             { priceId }
POST /v1/flights/seatmap         { requestReference, passengers }
POST /api/v2/flights/booking/issue-ticket     â† pack book path
GET  /v1/flights/booking/{BR}/status          â† poll (see Inprogress rule)
GET  /v1/flights/booking/{BR}
GET  /v1/flights/bookings/history
POST /v1/flights/booking/{BR}/cancel          { action: PENALTY, pnr } then { action: CANCEL, pnr }
POST /api/v2/flight/cancel                    { bookingId, action: CANCEL, pnr, cancelledBy }
```

Payload validation for issue-ticket: **`POST /api/v2/flights/booking/issue-ticket`**. v1 `POST /v1/flights/booking/issue-ticket` is **negatives / special-char only** (no extra live v1 book).

Search poll: do not treat first empty page as failure; wait for options or progress complete.

### Flight L2B mode (4 buckets)

Off on staging/dev unless you set the flag. On when `FLIGHT_L2B_MODE=true` or `IS_PROD=true`. `ALLOW_BOOK=false` still blocks live tickets; this mode only pins **search** itineraries so vendor cache is reused.

Airports are **not** discovered from search. Defaults live in `travel-apis/flight/src/l2bBuckets.js`. Override with env. Routes stay DELâ€“BOM and DELâ€“DXB unless the airport env vars are set. Dates step on every run: first run onward is today + 21 and return is that date + 2; the next run is today + 22 and + 2, then +23, through +45, then back to +21. The last offset is in gitignored `.l2b-date-offset`. Set **both** `FLIGHT_SEARCH_DATE` and `FLIGHT_RETURN_DATE` to pin one pair. `FLIGHT_RETURN_OFFSET_DAYS` defaults to 2.

| Bucket | Default |
|--------|---------|
| OW_DOM | DEL â†’ BOM |
| RT_DOM | DEL â†” BOM |
| OW_INTL | DEL â†’ DXB |
| RT_INTL | DEL â†” DXB |

Positive searches remap onto that bucket (filters/cabin/fareType stay). Same-OD and non-IATA negatives keep their airports. MULTI_CITY is **NOT TESTED** in this mode. E2E fallbacks (GOI, BLR, BKK, SIN, HYD) collapse to the first attemptâ€™s bucket. Polls cap at 2 (`FLIGHT_SEARCH_MAX_POLLS`); the four-bucket warm uses 4 unless that env is set.

`.env` needs `BASE_URL`, `PARTNER_ID`, `PARTNER_SECRET`, `SIGNING_KEY`, and `TIER_ID`. The command sets the mode for that run.

```powershell
# staging / dev â€” varied routes, booking flow on
cmd /c "set IS_PROD=false&& set FLIGHT_L2B_MODE=false&& set ALLOW_BOOK=true&& npm run flight:regression"
cmd /c "set ALLOW_BOOK=true&& npm run hotel:regression"

# production â€” four routes, dates step each run, no live tickets
cmd /c "set IS_PROD=true&& set ALLOW_BOOK=false&& npm run flight:regression"
cmd /c "set IS_PROD=true&& set ALLOW_BOOK=false&& npm run hotel:regression"
```

```bash
# staging / dev â€” varied routes, booking flow on
IS_PROD=false FLIGHT_L2B_MODE=false ALLOW_BOOK=true npm run flight:regression
ALLOW_BOOK=true npm run hotel:regression

# production â€” four routes, dates step each run, no live tickets
IS_PROD=true ALLOW_BOOK=false npm run flight:regression
IS_PROD=true ALLOW_BOOK=false npm run hotel:regression
```

Staging console must show `ALLOW_BOOK: true` and `FLIGHT_L2B_MODE: false`. Production console must show `ALLOW_BOOK: false` and `FLIGHT_L2B_MODE: OW_DOM â€¦`. This reduces unique OD+date looks. It does not guarantee API L2B is zero if every search HTTP call is counted.

**LATENCY** (only when the L2B warm runs): one row per bucket. The time is the first HTTP call of that warm search, not a later inventory poll. At or under 20 seconds is **PASS**. Over 20 seconds is **BUG** and the report says: `The response time for search DELâ†’BOM, its trip type is one way, which is taking more than 20 sec. Please investigate.` No duration is **NOT TESTED**.

Passengers: `travel-apis/flight/src/passengerBuilder.js`. Unique last-name tag per book. Infant DOB = **~6 months ago** (not a fixed 2024 date). Child DOB `2017-09-08`. Adults 12+ on depart. Issue-ticket `travellers` must match passenger types. Order: adults then children then infants. Exactly one `isLead` (adult).

### Flight booking â€” Inprogress (always)

After issue-ticket, poll GET status until **Confirmed**, **Inprogress**, **Failed**, or **Cancelled**. Do **not** stop on Pending.

If **Inprogress**: leave that BR. Retry **once** with **different passenger names and different travel dates**. Poll the retry the same way; then **stop** (do not keep retrying even if the second BR is Inprogress).

Confirmed is the cancel fixture when it happens; otherwise CANCEL post-book rows are **NOT TESTED**.

### Cancel status rules (product)

- Booking status is never `Cancellation Requested`.
- **CANCEL.8:** HTTP 200 + still Confirmed is PASS. **Penalty Check Failed + `duplicate: true` is expected**, not a bug.
- **CANCEL.9:** GET **Cancelled** **or** GET Confirmed + `cancellationRequest.status = Cancellation Requested`.
- **CANCEL.10:** if fully Cancelled â†’ 4xx `BOOKING_ALREADY_CANCELLED`; if not â†’ 4xx `CANCELLATION_ALREADY_IN_PROGRESS`.
- Offline (`itinerary.onlineCancellation=false`): v2 cancel must **stay Confirmed**, never 500, never Cancelled.
- Partner mismatch needs **`PARTNER_ID_2` / `PARTNER_SECRET_2`**. Dummy IDs often return `NOT_FOUND`, not `BOOKING_PARTNER_MISMATCH`.

## Flight pack cases

### SMOKE

| # | Rule |
|---|---|
| 1 | Airports catalog `GET /v1/flights/airports?airport=BOM` |
| 2 | Airlines `GET /v1/flights/airlines?airline=AI` |
| 3 | citySearch `GET /v1/flights/citySearch?q=Pune` |
| 4 | OW search `POST /v1/flights/search` DELâ†’BOM pid=vgm |

### RESPSCHEMA â€” response schema catalogs â†’ cancel

Catalog: `tests/data/flight/response-schema-cases.json`. Layer: `travel-apis/flight/src/regression/layers/respSchema.js`.  
`ALLOW_BOOK=false` â†’ stop after **pricing** (issueâ†’cancel rows = NOT TESTED).  
`ALLOW_BOOK=true` â†’ SSR/seatmap â†’ issue-ticket â†’ status â†’ detail â†’ history â†’ penalty â†’ v2 cancel.  
Run alone: `npm run flight:regression:respschema`.

| # | Id | API |
|---|---|---|
| 1 | AIRPORTS / AIRLINES / CITYSEARCH | catalog GETs |
| 2 | SEARCH / DETAILS / FARERULES / PRICING | pre-price hops. A pricing body with no `priceId` or no `bookingContext` is **BUG** |
| 3 | SSR / SEATMAP | after pricing (book only). The up-check for meal, baggage, and seat is VALIDATE, and it runs when bookings are off |
| 4 | ISSUE / STATUS / BOOKING-DETAIL / HISTORY | post-issue |
| 5 | PENALTY / CANCEL | cancel path (Confirmed + PNR) |

### SEARCH â€” live + spawned probes

**Dates** `travel-apis/flight/scripts/probe-flight-date-format-yyyy-mm-dd.js` â€” travel dates are runtime `futureDate(+FLIGHT_ONWARD_DAYS)` (default +21). Override with `FLIGHT_SEARCH_DATE` / `FLIGHT_RETURN_DATE` if needed.

| Id | Input | Expect |
|---|---|---|
| S1 | relative `futureDate(+21)` YYYY-MM-DD | accept |
| S2â€“S6 | same calendar as S1 in DD-MM-YYYY / slashes / YYYYMMDD | 4xx |
| D1â€“D5, P1â€“P5 | DOB / passport date formats on **issue-ticket** (priced payload) | 4xx â€” **only with `ALLOW_BOOK=true`**; D1/P1 are valid and can issue a live ticket |

**RT O&D** `travel-apis/flight/scripts/probe-flight-rt-od-validations.js` â€” invalid RT origin/dest combos â†’ 4xx.

**Live SEARCH layer**

| # | Rule |
|---|---|
| stops.1 | Connecting 1-stop inventory DELâ†’GOI `maxStops=1` |
| stops.2 | Direct DELâ†’BOM `maxStops=0` |
| od.2 | Same origin/dest DEL-DEL â†’ 400 |
| pref.1 | `preferences.airlines=[""]` â†’ 400 or ignore, never 500 |
| cabin.1â€“2 | `ECONOMY` / `BUSINESS` |
| cabin.3â€“4 | `PREMIUM_ECONOMY` / `FIRST` â€” 200 empty or 4xx, never 500 |
| pref.2 | `airlines=['SG']` â€” empty or all SG |
| pref.3 | `refundableOnly=true` |
| fare.1 | `fareType=CORPORATE` |
| mc.1 | `journeyType=MULTI_CITY` DELâ†’BOM then BOMâ†’BLR |

**fareTypes filter** `travel-apis/flight/scripts/probe-flight-v2-faretypes-filter-canary.js` â€” spawned by `--tags SEARCH`. Path: **`POST /v1/flights/search`**. Mag `/api/flights/catalog-v2/search` is **out of pack** (404 on canary). Run `npm run probe:flight:faretypes`. Last canary: **57 feature PASS** (plus inventory SETUP).

| # | Id | Rule |
|---|---|---|
| 1 | SETUP.1 | Unfiltered OW DELâ†’BOM returns options |
| 2 | FT.1 | If options expose fare labels, `filters.ONWARD.fareTypes` lists each with counts. Empty facet and no fare labels on options is PASS |
| 3 | FT.2 | No fareTypes filter â†’ airlines / stops / refundable / priceRange facets still present |
| 4 | FT.P | For **each** live fare label: `appliedFilters.ONWARD.fareTypes=[label]` â†’ options only offer that fare; `fares[]` reduced to that type; `displayPricing` matches selected fare |
| 5 | FT.F | After filter, `filters.ONWARD.fareTypes` still shows the **full** facet (not only selected) |
| 6 | FT.C | Case-insensitive: `["ecovalu"]` same as `["ECOVALU"]` |
| 7 | FT.N1 | `fareTypes:[""]` does not wipe results (treat as no filter) |
| 8 | FT.N2 | `fareTypes:[" "]` does not wipe results |
| 9 | FT.N3 | Unknown `fareTypes:["NOT_A_REAL_FARE"]` â†’ empty or no mismatched fares |
| 10 | FT.PR | Combine expensive fareType + `priceRange.max` below that fare on a **multi-fare option** â†’ that option excluded (not kept via cheaper family) |
| 11 | FT.RT1 | RT unfiltered: fareTypes facet on ONWARD **and** RETURN |
| 12 | FT.RT2 | Different fareTypes on ONWARD vs RETURN filter independently (domestic) |
| 13 | FT.RT3 | After RT filter, both direction facets remain full |
| 14 | FT.RT4 | RT empty/whitespace fareTypes do not wipe results |
| 15 | FT.INTL1 | International RT unfiltered: HTTP 200 with onward and return options. Empty fareTypes facets are PASS |
| 16 | FT.INTL2 | Intl independent ONWARD vs RETURN fareTypes |

FT.P / FT.F / FT.C repeat for every label in the unfiltered facet (canary DELâ†’BOM: Special, Normal, SpiceMax, Flexi, VALUE, PROMO, FLEX, LITE, CLASSIC, SALE, ECOVALU, ECOCLAS, ECOFLX, PEYVALU, Normal:-).

### INVENTORY â€” airline and fare counts

Layer: `travel-apis/flight/src/regression/layers/inventory.js`. Tag: `--tags INVENTORY` (also in the default pack and the no-book API gate). Does not book.

Eight searches on the four pinned routes (OW/RT domestic DELâ€“BOM, OW/RT international DELâ€“DXB, pinned dates), each with `fareType=NORMAL` and `fareType=CORPORATE`. Poll **page 0** until `progress.state=COMPLETE`. Do not walk later pages. The board uses page 0: `totalResults`, airline chips from `filters.ONWARD.airlines` (and RETURN on a round trip), and fare names from `filters.ONWARD.fareTypes` / `filters.RETURN.fareTypes`, with the spelling and counts the response sent. Poll cap is `FLIGHT_INVENTORY_MAX_POLLS`, otherwise the L2B warm cap (4) or 8.

Pagination is five rows on the first completed search whose `totalResults` is greater than 20. If no search has a second page, those rows are NOT TESTED.

| Id | Case | Expect |
|---|---|---|
| PG.1 | Page 0 | HTTP 200, options, `totalResults` |
| PG.2 | Page 1 | HTTP 200, no searchId repeat from page 0 |
| PG.3 | Last page | `ceil(totalResults / 20) - 1`. HTTP 200, short page or `last: true` |
| PG.4 | Page 9999 | HTTP 200, empty options, not an error |
| PG.5 | `page=-1` and `page=abc` | HTTP 4xx `VALIDATION_ERROR`, never 500 |

Independent pack work runs with `PACK_CONCURRENCY` (default 4). City searches stay at 3. The L2B warm, booking, PRICE, CANCEL, and CORR stay in order. Hotel listing `P3` waits for offset 5 and offset 10.

| # | What | Rule |
|---|---|---|
| 1â€“8 | Route Ã— NORMAL / CORPORATE | HTTP 200 with options is **PASS**. Count onward (and return) flights and airlines (logo + count). Fare chips are the `fareTypes` map on that search, not a fixed Saver/Flexi/SME list. |
| empty | 0 flights after COMPLETE | **NOT TESTED** `NO_INVENTORY`. The HTML board says **No flights found** with route, date, fare type, HTTP status, and progress. Not a bug. |
| error | HTTP 500, or search never reaches COMPLETE | **BUG** |

The HTML report keeps Flight insights collapsed. Open that dropdown to see one board per route: the In progress response time, the Complete response time, then airline chips and fare chips. When the L2B warm ran, those two times are that fresh warm (the same first hit the LATENCY row scores, plus the warm poll that came back Complete), not the later NORMAL/CORPORATE polls. Hotel reports omit this section. There is no server or airport health check in the pack.

### VALIDATE â€” search/hops `travel-apis/flight/scripts/probe-flight-search-hop-validations.js`

Last live: **23 PASS / 2 BUG** (`S6` adults `"1"` accepted; `S8` `fareType=GARBAGE` accepted) â€” still treat as bugs until API rejects.

| Id | API | Rule (invalid â†’ 4xx, never 500) |
|---|---|---|
| S0 | search | valid OW DELâ†’BOM ECONOMY 1ADT baseline |
| S1â€“S10 | search | omit itinerary; `DEL,`; HTML dest; `ECONOMY,`; `CABIN_X`; adults `"1"`; infants>adults; `fareType=GARBAGE`; `ONEWAY`; omit travellers |
| H0 | details | valid searchIds baseline |
| D1â€“D3 | details | empty ids; searchId comma; omit journeyType |
| P0 | pricing | valid searchIds â†’ priceId |
| P1â€“P2 | pricing | empty ids; searchId HTML |
| FR1â€“FR2 | fareRules | empty ids; searchId comma |
| SSR0 / SSR-MEAL / SSR-BAG | ssr | When P0 returned `priceId`: meal and baggage catalogs are up (HTTP not 500). Empty list is still up. Does not issue a ticket. No `priceId` is a pricing schema bug, not a not-tested row here |
| SSR1â€“SSR3 | ssr | omit priceId; comma; HTML |
| SM0 | seatmap | When P0 returned `bookingContext`: seatmap is up (HTTP not 500), even if `supportsSeats` is false. No `bookingContext` is a pricing schema bug, not a not-tested row here |
| SM1â€“SM2 | seatmap | omit requestReference; comma |

Every VALIDATE run checks meal, baggage, and seat are up. That does not issue a ticket.

### VALIDATE â€” issue-ticket `travel-apis/flight/scripts/probe-flight-issue-payload-validations.js`

Prefer v2. Clone priced ticket body, mutate one field.

| Ids | Area |
|---|---|
| T1â€“T11 | type/currency/language/timezone/bookingReference/searchIds/journeyType enum |
| R1â€“R6 | reschedule fields: **both or neither**; max lengths; blanks (pack still runs these, no happy-path reschedule) |
| D1â€“D6 | data/priceId/passportType enum `NONE\|MINI\|FULL` / includeGst |
| C1â€“C7 | contact email/mobile/countryCode |
| G1â€“G3 | gstDetails when includeGst |
| P1â€“P6 | passengers array, paxId, type enum, isLead |
| PF1â€“PF19 | title/gender/DOB/nationality/age vs type (adult 12+, child 2â€“11, infant <2 on depart) |
| CY1â€“CY2 | cityCode / cityName |
| PP1â€“PP5 | passport MINI/FULL |
| X1â€“X10 | one lead; no lead; dup paxId; dup names; first==last; child-only lead; infants>adults; child before adult; child title Mr; dup passport |
| SC1â€“SC11 | commas / punctuation / HTML on names, currency, type, journeyType, email, mobile, searchId, cityName â€” **4xx never 500** |
| V1-SC*, omit type | v1 path negatives only |
| A1 | multiple validation errors aggregated in `details[]` |

### AUTH product APIs

| # | Rule |
|---|---|
| 1 | `POST /v1/flights/search` omit Bearer â†’ 4xx never 500 |
| 2 | garbage Bearer â†’ 4xx |
| 3 | issue-ticket omit `X-Partner-Key` â†’ 4xx |
| 4 | issue-ticket `X-Partner-Key` with comma â†’ 4xx |
| 5 | v2 cancel omit `X-Partner-Key` â†’ 4xx |

### E2E books (live tickets on default pack)

| # | Fixture | How |
|---|---|---|
| 2 | OW 1ADT Confirmed | DEL-GOI connecting then DEL-BOM |
| 3 | RT 1ADT Confirmed | DEL-BOM/BOM-DEL then BOM-BLR |
| 4 | Intl OW 2ADT + passport | DELâ†’DXB then BOMâ†’BKK then DELâ†’SIN |
| 5 | OW 1ADT seat+meal+baggage | GET SSR + seatmap; attach on lead |
| 8 | OW 1ADT+1CHD+1INF | travellers must match issue-ticket pax |
| 7 | Cancel fixture | `onlineCancellation=true` (SG/IX) |
| 9 | Offline cancel copy | `onlineCancellation=false` (often AI) |

Also:

- Fare rules present or documented `VENDOR_ERROR`
- Fare rules / details / pricing / issue have **no Riya**
- SSR catalog does not 500
- History lists cancel-fixture BR
- `convenienceFee` field present (0 allowed)
- Replay same issue-ticket payload â†’ `duplicate:true` and/or same BR, never a second BR, never 500

### PRICE (OW 1ADT Confirmed)

| # | Rule |
|---|---|
| 1 | Search â‰ˆ details â‰ˆ pricing â‰ˆ confirmed â‰ˆ GET detail **Â±â‚¹1** on the **OW 1ADT BR** (not the cancel-fixture BR). On mismatch write `reports/price-mismatch-{BR}.json` with searchId, criteria, fares, hop totals, howToReproduce |
| 2 | pricing `baseFare + taxes + convenienceFee â‰ˆ totalAmount` Â±â‚¹1 |
| 3 | `gstBreakup` is array or omitted |
| ssr.1 | Confirmed total â‰ˆ pricing + attached SSR/seat Â±â‚¹2 |

### CANCEL v2 + v1

| # | Rule |
|---|---|
| v2.1 | missing bookingId â†’ 400 `VALIDATION_ERROR` |
| v2.2 | missing action â†’ 400 |
| v2.3 | `action=DELETE` â†’ 400 |
| v2.4 | fake BR â†’ 404 `BOOKING_NOT_FOUND` (or 4xx) |
| v2.5 | `BOOKING_PARTNER_MISMATCH` if 2nd partner env set, else NOT TESTED |
| v2.6 | Hotel BR on flight cancel â†’ `FLIGHT_BOOKING_ITEM_NOT_FOUND` / `NOT_FOUND` |
| post.7 | Penalty without pnr â†’ 400 `VALIDATION_ERROR` |
| post.8 | Penalty with pnr; **status still Confirmed** |
| v1.11 | v1 `action=CANCEL` â†’ 200 or 4xx, never 500 |
| post.9 | Cancel Confirmed (Cancelled **or** Confirmed + Cancellation Requested) |
| post.10 | Repeat cancel: `BOOKING_ALREADY_CANCELLED` or `CANCELLATION_ALREADY_IN_PROGRESS` |
| offline.12 | `onlineCancellation=false` stays Confirmed |

---

## Flight DB mapping (`travelx`)

phpMyAdmin pack for API BR â†’ DB row checks. **Not** part of `b2b:regression`.

| Artifact | Path |
|---|---|
| How-to + schema gotchas + run log | `docs/FLIGHT-DB-MAPPING-CHECKS.md` |
| Paste-ready SQL | `docs/sql/flight-db-mapping-checklist.sql` |

**PASS chain:** 1 `booking` â†’ 1 flight `booking_item` â†’ `flight_journey` per leg â†’ `booking_passenger` per pax â†’ `flight_journey_passenger` cells = journeys Ã— pax.  
**Money:** `booking.total_amount` â‰ˆ item â‰ˆ `payment.total_amount` (paise). Offers live in `booking_item_offer` (not columns on booking/item).  
**Last live:** 2026-09-24 Â· `BR1790243528138745` Â· core + price PASS Â· no offer row Â· txn amount unit NOTE (`7351` vs `735100`).

Change only `SET @br := 'â€¦'` in the SQL file for the next BR.

## Layout (this repo)

```
AGENTS.md                 â† this memory (keep updated)
shared/config/env.js
shared/lib/                  HTTP client, signing, partner auth
travel-apis/hotel/src/service.js + helpers + regression/layers
travel-apis/flight/src/service.js + helpers + l2bBuckets + inventorySnapshot + passengerBuilder + searchPicker + regression/layers
travel-apis/hotel/scripts/hotel-regression-suite.js
travel-apis/flight/scripts/flight-regression-suite.js
scripts/b2b-regression-suite.js
scripts/probe-*.js        only the probes the packs spawn
docs/B2B-PREDEPLOY-REGRESSION.md
docs/FLIGHT-DB-MAPPING-CHECKS.md
docs/sql/flight-db-mapping-checklist.sql
```

Hotel cancel helper: `HotelService.cancelBooking` = **GET**. Flight v2: `FlightService.cancelV2` = **POST `/api/v2/flight/cancel`**.

---

## Known open items (staging, as of 2026-08-24)

| Item | Notes |
|---|---|
| Spec listing URL | `POST /api/hotels/v2/availability/listing` still 404; partner contract is `/v1/hotels/search` (listing pack 21/21 PASS there) |
| Flight catalog-v2 path | Mag `POST /api/flights/catalog-v2/search` still 404 on canary. Pack tests fareTypes on **`POST /v1/flights/search`**. Optional `INCLUDE_MAG_PATH=1` on the probe. |
| Flight search S6 | API accepted `travellers.adults` as string `"1"` â€” BUG until 4xx |
| Flight search S8 | API accepted `fareType=GARBAGE` â€” BUG until 4xx |
| PRICE.1 | If hop totals diverge, dump `reports/price-mismatch-{BR}.json`; compare **OW 1ADT**, not cancel-fixture detail |
| Duplicate cache | `duplicate: true` may HTTP 200 replay errors |
| Partner mismatch | Needs `PARTNER_ID_2` / `PARTNER_SECRET_2`; dummy IDs often `NOT_FOUND` |

---

## Cab (Error Contract pack â€” when asked)

Full PDF matrix you shared is saved for automation (not part of hotel/flight `b2b:regression`):

| Artifact | Path |
|---|---|
| Full contract (93 rows) | `src/cab/regression/cab-error-contract-full.json` |
| QA CSV | `Cab API Error Contract - Validations.csv` |
| Runnable cases | `src/cab/regression/errorContractCases.js` |
| Runner | `src/cab/regression/runErrorContract.js` |
| Docs | `docs/CAB-API-ERROR-CONTRACT.md` |

```bash
npm run cab:regression:validate:staging
npm run cab:regression:validate:canary
npm run cab:export:error-contract
```

Open bug (2026-09-03): **HI-1** omit `userId` â†’ HTTP 200 instead of 400 `VALIDATION_ERROR`.

Also open (error-contract staging 2026-09-11): **UB-5** provider booking id mismatch accepted. **SR-9** product now says RENTAL pickupâ‰ drop is by design (P2P booked as rental) â€” still HTTP 200 + inventory on staging 2026-09-17.

Product-fix retest (`scripts/probe-cab-product-fix-retest.js` â†’ `reports/cab-product-fix-retest.json`, staging **2026-09-17**):
- **Landed:** DOB format/future/HTML â†’ 400 `VALIDATION_ERROR`; title `"Mr,"` / gender `"other"` â†’ 400; `countryCode` `"999"` and `"+999"` â†’ 400 (calling-code table); omit `distanceKm`/`durationMin` â†’ HTTP 400 `SEARCH_REJECTED`; locations `query` comma/HTML â†’ 400 `VALIDATION_ERROR`.
- **Still BUG vs claimed fix:** omit/empty `profile.dob` still books; age vs `paxType` still books (ADT~7y / CHD~25y / INF~8y); garbage `priceId` still books; cancel `cancellationReason` HTML still 200.
- **By design (confirmed):** omit `priceId` books; `isLead:false` books; `otherDetails` HTML books; nationality optional; OUTSTATION/RENTAL status `airportCode` filled (`PNQ`); pickup/drop name special chars still 200; places autocomplete special chars still 200.

Flow+response audit (`scripts/probe-cab-flow-all-types.js` â†’ `reports/cab-flow-all-types-audit.json`):
- Search/fare pricing field is **`priceDetail`** (not `price`) â€” confirmed live all 4 types. Probe aligned to Postman trees in `reports/cab-response-property-trees.json`.
- OUTSTATION + RENTAL status `airportCode` populated (e.g. `PNQ`) â€” product says expected (vendor needs it).
- E2E per type (searchâ†’fareâ†’finalizeâ†’Confirmedâ†’cancel): all 4 types PASS on staging.

### Property matrix (staging 2026-09-11)

Probe: `node scripts/probe-cab-property-matrix.js` â†’ `reports/cab-property-matrix.json`.

Full pos/neg per request field + response schema vs Postman trees (locations, places, searchÃ—4 types, fare, finalize, cancel, update-booking, status/details/tracking/history).

Last run (after soft reclass): see report `summary` + `bugThemes`. Top themes: special-char accepted on search name/city; airportCode garbage â†’ HTTP 200 `NOT_FOUND`; distance/duration omit â†’ 200 `VENDOR_REJECTED`; finalize bad `priceId` accepted; weak finalize pax/contact; cancel HTML reason accepted; HI-1; OUTSTATION/RENTAL `airportCode`.

### Multipax limit (staging 2026-09-11)

Probe: `node scripts/probe-cab-multipax-limits.js` â†’ `reports/cab-multipax-limits.json`.

**Hard limit = 1 passenger** on finalize for **all** journey types (AIRPORT_DEPARTURE / ARRIVAL / OUTSTATION / RENTAL).  
2+ ADT, 3 ADT, ADT+CHD, 2 leads â†’ HTTP 400 `VALIDATION_ERROR` *â€œOnly one passenger is allowed for a cab booking.â€*  
0 / omit passengers â†’ 400 *â€œPassenger first name is required.â€* (not a dedicated empty-array message).  
`paxType` allowed: `ADT`, `CHD`, `INF`; garbage â†’ 400 with allowed list.  
Last run: **36 PASS / 0 BUG / 4 NOTE** (NOTE = `isLead:false` hit name-digit validation on fixture `Pax1` before lead rule).

### DOB / birthdate on finalize (staging 2026-09-17 retest)

Probe: `node scripts/probe-cab-dob-validations.js` (full matrix) and `scripts/probe-cab-product-fix-retest.js`.

**Partial fix:** garbage / HTML / wrong format / future DOB â†’ HTTP 400 `VALIDATION_ERROR`.  
**Still BUG:** omit / empty `dob` still HTTP 200 book; age vs `paxType` (ADT/CHD/INF) still HTTP 200 book.

---

## When the user asks for a change

- Prefer existing clients and pack layers; clone/mutate one field.
- Add the case to the matching layer or spawned probe **and** add a row to this file **and** `Travel VIP API â€” QA Test Suite - Hotel.csv` when applicable.
- Keep hotel/flight pack cases in sync with `D:\Travel VIP B2B API Automation\AGENTS.md` when you change cases.
- Do not add lounge/cab/esim/fast-track or reschedule happy path unless asked.
- Do not run the full E2E pack unless asked (it books multiple live tickets). Smoke/VALIDATE first when checking wiring.

