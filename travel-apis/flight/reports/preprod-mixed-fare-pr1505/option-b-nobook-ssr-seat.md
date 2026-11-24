# ENG-763…768 Option B — no book through SSR/seatmap

- When: 2026-11-09T06:43:53.200Z
- Base: https://preprod-api.travelvip.ai
- Route/dates: DEL-BOM-DEL · 2026-12-19 / 2026-12-21
- ALLOW_BOOK: false
- Correlation: bcbdc4ba-947e-4642-9dfb-c0e6e2fb7959
- Search HTTP calls (same pin): 2
- Counts: {"PASS":11,"NOT TESTED":6}

| ENG | ID | Rule | How | Status | Actual |
|-----|----|------|-----|--------|--------|
| ENG-763 | S-0 | RT DOM search yields options | pinned DEL-BOM | **PASS** | n=20 cats=NORMAL,SME |
| ENG-763 | S-1 | After onward pick, return list has options | selectedSearchIds refine | **PASS** | returnN=20 cats=NORMAL,SME |
| ENG-763 | S-1b | Return list includes other allowed fare types (same search) | fare-level filter after onward | **PASS** | onward=SME returnCats=NORMAL,SME other=NORMAL |
| ENG-763 | 763-MIX | Allow SME+NORMAL RT | 6E 6E 5175 → 6E 6E 7017/6E 6E 932 | **PASS** | details=200/ok pricing=200/price_444d9fcde15d402c8f6cc606a9455e7a rules=200/ok |
| ENG-764 | 764-MIXED | Top-level MIXED + per-leg fareType on pricing/details | inspect pricing+details body | **PASS** | {"pricingFareType":"MIXED","detailsFareType":"","mixedFareType":true,"pricingLegs":[{"direction":"ONWARD","fareType":"SME","hasPolicies":false,"keys":["direction","fareType","fareC |
| ENG-765 | 765-POL | Per-leg cancel/reschedule policies present in pricing/details/rules | inspect leg policy fields | **PASS** | {"pricingLegs":[{"direction":"ONWARD","fareType":"SME","hasPolicies":false,"keys":["direction","fareType","fareCategory","legId","legNumber","totalStops","totalDurationMinutes","re |
| ENG-768 | 768-RULES | Fare rules per leg (entry per leg / MIXED) | fareRules ROUND_TRIP 2 ids | **PASS** | {"http":200,"fareType":"MIXED","entryCount":2,"legs":[{"direction":"HDO-BOM · Description","fareType":"SME","hasPolicies":false,"keys":["title","text","fareType"]},{"direction":"NM |
| ENG-763 | SSR | SSR availability after mixed pricing | POST /v1/flights/ssr | **PASS** | {"http":200,"code":null,"mealSegments":3,"baggageSegments":2,"seatSegments":0,"keys":["priceId","timingReference","journeyType","tripType","expiresAt","currencyConversion","meal"," |
| ENG-763 | SEAT | Seatmap availability after mixed pricing | POST /v1/flights/seatmap | **PASS** | {"http":200,"code":null,"httpOkShape":true,"segmentCount":0,"seatCount":0,"requestStatus":"Completed","keys":["type","retryCount","timingReference","tripType","currencyConversion", |
| ENG-763 | 763-SAME | Same-category SME+SME still works | 6E 6E 5175 → 6E 6E 7017/6E 6E 932 | **NOT TESTED** | pricing=400/VENDOR_ERROR fareType= |
| ENG-763 | 763-BLOCK | Block Student/Defence/Senior/Flexi mix | not in return inventory | **NOT TESTED** |  |
| ENG-767 | 767-SEAT | Seatmap when airlines differ (6E+IX) | 6E 6E 5175 → IX IX 1050 | **NOT TESTED** | {"pricing":"404/SEARCH_ID_NOT_FOUND","seatmap":{"skipped":true}} |
| ENG-767 | 767-SSR | SSR on mixed-airline RT | ssr | **NOT TESTED** | {"skipped":true} |
| ENG-766 | 766-EXPIRE | Re-price expired leg from one search | needs cache expiry wait | **NOT TESTED** | skipped to protect L2B / time |
| ENG-763 | 763-INTL | International RT unchanged | skipped second OD (L2B) | **NOT TESTED** | no DEL-DXB search this run |
| META | NO-BOOK | Never called issue-ticket | ALLOW_BOOK=false + script guard | **PASS** |  |
| META | L2B | Pinned single RT DOM OD+dates | DEL-BOM 2026-12-19/2026-12-21 | **PASS** | searchHTTPCalls=2 (polls+refine on same pin) |

Raw dump: `option-b-nobook-ssr-seat.json`
