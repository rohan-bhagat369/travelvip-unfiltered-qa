# Fare Lanes — B2B preprod (search only, no book)

- Base: `https://api.travelvip.ai`
- Correlation: `2d4061c6-0b65-4583-9ddd-24e36863c037`
- Route: DEL→BOM · days=35
- **PASS 29 / BUG 18 / NOT TESTED 10**

## A
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | A-1 | omitted / "" / NORMAL / normal → 200 identical | **PASS** |
| 2 | A-2-NORMAL | alone NORMAL → only that fareCategory | **PASS** |
| 3 | A-2-CORPORATE | alone CORPORATE → only that fareCategory | **PASS** |
| 4 | A-2-SME | alone SME → only that fareCategory | **BUG** |
| 5 | A-2-STUDENT | alone STUDENT → only that fareCategory | **PASS** |
| 6 | A-2-DEFENCE | alone DEFENCE → only that fareCategory | **PASS** |
| 7 | A-2-SENIOR_CITIZEN | alone SENIOR_CITIZEN → only that fareCategory | **PASS** |
| 8 | A-3a | multi CORPORATE,NORMAL → all categories present | **PASS** |
| 9 | A-3b | multi NORMAL,SME → all categories present | **BUG** |
| 10 | A-3c | multi NORMAL,SME,CORPORATE → all categories present | **BUG** |
| 11 | A-4a | NORMAL , SME (spaces) trimmed | **BUG** |
| 12 | A-4b | CORPORATE,CORPORATE collapses | **PASS** |
| 13 | A-5a | BUSINESS → 400 INVALID_FARE_TYPE | **BUG** |
| 14 | A-5b | NORMAL,BUSINESS → 400 INVALID_FARE_TYPE | **BUG** |
| 15 | A-6a | flexi_cancel alone → 200 | **PASS** |
| 16 | A-6b | flexi_cancel + other → 400 INVALID_FARE_TYPE | **BUG** |
## B
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | B-1 | NORMAL only — no CORP/SME leak | **PASS** |
| 2 | B-2 | CORPORATE only — no normal leak | **PASS** |
| 3 | B-3 | All pages: every fare has fareCategory; no dual category | **PASS** |
| 4 | B-4 | fareCategories facet matches fares offered across pages | **BUG** |
| 5 | B-5 | IX / Air India Express corporate present | **PASS** |
| 6 | B-6 | Watch logs for v2.corpFare unclassified | **NOT TESTED** |
## C
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | C-1 | One card with 2+ categories, distinct searchIds | **PASS** |
| 2 | C-2 | displayPricing equals cheapest fare | **PASS** |
| 3 | C-3 | Page 0 cheapest-first across categories | **PASS** |
| 4 | C-4 | Sum of options across pages = totalResults | **PASS** |
| 5 | C-5 | Cached size=5 vs size=50: same totalResults; cards keep categories | **PASS** |
| 6 | C-6 | appliedFilters fareCategories=["CORPORATE"] prunes fares | **BUG** |
| 7 | C-7 | fareCategories=[""] treated as no filter | **PASS** |
| 8 | C-8 | Single-fare-type: progress.lanesTotal/lanesReady null | **PASS** |
## D
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | D-1 | RT NORMAL,SME — select SME onward → both dirs SME | **NOT TESTED** |
| 2 | D-2 | RT — select NORMAL onward → both dirs NORMAL | **PASS** |
| 3 | D-3 | Select using fare-level searchId from fares[] | **NOT TESTED** |
| 4 | D-4 | Cross-category RT pair → pricing INVALID_COMBINATION | **BUG** |
| 5 | D-5 | Cross pair → details + fareRules INVALID_COMBINATION | **BUG** |
| 6 | D-6 | Same-category RT → pricing succeeds | **PASS** |
| 7 | D-7 | Legs from two different searches rejected | **BUG** |
| 8 | D-8 | Intl RT select onward, re-search, price succeeds | **PASS** |
| 9 | D-9 | Book domestic RT end to end | **NOT TESTED** |
| 10 | D-10 | Book intl RT end to end | **NOT TESTED** |
## E
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | E-1 | Corporate searchId → details/pricing/fareRules 200 | **PASS** |
| 2 | E-2 | Normal fare from same card prices as normal (≠ corporate) | **PASS** |
| 3 | E-3 | All six fare types through details/pricing/fareRules | **PASS** |
| 4 | E-4 | SME → fareRules | **NOT TESTED** |
| 5 | E-5 | SME pricing flexiCancelFee is 0 | **NOT TESTED** |
| 6 | E-6 | pricing → refresh-token → selection/pricing category survives | **NOT TESTED** |
| 7 | E-7 | ssr + seatmap on priced selection | **PASS** |
## F
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | F-1 | No fareType — works; combinationRefs absent | **BUG** |
| 2 | F-2 | OW every main fare type correct | **BUG** |
| 3 | F-3 | combinationRefs absent on search/details/pricing/fareRules | **BUG** |
| 4 | F-4 | preferences airlines/maxStops applied across categories | **BUG** |
| 5 | F-5 | Filters excluding everything → 200 empty + facets, not 404 | **PASS** |
| 6 | F-6 | No flights route → NO_FLIGHTS_FOUND | **PASS** |
| 7 | F-7 | V1 flight flows untouched | **NOT TESTED** |
| 8 | F-8 | Book OW end to end | **NOT TESTED** |
## X
| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | X-1 | GARBAGE / SMEE → INVALID_FARE_TYPE (no silent NORMAL) | **BUG** |
| 2 | X-2 | SME fares can have label Corporate but fareCategory=SME | **BUG** |

