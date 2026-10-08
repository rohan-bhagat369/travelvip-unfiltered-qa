# Riya SRP Ranking — B2B Preprod NEGATIVES (search only)

Ran: 2026-09-02T10:11:00.960Z
Env: `https://preprod-api.travelvip.ai` · tier `19597201`
Dates: **2026-11-22 → 2026-11-23**

**Score: PASS 37 / BUG 1 / NOT TESTED 0**

| # | Section | Rule | Status |
|---|---|---|---|
| 1 | Baseline | Valid Mumbai search baseline | **PASS** |
| 2 | Payload | checkin DD-MM-YYYY | **PASS** |
| 3 | Payload | checkin impossible 2026-02-30 | **PASS** |
| 4 | Payload | checkout before checkin | **PASS** |
| 5 | Payload | checkin in the past | **PASS** |
| 6 | Payload | adults as string "1" | **PASS** |
| 7 | Payload | adults 0 | **PASS** |
| 8 | Payload | adults 7 | **PASS** |
| 9 | Payload | missing entityId | **PASS** |
| 10 | Payload | nationality not 2-letter | **PASS** |
| 11 | Payload | nationality trailing comma IN, | **PASS** |
| 12 | Payload | entityId with punctuation (!) must not return full city results | **BUG** |
| 13 | Payload | >6 rooms | **PASS** |
| 14 | Query | offset=-1 | **PASS** |
| 15 | Query | limit=0 | **PASS** |
| 16 | Query | offset=abc | **PASS** |
| 17 | Query | unknown sort=rating_DESC | **PASS** |
| 18 | Query | unknown sort=GARBAGE_SORT | **PASS** |
| 19 | Query | unknown sort=price_ASC,price_DESC | **PASS** |
| 20 | Query | unknown sort=star_DESC | **PASS** |
| 21 | Query | price_ASC still monotonic after unknown sort attempts | **PASS** |
| 22 | Query | offset=99999 beyond last page | **PASS** |
| 23 | Query | limit=9999 oversized page | **PASS** |
| 24 | Filter | unknown chain facetKey | **PASS** |
| 25 | Filter | chain value HTML/script | **PASS** |
| 26 | Filter | chain comma multi-select (wrong sep) | **PASS** |
| 27 | Filter | valueless chain fq ignored | **PASS** |
| 28 | Filter | unknown brand facetKey | **PASS** |
| 29 | Filter | brand empty value | **PASS** |
| 30 | Filter | unknown star bucket 99 | **PASS** |
| 31 | Filter | fq as string not array | **PASS** |
| 32 | Filter | fq HTML in property type slot | **PASS** |
| 33 | Regression | Default ranking unchanged after negative batch — Mumbai | **PASS** |
| 34 | Regression | Default order after invalid sort attempts | **PASS** |
| 35 | Multi-city | Delhi checkout before checkin | **PASS** |
| 36 | Multi-city | Dubai fake entityId graceful empty | **PASS** |
| 37 | Multi-city | Dubai valid search after negatives — intl | **PASS** |
| 38 | Auth | omit Bearer token | **PASS** |

## Bugs

### 12 — entityId with punctuation (!) must not return full city results
- Expected: HTTP 4xx or empty 200; never 200 with 988 Mumbai hotels
- Actual: http=200 total=988 results=20
- requestId: `fd7150f6-74fc-4c3f-8e02-617732814a5d`
