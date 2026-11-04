# WH Check in Oil — IT-000000333

**Env:** TravelVIP Grow · WH web · Rohan WHQA  
**When:** 2026-11-03 ~19:40 IST

## Detail (pre-confirm)

| Field | Value | Check |
|-------|-------|-------|
| IT | IT-000000333 | PASS |
| Status | ARRIVED AT WAREHOUSE | PASS |
| Driver | Hyd Driver1 | PASS |
| Collected / Check-In weight | 10 kg / 10 kg · Grade A 10 kg | PASS |
| Scanned containers | **1/1** | PASS |
| Estimated Collected Amount | **101** | **BUG** (same ₹101 as docs; not ₹295) |
| Actual Paid Amount | 0 (pre-confirm) | NOTE |

## After Confirm Checkin

| Field | Value | Check |
|-------|-------|-------|
| List status | **DELIVERED AT WAREHOUSE** | PASS |
| Collected / Checked-in | 10.00 kg / 10.00 kg | PASS |
| Paid Amount column | `--` | NOTE |

## Next

Supplier Payment screen · log FAIL_GROW ₹101 vs ₹295 on QA-19.
