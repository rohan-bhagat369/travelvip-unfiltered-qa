# Aggregation — full no-book suite (search → pricing, SSR, seat map)

Env `https://preprod-api.travelvip.ai` · captured **2026-11-24T09:56Z** · dates **2026-12-15** / **2026-12-22** · correlation `db5edb9e-2183-481a-a7b4-3fe09e36dae2`
Scenario searches: **13** · HTTP: search 127 · details 38 · fareRules 13 · pricing 24 · ssr 10 · seatmap 10 · **booking 0**

## Summary: 386 PASS · 51 BUG · 13 CHECK · 15 NOT TESTED

| Area | Case | How tested | Status | Notes |
|---|---|---|---|---|
| L2B & process | H1 | Each scenario searched once (13 scenarios), fixed dates | **PASS** | 13 scenario searches · 2026-12-15 / 2026-12-22 |
| L2B & process | H2 | No booking / ticket / cancel call | **PASS** | search HTTP 127 · details 38 · fareRules 13 · pricing 24 · ssr 10 · seatmap 10 |
| L2B & process | H3 | Pages / sorts / filters served from the cached search (no new look) | **PASS** | 54 calls · 0 fresh |
| L2B & process | H4 | Session token carries the requested tier | **PASS** | 8→8 15→15 22101801→22101801 22157551→22157551 |
| L2B & process | G9 | First search response ≤ 20 s per scenario | **PASS** | tier22157551-ow-intl 781ms · tier22157551-rt-intl 703ms · tier8-ow-intl 540ms · tier8-rt-intl 493ms · tier15-ow-intl 474ms · tier15-rt-intl 460ms · ow-dom 558ms · ow-intl 1389ms · rt-dom 556ms · rt-intl 812ms · x-multipa |
| Routing by tier | A1 | Tier 22157551 one-way shows only 402T | **BUG** | got {402T,422R} · total 235 |
| Routing by tier | D2-22157551 | Tier 22157551 round trip shows one supplier | **BUG** | got {402T,422R} |
| Routing by tier | D1-22157551 | Tier 22157551 round trip: no card without fares | **PASS** | empty=0 |
| Routing by tier | D3-22157551 | Tier 22157551 round trip: return list after choosing outbound | **PASS** | return 5 |
| Routing by tier | A-N6-22157551 | Tier 22157551 gets its own search result (not the merged tier's cache) | **BUG** | identical searchIds + cacheTimeStamp 1795512389751 |
| Routing by tier | A2 | Tier 8 one-way shows only 422R | **BUG** | got {402T,422R} · total 235 |
| Routing by tier | D2-8 | Tier 8 round trip shows one supplier | **BUG** | got {402T,422R} |
| Routing by tier | D1-8 | Tier 8 round trip: no card without fares | **PASS** | empty=0 |
| Routing by tier | D3-8 | Tier 8 round trip: return list after choosing outbound | **PASS** | return 5 |
| Routing by tier | A-N6-8 | Tier 8 gets its own search result (not the merged tier's cache) | **BUG** | identical searchIds + cacheTimeStamp 1795512389751 |
| Routing by tier | A2b | Tier 15 one-way shows only 422R | **BUG** | got {402T,422R} · total 235 |
| Routing by tier | D2-15 | Tier 15 round trip shows one supplier | **BUG** | got {402T,422R} |
| Routing by tier | D1-15 | Tier 15 round trip: no card without fares | **PASS** | empty=0 |
| Routing by tier | D3-15 | Tier 15 round trip: return list after choosing outbound | **PASS** | return 5 |
| Routing by tier | A-N6-15 | Tier 15 gets its own search result (not the merged tier's cache) | **BUG** | identical searchIds + cacheTimeStamp 1795512389751 |
| Routing by tier | B3 | Merged count ≥ each single supplier | **NOT TESTED** | blocked by A1/A2 (M=235 T=235 R=235) |
| Routing by tier | B4 | Merged count ≤ TBO + Riya (merging actually removes duplicates) | **NOT TESTED** | blocked by A1/A2 |
| Search ow-dom | S0 | HTTP 200 and progress COMPLETE | **PASS** | polls 1 · onward 208 |
| Search ow-dom | A3 | Both suppliers present | **PASS** | {402T,422R} |
| Search ow-dom | A4 | Merged cards exist (both suppliers on one card) | **PASS** | 153/208 |
| Search ow-dom | A5 | Every fare has sourceCode 402T / 422R only | **PASS** | 1594 fares |
| Search ow-dom | B1 | No duplicate flight cards (same flight on two cards) | **PASS** | 208 cards |
| Search ow-dom | B2 | Card price = cheapest fare on the card | **PASS** | 208 cards |
| Search ow-dom | B12 | Card price equals a real selectable fare | **PASS** |  |
| Search ow-dom | E-1stop | Connecting (multi-segment) flights merge only when every leg matches | **PASS** | 88 merged multi-segment cards (all segments shared by both suppliers by construction) |
| Search ow-dom | B6 | Cheapest first across all pages | **PASS** |  |
| Search ow-dom | B7 | All pages together = totalResults, no repeats | **PASS** | 208 vs 208 over 5 pages |
| Search ow-dom | B8 | Every fare total > 0 | **PASS** |  |
| Search ow-dom | PX1 | Fare breakdown adds up | **PASS** |  |
| Search ow-dom | PX2 | All fares in INR | **PASS** |  |
| Search ow-dom | C4 | fareType on every fare | **PASS** |  |
| Search ow-dom | E-dupfare | No identical fare listed twice inside a card | **BUG** | 59 cards e.g. srch_96e2750b171a4677abddecf0bf2707d6 |
| Search ow-dom | E-tie | Both suppliers same lowest price → card still shows that price | **NOT TESTED** | 0 tie cards |
| Search ow-dom | M-N1 | Same flight number at a different time stays a separate card | **NOT TESTED** | no such pair in inventory |
| Search ow-dom | M-N2 | Codeshare (same times, different flight numbers) stays as separate cards | **PASS** | 6 groups, e.g. QP1116 vs AI2977 |
| Search ow-dom | M-N3 | Direct and connecting flights never merged together | **PASS** | both shapes present as separate cards |
| Search ow-dom | G10 | No "Riya" text | **PASS** |  |
| Search ow-dom | AP1 | Only DEL/BOM airports returned | **CHECK** | 20 cards on nearby airports: DEL>NMI×15, HDO>BOM×2, DXN>BOM×3 |
| Search ow-dom | SORT-stops-asc | sortby=stops,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,0 |
| Search ow-dom | SORT-stops-asc-merge | Merge still applied with sortby=stops,asc | **PASS** | total 208 vs 208 |
| Search ow-dom | SORT-duration-asc | sortby=duration,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,0 |
| Search ow-dom | SORT-duration-asc-merge | Merge still applied with sortby=duration,asc | **PASS** | total 208 vs 208 |
| Search ow-dom | FIL-airline | Airline filter "Air India" | **PASS** | total 94 of 208 · wrong cards 0 · merged cards kept 35 |
| Search ow-dom | FIL-airline-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 154 · list shows 94 |
| Search ow-dom | FIL-stops0 | Stops filter Non-Stop | **PASS** | total 70 of 208 · wrong cards 0 · merged cards kept 50 |
| Search ow-dom | FIL-stops0-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 135 · list shows 70 |
| Search ow-dom | FIL-refundable | Refundable filter | **PASS** | total 208 of 208 · wrong cards 0 · merged cards kept 48 |
| Search ow-dom | FIL-refundable-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 360 · list shows 208 |
| Search ow-dom | FIL-price | Price range 6648–17405 | **PASS** | total 155 of 208 · wrong cards 0 · merged cards kept 48 |
| Search ow-dom | FIL-fareType | Fare type "Value" (fares inside cards reduced) | **PASS** | total 24 of 208 · wrong cards 0 · merged cards kept 24 |
| Search ow-dom | FIL-fareType-count | Filter-panel count = flights shown after filtering | **PASS** | panel says 24 · list shows 24 |
| Search ow-dom | FIL-combo | Airline "Air India" + Non-Stop together | **PASS** | total 26 of 208 · wrong cards 0 · merged cards kept 26 |
| Search ow-dom | FIL-panel | Filter-panel counts add up to the number of flights (after merge) | **BUG** | stops counts add to 361 · flights 208 · equals cards counted once per supplier (counted before merge) |
| Search ow-dom | FIL-names | Airline names identical in the filter panel and on flight cards | **BUG** | panel "Air India Express" vs card "AIR INDIA EXPRESS" (1 airlines) |
| Search ow-dom | FIL-priceEmpty | Price range ₹1–₹2 → empty list, not an error | **PASS** | http 200 · total 0  |
| Search ow-dom | FIL-priceInverted | Price range min > max → 4xx or empty, never 500 | **PASS** | http 200 · total 0  |
| Search ow-dom | FIL-unknownAirline | Unknown airline → empty list, not an error | **PASS** | http 200 · total 0  |
| Search ow-dom | FIL-facets | Filter facets stay full after a filter is applied | **PASS** | 6 vs 5 airlines |
| Search ow-dom | B5 | Airline filter names case-unique | **PASS** |  |
| Search ow-dom | M-P1 | Merged card = same physical flight at both suppliers (details compared) | **PASS** | 5/5 cards match |
| Search ow-dom | M-P2 | Formatting differences between suppliers are ignored (flight no. / seconds) | **PASS** | e.g. TBO "IX 1235" 2026-12-15T20:40:00 vs Riya "IX 1235" 2026-12-15T20:40 |
| ow-dom TBO | D1 | Details HTTP 200 | **PASS** | http 200  |
| ow-dom TBO | D2 | Details currency (TBO USD is expected) | **PASS** | USD 72.01 |
| ow-dom TBO | D2b | Details total = search price (after currency conversion) | **PASS** | USD 72.01 × 96 = ₹6912.96 vs ₹6912.96 |
| ow-dom TBO | D3 | Details = same flight as the card | **PASS** |  |
| ow-dom TBO | D4 | No negative amounts · no "Riya" | **PASS** |  |
| ow-dom TBO | FR1 | Fare rules returned with content | **PASS** | 1 block(s) |
| ow-dom TBO | FR2 | One rule block per leg | **PASS** | Fare Rules IX DEL-BOM |
| ow-dom TBO | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | Value / GNRA000 |
| ow-dom TBO | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-dom TBO | FR4 | No "Riya" · no script content | **PASS** |  |
| ow-dom TBO | FR7 | Rule titles name the route | **PASS** | "Fare Rules IX DEL-BOM" |
| ow-dom TBO | P1 | Pricing HTTP 200 with priceId + bookingContext | **BUG** | http 400 VENDOR_ERROR Pricing failed. |
| ow-dom Riya | D1 | Details HTTP 200 | **PASS** | http 200  |
| ow-dom Riya | D2 | Details currency (TBO USD is expected) | **PASS** | INR 6648 |
| ow-dom Riya | D2b | Details total = search price (after currency conversion) | **PASS** | INR 6648 × 1 = ₹6648.00 vs ₹6648 |
| ow-dom Riya | D3 | Details = same flight as the card | **PASS** |  |
| ow-dom Riya | D4 | No negative amounts · no "Riya" | **PASS** |  |
| ow-dom Riya | D6 | Details and pricing agree on seat/meal/baggage support | **CHECK** | supportsSeats false→true supportsMeals false→true supportsExtraBaggage false→true |
| ow-dom Riya | FR1 | Fare rules returned with content | **PASS** | 1 block(s) |
| ow-dom Riya | FR2 | One rule block per leg | **PASS** | I5E |
| ow-dom Riya | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | VALUE / GNRA000 |
| ow-dom Riya | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-dom Riya | FR4 | No "Riya" · no script content | **PASS** |  |
| ow-dom Riya | FR7 | Rule titles name the route | **BUG** | "I5E" |
| ow-dom Riya | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http 200   |
| ow-dom Riya | P2 | Pricing total = search price | **PASS** | ₹6648 vs ₹6648 |
| ow-dom Riya | P3 | Pricing breakdown adds up | **PASS** |  |
| ow-dom Riya | P4 | Passenger prices add up to the total | **PASS** | pax ₹6648 vs total ₹6648 |
| ow-dom Riya | P6 | INR, no negative amounts, gstBreakup array/omitted | **PASS** |  |
| ow-dom Riya | P8 | No "Riya" in pricing | **PASS** |  |
| ow-dom Riya | SSR1 | SSR HTTP 200 | **PASS** | http 200  |
| ow-dom Riya | SSR2 | Meal / baggage options listed | **PASS** |  |
| ow-dom Riya | SSR3 | SSR prices ≥ 0, INR, no "Riya" | **PASS** |  |
| ow-dom Riya | SEAT1 | Seat map HTTP 200 | **PASS** | http 200   |
| ow-dom Riya | SEAT2 | Seats listed, one map per flight segment | **PASS** | 189 seats · 1 maps / 1 segments |
| ow-dom Riya | SEAT3 | Seat prices ≥ 0, INR, no duplicates, no "Riya" | **PASS** |  |
| ow-dom Riya | SEAT6 | seatAvailability in this supplier's format (Open/Closed) | **PASS** | {Closed,Open} |
| Search ow-intl | S0 | HTTP 200 and progress COMPLETE | **PASS** | polls 1 · onward 235 |
| Search ow-intl | A3 | Both suppliers present | **PASS** | {402T,422R} |
| Search ow-intl | A4 | Merged cards exist (both suppliers on one card) | **PASS** | 134/235 |
| Search ow-intl | A5 | Every fare has sourceCode 402T / 422R only | **PASS** | 1589 fares |
| Search ow-intl | B1 | No duplicate flight cards (same flight on two cards) | **PASS** | 235 cards |
| Search ow-intl | B2 | Card price = cheapest fare on the card | **PASS** | 235 cards |
| Search ow-intl | B12 | Card price equals a real selectable fare | **PASS** |  |
| Search ow-intl | E-1stop | Connecting (multi-segment) flights merge only when every leg matches | **PASS** | 120 merged multi-segment cards (all segments shared by both suppliers by construction) |
| Search ow-intl | B6 | Cheapest first across all pages | **PASS** |  |
| Search ow-intl | B7 | All pages together = totalResults, no repeats | **PASS** | 235 vs 235 over 5 pages |
| Search ow-intl | B8 | Every fare total > 0 | **PASS** |  |
| Search ow-intl | PX1 | Fare breakdown adds up | **PASS** |  |
| Search ow-intl | PX2 | All fares in INR | **PASS** |  |
| Search ow-intl | C4 | fareType on every fare | **PASS** |  |
| Search ow-intl | E-dupfare | No identical fare listed twice inside a card | **BUG** | 54 cards e.g. srch_e944d5df6aa94e99bc589e7761385926 |
| Search ow-intl | E-tie | Both suppliers same lowest price → card still shows that price | **NOT TESTED** | 0 tie cards |
| Search ow-intl | M-N1 | Same flight number at a different time stays a separate card | **PASS** | 3 flight numbers with ≥2 time variants, e.g. DEL2026-12-15T07:10-SHJ2026-12-15T09:50 / DEL2026-12-15T07:40-SHJ2026-12-15T10:20 |
| Search ow-intl | M-N2 | Codeshare (same times, different flight numbers) stays as separate cards | **NOT TESTED** | no codeshare pair in inventory |
| Search ow-intl | M-N3 | Direct and connecting flights never merged together | **PASS** | both shapes present as separate cards |
| Search ow-intl | G10 | No "Riya" text | **PASS** |  |
| Search ow-intl | AP1 | Only DEL/DXB airports returned | **CHECK** | 100 cards on nearby airports: DEL>RKT×6, DEL>SHJ×31, DEL>AUH×23, DEL>FJR×4, DEL>XNB×31, DXN>AUH×3, HDO>AUH×1, HDO>DXB×1 |
| Search ow-intl | SORT-stops-asc | sortby=stops,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,0 |
| Search ow-intl | SORT-stops-asc-merge | Merge still applied with sortby=stops,asc | **PASS** | total 235 vs 235 |
| Search ow-intl | SORT-duration-asc | sortby=duration,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,0 |
| Search ow-intl | SORT-duration-asc-merge | Merge still applied with sortby=duration,asc | **PASS** | total 235 vs 235 |
| Search ow-intl | FIL-airline | Airline filter "IndiGo" | **PASS** | total 38 of 235 · wrong cards 0 · merged cards kept 0 |
| Search ow-intl | FIL-airline-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 91 · list shows 38 |
| Search ow-intl | FIL-stops0 | Stops filter Non-Stop | **PASS** | total 19 of 235 · wrong cards 0 · merged cards kept 14 |
| Search ow-intl | FIL-stops0-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 33 · list shows 19 |
| Search ow-intl | FIL-refundable | Refundable filter | **PASS** | total 168 of 235 · wrong cards 0 · merged cards kept 14 |
| Search ow-intl | FIL-refundable-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 245 · list shows 168 |
| Search ow-intl | FIL-price | Price range 19850–127535 | **PASS** | total 213 of 235 · wrong cards 0 · merged cards kept 30 |
| Search ow-intl | FIL-fareType | Fare type "Lite" (fares inside cards reduced) | **PASS** | total 20 of 235 · wrong cards 0 · merged cards kept 16 |
| Search ow-intl | FIL-fareType-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 16 · list shows 20 |
| Search ow-intl | FIL-combo | Airline "IndiGo" + Non-Stop together | **PASS** | total 3 of 235 · wrong cards 0 · merged cards kept 0 |
| Search ow-intl | FIL-panel | Filter-panel counts add up to the number of flights (after merge) | **BUG** | stops counts add to 369 · flights 235 · equals cards counted once per supplier (counted before merge) |
| Search ow-intl | FIL-names | Airline names identical in the filter panel and on flight cards | **BUG** | panel "Air India Express" vs card "AIR INDIA EXPRESS" (1 airlines) |
| Search ow-intl | FIL-priceEmpty | Price range ₹1–₹2 → empty list, not an error | **PASS** | http 200 · total 0  |
| Search ow-intl | FIL-priceInverted | Price range min > max → 4xx or empty, never 500 | **PASS** | http 200 · total 0  |
| Search ow-intl | FIL-unknownAirline | Unknown airline → empty list, not an error | **PASS** | http 200 · total 0  |
| Search ow-intl | FIL-facets | Filter facets stay full after a filter is applied | **CHECK** | 16 vs 17 airlines |
| Search ow-intl | B5 | Airline filter names case-unique | **PASS** |  |
| Search ow-intl | M-P1 | Merged card = same physical flight at both suppliers (details compared) | **PASS** | 5/5 cards match |
| Search ow-intl | M-P2 | Formatting differences between suppliers are ignored (flight no. / seconds) | **PASS** | e.g. TBO "IX 1294" 2026-12-15T18:50:00 vs Riya "IX 1294" 2026-12-15T18:50 |
| ow-intl TBO | D1 | Details HTTP 200 | **PASS** | http 200  |
| ow-intl TBO | D2 | Details currency (TBO USD is expected) | **PASS** | USD 211.25 |
| ow-intl TBO | D2b | Details total = search price (after currency conversion) | **PASS** | USD 211.25 × 96 = ₹20280.00 vs ₹20280 |
| ow-intl TBO | D3 | Details = same flight as the card | **PASS** |  |
| ow-intl TBO | D4 | No negative amounts · no "Riya" | **PASS** |  |
| ow-intl TBO | D6 | Details and pricing agree on seat/meal/baggage support | **CHECK** | supportsSeats false→true supportsMeals false→true supportsExtraBaggage false→true |
| ow-intl TBO | FR1 | Fare rules returned with content | **PASS** | 1 block(s) |
| ow-intl TBO | FR2 | One rule block per leg | **PASS** | Fare Rules IX DEL-DXB |
| ow-intl TBO | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | Lite / ECLAX00 |
| ow-intl TBO | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-intl TBO | FR4 | No "Riya" · no script content | **PASS** |  |
| ow-intl TBO | FR7 | Rule titles name the route | **PASS** | "Fare Rules IX DEL-DXB" |
| ow-intl TBO | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http 200   |
| ow-intl TBO | P2 | Pricing total = search price | **PASS** | ₹20280 vs ₹20280 |
| ow-intl TBO | P3 | Pricing breakdown adds up | **PASS** |  |
| ow-intl TBO | P4 | Passenger prices add up to the total | **BUG** | pax ₹20088 vs total ₹20280 |
| ow-intl TBO | P6 | INR, no negative amounts, gstBreakup array/omitted | **PASS** |  |
| ow-intl TBO | P8 | No "Riya" in pricing | **PASS** |  |
| ow-intl TBO | SSR1 | SSR HTTP 200 | **PASS** | http 200  |
| ow-intl TBO | SSR2 | Meal / baggage options listed | **PASS** |  |
| ow-intl TBO | SSR3 | SSR prices ≥ 0, INR, no "Riya" | **PASS** |  |
| ow-intl TBO | SEAT1 | Seat map HTTP 200 | **PASS** | http 200   |
| ow-intl TBO | SEAT2 | Seats listed, one map per flight segment | **PASS** | 408 seats · 2 maps / 2 segments |
| ow-intl TBO | SEAT3 | Seat prices ≥ 0, INR, no duplicates, no "Riya" | **PASS** |  |
| ow-intl TBO | SEAT6 | seatAvailability in this supplier's format (true/false) | **PASS** | {false,true} |
| ow-intl Riya | D1 | Details HTTP 200 | **PASS** | http 200  |
| ow-intl Riya | D2 | Details currency (TBO USD is expected) | **PASS** | INR 19850 |
| ow-intl Riya | D2b | Details total = search price (after currency conversion) | **PASS** | INR 19850 × 1 = ₹19850.00 vs ₹19850 |
| ow-intl Riya | D3 | Details = same flight as the card | **PASS** |  |
| ow-intl Riya | D4 | No negative amounts · no "Riya" | **PASS** |  |
| ow-intl Riya | D6 | Details and pricing agree on seat/meal/baggage support | **CHECK** | supportsSeats false→true supportsMeals false→true supportsExtraBaggage false→true |
| ow-intl Riya | FR1 | Fare rules returned with content | **PASS** | 1 block(s) |
| ow-intl Riya | FR2 | One rule block per leg | **PASS** | I5LT |
| ow-intl Riya | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | LITE / ECLAX00 |
| ow-intl Riya | FR3b | Rules state cancellation / change charges | **PASS** |  |
| ow-intl Riya | FR4 | No "Riya" · no script content | **PASS** |  |
| ow-intl Riya | FR7 | Rule titles name the route | **BUG** | "I5LT" |
| ow-intl Riya | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http 200   |
| ow-intl Riya | P2 | Pricing total = search price | **PASS** | ₹19850 vs ₹19850 |
| ow-intl Riya | P3 | Pricing breakdown adds up | **PASS** |  |
| ow-intl Riya | P4 | Passenger prices add up to the total | **PASS** | pax ₹19850 vs total ₹19850 |
| ow-intl Riya | P6 | INR, no negative amounts, gstBreakup array/omitted | **PASS** |  |
| ow-intl Riya | P8 | No "Riya" in pricing | **PASS** |  |
| ow-intl Riya | SSR1 | SSR HTTP 200 | **PASS** | http 200  |
| ow-intl Riya | SSR2 | Meal / baggage options listed | **PASS** |  |
| ow-intl Riya | SSR3 | SSR prices ≥ 0, INR, no "Riya" | **PASS** |  |
| ow-intl Riya | SEAT1 | Seat map HTTP 200 | **PASS** | http 200   |
| ow-intl Riya | SEAT2 | Seats listed, one map per flight segment | **PASS** | 400 seats · 2 maps / 2 segments |
| ow-intl Riya | SEAT3 | Seat prices ≥ 0, INR, no duplicates, no "Riya" | **PASS** |  |
| ow-intl Riya | SEAT6 | seatAvailability in this supplier's format (Open/Closed) | **PASS** | {Closed,Open} |
| Search rt-dom | S0 | HTTP 200 and progress COMPLETE | **PASS** | polls 1 · onward 190 · return 186 |
| Search rt-dom | A3 | Both suppliers present | **PASS** | {402T,422R} |
| Search rt-dom | A3r | Both suppliers present on RETURN too | **PASS** | {402T,422R} |
| Search rt-dom | A4 | Merged cards exist (both suppliers on one card) | **PASS** | 27/50 |
| Search rt-dom | A5 | Every fare has sourceCode 402T / 422R only | **PASS** | 521 fares |
| Search rt-dom | B1 | No duplicate flight cards (same flight on two cards) | **PASS** | 50 cards |
| Search rt-dom | B1r | No duplicate flight cards on RETURN | **PASS** |  |
| Search rt-dom | B2 | Card price = cheapest fare on the card | **PASS** | 100 cards |
| Search rt-dom | B12 | Card price equals a real selectable fare | **PASS** |  |
| Search rt-dom | E-1stop | Connecting (multi-segment) flights merge only when every leg matches | **PASS** | 2 merged multi-segment cards (all segments shared by both suppliers by construction) |
| Search rt-dom | B6 | Cheapest first across page 0 | **PASS** |  |
| Search rt-dom | B7 | Page 1 has no repeats from page 0 | **PASS** | page1 onward 50 return 50 · overlap 0 |
| Search rt-dom | B8 | Every fare total > 0 | **PASS** |  |
| Search rt-dom | PX1 | Fare breakdown adds up | **PASS** |  |
| Search rt-dom | PX2 | All fares in INR | **PASS** |  |
| Search rt-dom | C4 | fareType on every fare | **PASS** |  |
| Search rt-dom | E-dupfare | No identical fare listed twice inside a card | **BUG** | 12 cards e.g. srch_2b889dc73c444a418820368b54aadd18 |
| Search rt-dom | E-tie | Both suppliers same lowest price → card still shows that price | **NOT TESTED** | 0 tie cards |
| Search rt-dom | M-N1 | Same flight number at a different time stays a separate card | **NOT TESTED** | no such pair in inventory |
| Search rt-dom | M-N2 | Codeshare (same times, different flight numbers) stays as separate cards | **PASS** | 3 groups, e.g. 6E395 vs AI2999 |
| Search rt-dom | M-N3 | Direct and connecting flights never merged together | **PASS** | both shapes present as separate cards |
| Search rt-dom | G10 | No "Riya" text | **PASS** |  |
| Search rt-dom | AP1 | Only DEL/BOM airports returned | **CHECK** | 26 cards on nearby airports: DEL>NMI×10, BOM>DXN×2, NMI>DEL×8, BOM>HDO×1, HDO>BOM×2, DXN>BOM×3 |
| Search rt-dom | SORT-stops-asc | sortby=stops,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,0 |
| Search rt-dom | SORT-stops-asc-merge | Merge still applied with sortby=stops,asc | **PASS** | total 190 vs 190 |
| Search rt-dom | SORT-duration-asc | sortby=duration,asc orders cards correctly | **PASS** | http 200 · first 115,120,125,125,135,135 |
| Search rt-dom | SORT-duration-asc-merge | Merge still applied with sortby=duration,asc | **PASS** | total 190 vs 190 |
| Search rt-dom | FIL-airline | Airline filter "Air India" | **PASS** | total 81 of 190 · wrong cards 0 · merged cards kept 13 |
| Search rt-dom | FIL-airline-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 94 · list shows 81 |
| Search rt-dom | FIL-stops0 | Stops filter Non-Stop | **PASS** | total 65 of 190 · wrong cards 0 · merged cards kept 30 |
| Search rt-dom | FIL-stops0-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 96 · list shows 65 |
| Search rt-dom | FIL-refundable | Refundable filter | **PASS** | total 189 of 190 · wrong cards 0 · merged cards kept 28 |
| Search rt-dom | FIL-refundable-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 222 · list shows 189 |
| Search rt-dom | FIL-price | Price range 6648–15706 | **PASS** | total 139 of 190 · wrong cards 0 · merged cards kept 15 |
| Search rt-dom | FIL-fareType | Fare type "Return" (fares inside cards reduced) | **PASS** | total 5 of 190 · wrong cards 0 · merged cards kept 0 |
| Search rt-dom | FIL-fareType-count | Filter-panel count = flights shown after filtering | **PASS** | panel says 5 · list shows 5 |
| Search rt-dom | FIL-combo | Airline "Air India" + Non-Stop together | **PASS** | total 26 of 190 · wrong cards 0 · merged cards kept 13 |
| Search rt-dom | FIL-panel | Filter-panel counts add up to the number of flights (after merge) | **NOT TESTED** | RT page 0 only |
| Search rt-dom | FIL-names | Airline names identical in the filter panel and on flight cards | **BUG** | panel "Air India Express" vs card "AIR INDIA EXPRESS" (2 airlines) |
| Search rt-dom | FIL-priceEmpty | Price range ₹1–₹2 → empty list, not an error | **PASS** | http 200 · total 0  |
| Search rt-dom | FIL-priceInverted | Price range min > max → 4xx or empty, never 500 | **PASS** | http 200 · total 0  |
| Search rt-dom | FIL-unknownAirline | Unknown airline → empty list, not an error | **PASS** | http 200 · total 0  |
| Search rt-dom | FIL-facets | Filter facets stay full after a filter is applied | **PASS** | 4 vs 4 airlines |
| Search rt-dom | B5 | Airline filter names case-unique | **PASS** |  |
| Search rt-dom | C6 | Return list not empty after choosing outbound (every fare on the merged card) | **BUG** | 2/6 selections gave 0 returns: 402T Value ₹13900.8, 402T Classic ₹14539.2 |
| Search rt-dom | C7 | Return list shrinks or stays (never grows) | **PASS** |  |
| Search rt-dom | C8 | Returns only from the chosen outbound supplier (mixed = fail) | **PASS** | 402T→{402T} 422R→{422R} 422R→{422R} 422R→{422R} |
| Search rt-dom | C9 | Return cards carry COMBINATION price | **PASS** |  |
| Search rt-dom | C10 | Combined price ≠ 2 × outbound fare | **PASS** |  |
| Search rt-dom | C11 | Combined price ≥ outbound fare | **PASS** |  |
| Search rt-dom | C12 | C6–C11 repeated for several fares on the merged card | **BUG** | 6 selections (402T Return, 422R VALUE, 422R CLASSIC, 422R FLEX, 402T Value, 402T Classic) |
| Search rt-dom | C15 | TBO outbound → TBO returns · Riya outbound → Riya returns | **PASS** |  |
| Search rt-dom | D5 | Selection request: whole response single supplier (doc wording) | **PASS** | ONWARD still lists both suppliers after selection: 0/6 — confirm doc intent (RETURN-only is C8) |
| rt-dom TBO | D1 | Details HTTP 200 | **PASS** | http 200  |
| rt-dom TBO | D2 | Details currency (TBO USD is expected) | **PASS** | USD 142.82 |
| rt-dom TBO | D2b | Details total = search price (after currency conversion) | **PASS** | USD 142.82 × 96 = ₹13710.72 vs ₹13710.72 |
| rt-dom TBO | D3 | Details = same flight as the card | **PASS** |  |
| rt-dom TBO | D3r | Details includes the return leg | **PASS** | 2 legs |
| rt-dom TBO | D4 | No negative amounts · no "Riya" | **PASS** |  |
| rt-dom TBO | FR1 | Fare rules returned with content | **PASS** | 2 block(s) |
| rt-dom TBO | FR2 | One rule block per leg | **PASS** | Fare Rules IX DEL-BOM / Fare Rules IX NMI-DEL |
| rt-dom TBO | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | Return / GNNA000 |
| rt-dom TBO | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-dom TBO | FR4 | No "Riya" · no script content | **PASS** |  |
| rt-dom TBO | FR7 | Rule titles name the route | **PASS** | "Fare Rules IX DEL-BOM" "Fare Rules IX NMI-DEL" |
| rt-dom TBO | P1 | Pricing HTTP 200 with priceId + bookingContext | **BUG** | http 400 VENDOR_ERROR Pricing failed. |
| rt-dom Riya | D1 | Details HTTP 200 | **PASS** | http 200  |
| rt-dom Riya | D2 | Details currency (TBO USD is expected) | **PASS** | INR 13012 |
| rt-dom Riya | D2b | Details total = search price (after currency conversion) | **PASS** | INR 13012 × 1 = ₹13012.00 vs ₹13012 |
| rt-dom Riya | D3 | Details = same flight as the card | **PASS** |  |
| rt-dom Riya | D3r | Details includes the return leg | **PASS** | 2 legs |
| rt-dom Riya | D4 | No negative amounts · no "Riya" | **PASS** |  |
| rt-dom Riya | D6 | Details and pricing agree on seat/meal/baggage support | **CHECK** | supportsSeats false→true supportsMeals false→true supportsExtraBaggage false→true |
| rt-dom Riya | FR1 | Fare rules returned with content | **PASS** | 1 block(s) |
| rt-dom Riya | FR2 | One rule block per leg | **BUG** | I5E |
| rt-dom Riya | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | VALUE / GNRA000 |
| rt-dom Riya | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-dom Riya | FR4 | No "Riya" · no script content | **PASS** |  |
| rt-dom Riya | FR7 | Rule titles name the route | **BUG** | "I5E" |
| rt-dom Riya | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http 200   |
| rt-dom Riya | P2 | Pricing total = search price | **PASS** | ₹13012 vs ₹13012 |
| rt-dom Riya | P3 | Pricing breakdown adds up | **PASS** |  |
| rt-dom Riya | P4 | Passenger prices add up to the total | **PASS** | pax ₹13012 vs total ₹13012 |
| rt-dom Riya | P6 | INR, no negative amounts, gstBreakup array/omitted | **PASS** |  |
| rt-dom Riya | P8 | No "Riya" in pricing | **PASS** |  |
| rt-dom Riya | SSR1 | SSR HTTP 200 | **PASS** | http 200  |
| rt-dom Riya | SSR2 | Meal / baggage options listed | **PASS** |  |
| rt-dom Riya | SSR3 | SSR prices ≥ 0, INR, no "Riya" | **PASS** |  |
| rt-dom Riya | SEAT1 | Seat map HTTP 200 | **BUG** | http 502 UPSTREAM_API_ERROR Something went wrong. Please try again. |
| Search rt-intl | S0 | HTTP 200 and progress COMPLETE | **PASS** | polls 1 · onward 116 · return 111 |
| Search rt-intl | A3 | Both suppliers present | **PASS** | {402T,422R} |
| Search rt-intl | A3r | Both suppliers present on RETURN too | **PASS** | {402T,422R} |
| Search rt-intl | A4 | Merged cards exist (both suppliers on one card) | **PASS** | 19/50 |
| Search rt-intl | A5 | Every fare has sourceCode 402T / 422R only | **PASS** | 338 fares |
| Search rt-intl | B1 | No duplicate flight cards (same flight on two cards) | **PASS** | 50 cards |
| Search rt-intl | B1r | No duplicate flight cards on RETURN | **PASS** |  |
| Search rt-intl | B2 | Card price = cheapest fare on the card | **PASS** | 100 cards |
| Search rt-intl | B12 | Card price equals a real selectable fare | **PASS** |  |
| Search rt-intl | E-1stop | Connecting (multi-segment) flights merge only when every leg matches | **PASS** | 15 merged multi-segment cards (all segments shared by both suppliers by construction) |
| Search rt-intl | B6 | Cheapest first across page 0 | **PASS** |  |
| Search rt-intl | B7 | Page 1 has no repeats from page 0 | **PASS** | page1 onward 50 return 50 · overlap 0 |
| Search rt-intl | B8 | Every fare total > 0 | **PASS** |  |
| Search rt-intl | PX1 | Fare breakdown adds up | **PASS** |  |
| Search rt-intl | PX2 | All fares in INR | **PASS** |  |
| Search rt-intl | C4 | fareType on every fare | **PASS** |  |
| Search rt-intl | E-dupfare | No identical fare listed twice inside a card | **PASS** |  |
| Search rt-intl | E-tie | Both suppliers same lowest price → card still shows that price | **NOT TESTED** | 0 tie cards |
| Search rt-intl | M-N1 | Same flight number at a different time stays a separate card | **NOT TESTED** | no such pair in inventory |
| Search rt-intl | M-N2 | Codeshare (same times, different flight numbers) stays as separate cards | **NOT TESTED** | no codeshare pair in inventory |
| Search rt-intl | M-N3 | Direct and connecting flights never merged together | **PASS** | both shapes present as separate cards |
| Search rt-intl | G10 | No "Riya" text | **PASS** |  |
| Search rt-intl | AP1 | Only DEL/DXB airports returned | **CHECK** | 80 cards on nearby airports: DEL>RKT×4, DEL>SHJ×8, DEL>AUH×8, DEL>FJR×2, DEL>XNB×19, SHJ>DEL×5, AUH>DEL×5, FJR>DEL×2, RKT>DEL×4, XNB>DEL×21, DXB>DXN×1, HDO>DXB×1 |
| Search rt-intl | SORT-stops-asc | sortby=stops,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,0 |
| Search rt-intl | SORT-stops-asc-merge | Merge still applied with sortby=stops,asc | **PASS** | total 116 vs 116 |
| Search rt-intl | SORT-duration-asc | sortby=duration,asc orders cards correctly | **PASS** | http 200 · first 0,0,0,0,0,230 |
| Search rt-intl | SORT-duration-asc-merge | Merge still applied with sortby=duration,asc | **PASS** | total 116 vs 116 |
| Search rt-intl | FIL-airline | Airline filter "IndiGo" | **PASS** | total 14 of 116 · wrong cards 0 · merged cards kept 0 |
| Search rt-intl | FIL-airline-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 27 · list shows 14 |
| Search rt-intl | FIL-stops0 | Stops filter Non-Stop | **PASS** | total 15 of 116 · wrong cards 0 · merged cards kept 9 |
| Search rt-intl | FIL-stops0-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 24 · list shows 15 |
| Search rt-intl | FIL-refundable | Refundable filter | **PASS** | total 75 of 116 · wrong cards 0 · merged cards kept 16 |
| Search rt-intl | FIL-refundable-count | Filter-panel count = flights shown after filtering | **BUG** | panel says 100 · list shows 75 |
| Search rt-intl | FIL-price | Price range 35914.56–101469 | **PASS** | total 95 of 116 · wrong cards 0 · merged cards kept 19 |
| Search rt-intl | FIL-fareType | Fare type "Lite" (fares inside cards reduced) | **PASS** | total 12 of 116 · wrong cards 0 · merged cards kept 4 |
| Search rt-intl | FIL-fareType-count | Filter-panel count = flights shown after filtering | **PASS** | panel says 12 · list shows 12 |
| Search rt-intl | FIL-combo | Airline "IndiGo" + Non-Stop together | **PASS** | total 2 of 116 · wrong cards 0 · merged cards kept 0 |
| Search rt-intl | FIL-panel | Filter-panel counts add up to the number of flights (after merge) | **NOT TESTED** | RT page 0 only |
| Search rt-intl | FIL-names | Airline names identical in the filter panel and on flight cards | **BUG** | panel "Air India" vs card "AIR INDIA" (1 airlines) |
| Search rt-intl | FIL-priceEmpty | Price range ₹1–₹2 → empty list, not an error | **PASS** | http 200 · total 0  |
| Search rt-intl | FIL-priceInverted | Price range min > max → 4xx or empty, never 500 | **PASS** | http 200 · total 0  |
| Search rt-intl | FIL-unknownAirline | Unknown airline → empty list, not an error | **PASS** | http 200 · total 0  |
| Search rt-intl | FIL-facets | Filter facets stay full after a filter is applied | **PASS** | 15 vs 15 airlines |
| Search rt-intl | B5 | Airline filter names case-unique | **PASS** |  |
| Search rt-intl | C6 | Return list not empty after choosing outbound (every fare on the merged card) | **BUG** | 2/6 selections gave 0 returns: 402T Value ₹37912.32, 402T Classic ₹41075.52 |
| Search rt-intl | C7 | Return list shrinks or stays (never grows) | **PASS** |  |
| Search rt-intl | C8 | Returns only from the chosen outbound supplier (mixed = fail) | **PASS** | 402T→{402T} 422R→{422R} 422R→{422R} 422R→{422R} |
| Search rt-intl | C9 | Return cards carry COMBINATION price | **PASS** |  |
| Search rt-intl | C10 | Combined price ≠ 2 × outbound fare | **PASS** |  |
| Search rt-intl | C11 | Combined price ≥ outbound fare | **PASS** |  |
| Search rt-intl | C12 | C6–C11 repeated for several fares on the merged card | **BUG** | 6 selections (402T Lite, 422R LITE, 402T Value, 402T Classic, 422R VALUE, 422R CLASSIC) |
| Search rt-intl | C15 | TBO outbound → TBO returns · Riya outbound → Riya returns | **PASS** |  |
| Search rt-intl | D5 | Selection request: whole response single supplier (doc wording) | **PASS** | ONWARD still lists both suppliers after selection: 0/6 — confirm doc intent (RETURN-only is C8) |
| rt-intl TBO | D1 | Details HTTP 200 | **PASS** | http 200  |
| rt-intl TBO | D2 | Details currency (TBO USD is expected) | **PASS** | USD 374.11 |
| rt-intl TBO | D2b | Details total = search price (after currency conversion) | **PASS** | USD 374.11 × 96 = ₹35914.56 vs ₹35914.56 |
| rt-intl TBO | D3 | Details = same flight as the card | **PASS** |  |
| rt-intl TBO | D3r | Details includes the return leg | **PASS** | 2 legs |
| rt-intl TBO | D4 | No negative amounts · no "Riya" | **PASS** |  |
| rt-intl TBO | FR1 | Fare rules returned with content | **PASS** | 2 block(s) |
| rt-intl TBO | FR2 | One rule block per leg | **PASS** | Fare Rules IX DEL-DXB / Fare Rules IX SHJ-DEL |
| rt-intl TBO | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | Lite / ECLAX00 |
| rt-intl TBO | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-intl TBO | FR4 | No "Riya" · no script content | **PASS** |  |
| rt-intl TBO | FR7 | Rule titles name the route | **PASS** | "Fare Rules IX DEL-DXB" "Fare Rules IX SHJ-DEL" |
| rt-intl TBO | P1 | Pricing HTTP 200 with priceId + bookingContext | **BUG** | http 400 VENDOR_ERROR Pricing failed. |
| rt-intl Riya | D1 | Details HTTP 200 | **PASS** | http 200  |
| rt-intl Riya | D2 | Details currency (TBO USD is expected) | **PASS** | INR 45640 |
| rt-intl Riya | D2b | Details total = search price (after currency conversion) | **PASS** | INR 45640 × 1 = ₹45640.00 vs ₹45640 |
| rt-intl Riya | D3 | Details = same flight as the card | **PASS** |  |
| rt-intl Riya | D3r | Details includes the return leg | **PASS** | 2 legs |
| rt-intl Riya | D4 | No negative amounts · no "Riya" | **PASS** |  |
| rt-intl Riya | D6 | Details and pricing agree on seat/meal/baggage support | **CHECK** | supportsSeats false→true supportsMeals false→true supportsExtraBaggage false→true |
| rt-intl Riya | FR1 | Fare rules returned with content | **PASS** | 1 block(s) |
| rt-intl Riya | FR2 | One rule block per leg | **BUG** | I5LT |
| rt-intl Riya | FR3 | Rules match the chosen fare (type or basis named) | **PASS** | LITE / ECLAX00 |
| rt-intl Riya | FR3b | Rules state cancellation / change charges | **PASS** |  |
| rt-intl Riya | FR4 | No "Riya" · no script content | **PASS** |  |
| rt-intl Riya | FR7 | Rule titles name the route | **BUG** | "I5LT" |
| rt-intl Riya | P1 | Pricing HTTP 200 with priceId + bookingContext | **PASS** | http 200   |
| rt-intl Riya | P2 | Pricing total = search price | **PASS** | ₹45640 vs ₹45640 |
| rt-intl Riya | P3 | Pricing breakdown adds up | **PASS** |  |
| rt-intl Riya | P4 | Passenger prices add up to the total | **PASS** | pax ₹45640 vs total ₹45640 |
| rt-intl Riya | P6 | INR, no negative amounts, gstBreakup array/omitted | **PASS** |  |
| rt-intl Riya | P8 | No "Riya" in pricing | **PASS** |  |
| rt-intl Riya | SSR1 | SSR HTTP 200 | **PASS** | http 200  |
| rt-intl Riya | SSR2 | Meal / baggage options listed | **PASS** |  |
| rt-intl Riya | SSR3 | SSR prices ≥ 0, INR, no "Riya" | **PASS** |  |
| rt-intl Riya | SEAT1 | Seat map HTTP 200 | **BUG** | http 400 VENDOR_UNAVAILABLE Flight provider is temporarily unavailable. |
| Multi-passenger 2ADT+1CHD+1INF | MP1 | Search OK, both suppliers, merged cards | **PASS** | 206 cards · 47 merged on page 0 |
| Multi-passenger 2ADT+1CHD+1INF | MP2 | Card price = cheapest fare | **PASS** |  |
| Multi-passenger 2ADT+1CHD+1INF | MP3 | Group price is higher than the 1-adult price for the same flight | **PASS** | 20 flights compared |
| Multi-passenger 2ADT+1CHD+1INF | MP-402T-P1 | 402T pricing lists ADT, CHD, INF | **PASS** | ADT,ADT,CHD,INF |
| Multi-passenger 2ADT+1CHD+1INF | MP-402T-P2 | 402T per-passenger prices add up to total (2×ADT + CHD + INF) | **BUG** | sum ₹22642.56 vs total ₹26675.52 |
| Multi-passenger 2ADT+1CHD+1INF | MP-402T-P3 | 402T pricing total = search price | **PASS** | ₹26675.52 vs ₹26675.52 |
| Multi-passenger 2ADT+1CHD+1INF | MP-402T-P4 | 402T infant cheaper than adult | **PASS** | INF ₹2066.88 · ADT ₹6858.24 |
| Multi-passenger 2ADT+1CHD+1INF | MP-422R-P1 | 422R pricing lists ADT, CHD, INF | **PASS** | ADT,ADT,CHD,INF |
| Multi-passenger 2ADT+1CHD+1INF | MP-422R-P2 | 422R per-passenger prices add up to total (2×ADT + CHD + INF) | **PASS** | sum ₹21954 vs total ₹21954 |
| Multi-passenger 2ADT+1CHD+1INF | MP-422R-P3 | 422R pricing total = search price | **PASS** | ₹21954 vs ₹21954 |
| Multi-passenger 2ADT+1CHD+1INF | MP-422R-P4 | 422R infant cheaper than adult | **PASS** | INF ₹2010 · ADT ₹6648 |
| Business cabin | BZ1 | Only Business cabin returned | **PASS** | 142 cards · cabins {BUSINESS} |
| Business cabin | BZ2 | Merged cards in Business (both suppliers) | **PASS** | {402T,422R} · 50 merged |
| Business cabin | M-N4 | Same flight in Business and Economy never merged into one card | **PASS** |  |
| Business cabin | BZ3 | Card price = cheapest fare · no duplicate cards | **PASS** |  |
| Corporate fare | CO1 | Corporate search returns cards | **PASS** | 179 cards · categories {CORPORATE,} · suppliers {402T,422R} |
| Corporate fare | CO2 | Merged cards with corporate fares | **CHECK** | 0 merged |
| Corporate fare | CO3 | Card price = cheapest fare · no duplicate cards | **PASS** |  |
| Paging boundaries (ow-dom) | PG1 | Last page: short page, rest of the list | **PASS** | 8 cards |
| Paging boundaries (ow-dom) | PG2 | Page 9999 → empty list, HTTP 200, not an error | **PASS** | http 200 · 0 cards  |
| Paging boundaries (ow-dom) | PG3 | perpage=1 → exactly 1 card (cheapest) | **PASS** | http 200 · 1 cards |
| Paging boundaries (ow-dom) | PG-perpage0 | perpage=0 → 4xx | **CHECK** | http 200 208 cards — treated as "return everything" (doc uses size=-1 for all); confirm 0 should do the same |
| Paging boundaries (ow-dom) | PG-perpageNeg | perpage=-1 → 4xx | **CHECK** | http 200 208 cards — treated as "return everything" (doc uses size=-1 for all); confirm 0 should do the same |
| Paging boundaries (ow-dom) | PG-abc | page=abc → 4xx | **PASS** | http 400 INTERNAL_SERVER_ERROR |
| Paging boundaries (ow-dom) | PG4 | perpage=500 → capped or full list, never 500 | **PASS** | http 200 · 208 cards of 208  |
| Negative & edge | S-same-od | Search: origin = destination → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-bad-iata | Search: unknown airport code → 4xx | **PASS** | http 400 INVALID_AIRPORT · Unknown airport code: XQZ |
| Negative & edge | S-lowercase-iata | Search: lowercase airport "del" → accepted or 4xx, never 500 | **PASS** | http 200 accepted · 50 cards |
| Negative & edge | S-past-date | Search: past date → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-date-bad-format | Search: date DD-MM-YYYY → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-date-400d | Search: date > 1 year away → 4xx or empty | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-adults-0 | Search: 0 adults → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-adults-10 | Search: 10 adults (> 9) → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-adults-string | Search: adults "1" (string) → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-infants-gt-adults | Search: infants > adults → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-children-neg | Search: children -1 → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-cabin-bad | Search: cabin "CABIN_X" → 4xx | **PASS** | http 400 INVALID_REQUEST · Unsupported cabinClass: CABIN_X |
| Negative & edge | S-fareType-bad | Search: fareType "GARBAGE" → 4xx | **PASS** | http 400 INVALID_FARE_TYPE · Unsupported fareType: GARBAGE. Supported: SME, senior_citizen, NORMAL, defence, flexi_canc |
| Negative & edge | S-journeyType-bad | Search: journeyType "ONEWAY" → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-multicity | Search: MULTI_CITY → 4xx (not supported on this API) | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-rt-one-leg | Search: ROUND_TRIP with one leg → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-rt-return-before | Search: return before outbound → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-html-dest | Search: HTML in airport → 4xx | **PASS** | http 400 INVALID_AIRPORT · Invalid airport code: <B>BOM</B> |
| Negative & edge | S-empty-body | Search: empty body → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-omit-itinerary | Search: itinerary missing → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight search. Please fix the listed errors and retry. |
| Negative & edge | S-selection-unknown-id | Search: selection with unknown searchId → 4xx | **PASS** | http 400 INVALID_SELECTION · selection is supported only for ROUND_TRIP journeyType. |
| Negative & edge | AUTH-no-bearer | Search without session token → 401/403 | **PASS** | http 403 INVALID_PARTNER_KEY · Invalid or missing partner key |
| Negative & edge | AUTH-garbage-bearer | Search with garbage session token → 401/403 | **PASS** | http 403 INVALID_PARTNER_KEY · Invalid or missing partner key |
| Negative & edge | details-empty-ids | details: empty selectedSearchIds → 4xx | **PASS** | http 400 INVALID_SELECTION · ONE_WAY requires exactly 1 selectedSearchId. |
| Negative & edge | details-unknown-id | details: unknown searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_00000000000000000000000000000000 |
| Negative & edge | details-html-id | details: HTML searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: <script>alert(1)</script> |
| Negative & edge | details-comma-id | details: searchId with trailing comma → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_0b015f3035884b3098d233a3a617c07b, |
| Negative & edge | fareRules-empty-ids | fareRules: empty selectedSearchIds → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for fare rules. Please fix the listed errors and retry. |
| Negative & edge | fareRules-unknown-id | fareRules: unknown searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_00000000000000000000000000000000 |
| Negative & edge | fareRules-html-id | fareRules: HTML searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: <script>alert(1)</script> |
| Negative & edge | fareRules-comma-id | fareRules: searchId with trailing comma → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_0b015f3035884b3098d233a3a617c07b, |
| Negative & edge | pricing-empty-ids | pricing: empty selectedSearchIds → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| Negative & edge | pricing-unknown-id | pricing: unknown searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_00000000000000000000000000000000 |
| Negative & edge | pricing-html-id | pricing: HTML searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: <script>alert(1)</script> |
| Negative & edge | pricing-comma-id | pricing: searchId with trailing comma → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_0b015f3035884b3098d233a3a617c07b, |
| Negative & edge | pricing-ow-id-as-RT | pricing: one-way id sent as ROUND_TRIP → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| Negative & edge | pricing-dup-id | pricing: same id twice → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| Negative & edge | pricing-bad-journeyType | pricing: journeyType "ONEWAY" → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| Negative & edge | details-omit-journeyType | details: journeyType missing → 4xx | **PASS** | http 400 INVALID_REQUEST · Request validation failed. |
| Negative & edge | pricing-RT-onward-only | pricing: round trip with outbound id only → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight pricing. Please fix the listed errors and retry. |
| Negative & edge | pricing-RT-swapped-order | pricing: round trip ids in reverse order (return first) → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_b244beaf7e8d43e3b407578b1a6a39af |
| Negative & edge | pricing-OW-with-return-id | pricing: return-leg id priced as one-way → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_b244beaf7e8d43e3b407578b1a6a39af |
| Negative & edge | pricing-RT-two-onward-ids | pricing: two outbound ids as a round trip → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_64f1601dc7c843b1af61dd4580901be7 |
| Negative & edge | SEL-search-two-onward-ids | search: selection with two outbound ids → 4xx | **PASS** | http 400 INVALID_SELECTION · search supports only a single selected searchId. |
| Negative & edge | SEL-search-return-id-as-onward | search: return id used as the outbound selection → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · Selected searchId not found in cache: srch_b244beaf7e8d43e3b407578b1a6a39af |
| Negative & edge | pricing-RT-mixed-TBO-onward-Riya-return | pricing: TBO outbound + Riya return → rejected | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_64f1601dc7c843b1af61dd4580901be7 |
| Negative & edge | fareRules-RT-mixed-vendors | fareRules: TBO outbound + Riya return → rejected | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_64f1601dc7c843b1af61dd4580901be7 |
| Negative & edge | details-RT-mixed-vendors | details: TBO outbound + Riya return → rejected | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_64f1601dc7c843b1af61dd4580901be7 |
| Negative & edge | XTIER-details-merged-id-in-TBO-session | details: merged-tier id used in a TBO-only session → rejected | **BUG** | http 200 accepted · 0 cards |
| Negative & edge | XTIER-pricing-merged-id-in-Riya8-session | pricing: merged-tier id used in a Riya-only session → rejected | **BUG** | http 200 accepted · 0 cards |
| Negative & edge | EXP-details-expired-id | details: expired searchId (from 2026-11-23) → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_627d7ab39fa34733b2bdd901d93b5268 |
| Negative & edge | EXP-pricing-expired-id | pricing: expired searchId → 4xx | **PASS** | http 404 SEARCH_ID_NOT_FOUND · No cached search context found for searchId: srch_627d7ab39fa34733b2bdd901d93b5268 |
| Negative & edge | EXP-ssr-expired-priceId | ssr: expired priceId → 4xx | **PASS** | http 400 PRICE_ID_NOT_FOUND · No cached pricing context found for priceId: price_dc01ae311c164259a0d212b06d1253e2 |
| Negative & edge | EXP-seatmap-expired-context | seatmap: expired bookingContext → 4xx | **PASS** | http 400 VENDOR_UNAVAILABLE · Flight provider is temporarily unavailable. |
| Negative & edge | ssr-empty-priceId | ssr: empty priceId → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight SSR. Please fix the listed errors and retry. |
| Negative & edge | ssr-unknown-priceId | ssr: unknown priceId → 4xx | **PASS** | http 400 PRICE_ID_NOT_FOUND · No cached pricing context found for priceId: prc_does_not_exist_000 |
| Negative & edge | ssr-html-priceId | ssr: HTML priceId → 4xx | **PASS** | http 400 PRICE_ID_NOT_FOUND · No cached pricing context found for priceId: <b>x</b> |
| Negative & edge | ssr-omit-priceId | ssr: priceId missing → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight SSR. Please fix the listed errors and retry. |
| Negative & edge | seatmap-omit-requestReference | seatmap: requestReference missing → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight seat map. Please fix the listed errors and retry. |
| Negative & edge | seatmap-garbage-requestReference | seatmap: garbage requestReference → 4xx | **PASS** | http 400 INVALID_BOOKING_CONTEXT · Invalid bookingContext provided. |
| Negative & edge | seatmap-empty-passengers | seatmap: empty passengers → 4xx | **PASS** | http 400 VALIDATION_ERROR · Invalid request payload for flight seat map. Please fix the listed errors and retry. |
| Negative & edge | seatmap-html-name | seatmap: HTML in passenger name → 4xx | **BUG** | http 200 accepted · 0 cards |
| Negative & edge | NO-500 | No negative case returned HTTP 5xx | **PASS** |  |
| Not run | E1-E3 | Supplier down / slow / both down | **NOT TESTED** | needs Dev fault injection |
| Not run | F1-F5 | Issue ticket, PNR, price at payment | **NOT TESTED** | no booking on preprod |
