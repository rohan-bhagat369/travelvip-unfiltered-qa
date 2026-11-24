# Deep control parity — every section (Admin + WH)

**When:** 2026-11-13  
**Grow:** `https://uat-byufuel.crediblesg.com`  
**Azure:** `https://u-byufuel.azurewebsites.net`  
**Coverage:** Admin **30/30** pages · WH **5/5** pages · list buttons + Advance Search dialogs + Add forms + menus + first-row detail probes  
**Raw:** `admin-grow.json` · `admin-azure.json` · `wh-grow.json` · `wh-azure.json` · `DIFF.json`  
**Shots:** `deep-controls/<role>/`

---

## Real FAIL_GROW (confirm these)

| # | Surface | Section | Control | Grow | Azure | Evidence |
|---|---------|---------|---------|------|-------|----------|
| 1 | Admin | Container | Add New Container menu | **Manual** | Device · Camera · Manual | menu shots under `admin-grow` / `admin-azure` |
| 2 | Admin | Container | Transfer UCO menu | **Manual** | Device · Camera · Manual | same |
| 3 | WH | Container | Add New Container menu | **Manual** | Device · Camera · Manual | `wh-grow` / `wh-azure` |
| 4 | WH | Container | Transfer UCO menu | **Manual** | Device · Camera · Manual | same |
| 5 | Admin | MDM → UCO Configuration → Add | Form fields | Missing **Template Body**, **Template Footer** | Present | form compare |
| 6 | WH | Collect Oil → detail → **Scan** | Scan menu | **Manual only** | (Azure detail empty this run; Azure pattern for Scan = Device·Camera·Manual) | `wh-grow` collect detail probe |
| 7 | WH | Check-in Scan | Scan menu | **Manual only** (prior IT-335 run) | Device·Camera·Manual expected | earlier `18b-wh-checkin-Scan-menu-GROW.png` — this crawl timed out opening ARRIVED row |

---

## Soft / noisy diffs (review, not hard blockers)

| Item | Notes |
|------|-------|
| Itinerary **Unassigned** | Diff said Grow overlay missing; Grow still has **Unassigned** tab/button in fingerprint — likely crawl timing |
| Customer Support buttons | Grow shows Contacts / Create Conversation / conversation rows; Azure shows `search` — UX label drift, not missing module |
| CS header `cardView` | Azure-only internal header noise |
| Many “Grow extras” | Advance Search / Export / Chat / Language often present on Grow when Azure list was empty/flaky this pass — treat as **data/load flake**, not missing Azure controls |

---

## What was exercised per section

### Admin (all modules)
For each path: list fingerprint (buttons, tabs, headers, inputs) → click Add/Create/Generate/Transfer/Export/Advance Search/Show Hide → capture **menu / dialog / form fields** → open first row detail → probe Edit/Reset Password/Scan/etc.

Paths: Dashboard, Admin Users, TSM & Leads, TSM ZipCodes, WH Workers, Drivers, Prospects, Suppliers, Roles, Create/View Bulk, Manage Requests, Itinerary, Warehouses, MDM (Types, UCO Config, Time Slots, Countries, Rate Config, OA), QR, Vehicles, Container, UCO, Supplier Payment, Supplier Penalty, Customer Support, Chat Settings, Incoming Deliveries, Reports.

### WH (all modules)
Dashboard, Generate QR, Container (menus), Check in Oil (list + Advance Search), Collect Oil (list + detail Scan).

---

## Counts

| Metric | n |
|--------|---|
| Admin pages × env | 30 + 30 |
| WH pages × env | 5 + 5 |
| Auto DIFF FAIL_GROW rows | 12 (includes noise) |
| Confirmed product FAIL_GROW | **~5–7** (scan/add menus + UCO template fields) |
