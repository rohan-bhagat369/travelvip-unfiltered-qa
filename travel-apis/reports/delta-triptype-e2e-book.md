# delta-api tripType E2E book

- at: 2026-11-04T07:08:26.601Z
- base: https://delta-api.travelvip.ai
- PASS=6 BUG=5 NOT TESTED=0

## Bookings
- H1: BR1793776014890609 status=Pending hotel

## Observations
- [BUG] B3-fareRules: Found UPPERCASE DOMESTIC/INTERNATIONAL in response body

| ID | Rule | Status | Note |
|----|------|--------|------|
| N1 | DEL→DXB + domestic → TRIP_TYPE_MISMATCH lowercase | PASS |  / tripType domestic requires every airport to be in India; outside India: DXB. |
| N2 | tripType=foo → INVALID_TRIP_TYPE lowercase | PASS | Unsupported tripType: foo. Supported: domestic, international or empty. / Invalid tripType. Supported values are domestic, international or empty. |
| E1 | input Domestic → response domestic | PASS | tt=domestic |
| E2 | input DOMESTIC → response domestic | PASS | tt=domestic |
| B1 | E2E OW domestic DEL→BOM book | BUG | pricing HTTP 400 tt=null |
| B2 | E2E RT domestic DEL↔BOM book | BUG | fareRules HTTP 400 tt=null |
| B3 | E2E OW international DEL→DXB book | BUG | pricing HTTP 400 tt=null |
| B4 | E2E RT international DEL↔DXB book | BUG | fareRules HTTP 400 tt=null |
| H0 | Hotel autocomplete DOMESTIC → domestic | PASS | tt=domestic n=4 |
| H1 | Hotel E2E domestic finalize+cancel | BUG | not Confirmed — BR=BR1793776014890609 status=Pending tts=domestic,domestic,domestic cancelHTTP=null |
| A1 | Airports domestic filter still works | PASS | n=4 |
