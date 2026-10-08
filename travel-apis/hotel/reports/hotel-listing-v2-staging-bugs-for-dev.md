# Hotel listing v2 — api-staging retest

**For:** Partner gateway / hotel search  
**Spec:** Hotel Search Test Pack — `POST /api/hotels/v2/availability/listing`  
**Live path tested:** `POST /v1/hotels/search`  
**Compared with:** same pack previously on this host (PASS 4 / BUG 17)  
**QA:** TravelVIP API Automation · partner `vgm`  
**Retest (UTC):** 2026-08-15T19:58:43Z

---

## One-paragraph summary

`POST /api/hotels/v2/availability/listing` is **still not deployed** on api-staging (HTTP 404 `"Page not found"`). Also 404: `/hotels/v2/availability/listing`, `/api/v2/hotels/availability/listing`, `/v2/hotels/availability/listing`.

`POST /v1/hotels/search` now **applies** listing v2 query/body:

- `sort=price_ASC` / `price_DESC`
- `offset` / `limit`
- body `fq[]`
- invalid paging → HTTP **400** `VALIDATION_ERROR` (not 200 of the same page)

Previously every mutated call returned the same 10 hotels (Hotel Hiltop first). That is **fixed**.

---

## Score

| Run | Pack (21) | Pack + extras (41) |
|---|---|---|
| Previous (2026-08-15T17:15:35Z) | PASS **4** / BUG **17** | PASS **20** / BUG **21** |
| **This retest** | PASS **21** / BUG **0** | PASS **41** / BUG **0** |

| Section (pack) | PASS | BUG |
|---|---:|---:|
| Sort S1–S4 | 4 | 0 |
| Filter F1–F6 | 6 | 0 |
| Paging P1–P6 | 6 | 0 |
| Validation V1–V3 | 3 | 0 |

---

## Environment / log keys

| Field | Value |
|---|---|
| Base URL | `https://api-staging.travelvip.ai` |
| Live path | `POST /v1/hotels/search` |
| Spec path | `POST /api/hotels/v2/availability/listing` → HTTP **404** (unchanged) |
| pid | `vgm` |
| `tierId` | `10546901` |
| `subscriptionId` | `123841304969662b8` |
| Search `requestId` (baseline) | `84b00af7-0d3c-4973-95b4-c455d334eca7` |
| City | `type=CITY` · `entityId=357389:IN` |
| Stay | `2026-09-10` → `2026-09-12` · `currency=INR` · 1 adult |
| `totalResults` | **631** |
| Default page when `limit=5` | **`size=5`** (was 10, ignored) |

Raw: `reports/hotel-search-test-pack-staging.json`

---

## Open item (not pack)

| | |
|---|---|
| Case | Spec listing path missing |
| How tested | `POST /api/hotels/v2/availability/listing` same query/body as baseline |
| Expected | HTTP 200 listing **or** documented that `/v1/hotels/search` is the partner contract |
| Actual | HTTP **404** `{"status":404,"info":"Page not found"}` |
| Severity | Clients using the spec URL still fail. Behaviour on `/v1/hotels/search` now matches catalog-dev. |

---

## Pack results (S / F / P / V)

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | S1 Sort options advertised | `offset=0 limit=5` no sort → `sorts[]` = `price_ASC`, `price_DESC` | **PASS** |
| 2 | S2 Price ascending | `sort=price_ASC limit=5` → fares `[540, 697.24, 793.8, 805.94, 873.94]` | **PASS** |
| 3 | S3 Price descending | `sort=price_DESC` → `[84000, 72000, 64000, 63360, 63300]` overlap with S2 = 0 | **PASS** |
| 4 | S4 Unknown sort ignored | `sort=rating_DESC` HTTP 200 same as unsorted | **PASS** |
| 5 | F1 Star facet shape | `df_long_star_rating` 5/4/3 counts 43/49/307 | **PASS** |
| 6 | F2 One value narrows | `fq ["df_long_star_rating:5"]` total=43 stars=`[5,5,5,5,5]` | **PASS** |
| 7 | F3 Multi-select semicolon | `fq ["df_long_star_rating:4;5"]` total=92 | **PASS** |
| 8 | F4 Facet counts survive selection | 5★ filter; facet counts stay 43/49/307 | **PASS** |
| 9 | F5 Filter + sort compose | Free-cancellation fq + `price_ASC` total=531 < 631; fares ASC | **PASS** |
| 10 | F6 Valueless filter ignored | empty star fq HTTP 200 total=631 | **PASS** |
| 11 | P1 Pages chain | offset 0 / 5 / 10 limit=5; no id overlap; fares increase | **PASS** |
| 12 | P2 Offset echoed | `offset=7 limit=5` → `offset=7 size=5` | **PASS** |
| 13 | P3 Non-multiple offset slice | offset=7 fares `[880, 891, 898.2, 900, 963.26]` | **PASS** |
| 14 | P4 Page size | `limit=20` → n=20 `totalPages=32` | **PASS** |
| 15 | P5 Last page | offset=627 n=4 `last=true` | **PASS** |
| 16 | P6 Past the end | offset=9999 HTTP 200 n=0 `last=true` | **PASS** |
| 17 | V1 Negative offset | `offset=-1` HTTP **400** `VALIDATION_ERROR` | **PASS** |
| 18 | V2 Zero limit | `limit=0` HTTP **400** `VALIDATION_ERROR` | **PASS** |
| 19 | V3 Non-numeric offset | `offset=abc` HTTP **400** `details: offset must be 0 or greater.` | **PASS** |

Do **not** treat remaining 404 on `/api/hotels/v2/availability/listing` as a listing-logic regression. The previous 17 pack bugs on `/v1/hotels/search` are **cleared**.
