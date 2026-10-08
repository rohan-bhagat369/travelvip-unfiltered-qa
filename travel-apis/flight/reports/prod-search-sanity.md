# Prod search sanity (no book)

Ran: 2026-09-07T11:20:59.407Z
Env: `https://api.travelvip.ai`

**Score: PASS 22 / BUG 0 / NOT TESTED 0**

| # | Section | Rule | Status |
|---|---------|------|--------|
| 1 | FLIGHT_AIRPORT | airport=BOM → BOM | **PASS** |
| 2 | FLIGHT_AIRPORT | airport=DEL → DEL | **PASS** |
| 3 | FLIGHT_AIRPORT | airport=BLR → BLR | **PASS** |
| 4 | FLIGHT_AIRPORT | airport=bombay → BOM | **PASS** |
| 5 | FLIGHT_AIRPORT | airport=delhi → DEL | **PASS** |
| 6 | FLIGHT_AIRPORT | Blank airport → 400 MISSING_AIRPORT | **PASS** |
| 7 | FLIGHT_CITY | citySearch q=Pune | **PASS** |
| 8 | FLIGHT_CITY | citySearch q=Mumbai | **PASS** |
| 9 | FLIGHT_CITY | citySearch q=Dubai | **PASS** |
| 10 | FLIGHT_CITY | citySearch q=Delhi | **PASS** |
| 11 | FLIGHT_CITY | citySearch q=Bangkok | **PASS** |
| 12 | FLIGHT_AIRLINE | airlines AI | **PASS** |
| 13 | FLIGHT_SEARCH | OW DEL→BOM 2027-01-15 (no book) | **PASS** |
| 14 | HOTEL_AUTOCOMPLETE | autocomplete q=pune | **PASS** |
| 15 | HOTEL_AUTOCOMPLETE | autocomplete q=mumbai | **PASS** |
| 16 | HOTEL_AUTOCOMPLETE | autocomplete q=dubai | **PASS** |
| 17 | HOTEL_AUTOCOMPLETE | autocomplete q=delhi | **PASS** |
| 18 | HOTEL_AUTOCOMPLETE | autocomplete q=hiltop | **PASS** |
| 19 | HOTEL_AUTOCOMPLETE | autocomplete q=taj | **PASS** |
| 20 | HOTEL_SEARCH | CITY search Mumbai (no book) | **PASS** |
| 21 | HOTEL_SEARCH | CITY search Delhi (no book) | **PASS** |
| 22 | HOTEL_SEARCH | CITY search Dubai (no book) | **PASS** |
