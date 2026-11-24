# All FAIL_GROW issues — Grow (`crediblesg`) vs Azure

**When:** 2026-11-13  
**Grow:** `https://uat-byufuel.crediblesg.com` · build `1.0.0 (20260922.1)`  
**Azure (baseline):** `https://u-byufuel.azurewebsites.net` · build `1.0.0 (20261014.1)`  
**Rule:** Works on Azure, missing/different on Grow → **FAIL_GROW**  
**Accounts:** Admin `amaan@crediblesg.com` · WH `mayurmwh1@byufuel.in`

---

## Master issues table

| ID | Surface | Module / screen | Control | Expected (Azure) | Actual (Grow) | Steps to reproduce | Evidence |
|----|---------|-----------------|---------|------------------|---------------|--------------------|----------|
| **UI-CONTAINER-01** | Admin web | Inventory → Container | **Add New Container** dropdown | Device · Camera · Manual | **Manual only** (Device + Camera missing) | 1. Login Admin on Grow. 2. Go to **Inventory → Container**. 3. Click **Add New Container**. 4. Observe menu options. 5. Repeat on Azure for baseline. | `02-add-container-menu-GROW.png` · `02-add-container-menu-AZURE.png` · deep-controls `admin-grow` / `admin-azure` |
| **UI-CONTAINER-02** | Admin web | Inventory → Container | **Transfer UCO** dropdown | Device · Camera · Manual | **Manual only** | 1. Same Container page. 2. Click **Transfer UCO**. 3. Observe menu. 4. Compare Azure. | `03-transfer-uco-menu-GROW.png` · `03-transfer-uco-menu-AZURE.png` |
| **UI-CONTAINER-01-WH** | WH Worker web | Container Management | **Add New Container** dropdown | Device · Camera · Manual | **Manual only** | 1. Login WH on Grow. 2. Open **Container Management**. 3. Click **Add New Container**. 4. Compare Azure WH. | `16-wh-Container-Management-AddNewContainer-GROW.png` · `16-wh-container-Add-AZURE.png` |
| **UI-CONTAINER-02-WH** | WH Worker web | Container Management | **Transfer UCO** dropdown | Device · Camera · Manual | **Manual only** | 1. Same WH Container page. 2. Click **Transfer UCO**. 3. Compare Azure WH. | `16-wh-Container-Management-TransferUCO-GROW.png` · `16-wh-container-Transfer-AZURE.png` |
| **UI-SCAN-01** | WH Worker web | Check in Oil → itinerary detail | **Scan** dropdown | Device · Camera · Manual | **Manual only** | 1. Login WH on Grow. 2. **Check in Oil**. 3. Open an **ARRIVED AT WAREHOUSE** itinerary (e.g. IT-000000335). 4. Click **Scan**. 5. On Azure WH, open ARRIVED IT (when available) and compare Scan menu. | `18-wh-checkin-IT335-GROW.png` · `18b-wh-checkin-Scan-menu-GROW.png` |
| **UI-SCAN-02** | WH Worker web | Collect Oil From Supplier → schedule detail | **Scan** dropdown | Device · Camera · Manual (Azure scan pattern) | **Manual only** | 1. Login WH on Grow. 2. **Collect Oil From Supplier**. 3. Open a schedule row (detail). 4. Click **Scan**. 5. Compare Azure WH Collect detail Scan when a row is available. | `wh-grow.json` collect-oil detail probe · deep-controls shots |
| **MDM-UCO-01** | Admin web | MDM → UCO Configuration → Add New | Add form fields | Includes **Template Body** + **Template Footer** (plus shared fields) | **Template Body** and **Template Footer** missing; other fields present | 1. Login Admin on Grow. 2. **MDM → UCO Configuration**. 3. Click **Add New UCO Configuration**. 4. Compare form labels to Azure Add form. | deep-controls form compare Admin UCO Config |
| **UI-PAY-01** | Admin web | Supplier Payment → detail / list **Pay** | **Pay** payment methods | **Cash · UPI · Card · Others** | **Cash only** (UPI/Card/Others missing) | 1. Login Admin on Grow + Azure. 2. Open **Supplier Payment** → VERIFIED payment View. 3. Click **Pay**. 4. Compare method menu. | `supplier-payment-Pay-detail-Cash-only-GROW.png` · `supplier-payment-Pay-detail-menu-AZURE.png` · `ISSUE-SUPPLIER-PAYMENT-PAY-BUTTON.md` |
| **SUP-NOTIF-01** | Supplier APK | Notifications after Admin Pay → **CREDITED** | **Payment Credited** push / in-app notif | Shows **Payment Credited** (e.g. SCH) — Centvis TC 39 prior PASS | **Not received** after payment credited | 1. Open Supplier APK Notifications. 2. Admin credits a VERIFIED payment for that supplier. 3. Check Supplier notif tray + in-app list. | `ISSUE-SUPPLIER-APK-PAYMENT-CREDITED-NOTIF.md` · baseline `_tmp-tc-extract.json` id 39 |
| **DRV-POPUP-01** | Driver APK | Itinerary stop after pickup complete | Post-complete modal | No **Pickup Started** modal after complete | **Pickup Started** popup (“please complete the pickup”) while stop is **Pickup Completed** | 1. Driver open IT. 2. Complete pickup for a stop. 3. Observe modal vs stop status. | `driver-pickup-completed-still-Pickup-Started-popup.png` · `ISSUE-DRIVER-PICKUP-STARTED-POPUP-AFTER-COMPLETE.md` |
| **DRV-GALLERY-01** | Driver APK | Pickup photo step (Before/After) | **Gallery upload** icon next to Capture | Opens gallery / photo picker | Icon **does not work** (no action) | 1. Driver open pickup on IT. 2. Tap gallery/upload icon beside **Capture**. 3. Observe. | `driver-pickup-gallery-upload-icon-not-working.png` · `ISSUE-DRIVER-GALLERY-UPLOAD-ICON.md` |
| **DRV-CAP-01** | Driver APK | Pickup → container quantity modal | **Capacity** after random container select | Real capacity (e.g. 100 Kg) | **Capacity: nullKg** | 1. Driver start pickup. 2. Select random/available container. 3. Open quantity modal. 4. Check Capacity label. | `driver-pickup-capacity-nullKg.png` · `ISSUE-DRIVER-CAPACITY-NULL-KG.md` |
| **COLLECT-01** | WH Collect Oil From Supplier | Schedule detail (e.g. SCH-000001825) | Collected vs Planned quantity | **Collected ≤ Planned** | Planned **20 kg** · Collected **90 kg** accepted | 1. WH Grow → Collect Oil From Supplier. 2. Open SCH with Planned kg. 3. Collect weight **> Planned**. 4. Observe summary. | `collect-oil-planned-20kg-collected-90kg-SCH1825-GROW.png` · `ISSUE-COLLECT-OIL-COLLECTED-GT-PLANNED.md` |