## Bugs
### A-2-SME
- Expected: only SME
- Actual: http=200 n=20 cats=NORMAL leak=NORMAL
### A-3b
- Expected: NORMAL,SME
- Actual: found=NORMAL n=20
### A-3c
- Expected: NORMAL,SME,CORPORATE
- Actual: found=CORPORATE,NORMAL n=20
### A-4a
- Expected: NORMAL+SME
- Actual: NORMAL
### A-5a
- Expected: 400 INVALID_FARE_TYPE
- Actual: http=200 code=null
### A-5b
- Expected: 400 INVALID_FARE_TYPE
- Actual: http=200 code=null
### A-6b
- Expected: 400 INVALID_FARE_TYPE both orders
- Actual: NORMAL,flexi=200/null; flexi,SME=200/null
### B-4
- Expected: facet option counts align with options offering each category
- Actual: {"facet":[],"offeredOpt":{"CORPORATE":177,"NORMAL":182},"mismatches":["CORPORATE: offered=177 but missing from facet","NORMAL: offered=182 but missing from facet"]}
### C-6
- Expected: only CORPORATE in fares[]
- Actual: {"n":20,"cats":["CORPORATE","NORMAL"],"bad":90,"facet":[]}
### D-4
- Expected: 400 INVALID_COMBINATION
- Actual: http=400 code=INVALID_SELECTION
- Response: `{"code":"INVALID_SELECTION","message":"Selected options do not belong to the same supplier search context.","details":null,"timestamp":"2026-09-07T13:46:31Z","request_id":"req-1788788791567","search_again":1}`
### D-5
- Expected: INVALID_COMBINATION both
- Actual: details=200/null rules=400/INVALID_SELECTION
### D-7
- Expected: 4xx reject
- Actual: http=200 code=null
### F-1
- Expected: 200 + no combinationRefs
- Actual: {"http":200,"n":20,"hasCombinationRefs":true,"cats":["NORMAL"]}
### F-2
- Expected: 
- Actual: [{"token":"NORMAL","ok":true,"found":["NORMAL"],"leak":[],"n":20},{"token":"CORPORATE","ok":true,"found":["CORPORATE"],"leak":[],"n":20},{"token":"SME","ok":false,"found":["NORMAL"],"leak":["NORMAL"],"n":20}]
### F-3
- Expected: 
- Actual: [{"kind":"search","has":true},{"kind":"details","has":false},{"kind":"pricing","has":false},{"kind":"fareRules","has":false}]
### F-4
- Expected: only 6E nonstop
- Actual: {"n":20,"badAirline":0,"badStops":3,"cats":["CORPORATE","NORMAL"]}
### X-1
- Expected: 400 INVALID_FARE_TYPE
- Actual: {"GARBAGE":{"http":200,"code":null},"SMEE":{"http":200,"code":null}}
### X-2
- Expected: all fareCategory=SME
- Actual: {"n":49,"labelCorporateAsSme":0,"sample":[]}