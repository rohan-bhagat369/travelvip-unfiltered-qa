# Benepik Riya simulator — no-loop pack

- **Base:** https://dev-benepik-api.travelvip.ai
- **Partner:** vgm (staging creds)
- **At:** 2026-11-03T11:21:24.581Z
- **Rule:** one attempt per case · no date/name retry

| ID | How tested | Status | Evidence |
|---|---|---|---|
| 1a | DEL→PNQ search+price+fareRules+seatmap (once) | **PASS** | — |
| 1b | PNQ→DEL search+pricing instantly | **PASS** | — |
| 1c | RT PNQ↔DEL pair prices | **PASS** | — |
| 1d | BOM→DEL expect [SIM-NO-RECORDING] | **FAIL** | {"error":{"code":"VENDOR_ERROR","message":"Search failed.","details":null,"timestamp":"2026-11-03T11:19:27Z","request_id":"req-1793704767131"},"_meta":{"correla |
| 2a | fareType CORPORATE PNQ-DEL shows flights + prices | **PASS** | — |
| 2b | Corporate book lastName=Smith → CONFIRMED (+cancel once) | **PASS** | BR BR1793704768784799 · Confirmed |
| 3_FAIL | lastName=FAIL (sold out → Failed) | **PASS** | BR BR1793704774823928 · Failed |
| 3_CHANGE | lastName=CHANGE (fare changed → Failed) | **PASS** | BR BR1793704782855440 · Failed |
| 3_PENDING | lastName=PENDING (in progress then confirmed (short poll)) | **PASS** | BR BR1793704784688651 · Inprogress |
| 3_EXPIRED | lastName=EXPIRED (fail once / retry succeeds — NO retry; score first result) | **PASS** | BR BR1793704792213649 · Confirmed |
| 3_SLOW | lastName=SLOW (confirmed after ~15s) | **PASS** | BR BR1793704798948109 · Confirmed |
| 3_TIMEOUT | lastName=TIMEOUT (FAILED no booking) | **FAIL** | BR BR1793704815989789 · Pending |
| 3_SERVERERROR | lastName=SERVERERROR (FAILED no booking) | **FAIL** | BR BR1793704831395917 · Pending |
| 3_EMPTY | lastName=EMPTY (FAILED no booking) | **FAIL** | BR BR1793704850588099 · Pending |
| 3_HALFFAIL | RT lastName=HALFFAIL return fails | **FAIL** | no BR |
| 3_PARTIALCANCEL | RT lastName=PARTIALCANCEL then cancel | **FAIL** | no BR |
| 3_CANCELFAIL | lastName=CANCELFAIL confirm then cancel fails | **PASS** | BR BR1793704867802968 · Confirmed |

**Totals:** 11 PASS · 6 FAIL · 0 NOTE

Raw: `travel-apis\flight\reports\benepik-riya-sim-noloop.json`
