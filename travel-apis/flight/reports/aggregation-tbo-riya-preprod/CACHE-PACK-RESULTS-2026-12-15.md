# Aggregation pack — capture once, scored from cache

Env `https://preprod-api.travelvip.ai` · captured **2026-11-24T09:05Z** · dates **2026-12-15** / **2026-12-22** · no book
L2B: 44 search HTTP calls (incl. polls, pages, selections) · 2 details · 2 pricing · 0 booking

## Summary: 62 PASS · 8 BUG · 15 NOT TESTED

| Sec | Case | How tested | Status | Notes |
|---|---|---|---|---|
| H | H1 | One pinned date pair for whole pack | **PASS** | 2026-12-15 / 2026-12-22 |
| H | H2 | Tier comparison on same OD+dates | **PASS** | DEL-DXB all tiers same capture |
| H | H3 | Only DEL-DXB and DEL-BOM | **PASS** |  |
| H | H4 | No booking endpoint called | **PASS** | search=44 details=2 pricing=2 |
| H | H5 | Search time to the minute recorded | **PASS** | 2026-11-24T09:03 |
| H | H6 | Extra pages served from the same cached search | **PASS** | cacheTimeStamp 1795510999104; pages=4 |
| H | H7 | Session JWT carries the requested tier | **PASS** | 8→8 15→15 22101801→22101801 22157551→22157551 |
| A | A1 | Tier 22157551 OW: CODES == {402T} | **BUG** | got {402T,422R} |
| A | A2 | Tier 8 OW: CODES == {422R} | **BUG** | got {402T,422R} |
| A | A2b | Tier 15 OW: CODES == {422R} | **BUG** | got {402T,422R} |
| A | A3 | Tier 22101801 OW: CODES == {402T,422R} | **PASS** | got {402T,422R} |
| A | A4 | ∃ option with both vendor codes | **PASS** | 135 dual cards of 235 |
| A | A5 | No fare with null sourceCode (all captures) | **PASS** | nulls=0 |
| A | A5b | No third sourceCode | **PASS** |  |
| B | B1 | No duplicate scheduleKey (full ONWARD list) | **PASS** | N=235 dupes=0 |
| B | B2 | displayPrice == min(fares) ∀ cards | **PASS** | 235 cards |
| B | B3 | N(merged) >= max(N(TBO), N(Riya)) | **NOT TESTED** | blocked by A1/A2 — single tiers are not single-vendor (totals M=235 T=235 R8=235) |
| B | B4 | N(merged) <= N(TBO) + N(Riya) | **NOT TESTED** | blocked by A1/A2 |
| B | B5 | Airline facet case-unique | **PASS** | 17 airlines |
| B | B6 | sortby=fare,asc non-decreasing over full list | **PASS** | 235 cards / 5 pages |
| B | B7 | Paging perpage=50: no dup searchId and concat == totalResults | **PASS** | concat=235 total=235 dupIds=0 |
| B | B8 | All fare totals > 0 | **PASS** | bad=0 |
| B | B-N1 | Display price is a real selectable fare (never higher) | **PASS** | phantom=0 |
| B | B9 | Dual card = same physical flight on both vendor tiers | **NOT TESTED** | blocked by A1/A2 — single tiers return the merged list, so cross-check is circular |
| A | A-N6 | Tiers do not share one search cache (searchIds / cacheTimeStamp differ) | **BUG** | tier 22157551 and 22101801 returned identical searchIds, cacheTimeStamp 2026-11-24T09:03:19.104Z |
| B | B10 | No fare dropped on merge | **NOT TESTED** | blocked by A1/A2 — single-tier cards already mixed |
| B | B11 | Merged card price never dearer than either vendor alone | **NOT TESTED** | blocked by A1/A2 |
| C | C1 | DEL-DXB directions ONWARD+RETURN non-empty | **PASS** | onward=116 return=111 |
| C | C2 | DEL-DXB no option with empty fares[] | **PASS** | empty=0 (page 0, 50+50 cards) |
| C | C3 | DEL-DXB CODES == {402T,422R} | **PASS** | got {402T,422R} |
| C | C4 | DEL-DXB fareType non-null | **PASS** | null=0 |
| C | C5 | DEL-DXB displayPrice == min(fares) | **PASS** | mismatch=0 |
| C | C6 | DEL-DXB RETURN non-empty after selection | **PASS** | 8/8 |
| C | C7 | DEL-DXB N(RETURN after) <= before [totalResults] | **PASS** | 5,3,3,4,2,12,12,12 |
| C | C8 | DEL-DXB RETURN codes == selected onward code (mixed = fail) | **PASS** | 402T→{402T} 422R→{422R} 422R→{422R} 402T→{402T} 402T→{402T} 422R→{422R} 422R→{422R} 422R→{422R} |
| C | C9 | DEL-DXB ∃ RETURN combinedPricing.type == COMBINATION | **PASS** | 8/8 |
| C | C10 | DEL-DXB combined != 2 × onward fare | **PASS** | 8/8 |
| C | C11 | DEL-DXB combined >= onward fare | **PASS** | 8/8 |
| C | C12 | C6–C11 for each fare on one card + 3 other cards | **PASS** | 8 selections: card1-cheapest, card1-dearest, card1-riya, card1-fare, card1-fare, card-252b07, card-3c588b, card-775f80 |
| C | C14 | Cheapest vs dearest onward fare → single-vendor returns | **PASS** |  |
| C | C15 | TBO onward → TBO returns; Riya onward → Riya returns | **PASS** | tbo={402T} riya={422R} |
| D | D5 | Selection request: len(CODES) == 1 (whole response, per doc) | **PASS** | {402T} {422R} {422R} {402T} {402T} {422R} {422R} {422R} |
| D | D5b | Selection request: RETURN single vendor | **PASS** | 8/8 |
| C | C13-C1 | DEL-BOM directions ONWARD+RETURN non-empty | **PASS** | onward=190 return=182 |
| C | C13-C2 | DEL-BOM no option with empty fares[] | **PASS** | empty=0 (page 0, 50+50 cards) |
| C | C13-C3 | DEL-BOM CODES == {402T,422R} | **BUG** | got {422R} |
| C | C13-C4 | DEL-BOM fareType non-null | **PASS** | null=0 |
| C | C13-C5 | DEL-BOM displayPrice == min(fares) | **PASS** | mismatch=0 |
| C | C13-C6 | DEL-BOM RETURN non-empty after selection | **PASS** | 1/1 |
| C | C13-C7 | DEL-BOM N(RETURN after) <= before [totalResults] | **PASS** | 182 |
| C | C13-C8 | DEL-BOM RETURN codes == selected onward code (mixed = fail) | **PASS** | 422R→{422R} |
| C | C13-C9 | DEL-BOM ∃ RETURN combinedPricing.type == COMBINATION | **PASS** | 1/1 |
| C | C13-C10 | DEL-BOM combined != 2 × onward fare | **PASS** | 1/1 |
| C | C13-C11 | DEL-BOM combined >= onward fare | **PASS** | 1/1 |
| D | D1-22157551 | tier 22157551 RT: no empty fares[] | **PASS** | empty=0 |
| D | D2-22157551 | tier 22157551 RT: len(CODES) == 1 | **BUG** | got {402T,422R} |
| D | D3-22157551 | tier 22157551 selection → RETURN non-empty | **PASS** | return=5 |
| D | D1-8 | tier 8 RT: no empty fares[] | **PASS** | empty=0 |
| D | D2-8 | tier 8 RT: len(CODES) == 1 | **BUG** | got {402T,422R} |
| D | D3-8 | tier 8 selection → RETURN non-empty | **PASS** | return=5 |
| D | D1-15 | tier 15 RT: no empty fares[] | **PASS** | empty=0 |
| D | D2-15 | tier 15 RT: len(CODES) == 1 | **BUG** | got {402T,422R} |
| D | D3-15 | tier 15 selection → RETURN non-empty | **PASS** | return=5 |
| D | D4 | MULTI_CITY merged: len(CODES) == 1 | **NOT TESTED** | B2B /v1/flights/search rejects MULTI_CITY: Invalid trip type 'MULTI_CITY'. Allowed values are ONE_WAY and ROUND_TRIP. |
| P | DET-422R | details 422R HTTP 200 | **PASS** | http=200  |
| P | PRI-422R | pricing 422R HTTP 200 | **PASS** | http=200   |
| P | F5p-422R | search total == pricing total (422R) | **PASS** | search=19850 pricing=19850 |
| P | DET-402T | details 402T HTTP 200 | **PASS** | http=200  |
| P | PRI-402T | pricing 402T HTTP 200 | **PASS** | http=200   |
| P | F5p-402T | search total == pricing total (402T) | **PASS** | search=20280 pricing=20280 |
| G | G1 | past-date | **PASS** | http=400 VALIDATION_ERROR |
| G | G2 | return-before-onward | **PASS** | http=400 VALIDATION_ERROR |
| G | G3 | zero-adults | **PASS** | http=400 VALIDATION_ERROR |
| G | G4 | empty-body | **PASS** | http=400 VALIDATION_ERROR |
| G | G5 | bad-page | **PASS** | http=400 INVALID_PAGINATION |
| G | G10 | No "Riya" string in any captured response | **PASS** |  |
| G | G9 | Merged first-hit time not several × single (flag > 3×) | **NOT TESTED** | merged served from the cache the TBO-tier search built (merged=379ms, first single=14446ms) — not comparable |
| E | E1 | One vendor down | **NOT TESTED** | needs Dev fault injection |
| E | E2 | One vendor slow | **NOT TESTED** | needs Dev fault injection |
| E | E3 | Both vendors down | **NOT TESTED** | needs Dev fault injection |
| F | F1 | OW book 422R | **NOT TESTED** | no booking on preprod (by instruction) |
| F | F2 | OW book 402T | **NOT TESTED** | no booking on preprod (by instruction) |
| F | F3 | RT book | **NOT TESTED** | no booking on preprod (by instruction) |
| F | F4 | single-tier RT book | **NOT TESTED** | no booking on preprod (by instruction) |
| F | F5 | search == payment price | **NOT TESTED** | no booking on preprod (by instruction) |

Cache: `travel-apis\flight\reports\aggregation-tbo-riya-preprod\cache-2026-12-15_2026-12-22`
