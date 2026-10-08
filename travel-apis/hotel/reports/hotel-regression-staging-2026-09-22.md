# Hotel B2B regression — https://api-staging.travelvip.ai

**For:** Partner B2B APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-09-22T07:55:19.211Z
**Tags:** NEGPRICE

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 32 | 0 | 5 | 37 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| NEGPRICE | 32 | 0 | 5 | 37 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://api-staging.travelvip.ai` |
| Correlation ID | `11e599f3-1e27-4a34-ab8a-d4f117c7ea96` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 63579 ms |

## NEGPRICE

Score: PASS **32** / BUG **0** / NOT TESTED **5**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | H-NP-Hilltop-S | POST /v1/hotels/search type=HOTEL entityId=39627872 2026-10-20 | **PASS** |
| 2 | H-NP-Hilltop-D | POST /v1/hotels/details entityId=39627872 2026-10-20 | **PASS** |
| 3 | H-NP-Rotana-S | POST /v1/hotels/search type=HOTEL entityId=39657625 2026-10-20 | **PASS** |
| 4 | H-NP-Rotana-D | POST /v1/hotels/details entityId=39657625 2026-10-20 | **PASS** |
| 5 | H-NP-City-Mumbai-S | POST /v1/hotels/search type=CITY entityId=357389:IN page=0 perpage=20 | **PASS** |
| 6 | H-NP-City-Mumbai-D1 | POST /v1/hotels/details entityId=39627872 (from Mumbai CITY SRP) | **PASS** |
| 7 | H-NP-City-Mumbai-D2 | POST /v1/hotels/details entityId=38964472 (from Mumbai CITY SRP) | **PASS** |
| 8 | H-NP-City-Mumbai-D3 | POST /v1/hotels/details entityId=30959020 (from Mumbai CITY SRP) | **PASS** |
| 9 | H-NP-City-Delhi-S | POST /v1/hotels/search type=CITY entityId=227760:IN page=0 perpage=20 | **PASS** |
| 10 | H-NP-City-Delhi-D1 | POST /v1/hotels/details entityId=72377756 (from Delhi CITY SRP) | **PASS** |
| 11 | H-NP-City-Delhi-D2 | POST /v1/hotels/details entityId=72318789 (from Delhi CITY SRP) | **PASS** |
| 12 | H-NP-City-Delhi-D3 | POST /v1/hotels/details entityId=39658270 (from Delhi CITY SRP) | **PASS** |
| 13 | H-NP-City-Bangalore-S | POST /v1/hotels/search type=CITY entityId=341153:IN page=0 perpage=20 | **PASS** |
| 14 | H-NP-City-Bangalore-D1 | POST /v1/hotels/details entityId=53602106 (from Bangalore CITY SRP) | **PASS** |
| 15 | H-NP-City-Bangalore-D2 | POST /v1/hotels/details entityId=15339986 (from Bangalore CITY SRP) | **PASS** |
| 16 | H-NP-City-Bangalore-D3 | POST /v1/hotels/details entityId=71197028 (from Bangalore CITY SRP) | **PASS** |
| 17 | H-NP-City-Pune-S | POST /v1/hotels/search type=CITY entityId=328605:IN page=0 perpage=20 | **PASS** |
| 18 | H-NP-City-Pune-D1 | POST /v1/hotels/details entityId=15237042 (from Pune CITY SRP) | **PASS** |
| 19 | H-NP-City-Pune-D2 | POST /v1/hotels/details entityId=70496724 (from Pune CITY SRP) | **PASS** |
| 20 | H-NP-City-Pune-D3 | POST /v1/hotels/details entityId=15380909 (from Pune CITY SRP) | **PASS** |
| 21 | H-NP-City-Goa-S | POST /v1/hotels/search type=CITY entityId=328649:IN page=0 perpage=20 | **PASS** |
| 22 | H-NP-City-Goa-D1 | POST /v1/hotels/details entityId=38906785 (from Goa CITY SRP) | **PASS** |
| 23 | H-NP-City-Goa-D2 | POST /v1/hotels/details entityId=39692768 (from Goa CITY SRP) | **PASS** |
| 24 | H-NP-City-Goa-D3 | POST /v1/hotels/details entityId=16059559 (from Goa CITY SRP) | **PASS** |
| 25 | H-NP-City-Dubai-S | POST /v1/hotels/search type=CITY entityId=221688:AE page=0 perpage=20 | **PASS** |
| 26 | H-NP-City-Dubai-D1 | POST /v1/hotels/details entityId=70491369 (from Dubai CITY SRP) | **PASS** |
| 27 | H-NP-City-Dubai-D2 | POST /v1/hotels/details entityId=70480231 (from Dubai CITY SRP) | **PASS** |
| 28 | H-NP-City-Dubai-D3 | POST /v1/hotels/details entityId=39658268 (from Dubai CITY SRP) | **PASS** |
| 29 | H-NP-City-Singapore-S | POST /v1/hotels/search type=CITY entityId=246673:SG page=0 perpage=20 | **NOT TESTED** |
| 30 | H-NP-City-Singapore-S2 | POST /v1/hotels/search type=CITY entityId=246673:SG 2026-10-27 | **PASS** |
| 31 | H-NP-City-Singapore-D1 | POST /v1/hotels/details entityId=16042274 (from Singapore CITY SRP) | **PASS** |
| 32 | H-NP-City-Singapore-D2 | POST /v1/hotels/details entityId=39672686 (from Singapore CITY SRP) | **PASS** |
| 33 | H-NP-City-Singapore-D3 | POST /v1/hotels/details entityId=39777619 (from Singapore CITY SRP) | **PASS** |
| 34 | H-NP-City-Bangkok-S | POST /v1/hotels/search type=CITY entityId=328619:TH page=0 perpage=20 | **NOT TESTED** |
| 35 | H-NP-City-Bangkok-D0 | CITY search returned no priced hotels | **NOT TESTED** |
| 36 | H-NP-City-Paris-S | POST /v1/hotels/search type=CITY entityId=437227:FR page=0 perpage=20 | **NOT TESTED** |
| 37 | H-NP-City-Paris-D0 | CITY search returned no priced hotels | **NOT TESTED** |

## Bugs for Dev

None this run.

## Not tested

| # | Tag | Rule | Why |
|---|-----|------|-----|
| 1 | NEGPRICE | H-NP-City-Singapore-S | http=200 available=0/page=0 fieldNeg=0 badHits=0 |
| 2 | NEGPRICE | H-NP-City-Bangkok-S | http=200 available=0/page=0 fieldNeg=0 badHits=0 |
| 3 | NEGPRICE | H-NP-City-Bangkok-D0 | available=0 |
| 4 | NEGPRICE | H-NP-City-Paris-S | http=504 available=0/page=0 fieldNeg=0 badHits=0 |
| 5 | NEGPRICE | H-NP-City-Paris-D0 | available=0 |
