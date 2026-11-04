# FAIL_GROW — Generate QR Code modal fields differ (Grow vs Azure)

| | |
|--|--|
| **ID** | UI-QR-01 |
| **Verdict** | **FAIL_GROW** |
| **Severity** | Medium (form contract / parity — extra required path on Grow) |
| **Module** | Admin Web → Generate QR Codes → **Generate QR Codes** |
| **When** | 2026-11-04 |
| **Rule** | Azure = baseline. Grow differs → FAIL_GROW |

## Summary

Opening **Generate QR Code** on Grow shows **more form options** than Azure. Grow adds **Container Type** and **Capacity**; Azure only asks for count + warehouse.

## Environments

| Env | URL |
|-----|-----|
| **Grow (diff)** | `https://uat-byufuel.growexponential.app/uam/container-qr-codes` |
| **Azure (baseline)** | `https://u-byufuel.azurewebsites.net/uam/container-qr-codes` |

Admin: Amaan Khan. Same entry: **Generate QR Codes** action → modal **Generate QR Code**.

## Steps to reproduce

1. Login Admin on Grow and Azure.
2. Open **Generate QR Codes**.
3. Click **Generate QR Codes** (open create modal).
4. Compare fields and actions in the modal.

## Field comparison

| Field / control | Azure (baseline) | Grow |
|-----------------|------------------|------|
| No. of QR Codes * | Yes | Yes |
| Choose Warehouse * | Yes | Yes |
| **Container Type** | **Not present** | Dropdown (Select) |
| **Capacity** | **Not present** | Text input |
| Generate button | Large centered; disabled until required filled | Text-style **Generate** (with Close) |
| Close | Bottom-right text | Bottom-right text |

## Expected (Azure)

Modal only: **No. of QR Codes** + **Choose Warehouse** → Generate.

## Actual (Grow)

Modal: **No. of QR Codes** + **Choose Warehouse** + **Container Type** + **Capacity**.

## Impact

- Grow operators must choose container type/capacity that Azure never collected in this flow → **process / training mismatch**.
- Risk of different QR/container records between envs (type/capacity metadata only on Grow).
- Confirm with product whether Grow is intentional enhancement or unintended drift; until confirmed, log as **FAIL_GROW** vs Azure baseline.

## Evidence

| Env | File |
|-----|------|
| Grow | `qr-generate-modal-GROW.png` |
| Azure | `qr-generate-modal-AZURE.png` |

## Suggested fix / clarification

1. Align Grow modal to Azure field set **or** document intentional Grow change and update Azure.
2. If Container Type / Capacity stay on Grow: make labels/required rules clear and mirror on Azure for parity.

## Tracker paste (short)

**Title:** [Grow] Generate QR Code modal shows Container Type + Capacity (not on Azure)  

**Body:**  
Generate QR Codes → Generate QR Code dialog on Grow includes Container Type and Capacity; Azure only has No. of QR Codes + Choose Warehouse. FAIL_GROW UI-QR-01. Evidence: grow + azure screenshots 2026-11-04.
