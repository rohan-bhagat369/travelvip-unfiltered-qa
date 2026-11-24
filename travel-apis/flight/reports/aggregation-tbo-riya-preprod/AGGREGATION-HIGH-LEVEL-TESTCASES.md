# Flight Aggregation (TBO + Riya) — High-Level Test Cases

**Feature:** merged flight search across two suppliers — TBO (`sourceCode 402T`) and Riya (`sourceCode 422R`)
**Env tested:** `https://preprod-api.travelvip.ai` · partner `vgm`
**Routes:** DEL→BOM (domestic), DEL→DXB (international) · one-way + round trip · travel dates 15 Dec / 22 Dec 2026
**Tested on:** 24 Nov 2026 · **no bookings** (preprod) · each scenario searched once, everything else re-used the cached search
**Detailed sheet:** `AGGREGATION-TESTCASES-2026-11-24.csv` (499 cases)

Status: ✅ Pass · ❌ Fail (bug) · ⚠️ Needs confirmation · ⏸ Not tested

---

## Change log (what this release does)

| # | Change |
|---|---|
| CL1 | Tier `22101801` searches **both** TBO and Riya and combines the results. |
| CL2 | Tiers `22157551` (TBO only), `8` and `15` (Riya only) stay **single-supplier** — no merging. |
| CL3 | Two results are the **same flight** only if every segment matches: flight number, departure airport + time (to the minute), arrival airport + time, cabin. |
| CL4 | Formatting differences are ignored: `IX 1391` = `ix-1391` = `IX01391`; `08:55:00` = `08:55`. |
| CL5 | Same flight → **one card**; the other supplier's fares are added to it — no fare dropped. |
| CL6 | Card price = **cheapest fare** on the card; merging can only make a card cheaper. |
| CL7 | Not merged (expected): codeshares, different time/cabin/route/stops, multi-city, searches with a selection. |
| CL8 | Every fare carries `sourceCode` and its own `searchId`; it books through its own supplier. |
| CL9 | Round trip: after picking an outbound fare, return flights come from **that supplier only**; a cross-supplier round trip is not bookable. |

---

## 1. Tier routing (CL1, CL2)

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| TR-01 | Search on merged tier `22101801` | Positive | Fares from both `402T` and `422R` | ✅ |
| TR-02 | Search on TBO-only tier `22157551` | Positive | Only `402T` fares | ❌ returned both / shared cache |
| TR-03 | Search on Riya-only tiers `8` and `15` | Positive | Only `422R` fares | ❌ returned both, later TBO only |
| TR-04 | Same route/date on all four tiers | Positive | Each tier gets its own result | ❌ identical searchIds + cache timestamp |
| TR-05 | Merged count vs single tiers | Positive | More than either supplier, fewer than both added | ⏸ blocked by TR-02/03 |
| TR-06 | Search on tier A, details + pricing with tier B session | Negative | Rejected (4xx) | ❌ 12 of 16 combinations accepted |
| TR-07 | Fare of a supplier not configured on the session tier | Negative | Rejected | ❌ TBO fare priced on Riya-only tiers |
| TR-08 | One supplier returns nothing on merged tier | Edge | Response flagged as partial | ❌ `COMPLETE`, `partial: false` |
| TR-09 | Session token carries the requested tier | Positive | JWT `tierId` = requested | ✅ |

## 2. Merge rules — same flight becomes one card (CL3, CL4, CL5)

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| MG-01 | Flight sold by both suppliers | Positive | One card, fares from both inside | ✅ (e.g. 154 of 220 DEL→BOM) |
| MG-02 | No flight appears on two cards | Positive | Unique flight per card | ✅ |
| MG-03 | Merged card is really the same flight | Positive | Details of TBO fare and Riya fare show identical flight, airports, times, cabin | ✅ 5/5 per route |
| MG-04 | Formatting differences (seconds in time) | Edge | Still merged | ✅ TBO `20:40:00` = Riya `20:40` |
| MG-05 | Connecting flights | Positive | Merged only when every leg matches | ✅ |
| MG-06 | Merge on round trip (onward and return separately) | Positive | Both directions merged, onward never mixed with return | ✅ |
| MG-07 | No fare dropped after merge | Positive | All fares of both suppliers kept | ⏸ blocked by TR-02/03 |
| MG-08 | Same fare listed twice in one card | Edge | Each fare once | ❌ Riya fare repeated up to 9× |
| MG-09 | Merge with multiple passengers | Positive | Merged cards, group price > single price | ✅ |
| MG-10 | Merge in Business cabin | Positive | Business-only, merged cards | ✅ |
| MG-11 | Merge of Corporate fares | Positive | Corporate fares from both suppliers merged | ❌ none — TBO fares have no category |
| MG-12 | Merge by fare category (NORMAL / SME / CORPORATE) | Positive | Both suppliers per category | ❌ TBO `fareCategory` always null |

## 3. Should NOT merge (CL7)

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| NM-01 | Same flight number, different time | Edge | Separate cards | ✅ |
| NM-02 | Codeshare (same times, different flight numbers) | Edge | Separate cards | ✅ |
| NM-03 | Direct vs connecting on same route | Edge | Separate cards | ✅ |
| NM-04 | Same flight in Economy vs Business | Edge | Never one card | ✅ |
| NM-05 | Multi-city search | Edge | Not merged | ⏸ API accepts only one-way / round trip |
| NM-06 | Search with a selection already made | Edge | Only selected supplier returned | ✅ for return list · ⚠️ onward list still shows both |

