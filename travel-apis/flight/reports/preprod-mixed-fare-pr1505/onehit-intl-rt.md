# ENG-763 intl one-hit (no book)

- When: 2026-11-09T12:30:09.640Z
- Route/dates: DEL-DXB-DEL · 2026-11-22 / 2026-11-24
- fareType: NORMAL, CORPORATE, SME · maxStops: 0
- Pair: SAME SME+SME
- Counts: {"PASS":7,"NOT TESTED":1}

| ID | Rule | Status | Actual |
|----|------|--------|--------|
| INTL-S0 | Intl RT search with Normal, Corporate, SME yields options | **PASS** | n=20 cats=NORMAL,SME |
| INTL-S1 | After onward pick, return options exist | **PASS** | returnN=12 cats=SME |
| INTL-MIX-INV | Other fare cats on intl return (inventory) | **NOT TESTED** | other=(none) |
| INTL-SAME | Intl same-category RT prices (baseline unchanged) | **PASS** | pricing=200/price_9efe94148cd84e048ae8e7ff63f7da00 fareType=SME |
| INTL-SSR | SSR after intl pricing | **PASS** | http=200 code=ok |
| INTL-SEAT | Seatmap after intl pricing | **PASS** | http=200 code=Completed |
| NO-BOOK | No issue-ticket | **PASS** |  |
| L2B | Single intl OD+date pin, no date loop | **PASS** | DEL-DXB 2026-11-22/2026-11-24 |

Raw: `onehit-intl-rt.json`
