# Hotel B2B regression — https://api.travelvip.ai

**For:** Partner B2B APIs (pre-deploy)
**QA:** TravelVIP API Automation
**Ran at:** 2026-08-26T07:59:56.228Z
**Tags:** LISTING, STARBOOK

## Score

| PASS | BUG | NOT TESTED | Total |
|-----:|----:|-----------:|------:|
| 57 | 8 | 0 | 65 |

| Tag | PASS | BUG | NOT TESTED | Total |
|-----|-----:|----:|-----------:|------:|
| LISTING | 41 | 0 | 0 | 41 |
| STARBOOK | 16 | 8 | 0 | 24 |

## Environment

| Field | Value |
|-------|-------|
| Base URL | `https://api.travelvip.ai` |
| Correlation ID | `81801552-e0f6-4ccc-a463-573bc967ff0c` |
| Booking BR | `—` |
| Booking status | — |
| Elapsed | 178953 ms |

## LISTING

Score: PASS **41** / BUG **0** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Working listing search (auth + inventory) | POST /v1/hotels/search user-curl CITY 357389:IN INR | **PASS** |
| 2 | Sort options are advertised | offset=0 limit=5 no sort | **PASS** |
| 3 | Price ascending across whole result set | sort=price_ASC limit=5 | **PASS** |
| 4 | Price descending, different set from S2 | sort=price_DESC limit=5 | **PASS** |
| 5 | Unknown sort key ignored, not rejected | sort=rating_DESC | **PASS** |
| 6 | Truncated key price_AS ignored | sort=price_AS | **PASS** |
| 7 | Sort key is case-sensitive / PRICE_ASC | sort=PRICE_ASC | **PASS** |
| 8 | Combined sort=price_ASC,price_DESC | comma-separated sort | **PASS** |
| 9 | S2 orders by baseFare not totalAmount | compare S2 baseFare vs totalAmount sequences | **PASS** |
| 10 | Star-rating facet present and self-describing | unfiltered listing filters[] | **PASS** |
| 11 | One value narrows the set | fq df_long_star_rating:5 | **PASS** |
| 12 | Multi-select uses a semicolon | fq df_long_star_rating:4;5 | **PASS** |
| 13 | Facet counts survive a selection | fq 5-star only | **PASS** |
| 14 | Filter and sort compose | fq Reservation policy:Free cancellation + sort=price_ASC | **PASS** |
| 15 | Valueless filter is ignored, not fatal | fq star_rating empty value | **PASS** |
| 16 | Comma instead of semicolon does not multi-select | fq df_long_star_rating:4,5 | **PASS** |
| 17 | Two fq entries for same field vs semicolon | fq array with two star filters | **PASS** |
| 18 | Unknown star facetKey | fq star_rating:99 | **PASS** |
| 19 | 1★/2★ filter (excluded by design) | fq df_long_star_rating:1;2 | **PASS** |
| 20 | fq as string instead of array | body.fq is a string | **PASS** |
| 21 | Pages chain without gaps or repeats | offset 0,5,10 limit=5 price_ASC | **PASS** |
| 22 | Offset is echoed back | offset=7 limit=5 | **PASS** |
| 23 | Non-multiple offset slices where it says | offset=7 is tail of page offset=5 + head of offset=10 | **PASS** |
| 24 | Page size changes recompute page count | limit=20 | **PASS** |
| 25 | Final page reports itself | offset=948 (total-4) limit=5 | **PASS** |
| 26 | Past the end is an empty page, not an error | offset=9999 limit=5 | **PASS** |
| 27 | limit=1 returns a single hotel | limit=1 | **PASS** |
| 28 | Omitting limit still pages | no limit query param | **PASS** |
| 29 | offset == totalResults is empty last page | offset=952 | **PASS** |
| 30 | Follow-up page echoes / accepts requestId | same search + requestId on page 2 | **PASS** |
| 31 | Negative offset is rejected | offset=-1 limit=5 | **PASS** |
| 32 | Zero limit is rejected | limit=0 | **PASS** |
| 33 | Non-numeric offset is rejected | offset=abc | **PASS** |
| 34 | Negative limit is rejected | limit=-1 | **PASS** |
| 35 | Float offset is rejected or not silently clamped to 0 | offset=1.5 | **PASS** |
| 36 | Non-numeric limit is rejected | limit=abc | **PASS** |
| 37 | Huge offset Integer.MAX+ does not 500 | offset=2147483648 | **PASS** |
| 38 | Empty offset query | offset= | **PASS** |
| 39 | Missing checkin/checkout | omit stay dates | **PASS** |
| 40 | type TBOCITY vs CITY on this entity | entity 357389:IN type=TBOCITY | **PASS** |
| 41 | Empty rooms array | rooms:[] | **PASS** |

## STARBOOK

Score: PASS **16** / BUG **8** / NOT TESTED **0**

