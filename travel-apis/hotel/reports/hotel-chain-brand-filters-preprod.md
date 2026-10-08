# Hotel chain / brand filters — preprod (search only)

Env: `https://api-preprod.travelvip.ai` · CITY Mumbai `357389:IN` · 2026-10-14 → 2026-10-15 · pid=vgm

Score: **PASS 1 / BUG 9 / NOT TESTED 6**

## Baseline

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Unfiltered CITY search HTTP 200 with results | POST /v1/hotels/search Mumbai fq=[] | **BUG** |
| 2 | Chain filter advertised in filters[] | scan filters for name/indexField matching /chain/i | **BUG** |
| 3 | Brand filter advertised in filters[] | scan filters for name/indexField matching /brand/i | **BUG** |
| 4 | Hotel result exposes chain/brand fields (or only via name) | inspect first unfiltered hotel keys | **BUG** |

## Chain

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Positive single chain filter | needs chain facet | **NOT TESTED** |
| 2 | Negative: unknown chain facetKey | fq chain:NOT_A_REAL_CHAIN_XYZ | **BUG** |
| 3 | Negative: valueless chain fq ignored | fq chain: | **BUG** |
| 4 | Negative: punctuation in chain value (no 500) | fq chain:Taj, | **PASS** |

## Brand

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Positive single brand filter | needs brand facet | **NOT TESTED** |
| 2 | Negative: unknown brand facetKey | fq brand:NOT_A_REAL_BRAND_XYZ | **BUG** |
| 3 | Negative: valueless brand fq ignored | fq brand: | **BUG** |

## Compose

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Chain + brand compose | need both facets | **NOT TESTED** |

## Existing

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Star filter present | baseline filters | **BUG** |
| 2 | GST filter present | baseline | **NOT TESTED** |
| 3 | Policy filter present | baseline | **NOT TESTED** |
| 4 | Meal filter | not advertised or empty | **NOT TESTED** |

## Bugs

### Baseline.1 — Unfiltered CITY search HTTP 200 with results
- Expected: HTTP 200, totalResults>0, filters[] present
- Actual: http=401 total=NaN results=0 filters=0

### Baseline.2 — Chain filter advertised in filters[]
- Expected: Chain filter present with facets
- Actual: NOT FOUND. filters=

### Baseline.3 — Brand filter advertised in filters[]
- Expected: Brand filter present with facets
- Actual: NOT FOUND. filters=

### Baseline.4 — Hotel result exposes chain/brand fields (or only via name)
- Expected: chain and/or brand field present on hotel object (preferred)
- Actual: no hotels

### Chain.2 — Negative: unknown chain facetKey
- Expected: HTTP 200 empty/0 results, never 500; must NOT ignore filter (same as baseline)
- Actual: http=401 total=NaN baseline=NaN code=INVALID_SIGNATURE

### Chain.3 — Negative: valueless chain fq ignored
- Expected: HTTP 200; full/near-full total (ignored), never 500
- Actual: http=401 total=NaN baseline=NaN

### Brand.2 — Negative: unknown brand facetKey
- Expected: HTTP 200 empty/0; never 500; must not ignore
- Actual: http=401 total=NaN baseline=NaN

### Brand.3 — Negative: valueless brand fq ignored
- Expected: HTTP 200 full total, never 500
- Actual: http=401 total=NaN baseline=NaN

### Existing.1 — Star filter present
- Expected: star filter exists
- Actual: missing