## 4. Card price, sort, paging, filters (CL6)

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| PR-01 | Card price = cheapest fare on the card | Positive | `displayPricing` = min of `fares[]` | ✅ all cards |
| PR-02 | Card price is a real selectable fare | Positive | Never a price you can't pick | ✅ |
| PR-03 | Fare breakdown adds up | Positive | base + taxes + fees = total, INR | ✅ |
| PR-04 | Sort by price / stops / duration | Positive | Correct order, merge still applied | ✅ |
| PR-05 | Paging across all pages | Positive | Pages add up to `totalResults`, no repeats | ✅ |
| PR-06 | Paging limits (last page, page 9999, perpage 1, page=abc) | Boundary | Short page / empty / 1 card / 4xx | ✅ (`page=abc` wrong error code) |
| PR-07 | perpage 0 / -1 | Boundary | 4xx or "all" by design | ⚠️ returns all flights |
| PR-08 | Filters (airline, non-stop, refundable, price, fare type, combo) | Positive | Only matching flights, merged cards kept | ✅ |
| PR-09 | Filter panel counts | Positive | Count = flights shown | ❌ merged flights counted twice |
| PR-10 | Empty / unknown filter values | Edge | Empty list, not an error | ✅ |
| PR-11 | Fare-type filter (NORMAL / SME / CORPORATE) | Positive | Both suppliers' matching fares | ❌ all TBO fares removed |
| PR-12 | Results only for searched airports | Edge | DEL / BOM / DXB only | ⚠️ nearby airports returned (AUH, SHJ, NMI…) |

## 5. Round trip selection (CL9)

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| RT-01 | Pick outbound fare → return list | Positive | Return list not empty | ❌ 0 returns for non-cheapest TBO fares |
| RT-02 | Return list supplier | Positive | Same supplier as outbound | ✅ |
| RT-03 | Return list never grows after selection | Positive | Shrinks or stays | ✅ |
| RT-04 | Combined price on return cards | Positive | `COMBINATION`, ≥ outbound, ≠ 2× outbound | ✅ |
| RT-05 | TBO outbound + Riya return | Negative | Rejected | ✅ `INVALID_COMBINATION` |
| RT-06 | Round trip with outbound id only / ids reversed / two outbound ids | Negative | Rejected | ✅ |

## 6. Booking path up to pricing, per supplier (CL8)

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| BK-01 | Details for a fare | Positive | 200, same flight as the card | ✅ |
| BK-02 | Details price | Positive | Matches search | ✅ (TBO in USD by design, matches at rate 96) |
| BK-03 | Fare rules | Positive | Rules for the picked fare, cancellation/change charges | ✅ |
| BK-04 | Fare rules per leg on round trip | Positive | One block per leg | ❌ Riya returns one block |
| BK-05 | Pricing | Positive | `priceId` + `bookingContext`, price = search | ✅ Riya · ❌ TBO intermittent `VENDOR_ERROR` |
| BK-06 | Passenger prices add up (1 ADT and 2+1+1) | Positive | Sum = total | ✅ Riya · ❌ TBO |
| BK-07 | SSR (meals, baggage) | Positive | Options listed, INR, ≥ 0 | ✅ |
| BK-08 | Seat map | Positive | One map per segment, seats with prices | ✅ · ❌ Riya round trip fails |
| BK-09 | Same response fields filled for both suppliers | Positive | No supplier-specific nulls | ❌ TBO nulls (fareCategory, logo, operatingCarrier, legId, …) |
| BK-10 | No "Riya" text in any response | Positive | Supplier name hidden | ✅ |
| BK-11 | Book / issue ticket / payment price | Positive | PNR, price unchanged | ⏸ no booking on preprod |

## 7. Negative and validation

| ID | Test case | Type | Expected | Status |
|---|---|---|---|---|
| NG-01 | Invalid search input (same origin/destination, bad airport, past date, bad date format, 0 / 10 adults, infants > adults, bad cabin / fareType / journeyType, HTML in fields, empty body) | Negative | 4xx with `error.code` | ✅ |
| NG-02 | Missing or garbage session token | Negative | 401 / 403 | ✅ |
| NG-03 | Details / fare rules / pricing with empty, unknown, HTML or comma searchId | Negative | 4xx | ✅ |
| NG-04 | Expired searchId / priceId / bookingContext | Negative | 4xx (`SEARCH_ID_NOT_FOUND`) | ✅ |
| NG-05 | SSR with empty / unknown / HTML / missing priceId | Negative | 4xx | ✅ |
| NG-06 | Seat map with missing / garbage context, empty passengers | Negative | 4xx | ✅ |
| NG-07 | Seat map with HTML in passenger name | Negative | 4xx | ❌ accepted |
| NG-08 | No negative case returns 5xx | Negative | Never 500 | ✅ |

## 8. Not covered

| ID | Test case | Why |
|---|---|---|
| NC-01 | One supplier down / slow / both down | Needs Dev fault injection |
| NC-02 | Booking, PNR, price at payment | No booking on preprod |
| NC-03 | Multi-city | Not supported on `/v1/flights/search` |

---

**Summary:** the merge itself works — same flight becomes one card with both suppliers' fares, cheapest price shown, correct sort/paging, round-trip returns stay with the chosen supplier. Main gaps are tier separation (routing, cache, cross-tier pricing), TBO data (`fareCategory` and other nulls, pricing failures, passenger totals) and filter counts. Full bug list in the task comments.
