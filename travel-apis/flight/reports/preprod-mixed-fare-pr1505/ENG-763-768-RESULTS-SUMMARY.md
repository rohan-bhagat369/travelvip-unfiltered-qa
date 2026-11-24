# ENG-763…768 QA results summary (preprod, no book)

**Env:** `https://preprod-api.travelvip.ai` · partner `vgm` · 2026-11-09  
**Tracker:** hold bulk comments for later  

## Notes

- **Flexi-Cancel block:** **NOT TESTED** — that fare type not available in search inventory (cannot exercise AC). Not a BUG.
- **Cross-search `INVALID_COMBINATION`:** covered in Postman — *“Selected onward and return flights come from different searches…”* — PASS for that AC bullet.
- **ENG-768 single-id on RT:** task text mismatch; “single ID” clarified as ONE_WAY. RT+1id 400 is expected. Both-leg RT fareRules = PASS.
- **ENG-767:** mixed-airline seatmap both legs = **BUG** (local write-up only).

---

## PASS results

| ENG | Rule / case | How tested | Status | Evidence |
|-----|-------------|------------|--------|----------|
| ENG-763 | Multi-lane search `NORMAL, CORPORATE, SME` returns mixed cats | DEL↔BOM RT pin; filters show NORMAL+CORPORATE+SME | **PASS** | Postman search + `onehit-user-flow-nobook` |
| ENG-763 | After onward pick / same tree, other allowed cats on return | Return cats include NORMAL/CORPORATE/SME | **PASS** | Same search tree |
| ENG-763 | Allow SME + NORMAL RT | Pricing/details 200, mix priced | **PASS** | Early Option B (6E SME+NORMAL) |
| ENG-763 | Allow CORPORATE + NORMAL RT | SG CORP + 9I NORMAL → `price_bfb09c…` `MIXED` | **PASS** | `onehit-user-flow-nobook` |
| ENG-763 | Cross-search pair rejected | Details → `INVALID_COMBINATION` (different searches) | **PASS** | Postman screenshot 2026-11-09 |
| ENG-763 | SSR after mixed pricing | SSR 200 | **PASS** | `onehit-user-flow-nobook` |
| ENG-763 | Intl same-cat RT baseline unchanged | DEL↔DXB SME+SME price/SSR/seat 200 | **PASS** | `onehit-intl-rt` |
| ENG-764 | Top-level `MIXED` + per-leg fareType | Pricing `fareType=MIXED`, `mixedFareType=true`, legs CORP/NORMAL | **PASS** | Mix hops |
| ENG-765 | Per-leg policies (corp has / normal none) | Cancel/reschedule on onward CORP only in mix rules dump | **PASS** | `farerules-full-response` |
| ENG-768 | Per-leg fare rules, different text both legs | 2 entries: DEL-BOM corporate + BOM-DEL NORMAL | **PASS** | `ENG-768-PASS-per-leg-farerules.md` / `farerules-full-response.json` |
| META | No book | Never issue-ticket | **PASS** | All runs `ALLOW_BOOK=false` |
| META | L2B / pinned dates | Single OD+date pins, no date loop on final flows | **PASS** | Reports |

---

## Not PASS (for completeness)

| ENG | Rule / case | Status | Note |
|-----|-------------|--------|------|
| ENG-767 | Both-leg seatmap when airlines differ (SG+9I) | **BUG** | Only onward SG seats; return empty — `ENG-767-BUG-mixed-airline-seatmap.md` |
| ENG-763 | Flexi-Cancel still blocked | **NOT TESTED** | Fare type not in inventory |
| ENG-763 | Intl mixed fare allow/block | **NOT TESTED** | User payload DEL↔DXB 22–24 Nov, maxStops 0: onward NORMAL+SME, return **SME only** — no mix pair to price |
| ENG-766 | Re-price expired leg | **NOT TESTED** | Needs expiry wait |
| ENG-763 | Student / Defence / Senior block | **NOT TESTED** | Not in inventory |

---

## All executed cases (single table)

