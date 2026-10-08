# Prod search sanity (no book)

Ran: 2026-09-07T11:49:13.854Z
Env: `https://api-staging.travelvip.ai`

**Score: PASS 13 / BUG 9 / NOT TESTED 0**

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
| 14 | HOTEL_AUTOCOMPLETE | autocomplete q=pune | **BUG** |
| 15 | HOTEL_AUTOCOMPLETE | autocomplete q=mumbai | **BUG** |
| 16 | HOTEL_AUTOCOMPLETE | autocomplete q=dubai | **BUG** |
| 17 | HOTEL_AUTOCOMPLETE | autocomplete q=delhi | **BUG** |
| 18 | HOTEL_AUTOCOMPLETE | autocomplete q=hiltop | **BUG** |
| 19 | HOTEL_AUTOCOMPLETE | autocomplete q=taj | **BUG** |
| 20 | HOTEL_SEARCH | CITY search Mumbai (no book) | **BUG** |
| 21 | HOTEL_SEARCH | CITY search Delhi (no book) | **BUG** |
| 22 | HOTEL_SEARCH | CITY search Dubai (no book) | **BUG** |

## Bugs

- **HOTEL_AUTOCOMPLETE** autocomplete q=pune: HTTP 200 n=0 types= ms=85
- **HOTEL_AUTOCOMPLETE** autocomplete q=mumbai: HTTP 200 n=0 types= ms=48
- **HOTEL_AUTOCOMPLETE** autocomplete q=dubai: HTTP 200 n=0 types= ms=157
- **HOTEL_AUTOCOMPLETE** autocomplete q=delhi: HTTP 200 n=0 types= ms=59
- **HOTEL_AUTOCOMPLETE** autocomplete q=hiltop: HTTP 200 n=0 types= ms=103
- **HOTEL_AUTOCOMPLETE** autocomplete q=taj: HTTP 200 n=0 types= ms=139
- **HOTEL_SEARCH** CITY search Mumbai (no book): HTTP 200 total=0 page1=0 brand=absent ms=352
- **HOTEL_SEARCH** CITY search Delhi (no book): HTTP 200 total=0 page1=0 brand=absent ms=133
- **HOTEL_SEARCH** CITY search Dubai (no book): HTTP 200 total=0 page1=0 brand=absent ms=75
