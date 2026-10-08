# Hotel Listing v2 — Canary bug report (sort / filter / paging)

**For:** Backend / hotel listing v2  
**Spec:** `hotel-listing-v2.md` — `POST /api/hotels/v2/availability/listing`  
**QA:** TravelVIP API Automation · partner `vgm`  
**Date (UTC):** 2026-08-15T15:57:00.686Z

---

## Summary for developers

`POST /api/hotels/v2/availability/listing` is **not deployed on canary** (HTTP 404 `"Page not found"`).

`POST /v1/hotels/search` **already returns the listing v2 envelope**:
- `sorts[]` with `price_ASC` / `price_DESC`
- `filters[]` with `indexField` + `facets[].facetKey`
- `page`, `offset`, `size`, `last`, `totalResults`, `totalPages`, `requestId`

But that live API **does not apply**:
- query `sort`
- query `offset`
- query `limit`
- body `fq[]`

Every mutated call returns the **same first 10 hotels**. Invalid paging values (`offset=-1`, `offset=abc`, `limit=0`) also return HTTP 200 of that same page instead of HTTP 400 `VALIDATION_ERROR`.

**Root cause (likely):** listing v2 response shape is wired; listing v2 **request params are not**. Legacy `perpage` still changes page size; `limit` does not.

| | Count |
|---|---:|
| PASS | 9 |
| **BUG** | **22** |
| NOT TESTED | 4 |
| Total | 35 |

| Section | PASS | BUG | NOT TESTED |
|---|---:|---:|---:|
| Shape | 3 | 1 | 0 |
| Sort | 3 | 4 | 0 |
| Filter | 2 | 5 | 3 |
| Paging | 1 | 12 | 1 |

---

## Environment / log keys

| Field | Value |
|---|---|
| Base URL | `https://canary-api.travelvip.ai` |
| pid | `vgm` |
| `X-Correlation-ID` | `0bd455b1-1a34-4dbc-bccd-655dd51e0ce9` |
| Search `requestId` (page 1) | `3e5c0463-77c6-46d7-8b65-71b77aec8b84` |
| City | Pune · `type=TBOCITY` · `entityId=328605:IN` (same sample as the spec) |
| Stay | `2026-09-12` → `2026-09-13` · `currency=INR` · 1 adult |
| `totalResults` | **302** (fresh search ~5.3s first hit) |

Method for every case below: **clone the baseline → mutate only the named field → call**.

---

## Baseline request (use this for all bugs except Bug 1)

```
POST https://canary-api.travelvip.ai/v1/hotels/search
  ?pid=vgm
  &tierId=10546901
  &subscriptionId=15045625496a6327
  &offset=0
  &limit=5
  &sort=price_ASC
```

Headers: partner auth as usual (`Authorization` bearer + `X-Partner-Key` = partner access token, signed body).

```json
{
  "checkin": "2026-09-12",
  "checkout": "2026-09-13",
  "type": "TBOCITY",
  "entityId": "328605:IN",
  "nationality": "IN",
  "rooms": [{ "adults": 1, "children": 0, "childrenAges": [] }],
  "currency": "INR",
  "language": "en",
  "rt": "compact",
  "requestId": ""
}
```

### Baseline response (HTTP 200)

| Field | Value |
|---|---|
| `page` | 0 |
| `offset` | 0 |
| `size` | **10** (asked `limit=5`) |
| `last` | false |
| `totalResults` | 302 |
| `totalPages` | **31** (= ceil(302/10), not ceil(302/5)=61) |
| `requestId` | `3e5c0463-77c6-46d7-8b65-71b77aec8b84` |
| `sorts` | `price_ASC`, `price_DESC` |
| Star facets | 5★ count=10, 4★=8, 3★=184 |

First hotels (asked `price_ASC` — **not actually sorted**):

| # | id | name | star | baseFare |
|---|---|---|---:|---:|
| 1 | 15237042 | Keys Prima by Lemon Tree Hotels, Pimpri Pune | 3 | 5713.60 |
| 2 | 72379936 | Via Royal Stay I | 3 | 1333.68 |
| 3 | 72241152 | Fabhotel Royal Inn I | 3 | 1230.93 |
| 4 | 39604638 | Treebo Diamond Residency - DDPK Inn | 3 | 1971.62 |
| 5 | 70487786 | Fabhotel Prime Athiti Delight Stay | 3 | 1370.69 |

Full `baseFare` order on this page:  
`5713.6, 1333.68, 1230.93, 1971.62, 1370.69, 2052, 4400, 1631.7, 2179.62, 1017.42`

These same 10 ids came back on almost every later call:  
`15237042, 72379936, 72241152, 39604638, 70487786, 72395060, 72419366, 71037232, 39452499, 15599148`

