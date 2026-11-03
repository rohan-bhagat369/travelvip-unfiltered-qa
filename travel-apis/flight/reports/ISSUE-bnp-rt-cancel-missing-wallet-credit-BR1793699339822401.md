# ISSUE — RT cancel: second-leg Benepik refund without wallet credit

| Field | Value |
|---|---|
| **ID** | ISSUE-3 (bnp wallet changelog 30 Oct 2026) |
| **Severity** | **BUG** — money / two-leg refund |
| **Partner / env** | **bnp** · `dev-benepik.travelvip.ai` · DB `travelx` |
| **BR** | **BR1793699339822401** |
| **Trip** | Round-trip PNQ ↔ DEL · IX 1084 / IX 1257 · 18–21 Nov 2026 |
| **PNRs (UI)** | Onward SIM-OA9OAF · Return SIM-HJK21Z |
| **Vendor PNRs (alerts)** | SIM-JM5GNB · SIM-JUQQYL |
| **Paid** | ₹17,204.54 (`1720454`) |
| **Date found** | 2026-11-03 |
| **Changelog** | §2.2 two-leg refund · §4.4 · scenario **#7** |

---

## Summary

On **round-trip online cancel**, the system created **two** `cancellation_request` rows (one per leg).  
**First leg** completed two-leg refund correctly (Benepik SOURCE + wallet APP_WALLET).  
**Second leg** refunded Benepik only — **no** `APP_WALLET` `refund_transaction`, **no** wallet `payment_transaction` REFUND — and **no** `WALLET_CREDIT_FAILED` alert. Cancel row still marked **COMPLETED**.

Partner wallet was under-credited by **₹2,975.50** vs UI total refund.

---

## Steps

1. Book RT flight on bnp with SSR (seat/meal/bag) → Confirmed  
2. Online cancel full booking (both legs)  
3. Check UI refunds, Nexus partner wallet, DB §4.4, Mattermost `critical-partner-alerts-dev`

---

## Expected (changelog)

For **each** successful cancellation_request:

- Benepik refund **first**, then wallet credit  
- **Same amount** on both legs  
- `refund_transaction`: **2** rows — `destination_type=SOURCE` + `APP_WALLET`, both `completed`  
- `payment_transaction`: exactly **one** wallet REFUND per wallet credit  
- If Benepik succeeds and wallet credit fails → refund **FAILED** + **`WALLET_CREDIT_FAILED`** alert  

---

## Actual

### UI (details page)

| Item | Value |
|---|---|
| Status | Cancelled |
| Total paid | ₹17,204.54 |
| Total cancel charge | ₹9,360.50 |
| Total refund | **₹6,744.50** |
| Onward | +₹3,769.00 Success · charge ₹3,641.00 · PNR SIM-OA9OAF |
| Return | +₹2,975.50 Success · charge ₹5,719.50 · PNR SIM-HJK21Z |

### Nexus partner wallet (bnp)

| Line | Amount | Notes |
|---|---|---|
| Booking payment · BR1793699339822401 | −₹17,204.54 Committed | OK |
| Refund received · **763** | +₹3,769.00 Completed | Matches cancel 763 only |
| Refund for **764** / ₹2,975.50 | **Missing** | Partner short |

### Mattermost

| Channel | For this BR |
|---|---|
| `flight-alerts-dev` | 2× Penalty + 2× Cancel SUCCESS (SIM-JM5GNB, SIM-JUQQYL) |
| `critical-partner-alerts-dev` | **No** `WALLET_CREDIT_FAILED` / gateway refund fail |

### DB — `cancellation_request`

| id | type | mode | status | refund_status | refund_amount | penalty |
|---|---|---|---|---|---|---|
| **763** | PARTIAL | ONLINE | success | COMPLETED | 376900 | 364100 |
| **764** | PARTIAL | ONLINE | success | COMPLETED | 297550 | 571950 |

### DB — `refund_transaction`

| id | cancellation_request_id | destination_type | status | amount |
|---|---|---|---|---|
| 1376 | 763 | SOURCE | completed | 376900 |
| 1377 | 763 | APP_WALLET | completed | 376900 |
| 1378 | 764 | SOURCE | completed | 297550 |
| — | 764 | **APP_WALLET** | — | **MISSING** |

### DB — `payment_transaction`

| id | provider | type | status | amount |
|---|---|---|---|---|
| 4789 | benepik | AUTH | success | 17204 |
| 4790 | wallet | CAPTURE | success | 1720454 |
| 4791 | benepik | REFUND | success | 376900 |
| 4792 | wallet | REFUND | success | 376900 |
| 4793 | benepik | REFUND | success | 297550 |
| — | wallet | REFUND | — | **297550 MISSING** |

### DB — `payment`

| id | provider | status | total_amount |
|---|---|---|---|
| 4223 | wallet | refunded | 1720454 |
| 4224 | benepik | captured | 1720454 |

---

## Impact

- End-user UI shows return refund Success (+₹2,975.50)  
- Benepik gateway was refunded that amount  
- Partner **wallet not credited** ₹2,975.50  
- No critical alert for ops  

---

## Reproduce SQL

```sql
USE travelx;
SET @br := 'BR1793699339822401';

SELECT cr.id, cr.cancellation_type, cr.status, cr.refund_status, cr.refund_amount
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id;

SELECT rt.id, rt.cancellation_request_id, rt.destination_type, rt.status, rt.amount
FROM refund_transaction rt
JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY rt.id;

SELECT pt.id, p.provider, pt.transaction_type, pt.status, pt.amount
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id;
```

---

## Suggested fix / verify

1. For every `cancellation_request` with SOURCE `completed`, ensure matching APP_WALLET row (same amount) or mark refund FAILED + `WALLET_CREDIT_FAILED`.  
2. Do not mark `refund_status=COMPLETED` when wallet leg is missing.  
3. Retest RT cancel (both legs) on bnp; confirm Nexus shows both credit lines and DB has 2× (SOURCE+APP_WALLET) pairs.

---

## Related

- OW cancel two-leg on BR1793694660292286 / BR1793694191425078 — **PASS** (single cancel row)  
- ISSUE-1 — wallet `payment.status=refunded` vs §4.4 `captured` on partial (doc/status; separate)  
- Report pack: `travel-apis/flight/reports/bnp-wallet-changelog-2026-11-03.md`
