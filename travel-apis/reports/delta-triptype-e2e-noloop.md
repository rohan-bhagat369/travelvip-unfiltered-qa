# delta-api tripType E2E (no loop)

- 2026-11-04T07:12:44.039Z · https://delta-api.travelvip.ai
- PASS=0 BUG=5 NOT TESTED=0

## Observations
- none

| ID | Rule | Status | Note |
|----|------|--------|------|
| B1 | OW domestic DEL→BOM | BUG | fareRules HTTP 400 tt=null code=VENDOR_ERROR {"error":{"code":"VENDOR_ERROR","message":"Fare rules failed.","details":null,"timestamp":"2026-11-04T07:08:28Z","request_id":"req-1793776107653"},"_meta":{"correlation_id":"3f7cda |
| B2 | RT domestic BOM↔BLR | BUG | NO_LOOP_STOP BR=BR1793776147427801 status=Pending tts=domestic,domestic,domestic,domestic seatmap=200 cancel=null |
| B3 | OW international DEL→DXB | BUG | issue failed VALIDATION_ERROR {"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":["'data.passengers[0]' (Rohan Bhagat) must have a meal selected for DEL-DXB (leg 1, ONWARD); this flight makes meal selectio |
| B4 | RT international DEL↔DXB | BUG | NO_LOOP_STOP BR=BR1793776250315833 status=Pending tts=international,international,international,international seatmap=200 cancel=null |
| H1 | Hotel domestic E2E | BUG | NO_LOOP_STOP BR=BR1793776291471432 status=Pending tts=domestic,domestic,domestic cancel=null |
