# delta-api tripType lowercase

- at: 2026-11-04T07:14:28.372Z
- base: https://delta-api.travelvip.ai
- counts: PASS=33 BUG=0 NOT TESTED=0

| ID | Rule | Status | Note |
|----|------|--------|------|
| F1 | OW domestic DEL→BOM search → tripType=domestic | PASS | HTTP 200 tripType=domestic |
| F2 | RT domestic DEL↔BOM search → tripType=domestic | PASS | HTTP 200 tripType=domestic |
| F3 | OW international DEL→DXB search → tripType=international | PASS | HTTP 200 tripType=international |
| F4 | RT international DEL↔DXB search → tripType=international | PASS | HTTP 200 tripType=international |
| F5a | input tripType=domestic → response domestic | PASS | tt=domestic |
| F5b | input tripType=Domestic → response domestic | PASS | tt=domestic |
| F5c | input tripType=DOMESTIC → response domestic | PASS | tt=domestic |
| F6a | input tripType=international → response international | PASS | tt=international |
| F6b | input tripType=International → response international | PASS | tt=international |
| F6c | input tripType=INTERNATIONAL → response international | PASS | tt=international |
| F7 | DEL→DXB + tripType=domestic → mismatch (lowercase msg) | PASS | TRIP_TYPE_MISMATCH  / tripType domestic requires every airport to be in India; outside India: DXB. |
| F8 | tripType=foo → invalid (lowercase msg) | PASS | INVALID_TRIP_TYPE Unsupported tripType: foo. Supported: domestic, international or empty. / Invalid tripType. Supported values are domestic, international or empty. |
| F9 | DEL→BOM + tripType=international → mismatch | PASS | TRIP_TYPE_MISMATCH  / tripType international requires at least one airport outside India; all airports are in India. |
| F10 | OW domestic → details/fareRules/pricing/SSR/seatmap lowercase | PASS | details:HTTP200/tt=domestic; fareRules:HTTP200/tt=domestic; pricing:HTTP200/tt=domestic; bookingContext.tripType=domestic; ssr:HTTP200/tt=domestic; seatmap:HTTP400/code=VENDOR_UNAVAILABLE (non-blocking) |
| F11 | RT domestic → details/fareRules/pricing/SSR/seatmap lowercase | PASS | details:HTTP200/tt=domestic; fareRules:HTTP200/tt=domestic; pricing:HTTP200/tt=domestic; bookingContext.tripType=domestic; ssr:HTTP200/tt=domestic; seatmap:HTTP400/code=VENDOR_UNAVAILABLE (non-blocking) |
| F12 | OW international → details/fareRules/pricing/SSR/seatmap lowercase | PASS | details:HTTP200/tt=international; fareRules:HTTP200/tt=international; pricing:HTTP200/tt=international; bookingContext.tripType=international; ssr:HTTP200/tt=international; seatmap:HTTP400/code=VENDOR_UNAVAILABLE (non-blocking) |
| F13 | RT international → details/fareRules/pricing/SSR/seatmap lowercase | PASS | details:HTTP200/tt=international; fareRules:HTTP200/tt=international; pricing:HTTP200/tt=international; bookingContext.tripType=international; ssr:HTTP200/tt=international; seatmap:HTTP400/code=VENDOR_UNAVAILABLE (non-blocking) |
| A1 | airports del+domestic → India only | PASS | n=4 |
| A2 | airports dubai+international → list | PASS | n=9 |
| A3 | airports tripType=DOMESTIC accepted | PASS | n=4 |
| A4 | airports tripType=foo → invalid lowercase msg | PASS | INVALID_TRIP_TYPE Unsupported tripType: foo. Supported: domestic, international or empty. / Invalid tripType. Supported values are domestic, international or empty. |
| H1 | autocomplete mumbai domestic → lowercase | PASS | n=4 tt=domestic |
| H1b | autocomplete tripType=Domestic → domestic | PASS | tt=domestic |
| H1c | autocomplete tripType=DOMESTIC → domestic | PASS | tt=domestic |
| H2 | autocomplete dubai+domestic → empty | PASS | empty=true |
| H3 | autocomplete dubai+international → lowercase | PASS | n=7 tt=international |
| H4 | autocomplete tripType=foo → invalid | PASS | INVALID_TRIP_TYPE Unsupported tripType: foo. Supported: domestic, international or empty. / Invalid tripType. Supported values are domestic, international or empty. |
| H5 | listing India city domestic → lowercase | PASS | entity=328605:IN n=10 |
| H6 | India city + international → empty filter | PASS | No hotels: this destination is in India and tripType is international. |
| H7 | Dubai + domestic → empty filter | PASS | No hotels: this destination is outside India and tripType is domestic. |
| H8 | details Indian + domestic lowercase | PASS | hotel=39644515 tt=domestic codes=10 |
| H9 | prebook domestic → 200 lowercase | PASS | tt=domestic code=oD57xdvukcqD+0u6… |
| H10 | prebook wrong side → filtered | PASS | HTTP 200 code=404 |