---

# Bugs (exact steps)

## Shape

### Bug 1 — Documented listing path is 404 on canary

**Spec:** `POST /api/hotels/v2/availability/listing`  
**How:** Call the spec path with the baseline body.

**Steps**
1. Authenticate (partner token + session, `tierId=10546901`).
2. POST `https://canary-api.travelvip.ai/api/hotels/v2/availability/listing?pid=vgm&tierId=10546901&subscriptionId=15045625496a6327&offset=0&limit=5&sort=price_ASC`
3. Body = baseline body above.

**Expected:** HTTP 200 listing envelope (`results`, `filters`, `sorts`, `offset`, `last`).

**Actual:**
```json
HTTP 404
{ "status": 404, "info": "Page not found" }
```

---

## Sort

Spec: send `?sort=` using a key from `sorts[]`. Sort is by `price.baseFare` across the **whole** result set, **before** paging. Send sort on **every** page. Unknown keys are ignored (200, vendor order). Star rating is a **filter**, not a sort.

### Bug 2 — `sort=price_ASC` does not order by `price.baseFare`

**Steps**
1. Send the baseline request (`sort=price_ASC`).
2. Read `results[].price.baseFare` in array order.

**Expected:** Non-decreasing fares (lowest first). Lowest on this page should be ~1017, not 5713.

**Actual:** HTTP 200, unsorted. First three: 5713.60 → 1333.68 → 1230.93. Last on page: 1017.42.

---

### Bug 3 — `sort=price_DESC` returns the same page as ASC

**Steps**
1. Clone baseline.
2. Change **only** query `sort=price_DESC`.
3. Compare fare order vs Bug 2.

**Expected:** Non-increasing fares. First hotel = most expensive in the set.

**Actual:** HTTP 200. **Identical** fare list and hotel ids to `price_ASC`.  
`requestId` (this call): `f687656b-db8e-4495-92a4-0153bdc01811`

---

### Bug 4 — ASC vs DESC first fare are the same (sort never applied)

**Steps**
1. Take first `baseFare` from Bug 2.
2. Take first `baseFare` from Bug 3.
3. Confirm the two result lists differ.

**Expected:** Different hotel order. DESC first ≥ ASC first.

**Actual:** Both first fares = `5713.6`. Same 10 hotels. `sort` query is ignored for known keys as well as unknown keys.

---

### Bug 5 — Page 2 with `sort=price_ASC` repeats page 1

**Steps**
1. Page 1 = baseline. Note ids and last fare (`1017.42`). Save `requestId` = `3e5c0463-77c6-46d7-8b65-71b77aec8b84`.
2. Page 2: same body, set `"requestId": "3e5c0463-77c6-46d7-8b65-71b77aec8b84"`.
3. Query `offset=10&limit=5&sort=price_ASC` (next = response.offset 0 + size 10).
4. Check: `response.offset=10`, no overlapping ids, page2[0].baseFare ≥ 1017.42.

**Expected:** Next slice of the globally ASC-sorted set.

**Actual:** HTTP 200, `offset=0`, same fares, **10 overlapping ids**. New `requestId` minted: `6cddfb83-fb53-432b-b3d2-9e1e62f0bce3`.

---

## Filter

Spec: read `filters[]`, send `fq` in the **body** as a string array:
- one value: `"df_long_star_rating:5"`
- several values: `"df_long_star_rating:4;5"` (semicolon, not comma)
- several filters: extra array entries (AND)
- Facet counts are computed **before** filtering (other options stay visible)
- `totalResults` reflects the **filtered** set

### Bug 6 — Single facet `fq` is ignored

**Steps**
1. Clone baseline body.
2. Add only:
```json
"fq": ["df_long_star_rating:5"]
```
3. Call `/v1/hotels/search` with baseline query.
4. Assert every `results[].starRating === 5` and `totalResults < 302`.

**Expected:** Only 5-star hotels. Facet said 10 fives. `totalResults` should drop.

**Actual:** HTTP 200, `totalResults=302`, `starRating=[3,3,3,3,3,0,3,0,3,2]`. First hotel still 3-star Keys Prima.  
`requestId`: `b8a402d5-0b97-475f-8ec7-1923a8214ee8`

---

### Bug 7 — Semicolon multi-value `fq` is ignored

**Steps**
1. Clone baseline.
2. Set only:
```json
"fq": ["df_long_star_rating:5;4"]
```

**Expected:** Every `starRating` in `{4, 5}`.

**Actual:** HTTP 200, `totalResults=302`, stars `[3,3,3,3,3,0,3,0,3,2]` (3 / 0 / 2 star still present).  
`requestId`: `583b29c9-d047-4af1-87c5-018b1709736c`

