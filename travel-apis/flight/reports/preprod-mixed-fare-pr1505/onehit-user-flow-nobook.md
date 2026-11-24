# User payload one-hit mix flow (no book)

- When: 2026-11-09T12:38:46.867Z
- Dates: 2026-11-22 / 2026-11-24 · fareType: NORMAL, CORPORATE, SME
- Pair: CORPORATE+NORMAL · SG SG 671 → 9I 9I 842
- Counts: {"PASS":4,"BUG":3,"NOT TESTED":3}

| ID | Rule | Status | Actual |
|----|------|--------|--------|
| S0 | One search returns options with multi fare categories | **PASS** | http=200 state=COMPLETE onwardCats=CORPORATE,NORMAL,SME returnCats=CORPORATE,NORMAL,SME |
| 763-MIX | Allow CORPORATE+NORMAL on details/pricing | **BUG** | details=400/INVALID_COMBINATION pricing=400/INVALID_COMBINATION |
| 764-MIXED | Top-level MIXED / mixedFareType | **NOT TESTED** | fareType=undefined mixedFareType=undefined |
| 768-RULES | Fare rules OK for mixed pair | **BUG** | http=400 fareType=undefined entries=null |
| SSR | SSR after mixed pricing | **NOT TESTED** | no priceId |
| SEAT | Seatmap after mixed pricing | **NOT TESTED** | no priceId |
| 767-CANDIDATE | Diff-airline pair available SG+9I | **PASS** | SG SG 671 → 9I 9I 842 (NORMAL) |
| 767-SEAT | Seatmap airlines differ (reuse primary mix airlines) | **BUG** | primary pair SG+9I seat={} |
| NO-BOOK | Never called issue-ticket | **PASS** | ALLOW_BOOK=false |
| L2B | Single OD+dates, one search HTTP | **PASS** | DEL-BOM 2026-11-22/24 · no date loop |

Raw: `onehit-user-flow-nobook.json`
