# Grow Expo vs Azure — Admin Web parity matrix

**When:** 2026-11-09  
**Rule:** Azure = baseline. Grow differs → **FAIL_GROW**  
**Accounts:** Admin `amaan@crediblesg.com` on both  

| Env | URL | Build (footer) |
|-----|-----|----------------|
| Grow | `https://uat-byufuel.growexponential.app` | `1.0.0 (20260922.1)` |
| Azure | `https://u-byufuel.azurewebsites.net` | (Centvis) |

## Method (pass 1 — Admin web)

1. Login Admin both sides.  
2. Compare **full sidenav** (all module links).  
3. Fingerprint each list page (title, headings, primary actions, table headers, tabs, placeholders).  
4. Deep-check interactive menus/dialogs the same way prior FAIL_GROW issues were found.  

Evidence folder: `byufuel/reports/parity-growexponential/web-full-parity-2026-11-09/`

---

## A. Sidenav / module inventory

| Module | Azure | Grow | Status |
|--------|-------|------|--------|
| Dashboard | Yes | Yes | MATCH |
| User Management → Admin Users, TSM & Leads, TSM ZipCodes, WH Workers, Drivers, Prospects, Suppliers, Roles | Yes | Yes | MATCH |
| Request Management → Create Bulk / View Bulk / Manage Requests | Yes | Yes | MATCH |
| Itinerary Management | Yes | Yes | MATCH |
| Warehouse Management | Yes | Yes | MATCH |
| MDM → Types, UCO Config, Time Slots, Countries, Rate Config, Operational Areas | Yes | Yes | MATCH |
| Generate QR Codes | Yes | Yes | MATCH |
| Inventory → Vehicles, Container, UCO | Yes | Yes | MATCH |
| Supplier Payment | Yes | Yes | MATCH |
| Supplier Penalty | Yes | Yes | MATCH |
| Customer Support | Yes | Yes | MATCH |
| Chat Settings | Yes | Yes | MATCH |
| Incoming Deliveries | Yes | Yes | MATCH |
| Reports | Yes | Yes | MATCH |

**No Admin sidenav module missing on Grow** in this pass.

---

## B. Deep interactive checks (your FAIL_GROW style)

| ID | Area | Azure (baseline) | Grow | Verdict |
|----|------|------------------|------|---------|
| UI-CONTAINER-01 | Container → **Add New Container** menu | Device · Camera · Manual | **Manual only** | **FAIL_GROW** (still open) |
| UI-CONTAINER-02 | Container → **Transfer UCO** menu | Device · Camera · Manual | **Manual only** | **FAIL_GROW** (still open) |
| UI-QR-01 | Generate QR Codes modal fields | No. of QR Codes · Choose Warehouse | Same | **MATCH** (prior extra Grow fields not present now) |
| UI-CS-01 | CS Messages search placeholder | `Search by name or reference no` | Same | **MATCH** (fixed vs 2026-11-04) |
| UI-CS-02 | CS contact / Contacts control | `search` control present | `Contacts` button present | **NEEDS visual confirm** (likely improved) |
| UI-LEGAL-01 | `/policy` Privacy | Full policy text | Full policy text | **MATCH** (fixed vs empty stub) |
| UI-LEGAL-02 | `/terms` Terms | Shows only `TERMS AND CONDITIOINS` | Same stub | **BOTH weak on `/terms`** — not Grow-only; recheck Azure settings path if product hosts full Terms elsewhere |
| E2E-AMT-01 | Supplier Payment SCH-000001814 | (row not on Azure list this pass) | Est/Actual **₹101.00** · status **VERIFIED** · Pay | **FAIL_GROW** amount vs expected **₹295** (10kg × rate) |

### Evidence

| Check | Grow | Azure |
|-------|------|-------|
| Add Container menu | `add-container-menu-GROW.png` | `add-container-menu-AZURE.png` |
| Transfer UCO menu | `transfer-uco-menu-GROW.png` | `transfer-uco-menu-AZURE.png` |
| Supplier Payment SCH-1814 | `supplier-payment-SCH1814-GROW.png` | — |

---

## C. List-page fingerprint notes (Admin)

| Module | Notes |
|--------|-------|
| Most CRUD lists | Same primary CTAs + same core table headers |
| Container list | Grow has extra **ACTIVE/INACTIVE** column (Grow has more, not less) |
| Supplier Payment | Grow shows **Pay** on VERIFIED SCH-1814; amounts ₹101 |
| Warehouse Management | Grow list rendered `0 of 0` in fingerprint — recheck data/OA filter next |
| Azure flaky loads | Some pages briefly returned empty shell (`BYUFUEL \| Centvis` only) during crawl — re-hit before calling missing |

---

## D. Still to cover (next)

1. **WH Worker web** (Rohan WHQA / Mayur WH) — Check in Oil, Collect Oil, Generate QR, Container (scan menus).  
2. Re-confirm CS Contacts icon visually (screenshot both).  
3. Open SCH-1814 Pay flow on Grow (do not complete unless asked).  
4. MDM Rate Configuration values Hyderabad Grade A (₹295 expected).  
5. Footer Privacy/Terms from logged-out login page vs in-app.  

---

## Open FAIL_GROW (Admin web, this pass)

1. **UI-CONTAINER-01** — Add New Container missing Device + Camera  
2. **UI-CONTAINER-02** — Transfer UCO missing Device + Camera  
3. **E2E-AMT-01** — SCH-1814 Supplier Payment **₹101** (expected ₹295)  
