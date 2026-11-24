# FAIL_GROW — Supplier Payment **Pay** menu: Grow shows only **Cash**; Azure shows Cash / UPI / Card / Others

| | |
|--|--|
| **ID** | UI-PAY-01 |
| **Verdict** | **FAIL_GROW** |
| **Severity** | **High** (non-cash payment methods missing on Grow) |
| **Module** | Admin Web → **Supplier Payment** → payment detail → **Pay** |
| **When** | 2026-11-18 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

On Grow (`crediblesg`) Admin web, after opening a supplier payment and clicking **Pay**, only **Cash** is shown.  
On Azure Admin web, the same **Pay** control opens a menu with **Cash · UPI · Card · Others**.

Also seen on the list Actions **Pay** control: Azure opens the full method menu; Grow does not expose the same multi-option menu.

## Environments

| Env | URL | Build |
|-----|-----|-------|
| **Grow (bug)** | `https://uat-byufuel.crediblesg.com/byu/supplier-payment` | `1.0.0 (20260922.1)` |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/byu/supplier-payment` | `1.0.0 (20261014.1)` |

Admin: Amaan Khan (`amaan@crediblesg.com`).

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. Open **Supplier Payment** → open a **VERIFIED** payment (View of Supplier Payment).
3. In **Payment details**, click **Pay**.
4. Compare payment method options.
5. (Optional) From List of Requests, click Actions **Pay** on a VERIFIED row and compare.

## Expected (Azure)

**Pay** opens a dropdown with:

| Option |
|--------|
| **Cash** |
| **UPI** |
| **Card** |
| **Others** |

Evidence example: SPAY-000000281 · SCH-000001808 · Amount ₹121.20.

## Actual (Grow)

- **Pay** only surfaces **Cash**.
- **UPI**, **Card**, and **Others** are missing.
- Admin cannot select non-cash methods on Grow.

Evidence example: SPAY-000000286 · SCH-000001823 · Amount ₹101.00 · only Cash under Pay.

## Impact

- Grow Admin payment path is Cash-only.
- Blocks UPI / Card / Others parity with Azure for supplier payouts.
- Ops may under-use Grow for supplier payment or force Cash incorrectly.

## Evidence

| Env | File | Notes |
|-----|------|-------|
| Azure detail Pay menu | `supplier-payment-Pay-detail-menu-AZURE.png` | Cash · UPI · Card · Others |
| Grow detail Pay | `supplier-payment-Pay-detail-Cash-only-GROW.png` | Cash only |
| Azure list Pay menu | `supplier-payment-Pay-menu-AZURE.png` | same 4 options from list Actions |
| Grow list | `supplier-payment-Pay-GROW.png` | Pay visible on list; multi-option menu not matching Azure |

## Suggested fix

Restore full payment-method menu on Grow Supplier Payment **Pay** (Cash, UPI, Card, Others) on both list Actions and payment detail, matching Azure.

## Tracker paste (short)

**Title:** [Grow] Supplier Payment Pay shows only Cash — missing UPI/Card/Others vs Azure  

**Body:**  
Admin → Supplier Payment → Pay on Grow (`uat-byufuel.crediblesg.com`) shows only Cash. Azure shows Cash, UPI, Card, Others. FAIL_GROW UI-PAY-01. Evidence: `supplier-payment-Pay-detail-Cash-only-GROW.png` · `supplier-payment-Pay-detail-menu-AZURE.png` (2026-11-18).
