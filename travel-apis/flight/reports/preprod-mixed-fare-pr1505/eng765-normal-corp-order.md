# ENG-765 — Normal + Corporate order

- When: 2026-11-09T12:34:10.067Z
- Pair: NORMAL (SG SG 671) → CORPORATE (SG SG 511)
- Status: **BUG**

| ID | Rule | Status | Actual |
|----|------|--------|--------|
| 765-ORDER-MIX | NORMAL+CORPORATE prices as MIXED | **BUG** | pricing=400/INVALID_COMBINATION fareType=undefined mixed=undefined |
| 765-ORDER-RULES | Fare rules MIXED with 2 entries | **BUG** | http=400 fareType=undefined entries=0 |
| 765-ORDER-POL | Structured policies on CORPORATE return only; NORMAL onward none | **BUG** | cancelDirs=(none) reschedDirs=(none) |
| NO-BOOK | No issue-ticket | **PASS** |  |

Raw: `eng765-normal-corp-order.json`
