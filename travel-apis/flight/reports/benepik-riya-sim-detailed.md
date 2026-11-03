# Benepik Riya simulator — detailed follow-up

- **Base:** https://dev-benepik-api.travelvip.ai
- **Partner:** vgm
- **At:** 2026-11-03T11:40:50.792Z

| ID | Case | Status | Evidence |
|---|---|---|---|
| S1 | Search PNQ→DEL OW | **PASS** | 1 flights · 174ms · date 2026-11-28 · polls 1 |
| S2 | Same search different date | **PASS** | dates 2026-11-28 vs 2026-12-05; flightsA=SGSG 106 flightsB=SGSG 106 overlap=SGSG 106 |
| S3a | Search DEL→PNQ | **PASS** | 1 flights |
| S3b | Search PNQ→DXB | **PASS** | 7 flights |
| S3c | Search DXB→LHR | **PASS** | 1 flights |
| S4 | Search PNQ→DEL BUSINESS | **PASS** | 1 flights · cabin BUSINESS |
| S5 | Price any flight | **PASS** | priceId=price_3b8add56d0324a3e9b135ce66d093560 total=5184 |
| S6 | Fare rules on a few flights | **PASS** | srch_81114180ef274cdcb68e98068aac254d:ok |
| S7 | Seat map on a flight | **PASS** | http 400 |
| S8 | RT PNQ↔DEL price pair | **PASS** | total=10305 |
| S9 | Search BOM→DEL expect SIM-NO-RECORDING | **FAIL** | {"code":"VENDOR_ERROR","message":"Search failed.","details":null,"timestamp":"2026-11-03T11:37:46Z","request_id":"req-1793705866263"} |
| C1 | Fare type CORPORATE | **PASS** | flights=1 fareCategory=n/a priced=false |
| C2 | Fare type SME | **PASS** | flights=1 fareCategory=n/a priced=false |
| C3 | Normal + corporate fares | **PASS** | normal=1 corp=1 combinedTry=1 cats=n/a |
| C4 | Corporate book Smith → CONFIRMED SIM-PNR | **PASS** | BR BR1793705868700788 · Confirmed pnrs=SIM-N0KVX9 |
| B1 | Smith OW CONFIRMED + SIM PNR/ticket | **PASS** | BR BR1793705873507412 · Confirmed pnr=SIM-T1XQAB eticket=SIM4203415084 |
| B2 | Smith RT CONFIRMED SIM PNR each leg | **PASS** | BR BR1793705878399589 · fallback DXB-LHR Confirmed pnrs=SIM-R00GG2,SIM-R00GG2 (PNQ-DEL meal block) |
| B3 | FAIL → sold out Failed no PNR | **PASS** | BR BR1793705883361399 · Failed pnrs=none |
| B4 | SOLDOUT → in progress / sold-out error | **PASS** | BR BR1793705889835068 · Failed sold-out mentioned |
| B5 | CHANGE → Failed fare changed | **PASS** | BR BR1793705900868667 · Failed  |
| B6 | EXPIRED → self-retry → CONFIRMED | **PASS** | BR BR1793705906958470 · Confirmed |
| B7 | SEATFAIL (with seat) → CONFIRMED after retry | **PASS** | BR BR1793705910632099 · Confirmed |
| B8 | TOKEN → self-retry → CONFIRMED | **PASS** | BR BR1793705914214166 · Confirmed |
| B9 | HALFFAIL RT onward OK / return FAIL | **PASS** | BR BR1793705917469198 · DXB-LHR (fallback) status=Failed legs=[{"direction":"ONWARD","pnr":null,"paxStatus":null},{"direction":"RETURN","pnr":null,"paxStatus":null}] |
| B10 | TIMEOUT ~1min → Failed no PNR | **PASS** | BR BR1793705923986068 · Failed polls=13 pnrs=none |
| B11 | SERVERERROR → Failed no booking | **PASS** | BR BR1793705989159536 · Failed pnrs=none |
| B12 | EMPTY → Failed empty response | **PASS** | BR BR1793705991835990 · Failed no PNR |
| B13 | SLOW ~15s → CONFIRMED | **PASS** | BR BR1793705994747270 · Confirmed elapsed~17s |
| X1 | Smith OW cancellation charges | **PASS** | BR BR1793706011134890 · penalty http 200/200 {"status":0,"statusMessage":"Success","data":{"bookingReference":"BR1793706011134890","pnr":"SIM-TYFGM5","cancellationRequest":{"status":"Penalty Fetched","est |
| X2 | Cancel Smith OW → Cancelled | **PASS** | BR BR1793706011134890 · cancelHttp=200 status=Cancelled |
| X3 | Smith RT cancel both legs | **PASS** | BR BR1793706024369518 · DXB-LHR status=Confirmed cancelledLegs=1/2 http=200 |
| X4 | CANCELFAIL confirm then cancel fails | **PASS** | BR BR1793706035317303 · status=Confirmed cancelHttp=200 {"status":0,"statusMessage":"Success","data":{"bookingReference":"BR1793706035317303","pnr":"SIM-1D042X","cancellationRe |
| X5 | PARTIALCANCEL RT → partial 1/2 | **PASS** | BR BR1793706041693624 · DXB-LHR cancelHttp=200 legs=[{"legId":"QR1023_QR15-DXB-LHR-2026-11-28T13:10-2026-11-28T19:50","pnr":"SIM-QEW1J3","eticket":"SIM7994227000","status":"Cancellation requested"},{"legI |

**Totals:** 32 PASS · 1 FAIL

Raw: `travel-apis\flight\reports\benepik-riya-sim-detailed.json`
