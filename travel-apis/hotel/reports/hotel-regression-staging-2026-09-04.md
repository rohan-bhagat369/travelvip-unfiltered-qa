# Hotel B2B regression — https://api-staging.travelvip.ai

**For:** Partner B2B APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-09-04T09:51:33.472Z
**Tags:** AUTH, VALIDATE

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 57 | 3 | 0 | 60 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| AUTH | 24 | 0 | 0 | 24 |
| VALIDATE | 33 | 3 | 0 | 36 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://api-staging.travelvip.ai` |
| Correlation ID | `ebf4fba7-234d-4c45-92ec-bb742ba9c0da` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 9877 ms |

## AUTH

Score: PASS **24** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | POST /auth/partner/token — valid partner_id + partner_secret returns access_token and refresh_token | POST /auth/partner/token with partner_id/partner_secret from env (this is the baseline for mutations below). | **PASS** |
| 2 | POST /auth/partner/token — omit partner_id | POST /auth/partner/token body { partner_secret } only. | **PASS** |
| 3 | POST /auth/partner/token — omit partner_secret | POST /auth/partner/token body { partner_id } only. | **PASS** |
| 4 | POST /auth/partner/token — empty JSON body | POST /auth/partner/token body {}. | **PASS** |
| 5 | POST /auth/partner/token — partner_id with trailing comma | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 6 | POST /auth/partner/token — partner_secret with trailing comma | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 7 | POST /auth/partner/token — partner_id with punctuation !@#$ | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 8 | POST /auth/partner/token — partner_id with HTML/script chars | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 9 | POST /auth/partner/token — partner_id with quote/semicolon | POST /auth/partner/token clone valid credentials then change the named field (extra comma / special chars). | **PASS** |
| 10 | POST /auth/partner/refresh — valid refresh_token returns a new access_token | POST /auth/partner/refresh body { refresh_token } from the access-token response. | **PASS** |
| 11 | POST /auth/partner/refresh — empty refresh_token | POST /auth/partner/refresh body { refresh_token: "" }. | **PASS** |
| 12 | POST /auth/partner/refresh — refresh_token with trailing comma | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 13 | POST /auth/partner/refresh — refresh_token punctuation !@#$ | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 14 | POST /auth/partner/refresh — refresh_token HTML/script chars | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 15 | POST /auth/partner/refresh — refresh_token is only a comma | POST /auth/partner/refresh clone/mutate refresh_token with extra comma or special chars. | **PASS** |
| 16 | POST /v1/auth/session — valid X-Partner-Key + tierId returns auth_token | POST /v1/auth/session with X-Partner-Key = partner access_token and body { tierId } from env. | **PASS** |
| 17 | POST /v1/auth/session — omit X-Partner-Key | POST /v1/auth/session with no X-Partner-Key header, body { tierId }. | **PASS** |
| 18 | POST /v1/auth/session — invalid X-Partner-Key | POST /v1/auth/session X-Partner-Key=gmr_at_invalid_access_token, body { tierId }. | **PASS** |
| 19 | POST /v1/auth/session — X-Partner-Key with trailing comma | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on X-Partner-Key. | **PASS** |
| 20 | POST /v1/auth/session — X-Partner-Key with punctuation | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on X-Partner-Key. | **PASS** |
| 21 | POST /v1/auth/session — X-Partner-Key with HTML/script chars | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on X-Partner-Key. | **PASS** |
| 22 | POST /v1/auth/session — tierId with trailing comma | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on tierId. | **PASS** |
| 23 | POST /v1/auth/session — tierId with punctuation | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on tierId. | **PASS** |
| 24 | POST /v1/auth/session — tierId with HTML/script chars | POST /v1/auth/session clone valid user-auth request then add extra comma / special chars on tierId. | **PASS** |

## VALIDATE

