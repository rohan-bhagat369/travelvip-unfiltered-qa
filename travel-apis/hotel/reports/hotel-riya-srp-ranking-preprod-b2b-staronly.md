# Riya SRP Ranking — B2B Preprod (search only)

Ran: 2026-09-03T07:49:51.572Z
Env: `https://preprod-api.travelvip.ai` · partner `vgm` · tier `19597201`
Dates: **2026-12-12 → 2026-12-13**

**Score: PASS 13 / BUG 12 / NOT TESTED 2**

| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Page one deliberate — Mumbai (metro) | POST /v1/hotels/search Mumbai default sort offset=0 limit=20 | **BUG** |
| 1 | Page one deliberate — Delhi (metro) | POST /v1/hotels/search Delhi default sort offset=0 limit=20 | **BUG** |
| 1 | Page one deliberate — Dubai (intl) | POST /v1/hotels/search Dubai default sort offset=0 limit=20 | **BUG** |
| 1 | Page one deliberate — Bangkok (intl) | POST /v1/hotels/search Bangkok default sort offset=0 limit=20 | **BUG** |
| LAT | Slow search >30000ms — Bangkok | first page timing | **BUG** |
| 1 | Page one deliberate — Jaipur (mid) | POST /v1/hotels/search Jaipur default sort offset=0 limit=20 | **BUG** |
| 1 | Page one deliberate — Kochi (mid) | POST /v1/hotels/search Kochi default sort offset=0 limit=20 | **BUG** |
| 1 | Page one deliberate — Rishikesh (small) | POST /v1/hotels/search Rishikesh default sort offset=0 limit=20 | **BUG** |
| 1 | Page one deliberate — Manali (small) | POST /v1/hotels/search Manali default sort offset=0 limit=20 | **BUG** |
| 2 | Result count captured — Mumbai | note totalResults on unfiltered search | **PASS** |
| 3 | Paging unique/no dup — Mumbai | offset 0..N limit=20 until empty | **PASS** |
| 3 | Paging unique/no dup — Jaipur | offset 0..N limit=20 until empty | **PASS** |
| 4 | Price sort ASC/DESC — Mumbai | sort=price_ASC then price_DESC | **PASS** |
| 4 | Price sort ASC/DESC — Dubai | sort=price_ASC then price_DESC | **BUG** |
| 5a | Star filter apply + facet counts stable — Mumbai | fq df_long_star_rating:4 | **PASS** |
| 5b | Chain filter + facet counts stable — Mumbai (Fabhotels) | fq chain filter | **PASS** |
| 5c | Combined GST + Property Type filter — Mumbai | fq combo | **PASS** |
| 6 | Hotel pages and booking unchanged | details/prebook/finalize | **NOT TESTED** |
| 7 | 4★ can appear before later 5★ — Mumbai (star-only) | scan top 40 default order | **NOT TESTED** |
| 8 | Top 20 not dominated by ≤3★ — Mumbai (star-only) | scan top 20 starRating | **BUG** |
| 9 | Unrated/1-2★ present on last page — Mumbai | inspect last page of full pagination | **PASS** |
| 10 | 4-5★ appear before unrated/1-2★ — Mumbai (star-only) | scan first 200 results by starRating | **BUG** |
| 11 | Small town search — Rishikesh | unfiltered search | **PASS** |
| 11 | Small town search — Manali | unfiltered search | **PASS** |
| 12 | No availability / empty message — Mumbai far future | checkin 2027-06-01 | **PASS** |
| 13 | Repeat search same dates — Bangkok | two identical searches back-to-back | **PASS** |
| 14 | Different dates fresh search — Delhi | 2026-12-12 vs 2026-12-15 | **PASS** |

## Bugs

### 1 — Page one deliberate — Mumbai (metro)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: 4/10 are 1-2★ near top; only 0/10 are 4-5★ (expect mostly premium stars on page one) | top=Hotel Riva International - Near Nesco Center(3★); FabHotel Bliss Executive(3★); Embassy Park BKC Mumbai(2★); Hotel Pacific Residency Near Airport(3★); Hotel Airport International(3★); Hotel Priceless(2★); HOTEL METROMAX(2★); Staywood Suites, Mumbai(3★); HOTEL ARTS INTERNATIONAL(3★); Hotel Sanjary International(2★)
- requestId: `9bac2c5f-2cb4-4236-a0f2-928c95922c7d`
- City/dates: Mumbai 2026-12-12→2026-12-13

### 1 — Page one deliberate — Delhi (metro)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: only 2/10 are 4-5★ (expect mostly premium stars on page one) | top=YMCA Tourist Hostel(3★); Paying Guest Hotel(2★); Centaur Hotel IGI Airport(4★); Fabhotel Sparkling(3★); Hotel Bricks(3★); The Vegas By De Pavilion, Delhi Airport(4★); Hotel Delhi Darbar-Near Karolbagh Metro(3★); Hotel Aura - Near to New Delhi Railway Station(3★); Hotel Sunstar Heights(3★); Hotel Legend International - Just a min walk from New Delhi Railway Station(3★)
- requestId: `e5fb30cf-bd8a-47ba-81db-173e9bdbc39d`
- City/dates: Delhi 2026-12-12→2026-12-13

