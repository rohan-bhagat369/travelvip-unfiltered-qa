# BUG — Driver APK shows **Pickup Started** popup after pickup is already **Pickup Completed**

| | |
|--|--|
| **ID** | DRV-POPUP-01 |
| **Verdict** | **BUG** |
| **Severity** | **Medium** (wrong / stale guidance after successful pickup) |
| **Module** | Driver APK → active itinerary → stop pickup flow |
| **When** | 2026-11-18 |
| **Surface** | Driver mobile app (Byufuel UAT — screenshot package Byufuel_UAT) |

## Summary

After the driver **completes** a pickup (stop status **Pickup Completed**), the app still shows a popup titled **Pickup Started** with message *“You have started the pickup. please complete the pickup”*.

## Environments

| App | Notes |
|-----|--------|
| Driver UAT APK | Evidence: IT-000000338 · SCH-000001823 · stop “shah kirana stores” |

## Steps to reproduce

1. Login Driver APK; open an assigned itinerary (e.g. **IT-000000338**).
2. Start itinerary / start pickup for a stop.
3. Complete the pickup for that stop until status shows **Pickup Completed**.
4. Observe on-screen popup / toast after completion (or on return to itinerary).

## Expected

- Once pickup is **completed**, no **Pickup Started** / “please complete the pickup” modal.
- Any post-complete message should reflect **Pickup Completed** (or no blocking modal).

## Actual

- Stop list shows **Pickup Completed** (e.g. SCH-000001823 · shah kirana stores).
- Modal still appears: **Pickup Started** — *“You have started the pickup. please complete the pickup”* with **Ok**.

## Impact

- Confusing UX; implies pickup is incomplete when it is done.
- Risk of driver re-attempting or escalating a finished stop.

## Evidence

| File | Notes |
|------|--------|
| `driver-pickup-completed-still-Pickup-Started-popup.png` | IT-000000338 · stop Pickup Completed + Pickup Started modal |

## Suggested fix

- Suppress or replace the **Pickup Started** modal once stop status is **Pickup Completed**.
- Gate the modal on start event only; do not re-show after complete.

## Tracker paste (short)

**Title:** [Driver APK] Pickup Started popup shown after Pickup Completed  

**Body:**  
After completing pickup, Driver UAT still shows modal “Pickup Started — please complete the pickup” while stop status is Pickup Completed (IT-000000338 / SCH-000001823). BUG DRV-POPUP-01. Evidence: `driver-pickup-completed-still-Pickup-Started-popup.png` (2026-11-18).
