# FAIL_GROW — Customer Support Messages search placeholder missing

| | |
|--|--|
| **ID** | UI-CS-01 |
| **Verdict** | **FAIL_GROW** |
| **Severity** | Low (UX / parity) |
| **Module** | Admin Web → Customer Support → Messages |
| **When** | 2026-11-04 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

On Grow, the Messages thread search input has **no placeholder text**. On Azure, the same field shows **"Search by name or reference no"**.

## Environments

| Env | URL | Build (footer) |
|-----|-----|----------------|
| **Grow (bug)** | `https://uat-byufuel.growexponential.app/uam/customer-support` | `1.0.0 (20260922.1)` · © 2026 |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/uam/customer-support` | `1.0.0 (210751014.1)` · © 2024 |

Admin: Amaan Khan (both).

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. Open **Customer Support** → tab **Messages**.
3. Look at the search field above the thread list (left panel).

## Expected (Azure)

Placeholder visible: **Search by name or reference no**  
(Search icon left; search + add controls on the right.)

## Actual (Grow)

Search field is **blank** — no placeholder. Magnifying glass icons present; hint text missing.

## Impact

Users get no guidance that search supports **name** or **reference** (SCH/IT style refs). Functional search may still work; this is a **UI/copy parity** miss vs Azure.

## Evidence

| Env | File |
|-----|------|
| Grow | `cs-search-placeholder-GROW.png` |
| Azure | `cs-search-placeholder-AZURE.png` |

## Suggested fix

Restore the same placeholder string as Azure on the Messages search input (or shared i18n key if labels are driven from config):

`Search by name or reference no`

## Tracker paste (short)

**Title:** [Grow] Customer Support Messages — search placeholder missing vs Azure  

**Body:**  
Customer Support → Messages search box on Grow (`uat-byufuel.growexponential.app`) has empty placeholder. Azure (`u-byufuel.azurewebsites.net`) shows “Search by name or reference no”. FAIL_GROW UI-CS-01. Evidence: grow + azure screenshots 2026-11-04.
