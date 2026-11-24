# delta-api flight OW/RT book + cancel sanity

- ranAt: 2026-11-18T14:13:41.238Z
- base: https://delta-api.travelvip.ai
- partner: vgm · tier 10546901
- summary: **5 PASS / 0 BUG**
- Cancel rule (product): booking may stay **Confirmed** while `cancellationRequest.status` is **Cancellation Requested** (or Cancelled) — **PASS**, not a bug.

## Why DEL–BOM had no results

delta Riya flight is **simulator-only**. Vendor alert: `[SIM-NO-RECORDING] Simulator only replays PNQ-DEL, PNQ-DXB and DXB-LHR`. Same DEL–BOM payload on api-staging returns inventory.

## Results (sim routes)

| # | Rule | How tested | Status | Evidence |
|---|------|------------|--------|----------|
| 1 | AUTH | staging vgm creds on delta-api | **PASS** |  |
| 2 | OW.BOOK | PNQ→DEL issue-ticket → Confirmed | **PASS** | BR1795011222488918 · PNR SIM-WOOP5J |
| 3 | OW.CANCEL | v2 PENALTY+CANCEL; Cancelled **or** Confirmed+Cancellation Requested | **PASS** | cancelReq=Cancelled |
| 4 | RT.BOOK | PNQ↔DXB issue-ticket → Confirmed | **PASS** | BR1795011229391989 · PNR SIM-ASVFSY |
| 5 | RT.CANCEL | v2 PENALTY+CANCEL; Cancelled **or** Confirmed+Cancellation Requested | **PASS** | cancelReq=Cancelled |

Note: PNQ↔DEL RT blocked by sim meal gap (ONWARD meal mandatory, SSR only has RETURN meals) — used PNQ↔DXB for RT instead.
