# Nova vs Canary — Live booking compare

**When:** 2026-11-25T11:18:24.395Z
**Auth:** native

| Product | Canary | Node | Verdict |
|---------|--------|------|---------|
| hotel | OK BR=BR1795605207767193 status=Failed | FAIL 500 | **NODE_FAILED** |
| cab | OK BR=BR1795605243448415 status=Pending | OK BR=BR1795605288595474 status=Confirmed | **PASS_BOTH_BOOKED** |
| flight | FAIL NO_BOOKING_CONTEXT | OK BR=BR1795605457232366 status=Confirmed | **CANARY_FAILED** |

## Details

### Hotel
- Canary: http=200 br=BR1795605207767193 status=Failed err=-
  - sample: `{"status":"Pending","statusCode":200,"bookingRefId":"BR1795605207767193","_meta":{"correlation_id":"book-1795605206933-wrk0a"}}`
- Node: http=500 br=- status=500 err=-
  - sample: `{"status":500,"info":"Internal Server Error"}`
- Request keys: `bookingContext, bookingCode, requestId, checkin, checkout, rooms, contact`

### Cab
- Canary: http=200 br=BR1795605243448415 status=Pending err=-
  - sample: `{"status":"Pending","statusCode":200,"bookingRefId":"BR1795605243448415","_meta":{"correlation_id":"book-1795605243131-plcvl"}}`
- Node: http=200 br=BR1795605288595474 status=Confirmed err=-
  - sample: `{"status":"Pending","statusCode":200,"bookingRefId":"BR1795605288595474","_meta":{"correlation_id":"book-1795605288108-rkgoe"}}`
- Request keys: `bookingReference, priceId, passengers, contact, otherDetails`

### Flight
- Canary: http=undefined br=- status=- err=NO_BOOKING_CONTEXT
  - sample: `{"product":"flight","label":"CANARY","base":"https://canary-api.travelvip.ai","ok":false,"error":"NO_BOOKING_CONTEXT","searchId":"srch_28b95130b7db434db831f3764cdde397","steps":[{"step":"search","route":"DEL-BOM","date":"2026-12-15","status":400,"code":"NO_FLIGHTS_FOUND","progress":null,"searchId":false},{"step":"search","route":"DEL-BOM","date":"2026-12-20","status":200,"code":null,"progress":"INPROGRESS","searchId":true},{"step":"details","status":200,"topKeys":["journeyType","tripType","timin`
- Node: http=200 br=BR1795605457232366 status=Confirmed err=-
  - sample: `{"bookingReference":"BR1795605457232366","status":"pending","message":"Booking is processing","_meta":{"correlation_id":"book-1795605456801-v4mp4"}}`
- Request keys: `type, currency, language, bookingReference, searchIds, journeyType, timezone, data`
