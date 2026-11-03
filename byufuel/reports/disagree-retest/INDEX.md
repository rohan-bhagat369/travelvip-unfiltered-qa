# Disagree retest evidence

- **Env:** Azure UAT `https://u-byufuel.azurewebsites.net`
- **Date:** 2026-10-12
- **Rule:** Retest only rows where Byufuel Confirmation = Disagree
- **Recording rule (mandatory):** Every case has a saved video under its folder.
  - Desktop: `<CASE>_*.mp4`
  - Mobile APK: `<CASE>_mobile_*.mp4`
- **Helpers:** `node byufuel/scripts/disagree-record.cjs start|stop|mobile-start|mobile-stop <CASE_ID>`
- **Device:** Nothing A015 · `com.byufuel.uat`
- **Blockers:**
  - WH web passwords invalid / `qa.whworker` not registered → WH-03/WH-10 deep Check-in blocked
  - Driver APK login for `mayur.more.byufuel@yopmail.com` did not reach home → DRV flows need manual password or admin reset, then re-record

| Case | Surface | Result | Video | Notes |
|------|---------|--------|-------|-------|
| ADM-01 | Desktop | PASS | yes | Admin login OK |
| ADM-02 | Desktop | PASS | yes | Role + perms save |
| ADM-05 | Desktop | BY DESIGN | yes | No global UCO UI |
| ADM-17 | Desktop | PASS | yes | WH dropdown OK |
| ADM-19 | Desktop | PARTIAL | yes | REGISTERED no Actions |
| ADM-20 | Desktop | PARTIAL | yes | Status columns visible |
| ADM-21 | Desktop | PARTIAL | yes | Bulk wizard stuck |
| ADM-24 | Desktop | PASS | yes | Existing QR opens |
| ADM-26 | Desktop | PARTIAL | yes | Penalty page empty |
| ADM-27 | Desktop | PASS | yes | Incoming deliveries OK |
| WH-01 | Desktop | FAIL | yes | WH login broken |
| WH-03 | Desktop | BLOCKED | yes | Needs WH login |
| WH-10 | Desktop | BLOCKED | yes | Needs WH login |
| SUP-03 | Mobile | PARTIAL | yes | KYC Documents screen |
| SUP-11 | Mobile | PARTIAL | yes | Drop warehouse list works |
| DRV-03 | Mobile | BLOCKED | yes | Login attempt only |
| DRV-11 | Mobile | BLOCKED | yes | Placeholder until driver login |
| DRV-12 | Mobile | BLOCKED | yes | Placeholder until driver login |
| DRV-19 | Mobile | BLOCKED | yes | Placeholder until driver login |
| DRV-22 | Mobile | BLOCKED | yes | Placeholder until driver login |
| DRV-26 | Mobile | BLOCKED | yes | Logout/login attempts; re-do after login |

**Path:** `byufuel/reports/disagree-retest/<CASE_ID>/`
