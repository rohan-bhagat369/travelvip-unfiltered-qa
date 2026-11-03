# ADM-17 — Create warehouse worker + assign warehouse + address

**Date:** 2026-10-12  
**Env:** `https://u-byufuel.azurewebsites.net/uam/wh-users`  
**Credibl claim:** Works with issues — no clear message if warehouse missing; mobile login note  
**Byufuel:** Disagree — empty dropdown if warehouse missing; clarity on mobile login  

## Steps recorded
1. Workers list loads (9 workers)
2. **Add Worker** → Create New Worker form
3. Fields: name, email, contact, OA, **Warehouse**, designation, full address block
4. Warehouse dropdown opened → **5 options** present (Kalika, Kukatpally, Security, Test, Warehouse)

## Verdict
**PASS** for create form + warehouse assign UI on UAT (warehouses exist, dropdown populated).  
Credibl “no warehouse message” not reproduced here because warehouses exist. Byufuel note about empty dropdown when none exist is plausible BY DESIGN (not retested by deleting all WH).

## Evidence
- Video: `ADM-17_*.mp4`