Score: PASS **33** / BUG **3** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | POST /v1/hotels/search — valid search body with YYYY-MM-DD checkin/checkout and 1 adult | POST /v1/hotels/search with a complete valid catalog search (entityId + dates + 1 adult). This is the baseline for the mutations below. | **PASS** |
| 2 | POST /v1/hotels/search — checkin DD-MM-YYYY rejected | Clone a valid A. Search payload, change only this: checkin DD-MM-YYYY rejected, then POST /v1/hotels/search. | **PASS** |
| 3 | POST /v1/hotels/search — checkin slashes YYYY/MM/DD rejected | Clone a valid A. Search payload, change only this: checkin slashes YYYY/MM/DD rejected, then POST /v1/hotels/search. | **PASS** |
| 4 | POST /v1/hotels/search — checkin unpadded YYYY-M-D rejected | Clone a valid A. Search payload, change only this: checkin unpadded YYYY-M-D rejected, then POST /v1/hotels/search. | **PASS** |
| 5 | POST /v1/hotels/search — checkin impossible 2026-02-30 rejected | Clone a valid A. Search payload, change only this: checkin impossible 2026-02-30 rejected, then POST /v1/hotels/search. | **PASS** |
| 6 | POST /v1/hotels/search — checkout DD-MM-YYYY rejected | Clone a valid A. Search payload, change only this: checkout DD-MM-YYYY rejected, then POST /v1/hotels/search. | **PASS** |
| 7 | POST /v1/hotels/search — checkout before checkin rejected | Clone a valid A. Search payload, change only this: checkout before checkin rejected, then POST /v1/hotels/search. | **PASS** |
| 8 | POST /v1/hotels/search — checkin in the past rejected | Clone a valid A. Search payload, change only this: checkin in the past rejected, then POST /v1/hotels/search. | **PASS** |
| 9 | POST /v1/hotels/search — checkout >1 year from today rejected | Clone a valid A. Search payload, change only this: checkout >1 year from today rejected, then POST /v1/hotels/search. | **PASS** |
| 10 | POST /v1/hotels/search — adults as string "1" rejected | Clone a valid A. Search payload, change only this: adults as string "1" rejected, then POST /v1/hotels/search. | **PASS** |
| 11 | POST /v1/hotels/search — adults decimal 1.5 rejected | Clone a valid A. Search payload, change only this: adults decimal 1.5 rejected, then POST /v1/hotels/search. | **PASS** |
| 12 | POST /v1/hotels/search — adults 0 rejected | Clone a valid A. Search payload, change only this: adults 0 rejected, then POST /v1/hotels/search. | **PASS** |
| 13 | POST /v1/hotels/search — adults 7 rejected | Clone a valid A. Search payload, change only this: adults 7 rejected, then POST /v1/hotels/search. | **PASS** |
| 14 | POST /v1/hotels/search — children decimal rejected | Clone a valid A. Search payload, change only this: children decimal rejected, then POST /v1/hotels/search. | **PASS** |
| 15 | POST /v1/hotels/search — children 5 rejected | Clone a valid A. Search payload, change only this: children 5 rejected, then POST /v1/hotels/search. | **PASS** |
| 16 | POST /v1/hotels/search — children>0 without childrenAges rejected | Clone a valid A. Search payload, change only this: children>0 without childrenAges rejected, then POST /v1/hotels/search. | **PASS** |
| 17 | POST /v1/hotels/search — childrenAges length mismatch rejected | Clone a valid A. Search payload, change only this: childrenAges length mismatch rejected, then POST /v1/hotels/search. | **PASS** |
| 18 | POST /v1/hotels/search — childrenAges entry 18 rejected | Clone a valid A. Search payload, change only this: childrenAges entry 18 rejected, then POST /v1/hotels/search. | **PASS** |
| 19 | POST /v1/hotels/search — childrenAges as string rejected | Clone a valid A. Search payload, change only this: childrenAges as string rejected, then POST /v1/hotels/search. | **PASS** |
| 20 | POST /v1/hotels/search — valid children + childrenAges accepted | Clone a valid A. Search payload, apply: valid children + childrenAges accepted, then POST /v1/hotels/search. | **PASS** |
| 21 | POST /v1/hotels/search — missing entityId rejected | Clone a valid A. Search payload, change only this: missing entityId rejected, then POST /v1/hotels/search. | **BUG** |
| 22 | POST /v1/hotels/search — missing type rejected | Clone a valid A. Search payload, change only this: missing type rejected, then POST /v1/hotels/search. | **PASS** |
| 23 | POST /v1/hotels/search — nationality not 2-letter rejected | Clone a valid A. Search payload, change only this: nationality not 2-letter rejected, then POST /v1/hotels/search. | **PASS** |
| 24 | POST /v1/hotels/search — nationality with trailing comma (IN,) | Clone a valid A. Search payload, add extra comma/special chars (nationality with trailing comma (IN,)), then POST /v1/hotels/search. | **PASS** |
| 25 | POST /v1/hotels/search — entityId with extra punctuation | Clone a valid A. Search payload, add extra comma/special chars (entityId with extra punctuation), then POST /v1/hotels/search. | **BUG** |
| 26 | POST /v1/hotels/search — >6 rooms rejected | Clone a valid A. Search payload, change only this: >6 rooms rejected, then POST /v1/hotels/search. | **PASS** |
| 27 | POST /v1/hotels/details — checkin DD-MM-YYYY rejected | Clone a valid B. Details payload, change only this: checkin DD-MM-YYYY rejected, then POST /v1/hotels/details. | **PASS** |
| 28 | POST /v1/hotels/details — checkin slashes rejected | Clone a valid B. Details payload, change only this: checkin slashes rejected, then POST /v1/hotels/details. | **PASS** |
| 29 | POST /v1/hotels/details — checkin unpadded rejected | Clone a valid B. Details payload, change only this: checkin unpadded rejected, then POST /v1/hotels/details. | **PASS** |
| 30 | POST /v1/hotels/details — impossible date 2026-02-30 rejected | Clone a valid B. Details payload, change only this: impossible date 2026-02-30 rejected, then POST /v1/hotels/details. | **PASS** |
| 31 | POST /v1/hotels/details — past checkin accepted (lookup) | Clone a valid B. Details payload, apply: past checkin accepted (lookup), then POST /v1/hotels/details. | **PASS** |
| 32 | POST /v1/hotels/details — checkout before checkin still accepted (no compare) | Clone a valid B. Details payload, apply: checkout before checkin still accepted (no compare), then POST /v1/hotels/details. | **PASS** |
| 33 | POST /v1/hotels/prebook — blank bookingCode rejected | Clone a valid C. Prebook payload, change only this: blank bookingCode rejected, then POST /v1/hotels/prebook. | **PASS** |
| 34 | POST /v1/hotels/prebook — blank requestId rejected | Clone a valid C. Prebook payload, change only this: blank requestId rejected, then POST /v1/hotels/prebook. | **PASS** |
| 35 | Both bookingCode + requestId missing reported together | POST prebook {} | **PASS** |
| 36 | search → details → POST /v1/hotels/prebook — search → details → prebook to get a bookingContext for finalize tests | POST /v1/hotels/search, then POST /v1/hotels/details, then POST /v1/hotels/prebook with the returned bookingCode + requestId. | **BUG** |

