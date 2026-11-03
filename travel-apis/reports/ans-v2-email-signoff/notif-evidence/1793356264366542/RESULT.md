# Hotel — 1793356264366542 (SMT · 2026-10-30) — PASS

**Partner chrome:** Travel VIP (SMT)  
**Page:** https://lambda-shop.travelvip.ai/hotel/booking-details/1793356264366542  
**Page:** Confirmed · Taj Dubai · Conf No **SNHAPI00011640** · 30–31 Oct · Downtown View Room King Bed × 2 · 2 rooms · Shailesh Gaikwad · **₹59,865.50** · guest email `shaileshg@scandid.in`

| Status | User | Admin | CS | Notif | QA |
|--------|------|-------|----|-------|-----|
| **Confirmed** | PASS (to `shaileshg@scandid.in`) | PASS | PASS | PASS | **PASS** |
| **Cancellation Requested** | PASS (to guest) | PASS | PASS | PASS | **PASS** |
| **Cancelled** | — | — | — | — | **N/A / not supported** |

### Comment
Cancellation via dashboard in the **old hotel flow is not supported** — so **Cancelled** email is not received, and the user cancel action is also not created. Stop at Cancellation Requested; do not expect a final Cancelled ANS for this path.

### Soft (non-blocking)
- User mail to guest `shaileshg@scandid.in` (not QA `rohan@travelvip.ai`); verified via Admin BCC
- CS Cancel Requested: Charges/Refund both INR 0 vs page policy 100% non-refundable
