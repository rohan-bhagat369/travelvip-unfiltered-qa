# Grow (crediblesg) vs Azure — Admin + WH Web parity

**When:** 2026-11-13  
**Rule:** Azure = baseline. Grow differs → **FAIL_GROW**  
**Grow URL (new):** `https://uat-byufuel.crediblesg.com` · build `1.0.0 (20260922.1)`  
**Azure URL:** `https://u-byufuel.azurewebsites.net` · build `1.0.0 (20261014.1)`  
**Accounts:** Admin `amaan@crediblesg.com` · WH `mayurmwh1@byufuel.in` (password reset during run — see AGENTS.md)  
**Evidence:** this folder (`crediblesg-2026-11-13/`)

---

## Summary

| Area | Result |
|------|--------|
| Admin login (same creds) | **PASS** |
| Admin sidenav (all modules present) | **MATCH** |
| Admin list pages (load + primary CTAs) | **MATCH** (24/24 opened) |
| WH login + WH sidenav | **PASS** (after Admin reset) |
| Open FAIL_GROW | **4** (scan/add menus Manual-only) |
| PARITY SAME (not Grow-only) | Terms stub; Hyderabad rate ₹10 → SCH-1814 ₹101 |

---

## A. Admin — sidenav inventory

| Module | Azure | Grow (crediblesg) | Status |
|--------|-------|-------------------|--------|
| Dashboard | Yes | Yes | MATCH |
| Admin Users | Yes | Yes | MATCH |
| TSM & Leads | Yes | Yes | MATCH |
| TSM ZipCodes | Yes | Yes | MATCH |
| WH Workers | Yes | Yes | MATCH |
| Drivers | Yes | Yes | MATCH |
| Prospects | Yes | Yes | MATCH |
| Suppliers | Yes | Yes | MATCH |
| Roles | Yes | Yes | MATCH |
| Create Bulk Request | Yes | Yes | MATCH |
| View Bulk Requests | Yes | Yes | MATCH |
| Manage Requests | Yes | Yes | MATCH |
| Itinerary Management | Yes | Yes | MATCH |
| Warehouse Management | Yes | Yes | MATCH |
| MDM Types / UCO Config / Time Slots / Countries / Rate Config / OA | Yes | Yes | MATCH |
| Generate QR Codes | Yes | Yes | MATCH |
| Vehicles / Container / UCO | Yes | Yes | MATCH |
| Supplier Payment | Yes | Yes | MATCH |
| Supplier Penalty | Yes | Yes | MATCH |
| Customer Support | Yes | Yes | MATCH |
| Chat Settings | Yes | Yes | MATCH |
| Incoming Deliveries | Yes | Yes | MATCH |
| Reports | Yes | Yes | MATCH |

Screens: `01-admin-dashboard-GROW.png` · `01-admin-dashboard-AZURE.png`

---

## B. Admin — deep interactive (FAIL_GROW style)

| ID | What tested | Steps | Azure | Grow | Verdict | Screenshots |
|----|-------------|-------|-------|------|---------|-------------|
| UI-CONTAINER-01 | Add New Container menu | Admin → Inventory → Container → **Add New Container** | Device · Camera · Manual | **Manual only** | **FAIL_GROW** | `02-add-container-menu-GROW.png` · `02-add-container-menu-AZURE.png` |
| UI-CONTAINER-02 | Transfer UCO menu | Same page → **Transfer UCO** | Device · Camera · Manual | **Manual only** | **FAIL_GROW** | `03-transfer-uco-menu-GROW.png` · `03-transfer-uco-menu-AZURE.png` |
| UI-QR-01 | Generate QR modal | Generate QR Codes → **Generate QR Codes** | No. of QR Codes · Choose Warehouse | Same | **MATCH** | `05-generate-qr-modal-GROW.png` · `05-generate-qr-modal-AZURE.png` |
| UI-CS-01 | CS Messages search placeholder | Customer Support → Messages | `Search by name or reference no` | Same | **MATCH** | `07-customer-support-GROW.png` · `07-customer-support-AZURE.png` |
| UI-CS-02 | CS contacts control | Same | `search` control | **Contacts** button | **NOTE** (Grow has control; label differs) | same CS shots |
| UI-LEGAL-01 | Privacy `/policy` | Footer → Privacy Policy | Full policy text (~2699) | Full policy text (~2699) | **MATCH** | `08-privacy-GROW.png` · `08-privacy-AZURE.png` |
| UI-LEGAL-02 | Terms `/terms` | Footer → Terms | Stub `TERMS AND CONDITIOINS` | Same stub | **PARITY SAME** (both weak) | `09-terms-GROW.png` · `09-terms-AZURE.png` |
| MDM-RATE-01 | Hyderabad Grade A rate | MDM → Rate Configuration → OA rates | **₹10.00 / KG** · 1% GST | **₹10.00 / KG** · 1% GST | **MATCH** | `06b-rate-rows-GROW.png` · `06b-rate-rows-AZURE.png` |
| E2E-AMT-01 | SCH-000001814 amounts | Supplier Payment list | (empty list this pass on Azure) | 10 kg · Est/Actual **₹101.00** · VERIFIED · Pay | **PARITY SAME vs rate** (10×10 +1% GST=101). Not Grow-only vs Azure rate. Prior “expect ₹295” ≠ current MDM ₹10. | `04c-supplier-payment-rows-GROW.png` |

### Issue steps — UI-CONTAINER-01 / 02 (Admin)

