# ENG-768 — PASS (per-leg fare rules on mixed RT)

**Status:** **PASS**  
**Task:** https://tracker.travelvip.ai/tasks/ENG-768  
**When:** 2026-11-09  
**Env:** preprod · no book  
**Tracker comment:** hold for bulk later  

## Verdict

Mixed RT with **2** `selectedSearchIds` returns **different fare rules for both legs** — PASS.

## Evidence

- Pair: SG 671 **CORPORATE** + 9I 842 **NORMAL**
- Response: `farerules-full-response.json`
- Top-level: `fareType: MIXED`, `mixedFareType: true`
- Entries (2):
  - `DEL-BOM · Description` · `fareType: corporate` · static-style rules
  - `BOM-DEL · 9IS` · `fareType: NORMAL` · Alliance vendor rules

## Note on task mismatch

Task text mentions `ROUND_TRIP` + single `selectedSearchId` → that leg only.  
Product clarification: “single ID” means **ONE_WAY**. RT correctly requires **2** ids.  
Do **not** treat RT+1id 400 as ENG-768 fail.
