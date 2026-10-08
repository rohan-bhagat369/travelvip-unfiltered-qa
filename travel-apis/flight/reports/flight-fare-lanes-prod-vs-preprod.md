# Fare Lanes — Prod vs Preprod (search only, no book)

Fare Lanes is on preprod; production still behaves like pre-lanes (no SME lane, unknown fareType accepted, combinationRefs present, no fareCategories facet).

| Env | PASS | BUG | NOT TESTED |
|-----|------|-----|------------|
| Preprod | 49 | 2 | 6 |
| Prod | 29 | 18 | 10 |

Delta: **16** pass on preprod → BUG on prod · **2** BUG on both · **37** same

## Prod-only failures (preprod PASS)
| Id | Rule | Prod actual |
|----|------|-------------|
| A-2-SME | alone SME → only that fareCategory | http=200 n=20 cats=NORMAL leak=NORMAL |
| A-3b | multi NORMAL,SME → all categories present | found=NORMAL n=20 |
| A-3c | multi NORMAL,SME,CORPORATE → all categories present | found=CORPORATE,NORMAL n=20 |
| A-4a | NORMAL , SME (spaces) trimmed | NORMAL |
| A-5a | BUSINESS → 400 INVALID_FARE_TYPE | http=200 code=null |
| A-5b | NORMAL,BUSINESS → 400 INVALID_FARE_TYPE | http=200 code=null |
| A-6b | flexi_cancel + other → 400 INVALID_FARE_TYPE | NORMAL,flexi=200/null; flexi,SME=200/null |
| B-4 | fareCategories facet matches fares offered across pages | {"facet":[],"offeredOpt":{"CORPORATE":177,"NORMAL":182},"mismatches":["CORPORATE: offered=177 but missing from facet","NORMAL: offered=182 b |
| C-6 | appliedFilters fareCategories=["CORPORATE"] prunes fares | {"n":20,"cats":["CORPORATE","NORMAL"],"bad":90,"facet":[]} |
| D-4 | Cross-category RT pair → pricing INVALID_COMBINATION | http=400 code=INVALID_SELECTION |
| D-5 | Cross pair → details + fareRules INVALID_COMBINATION | details=200/null rules=400/INVALID_SELECTION |
| F-1 | No fareType — works; combinationRefs absent | {"http":200,"n":20,"hasCombinationRefs":true,"cats":["NORMAL"]} |
| F-2 | OW every main fare type correct | [{"token":"NORMAL","ok":true,"found":["NORMAL"],"leak":[],"n":20},{"token":"CORPORATE","ok":true,"found":["CORPORATE"],"leak":[],"n":20},{"t |
| F-3 | combinationRefs absent on search/details/pricing/fareRules | [{"kind":"search","has":true},{"kind":"details","has":false},{"kind":"pricing","has":false},{"kind":"fareRules","has":false}] |
| X-1 | GARBAGE / SMEE → INVALID_FARE_TYPE (no silent NORMAL) | {"GARBAGE":{"http":200,"code":null},"SMEE":{"http":200,"code":null}} |
| X-2 | SME fares can have label Corporate but fareCategory=SME | {"n":49,"labelCorporateAsSme":0,"sample":[]} |

## BUG on both
| Id | Rule |
|----|------|
| D-7 | Legs from two different searches rejected |
| F-4 | preferences airlines/maxStops applied across categories |

## Full matrix
| Id | Preprod | Prod | Delta |
|----|---------|------|-------|
| A-1 | PASS | PASS | same |
| A-2-NORMAL | PASS | PASS | same |
| A-2-CORPORATE | PASS | PASS | same |
| A-2-SME | PASS | BUG | prod_worse |
| A-2-STUDENT | PASS | PASS | same |
| A-2-DEFENCE | PASS | PASS | same |
| A-2-SENIOR_CITIZEN | PASS | PASS | same |
| A-3a | PASS | PASS | same |
| A-3b | PASS | BUG | prod_worse |
| A-3c | PASS | BUG | prod_worse |
| A-4a | PASS | BUG | prod_worse |
| A-4b | PASS | PASS | same |
| A-5a | PASS | BUG | prod_worse |
| A-5b | PASS | BUG | prod_worse |
| A-6a | PASS | PASS | same |
| A-6b | PASS | BUG | prod_worse |
| B-1 | PASS | PASS | same |
| B-2 | PASS | PASS | same |
| B-3 | PASS | PASS | same |
| B-4 | PASS | BUG | prod_worse |
| B-5 | PASS | PASS | same |
| B-6 | NOT TESTED | NOT TESTED | same |
| C-1 | PASS | PASS | same |
| C-2 | PASS | PASS | same |
| C-3 | PASS | PASS | same |
| C-4 | PASS | PASS | same |
| C-5 | PASS | PASS | same |
| C-6 | PASS | BUG | prod_worse |
| C-7 | PASS | PASS | same |
| C-8 | PASS | PASS | same |
| D-1 | PASS | NOT TESTED | prod_skipped |
| D-2 | PASS | PASS | same |
| D-3 | PASS | NOT TESTED | prod_skipped |
| D-4 | PASS | BUG | prod_worse |
| D-5 | PASS | BUG | prod_worse |
| D-6 | PASS | PASS | same |
| D-7 | BUG | BUG | same |
| D-8 | PASS | PASS | same |
| D-9 | NOT TESTED | NOT TESTED | same |
| D-10 | NOT TESTED | NOT TESTED | same |
| E-1 | PASS | PASS | same |
| E-2 | PASS | PASS | same |
| E-3 | PASS | PASS | same |
| E-4 | PASS | NOT TESTED | prod_skipped |
| E-5 | PASS | NOT TESTED | prod_skipped |
| E-6 | NOT TESTED | NOT TESTED | same |
| E-7 | PASS | PASS | same |
| F-1 | PASS | BUG | prod_worse |
| F-2 | PASS | BUG | prod_worse |
| F-3 | PASS | BUG | prod_worse |
| F-4 | BUG | BUG | same |
| F-5 | PASS | PASS | same |
| F-6 | PASS | PASS | same |
| F-7 | NOT TESTED | NOT TESTED | same |
| F-8 | NOT TESTED | NOT TESTED | same |
| X-1 | PASS | BUG | prod_worse |
| X-2 | PASS | BUG | prod_worse |