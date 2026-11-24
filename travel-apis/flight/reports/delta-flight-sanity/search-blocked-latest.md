# delta-api flight search blocked (DEL–BOM)

- **Verdict:** Not empty inventory — delta Riya flight is on **simulator**
- Vendor alert (`vendor-alerts-dev`): `[SIM-NO-RECORDING] Simulator only replays PNQ-DEL, PNQ-DXB and DXB-LHR searches, one-way or round trip.`
- staging same DEL–BOM payload: HTTP 200 + options
- delta DEL–BOM: HTTP 400 `VENDOR_ERROR` "Search failed."
- correlation_id: `d88a1175-f218-47e7-90c6-b965fb43ecc2`
- Allowed sim routes for book/cancel sanity: **PNQ–DEL**, **PNQ–DXB**, **DXB–LHR** (OW or RT)
