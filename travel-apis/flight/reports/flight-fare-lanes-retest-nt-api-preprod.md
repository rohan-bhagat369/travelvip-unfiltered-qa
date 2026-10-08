# Fare Lanes — NT retest (paginate + pricing, no book)

- Base: `https://api-preprod.travelvip.ai`
- **8 PASS / 0 BUG / 1 NOT TESTED**

| Id | Rule | Status |
|----|------|--------|
| D-1 | RT NORMAL,SME — select SME onward → both dirs SME | **PASS** |
| D-1-price | SME RT pair → pricing 200 (no book) | **PASS** |
| D-2 | RT — select NORMAL onward → both dirs NORMAL | **PASS** |
| D-6 | Same-category RT → pricing succeeds | **PASS** |
| D-4 | Cross-category RT → pricing INVALID_COMBINATION | **PASS** |
| D-5 | Cross pair → details + fareRules INVALID_COMBINATION | **PASS** |
| D-8 | Intl RT select onward, re-search, price succeeds | **PASS** |
| E-1 | Corporate searchId → details/pricing/fareRules 200 | **PASS** |
| E-6 | pricing → refresh-token / selection-pricing | **NOT TESTED** |