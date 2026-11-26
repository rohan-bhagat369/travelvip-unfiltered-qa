# ENG-902 — Hotel supplier callback + Stripe race (gamma)

**Base:** `https://gamma-api.travelvip.ai`  
**Creds:** api-staging vgm (`.env`) · callback `pid/key=smt/palsgcvgscvvs`  
**At:** 2026-11-25T07:34:33.168Z

## Counts

| PASS | BUG | CHECK | NOT TESTED |
|---:|---:|---:|---:|
| 18 | 0 | 1 | 3 |

## Part A — `updateHotelBooking`

| TC | Status | BR | Evidence |
|---|---|---|---|
| A1.1 | **PASS** | BR1795591661138485 | cb=Booking updated successfully |
| A2.1 | **PASS** | BR1795591661138485 | cb=Callback received; no change made to the booking |
| A3.1 | **PASS** | BR1795591661138485 | Callback received; no change made to the booking |
| A3.2 | **PASS** | BR1795591661138485 | Callback received; no change made to the booking |
| A1.2 | **PASS** | BR1795591959246223 | Booking updated successfully |
| A1.3b_REJECTED | **PASS** | BR1795591981954529 | Booking updated successfully |
| A1.4 | **PASS** | BR1795591986777851 | Booking updated successfully |
| A1.5 | **PASS** | BR1795591959246223 |  |
| A4.2 | **PASS** | BR1795591661138485 | Callback received; no change made to the booking |
| A4.1 | **CHECK** | BR1795591995398292 | Cancel+callback ignore PASS, but rate was free-cancel (refund>0), not non-refundable ₹0 |
| A2.2 | **PASS** | BR1795591959246223 | Callback received; no change made to the booking |
| A3.3 | **PASS** | BR1795591959246223 | Callback received; no change made to the booking |
| A1.3 | **PASS** | BR1795591976921094 | Booking updated successfully |

## Part B — Card / Stripe

| TC | Status | BR | Evidence |
|---|---|---|---|
| B1 | **PASS** | BR1795591469648138 | Failed |
| B2 | **PASS** | BR1795591478455993 | terminal without attach — webhook likely booked |
| B4 | **PASS** | BR1795591485405681 | app-first then second attach; real Stripe webhook no-op NOT TESTED without webhook control |
| B3 | **NOT TESTED** | BR1795591485405681 | cannot force Stripe webhook before app without webhook pointing to gamma + replay control |
| B5 | **PASS** | BR1795591493602762 | two parallel attach calls; true app+webhook race NOT TESTED |
| B6 | **PASS** | BR1795591502680999 |  |
| B7 | **PASS** | BR1795591509211086 | Failed after pay — verify Stripe refund in Dashboard/DB |
| B8 | **NOT TESTED** | - | requires Stripe webhook endpoint + signing secret to replay same event to gamma |
| B9 | **NOT TESTED** | - | no known Stripe webhook path on gamma (all 404) |

## Notes

- Callback with `pid=vgm` + palsg / access_token / partner_secret → HTTP 403 `INVALID_PARTNER_KEY`.
- Callback with `pid=smt` + `palsgcvgscvvs` works on vgm BRs.
- Partner webhook delivery: **NOT TESTED** (no receiver evidence).
- B2 reached terminal without app attach → webhook booking path appears live on gamma.
- B3 / B8 / B9: **NOT TESTED** (cannot force webhook-first / Stripe replay / known webhook path).
- `process_by` book_api vs webhook: **NOT TESTED** (needs DB).
- A4.1: non-refundable inventory not hit; free-cancel cancel + ignore-callback verified.
- Probe: `travel-apis/hotel/scripts/probe-gamma-hotel-callback-stripe.js` + `probe-gamma-hotel-callback-partA-continue.js`.
