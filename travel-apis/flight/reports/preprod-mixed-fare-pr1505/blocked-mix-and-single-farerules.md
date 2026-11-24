# Blocked mix + single-id fareRules (same search)

- When: 2026-11-09T07:21–07:22Z
- Dates: 2026-11-22 / 2026-11-24 · `fareType: NORMAL, CORPORATE, SME`
- No book

| ID | Rule | Status | Actual |
|----|------|--------|--------|
| S0 | Same search available | **PASS** | 200 COMPLETE |
| 763-BLOCK-FLEXI | Block CORPORATE + IndiGo `Flexi` | **BUG** | SG CORP + 6E Flexi **accepted**: details 200, pricing 200 `MIXED` `price_cb4943e1…` — expect `INVALID_COMBINATION` |
| 768-SINGLE-ONWARD | RT fareRules with 1 onward id only | **DROPPED** | Task mismatch — single ID means OW; RT requiring 2 ids is correct. ENG-768 **PASS** on 2-id both-leg case. |
| 768-SINGLE-RETURN | RT fareRules with 1 return id only | **DROPPED** | same |
| NO-BOOK | No issue-ticket | **PASS** | |

## Notes

- ENG-768 both-leg mixed fareRules: **PASS** — see `ENG-768-PASS-per-leg-farerules.md` / `farerules-full-response.json`.
- RT+1id 400 is **not** a bug (clarified).

Evidence: `blocked-mix-and-single-farerules.json`
