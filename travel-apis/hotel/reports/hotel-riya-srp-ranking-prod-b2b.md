# Riya SRP Ranking — B2B Preprod (search only)

Ran: 2026-09-04T13:53:33.431Z
Env: `https://api.travelvip.ai` · partner `vgm` · tier `19597201`
Dates: **2026-12-30 → 2026-12-31**

**Score: PASS 29 / BUG 1 / NOT TESTED 1**

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Page one deliberate — Mumbai (metro) | POST /v1/hotels/search Mumbai default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Delhi (metro) | POST /v1/hotels/search Delhi default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Dubai (intl) | POST /v1/hotels/search Dubai default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Bangkok (intl) | POST /v1/hotels/search Bangkok default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Jaipur (mid) | POST /v1/hotels/search Jaipur default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Kochi (mid) | POST /v1/hotels/search Kochi default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Rishikesh (small) | POST /v1/hotels/search Rishikesh default sort offset=0 limit=20 | **PASS** |
| 1 | Page one deliberate — Manali (small) | POST /v1/hotels/search Manali default sort offset=0 limit=20 | **PASS** |
| 2 | Result count captured — Mumbai | note totalResults on unfiltered search | **PASS** |
| 3 | Paging unique/no dup — Mumbai | offset 0..N limit=20 until empty | **PASS** |
| 3 | Paging unique/no dup — Jaipur | offset 0..N limit=20 until empty | **PASS** |
| 4 | Price sort ASC/DESC — Mumbai | sort=price_ASC then price_DESC | **PASS** |
| 4 | Price sort ASC/DESC — Dubai | sort=price_ASC then price_DESC | **BUG** |
| 5a | Star filter apply + facet counts stable — Mumbai | fq df_long_star_rating:4 | **PASS** |
| 5b | Chain filter + facet counts stable — Mumbai (Fabhotels) | fq chain filter | **PASS** |
| 5c | Combined GST + Property Type filter — Mumbai | fq combo | **PASS** |
| 5d | Brand filter removed from SRP — Mumbai | unfiltered search filters[] | **PASS** |
| 5d | Brand filter removed — Delhi | unfiltered search filters[] | **PASS** |
| 5d | Brand filter removed — Dubai | unfiltered search filters[] | **PASS** |
| 5d | Brand filter removed — Jaipur | unfiltered search filters[] | **PASS** |
| 5e | Legacy fq Brand:Taj does not 500 — Mumbai | fq ["Brand:Taj"] after Brand removed | **PASS** |
| 6 | Hotel pages and booking unchanged | details/prebook/finalize | **NOT TESTED** |
| 7 | 4★ can appear before later 5★ — Mumbai (star-only) | scan top 40 default order | **PASS** |
| 8 | Top 20 not dominated by ≤3★ — Mumbai (star-only) | scan top 20 starRating | **PASS** |
| 9 | Unrated/1-2★ present on last page — Mumbai | inspect last page of full pagination by starRating | **PASS** |
| 10 | 4-5★ appear before unrated/1-2★ — Mumbai | scan first 200 by starRating only (no hotel-name brand match) | **PASS** |
| 11 | Small town search — Rishikesh | unfiltered search | **PASS** |
| 11 | Small town search — Manali | unfiltered search | **PASS** |
| 12 | No availability / empty message — Mumbai far future | checkin 2027-06-01 | **PASS** |
| 13 | Repeat search same dates — Bangkok | two identical searches back-to-back | **PASS** |
| 14 | Different dates fresh search — Delhi | 2026-12-30 vs 2027-01-02 | **PASS** |

## Bugs

### 4 — Price sort ASC/DESC — Dubai
- Expected: strict mono price; cheap unrated can beat expensive 5★ on ASC
- Actual: ASC mono=true first=Homeland Hostel ₹1782.06 | DESC mono=false first=Atlantis, The Palm ₹-20318998.02 | sortOverridesDefault=true
- requestId: `6a598da2-8cc2-4316-8683-ad41b68b4400`
- City/dates: Dubai 2026-12-30→2026-12-31
