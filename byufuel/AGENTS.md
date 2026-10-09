# Byufuel / Centvis — Agent memory (QA E2E)

**Read this first** before running any Byufuel flow. Keep in sync with `byufuel/reports/byufuel-drive/BYUFUEL-QA-E2E-HANDOFF.md`.

**Synced:** **2026-10-09** · Paths: `byufuel/scripts` · `byufuel/reports` · Cursor rule: `.cursor/rules/byufuel-qa-agent.mdc`

- Product: Used Cooking Oil (UCO) pickup → warehouse check-in → supplier payment (Centvis)
- Tracker hub: https://tracker.travelvip.ai/tasks/ENG-289 · rollup **QA-19**
- WH/TSM validate artifacts: `byufuel/reports/wh-*`, `byufuel/reports/tsm-*`
- Validated TCs (consolidated): https://docs.google.com/spreadsheets/d/1rJVj4JoioltjmqNuf1V2gCKdySs4CBY7KQq9PLgqDP8/edit
- Issues & Doubts: https://docs.google.com/spreadsheets/d/1fOaYRhkdAgidQMUgeWAWyAofSe7bqKkWRS210KGWa58/edit
- Source Drive TCs: https://drive.google.com/drive/folders/1d7rBDOrergmDUgd_0vmaqoz686L19tXY
- Client docs Drive: https://drive.google.com/drive/folders/1mISpkkLGxkkxxp4H9bprnaL_vt_aucMO
- Full narrative handoff: `byufuel/reports/byufuel-drive/BYUFUEL-QA-E2E-HANDOFF.md` (+ `.html`)

**Dev/UAT only — same Azure environment** (treat `u-byufuel` and `d-byufuel` as the same; do not invent a second stack).  
**Do not use tunnel/ngrok** unless the human pastes a live URL today.

---

## Environment (Azure Dev = UAT)

| What | URL / app |
|------|-----------|
| Web (either host) | `https://u-byufuel.azurewebsites.net` **or** `https://d-byufuel.azurewebsites.net` |
| API | `https://u-byufuel-api.azurewebsites.net` **or** `https://d-byufuel-api.azurewebsites.net` |
| Auth (Keycloak) | `https://d-byufuel-auth.azurewebsites.net` |
| Admin / WH Worker | Web browser |
| Driver / TSM / Area / City lead | App `com.byufuel.uat` |
| Supplier | App `com.byufuel.mobile` |

Prefer opening **`https://u-byufuel.azurewebsites.net`** for admin/WH. Same users work across this Azure Dev/UAT setup.

WH Worker: always **web** (APK hangs for Web-registered workers).

---

## Working credentials (Azure Dev/UAT)

### Primary working logins

| Role | Person | Login (email) | Password | Open |
|------|--------|---------------|----------|------|
| **Admin** | Amaan Khan | `amaan@crediblesg.com` | `Byufuel@2552` | Web |
| **Driver** | Hyd Driver1 · +91 2164797413 | `hyddriver1@yopmail.com` | `qTEFvE6#` | App `com.byufuel.uat` · vehicle Toyota Tx100 / Tx468 |
| **Driver** | Mayur More · +91 9282809291 | `mayur.more.byufuel@yopmail.com` | `M7ur#More` | App `com.byufuel.uat` · status **Registered** (KYC not uploaded, so not Active) · OA Hyderabad · Kukatpally Warehouse · licence `TS092026009291` valid 31/12/2030 · Tata Ace Mini Truck `TS09MA9291` · storage 800 kg, 420×170×185 cm · created 2026-10-06. Owner name/address/phone were submitted; API GET still returns those owner fields empty. Do not use `mayur.driver.byufuel@yopmail.com` (broken user, GET 500). |
| **Supplier** | Rohan SupplierQA · +91 9282809284 | `rohan.supplier.byufuel@yopmail.com` | `uBe9j#$A` | App `com.byufuel.mobile` · **ACTIVE** Hyderabad. Establishment: Rohan QA Kitchen, Restaurant, GSTIN `27AABCT1429B1Z1`, FSSAI `11223344556677`. Address: 12 Rohan QA Kitchen, Kondapur, Hyderabad 500084. Bank: HDFC `HDFC0000001` / `50100123456789` holder Rohan SupplierQA. KYC file + restaurant license file still not uploaded. |
| **TSM** | Rohan Bhagat | `rohan.tsm.byufuel@yopmail.com` | `R7m#Byuf` | App `com.byufuel.uat` · reports to AreaLead · password rotated 2026-10-06 (app forced change) |
| **WH Worker** | QA WHWorker · 9876501004 | `qa.whworker.byufuel@yopmail.com` | `w6!CcGzV` | **Web only** · WareOne · Supervisor |

