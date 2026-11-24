# BUG — Driver APK shows **Capacity: nullKg** when a random container is selected on pickup

| | |
|--|--|
| **ID** | DRV-CAP-01 |
| **Verdict** | **BUG** |
| **Severity** | **High** (capacity unknown; risk of overfill / bad quantity validation) |
| **Module** | Driver APK → pickup → container select / quantity modal |
| **When** | 2026-11-18 |
| **Surface** | Driver mobile app (Byufuel UAT) |

## Summary

During pickup, after selecting a **random / available container**, the quantity modal shows **Capacity: nullKg** instead of the container’s real capacity. Remaining Capacity may still show a number (e.g. `0.0Kg`), which is inconsistent.

## Environments

| App | Notes |
|-----|--------|
| Driver UAT APK | Evidence: IT-000000338 · SCH-000001823 · container `#B-2610-6-00115` · Quantity modal |

## Steps to reproduce

1. Login Driver APK; open itinerary (e.g. **IT-000000338**).
2. Start pickup for a stop (e.g. SCH-000001823).
3. On Containers step, select a **random / available container** (not necessarily pre-assigned).
4. Open the quantity / grade modal for that container.
5. Observe header capacity text.

## Expected

- Modal shows real capacity, e.g. **Capacity: 100 Kg** (or correct value from container master).
- Remaining capacity is derived from that capacity − occupied/quantity.

## Actual

- Header shows **`Capacity: nullKg`**.
- Example also showed **Remaining Capacity: 0.0Kg** while Capacity is null.
- Driver can still enter Quantity (e.g. 1000) and Grade A / UCO.

## Impact

- No trustworthy capacity check when picking a random container.
- Possible save of quantity above true capacity.
- Confusing UX (`nullKg` string leak).

## Evidence

| File | Notes |
|------|--------|
| `driver-pickup-capacity-nullKg.png` | `#B-2610-6-00115` · Capacity: nullKg · Remaining Capacity: 0.0Kg |

## Suggested fix

- Load container capacity from master/API when a random container is selected; never render `null` as text.
- If capacity unknown, block Save and show a clear error — do not show `nullKg`.

## Tracker paste (short)

**Title:** [Driver APK] Capacity: nullKg when selecting random container on pickup  

**Body:**  
Pickup container quantity modal shows Capacity: nullKg after selecting a random container (IT-000000338 / #B-2610-6-00115). BUG DRV-CAP-01. Evidence: `driver-pickup-capacity-nullKg.png` (2026-11-18).