## Bugs for Dev

### BUG 1 — VALIDATE.21 POST /v1/hotels/search — missing entityId rejected

| | |
|---|---|
| How tested | Clone a valid A. Search payload, change only this: missing entityId rejected, then POST /v1/hotels/search. |
| Expected | HTTP 400 VALIDATION_ERROR + details[] (never HTTP 500) |
| Actual | HTTP 400 code=VALIDATION_ERROR bodyStatus=- details=["Please select a destination to search."] msg=Please select a destination to search. \| Validation failed |
| Note | Wrong/missing detail. msg=Please select a destination to search. \| Validation failed |

```json
{"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":["Please select a destination to search."],"timestamp":"2026-09-04T09:51:31Z","request_id":"req-1788515491735"},"_meta":{"correlation_id":"ebf4fba7-234d-4c45-92ec-bb742ba9c0da"}}
```

### BUG 2 — VALIDATE.25 POST /v1/hotels/search — entityId with extra punctuation

| | |
|---|---|
| How tested | Clone a valid A. Search payload, add extra comma/special chars (entityId with extra punctuation), then POST /v1/hotels/search. |
| Expected | HTTP 4xx with error.code (never HTTP 500) |
| Actual | Accepted payload that added extra special characters / comma |
| Note | Accepted payload that added extra special characters / comma |

```json
{"page":0,"size":20,"offset":0,"totalResults":0,"totalPages":0,"availableResults":0,"last":true,"results":[],"message":"No hotels found for this date range. Please try searching different dates.","currency":"INR","fromCache":false,"cacheTimeStamp":null,"priceRangeFilter":null,"filters":null,"sorts":[{"name":"Price Low to High","key":"price_ASC"},{"name":"Price High to Low","key":"price_DESC"}],"requestId":"23f8e5a0-20b6-4208-bedf-6a2f1e12cef2","_meta":{"correlation_id":"ebf4fba7-234d-4c45-92ec-b
```

### BUG 3 — VALIDATE.36 search → details → POST /v1/hotels/prebook — search → details → prebook to get a bookingContext for finalize tests

| | |
|---|---|
| How tested | POST /v1/hotels/search, then POST /v1/hotels/details, then POST /v1/hotels/prebook with the returned bookingCode + requestId. |
| Expected | prebook returns bookingContext used as finalize baseline |
| Actual | FAIL search=200 details=200 |
| Note | {"page":0,"size":1,"totalResults":0,"totalPages":0,"availableResults":0,"results":null,"sorts":[{"name":"Price Low to High","key":"price_ASC"},{"name":"Price High to Low","key":"price_DESC"}],"fromCache":false,"cacheTimeStamp":null,"requestId":"41b41270-5b5e-4ccd-a1e4-edef07e5ca86","_meta":{"correlation_id":"ebf4fba7-234d-4c45-92ec-bb742ba9c0da"}} |

```json
{"page":0,"size":20,"offset":0,"totalResults":0,"totalPages":0,"availableResults":0,"last":true,"results":[],"message":"No hotels found for this date range. Please try searching different dates.","currency":"INR","fromCache":false,"cacheTimeStamp":null,"priceRangeFilter":null,"filters":null,"sorts":[{"name":"Price Low to High","key":"price_ASC"},{"name":"Price High to Low","key":"price_DESC"}],"re
```