### 1 — Page one deliberate — Dubai (intl)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: 2/10 are 1-2★ near top; only 5/10 are 4-5★ (expect mostly premium stars on page one) | top=W Dubai - Mina Seyahi(5★); Studio M Al Barsha By Millennium(3★); Residence Inn by Marriott Sheikh Zayed Road(4★); Hues Boutique Hotel(4★); Crowne Plaza Dubai Jumeirah by IHG(5★); Ecos Dubai Hotel at Al Furjan(3★); ibis Styles Dubai Airport Hotel(3★); NAJIBA HOTEL(1★); Tamarind Hotel(1★); Address Downtown(5★)
- requestId: `b42ebd66-e63d-47e2-a46a-0f2f116da1b2`
- City/dates: Dubai 2026-12-12→2026-12-13

### 1 — Page one deliberate — Bangkok (intl)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: 2/10 are 1-2★ near top | top=BNK89 Hostel(2★); Lub d Bangkok Siam – New Look, Across from MBK & Skytrain Access(3★); Lumen Bangkok Udomsuk Station(4★); Wyndham Garden Bangkok Sukhumvit 42(4★); Honey House1(3★); Au Luna Bangkok Hostel(1★); At Residence Suvarnabhumi Hotel(4★); The Landmark Bangkok(5★); PARKROYAL Suites Bangkok(4★); Hide and Seek Boutique Hometel(4★)
- requestId: `e919e7b3-0ff5-4243-8fd1-90f3174b72bb`
- City/dates: Bangkok 2026-12-12→2026-12-13

### LAT — Slow search >30000ms — Bangkok
- Expected: <30000ms
- Actual: 31739ms
- requestId: `e919e7b3-0ff5-4243-8fd1-90f3174b72bb`
- City/dates: Bangkok 2026-12-12→2026-12-13

### 1 — Page one deliberate — Jaipur (mid)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: 3/10 are 1-2★ near top; only 4/10 are 4-5★ (expect mostly premium stars on page one) | top=Garg Niwas(2★); Shakun Hotels & Resorts Jaipur(5★); Riddhi villa(2★); Hotel R D Palace(3★); Royal Heritage Haveli(4★); Hotel Urban Boutique Jaipur(3★); Hotel Fort Chandragupt Jaipur(4★); Alsisar Haveli - A Heritage Hotel(4★); Madpackers Jaipur(1★); The Harmony Circle - Jaipur(3★)
- requestId: `03131052-a0ca-4fcc-add9-83a6d72c6fe3`
- City/dates: Jaipur 2026-12-12→2026-12-13

### 1 — Page one deliberate — Kochi (mid)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: 4/10 are 1-2★ near top; only 2/10 are 4-5★ (expect mostly premium stars on page one) | top=Forte Kochi(4★); Rossitta Wood Castle(2★); Sheeba's Homestay(1★); Fortkochi Beach Inn(3★); Palm Wave Beach Resort(3★); Swasthigriha's Beach Homestay, Cherai(1★); Elim Homestay(3★); LOUIS BACKPACKERS HOSTEL(3★); Ama Stays & Trails Sherlys Ente Kumbalanghi, Kochi(5★); The Santa Maria hostel Fort Kochi(2★)
- requestId: `f0760117-6698-414f-bf62-402639689c93`
- City/dates: Kochi 2026-12-12→2026-12-13

### 1 — Page one deliberate — Rishikesh (small)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: 3/10 are 1-2★ near top; only 1/10 are 4-5★ (expect mostly premium stars on page one) | top=Hotel Raj Mahal(2★); Tapovan Hills(3★); Aloha On The Ganges, Rishikesh(4★); Hotel Vishla Palace(2★); Raj Resort(3★); Home of Lavenia(3★); Devlok Homes(3★); Manzil Hostel(1★); Hotel Indo Tiger By Rawat Hospitality(3★); PerfectStayz B2L Hills Tapovan(3★)
- requestId: `18c4270f-66fe-4093-9fb4-294d901ccd5c`
- City/dates: Rishikesh 2026-12-12→2026-12-13

### 1 — Page one deliberate — Manali (small)
- Expected: Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top
- Actual: ISSUES: only 2/10 are 4-5★ (expect mostly premium stars on page one) | top=Snow Valley Resorts(4★); Sunrise Villa Manali(2★); Shingar Regency(4★); Whoopers Hostel Manali(3★); Clarks Inn Suites Manali(3★); Treebo M R Villa(3★); Hotel Mount View By Oscar Hotels(3★); Page 3 - Riverside Rooms & Bar(3★); Hotel Sky Heaven(3★); Johnson Lodge and Spa(3★)
- requestId: `d62ce0ea-ad63-4ea4-89eb-2f45f8a2af8f`
- City/dates: Manali 2026-12-12→2026-12-13

### 4 — Price sort ASC/DESC — Dubai
- Expected: strict mono price; cheap unrated can beat expensive 5★ on ASC
- Actual: ASC mono=true first=Towers Rotana ₹NaN | DESC mono=true first=Address Montgomerie Dubai ₹2284614.96 | sortOverridesDefault=false
- requestId: `ba6b7d62-1278-4665-9ef6-725f18bd307f`
- City/dates: Dubai 2026-12-12→2026-12-13

### 8 — Top 20 not dominated by ≤3★ — Mumbai (star-only)
- Expected: majority of top 20 should be 4-5★
- Actual: 4-5★=2/20 ≤3★=18/20
- City/dates: Mumbai 2026-12-12→2026-12-13

### 10 — 4-5★ appear before unrated/1-2★ — Mumbai (star-only)
- Expected: first 4-5★ before first unrated/1-2★
- Actual: first4-5★ rank #16 "Sunrise Homes Serviced Apartment"; firstLowUnrated rank #3; firstBudgetNameMatch #2 (name match informational only)
- City/dates: Mumbai 2026-12-12→2026-12-13
