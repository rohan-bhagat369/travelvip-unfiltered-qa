# Byufuel In QA retest — 2026-11-18 (Rohan)

Grow UAT: `https://uat-byufuel.crediblesg.com` · Admin `amaan@crediblesg.com`  
Device: Motorola `ZD222HYKTS`

| Task | Bug ID | Result | Status left |
|------|--------|--------|-------------|
| [ENG-805](https://tracker.travelvip.ai/tasks/ENG-805) | UI-PAY-01 | **PASS** — Pay menu shows Cash · UPI · Card · Others · Online; Cash credit on SCH-000001803 → CREDITED | **QA Passed** |
| [ENG-799](https://tracker.travelvip.ai/tasks/ENG-799) | UI-NOTIF-01 | **NOT VERIFIED** — Grow bundle `index-1AAffPIp.js` has no 30s unread poll (#264); live trigger blocked by phone lock | **In QA** |
| [ENG-806](https://tracker.travelvip.ai/tasks/ENG-806) | SUP-NOTIF-01 | **PARTIAL** — Admin credited SCH-000001803; Supplier APK Notifications blocked by lock | **In QA** |
| [ENG-807](https://tracker.travelvip.ai/tasks/ENG-807) | DRV-POPUP-01 | **BLOCKED** — lock + need new Driver APK (#263) | **In QA** |
| [ENG-808](https://tracker.travelvip.ai/tasks/ENG-808) | DRV-GALLERY-01 | **BLOCKED** — lock + need new Driver APK (#262) | **In QA** |
| [ENG-809](https://tracker.travelvip.ai/tasks/ENG-809) | DRV-CAP-01 | **BLOCKED** — lock + need new Driver APK (#259) | **In QA** |

## Blockers for remaining

1. Unlock phone (fingerprint/PIN) on `ZD222HYKTS`.
2. Install/update **Driver UAT APK** (fixes note “use the new driver app build”).
3. Confirm Grow deploy of admin web **#264** if ENG-799 30s poll is expected.

## Notes

- Packages on device: `com.byufuel.mobile.uat.supplier`, `com.byufuel.mobile.uat.tsm`, `com.byufuel.mobile.uat` — no separate `*.driver` id; confirm which package is the Driver build after unlock.
- Credit ref for ENG-806 path: `QA-RETEST-806-1118` on SCH-000001803.
