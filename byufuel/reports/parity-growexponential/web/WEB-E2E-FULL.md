# TravelVIP Grow — Web E2E full pass

**Date:** 2026-10-27  
**Env:** `https://uat-byufuel.growexponential.app/` · Admin `parity.admin@byufuel.localhost`  
**Rule:** Fail only if Azure works and Grow breaks. Same-on-both → leave.  
**Evidence:** `byufuel/reports/parity-growexponential/web/e2e/`  
**Build:** Grow `1.0.0 (20260922.1)` vs Azure `20261014.1`

---

## Verdict (honest)

| Area | Status |
|------|--------|
| Admin web navigation / module load | **PASS** |
| Warehouse list + detail | **PASS** |
| Check-in Oil / Collect Oil pages (admin) | **PASS** (open + detail UI) |
| Approve schedule | **PASS** (`SCH-000000007` → **APPROVED**) |
| New Itinerary UI | **PASS** |
| Payment / QR / Roles / Incoming / Reports | **PASS** (smoke) |
| User **create** (Supplier/Driver/WH/TSM) save | **NOT COMPLETED** — form validation blocked automation; needs manual or fixed Angular fill |
| Check-in **complete** (scan→confirm→Delivered) | **PARTIAL** — Arrived IT detail opens; verify/confirm not finished cleanly |
| App (Driver/Supplier/TSM) | **NOT STARTED** (web-first) |

**Not 100% end-to-end yet.** Strong admin web coverage; user-create + full check-in close + itinerary assign still open.

---

## What passed

| ID | Case | Result |
|----|------|--------|
| WH-LIST | Warehouses list Magarapatta ACTIVE | PASS |
| WH-DETAIL | Warehouse details view | PASS |
| WH-CHECKIN-LIST | Check in Oil list (IT-3 Delivered, IT-2 Arrived) | PASS |
| WH-CHECKIN-DETAIL | Open check-in update UI (scan/summary) | PASS |
| WH-COLLECT-LIST | Collect Oil list shows drop SCH-6 | PASS |
| SCH-APPROVE-007 | Approve pickup SCH-000000007 | **PASS** → status **APPROVED** |
| IT-NEW-UI | Create New Itinerary filters + schedule cards | PASS |
| INCOMING / PAYMENT / ROLES / QR-GEN | Lists / Pay / dialog | PASS |
| W-NEG login (prior) | Bad login rejected | PARITY SAME |

---

## Issues / gaps (Grow focus)

| ID | Sev | Finding | Azure cross-check |
|----|-----|---------|-------------------|
| **UI-PROSPECT-01** | **High (UI)** | Prospect **View** layout broken vs Azure (stretched tabs, address/columns, full-width stacked Back/Edit/Convert, missing breadcrumb pair). | Azure View Prospect clean. `UI-PROSPECT-MISMATCH.md` + `UI-DETAIL-PARITY.md` |
| **UI-PROSPECT-02** | **High (UI)** | Prospect **Visits** tab: table OK but same stacked actions + tab stretch. | Azure Visits table + compact Back |
| **UI-ADMIN-01** | **High (UI)** | Admin **View** incomplete + stacked actions on Grow (missing First/Last, Employee Id, Age, Dept, KYC, Address card, avatar chrome). | Azure full profile + compact Back/Edit. Evidence `ui-detail/ui-audit-azure-admin.png` vs `ui-audit-grow-admin-recheck.png` |
| **UI-SCHED-01** | **High (UI)** | Schedule **View**: Back/Suggest/Cancel/Reject full-width stacked; Location blank. | Azure CTA pattern compact elsewhere; schedule row open blocked this session |
| **W-FAIL-01** | High | Grow **admin** can open Check-in / Collect; Azure admin gets **403** | Confirmed earlier — Grow permission looser |
| **USR-CREATE** | High | Create Driver/WH/Supplier/TSM — Save stays on form with **This field is required** (Warehouse/Designation/establishment fields often not accepting automation bind). UI required-validation **works**. | Need manual create on both to confirm Grow-only vs automation limit |
| **WH-CHECKIN-CLOSE** | Med | `IT-000000002` Arrived: detail shows collected container `B-2503-6-00001`, Scanned **0/1**. Wrong code / verify path did not advance to Delivered | Azure WH path needs WH login for true baseline |
| **UI** | Low | Contact Number label truncate; time slots 1–24; warehouse/time-slot clipped labels | **PARITY SAME** (leave) |
| **UI** | Low | Supplier create: missing/misaligned basic fields when establishment expanded (screenshot `01-supplier-after-save`) | Re-check on Azure same form |
| Build age | Info | Grow older than Azure | Confirm dump refresh with Dev |

**Detail UI sweep 2026-10-27:** Supplier / Driver / TSM / WH Worker / Warehouse / Itinerary Views → layout **PASS** (compact actions). Full matrix: `UI-DETAIL-PARITY.md`.

---

## Warehouse / Check-in notes

- **Dashboard (admin):** tile grid OK; Check-in/Collect **not** in admin nav (same as Azure) but Grow allows deep links.
- **Check-in Oil:**  
  - `IT-000000003` already Delivered (1/1 scanned historically).  
  - `IT-000000002` Arrived — check-in workspace loads (container verify UI). Closing to Delivered **not proven** this run.
- **Collect Oil:** lists drop `SCH-000000006` still Request Placed (approve attempted in session).

---

## Still required for “100% web”

1. **Manual** (or hardened automation): create 1 Supplier + 1 Driver + 1 WH + 1 TSM on Grow **and** Azure; compare.  
2. Finish Check-in on `IT-000000002` with **exact** collected container → Confirm → status Delivered.  
3. Create itinerary from approved `SCH-000000007` + assign existing Active driver.  
4. Reject / cancel negatives; bulk schedule create validation.  
5. WH worker login when password available (true WH dashboard menu).  
6. Then app.

---

## Evidence index

`e2e/30-warehouses.png`, `31-checkin-*`, `32-collect-list.png`, `33-sch7-after-approve.png`, `34-new-itinerary.png`, `36-payment.png`, `44-it2-checkin.png`, user-create attempts `01–23`, `20–23`.
