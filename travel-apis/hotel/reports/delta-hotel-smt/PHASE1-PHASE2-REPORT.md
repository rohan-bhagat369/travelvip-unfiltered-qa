# Hotel booking unification — Phase 1 + Phase 2 report (2026-11-13)

**Base:** `https://delta-api.travelvip.ai`  
**Phase 1:** partner **vgm** · wallet · Nexus Partner Wallet  
**Phase 2:** partner **smt** · Stripe CARD · DB `travelx`

## Phase 1 — B2B wallet (vgm)

| # | Scenario | How tested | Status | Evidence |
|---|---|---|---|---|
| 1 | Successful booking | finalize → Pending → Confirmed; Nexus debit once | **PASS** | `BR1794553787773604` · Nexus −₹9,480.24 once |
| 2 | Provider reject / fail | Failed BR; wallet debit then refund | **PASS** | `BR1794553763333185` · Nexus − then +₹9,480.24 |
| 2b | Invalid PAN format | finalize with bad PAN shape | **PASS** | HTTP 400 `VALIDATION_ERROR` · no BR · no wallet row |
| 3 | Double finalize | same finalize body twice | **PASS** | `duplicate:true` · same BR · no second Nexus debit |
| 4 | Cancel confirmed (free) | penalty 0 → cancel → Nexus refund | **PASS** | Cancelled · Nexus Refund +₹9,480.24 |
| 5 | Status / details | poll status + detail | **PASS** | Pending → Confirmed / Failed / Cancelled |

**Phase 1 bugs:** none

---

## Phase 2 — SMT web/card (smt + Stripe)

| # | Scenario | How tested | Status | Evidence |
|---|---|---|---|---|
| 1 | Successful booking | createBooking CARD → Stripe confirm → v2 booking → Confirmed | **PASS** | `BR1794556830640046` · `SNHAPI00011741` · PI `pi_3UbFPPEWyGwVPuvk0tKLghHx` · ₹9400.74 |
| 2 | Provider reject after pay | bad PAN `AAAAA0000A` → pay → Failed | **BUG** | `BR1794556749304734` · Failed · `payment=captured` · **no REFUND / refund_transaction** |
| 2b | Invalid PAN format | createBooking invalid PAN | **PASS** | HTTP 400 · no BR |
| 3 | Double book (click twice) | replay createBooking + v2 booking | **PASS** | same BR/PI · `Booking already processed` · **one** `payment` row in DB |
| 4 | Cancel confirmed (free) | penalty-check → cancel | **PASS** | refund ₹9400.74 · Cancelled · DB REFUND `re_3UbFPP…` · `refund_transaction` SOURCE completed |
| 5 | Status trail | history + user_actions | **PASS** | 100→120→200→300→500 · payment_success → booking_confirmed → booking_cancelled |

### Phase 2 expected (not bugs)

| Item | Status |
|---|---|
| sales_summary `paid_amount=total`, `due=0` after fail/cancel | **PASS** (expected) |
| AUTH amount unit `9400` vs payment `940074` | **PASS** (expected) |
| `payment.status=captured` without separate CAPTURE txn row | **PASS** (expected) |
| `cancelled_at` set on Failed booking | **PASS** (expected) |

---

## Open bug

| ID | Phase | BR | Issue | Expect |
|---|---|---|---|---|
| **BUG-1** | 2 | `BR1794556749304734` | After vendor reject, booking Failed but Stripe payment stays **captured**; no `payment_transaction` REFUND; no `refund_transaction` | Full auto card refund recorded in DB (and Stripe), as on cancel path |
