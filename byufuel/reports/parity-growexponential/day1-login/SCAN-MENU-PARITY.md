# Scan menu parity — Check in Oil (Grow vs Azure)

**Date:** 2026-11-03  
**Screen:** WH → Check in Oil → itinerary update → **Scan** dropdown

## Observed

| Env | Scan menu options | Evidence |
|-----|-------------------|----------|
| **Grow** `uat-byufuel.growexponential.app` | **Manual only** | UI (user screenshot) · `CheckInOilPage-ONi6GBZv.js` wires single child `n("Manual")` under `btnScan` |
| **Azure** `u-byufuel.azurewebsites.net` | **Camera · Device · Manual** | Bundle `chunk-O2ALJBLM.js`: `scannTypes=[{code:"Camera"...},{code:"Device"...},{code:"Manual"...}]` + `onDeviceScan` |

Grow i18n still has keys **Camera**, **Device**, **Manual**, **Scan Type** in `index-*.js`, but Check-in Oil page does not render Camera/Device.

## Verdict

**FAIL_GROW / PARITY** — Scan entry modes incomplete on Grow vs Azure.

## Note

Could not live-click Azure Scan menu today: WH logins (`qa.whworker…` not registered · `rohan.wh…` invalid creds). Bundle evidence is sufficient for the option list claim.
