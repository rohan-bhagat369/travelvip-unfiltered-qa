# Driver trip — IT-000000333 / SCH-000001814

**Env:** TravelVIP Grow · Driver APK `com.byufuel.uat.driver`  
**Driver:** Hyd Driver1 (`hyddriver1@yopmail.com`)  
**When:** 2026-11-03 ~19:05–19:40 IST

## Checks

| Step | Observed | Status |
|------|----------|--------|
| Home Proposed count | 1 after admin assign | PASS |
| Card IT / status | `#IT-000000333` · Driver Assigned | PASS |
| Amt / Dist / UCO | **₹295.00** · **96.13Km** · **10.00Kg** | PASS (tax-incl matches Sell Oil) |
| Slot / date | Tue 3 Nov · 6 PM–10 PM | PASS |
| Route | Start Warehouse · Pickup Kondapur · Drop Phase 3 / Kukatpally | PASS |
| Accept → confirm | Dialog → Accepted=1 | PASS |
| Start → confirm | **Itinerary Started** | PASS |
| Guide → Start Pickup | Near pickup → **Pickup Started** | PASS |
| Inactive QR | `B-2610-6-00108` → Inactive Container | PASS (guard) |
| Active scan | **B-2611-HYD001-00121** · 10 kg Grade A | PASS |
| Documentation | Line amount **₹101** (vs ₹295) · signed · Generate PDF | **BUG** amount; Generate PASS |
| Oil Collected / Complete | Oil Collected → Pickup Completed | PASS |
| Arrive WH | Drop → Arrived At Warehouse → **Arrived At WH** | PASS |
| Admin SCH mid/end | Collected 10 kg · Actual **₹101** · **PAYMENT INITIATED** | **BUG** amount |
| WH Check in Oil | Manual JSON scan · Verify 10 kg Grade A · Confirm → Complete → **DELIVERED AT WAREHOUSE** · CheckedIn **10.00 kg** | PASS |

## Soft notes / FAIL_GROW

1. **Amount:** Sell Oil/IT card **₹295** · admin est **₹250** · docs/admin/WH est **₹101** (≠ 25×10).
2. Vehicle blank on assign list for Hyd Driver1.
3. Scan gated on Guide Mode → Start Pickup.
4. Stale “please complete the pickup” dialog after Oil Collected.
5. Inactive QRs still visible in admin list.

## Evidence

`driver-trip-01` … `driver-trip-43` · `wh-checkin-it333-after-confirm.png` · `admin-qr-*` · `qr-B-2611-HYD001-00122.png`

## Next

Supplier Payment close-out · QA-19 Activity for ₹101 FAIL_GROW.