### Area / City lead

| Role | Person | Login | Phone | Password |
|------|--------|-------|-------|----------|
| **Area Lead** | Rohan AreaLead | `rohan.area.byufuel@yopmail.com` | +91 9282809283 | Not stored — Admin → Reset Password if needed |
| **City Lead** | Rohan CityLead | `rohan.city.byufuel@yopmail.com` | +91 9282809282 | Not stored — Reset via Admin · App `com.byufuel.uat` |

Hierarchy: TSM → AreaLead → CityLead → Admin.

**City Lead scope (product clarification 2026-10-09 — supersedes older “view-only” notes):**  
City Lead can do the **same field actions as TSM** when suppliers are in scope (assigned / linked to that City Lead — typically via shared PIN / OA linkage, same pattern as TSM zipcodes). That includes:
- Raise **pickup** and **drop** (Sell Oil) requests
- **Create visits** and **track / view visits**
- Generally same actions as TSM (prospect / visit / request flows) once a supplier is assigned to them  

If no supplier is assigned to the City Lead → supplier list empty → cannot raise request or create visit for that supplier.

### Extra / alternate

| Role | Login | Password | Notes |
|------|-------|----------|-------|
| Admin (alternate) | `adminm@yopmail.com` | `Byufuel@12345` | Prefer amaan@ if it works |
| Driver (alternate) | `atul@yopmail.com` | Reset via Admin if needed | Vehicle `MH14GA1111` |
| Dummy driver | `qa.driver.byufuel@yopmail.com` | — | Not Active (no KYC) — skip for E2E |
| Supplier on schedule | `test21@gmail.com` · +91 2394450045 | Not stored | SCH-000001680 restaurant |

If login fails: Admin → user → **Reset Password**, then update this file.

### MDM / fixture hints

| Item | Value |
|------|-------|
| Warehouse | WareOne · `WH-000000046` |
| UCO contact (config) | `9876501099` / `qa.uco.config@yopmail.com` · GSTIN `27AABCT1429B1Z1` |

---


## Roles (who does what)

| Role | Surface | Does |
|------|---------|------|
| Admin | Web | MDM, approve requests, itinerary, assign driver, bulk schedules, TSM&Leads, zipcodes |
| Supplier | APK | Sell Oil / pickup request |
| Driver | APK | Accept → Start → Scan QR → qty → Documentation/challan → Arrive WH |
| WH Worker | Web | **Check in Oil** (not Collect Oil) |
| TSM | APK only | Prospect, visit, signup supplier, Sell Oil (pickup/drop) in assigned PINs |
| **City Lead** | APK `com.byufuel.uat` | **Same actions as TSM** when supplier is assigned to them: pickup + drop requests, create/track visits |
| Area Lead | APK `com.byufuel.uat` | Hierarchy above TSM — confirm case-by-case; do not assume view-only without checking assignment |

Hierarchy: TSM → Area Lead → City Lead → Admin.

---

## Visits (create + track) — TSM / City Lead

**Prerequisite:** Supplier (or prospect) must be in the user’s scope (PIN / assignment). No assigned supplier → empty search → cannot create visit.

### Create a visit (app `com.byufuel.uat`)

1. Login as **TSM** or **City Lead**
2. **Create Visit** / **Record a Visit** / **Add Visit**
3. Visit type: **Supplier** or **Prospect**
4. Search + select (establishment / name / PIN)
5. Remarks (+ follow-up date if shown)
6. **Save Visit** — toast “Visit created successfully”  
   (May warn if not near location; can continue)

### Track visits

- App **Visits** / **Recent Visits** / **View Visit** — list by date range / search / zipcode
- Admin **Suppliers** table also shows visit columns: Visited By, Visit Completed Date, Latest Visit Remark, Follow Up Date

---

## Happy-path E2E (run in this order)

