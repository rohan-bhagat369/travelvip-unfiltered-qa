# Aggregation MD pack — B2B preprod results

Checked: **2026-11-23T09:45:59.463Z** · Search minute: **2026-11-23T09:44**
Env: `https://preprod-api.travelvip.ai` · partner `vgm` · merged tier `22101801`
Dates: OW/RT onward **2026-12-14**, return **2026-12-21** · OD: DEL–DXB, DEL–BOM
Flow: search → details (+ pricing) · **no book**

## Summary: 65 PASS · 6 BUG · 18 NOT TESTED

## Headline BUGs

| Case | Issue | Evidence |
|---|---|---|
| **A1** | TBO-only tier `22157551` returned **422R only** (expected 402T) | `dumps/ow-tbo-del-dxb.json` |
| **A3 / A4 / C3 / C13** | Merged tier no TBO this run — only `422R`, 0 dual cards | `dumps/ow-merged-del-dxb.json` (contrast: oneshot 09:09 had both) |
| **F5-partial** | Search 19850 → pricing **20200** (+350 convenienceFee) | `dumps/pricing-ow-422R.json` |

## Notes
- Earlier smoke 09:09Z on same OD/date had both 402T+422R (35 dual). This pack run only 422R across merged AND TBO-only tier — TBO lane absent / mis-routed.
- A1: tier 22157551 expected 402T only, got 422R only — supplier routing BUG.
- F5-partial: search total 19850 → pricing 20200 (+350 convenienceFee).
- C11 initially false BUG due to nested combinedPricing.pricing.totalAmount — rescored PASS.