| # | Rule | How tested | Status |
|---|------|------------|--------|
| 1 | Mumbai: unfiltered search works | POST /v1/hotels/search CITY 357389:IN sort=price_ASC no fq | **PASS** |
| 2 | Mumbai: 4★ fq returns only 4-star hotels | fq.df_long_star_rating=[4] sort=price_ASC | **PASS** |
| 3 | Mumbai: 4★ price_ASC is non-decreasing | same 4★ search sort=price_ASC | **PASS** |
| 4 | Mumbai: 4★ + price_DESC still only 4-star | fq.df_long_star_rating=[4] sort=price_DESC | **PASS** |
| 5 | Mumbai: 4★ price_DESC is non-increasing | sort=price_DESC | **PASS** |
| 6 | Mumbai: ASC vs DESC are different ordered lists | compare 4★ price_ASC vs price_DESC first page | **PASS** |
| 7 | Mumbai: 4★ + Free cancellation + price_ASC | fq star 4 + Reservation policy Free cancellation, sort=price_ASC (user curl shape) | **PASS** |
| 8 | Mumbai: 4★ + Free cancellation + price_DESC | same fq, sort=price_DESC (exact user curl sort) | **PASS** |
| 9 | Pune: unfiltered search works | POST /v1/hotels/search CITY 328605:IN sort=price_ASC no fq | **PASS** |
| 10 | Pune: 4★ fq returns only 4-star hotels | fq.df_long_star_rating=[4] sort=price_ASC | **PASS** |
| 11 | Pune: 4★ price_ASC is non-decreasing | same 4★ search sort=price_ASC | **PASS** |
| 12 | Pune: 4★ + price_DESC still only 4-star | fq.df_long_star_rating=[4] sort=price_DESC | **PASS** |
| 13 | Pune: 4★ price_DESC is non-increasing | sort=price_DESC | **PASS** |
| 14 | Pune: ASC vs DESC are different ordered lists | compare 4★ price_ASC vs price_DESC first page | **PASS** |
| 15 | Pune: 4★ + Free cancellation + price_ASC | fq star 4 + Reservation policy Free cancellation, sort=price_ASC (user curl shape) | **PASS** |
| 16 | Pune: 4★ + Free cancellation + price_DESC | same fq, sort=price_DESC (exact user curl sort) | **PASS** |
| 17 | Delhi: unfiltered search works | POST /v1/hotels/search CITY 358245:IN sort=price_ASC no fq | **BUG** |
| 18 | Delhi: 4★ fq returns only 4-star hotels | fq.df_long_star_rating=[4] sort=price_ASC | **BUG** |
| 19 | Delhi: 4★ price_ASC is non-decreasing | same 4★ search sort=price_ASC | **BUG** |
| 20 | Delhi: 4★ + price_DESC still only 4-star | fq.df_long_star_rating=[4] sort=price_DESC | **BUG** |
| 21 | Delhi: 4★ price_DESC is non-increasing | sort=price_DESC | **BUG** |
| 22 | Delhi: ASC vs DESC are different ordered lists | compare 4★ price_ASC vs price_DESC first page | **BUG** |
| 23 | Delhi: 4★ + Free cancellation + price_ASC | fq star 4 + Reservation policy Free cancellation, sort=price_ASC (user curl shape) | **BUG** |
| 24 | Delhi: 4★ + Free cancellation + price_DESC | same fq, sort=price_DESC (exact user curl sort) | **BUG** |

## Bugs for Dev

### BUG 1 — STARBOOK.17 Delhi: unfiltered search works

| | |
|---|---|
| How tested | POST /v1/hotels/search CITY 358245:IN sort=price_ASC no fq |
| Expected | HTTP 200 and hotel list |
| Actual | HTTP 200 hotels=0 total=0 stars=[] |

### BUG 2 — STARBOOK.18 Delhi: 4★ fq returns only 4-star hotels

| | |
|---|---|
| How tested | fq.df_long_star_rating=[4] sort=price_ASC |
| Expected | Every result starRating=4; totalResults narrower than unfiltered |
| Actual | HTTP 200 n=0 total=0 unfilteredTotal=0 stars=[] all4=false |

### BUG 3 — STARBOOK.19 Delhi: 4★ price_ASC is non-decreasing

| | |
|---|---|
| How tested | same 4★ search sort=price_ASC |
| Expected | baseFare non-decreasing across page |
| Actual | fares=[] monoAsc=false |

### BUG 4 — STARBOOK.20 Delhi: 4★ + price_DESC still only 4-star

| | |
|---|---|
| How tested | fq.df_long_star_rating=[4] sort=price_DESC |
| Expected | Every result starRating=4 |
| Actual | HTTP 200 n=0 stars=[] |

### BUG 5 — STARBOOK.21 Delhi: 4★ price_DESC is non-increasing

| | |
|---|---|
| How tested | sort=price_DESC |
| Expected | baseFare non-increasing across page |
| Actual | fares=[] monoDesc=false |

### BUG 6 — STARBOOK.22 Delhi: ASC vs DESC are different ordered lists

| | |
|---|---|
| How tested | compare 4★ price_ASC vs price_DESC first page |
| Expected | Hotel order differs; cheapest-first vs dearest-first |
| Actual | differentOrder=false ascFirst=undefined@undefined descFirst=undefined@undefined |

### BUG 7 — STARBOOK.23 Delhi: 4★ + Free cancellation + price_ASC

| | |
|---|---|
| How tested | fq star 4 + Reservation policy Free cancellation, sort=price_ASC (user curl shape) |
| Expected | Only 4★; refundable=true; fares non-decreasing |
| Actual | HTTP 200 n=0 total=0 stars=[] refundable=[] fares=[] all4=false allRefund=0 monoAsc=false |

### BUG 8 — STARBOOK.24 Delhi: 4★ + Free cancellation + price_DESC

| | |
|---|---|
| How tested | same fq, sort=price_DESC (exact user curl sort) |
| Expected | Only 4★; refundable=true; fares non-increasing |
| Actual | HTTP 200 n=0 stars=[] refundable=[] fares=[] |
