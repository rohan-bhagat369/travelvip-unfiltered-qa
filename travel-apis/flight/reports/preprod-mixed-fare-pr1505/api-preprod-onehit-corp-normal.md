# api-preprod one-hit CORP↔NORMAL (no book)

- When: 2026-11-12T11:05:12.631Z
- Base: `https://api-preprod.travelvip.ai`
- Dates: 2026-11-26 / 2026-11-28 · fareType: NORMAL, CORPORATE, SME
- Counts: {"PASS":15,"NOT TESTED":1}

| ID | Rule | Status | Actual |
|----|------|--------|--------|
| S0 | Pinned search multi-lane inventory | **PASS** | http=200 state=COMPLETE onward=CORPORATE,NORMAL,SME return=CORPORATE,NORMAL,SME |
| 763-REFINE | Return already had CORPORATE (no refine needed) | **PASS** | returnCats=CORPORATE,NORMAL,SME |
| 763-CN | Allow CORPORATE+NORMAL details/pricing | **PASS** | pricing=200/price_002f2265343e4c64885cf3587656334a airlines=QP+QP same=true tries=1 |
| 764-CN | MIXED top-level CORP+NORMAL | **PASS** | fareType=MIXED mixed=true legs=null |
| 768-CN | Fare rules per leg CORP+NORMAL | **PASS** | http=200 entries=2 [{"title":"DEL-BOM · Description","direction":null,"fareType":"corporate","hasCancel":false,"hasReschedule":false,"textLen":12642},{"title":"BOM-DEL · Fare Rules","direction":null," |
| 765-CN | Policies CORP+NORMAL order | **PASS** | [{"title":"DEL-BOM · Description","direction":null,"fareType":"corporate","hasCancel":false,"hasReschedule":false,"textLen":12642},{"title":"BOM-DEL · Fare Rules","direction":null,"fareType":"NORMAL", |
| SEAT-CN | Seatmap CORP+NORMAL (same al) | **PASS** | dirs=none segs=[{"direction":null,"legNumber":1,"origin":"DEL","destination":"BOM","airline":null,"flightNumber":null,"seatCount":186,"openCount":0},{"direction":null,"legNumber":2,"origin":"BOM","des |
| 763-NC | Allow NORMAL+CORPORATE details/pricing | **PASS** | pricing=200/price_9bb0900f3bd1459dadaf5ebd491aecc9 airlines=QP+QP same=true tries=1 |
| 764-NC | MIXED top-level NORMAL+CORP | **PASS** | fareType=MIXED mixed=true |
| 768-NC | Fare rules per leg NORMAL+CORP | **PASS** | http=200 entries=2 |
| 765-NC | Policies NORMAL+CORP order | **PASS** | [{"title":"DEL-BOM · Fare Rules","direction":null,"fareType":"NORMAL","hasCancel":false,"hasReschedule":false,"textLen":3630},{"title":"BOM-DEL · Description","direction":null,"fareType":"corporate"," |
| SEAT-NC | Seatmap NORMAL+CORP (same al) | **PASS** | dirs=none segs=[{"direction":null,"legNumber":1,"origin":"DEL","destination":"BOM","airline":null,"flightNumber":null,"seatCount":186,"openCount":0},{"direction":null,"legNumber":2,"origin":"BOM","des |
| 767-SAME | Same-airline seatmap QP+QP | **PASS** | kind=CORPORATE+NORMAL · both legs seats (186 / 197) |
| 767-DIFF | Diff-airline seatmap QP CORP + 6E NORMAL | **BUG** | pricing MIXED `price_496c2cda…` · fareRules 2 entries OK · seatmap HTTP 200 Completed but **segments=[]** (no seats either leg) — see `api-preprod-onehit-diff-airline.json` |
| NO-BOOK | Never called issue-ticket | **PASS** | ALLOW_BOOK=false |
| L2B | Single OD+dates pin (26/28 Nov) | **PASS** | no date step |

Raw: `api-preprod-onehit-corp-normal.json` + `api-preprod-onehit-diff-airline.json`
