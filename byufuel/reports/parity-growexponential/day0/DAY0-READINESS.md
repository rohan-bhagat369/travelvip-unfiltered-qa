# Day 0 — Grow parity readiness (vs Azure UAT)

**Date:** 2026-10-26  
**Candidate:** `https://uat-byufuel.growexponential.app/`  
**Baseline:** `https://u-byufuel.azurewebsites.net`  
**Scope:** Login + menu + seeded users/MDM inventory only. **No E2E / no Check-in / no Collect Oil.**

---

## Chunk result: Admin login

| Check | Grow | Verdict |
|-------|------|---------|
| Login page loads | `/auth/login` · Version `1.0.0 (20260922.1)` | PASS |
| Admin login | `parity.admin@byufuel.localhost` → `/dsh/dashboard` as **Mayur More** | PASS |
| Wrong-flow avoided | Did not open Check-in / Collect Oil / create SCH | OK |

Screenshot: `01-admin-dashboard.png`

---

## Admin menu (Grow) — present

Matches expected Azure admin surface:

| Module | Present |
|--------|---------|
| Dashboard | Yes |
| User Management → Admin, TSM & Leads, TSM ZipCodes, WH Workers, Drivers, Prospects, Suppliers, Roles | Yes |
| Request Management → Bulk create/view, Manage Requests | Yes (dashboard tiles) |
| Itinerary Management | Yes |
| Warehouse Management | Yes |
| MDM → Types, UCO Configuration, Time Slots, Countries, Rate Configuration, Operational Areas | Yes |
| Generate QR Codes | Yes |
| Inventory → Vehicles, Container, UCO | Yes (dashboard) |
| Supplier Payment / Penalty | Yes |
| Customer Support / Chat Settings | Yes |
| Incoming Deliveries / Reports | Yes |

**Note:** **Check in Oil** / **Collect Oil** are **not** on Admin nav (same as Azure — WH worker web menus). Confirm in a later chunk after WH login.

---

## Seeded users (Grow inventory)

| Role | Count (Active list) | Sample | Notes |
|------|---------------------|--------|-------|
| Admin (login) | 1 used | `parity.admin@byufuel.localhost` → Mayur More | `/uam/admin-users` showed **NO DATA AVAILABLE** (odd; do not loop — ask Dev / try filters next chunk) |
| Drivers | 2 | `mobile.driver@byufuel.localhost` ACTIVE · Trailer `MOBILETEST01` · Magarapatta · Pune | Also `mayur1@driver.com` / `MH12AY3232` |
| Suppliers | 3 | `mobile.supplier@byufuel.localhost` · Kalika / Mayur Enterprises | All ACTIVE · OA **Pune** · pin 411036 / 411028 |
| TSM & Leads | 1 | `mobile.tsm@byufuel.localhost` · TSM · Pune | **No Area Lead / City Lead** seeded |
| WH Workers | 1 | `mayurm@whworker.com` · Supervisor · Magarapatta · ACTIVE | Password **unknown** |

---

## MDM readiness (Grow)

| Item | Grow | Ready for later E2E? |
|------|------|----------------------|
| Operational Area | **Pune** (1) | Yes (different from Azure Mumbai — expected) |
| Warehouse | **Magarapatta Warehouse** ACTIVE · 1000 kg | Yes |
| Time slots | 1 row · Pune · From `1` To `24` | Yes (wide slot; UI still raw 1–24 like Azure) |
| UCO config | Pune · INR · min **1 kg** · max **100 kg** | Yes |
| Rate | Pune · Grade **A** · **₹10.00 / KG** | Yes (Azure QA used ₹100/kg — different seed, not a menu miss) |
| QR codes | `B-2610-Pune-00001` · Magarapatta · Byufuel | At least 1 exists |

---

## Existing data (do not reuse blindly)

| Type | IDs | Status |
|------|-----|--------|
| Requests | 7 total | e.g. `SCH-000000007` REQUEST PLACED; `SCH-000000005` **DELIVERED AT WAREHOUSE** |
| Itineraries | 3 | `IT-000000003` DELIVERED; `IT-000000002` **ARRIVED AT WAREHOUSE**; `IT-000000001` DRIVER ASSIGNED |

Useful later: `IT-000000002` may be a WH Check-in candidate — **only after WH login + confirm Check in Oil path**.

---

## Blockers (stop here — need you)

1. **Passwords** for Grow roles (Admin password known; others not):
   - WH: `mayurm@whworker.com`
   - Driver: `mobile.driver@byufuel.localhost` (and/or `mayur1@driver.com`)
   - Supplier: `mobile.supplier@byufuel.localhost` (and/or Kalika / Mayur suppliers)
   - TSM: `mobile.tsm@byufuel.localhost`
2. **Mobile APK / API base** for Grow — same Azure APKs will **not** hit this dump. Need Grow-pointed build or config before any Driver/Supplier/TSM app chunk.
3. Optional: why **Admin Users** list is empty while logged in as admin.

---

## Day 0 verdict

| Area | Status |
|------|--------|
| Grow admin login + full admin menu | **PASS** |
| MDM + WH + Active Driver/Supplier/TSM/WH seeded | **PASS (readiness)** |
| Full module parity vs Azure | **NOT STARTED** (Day 0 only) |
| WH Check-in / mobile E2E | **BLOCKED** (creds + APK) |

**Next chunk (when unblocked):** Day 1a — WH web login only → confirm **Check in Oil** + **Collect Oil** menus exist (no scan yet).  
Or Day 1b — Admin Request Management list filters / Approve UI smoke (web-only, no book) if you prefer staying on admin.
