# FAIL_GROW — Add New Container menu: only Manual on Grow (Device + Camera missing)

| | |
|--|--|
| **ID** | UI-CONTAINER-01 |
| **Verdict** | **FAIL_GROW** |
| **Severity** | **High** (scan entry modes missing — blocks Device/Camera create path) |
| **Module** | Admin Web → Inventory → Container Management → **+ Add New Container** |
| **When** | 2026-11-04 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

On Grow, **+ Add New Container** opens a menu with **only Manual**.  
On Azure, the same control offers **Device**, **Camera**, and **Manual**.

## Environments

| Env | URL |
|-----|-----|
| **Grow (bug)** | `https://uat-byufuel.growexponential.app/uam/container-management` |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/uam/container-management` |

Admin: Amaan Khan.

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. Open **Inventory → Container** (Container Management).
3. Click **+ Add New Container**.
4. Compare dropdown options.

## Expected (Azure)

| Option | Icon |
|--------|------|
| **Device** | Scanner / barcode frame |
| **Camera** | Camera |
| **Manual** | Pencil |

## Actual (Grow)

| Option | Present? |
|--------|----------|
| Device | **No** |
| Camera | **No** |
| Manual | Yes (only option) |

## Impact

- Grow cannot start container create via **Device** or **Camera** from this menu — only typed/manual flow.
- Breaks parity with Azure WH/admin ops that rely on scan-to-add.
- Related to earlier Grow scan-entry incompleteness notes (`SCAN-MENU-PARITY.md`).

## Evidence

| Env | File |
|-----|------|
| Grow | `container-add-menu-GROW.png` |
| Azure | `container-add-menu-AZURE.png` |

## Suggested fix

Restore **Device** and **Camera** entries on Grow Add New Container menu (same as Azure), including wiring to the same scan flows.

## Related

- UI-QR-01 Generate QR modal field drift  
- `SCAN-MENU-PARITY.md` (prior Grow scan modes note)

## Tracker paste (short)

**Title:** [Grow] Add New Container — only Manual; Device & Camera missing vs Azure  

**Body:**  
Container Management → + Add New Container on Grow shows only Manual. Azure shows Device, Camera, Manual. FAIL_GROW UI-CONTAINER-01. Evidence: grow + azure screenshots 2026-11-04.
