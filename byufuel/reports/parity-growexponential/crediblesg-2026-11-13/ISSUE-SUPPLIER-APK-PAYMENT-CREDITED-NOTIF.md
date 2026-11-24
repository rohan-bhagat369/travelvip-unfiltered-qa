# BUG — Supplier APK does not receive **Payment Credited** notification after payment is credited

| | |
|--|--|
| **ID** | SUP-NOTIF-01 |
| **Verdict** | **BUG** |
| **Severity** | **High** (supplier misses payout confirmation) |
| **Module** | Supplier APK → **Notifications** (after Admin Supplier Payment → Credited) |
| **When** | 2026-11-18 |
| **Surface** | Supplier mobile app (`com.byufuel.uat` / supplier package per env) |

## Summary

After Admin marks / completes supplier payment and status becomes **CREDITED**, the **Supplier APK does not receive** the **Payment Credited** notification.

## Expected (from Centvis / prior QA matrix)

Supplier Features · **Payments** / **Notifications**:
- Payment history shows Credited amounts.
- Notifications include **Payment Credited** for the schedule (prior PASS example: *Payment Credited SCH-640* — `apk-sup-notif.png` in drive TC extract id **39**).

| Ref | Source |
|-----|--------|
| TC matrix | `byufuel/reports/byufuel-drive/_tmp-tc-extract.json` · id **39** Payments · id **40** Notifications & Chat |

## Environments

| Role | Notes |
|------|--------|
| Admin (credit payment) | Grow `https://uat-byufuel.crediblesg.com` and/or Azure `https://u-byufuel.azurewebsites.net` → Supplier Payment → Pay → status **CREDITED** |
| Supplier APK | Supplier login (e.g. Rohan SupplierQA / active supplier from `byufuel/AGENTS.md`) |

## Steps to reproduce

1. Login **Supplier APK**; open **Notifications** (clear / note current unread).
2. Login **Admin** → **Supplier Payment** → open a **VERIFIED** payment for that supplier.
3. Click **Pay** and complete payment so status becomes **CREDITED**.
4. On Supplier APK (without force-refresh if possible), check push tray + in-app **Notifications**.
5. Also check Profile → **Payment** history for Credited entry.

## Expected

- Supplier APK receives / shows **Payment Credited** (with schedule code / amount as designed) when Admin payment becomes **CREDITED**.
- Notification appears without requiring reinstall / unrelated workarounds.

## Actual

- **Payment Credited** notification **not received** on Supplier APK after payment is credited.

## Impact

- Supplier cannot rely on app alerts for payout confirmation.
- Breaks documented Supplier Payments / Notifications verification behaviour (TC 39 prior PASS).

## Evidence

| Item | Status |
|------|--------|
| Expected baseline | TC extract id 39 — Payment Credited SCH-640 / `apk-sup-notif.png` |
| Current fail shots | TBD (attach Admin CREDITED + Supplier notif empty / missing Payment Credited) |

## Suggested fix

- Fire supplier push + in-app notification on payment status → **CREDITED**.
- Confirm Grow and Azure backends both emit the same event to Supplier APK.

## Tracker paste (short)

**Title:** [Supplier APK] Payment Credited notification not received after Admin credits payment  

**Body:**  
After Admin Supplier Payment → CREDITED, Supplier APK does not get **Payment Credited** notification. Expected per Centvis TC Payments (prior PASS Payment Credited SCH-640). BUG SUP-NOTIF-01. 2026-11-18.