| # | ENG | Case | Search criteria | How tested / details | Status |
|---|-----|------|-----------------|----------------------|--------|
| 1 | 763 | Multi-lane search NORMAL / CORPORATE / SME | DEL↔BOM RT · 22→24 Nov · 1ADT · ECONOMY · maxStops 0 · `fareType=NORMAL, CORPORATE, SME` · preprod vgm | Search filters/options show all 3 cats · `onehit-user-flow-nobook` | PASS |
| 2 | 763 | Other allowed cats on return (same tree) | Same as #1; refine with onward `selectedSearchIds` | Return still lists other allowed cats · `onehit-user-flow-nobook` | PASS |
| 3 | 763 | SME + NORMAL mix pricing/details | DEL↔BOM RT · 19→21 Dec · 1ADT · ECONOMY · `fareType=Normal, Corporate, SME` · preprod vgm | Option B: 6E SME + NORMAL → details/pricing 200 · `option-b-nobook-ssr-seat` | PASS |
| 4 | 763 | CORPORATE + NORMAL mix pricing/details | Same as #1 | SG CORP + 9I NORMAL → `price_bfb09c…` `MIXED` · `onehit-user-flow-nobook` | PASS |
| 5 | 763 | Cross-search → INVALID_COMBINATION | Two separate RT searches (different sessions); pair ids across them | Postman → 400 `INVALID_COMBINATION` | PASS |
| 6 | 763 | SSR after mixed pricing | Same as #4 (CORP+NORMAL priceId) | SSR 200 · `onehit-user-flow-nobook` | PASS |
| 7 | 763 | Intl same-cat RT baseline (DEL↔DXB SME+SME) | DEL↔DXB RT · 22→24 Nov · 1ADT · ECONOMY · maxStops 0 · `fareType=NORMAL, CORPORATE, SME` · preprod vgm | SME+SME price/SSR/seat 200 · `onehit-intl-rt` | PASS |
| 8 | 764 | Top-level MIXED + per-leg fareType | Same as #3 / #4 mixed pairs | `fareType=MIXED`, `mixedFareType=true` · `onehit-user-flow-nobook` / `option-b-nobook-ssr-seat` | PASS |
| 9 | 765 | Per-leg policies Corporate+Normal (corp has / normal none) | Same as #4 (SG CORP + 9I NORMAL) | `farerules-full-response`: cancel/reschedule ONWARD CORP only; RETURN NORMAL none | PASS |
| 10 | 768 | Different fare rules both legs | Same as #4 | `farerules-full-response` / `ENG-768-PASS-per-leg-farerules`: 2 entries CORP + NORMAL | PASS |
| 11 | META | No book | All pins above | `ALLOW_BOOK=false`; never issue-ticket | PASS |
| 12 | META | L2B / pinned dates | Fixed OD+dates per run (no date stepping) | Single pin; no date-step loop | PASS |
| 13 | 767 | Mixed-airline seatmap both legs (SG+9I) | Same as #4 (SG + 9I) | `seatmap-full-response` / `ENG-767-BUG`: Completed; only onward SG seats | BUG |
| 14 | 763 | Flexi-Cancel still blocked | DEL↔BOM RT · 22→24 Nov · Flexi / Flexi-Cancel fareType probes · preprod vgm | `recheck-flexi-*` — Flexi-Cancel not in inventory | NOT TESTED |
| 15 | 763 | Intl mixed fare allow/block | Same as #7 | `onehit-intl-rt`: return SME only — no mix pair | NOT TESTED |
| 16 | 766 | Re-price expired leg | N/A — expiry wait not run | Skipped to protect L2B | NOT TESTED |
| 17 | 763 | Student / Defence / Senior block | Same DOM multi-lane searches (#1 / #3) | Those fare types not in inventory | NOT TESTED |
| 18 | 765 | Normal + Corporate order | Same as #1; pick NORMAL onward + CORPORATE return | `farerules-normal-corp` / `dump-farerules-mix-order`: `INVALID_COMBINATION` / refine return=NORMAL only | NOT TESTED |

## Counts (local)

| Status | n |
|--------|---|
| **PASS** | 12 |
| **BUG** | 1 (ENG-767) |
| **NOT TESTED** | 5 |
