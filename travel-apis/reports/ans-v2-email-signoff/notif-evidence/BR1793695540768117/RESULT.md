# Thomas Cook · Lounge (Request-based) · BR1793695540768117

**Type:** Request-based lounge  
**Partner:** Thomas Cook (`lambda-shop.travelvip.ai`)  
**Verdict: PASS (fixed & deployed)** — Was Confirmed email Ref N/A vs page Id 789654. Marked PASS 04/11 — fix deployed; upcoming emails will show correct details. Request Submitted was already PASS; DragonPass correctly absent.

| Check | Result |
|-------|--------|
| Host | `https://lambda-shop.travelvip.ai` |
| Page status | Confirmed (was Request Submitted) |
| ANS V2 / template | Yes — `[DEV] Thomas Cook` / `CSV2 Thomas Cook` |
| Notification | NOT TESTED |

## Request Submitted — PASS

| Channel | Result |
|---------|--------|
| User / Admin / CS | PASS · Total **INR 884** = page ₹884 · Thomas Cook chrome |

## Confirmed — BUG (QR Ref)

| Channel | Result |
|---------|--------|
| User | Received · 1:14 AM · Total INR 884 · **Ref: N/A** (BUG) · Valid till 21/11/2026 · **no DragonPass** |
| Admin | PASS (BCC) — same body as User (incl. Ref N/A) |
| CS | PASS — CSV2 Booking Confirmed · INR 884 · Partner Thomas Cook |

### QR / Ref / DragonPass / Valid till (Confirmed)

| Field | Page | User/Admin Confirmed email | Match |
|-------|------|----------------------------|-------|
| Pass / Ref | **Id : 789654** | **Ref: N/A** | **BUG** |
| Valid till | **21/11/2026** | **Valid till: 21/11/2026** | **Yes** |
| DragonPass | **None** (expected request-based) | **None** — no logo / no text | **Yes (correct)** |
| QR image | Present | Present (`alt=QR Code`) | Yes |
| Pax | Mr Atul Ugale | Atul Ugale | Yes |

## Page vs User Confirmed email (other fields)

| Field | Page | User email | Match |
|-------|------|------------|-------|
| Booking ID | BR1793695540768117 | same | Yes |
| Status | Confirmed | Confirmed | Yes |
| Lounge | Elysian Lounge FF (New Terminal - Domestic - Departure) | same | Yes |
| Terminal | PNQ - New Terminal | New Terminal - PNQ | Yes |
| Journey | 21 Nov 2026 · 6:59 AM | Sat, 21 Nov 2026, 06:59:00 | Yes |
| Base / Savings / Total | ₹1,105 / −₹221 / **₹884** | INR 1105 / −221 / **884** | Yes |
| Chrome | — | Thomas Cook | Yes |

Soft: page/email pax age “12 years”; email tax INR 0.00; flight JHNKN not in User mail.
