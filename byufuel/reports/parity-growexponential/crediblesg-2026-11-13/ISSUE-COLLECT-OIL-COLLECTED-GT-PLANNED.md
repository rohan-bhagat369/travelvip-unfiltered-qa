# BUG — Collect Oil allows collected weight greater than planned weight

| | |
|--|--|
| **ID** | COLLECT-01 |
| **Verdict** | **BUG** |
| **Severity** | **High** (over-collection / amount / inventory integrity) |
| **Module** | Collect Oil From Supplier (Driver APK / WH Collect flow — collected vs planned) |
| **When** | 2026-11-18 |
| **Surface** | Pickup / Collect Oil From Supplier |

## Summary

While collecting oil from supplier, **collected oil quantity must be ≤ planned oil quantity**.  
System currently allows (or does not block) **collected > planned**.

## Expected

- Collected weight / quantity **≤ Planned** weight / quantity.
- If collected > planned → **block Save / Complete** with clear validation error (do not accept over-collection).

## Actual

- Collected oil **greater than planned** is accepted (validation missing / not enforced).
- Example: **SCH-000001825** — Planned **20 kg**, Collected **90 kg** (Check-In Weight 90 kg) on Grow WH Collect Oil.

## Steps to reproduce

1. Login WH Worker (e.g. Mayur More) on Grow.
2. Open **Collect Oil From Supplier** → schedule detail (e.g. SCH-000001825).
3. Collect / scan with weight **greater than Planned** (here Planned 20 kg → Collected 90 kg).
4. Observe summary still shows Collected 90 kg vs Planned 20 kg (accepted / no block).

## Impact

- Over-collection vs plan can skew Est/Actual amounts, payment, and warehouse stock.
- Breaks expected operational rule: collected ≤ planned.

## Evidence

| File | Notes |
|------|--------|
| `collect-oil-planned-20kg-collected-90kg-SCH1825-GROW.png` | Grow WH Collect Oil · SCH-000001825 · Planned 20 kg · Collected 90 kg · ARRIVED AT WAREHOUSE · container B-2610-6-00109 |

## Suggested fix

- Enforce `collectedWeight <= plannedWeight` (per stop / schedule / container as designed).
- Show field-level error; disable Complete Pickup / Save until valid.

## Tracker paste (short)

**Title:** [Collect Oil] Collected oil must be ≤ planned — over-collection accepted  

**Body:**  
While collecting oil from supplier, collected quantity should be ≤ planned. Accepted over-collection: SCH-000001825 Planned **20 kg** / Collected **90 kg** (Grow WH Collect Oil). BUG COLLECT-01. Evidence: `collect-oil-planned-20kg-collected-90kg-SCH1825-GROW.png` (2026-11-18).