| Case | How tested | Status | Notes |
|---|---|---|---|
| H1 | Pinned OD/dates for pack | **PASS** | DEL-DXB/BOM OW 2026-12-14 RT ret 2026-12-21 |
| H3 | Only DEL-DXB + DEL-BOM ODs | **PASS** |  |
| H4 | No issue-ticket / book in this run | **PASS** |  |
| H5 | Report includes search timestamp | **PASS** | 2026-11-23T09:44 |
| A-N1 | Invalid tierId session | **PASS** | Invalid tierId |
| A-N2 | Missing tierId on session | **PASS** | http=400 |
| A-N3 | Wrong/invalid partner access on session | **PASS** | http=401 |
| A3 | OW merged CODES has both vendors | **BUG** | codes=["422R"] |
| A4 | ∃ option with both sourceCodes | **BUG** |  |
| A5 | No null/missing sourceCode on OW merged | **PASS** |  |
| A-N5 | No third sourceCode invented | **PASS** |  |
| B1 | No duplicate scheduleKey on ONWARD | **PASS** |  |
| B2 | displayPrice == minFare ∀ options | **PASS** |  |
| B8 | All fare totals > 0 | **PASS** |  |
| B9 | Merged card segments | **NOT TESTED** | no dual option |
| B10 | Fare retention on merged card | **NOT TESTED** | no dual option |
| B11 | Unmatched single-vendor cards still valid | **PASS** |  |
| B12 | Display price equals a real fare amount | **PASS** |  |
| B-N1 | Display price never > all fares (covered by B2) | **PASS** |  |
| B-N2 | No duplicate schedule cards | **PASS** |  |
| B5 | Airline facet case-unique | **NOT TESTED** | no airline facet in response shape |
| B6 | sort fare,asc → cheapest per card non-decreasing | **PASS** |  |
| B7 | Paging concat == totalResults + no dup | **PASS** |  |
| A1 | TBO-only tier CODES=={402T} | **BUG** | codes=["422R"] |
| A2 | Riya tier 8 CODES=={422R} | **PASS** | codes=["422R"] |
| D6 | Tier 15 Riya-only (no TBO) | **PASS** | codes=["422R"] |
| D-N1 | No single-tier dual codes among tested singles | **PASS** | no dual on available single tiers |
| B3 | N(merged) >= max(N(TBO), N(Riya)) | **PASS** |  |
| B4 | N(merged) <= N(TBO)+N(Riya) | **PASS** |  |
| H2 | B3/B4 same OD+date | **PASS** | DEL-DXB 2026-12-14 |
| DET1 | Details API for 422R fare from merged search | **PASS** | http=200 |
| DET2 | Pricing API for 422R (pre-book) | **PASS** | http=200 |
| F5-partial | Search fare ≈ pricing total (422R, no issue) | **BUG** | book/payment not run — pricing step only |
| DET3 | Details 402T | **NOT TESTED** | no 402T fare |
| DET-N1 | Details with bad searchId → 4xx not 500 | **PASS** | http=404 |
| C1 | RT directions ONWARD+RETURN non-empty | **PASS** | http=200 |
| C2 | No empty fares[] on RT options | **PASS** |  |
| C3 | RT CODES both vendors before selection | **BUG** | codes=["422R"] |
| C4 | fareType non-null on RT fares | **PASS** |  |
| C5 | RT displayPrice == minFare | **PASS** |  |
| C6 | RETURN after selection > 0 | **PASS** |  |
| C7 | N(RETURN after) <= before | **PASS** |  |
| C8 | Return codes == selected onward sourceCode | **PASS** |  |
| C9 | ∃ combinedPricing.type==COMBINATION | **PASS** |  |
| C10 | combinedPricing != 2 * onward | **PASS** | nested pricing path |
| C11 | combinedPricing >= onward | **PASS** | combinedPricing.pricing.totalAmount; onward=39193; checked=12 |
| C-N1 | Empty RETURN after selection is BUG | **PASS** |  |
| C-N2 | Mixed return sourceCode is BUG | **PASS** |  |
| D5 | Selection → single vendor codes on RETURN | **PASS** |  |
| DET5 | Details API RT onward+return pair | **PASS** | http=200 |
| C14a | Select cheapest onward — returns single-vendor | **PASS** | codes=["422R"] |
| C14 | Cheapest vs dearest selection | **PASS** |  |
| C15 | TBO vs Riya onward | **NOT TESTED** |  |
| C12 | Repeat C6–C11 across fares/cards | **PASS** |  |
| C-N3 | ONWARD schedule not appearing as RETURN | **PASS** |  |
| C13 | Repeat C1–C11 core on DEL-BOM | **BUG** | scored C1+C3 core; selection subset below if options |
| C13-sel | DEL-BOM selection returns single-vendor RETURN | **PASS** |  |
| D1-tbo | RT ∀ fares non-empty tier 22157551 | **PASS** |  |
| D2-tbo | RT len(CODES)==1 tier 22157551 | **PASS** | codes=["422R"] |
| D3-tbo | Selection RETURN non-empty tier 22157551 | **PASS** |  |
| D1-riya8 | RT ∀ fares non-empty tier 8 | **PASS** |  |
| D2-riya8 | RT len(CODES)==1 tier 8 | **PASS** | codes=["422R"] |
| D3-riya8 | Selection RETURN non-empty tier 8 | **PASS** |  |
| D1-riya15 | RT ∀ fares non-empty tier 15 | **PASS** |  |
| D2-riya15 | RT len(CODES)==1 tier 15 | **PASS** | codes=["422R"] |
| D3-riya15 | Selection RETURN non-empty tier 15 | **PASS** |  |
| D1 | Single-vendor RT fares non-empty (rollup) | **PASS** |  |
| D2 | Single-vendor RT single code (rollup) | **PASS** |  |
| D3 | Single-vendor selection RETURN (rollup) | **PASS** |  |
| D4 | MULTI_CITY len(CODES)==1 (never merged) | **NOT TESTED** | VALIDATION_ERROR |
| D-N2 | MULTI_CITY must not show both codes | **PASS** | codes=[] |
| G1 | Past travel date → 4xx | **PASS** | http=400 |
| G2 | Return before onward → 4xx | **PASS** | http=400 |
| G3 | 0 adults → 4xx | **PASS** | http=400 |
| G4 | Empty body → 4xx | **PASS** | http=400 |
| G5 | Bad page/perpage never 500 | **PASS** | http=400 |
| G8 | Special chars in optional fields not 500 | **PASS** | http=200 |
| G6 | size=-1 vs paged same ids | **NOT TESTED** | B2B uses perpage; scored via B7 paging instead |
| G7 | Airline filter after merge | **NOT TESTED** | no stable airline filter applied this run |
| G9 | Merged vs single timing | **NOT TESTED** | timing not instrumented beyond smoke |
| G10 | No Riya string leak in fareRules/bookingCode | **NOT TESTED** | fareRules/book not in this run (details only) |
| E1 | One vendor down | **NOT TESTED** | needs Dev fault injection |
| E2 | One vendor slow | **NOT TESTED** | needs Dev fault injection |
| E3 | Both vendors down | **NOT TESTED** | needs Dev fault injection |
| F1 | OW book 422R | **NOT TESTED** | stopped at details/pricing — ALLOW_BOOK not set |
| F2 | OW book 402T | **NOT TESTED** | stopped at details/pricing — ALLOW_BOOK not set |
| F3 | RT book | **NOT TESTED** | stopped at details/pricing — ALLOW_BOOK not set |
| F4 | Single-tier RT book | **NOT TESTED** | ALLOW_BOOK not set |
| F5 | Search==payment price | **NOT TESTED** | no issue-ticket; see F5-partial on pricing if present |

## Dumps

- `tiers-list`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\tiers-list.json`
- `ow-merged-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\ow-merged-del-dxb.json`
- `ow-merged-page0`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\ow-merged-page0.json`
- `ow-tbo-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\ow-tbo-del-dxb.json`
- `ow-riya8-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\ow-riya8-del-dxb.json`
- `ow-riya15-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\ow-riya15-del-dxb.json`
- `details-ow-422R`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\details-ow-422R.json`
- `pricing-ow-422R`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\pricing-ow-422R.json`
- `rt-merged-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-merged-del-dxb.json`
- `rt-sel-primary`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-sel-primary.json`
- `details-rt-pair`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\details-rt-pair.json`
- `rt-sel-cheapest`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-sel-cheapest.json`
- `rt-sel-c12-0-422R-62ecc5`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-sel-c12-0-422R-62ecc5.json`
- `rt-sel-c12-1-422R-2f8405`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-sel-c12-1-422R-2f8405.json`
- `rt-sel-c12-2-422R-5b57f6`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-sel-c12-2-422R-5b57f6.json`
- `rt-merged-del-bom`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-merged-del-bom.json`
- `rt-sel-bom`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-sel-bom.json`
- `rt-tbo-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-tbo-del-dxb.json`
- `rt-riya8-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-riya8-del-dxb.json`
- `rt-riya15-del-dxb`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\rt-riya15-del-dxb.json`
- `mc-merged`: `D:\Travel VIP API Automation\travel-apis\flight\reports\aggregation-tbo-riya-preprod\dumps\mc-merged.json`
