# Tracker comments (ENG-763…768) — 2026-11-09

**Posted via UI:** 2026-11-09 · each task Comments ·1 → ·2 · @Mayur More mention  

Env: preprod `https://preprod-api.travelvip.ai` · partner vgm · **no book** · PR #1505  
Mention on every comment: **@Mayur More**

---

## ENG-763
https://tracker.travelvip.ai/tasks/ENG-763

@Mayur More

QA update — Flights v2 mixed fare (preprod, no book)

**PASS**
- Multi-lane search `NORMAL, CORPORATE, SME` returns mixed cats (DEL↔BOM RT · 22→24 Nov · 1ADT · ECONOMY · maxStops 0)
- After onward pick, return still has other allowed cats (same search tree)
- SME + NORMAL mix pricing/details 200
- CORPORATE + NORMAL mix → `fareType=MIXED` (`price_bfb09c…`)
- Cross-search pair → 400 `INVALID_COMBINATION` (Postman)
- SSR after mixed pricing 200
- Intl same-cat baseline unchanged (DEL↔DXB SME+SME price/SSR/seat 200)

**NOT TESTED**
- Flexi-Cancel still blocked — fare type not in inventory
- Intl mixed fare allow/block — return SME only, no mix pair
- Student / Defence / Senior block — not in inventory

Evidence: `travel-apis/flight/reports/preprod-mixed-fare-pr1505/`

---

## ENG-764
https://tracker.travelvip.ai/tasks/ENG-764

@Mayur More

QA update — per-leg fareType + MIXED top-level (preprod, no book)

**PASS**
- Mixed RT pricing/details return top-level `fareType=MIXED`, `mixedFareType=true`
- Per-leg `fareType` / `fareCategory` present (CORP+NORMAL and SME+NORMAL)

Search: DEL↔BOM RT · multi-lane `NORMAL, CORPORATE, SME`

Evidence: `onehit-user-flow-nobook` / `option-b-nobook-ssr-seat`

---

## ENG-765
https://tracker.travelvip.ai/tasks/ENG-765

@Mayur More

QA update — per-leg cancel/reschedule policies (preprod, no book)

**PASS**
- CORPORATE + NORMAL mix fare rules: structured `cancellationPolicies` / `reschedulePolicies` on **ONWARD CORPORATE only**; **NORMAL return has none** (expected)

Search: DEL↔BOM RT · 22→24 Nov · SG CORP + 9I NORMAL

**NOT TESTED**
- Normal + Corporate order — dual-list → `INVALID_COMBINATION`; after NORMAL refine return cats = NORMAL only (no CORPORATE)

Evidence: `farerules-full-response` / `farerules-normal-corp`

---

## ENG-766
https://tracker.travelvip.ai/tasks/ENG-766

@Mayur More

QA update — re-price expired leg (preprod, no book)

**NOT TESTED**
- Expired-leg re-price from refresh token not run (needs cache-expiry wait; skipped to protect L2B)

Will cover in a dedicated pin when expiry can be exercised safely.

---

## ENG-767
https://tracker.travelvip.ai/tasks/ENG-767

@Mayur More

QA update — mixed-airline seatmap (preprod, no book)

**BUG**
- Mixed-airline RT SG + 9I (CORP+NORMAL): seatmap HTTP 200 / `requestStatus=Completed` but **only onward SG seats returned; return leg empty**

Search: DEL↔BOM RT · 22→24 Nov · SG CORP + 9I NORMAL

Evidence: `ENG-767-BUG-mixed-airline-seatmap` / `seatmap-full-response`

---

## ENG-768
https://tracker.travelvip.ai/tasks/ENG-768

@Mayur More

QA update — per-leg fare rules (preprod, no book)

**PASS**
- Mixed RT fareRules 200 · top-level `fareType=MIXED`
- Two entries with different text: DEL-BOM corporate (static) + BOM-DEL NORMAL (Alliance Super Saver)

Search: DEL↔BOM RT · 22→24 Nov · SG CORP + 9I NORMAL

Note: task “single selectedSearchId on ROUND_TRIP” clarified as **ONE_WAY**; RT correctly needs 2 ids (RT+1id 400 expected — not a fail).

Evidence: `ENG-768-PASS-per-leg-farerules` / `farerules-full-response`