---

## Same issue family (one root cause)

| Family | IDs | Root cause (product) |
|--------|-----|----------------------|
| Scan / add menus Manual-only | UI-CONTAINER-01, UI-CONTAINER-02, UI-CONTAINER-01-WH, UI-CONTAINER-02-WH, UI-SCAN-01, UI-SCAN-02 | Grow build missing **Device** + **Camera** entry points on QR/scan menus |
| UCO config form incomplete | MDM-UCO-01 | Grow Add UCO Configuration form missing template fields vs Azure |
| Supplier Payment Pay methods incomplete | UI-PAY-01 | Grow **Pay** shows **Cash only**; Azure has Cash · UPI · Card · Others |
| Supplier Payment Credited notify missing | SUP-NOTIF-01 | Supplier APK missing **Payment Credited** notification after Admin credits payment |
| Driver stale Pickup Started modal | DRV-POPUP-01 | **Pickup Started** popup still shown after stop is **Pickup Completed** |
| Driver gallery upload broken | DRV-GALLERY-01 | Pickup **gallery upload** icon next to Capture does not open picker |
| Driver capacity null on random container | DRV-CAP-01 | Capacity renders **nullKg** when random container selected on pickup |
| Collected vs Planned not enforced | COLLECT-01 | Collect Oil allows **collected > planned**; should be **≤ planned** |

---

## Not logged as FAIL_GROW (for clarity)

| Item | Why not an issue |
|------|------------------|
| Admin sidenav modules | All present on Grow — MATCH |
| QR Generate modal fields | MATCH (No. of QR Codes · Choose Warehouse) |
| CS search placeholder | MATCH |
| Privacy policy text | MATCH |
| Terms stub | Broken on **both** → PARITY SAME |
| SCH-1814 ₹101 | Matches MDM Hyderabad Grade A **₹10/kg** + 1% GST on **both** envs → PARITY SAME vs Azure rate |
| CS Contacts vs search label | Label drift / NOTE only |

---

## Env / creds quick ref

| Role | Grow URL | Login |
|------|----------|-------|
| Admin | `https://uat-byufuel.crediblesg.com` | `amaan@crediblesg.com` / `Byufuel@2552` |
| WH | same | `mayurmwh1@byufuel.in` (password reset 2026-11-13 — see `byufuel/AGENTS.md`) |
| Azure Admin / WH | `https://u-byufuel.azurewebsites.net` | same emails; WH password in `AGENTS.md` |

Evidence folder: `byufuel/reports/parity-growexponential/crediblesg-2026-11-13/`