---

### Bug 8 — Combined (AND) filters ignored

**Steps**
1. Clone baseline.
2. Set only:
```json
"fq": [
  "df_long_star_rating:5",
  "Reservation policy:Free cancellation"
]
```

**Expected:** 5-star AND free cancellation. `totalResults` ≤ 5-star-only total.

**Actual:** HTTP 200, `n=10`, `totalResults=302` (same as unfiltered).  
`requestId`: `dba487e5-cd59-470d-aec4-76023d4c7d26`

---

### Bug 9 — `fq` object accepted (spec wants `string[]`)

**Steps**
1. Clone baseline.
2. Set only (legacy object shape):
```json
"fq": { "df_long_star_rating": ["5"] }
```

**Expected:** HTTP 400 `VALIDATION_ERROR`.

**Actual:** HTTP 200, 10 unfiltered hotels, `totalResults=302`.  
`requestId`: `099823de-6553-42bd-ac5a-7f947208f938`

---

### Bug 10 — `fq` bare string accepted

**Steps**
1. Clone baseline.
2. Set only:
```json
"fq": "df_long_star_rating:5"
```
(not an array)

**Expected:** HTTP 400 `VALIDATION_ERROR`.

**Actual:** HTTP 200, same first page.  
`requestId`: `fcbecb63-9217-406c-bdc8-a45d4451b06d`

---

## Paging

Spec: sort and paging in the **query string**.  
`next offset = response.offset + response.size`. Stop when `last == true`.  
Do **not** use `page * size`. `page` is `floor(offset / limit)` — display only.  
Keep dates, `entityId`, rooms, `fq`, and `sort` identical across pages. Echo `requestId`.

### Bug 11 — `limit=5` ignored (`size=10`)

**Steps**
1. Baseline: `offset=0&limit=5`.
2. Read `size` and `results.length`.

**Expected:** `size=5`, 5 hotels, `last=false`.

**Actual:** `size=10`, 10 hotels. Query `limit` is ignored.

---

### Bug 12 — `totalPages` uses default size 10, not `limit=5`

**Steps**
1. Same call as Bug 11 (`totalResults=302`, `limit=5`).
2. Compare `totalPages` to `ceil(302 / 5) = 61`.

**Expected:** `totalPages=61` (if limit=5 were honored).

**Actual:** `totalPages=31` (= `ceil(302 / 10)`).

---

### Bug 13 — Next page `offset + size` returns page 1 again

**Steps**
1. Page 1: `offset=0`. Record ids.
2. Page 2: same body + page-1 `requestId`. Query `offset=10&limit=5&sort=price_ASC`.
3. Assert `response.offset=10` and **zero** overlapping ids.

**Expected:** Different hotels.

**Actual:** HTTP 200, `offset=0`, all 10 ids overlap page 1.  
`requestId`: `6cddfb83-fb53-432b-b3d2-9e1e62f0bce3`

---

### Bug 14 — Same search params on “page 2” is not a continuation

**Steps**
1. Use the two calls from Bug 13 (same dates / entity / rooms / sort).
2. Check `totalResults` **and** hotel-id overlap.

**Expected:** Same `totalResults=302`, different hotel ids.

**Actual:** `302` / `302` but **overlap=10**. Page 2 is a replay of page 1.

---

### Bug 15 — Last page never sets `last=true`

**Steps**
1. Intended last offset for limit=5 and 302 results: `offset=300` (script used 295).
2. Query `offset=295&limit=5&sort=price_ASC`, same body.
3. Read `last`, `offset`, `results.length`.

**Expected:** `last=true`, `offset=295` (or 300), remaining hotels only.

**Actual:** HTTP 200, `last=false`, `offset=0`, `n=10`, `page=0` — first page again.  
`requestId`: `6eaf4086-88d5-4b87-8d22-1a157de827ea`

---

### Bug 16 — `offset=7` does not report `page=1` / `offset=7`

**Steps**
1. Clone baseline.
2. Query **only** change: `offset=7&limit=5&sort=price_ASC`.
3. Spec: `page = floor(7/5) = 1`. Echo `offset=7`.

**Expected:** HTTP 200, `page=1`, `offset=7`, results start at hotel 8 of the sorted set.

**Actual:** HTTP 200, `page=0`, `offset=0`, same ids starting at `15237042`.  
`requestId`: `ba107a13-55c3-4a19-b163-b80d43d1cb55`

---

### Bug 17 — offset=5 vs offset=7 is a full duplicate (not a 3-hotel shift)

**Steps**
1. Call A: `offset=10` (or 5) with `limit=5`.
2. Call B: `offset=7&limit=5`.
3. Spec example: offset=7 should share **3** hotels with offset=5.

