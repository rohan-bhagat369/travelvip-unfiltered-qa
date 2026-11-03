# ADM-01 — Admin Login

**Date:** 2026-10-12  
**Env:** `https://u-byufuel.azurewebsites.net`  
**Credibl claim:** Works with issues — logging in as a different user returned access-denied  
**Byufuel:** Disagree — works fine  

## Steps recorded
1. Opened admin login
2. Tried WH worker `qa.whworker.byufuel@yopmail.com` → toast **Email Id not registered**
3. Logged in as Admin `amaan@crediblesg.com` → Dashboard OK
4. Signed out / returned to login
5. Tried TSM `rohan.tsm.byufuel@yopmail.com` → **Please login using Mobile App** (blocked on web)

## Verdict
**PASS (admin login works)** — Byufuel Disagree is fair for happy-path admin login.

**Note:** Non-admin roles are blocked on the web console with a clear message (mobile app / not registered). That is expected role gating, not a broken admin login.

## Evidence
- Video: `ADM-01_*.mp4` in this folder
