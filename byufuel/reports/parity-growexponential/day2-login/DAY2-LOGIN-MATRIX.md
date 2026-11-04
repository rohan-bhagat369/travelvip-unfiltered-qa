# Day 2 — Grow UAT login recheck (2026-11-04)

**Env:** `https://uat-byufuel.growexponential.app`  
**Phone:** connected via adb (`13694270250004R`) · APKs `com.byufuel.uat.driver` / `.tsm` / `.supplier` · **v1.1.0 (15)**  
**Tracker:** ENG-639

## Results

| # | Channel | Account | Status | Evidence |
|---|---|---|---|---|
| 1 | Web Admin | `amaan@crediblesg.com` | **PASS** → Dashboard · **Amaan Khan · Admin User** · full admin nav (User Mgmt, Requests, MDM, Inventory…) | `01-admin-amaan-dashboard.png` |
| 2 | Web WH | `rohan.wh.byufuel@yopmail.com` | **PASS** → Dashboard · **Rohan WHQA · Warehouse Worker** · Generate QR / Container / Check in Oil / Collect Oil | `03-wh-rohan-dashboard.png` |
| 3 | APK Driver | `hyddriver1@yopmail.com` | **PASS** → Home · Scan / Planned / Collected / Delivered · Upcoming / History / Reports | `apk-driver.png` |
| 4 | APK TSM | `rohan.tsm.byufuel@yopmail.com` | **PASS** → **Hi Rohan** · Request Pickup / Sign up Supplier / New Prospect / Record a Visit | `apk-tsm.png` |
| 5 | APK Supplier | `rohan.supplier.byufuel@yopmail.com` | **PASS** → **Hi Rohan** · **Rohan QA Kitchen, Kondapur** · Sell Oil · KYC banner present | `apk-supplier.png` |

## vs Day 1

| Role | Day 1 | Day 2 | Notes |
|---|---|---|---|
| Admin web | PASS | PASS | Same user/dashboard |
| WH web | PASS | PASS | Same menus (Check in / Collect) |
| Driver APK | PASS | PASS | Session persists after relaunch |
| TSM APK | PASS | PASS | Same home actions |
| Supplier APK | PASS | PASS | KYC upload still pending (banner) — not a login fail |

## Automation notes

- APK login via `apk-login.cjs` (resource-ids `login-identifier` / `login-password` / `login-submit`).
- Screenshots: use `adb shell screencap` + `adb pull` (PowerShell `>` truncates PNG).
- Web password fill: prefer slow `browser_type` (Angular reactive form clears `browser_fill` password).
