# Benepik (bnp) wallet changelog — results 2026-11-03

**Env:** `dev-benepik.travelvip.ai` · partner **bnp** · DB `travelx`  
**Changelog:** 30 Oct 2026 — Wallet payments, refunds & alerts  
**Nexus wallet:** Benepik Partner · available ₹76,249.43 (at check)

## Scoreboard

| # | Scenario | BR | Status | Notes |
|---|---|---|---|---|
| 1 | Happy path hold → pay → commit → ticket (§4.2) | BR1793694660292286 | **PASS** | OW · UI Confirmed + wallet Committed + DB (pre-cancel) |
| 1 | Happy path RT + SSR (§4.2) | BR1793699339822401 | **PASS** | RT Confirmed · wallet+benepik `captured` 1720454 · wallet CAPTURE · no cancel · no critical alert |
| 7 | RT online cancel + two-leg refund (§4.4) | BR1793699339822401 | **BUG** | 2 PARTIAL cancels (763+764). Cancel **763** two-leg OK (376900). Cancel **764**: SOURCE 297550 completed but **no APP_WALLET** row; benepik REFUND 4793 with **no** matching wallet REFUND. Wallet UI only shows +₹3,769 (763). No `WALLET_CREDIT_FAILED` alert. cr 764 still COMPLETED |
| 7 | Online cancel + two-leg refund (§4.4) | BR1793694660292286 | **PASS** | Money/alerts OK · wallet `refunded` = intended (not ISSUE) |
| 7/8 | Online cancel + two-leg refund (§4.4) | BR1793694191425078 | **PASS** | Money OK · wallet `refunded` = intended (not ISSUE) |
| 2 | Guest user → `GUEST_BOOKING_NOT_ALLOWED` | — | **NOT TESTED / BLOCKED** | Token-based login only — no guest session path to reproduce |
| 3 | bnp wallet balance too low → `INSUFFICIENT_BALANCE` | — | **SKIPPED** | Skip for now |
| 4 | bnp, Benepik payment fails → hold released + alert | BR1793696408638954 (attempt) | **NOT TESTED** | Could not create a clean payment-failed path. Bank decline UI shown but Razorpay stayed on retry; no `PARTNER_PAYMENT_FAILED` alert. Hold later **Released** on Nexus (likely expiry / abandon), while DB wallet stayed `authorized` / benepik `pending` — not scored as #4 BUG |
| 6→9 | Provider FAILED then Benepik refund declined | BR1793699889504060 | **PASS** (DB+alert fail path) | wallet+benepik stayed `captured`; benepik REFUND **failed** 538234; rt SOURCE **failed** only (no APP_WALLET); `GATEWAY_REFUND_FAILED` alert · wallet correctly not credited · ops must refund Benepik manually |
| 8 | Partial pax cancel + two-leg refund | BR1793701152782811 | **PASS** | UI Partially cancelled · refund 498234 two-leg OK · wallet `refunded` intended · cr type FULL/OFFLINE (soft) |
| 5, 10–16 | Remaining | — | **NOT TESTED** | — |

## #4 NOT TESTED

Attempted with **BR1793696408638954** (bank decline on Razorpay, UI stayed on retry). No clean fail webhook / `PARTNER_PAYMENT_FAILED`. Hold released on Nexus later; DB left wallet `authorized` + benepik `pending`. **Not scored** — scenario not reproduced.

## Next scenario — #5

**bnp, pay after hold expired (>15 min)** → no ticket, booking FAILED, Benepik refunded, Benepik told FAILED.


---

## #1 PASS then #7 — BR1793694660292286

### Pre-cancel (#1)
| Check | Result |
|---|---|
| UI status | Confirmed |
| Wallet UI | Held → Committed ₹5,382.34, Released ₹0 |
| `payment` | 4219 wallet + 4220 benepik both `captured` 538234 |
| `payment_transaction` | wallet CAPTURE 4783 · benepik AUTH 4782 |

### Post-cancel (#7) — 2026-11-03 ~08:52 UTC
| Check | Result | |
|---|---|---|
| UI | Cancelled · paid ₹5,382.34 · charge ₹883.40 · refund ₹3,950.60 Success | PASS |
| Mattermost `critical-partner-alerts-dev` | no alert for this BR | PASS |
| `flight-alerts-dev` | Penalty + Cancel SUCCESS | OK (ops) |
| `payment` 4219 wallet | **`refunded`** 538234 | OK (intended) |
| `payment` 4220 benepik | `captured` 538234 | PASS |
| `payment_transaction` | AUTH 4782 · CAPTURE 4783 · benepik REFUND **4784** 395060 · wallet REFUND **4785** 395060 (exactly one each) | PASS |
| `cancellation_request` **761** | FULL ONLINE · success · refund_status COMPLETED · paid 538234 · refund 395060 · penalty 88340 | PASS |
| `refund_transaction` | **1372** SOURCE completed 395060 · **1373** APP_WALLET completed 395060 · same cr 761 | PASS |
| Equal legs / Benepik then wallet | same amount; partial (≠ full paid → type 1 path) | PASS |
| Nexus wallet activity | Commit −₹5,382.34 + Refund received **761** +₹3,950.60 Completed; Reserved holds ₹0 | PASS |

### Nexus wallet (post-cancel)
| Line | Time | Amount | Status |
|---|---|---|---|
| Booking payment · BR1793694660292286 | 02:01 pm | −₹5,382.34 | Committed |
| Refund received · **761** (matches `cancellation_request.id`) | 02:22 pm | +₹3,950.60 | Completed |
| Wallet header | — | Available ₹85,582.37 · Reserved **₹0** · No active holds | OK |

---

## #7/#8 — BR1793694191425078 (Cancelled)

| Check | Result |
|---|---|
| UI | Cancelled · refund ₹3,950.60 Success · charge ₹883.40 · PNR SIM-JKWLZQ |
| Mattermost `critical-partner-alerts-dev` | no alert for this BR |
| `payment` | 4217 wallet · 4218 benepik · both amount 538234 |
| `payment_transaction` | CAPTUREs + **one** benepik REFUND 4778 (395060) + **one** wallet REFUND 4779 (395060) |
| `cancellation_request` | id **759** · FULL · ONLINE · status success · refund_status COMPLETED |
| `refund_transaction` | **1368** SOURCE completed 395060 · **1369** APP_WALLET completed 395060 · same cr 759 · equal amounts · SOURCE has `revertBooking` |

### ISSUE-1 — CLOSED (not an issue)

Wallet `payment.status = refunded` after cancel/partial refund is **intended** — status reflects payment outcome against the booking total amount, not “must stay captured per §4.4”. Changelog wording superseded by product behaviour. **Do not track.**

---

## ISSUE-3 — RT cancel missing second-leg wallet credit

**Full write-up:** [`ISSUE-bnp-rt-cancel-missing-wallet-credit-BR1793699339822401.md`](./ISSUE-bnp-rt-cancel-missing-wallet-credit-BR1793699339822401.md)

| Field | Value |
|---|---|
| BR | BR1793699339822401 |
| Severity | Money BUG |
| Symptom | Cancel **764** SOURCE ₹2,975.50 completed; **no APP_WALLET**; no `WALLET_CREDIT_FAILED` alert; cr still COMPLETED |
| Wallet under-credit | ₹2,975.50 (UI total refund ₹6,744.50 vs wallet +₹3,769 only) |

---

## #2 BLOCKED

Token-based login on bnp — cannot open a true guest (no-token) book session. Skip unless API can call create-booking without end-user token.
