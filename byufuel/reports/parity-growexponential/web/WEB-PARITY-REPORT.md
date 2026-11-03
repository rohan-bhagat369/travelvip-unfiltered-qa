# Web parity report — Azure UAT vs TravelVIP Grow

**Date:** 2026-10-26  
**Rule:** Escalate only **Azure works → Grow breaks/missing/wrong**. Same-on-both → leave (`PARITY SAME`).  
**Builds:** Azure `20261014.1` · Grow `20260922.1`  
**Evidence:** `byufuel/reports/parity-growexponential/web/`

---

## Executive

| | Count |
|--|--|
| Admin web modules reachable (correct menu URLs) | **30/30 PASS** (both) |
| Positive / negative smoke cases | **12 PASS / PARITY SAME**, 0 Grow functional FAIL in smoke |
| Grow-only behavioural issue | **1** permission difference (Check-in / Collect) |
| Blocked for full WH deep check-in | WH worker password (optional — admin can open pages on Grow) |
| App | **Deferred** (per plan: web first) |

---

## Module load matrix (menu-correct paths)

| Module | Path | Azure | Grow | Verdict |
|--------|------|-------|------|---------|
| Dashboard | `/dsh/dashboard` | OK | OK | PASS |
| Admin Users | `/uam/admin-users` | OK | OK | PASS |
| TSM & Leads | `/uam/tsm-leads` | OK | OK | PASS |
| TSM ZipCodes | `/uam/tsm-zipcodes` | OK | OK | PASS |
| WH Workers | `/uam/wh-users` | OK | OK | PASS |
| Drivers | `/uam/drivers` | OK | OK | PASS |
| Prospects | `/uam/prospects` | OK | OK | PASS |
| Suppliers | `/uam/suppliers` | OK | OK | PASS |
| Roles | `/uam/roles` | OK | OK | PASS |
| Create Bulk | `/byu/suppliers` | OK | OK | PASS |
| View Bulk Requests | `/byu/bulk-uco-schedule-requests` | OK | OK | PASS |
| Manage Requests | `/byu/uco-schedules` | OK | OK | PASS |
| Itineraries | `/byu/uco-schedule-itineraries` | OK | OK | PASS |
| Warehouses | `/uam/warehouses` | OK | OK | PASS |
| MDM Types / UCO / Slots / Countries / Rates / OA | `/mdm/*` | OK | OK | PASS |
| QR Codes | `/uam/container-qr-codes` | OK | OK | PASS |
| Vehicles | `/byu/vehicles` | OK | OK | PASS |
| Container | `/uam/container-management` | OK | OK | PASS |
| UCO inventory | `/byu/uco` | OK | OK | PASS |
| Payment / Penalty | `/byu/supplier-payment` etc. | OK | OK | PASS |
| Support / Chat / Incoming / Reports | respective | OK | OK | PASS |

Note: Wrong guessed paths (`/uam/vehicles`, `/byu/bulk-uco-schedules`) 404 on Grow — **not** product misses; menu hrefs match Azure.

---

## Positive / negative cases run

| ID | Case | Azure | Grow | Verdict |
|----|------|-------|------|---------|
| W-NEG-01 | Bad login | Rejects (`Email Id not registered`) | Rejects (`User not registered`) | **PARITY SAME** (message text differs — leave) |
| W-POS-02 | New Schedule form | Same fields (Supplier, Pickup/Drop, slot, grade, weight…) | Same | **PASS** |
| W-NEG-02 | Empty Save on New Schedule | — | Stays on form (no create) | **PASS** |
| W-POS-03 | View `SCH-000000007` REQUEST PLACED | — | Approve / Reject / Cancel / Suggest time present | **PASS** |
| W-POS-04 | New Itinerary | Has New + tabs | Has New + same tabs + `/new` | **PASS** |
| W-POS-05 | Generate QR dialog | — | Opens | **PASS** |
| W-POS-06 | Supplier Payment | — | List + Pay + VERIFIED/CREATED | **PASS** |
| W-POS-07 | Reports | Loads | Loads | **PASS** |
| Contact Nu… truncate | Yes | Yes | **PARITY SAME — leave** |
| Time slots `1`–`24` | Yes | Yes | **PARITY SAME — leave** |

---

## Grow-only issue (Azure OK / different)

| ID | Severity | Finding | Azure baseline | Grow |
|----|----------|---------|----------------|------|
| **W-FAIL-01** | **High (perms)** | Admin can open **Check in Oil** + **Collect Oil** via URL | `amaan` → **403 Forbidden** on `/byu/checkin-oil` and `/byu/collect-oil` | `parity.admin` → pages load (Check-in 2 rows, Collect 1 row) |

This is **not** “Azure broken”. Azure correctly forbids; Grow allows admin into WH flows. Flag for Dev: role/permission dump mismatch vs Azure.

Screens: `grow_byu_checkin-oil.png`, `grow_byu_collect-oil.png`, `azure_byu_checkin-oil.png` (403).

---

## Still to finish on web (next chunks)

Without mutating production-like data until you say go:

1. **Approve** `SCH-000000007` → status match Azure approve path  
2. **Create itinerary** + assign driver (web only)  
3. **Check-in Oil deep** on Grow as admin (list already open) — scan/confirm vs Azure WH behaviour (need Azure WH login for true baseline)  
4. **Collect Oil** only for drop SCH  
5. Negatives: reject schedule, cancel rules, bulk create validation  
6. MDM edit save validations (min>max weight)

**Need from you for true Azure WH baseline:** WH worker password on Azure (and Grow `mayurm@whworker.com` password). Wrong Grow WH password → `Invalid credentials`.

---

## App

Deferred until web matrix is green / remaining web chunks done.
