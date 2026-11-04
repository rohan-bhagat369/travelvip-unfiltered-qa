# FAIL_GROW — Transfer UCO menu: only Manual on Grow (Device + Camera missing)

| | |
|--|--|
| **ID** | UI-CONTAINER-02 |
| **Verdict** | **FAIL_GROW** |
| **Severity** | **High** (scan entry modes missing on Transfer UCO) |
| **Module** | Admin Web → Inventory → Container Management → **Transfer UCO** |
| **When** | 2026-11-04 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

On Grow, **Transfer UCO** opens a menu with **only Manual**.  
On Azure, the same control offers **Device**, **Camera**, and **Manual**.

Same pattern as **Add New Container** (UI-CONTAINER-01) and Check in Oil Scan (Manual-only on Grow).

## Environments

| Env | URL |
|-----|-----|
| **Grow (bug)** | `https://uat-byufuel.growexponential.app/uam/container-management` |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/uam/container-management` |

Admin: Amaan Khan.

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. Open **Inventory → Container**.
3. Click **Transfer UCO**.
4. Compare dropdown options.

## Expected (Azure)

| Option | Icon |
|--------|------|
| **Device** | QR / scanner frame |
| **Camera** | Camera |
| **Manual** | Pencil |

## Actual (Grow)

| Option | Present? |
|--------|----------|
| Device | **No** |
| Camera | **No** |
| Manual | Yes (only option) |

## Impact

- Grow cannot start Transfer UCO via Device or Camera — manual-only path.
- Ops parity break vs Azure; likely shared scan-type config/component incomplete on Grow build.

## Evidence

| Env | File |
|-----|------|
| Grow | `transfer-uco-menu-GROW.png` |
| Azure | `transfer-uco-menu-AZURE.png` |

## Suggested fix

Restore Device + Camera on Grow Transfer UCO menu (same `scannTypes` / menu wiring as Azure). Fix once for shared scan menus if Add New Container / Check-in Oil share the same component.

## Related

- **UI-CONTAINER-01** — Add New Container Manual-only  
- `SCAN-MENU-PARITY.md` — Check in Oil Scan Manual-only  

## Tracker paste (short)

**Title:** [Grow] Transfer UCO — only Manual; Device & Camera missing vs Azure  

**Body:**  
Container Management → Transfer UCO on Grow shows only Manual. Azure shows Device, Camera, Manual. FAIL_GROW UI-CONTAINER-02. Same pattern as Add New Container / Check-in Scan. Evidence: grow + azure screenshots 2026-11-04.
