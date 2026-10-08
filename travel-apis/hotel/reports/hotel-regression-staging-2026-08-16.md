# Hotel B2B regression — https://api-staging.travelvip.ai

**For:** Partner B2B hotel APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-08-16T12:10:15.733Z
**Tags:** SMOKE, ENCRYPT, CORR

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 9 | 0 | 0 | 9 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| SMOKE | 4 | 0 | 0 | 4 |
| ENCRYPT | 3 | 0 | 0 | 3 |
| CORR | 2 | 0 | 0 | 2 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://api-staging.travelvip.ai` |
| Correlation ID | `353bef2a-0029-450d-ba71-49ba5ebd3db0` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 13518 ms |

## SMOKE

Score: PASS **4** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Autocomplete city q=pune | GET /v1/hotels/autocomplete?q=pune | **PASS** |
| 2 | Autocomplete hotel name q=hiltop | GET /v1/hotels/autocomplete?q=hiltop | **PASS** |
| 3 | Search with pid=vgm | POST /v1/hotels/search pid=vgm CITY 357389:IN | **PASS** |
| 4 | Spec listing URL still optional/404 | POST /api/hotels/v2/availability/listing | **PASS** |

## ENCRYPT

Score: PASS **3** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Details bookingCode encrypted (no RIYA / !TB!) | POST /v1/hotels/details Hilltop 39627872 | **PASS** |
| 2 | Prebook request/response codes encrypted | POST /v1/hotels/prebook same bookingCode | **PASS** |
| 3 | Scan details JSON bookingCodes for vendor strings | walk details.results[].rooms[].bookingCode | **PASS** |

## CORR

Score: PASS **2** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Pin one UUID on hotel hops | autocomplete-city, autocomplete-hotel, autocomplete-mumbai, search-pid, listing-spec, encrypt-search, encrypt-details, encrypt-prebook | **PASS** |
| 2 | Response _meta.correlation_id | echo same UUID (or documented rewrite) | **PASS** |

## Bugs for Dev

None this run.
