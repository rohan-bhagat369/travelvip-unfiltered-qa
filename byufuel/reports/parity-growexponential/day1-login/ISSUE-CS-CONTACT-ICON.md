# FAIL_GROW — Customer Support contact icon missing (top-right of Messages panel)

| | |
|--|--|
| **ID** | UI-CS-02 |
| **Verdict** | **FAIL_GROW** |
| **Severity** | Medium (feature entry missing / parity) |
| **Module** | Admin Web → Customer Support → Messages |
| **When** | 2026-11-04 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

On Azure Customer Support (Messages), a **contact / person icon** appears in the **top-right corner** of the content area (aligned with the Messages / Support Tickets / Call Log tab row). On Grow, that icon is **missing**.

## Environments

| Env | URL | Build (footer) |
|-----|-----|----------------|
| **Grow (bug)** | `https://uat-byufuel.growexponential.app/uam/customer-support` | `1.0.0 (20260922.1)` · © 2026 |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/uam/customer-support` | `1.0.0 (22061014.1)` · © 2025 |

Admin: Amaan Khan (both).

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. Open **Customer Support** → tab **Messages**.
3. Look at the **far right** of the tab row (same horizontal band as Messages / Support Tickets / Call Log).

## Expected (Azure)

A **contact / person silhouette icon** is visible in the top-right corner of the Customer Support content panel (right of Call Log).

## Actual (Grow)

No contact icon in that corner. Tab row ends at Call Log with empty space on the right; header still has Language / Chat / Notifications / profile only (global chrome — not the CS contact control).

## Impact

Azure exposes a Customer Support contact action/entry from that icon. Grow users cannot reach the same control from this screen → **parity gap** (possible missing start-chat / contact picker entry).

## Evidence

| Env | File |
|-----|------|
| Grow | `cs-contact-icon-GROW.png` |
| Azure | `cs-contact-icon-AZURE.png` |

## Related

- **UI-CS-01** — Messages search placeholder missing on Grow (same page).

## Tracker paste (short)

**Title:** [Grow] Customer Support — contact icon missing (top-right) vs Azure  

**Body:**  
Customer Support → Messages on Grow (`uat-byufuel.growexponential.app`) is missing the contact/person icon that Azure (`u-byufuel.azurewebsites.net`) shows at the top-right of the tab row (beside Call Log). FAIL_GROW UI-CS-02. Evidence: grow + azure screenshots 2026-11-04.
