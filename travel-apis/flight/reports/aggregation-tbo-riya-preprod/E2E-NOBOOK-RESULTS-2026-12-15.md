# Aggregation e2e (search → pricing, SSR, seat map) — no book

Env `https://preprod-api.travelvip.ai` · tier 22101801 · captured **2026-11-24T09:27Z** · dates **2026-12-15** / **2026-12-22** · correlation `161773b2-221e-49b1-b1ec-752f18369466`
Looks: 4 searches · HTTP calls: search 17 (polls/pages/selections) · details 12 · fareRules 12 · pricing 16 · ssr 9 · seatmap 8 · booking 0

## Summary: 314 PASS · 18 BUG · 10 CHECK · 11 NOT TESTED

| Journey | Area | Case | How tested | Status | Notes |
|---|---|---|---|---|---|
| all | L2B | H1 | One look per journey (4 searches), same dates | **PASS** | 2026-12-15 / 2026-12-22 |
| all | L2B | H2 | No booking / ticketing / cancel endpoint called | **PASS** | search HTTP 17 · details 12 · fareRules 12 · pricing 16 · ssr 9 · seatmap 8 |
| all | L2B | H3 | Extra pages served from the same cached search | **PASS** | 8 page calls |
| ow-dom | Search | S0 | Search HTTP 200, progress COMPLETE | **PASS** | polls=2 · onward 208 |
| ow-dom | Search | A3 | Merged tier returns both vendors | **PASS** | got {402T,422R} |
| ow-dom | Search | A4 | ∃ card with both vendor fares | **PASS** | 153 of 208 onward cards |
| ow-dom | Search | A5 | No fare without sourceCode | **PASS** | nulls=0 |
| ow-dom | Search | B1 | No duplicate flight cards (ONWARD) | **PASS** | 208 cards, 5 pages |
| ow-dom | Search | B2 | Card price = cheapest fare on the card | **PASS** | 208 cards |
| ow-dom | Search | B6 | Sorted cheapest-first | **PASS** |  |
| ow-dom | Search | B7 | Pages concat = totalResults, no repeat | **PASS** | 208 vs 208 |
| ow-dom | Search | B8 | Every fare total > 0 | **PASS** | bad=0 |
| ow-dom | Search | PX1 | Fare breakdown adds up (base+taxes+fees = total) | **PASS** |  |
| ow-dom | Search | PX2 | All fares in INR | **PASS** | {INR} |
| ow-dom | Search | C4 | fareType present on every fare | **PASS** | missing=0 |
| ow-dom | Search | SEG | Every segment has airports, times, flight number | **PASS** |  |
| ow-dom | Search | B5 | Airline filter names case-unique | **PASS** | 5 airlines |
| ow-dom | Search | G10 | No "Riya" text in search response | **PASS** |  |
| ow-dom | Search | AP1 | Results use the searched airports only (DEL/BOM) | **CHECK** | 20 cards on other airports: DEL>NMI×15, HDO>BOM×2, DXN>BOM×3 — confirm nearby-airport results are intended |
| ow-dom | TBO 402T | F0 | TBO 402T fare picked | **PASS** | from merged card · Value ₹6912.96 |
| ow-dom | TBO 402T | D1 | Details HTTP 200 | **PASS** | http=200   |
| ow-dom | TBO 402T | D2 | Details price shown in INR (requested currency=INR) | **BUG** | details USD 72.01 · search ₹6912.96 · currencyConversion null |
| ow-dom | TBO 402T | D2b | Details total = search price | **NOT TESTED** | blocked by D2 (not INR) |
| ow-dom | TBO 402T | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1235/DEL/2026-12-15T20:40/BOM/2026-12-15T23:10 |
| ow-dom | TBO 402T | D6 | Details and pricing agree on seat / meal / baggage support | **CHECK** | supportsSeats details=false pricing=true · supportsMeals details=false pricing=true · supportsExtraBaggage details=false pricing=true |
| ow-dom | TBO 402T | D4 | No negative amounts in details | **PASS** |  |
| ow-dom | TBO 402T | D5 | No "Riya" in details | **PASS** |  |
| ow-dom | TBO 402T | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 1 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| ow-dom | TBO 402T | FR2 | One fare-rule block per leg (1) | **PASS** | 1 block(s): Fare Rules IX DEL-BOM |
| ow-dom | TBO 402T | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "Value" · basis GNRA000 |
| ow-dom | TBO 402T | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-dom | TBO 402T | FR4 | No "Riya" in fare rules | **PASS** |  |
| ow-dom | TBO 402T | FR5 | No negative amounts in fare rules | **PASS** |  |
| ow-dom | TBO 402T | FR7 | Each rule block titled with its route (which leg it covers) | **PASS** | "Fare Rules IX DEL-BOM" |
| ow-dom | TBO 402T | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| ow-dom | TBO 402T | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http=200   |
| ow-dom | TBO 402T | P2 | Pricing total = search price (±₹1) | **PASS** | search ₹6912.96 · pricing ₹6912.96 |
| ow-dom | TBO 402T | P3 | Pricing breakdown adds up | **PASS** | parts ₹6912.96 · total ₹6912.96 |
| ow-dom | TBO 402T | P4 | 1 ADT passenger price = total | **BUG** | pax ₹6720.96 |
| ow-dom | TBO 402T | P5 | If price differs from search, priceChange says so | **PASS** | null |
| ow-dom | TBO 402T | P6 | Pricing currency INR, no negative amounts | **PASS** | INR  |
| ow-dom | TBO 402T | P7 | gstBreakup is array or omitted | **PASS** | object |
| ow-dom | TBO 402T | P8 | No "Riya" in pricing / bookingContext | **PASS** |  |
| ow-dom | TBO 402T | P9 | Pricing itinerary = picked flight(s) | **PASS** |  |
| ow-dom | TBO 402T | SSR1 | SSR HTTP 200 (meal / baggage catalog up) | **PASS** | http=200   |
| ow-dom | TBO 402T | SSR2 | SSR lists meal and/or baggage options | **PASS** | meal keys 2 · baggage keys 2 · top priceId,timingReference,journeyType,tripType,expiresAt,currencyConversion,meal,baggage |
| ow-dom | TBO 402T | SSR3 | SSR prices ≥ 0, no "Riya" | **PASS** |  |
| ow-dom | TBO 402T | SSR4 | SSR prices in INR | **PASS** | {INR} |
| ow-dom | TBO 402T | SEAT1 | Seat map HTTP 200 (not 5xx) | **PASS** | http=200   |
| ow-dom | TBO 402T | SEAT2 | Seat map has seats (pricing says supportsSeats) | **PASS** | 189 seats, 188 available · supportsSeats true |
| ow-dom | TBO 402T | SEAT3 | Seat prices ≥ 0, no "Riya" | **PASS** |  |
| ow-dom | TBO 402T | SEAT3b | Seat prices in INR | **PASS** | INR · conversion {"source":"USD","destination":"INR","rate":96} |
| ow-dom | TBO 402T | SEAT4 | One seat map per flight segment | **PASS** | 1 seat maps · 1 segments (DEL-BOM) |
| ow-dom | TBO 402T | SEAT5 | No duplicate seat numbers within a segment | **PASS** |  |
| ow-dom | TBO 402T | SEAT6 | seatAvailability in the common format ("true"/"false") for both providers | **PASS** | seatAvailability {false,true} · seatStatus {false,true} |
| ow-dom | Riya 422R | F0 | Riya 422R fare picked | **PASS** | from merged card · VALUE ₹6648 |
| ow-dom | Riya 422R | D1 | Details HTTP 200 | **PASS** | http=200   |
| ow-dom | Riya 422R | D2 | Details price shown in INR (requested currency=INR) | **PASS** | details INR 6648 |
| ow-dom | Riya 422R | D2b | Details total = search price | **PASS** | search ₹6648 · details ₹6648 |
| ow-dom | Riya 422R | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1235/DEL/2026-12-15T20:40/BOM/2026-12-15T23:10 |
| ow-dom | Riya 422R | D6 | Details and pricing agree on seat / meal / baggage support | **CHECK** | supportsSeats details=false pricing=true · supportsMeals details=false pricing=true · supportsExtraBaggage details=false pricing=true |
| ow-dom | Riya 422R | D4 | No negative amounts in details | **PASS** |  |
| ow-dom | Riya 422R | D5 | No "Riya" in details | **PASS** |  |
| ow-dom | Riya 422R | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 1 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| ow-dom | Riya 422R | FR2 | One fare-rule block per leg (1) | **PASS** | 1 block(s): I5E |
| ow-dom | Riya 422R | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "VALUE" · basis GNRA000 |
| ow-dom | Riya 422R | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-dom | Riya 422R | FR4 | No "Riya" in fare rules | **PASS** |  |
| ow-dom | Riya 422R | FR5 | No negative amounts in fare rules | **PASS** |  |
| ow-dom | Riya 422R | FR7 | Each rule block titled with its route (which leg it covers) | **BUG** | "I5E" |
| ow-dom | Riya 422R | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| ow-dom | Riya 422R | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http=200   |
| ow-dom | Riya 422R | P2 | Pricing total = search price (±₹1) | **PASS** | search ₹6648 · pricing ₹6648 |
| ow-dom | Riya 422R | P3 | Pricing breakdown adds up | **PASS** | parts ₹6648 · total ₹6648 |
| ow-dom | Riya 422R | P4 | 1 ADT passenger price = total | **PASS** | pax ₹6648 |
| ow-dom | Riya 422R | P5 | If price differs from search, priceChange says so | **PASS** | null |
| ow-dom | Riya 422R | P6 | Pricing currency INR, no negative amounts | **PASS** | INR  |
| ow-dom | Riya 422R | P7 | gstBreakup is array or omitted | **PASS** | object |
| ow-dom | Riya 422R | P8 | No "Riya" in pricing / bookingContext | **PASS** |  |
| ow-dom | Riya 422R | P9 | Pricing itinerary = picked flight(s) | **PASS** |  |
| ow-dom | Riya 422R | SSR1 | SSR HTTP 200 (meal / baggage catalog up) | **PASS** | http=200   |
| ow-dom | Riya 422R | SSR2 | SSR lists meal and/or baggage options | **PASS** | meal keys 2 · baggage keys 2 · top priceId,timingReference,journeyType,tripType,expiresAt,currencyConversion,meal,baggage |
| ow-dom | Riya 422R | SSR3 | SSR prices ≥ 0, no "Riya" | **PASS** |  |
| ow-dom | Riya 422R | SSR4 | SSR prices in INR | **PASS** | {INR} |
| ow-dom | Riya 422R | SEAT1 | Seat map HTTP 200 (not 5xx) | **PASS** | http=200   |
| ow-dom | Riya 422R | SEAT2 | Seat map has seats (pricing says supportsSeats) | **PASS** | 189 seats, 188 available · supportsSeats true |
| ow-dom | Riya 422R | SEAT3 | Seat prices ≥ 0, no "Riya" | **PASS** |  |
| ow-dom | Riya 422R | SEAT3b | Seat prices in INR | **PASS** | INR · conversion {"source":"INR","destination":"INR","rate":1} |
| ow-dom | Riya 422R | SEAT4 | One seat map per flight segment | **PASS** | 1 seat maps · 1 segments (DEL-BOM) |
| ow-dom | Riya 422R | SEAT5 | No duplicate seat numbers within a segment | **PASS** |  |
| ow-dom | Riya 422R | SEAT6 | seatAvailability in the common format ("true"/"false") for both providers | **BUG** | seatAvailability {Closed,Open} · seatStatus {True} |
| ow-intl | Search | S0 | Search HTTP 200, progress COMPLETE | **PASS** | polls=1 · onward 235 |
| ow-intl | Search | A3 | Merged tier returns both vendors | **PASS** | got {402T,422R} |
| ow-intl | Search | A4 | ∃ card with both vendor fares | **PASS** | 135 of 235 onward cards |
| ow-intl | Search | A5 | No fare without sourceCode | **PASS** | nulls=0 |
| ow-intl | Search | B1 | No duplicate flight cards (ONWARD) | **PASS** | 235 cards, 5 pages |
| ow-intl | Search | B2 | Card price = cheapest fare on the card | **PASS** | 235 cards |
| ow-intl | Search | B6 | Sorted cheapest-first | **PASS** |  |
| ow-intl | Search | B7 | Pages concat = totalResults, no repeat | **PASS** | 235 vs 235 |
| ow-intl | Search | B8 | Every fare total > 0 | **PASS** | bad=0 |
| ow-intl | Search | PX1 | Fare breakdown adds up (base+taxes+fees = total) | **PASS** |  |
| ow-intl | Search | PX2 | All fares in INR | **PASS** | {INR} |
| ow-intl | Search | C4 | fareType present on every fare | **PASS** | missing=0 |
| ow-intl | Search | SEG | Every segment has airports, times, flight number | **PASS** |  |
| ow-intl | Search | B5 | Airline filter names case-unique | **PASS** | 17 airlines |
| ow-intl | Search | G10 | No "Riya" text in search response | **PASS** |  |
| ow-intl | Search | AP1 | Results use the searched airports only (DEL/DXB) | **CHECK** | 100 cards on other airports: DEL>RKT×6, DEL>SHJ×31, DEL>AUH×23, DEL>FJR×4, DEL>XNB×31, DXN>AUH×3, HDO>AUH×1, HDO>DXB×1 — confirm nearby-airport results are intended |
| ow-intl | TBO 402T | F0 | TBO 402T fare picked | **PASS** | from merged card · Lite ₹20280 |
| ow-intl | TBO 402T | D1 | Details HTTP 200 | **PASS** | http=200   |
| ow-intl | TBO 402T | D2 | Details price shown in INR (requested currency=INR) | **BUG** | details USD 211.25 · search ₹20280 · currencyConversion null |
| ow-intl | TBO 402T | D2b | Details total = search price | **NOT TESTED** | blocked by D2 (not INR) |
| ow-intl | TBO 402T | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1294/DEL/2026-12-15T18:50/STV/2026-12-15T20:50>IX335/STV/2026-12-16T07:10/DXB/2026-12-16T08:55 |
| ow-intl | TBO 402T | D4 | No negative amounts in details | **PASS** |  |
| ow-intl | TBO 402T | D5 | No "Riya" in details | **PASS** |  |
| ow-intl | TBO 402T | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 1 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| ow-intl | TBO 402T | FR2 | One fare-rule block per leg (1) | **PASS** | 1 block(s): Fare Rules IX DEL-DXB |
| ow-intl | TBO 402T | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "Lite" · basis ECLAX00 |
| ow-intl | TBO 402T | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-intl | TBO 402T | FR4 | No "Riya" in fare rules | **PASS** |  |
| ow-intl | TBO 402T | FR5 | No negative amounts in fare rules | **PASS** |  |
| ow-intl | TBO 402T | FR7 | Each rule block titled with its route (which leg it covers) | **PASS** | "Fare Rules IX DEL-DXB" |
| ow-intl | TBO 402T | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| ow-intl | TBO 402T | P1 | Pricing HTTP 200 with priceId + bookingContext | **BUG** | http=400 VENDOR_ERROR Pricing failed. |
| ow-intl | Riya 422R | F0 | Riya 422R fare picked | **PASS** | from merged card · LITE ₹19850 |
| ow-intl | Riya 422R | D1 | Details HTTP 200 | **PASS** | http=200   |
| ow-intl | Riya 422R | D2 | Details price shown in INR (requested currency=INR) | **PASS** | details INR 19850 |
| ow-intl | Riya 422R | D2b | Details total = search price | **PASS** | search ₹19850 · details ₹19850 |
| ow-intl | Riya 422R | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1294/DEL/2026-12-15T18:50/STV/2026-12-15T20:50>IX335/STV/2026-12-16T07:10/DXB/2026-12-16T08:55 |
| ow-intl | Riya 422R | D6 | Details and pricing agree on seat / meal / baggage support | **CHECK** | supportsSeats details=false pricing=true · supportsMeals details=false pricing=true · supportsExtraBaggage details=false pricing=true |
| ow-intl | Riya 422R | D4 | No negative amounts in details | **PASS** |  |
| ow-intl | Riya 422R | D5 | No "Riya" in details | **PASS** |  |
| ow-intl | Riya 422R | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 1 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| ow-intl | Riya 422R | FR2 | One fare-rule block per leg (1) | **PASS** | 1 block(s): I5LT |
| ow-intl | Riya 422R | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "LITE" · basis ECLAX00 |
| ow-intl | Riya 422R | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-intl | Riya 422R | FR4 | No "Riya" in fare rules | **PASS** |  |
| ow-intl | Riya 422R | FR5 | No negative amounts in fare rules | **PASS** |  |
| ow-intl | Riya 422R | FR7 | Each rule block titled with its route (which leg it covers) | **BUG** | "I5LT" |
| ow-intl | Riya 422R | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| ow-intl | Riya 422R | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http=200   |
| ow-intl | Riya 422R | P2 | Pricing total = search price (±₹1) | **PASS** | search ₹19850 · pricing ₹19850 |
| ow-intl | Riya 422R | P3 | Pricing breakdown adds up | **PASS** | parts ₹19850 · total ₹19850 |
| ow-intl | Riya 422R | P4 | 1 ADT passenger price = total | **PASS** | pax ₹19850 |
| ow-intl | Riya 422R | P5 | If price differs from search, priceChange says so | **PASS** | null |
| ow-intl | Riya 422R | P6 | Pricing currency INR, no negative amounts | **PASS** | INR  |
| ow-intl | Riya 422R | P7 | gstBreakup is array or omitted | **PASS** | object |
| ow-intl | Riya 422R | P8 | No "Riya" in pricing / bookingContext | **PASS** |  |
| ow-intl | Riya 422R | P9 | Pricing itinerary = picked flight(s) | **PASS** |  |
| ow-intl | Riya 422R | SSR1 | SSR HTTP 200 (meal / baggage catalog up) | **PASS** | http=200   |
| ow-intl | Riya 422R | SSR2 | SSR lists meal and/or baggage options | **PASS** | meal keys 3 · baggage keys 2 · top priceId,timingReference,journeyType,tripType,expiresAt,currencyConversion,meal,baggage |
| ow-intl | Riya 422R | SSR3 | SSR prices ≥ 0, no "Riya" | **PASS** |  |
| ow-intl | Riya 422R | SSR4 | SSR prices in INR | **PASS** | {INR} |
| ow-intl | Riya 422R | SEAT1 | Seat map HTTP 200 (not 5xx) | **PASS** | http=200   |
| ow-intl | Riya 422R | SEAT2 | Seat map has seats (pricing says supportsSeats) | **PASS** | 400 seats, 391 available · supportsSeats true |
| ow-intl | Riya 422R | SEAT3 | Seat prices ≥ 0, no "Riya" | **PASS** |  |
| ow-intl | Riya 422R | SEAT3b | Seat prices in INR | **PASS** | INR · conversion {"source":"INR","destination":"INR","rate":1} |
| ow-intl | Riya 422R | SEAT4 | One seat map per flight segment | **PASS** | 2 seat maps · 2 segments (DEL-STV, STV-DXB) |
| ow-intl | Riya 422R | SEAT5 | No duplicate seat numbers within a segment | **PASS** |  |
| ow-intl | Riya 422R | SEAT6 | seatAvailability in the common format ("true"/"false") for both providers | **BUG** | seatAvailability {Closed,Open} · seatStatus {True} |
| rt-dom | Search | S0 | Search HTTP 200, progress COMPLETE | **PASS** | polls=1 · onward 190 · return 186 |
| rt-dom | Search | A3 | Merged tier returns both vendors | **PASS** | got {402T,422R} |
| rt-dom | Search | A4 | ∃ card with both vendor fares | **PASS** | 27 of 50 onward cards |
| rt-dom | Search | A5 | No fare without sourceCode | **PASS** | nulls=0 |
| rt-dom | Search | B1 | No duplicate flight cards (ONWARD) | **PASS** | 50 cards, page 0 |
| rt-dom | Search | B1r | No duplicate flight cards (RETURN) | **PASS** | 50 cards |
| rt-dom | Search | B2 | Card price = cheapest fare on the card | **PASS** | 100 cards |
| rt-dom | Search | B6 | Sorted cheapest-first | **PASS** |  |
| rt-dom | Search | B8 | Every fare total > 0 | **PASS** | bad=0 |
| rt-dom | Search | PX1 | Fare breakdown adds up (base+taxes+fees = total) | **PASS** |  |
| rt-dom | Search | PX2 | All fares in INR | **PASS** | {INR} |
| rt-dom | Search | C4 | fareType present on every fare | **PASS** | missing=0 |
| rt-dom | Search | SEG | Every segment has airports, times, flight number | **PASS** |  |
| rt-dom | Search | B5 | Airline filter names case-unique | **PASS** | 4 airlines |
| rt-dom | Search | G10 | No "Riya" text in search response | **PASS** |  |
| rt-dom | Search | AP1 | Results use the searched airports only (DEL/BOM) | **CHECK** | 9 cards on other airports: DEL>NMI×3, BOM>DXN×1, NMI>DEL×4, BOM>HDO×1 — confirm nearby-airport results are intended |
| rt-dom | TBO 402T | F0 | TBO 402T fare picked | **PASS** | from merged card · Return ₹13710.72 |
| rt-dom | TBO 402T | C6 | Return list non-empty after picking onward | **PASS** | return total 6 |
| rt-dom | TBO 402T | C8 | Return fares only from the onward vendor | **PASS** | got {402T} |
| rt-dom | TBO 402T | C9 | Return card carries combinedPricing COMBINATION | **PASS** | COMBINATION |
| rt-dom | TBO 402T | C11 | Combined price ≥ onward fare and ≠ 2× onward | **PASS** | combined ₹13710.72 · onward ₹13710.72 · return fare ₹13710.72 |
| rt-dom | TBO 402T | D1 | Details HTTP 200 | **PASS** | http=200   |
| rt-dom | TBO 402T | D2 | Details price shown in INR (requested currency=INR) | **BUG** | details USD 142.82 · search ₹13710.72 · currencyConversion null |
| rt-dom | TBO 402T | D2b | Details total = search price | **NOT TESTED** | blocked by D2 (not INR) |
| rt-dom | TBO 402T | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1235/DEL/2026-12-15T20:40/BOM/2026-12-15T23:10 |
| rt-dom | TBO 402T | D4 | No negative amounts in details | **PASS** |  |
| rt-dom | TBO 402T | D5 | No "Riya" in details | **PASS** |  |
| rt-dom | TBO 402T | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 2 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| rt-dom | TBO 402T | FR2 | One fare-rule block per leg (2) | **PASS** | 2 block(s): Fare Rules IX DEL-BOM / Fare Rules IX NMI-DEL |
| rt-dom | TBO 402T | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "Return" · basis GNNA000 |
| rt-dom | TBO 402T | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-dom | TBO 402T | FR4 | No "Riya" in fare rules | **PASS** |  |
| rt-dom | TBO 402T | FR5 | No negative amounts in fare rules | **PASS** |  |
| rt-dom | TBO 402T | FR7 | Each rule block titled with its route (which leg it covers) | **PASS** | "Fare Rules IX DEL-BOM" "Fare Rules IX NMI-DEL" |
| rt-dom | TBO 402T | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| rt-dom | TBO 402T | P1 | Pricing HTTP 200 with priceId + bookingContext | **BUG** | http=400 VENDOR_ERROR Pricing failed. |
| rt-dom | Riya 422R | F0 | Riya 422R fare picked | **PASS** | from merged card · VALUE ₹6648 |
| rt-dom | Riya 422R | C6 | Return list non-empty after picking onward | **PASS** | return total 182 |
| rt-dom | Riya 422R | C8 | Return fares only from the onward vendor | **PASS** | got {422R} |
| rt-dom | Riya 422R | C9 | Return card carries combinedPricing COMBINATION | **PASS** | COMBINATION |
| rt-dom | Riya 422R | C11 | Combined price ≥ onward fare and ≠ 2× onward | **PASS** | combined ₹13012 · onward ₹6648 · return fare ₹6364 |
| rt-dom | Riya 422R | D1 | Details HTTP 200 | **PASS** | http=200   |
| rt-dom | Riya 422R | D2 | Details price shown in INR (requested currency=INR) | **PASS** | details INR 13012 |
| rt-dom | Riya 422R | D2b | Details total = search price | **PASS** | search ₹13012 · details ₹13012 |
| rt-dom | Riya 422R | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1235/DEL/2026-12-15T20:40/BOM/2026-12-15T23:10 |
| rt-dom | Riya 422R | D6 | Details and pricing agree on seat / meal / baggage support | **CHECK** | supportsSeats details=false pricing=true · supportsMeals details=false pricing=true · supportsExtraBaggage details=false pricing=true |
| rt-dom | Riya 422R | D4 | No negative amounts in details | **PASS** |  |
| rt-dom | Riya 422R | D5 | No "Riya" in details | **PASS** |  |
| rt-dom | Riya 422R | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 1 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| rt-dom | Riya 422R | FR2 | One fare-rule block per leg (2) | **BUG** | 1 block(s): I5E |
| rt-dom | Riya 422R | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "VALUE" · basis GNRA000 |
| rt-dom | Riya 422R | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-dom | Riya 422R | FR4 | No "Riya" in fare rules | **PASS** |  |
| rt-dom | Riya 422R | FR5 | No negative amounts in fare rules | **PASS** |  |
| rt-dom | Riya 422R | FR7 | Each rule block titled with its route (which leg it covers) | **BUG** | "I5E" |
| rt-dom | Riya 422R | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| rt-dom | Riya 422R | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http=200   |
| rt-dom | Riya 422R | P2 | Pricing total = search price (±₹1) | **PASS** | search ₹13012 · pricing ₹13012 |
| rt-dom | Riya 422R | P3 | Pricing breakdown adds up | **PASS** | parts ₹13012 · total ₹13012 |
| rt-dom | Riya 422R | P4 | 1 ADT passenger price = total | **PASS** | pax ₹13012 |
| rt-dom | Riya 422R | P5 | If price differs from search, priceChange says so | **PASS** | null |
| rt-dom | Riya 422R | P6 | Pricing currency INR, no negative amounts | **PASS** | INR  |
| rt-dom | Riya 422R | P7 | gstBreakup is array or omitted | **PASS** | object |
| rt-dom | Riya 422R | P8 | No "Riya" in pricing / bookingContext | **PASS** |  |
| rt-dom | Riya 422R | P9 | Pricing itinerary = picked flight(s) | **PASS** |  |
| rt-dom | Riya 422R | SSR1 | SSR HTTP 200 (meal / baggage catalog up) | **PASS** | http=200   |
| rt-dom | Riya 422R | SSR2 | SSR lists meal and/or baggage options | **PASS** | meal keys 4 · baggage keys 3 · top priceId,timingReference,journeyType,tripType,expiresAt,currencyConversion,meal,baggage |
| rt-dom | Riya 422R | SSR3 | SSR prices ≥ 0, no "Riya" | **PASS** |  |
| rt-dom | Riya 422R | SSR4 | SSR prices in INR | **PASS** | {INR} |
| rt-dom | Riya 422R | SEAT1 | Seat map HTTP 200 (not 5xx) | **BUG** | http=400 VENDOR_UNAVAILABLE Flight provider is temporarily unavailable. |
| rt-intl | Search | S0 | Search HTTP 200, progress COMPLETE | **PASS** | polls=1 · onward 116 · return 111 |
| rt-intl | Search | A3 | Merged tier returns both vendors | **PASS** | got {402T,422R} |
| rt-intl | Search | A4 | ∃ card with both vendor fares | **PASS** | 19 of 50 onward cards |
| rt-intl | Search | A5 | No fare without sourceCode | **PASS** | nulls=0 |
| rt-intl | Search | B1 | No duplicate flight cards (ONWARD) | **PASS** | 50 cards, page 0 |
| rt-intl | Search | B1r | No duplicate flight cards (RETURN) | **PASS** | 50 cards |
| rt-intl | Search | B2 | Card price = cheapest fare on the card | **PASS** | 100 cards |
| rt-intl | Search | B6 | Sorted cheapest-first | **PASS** |  |
| rt-intl | Search | B8 | Every fare total > 0 | **PASS** | bad=0 |
| rt-intl | Search | PX1 | Fare breakdown adds up (base+taxes+fees = total) | **PASS** |  |
| rt-intl | Search | PX2 | All fares in INR | **PASS** | {INR} |
| rt-intl | Search | C4 | fareType present on every fare | **PASS** | missing=0 |
| rt-intl | Search | SEG | Every segment has airports, times, flight number | **PASS** |  |
| rt-intl | Search | B5 | Airline filter names case-unique | **PASS** | 15 airlines |
| rt-intl | Search | G10 | No "Riya" text in search response | **PASS** |  |
| rt-intl | Search | AP1 | Results use the searched airports only (DEL/DXB) | **CHECK** | 71 cards on other airports: DEL>RKT×4, DEL>SHJ×6, DEL>AUH×7, DEL>FJR×2, DEL>XNB×19, SHJ>DEL×3, AUH>DEL×5, FJR>DEL×2, RKT>DEL×4, XNB>DEL×18, DXB>DXN×1 — confirm nearby-airport results are intended |
| rt-intl | TBO 402T | F0 | TBO 402T fare picked | **PASS** | from merged card · Lite ₹35914.56 |
| rt-intl | TBO 402T | C6 | Return list non-empty after picking onward | **PASS** | return total 5 |
| rt-intl | TBO 402T | C8 | Return fares only from the onward vendor | **PASS** | got {402T} |
| rt-intl | TBO 402T | C9 | Return card carries combinedPricing COMBINATION | **PASS** | COMBINATION |
| rt-intl | TBO 402T | C11 | Combined price ≥ onward fare and ≠ 2× onward | **PASS** | combined ₹35914.56 · onward ₹35914.56 · return fare ₹35914.56 |
| rt-intl | TBO 402T | D1 | Details HTTP 200 | **PASS** | http=200   |
| rt-intl | TBO 402T | D2 | Details price shown in INR (requested currency=INR) | **BUG** | details USD 374.11 · search ₹35914.56 · currencyConversion null |
| rt-intl | TBO 402T | D2b | Details total = search price | **NOT TESTED** | blocked by D2 (not INR) |
| rt-intl | TBO 402T | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1294/DEL/2026-12-15T18:50/STV/2026-12-15T20:50>IX335/STV/2026-12-16T07:10/DXB/2026-12-16T08:55 |
| rt-intl | TBO 402T | D6 | Details and pricing agree on seat / meal / baggage support | **CHECK** | supportsSeats details=false pricing=true · supportsMeals details=false pricing=true · supportsExtraBaggage details=false pricing=true |
| rt-intl | TBO 402T | D4 | No negative amounts in details | **PASS** |  |
| rt-intl | TBO 402T | D5 | No "Riya" in details | **PASS** |  |
| rt-intl | TBO 402T | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 2 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| rt-intl | TBO 402T | FR2 | One fare-rule block per leg (2) | **PASS** | 2 block(s): Fare Rules IX DEL-DXB / Fare Rules IX SHJ-DEL |
| rt-intl | TBO 402T | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "Lite" · basis ECLAX00 |
| rt-intl | TBO 402T | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-intl | TBO 402T | FR4 | No "Riya" in fare rules | **PASS** |  |
| rt-intl | TBO 402T | FR5 | No negative amounts in fare rules | **PASS** |  |
| rt-intl | TBO 402T | FR7 | Each rule block titled with its route (which leg it covers) | **PASS** | "Fare Rules IX DEL-DXB" "Fare Rules IX SHJ-DEL" |
| rt-intl | TBO 402T | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| rt-intl | TBO 402T | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http=200   |
| rt-intl | TBO 402T | P2 | Pricing total = search price (±₹1) | **PASS** | search ₹35914.56 · pricing ₹35914.56 |
| rt-intl | TBO 402T | P3 | Pricing breakdown adds up | **PASS** | parts ₹35914.56 · total ₹35914.56 |
| rt-intl | TBO 402T | P4 | 1 ADT passenger price = total | **BUG** | pax ₹35722.56 |
| rt-intl | TBO 402T | P5 | If price differs from search, priceChange says so | **PASS** | null |
| rt-intl | TBO 402T | P6 | Pricing currency INR, no negative amounts | **PASS** | INR  |
| rt-intl | TBO 402T | P7 | gstBreakup is array or omitted | **PASS** | object |
| rt-intl | TBO 402T | P8 | No "Riya" in pricing / bookingContext | **PASS** |  |
| rt-intl | TBO 402T | P9 | Pricing itinerary = picked flight(s) | **PASS** |  |
| rt-intl | TBO 402T | SSR1 | SSR HTTP 200 (meal / baggage catalog up) | **PASS** | http=200   |
| rt-intl | TBO 402T | SSR2 | SSR lists meal and/or baggage options | **PASS** | meal keys 5 · baggage keys 1 · top priceId,timingReference,journeyType,tripType,expiresAt,currencyConversion,meal,baggage |
| rt-intl | TBO 402T | SSR3 | SSR prices ≥ 0, no "Riya" | **PASS** |  |
| rt-intl | TBO 402T | SSR4 | SSR prices in INR | **PASS** | {INR} |
| rt-intl | TBO 402T | SEAT1 | Seat map HTTP 200 (not 5xx) | **PASS** | http=200   |
| rt-intl | TBO 402T | SEAT2 | Seat map has seats (pricing says supportsSeats) | **PASS** | 760 seats, 720 available · supportsSeats true |
| rt-intl | TBO 402T | SEAT3 | Seat prices ≥ 0, no "Riya" | **PASS** |  |
| rt-intl | TBO 402T | SEAT3b | Seat prices in INR | **PASS** | INR · conversion {"source":"USD","destination":"INR","rate":96} |
| rt-intl | TBO 402T | SEAT4 | One seat map per flight segment | **PASS** | 4 seat maps · 4 segments (DEL-STV, STV-DXB, SHJ-LKO, LKO-DEL) |
| rt-intl | TBO 402T | SEAT5 | No duplicate seat numbers within a segment | **PASS** |  |
| rt-intl | TBO 402T | SEAT6 | seatAvailability in the common format ("true"/"false") for both providers | **PASS** | seatAvailability {false,true} · seatStatus {false,true} |
| rt-intl | Riya 422R | F0 | Riya 422R fare picked | **PASS** | from merged card · LITE ₹45640 |
| rt-intl | Riya 422R | C6 | Return list non-empty after picking onward | **PASS** | return total 3 |
| rt-intl | Riya 422R | C8 | Return fares only from the onward vendor | **PASS** | got {422R} |
| rt-intl | Riya 422R | C9 | Return card carries combinedPricing COMBINATION | **PASS** | COMBINATION |
| rt-intl | Riya 422R | C11 | Combined price ≥ onward fare and ≠ 2× onward | **PASS** | combined ₹45640 · onward ₹45640 · return fare ₹45640 |
| rt-intl | Riya 422R | D1 | Details HTTP 200 | **PASS** | http=200   |
| rt-intl | Riya 422R | D2 | Details price shown in INR (requested currency=INR) | **PASS** | details INR 45640 |
| rt-intl | Riya 422R | D2b | Details total = search price | **PASS** | search ₹45640 · details ₹45640 |
| rt-intl | Riya 422R | D3 | Details onward = same flight as the search card (FN, airports, times) | **PASS** | IX1294/DEL/2026-12-15T18:50/STV/2026-12-15T20:50>IX335/STV/2026-12-16T07:10/DXB/2026-12-16T08:55 |
| rt-intl | Riya 422R | D6 | Details and pricing agree on seat / meal / baggage support | **CHECK** | supportsSeats details=false pricing=true · supportsMeals details=false pricing=true · supportsExtraBaggage details=false pricing=true |
| rt-intl | Riya 422R | D4 | No negative amounts in details | **PASS** |  |
| rt-intl | Riya 422R | D5 | No "Riya" in details | **PASS** |  |
| rt-intl | Riya 422R | FR1 | Fare rules HTTP 200 with rule content | **PASS** | 1 rule blocks · top keys journeyType,tripType,timingReference,selection,fareRules,cancellationPolicies,reschedulePolicies,_meta |
| rt-intl | Riya 422R | FR2 | One fare-rule block per leg (2) | **BUG** | 1 block(s): I5LT |
| rt-intl | Riya 422R | FR3 | Rules match the picked fare (fare type or fare basis named) | **PASS** | fareType "LITE" · basis ECLAX00 |
| rt-intl | Riya 422R | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-intl | Riya 422R | FR4 | No "Riya" in fare rules | **PASS** |  |
| rt-intl | Riya 422R | FR5 | No negative amounts in fare rules | **PASS** |  |
| rt-intl | Riya 422R | FR7 | Each rule block titled with its route (which leg it covers) | **BUG** | "I5LT" |
| rt-intl | Riya 422R | FR6 | Rule text has no script content (HTML formatting is allowed) | **PASS** | HTML-formatted text |
| rt-intl | Riya 422R | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http=200   |
| rt-intl | Riya 422R | P2 | Pricing total = search price (±₹1) | **PASS** | search ₹45640 · pricing ₹45640 |
| rt-intl | Riya 422R | P3 | Pricing breakdown adds up | **PASS** | parts ₹45640 · total ₹45640 |
| rt-intl | Riya 422R | P4 | 1 ADT passenger price = total | **PASS** | pax ₹45640 |
| rt-intl | Riya 422R | P5 | If price differs from search, priceChange says so | **PASS** | null |
| rt-intl | Riya 422R | P6 | Pricing currency INR, no negative amounts | **PASS** | INR  |
| rt-intl | Riya 422R | P7 | gstBreakup is array or omitted | **PASS** | object |
| rt-intl | Riya 422R | P8 | No "Riya" in pricing / bookingContext | **PASS** |  |
| rt-intl | Riya 422R | P9 | Pricing itinerary = picked flight(s) | **PASS** |  |
| rt-intl | Riya 422R | SSR1 | SSR HTTP 200 (meal / baggage catalog up) | **PASS** | http=200   |
| rt-intl | Riya 422R | SSR2 | SSR lists meal and/or baggage options | **PASS** | meal keys 5 · baggage keys 3 · top priceId,timingReference,journeyType,tripType,expiresAt,currencyConversion,meal,baggage |
| rt-intl | Riya 422R | SSR3 | SSR prices ≥ 0, no "Riya" | **PASS** |  |
| rt-intl | Riya 422R | SSR4 | SSR prices in INR | **PASS** | {INR} |
| rt-intl | Riya 422R | SEAT1 | Seat map HTTP 200 (not 5xx) | **PASS** | http=200   |
| rt-intl | Riya 422R | SEAT2 | Seat map has seats (pricing says supportsSeats) | **PASS** | 736 seats, 725 available · supportsSeats true |
| rt-intl | Riya 422R | SEAT3 | Seat prices ≥ 0, no "Riya" | **PASS** |  |
| rt-intl | Riya 422R | SEAT3b | Seat prices in INR | **PASS** | INR · conversion {"source":"INR","destination":"INR","rate":1} |
| rt-intl | Riya 422R | SEAT4 | One seat map per flight segment | **PASS** | 4 seat maps · 4 segments (DEL-STV, STV-DXB, DXB-LKO, LKO-DEL) |
| rt-intl | Riya 422R | SEAT5 | No duplicate seat numbers within a segment | **PASS** |  |
| rt-intl | Riya 422R | SEAT6 | seatAvailability in the common format ("true"/"false") for both providers | **BUG** | seatAvailability {Closed,Open} · seatStatus {True} |
| neg | Negative | details-empty-ids | details: empty selectedSearchIds → 4xx | **PASS** | http=400 INVALID_SELECTION · ONE_WAY requires exactly 1 selectedSearchId. |
| neg | Negative | details-unknown-id | details: unknown searchId → 4xx (not 500) | **PASS** | http=404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_00000000000000000000000000000000 |
| neg | Negative | details-html-id | details: HTML in searchId → 4xx (not 500) | **PASS** | http=404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: <script>alert(1)</script> |
| neg | Negative | fareRules-empty-ids | fareRules: empty selectedSearchIds → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for fare rules. Please fix the listed errors and retry. |
| neg | Negative | fareRules-unknown-id | fareRules: unknown searchId → 4xx (not 500) | **PASS** | http=404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_00000000000000000000000000000000 |
| neg | Negative | fareRules-html-id | fareRules: HTML in searchId → 4xx (not 500) | **PASS** | http=404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: <script>alert(1)</script> |
| neg | Negative | pricing-empty-ids | pricing: empty selectedSearchIds → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| neg | Negative | pricing-unknown-id | pricing: unknown searchId → 4xx (not 500) | **PASS** | http=404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_00000000000000000000000000000000 |
| neg | Negative | pricing-html-id | pricing: HTML in searchId → 4xx (not 500) | **PASS** | http=404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: <script>alert(1)</script> |
| neg | Negative | pricing-ow-id-as-RT | pricing: one-way searchId sent as ROUND_TRIP → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| neg | Negative | pricing-dup-id | pricing: same searchId twice → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| neg | Negative | pricing-bad-journeyType | pricing: journeyType "ONEWAY" → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| neg | Negative | details-omit-journeyType | details: journeyType missing → 4xx | **PASS** | http=400 INVALID_REQUEST · Request validation failed. |
| neg | Negative | pricing-RT-onward-only | pricing: round trip with onward id only → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| neg | Negative | pricing-RT-mixed-TBO-onward-Riya-return | pricing: TBO onward + Riya return → rejected (cross-vendor RT not bookable) | **PASS** | http=400 INVALID_COMBINATION · Selected flights come from different searches and cannot be booked together. Select onward |
| neg | Negative | fareRules-RT-mixed-vendors | fareRules: TBO onward + Riya return → rejected | **PASS** | http=400 INVALID_COMBINATION · Selected flights come from different searches and cannot be booked together. Select onward |
| neg | Negative | ssr-empty-priceId | ssr: empty priceId → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight SSR. Please fix the listed errors and retry. |
| neg | Negative | ssr-unknown-priceId | ssr: unknown priceId → 4xx (not 500) | **PASS** | http=400 PRICE_ID_NOT_FOUND · No cached pricing context found for priceId: prc_does_not_exist_000 |
| neg | Negative | ssr-html-priceId | ssr: HTML priceId → 4xx | **PASS** | http=400 PRICE_ID_NOT_FOUND · No cached pricing context found for priceId: <b>x</b> |
| neg | Negative | seatmap-omit-requestReference | seatmap: requestReference missing → 4xx | **PASS** | http=400 VALIDATION_ERROR · Invalid request payload for flight seat map. Please fix the listed errors and retry. |
| neg | Negative | seatmap-garbage-requestReference | seatmap: garbage requestReference → 4xx (not 500) | **PASS** | http=400 INVALID_BOOKING_CONTEXT · Invalid bookingContext provided. |
| neg | Negative | seatmap-empty-passengers | seatmap: empty passengers[] → 4xx | **NOT TESTED** | not run |
| all | Not run | E1 | One vendor down | **NOT TESTED** | needs Dev fault injection |
| all | Not run | E2 | One vendor slow | **NOT TESTED** | needs Dev fault injection |
| all | Not run | E3 | Both vendors down | **NOT TESTED** | needs Dev fault injection |
| all | Not run | F1-F5 | Issue ticket / book / payment price | **NOT TESTED** | no booking on preprod |
| all | Not run | D4 | MULTI_CITY never merged | **NOT TESTED** | /v1/flights/search accepts ONE_WAY and ROUND_TRIP only |
| all | Not run | A1/A2 | Single-vendor tiers (known open bug) | **NOT TESTED** | not re-searched to keep looks at 4; open from previous round |
