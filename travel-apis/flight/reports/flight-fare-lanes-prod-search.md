# Fare Lanes — B2B preprod (search only, no book)

- Base: `https://api.travelvip.ai`
- Correlation: `0b084928-ccfb-43a3-b672-5b6a1921fd09`
- Route: DEL→BOM · days=35
- **PASS 37 / BUG 2 / NOT TESTED 18**

## A
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | A-1 | omitted / "" / NORMAL / normal → 200 identical | **PASS** |
| 2 | A-2-NORMAL | alone NORMAL → only that fareCategory | **PASS** |
| 3 | A-2-CORPORATE | alone CORPORATE → only that fareCategory | **PASS** |
| 4 | A-2-SME | alone SME → only that fareCategory | **PASS** |
| 5 | A-2-STUDENT | alone STUDENT → only that fareCategory | **PASS** |
| 6 | A-2-DEFENCE | alone DEFENCE → only that fareCategory | **PASS** |
| 7 | A-2-SENIOR_CITIZEN | alone SENIOR_CITIZEN → only that fareCategory | **PASS** |
| 8 | A-3a | multi CORPORATE,NORMAL → all categories present | **PASS** |
| 9 | A-3b | multi NORMAL,SME → all categories present | **PASS** |
| 10 | A-3c | multi NORMAL,SME,CORPORATE → all categories present | **PASS** |
| 11 | A-4a | NORMAL , SME (spaces) trimmed | **PASS** |
| 12 | A-4b | CORPORATE,CORPORATE collapses | **PASS** |
| 13 | A-5a | BUSINESS → 400 INVALID_FARE_TYPE | **PASS** |
| 14 | A-5b | NORMAL,BUSINESS → 400 INVALID_FARE_TYPE | **PASS** |
| 15 | A-6a | flexi_cancel alone → 200 | **PASS** |
| 16 | A-6b | flexi_cancel + other → 400 INVALID_FARE_TYPE | **PASS** |
## B
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | B-1 | NORMAL only — no CORP/SME leak | **PASS** |
| 2 | B-2 | CORPORATE only — no normal leak | **PASS** |
| 3 | B-3 | All pages: every fare has fareCategory; no dual category | **PASS** |
| 4 | B-4 | fareCategories facet matches fares offered across pages | **PASS** |
| 5 | B-5 | IX present under SME (fareCategory=SME) | **PASS** |
| 6 | B-6 | Watch logs for v2.corpFare unclassified | **NOT TESTED** |
## C
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | C-1 | One card with 2+ categories, distinct searchIds | **PASS** |
| 2 | C-2 | displayPricing equals cheapest fare | **PASS** |
| 3 | C-3 | Page 0 cheapest-first across categories | **PASS** |
| 4 | C-4 | Sum of options across pages = totalResults | **PASS** |
| 5 | C-5 | Cached size=5 vs size=50: same totalResults; cards keep categories | **PASS** |
| 6 | C-6 | appliedFilters fareCategories=["CORPORATE"] prunes fares | **PASS** |
| 7 | C-7 | fareCategories=[""] treated as no filter | **PASS** |
| 8 | C-8 | Single-fare-type: progress.lanesTotal/lanesReady null | **PASS** |
## D
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | D-1 | RT NORMAL,SME — select SME onward → both dirs SME | **NOT TESTED** |
| 2 | D-2 | RT — select NORMAL onward → both dirs NORMAL | **BUG** |
| 3 | D-3 | Select using fare-level searchId from fares[] | **PASS** |
| 4 | D-4 | Cross-category RT pair → pricing INVALID_COMBINATION | **NOT TESTED** |
| 5 | D-5 | Cross pair → details + fareRules INVALID_COMBINATION | **NOT TESTED** |
| 6 | D-6 | Same-category RT → pricing succeeds | **NOT TESTED** |
| 7 | D-7 | Legs from two different searches rejected | **NOT TESTED** |
| 8 | D-8 | Intl RT select onward, re-search, price succeeds | **NOT TESTED** |
| 9 | D-9 | Book domestic RT end to end | **NOT TESTED** |
| 10 | D-10 | Book intl RT end to end | **NOT TESTED** |
## E
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | E-1 | Corporate searchId → details/pricing/fareRules 200 | **NOT TESTED** |
| 2 | E-2 | Normal fare pricing 200 | **NOT TESTED** |
| 3 | E-3 | All six fare types through details/pricing/fareRules | **NOT TESTED** |
| 4 | E-4 | SME → fareRules (corporate rules branch) | **NOT TESTED** |
| 5 | E-5 | SME pricing flexiCancelFee is 0 | **NOT TESTED** |
| 6 | E-6 | pricing → refresh-token → selection/pricing category survives | **NOT TESTED** |
| 7 | E-7 | ssr + seatmap on priced selection | **NOT TESTED** |
## F
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | F-1 | No fareType — works; combinationRefs absent | **PASS** |
| 2 | F-2 | OW every main fare type correct | **PASS** |
| 3 | F-3 | combinationRefs absent on search/details/pricing/fareRules | **PASS** |
| 4 | F-4 | preferences airlines/maxStops applied across categories | **PASS** |
| 5 | F-5 | Filters excluding everything → 200 empty + facets, not 404 | **PASS** |
| 6 | F-6 | No flights route → NO_FLIGHTS_FOUND | **BUG** |
| 7 | F-7 | V1 flight flows untouched | **NOT TESTED** |
| 8 | F-8 | Book OW end to end | **NOT TESTED** |
## X
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | X-1 | GARBAGE / SMEE → INVALID_FARE_TYPE (no silent NORMAL) | **PASS** |
| 2 | X-2 | SME fares can have label Corporate but fareCategory=SME | **PASS** |

## Bugs
### D-2
- Expected: only NORMAL
- Actual: {"onward":[],"ret":[]}
### F-6
- Expected: 4xx NO_FLIGHTS_FOUND
- Actual: http=400 code=VENDOR_ERROR