**Expected:** Partial overlap; `offset=7` on call B.

**Actual:** Both `offset=0`, **sharedCount=10** (identical set). Cannot demonstrate display-only `page` because offset is discarded.

---

### Bug 18 — Offset past the end still returns the first page

**Steps**
1. Clone baseline.
2. Query `offset=9999&limit=5&sort=price_ASC`.

**Expected:** HTTP 200 empty `results` + `last=true`, or 4xx. Not 500. Must **not** return page 1.

**Actual:** HTTP 200, `n=10`, `last=false`, `offset=0`, Keys Prima first.  
`requestId`: `33c0a0ef-7a82-4cb3-8583-375555772d07`

---

### Bug 19 — Negative `offset=-1` accepted

**Steps**
1. Clone baseline.
2. Query **`offset=-1`**.

**Expected:** HTTP 400 `error.code=VALIDATION_ERROR`.

**Actual:** HTTP 200, 10 hotels, `offset=0`.  
`requestId`: `ea5c2b2f-a0d2-47ac-b656-9e3dc312ab1d`

---

### Bug 20 — `limit=0` accepted as a full page of 10

**Steps**
1. Clone baseline.
2. Query **`limit=0`**.

**Expected:** HTTP 400 `VALIDATION_ERROR`, or HTTP 200 with empty results / `size=0`.

**Actual:** HTTP 200, `n=10`, `size=10`.  
`requestId`: `5db8ce96-d0cf-411c-8a57-5876b03e62ff`

---

### Bug 21 — Non-numeric `offset=abc` accepted

**Steps**
1. Clone baseline.
2. Query **`offset=abc`**.

**Expected:** HTTP 400 `VALIDATION_ERROR`.

**Actual:** HTTP 200, same first 10 hotels.  
`requestId`: `f1932db0-2704-4942-a43b-12231e809db1`

---

### Bug 22 — `requestId` not reused on follow-up

**Steps**
1. Page 1 baseline. Copy `requestId` = `3e5c0463-77c6-46d7-8b65-71b77aec8b84`.
2. Page 2: same search body with that `requestId` in the body. Query `offset=10&sort=price_ASC`.
3. Spec: echo `requestId` on follow-up pages (and quote it in bugs).

**Expected:** Same search continues (`requestId` equal, or paging uses that search).

**Actual:**
```
page1 requestId = 3e5c0463-77c6-46d7-8b65-71b77aec8b84
page2 requestId = 6cddfb83-fb53-432b-b3d2-9e1e62f0bce3
```
New id each time; page 2 is still hotel set 1.

---

# Not bugs / blocked

| Status | Case | Why |
|---|---|---|
| PASS | Shape 2–4 | Live `/v1/hotels/search` returns envelope, `sorts[]`, star `facetKey`s |
| PASS | Sort 5–7 | Unknown / empty / star-as-sort still HTTP 200 (spec: unknown sort ignored). **Note:** known sort also 200 vendor-order, so these pass for the wrong reason |
| PASS | Filter 7–8 | Unknown `indexField` / `facetKey` did not 500 |
| PASS | Paging 13 | Changing `entityId` on a later call returned 0 hotels (different search) |
| NOT TESTED | Filter 2 | Pre-filter facet visibility — needs `fq` to actually filter first |
| NOT TESTED | Filter 5–6 | Comma vs semicolon, repeated `fq` entries — blocked because `fq` is ignored |
| NOT TESTED | Paging 12 | Dropping sort on page 2 — blocked because sort never applied |

---

# Suggested backend work

1. **Route:** ship `POST /api/hotels/v2/availability/listing` on canary, **or** confirm v1 search is listing v2 and update the spec path.
2. **Sort:** map query `sort` to `sorts[].key`. Order by `price.baseFare` **before** paging.
3. **Paging:** honor query `offset` + `limit`. Echo `offset` / `size` / `last`. `page = floor(offset / limit)` (display only). Do not use `page * size` as the cursor. Empty/`last=true` when offset is past the end.
4. **Filter:** parse body `fq` as `string[]` of `indexField:value`. Multi-value = semicolon. AND across array entries. Reduce `totalResults`. Keep **pre-filter** facet counts visible.
5. **Validation:** HTTP 400 + shared envelope `error.code=VALIDATION_ERROR` for `offset<0`, non-numeric offset, `limit<=0`, `fq` not a string array.
6. **requestId:** echo the client value on follow-up listing calls so paging/filter stay on the same search.

Search itself works (302 hotels for Pune; changing `entityId` starts a different search). The listing v2 **contract fields are present; the request knobs are not wired**.

---

Raw probe JSON: `reports/hotel-listing-v2-canary.json`  
Probe script: `scripts/probe-hotel-listing-v2-canary.js`
