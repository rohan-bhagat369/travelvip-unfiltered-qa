# UI FAIL — Prospect View (Azure vs TravelVIP Grow)

**Caught by:** Rohan (manual screenshot compare) — **missed in prior agent web pass**  
**Date:** 2026-10-27  
**Rule:** Azure = baseline. Grow differs → **FAIL_GROW**

| | Azure UAT | TravelVIP Grow |
|--|-----------|----------------|
| Build | `1.0.0 (20261014.1)` | `1.0.0 (20260922.1)` |
| User | Amaan Khan | Mayur More |
| Screen | Prospect Users / View Prospect | View Prospect |

## Why it was missed

Prior pass covered module **list load** + booking/warehouse smoke. It did **not** open **Prospect View** side-by-side for layout parity. That was a coverage gap — acknowledged.

## Mismatches (Grow vs Azure)

| # | Element | Azure (expected) | Grow (actual) | Verdict |
|---|---------|------------------|---------------|---------|
| 1 | Page chrome | Breadcrumb **Prospect Users / View Prospect** | Title **View Prospect** only (no breadcrumb pair) | FAIL_GROW |
| 2 | Tabs | **Personal details** + **Visits** tab bar | **Missing** tabs | FAIL_GROW |
| 3 | Field layout | First/Last/Email · Contact/Establishment · structured grid | Different field set/order; First Name not shown same way; Status/TSM/OA/visit fields inline | FAIL_GROW |
| 4 | Address | Dedicated **Address** card (Building, Street, City, State, Country, Postal) | Broken dump top-right: `City : Pune`, `State : …` etc. **not** in Address card; Country/Lat/Long separate below | **FAIL_GROW (layout break)** |
| 5 | Visit history | **Last Visited Remarks** section with timeline box | No equivalent section; visit fields scattered mid-column | FAIL_GROW |
| 6 | Status / convert UX | Pill **Converted To Supplier** (when converted) | Status text **REQUESTED TO CONVERT** + bottom **Convert To Supplier** link | Different state OK; control placement differs from Azure pattern | PARTIAL / FAIL layout |
| 7 | Actions | **Back** + **Edit** (horizontal, bottom-right) | **Back** / **Edit** / **Convert** stacked vertically, awkward | FAIL_GROW |
| 8 | Alignment | Clean 3-column + address card | Misaligned columns; address block floats top-right | FAIL_GROW |

## Escalation

**UI-PROSPECT-01** — Prospect View on Grow does **not** visually match Azure (layout/CSS).  
Live re-open: Grow DOM *contains* Personal details / Visits / Address / Last Visited Remarks text, but **rendering/alignment** still broken vs Azure. Measured: tabs ~592px each; Back/Edit/Convert **w≈1201** stacked. Azure Back/Edit **w≈64** bottom-right.

Treat as **FAIL_GROW (UI)** — not PARITY SAME.

Same action-stack family also on **Admin View (UI-ADMIN-01)** and **Schedule View (UI-SCHED-01)** — see `UI-DETAIL-PARITY.md`.

**Likely cause:** Grow build `20260922.1` older than Azure `20261014.1`, and/or CSS/grid regression on Grow dump. Confirm newer web package with Dev.

## Evidence

- User screenshots (chat)  
- `web/e2e/ui-detail/ui-audit-grow-prospect-personal.png`, `ui-audit-grow-prospect-visits.png`, `ui-audit-azure-prospect-personal.png`