1. Login Admin on Grow: `https://uat-byufuel.crediblesg.com`  
2. Open **Inventory → Container**  
3. Click **Add New Container** → menu shows only **Manual** (missing Device + Camera)  
4. Click **Transfer UCO** → menu shows only **Manual**  
5. Repeat on Azure → Device · Camera · Manual present  

### Issue steps — WH scan menus (below)

Same pattern: Device + Camera missing on Grow.

---

## C. Admin — module fingerprint (list load)

All Grow Admin modules opened; none shell-only. Primary CTAs present.

| Path | Title / CTA | Empty list? | Status |
|------|-------------|-------------|--------|
| `/uam/admin-users` | Add Admin User | No | PASS |
| `/uam/tsm-leads` | Add TSM and Leads | No | PASS |
| `/uam/tsm-zipcodes` | list | No | PASS |
| `/uam/wh-users` | Add Worker | No | PASS |
| `/uam/drivers` | Add New Driver | No | PASS |
| `/uam/prospects` | list | No | PASS |
| `/uam/suppliers` | Add New Supplier | No | PASS |
| `/uam/roles` | New Role | No | PASS |
| `/byu/suppliers` | Create Bulk Schedule Request | No | PASS |
| `/byu/bulk-uco-schedule-requests` | View Bulk | Yes (0 data) | PASS (page OK) |
| `/byu/uco-schedules` | New Schedule | No | PASS |
| `/byu/uco-schedule-itineraries` | New Itinerary | No | PASS |
| `/uam/warehouses` | Add New Warehouse | No | PASS |
| `/mdm/types` | list | No | PASS |
| `/mdm/uco-configuration` | Add New UCO Configuration | No | PASS |
| `/mdm/time-slots` | Add New Time Slot | No | PASS |
| `/mdm/countries` | Add New Country | No | PASS |
| `/mdm/operational-areas` | Add New Operational Area | No | PASS |
| `/byu/vehicles` | Add New Vehicle | No | PASS |
| `/byu/uco` | list | No | PASS |
| `/byu/supplier-cancellation-amounts` | list | Yes | PASS (page OK) |
| `/byu/chat-settings` | Add New Chat Setting | No | PASS |
| `/byu/incoming-deliveries` | list | No | PASS |
| `/byu/reports` | Reports form | No | PASS |

---

## D. WH Worker web

| Check | Azure | Grow (crediblesg) | Verdict |
|-------|-------|-------------------|---------|
| Login | PASS (after reset `wK1q@C78`) | PASS (after reset `tRs18#Nl`) | PASS |
| Nav modules | Dashboard, Generate QR, Container, Check in Oil, Collect Oil | Same 5 | MATCH |
| Container → Add New | Device · Camera · Manual | **Manual only** | **FAIL_GROW** |
| Container → Transfer UCO | Device · Camera · Manual | **Manual only** | **FAIL_GROW** |
| Check in Oil list | Loads | Loads (IT-335 ARRIVED etc.) | MATCH |
| Check in → IT detail → **Scan** | (no ARRIVED row this Azure pass) · prior Azure baseline Device·Camera·Manual · Admin/WH container Azure confirmed Device·Camera·Manual | **Manual only** on IT-000000335 | **FAIL_GROW** |
| Collect Oil From Supplier | Nav present | List loads (SCH-1816 APPROVED) | MATCH (list) |

Screens:  
- Grow WH: `15-wh-dashboard-GROW.png` · `16-wh-Container-*-GROW.png` · `18-wh-checkin-IT335-GROW.png` · `18b-wh-checkin-Scan-menu-GROW.png`  
- Azure WH: `15-wh-dashboard-AZURE.png` · `16-wh-container-Add-AZURE.png` · `16-wh-container-Transfer-AZURE.png` · `17-wh-checkin-AZURE.png`

### Issue steps — WH Check-in Scan (UI-SCAN-01)

1. Login WH on Grow (`mayurmwh1@byufuel.in`)  
2. **Check in Oil** → open itinerary **IT-000000335** (ARRIVED AT WAREHOUSE)  
3. Click **Scan** → only **Manual**  
4. Azure WH Container Add/Transfer still shows Device · Camera · Manual (same build pattern expected for Scan)

---

## E. Open FAIL_GROW (this URL)

| # | ID | Surface | Issue |
|---|-----|---------|-------|
| 1 | UI-CONTAINER-01 | Admin + WH | Add New Container: missing Device + Camera |
| 2 | UI-CONTAINER-02 | Admin + WH | Transfer UCO: missing Device + Camera |
| 3 | UI-SCAN-01 | WH Check-in | Scan menu: Manual only (Device + Camera missing) |
| 4 | (same family) | WH Container | Same Manual-only as Admin |

---

## F. Not Grow-only / notes

| Item | Note |
|------|------|
| Terms page | Both envs show stub `TERMS AND CONDITIOINS` |
| SCH-1814 ₹101 | Matches MDM Hyderabad Grade A **₹10/kg** + 1% GST on **both** Grow and Azure rates |
| Build lag | Grow `20260922.1` vs Azure `20261014.1` |
| Azure Supplier Payment | List empty (`0 of 0`) this pass — data/filter, not missing module |
| WH passwords | Reset during this run; updated in `byufuel/AGENTS.md` |

---

## G. Still not covered this pass

- Completing Pay on SCH-1814  
- Full Check-in confirm / Collect Oil happy path  
- MDM negative validations  
- APK / mobile surfaces  
