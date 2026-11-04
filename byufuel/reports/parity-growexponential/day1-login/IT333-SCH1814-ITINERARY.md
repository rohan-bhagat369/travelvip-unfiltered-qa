# Itinerary + Assign Driver — SCH-000001814 → IT-000000333

**Env:** TravelVIP Grow `uat-byufuel.growexponential.app`  
**When:** 2026-11-03 ~18:45–19:05 IST  
**Admin:** Amaan Khan (`amaan@crediblesg.com`)

## Create itinerary

| Field | Value | Check |
|-------|-------|-------|
| SCH selected | SCH-000001814 (APPROVED, 10 kg Grade A) | PASS |
| Starting type | Warehouse | PASS |
| Starting WH | Warehouse · 54654 Ameerpet, Hyderabad 500016 | PASS |
| Pickup B | Rohan QA Kitchen · Kondapur · 6 PM–10 PM | PASS |
| Drop C | Kukatpally Warehouse · Phase 3 500072 | PASS |
| Create form distance | **96.13 KM** | NOTE — earlier soft preview had shown 9.77 KM before WH re-pick; after selecting Starting WH “Warehouse” distance settled at 96.13 and persisted on view/list |
| Create form est. amount | **₹ 250.00** | PASS vs SCH admin base (pre-tax) |
| Create form UCO | Grade A: 10 kg | PASS |
| Created IT | **IT-000000333** | PASS |
| View status after create | Itinerary Created | PASS |

## View IT amounts (post-create)

| Field | Value | Check |
|-------|-------|-------|
| Est. Amount (stop) | **₹ 295** | PASS = Sell Oil total (₹250 + tax ₹45) |
| Est. Planned Amount | **₹ 295.00** | PASS |
| Est. Collected / Actual Paid | ₹ 0.00 / ₹ 0.00 | PASS (not collected yet) |
| Total distance | 96.13 KM | Same as create form |
| Tax on create form vs view | Create/assign pages show ₹250; view stop shows ₹295 | **NOTE** — pre-tax vs tax-inclusive display split (same as Sell Oil admin list vs APK) |

## Assign driver

| Field | Value | Check |
|-------|-------|-------|
| Driver chosen | **Hyd Driver1** · phone 2164797413 | PASS |
| Assign list vehicle cols | `--` / `--` for Hyd Driver1 | NOTE — AGENTS expects Toyota Tx100/Tx468; list blank |
| List status after assign | **DRIVER ASSIGNED** | PASS |
| IT view status | **Driver Assigned** | PASS |
| Driver Info tab | Name Hyd Driver1 · Phone 2164797413 · 789 KPHB Hyderabad 500055 | PASS |

## SCH row after assign (`/byu/uco-schedules`)

| Field | Value | Check |
|-------|-------|-------|
| SCH | SCH-000001814 | PASS |
| IT | IT-000000333 | PASS |
| Rate / Est amount | 25.00 / ₹ 250.00 | PASS |
| Weight / slot / date | 10 kg · 6 PM–10 PM · 03-Nov-2026 | PASS |
| Warehouse / OA | Kukatpally Warehouse · Hyderabad | PASS |
| Driver | Hyd Driver1 | PASS |
| Status | **DRIVER ASSIGNED** | PASS |

## Soft issues / notes

1. **Distance jump 9.77 → 96.13 KM** when Starting WH Location was re-selected via Warehouse List (was empty in input while totals still showed old short route). Treat short distance as stale UI until WH picker confirmed.
2. **₹250 vs ₹295** display split across create/assign vs itinerary view / Sell Oil APK — PARITY SAME pattern as admin schedule list (base only).
3. Assign-driver table: Hyd Driver1 vehicle name/capacity blank.

## Driver progress (same day)

See `DRIVER-TRIP-IT333.md`. Accept + Start + Guide **Start Pickup** done. Admin: IT **ITINERARY STARTED**, SCH **PICKUP STARTED**. QR scan → qty → docs → Arrive WH still open (`B-2610-6-00108` JSON prepared).