```
1) Admin MDM ready: OA, warehouse, time slots, UCO config, rates (Grade A)
2) Active Supplier + Active Driver (with vehicle/KYC) + WH worker on that warehouse
3) Pickup request: Supplier APK Sell Oil  OR  Admin bulk  OR  TSM Sell Oil
4) Admin: approve schedule if needed
5) Admin: Create itinerary → ASSIGN driver (must move itinerary to Driver Assigned)
6) Driver APK: Accept → Start → Scan JSON QR {"Code":"…"} → qty/grade/photo
7) Driver: Documentation → sign Driver+FBO → Generate challan → Arrive at warehouse
8) WH web: Check in Oil only → open Arrived IT → Scan/Verify → Confirm → Complete
9) Admin: Supplier Payment after verified check-in
```

**Never** use **Collect Oil from Supplier** for a driver delivery itinerary — that path can force **Missing / Pending Investigation**.

---

## Clean reference booking (do not use contaminated IDs)

| Item | Value |
|------|-------|
| Schedule | `SCH-000006623` |
| Itinerary | `IT-000001188` |
| Driver | Atul Ugale · `MH14GA1111` |
| Container | `B-2609-3-00005` (10 kg Grade A) |
| Reached | Arrived At Warehouse |

**Bad reference (avoid):** `IT-000001186` / `SCH-000006622` — Collect Oil + reused QR → Missing / Pending Investigation.

---

## Known blockers (as of handoff)

1. WH **Check in Oil → Scan** can crash (`gradeIds`); Confirm Checkin never enables → payment often unverified
2. After driver pickup, itinerary detail may show `containerId: null`
3. Generate QR creates **new** container; does not attach QR to existing
4. Driver QR: app wants JSON `{"Code":"B-…"}`; plain code often Invalid QR
5. Dummy driver without KYC: Approve → HTTP 500
6. Partial assign: schedule DRIVER ASSIGNED but itinerary still CREATED → no Accept
7. Bulk TC05: replace existing recurring — **no confirm popup** (FAIL) — silent second BR
8. Checklist `#28` Collect Oil — PARTIAL (wrong path for driver IT)
9. WH **Generate Documentation** under Collect Oil — **not completed** (never reached cleanly; not a separate scored row)

---

## Validated sheet map (where cases live)

| Tab | Source pack |
|-----|-------------|
| `01-Checklist` | Byufuel - Check list Doc.xlsx |
| `02-Bulk-Schedule` | Byufuel - Bulk Schedule web TC's.xlsx |
| `03-TSM-Web` / `04-TSM-Mobile` | TSM Web / Mobile xlsx |
| `TC-*` | Byufuel-TC's.xlsx |

Scoreboard (last known): ~262 PASS / 55 FAIL / 18 PARTIAL on consolidated sheet.

Important IDs:
- Bulk recurring create: **TC03** PASS (`BR-000000051`)
- Bulk recurring replace confirmation: **TC05** FAIL (`BR-000000052`, no popup)
- Collect Oil: checklist **#28** PARTIAL
- Checkin Oil: checklist **#27**

---

## How this agent should work

1. Default: Azure **Dev/UAT same** — `https://u-byufuel.azurewebsites.net` (or d-byufuel). Creds in this file. Never start from tunnel/ngrok.
2. Prefer **no live book** of extra supplier money paths unless asked; still OK to create schedules on UAT when running E2E.
3. Clone/mutate one field at a time for negatives; log PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED.
4. After a run: update Validated sheet row + Activity on ENG-289 (date · env · IDs · result · next step).
5. If Check in Oil scan fails: **stop** — do not workaround via Collect Oil.
6. Read full steps/screenshots notes in `BYUFUEL-QA-E2E-HANDOFF.md` before improvising.

---

## Colleague kickoff prompt (paste to agent)

```
You are taking over Byufuel / Centvis QA E2E from Rohan.

1. Read byufuel/AGENTS.md (Azure Dev/UAT is the SAME env — URLs + all working passwords) and byufuel/reports/byufuel-drive/BYUFUEL-QA-E2E-HANDOFF.md.
2. Open Tracker ENG-289 and the Validated TCs Google Sheet linked there.
3. Use Azure web https://u-byufuel.azurewebsites.net (same as d-byufuel). Admin amaan@crediblesg.com. Driver/TSM: com.byufuel.uat. Supplier: com.byufuel.mobile. WH: web. Do NOT use tunnel/ngrok.
4. Creds are in byufuel/AGENTS.md. If login fails, reset via Admin and tell me.
5. Goal: happy path through driver Arrive-at-WH, then WH Check in Oil only.
6. Do not use Collect Oil for driver itineraries.
7. Report: Step | Result | Evidence (SCH/IT/BR/screenshot).
8. Ask before creating many new schedules.
```
