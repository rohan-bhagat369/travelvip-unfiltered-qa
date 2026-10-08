# Flight B2B regression — https://api-staging.travelvip.ai

**For:** Partner B2B APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-08-17T12:07:32.448Z
**Tags:** AUTH

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 24 | 0 | 0 | 24 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| AUTH | 24 | 0 | 0 | 24 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://api-staging.travelvip.ai` |
| Correlation ID | `3baadd69-74a8-475d-826c-057cca92b641` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 5153 ms |

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

## Bugs for Dev

None this run.
