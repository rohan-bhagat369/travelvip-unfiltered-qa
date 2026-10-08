# Fare lanes — remaining on production (minimum hits, no book)

- Base: `https://api.travelvip.ai`
- Hits: **35**
- **PASS 11 / BUG 0 / NOT TESTED 1**

| # | Id | Rule | Status |
|---|----|------|--------|
| 1 | D-1 | RT NORMAL,SME — select SME onward → both dirs SME | **PASS** |
| 2 | D-2 | RT — select NORMAL onward → both dirs NORMAL | **PASS** |
| 3 | D-6 | Same-category RT → pricing succeeds | **PASS** |
| 4 | D-4 | Cross-category RT pair → pricing INVALID_COMBINATION | **PASS** |
| 5 | D-5 | Cross pair → details + fareRules INVALID_COMBINATION | **PASS** |
| 6 | D-8 | Intl RT select onward, re-search, price succeeds | **NOT TESTED** |
| 7 | E-1 | Corporate searchId → details/pricing/fareRules 200 | **PASS** |
| 8 | E-2 | Normal fare pricing 200 | **PASS** |
| 9 | E-3 | Six fare types through details/pricing/fareRules (no extra searches) | **PASS** |
| 10 | E-4 | SME → fareRules (corporate rules branch) | **PASS** |
| 11 | E-5 | SME pricing flexiCancelFee is 0 | **PASS** |
| 12 | E-7 | ssr + seatmap on priced selection | **PASS** |