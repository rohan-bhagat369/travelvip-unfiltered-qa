# ADM-02 — Create roles and assign permissions

**Date:** 2026-10-12  
**Env:** `https://u-byufuel.azurewebsites.net`  
**Credibl claim:** Partly works — form opens but permissions did not attach / role could not be saved  
**Byufuel:** Disagree — works fine  

## Steps recorded
1. Admin login → Manage Roles → New Role
2. Name `QA Disagree ADM02 251365`, Category `Admin`, description set
3. Selected 6 permissions (UCOSchedule Create/Delete/Read/Update + itinerary)
4. Save → redirected to roles list with new role present
5. Reopened Edit Role → permissions still attached (6 checked)

## Verdict
**PASS** — Credibl failure not reproduced. Role saves and permissions persist.

## Evidence
- Video: `ADM-02_*.mp4`
- Role id path: `/iam/roles/pTn0cRQFEgIjxKHs6DAI5ag5pM-6Sb18Lc15NAHv9UQ`
