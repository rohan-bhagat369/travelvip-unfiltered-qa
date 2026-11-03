# Day 1 — Grow login matrix (Azure users on TravelVIP)

**Date:** 2026-11-03  
**Candidate:** `https://uat-byufuel.growexponential.app/` · build `1.0.0 (20260922.1)`  
**Baseline creds:** Azure UAT users from `byufuel/AGENTS.md`  
**Phone:** motorola edge 40 neo · APKs `com.byufuel.uat` / `.driver` / `.supplier` / `.tsm` / `com.byufuel.mobile.dev`

## Rule
Azure user emails on Grow → login web and/or APK.  
`PASS` · `FAIL_GROW` · `BLOCKED` · `NOT TESTED`

---

## Web logins (done)

| # | Role | Email | Result | Evidence |
|---|------|-------|--------|----------|
| 1 | Admin | `amaan@crediblesg.com` / `Byufuel@2552` | **PASS** → Dashboard as **Amaan Khan · Admin User** | `01-admin-amaan-dashboard.png` |
| 2 | WH Worker | `rohan.wh.byufuel@yopmail.com` / `AuI8N#u0` (reset today) | **PASS** → Dashboard as **Rohan WHQA · Warehouse Worker** · menus: Check in Oil, Collect Oil, Generate QR | `03-wh-rohan-dashboard.png` |
| 3 | WH Worker (Azure primary) | `qa.whworker.byufuel@yopmail.com` | **NOT TESTED / missing on Grow** — Quick search → NO DATA | Use Rohan WHQA instead |
| 4 | Area Lead | `rohan.area.byufuel@yopmail.com` | Password reset **PASS** → `LZ0F!JXe` · APK login **NOT TESTED** yet | `02-area-reset-password.png` |
| 5 | City Lead | `rohan.city.byufuel@yopmail.com` | Password reset **PASS** → `m6J4r1@Q` · APK login **NOT TESTED** yet | — |

## User inventory on Grow (search)

| Role | Azure email | On Grow? | Status |
|------|-------------|----------|--------|
| Admin | `amaan@crediblesg.com` | Yes | ACTIVE (login PASS) |
| TSM | `rohan.tsm.byufuel@yopmail.com` | Yes | ACTIVE |
| Area Lead | `rohan.area.byufuel@yopmail.com` | Yes | ACTIVE |
| City Lead | `rohan.city.byufuel@yopmail.com` | Yes | ACTIVE |
| Supplier | `rohan.supplier.byufuel@yopmail.com` | Yes | present (Restaurant) |
| Driver | `hyddriver1@yopmail.com` | Yes | ACTIVE · Hyderabad Warehouse |
| Driver | `mayur.more.byufuel@yopmail.com` | Yes | REGISTERED (no KYC) |
| WH | `qa.whworker.byufuel@yopmail.com` | **No** | — |
| WH | `rohan.wh.byufuel@yopmail.com` | Yes | ACTIVE · Kukatpally |

---

## APK logins (done 2026-11-03)

| Package | User | Password | Result | Evidence |
|---------|------|----------|--------|----------|
| `com.byufuel.uat.tsm` | `rohan.tsm.byufuel@yopmail.com` | `R7m#Byuf` | **PASS** · Hi Rohan · Request Pickup / Prospect / Visit | `apk-tsm.png` |
| `com.byufuel.uat.supplier` | `rohan.supplier.byufuel@yopmail.com` | `d7QS#Lcw` (reset) | **PASS** · Hi Rohan · Sell Oil · Rohan QA Kitchen | `apk-supplier.png` |
| `com.byufuel.uat.driver` | `hyddriver1@yopmail.com` | `BEwPIe#5` (reset) | **PASS** · Home / Upcoming / Planned / Collected | `apk-driver.png` |

Note: Supplier shows “Please upload KYC documents.” banner — still usable for smoke.

---

## Passwords reset today (Grow Admin)

| User | New password |
|------|----------------|
| Area Lead `rohan.area.byufuel@yopmail.com` | `LZ0F!JXe` |
| City Lead `rohan.city.byufuel@yopmail.com` | `m6J4r1@Q` |
| WH `rohan.wh.byufuel@yopmail.com` | `AuI8N#u0` |

Also written into `byufuel/AGENTS.md`.

---

## Next session
1. APK login matrix (TSM / Supplier / Driver / Area / City)  
2. Web MDM inventory parity (OA / WH / rates)  
3. Happy-path E2E on Grow with these users
