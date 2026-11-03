# Request-based Lounge — BR1793358755367025 (SMT · 2026-10-30) · Request Submitted → Confirmed (dashboard QR)

**Verdict: PASS** — SMT partner · **request-based lounge flow** (Requested + Confirmed · User/Admin/CS/Notif · QR upload · no DragonPass)

**Partner chrome:** Travel VIP (SMT)  
**Page:** https://lambda-shop.travelvip.ai/lounge/booking-confirmation/BR1793358755367025  
**Page (Confirmed):** Elysian Lounge GF · PNQ New Terminal · 21 Nov 02:05 · Mrs Sharayu Meghare · Base ₹1,105 · Savings −₹110.5 · Total **₹994.5** · to `shaileshg@scandid.in`  
**Dashboard QR upload:** QR loads (`…/bookings/lounges/4969_qr_adult1_…`) · Pass Id **`7896547`** · Valid till 21/11/2026  
**DragonPass:** **absent** on page + Confirmed email (as expected for this offline/dashboard path)

## Request Submitted (~4:42–4:43 PM)

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (via guest) | To `shaileshg@scandid.in` — not in QA User inbox. Content via Admin BCC |
| **Admin** | **PASS** | Request Submitted · 4:43 PM · BCC |
| **CS** | **PASS** | Pending → Request Sent → Payment OK → Booking Request Submitted |
| **Notif** | **PASS** | `Lounge Booking Request Submitted` · `BR…7025` · `notif-shade.png` |

## Booking Confirmed (~4:52 PM) — dashboard QR + sample ref

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (via guest) | To `shaileshg@scandid.in`; Confirmed content on Admin BCC |
| **Admin** | **PASS** | `[DEV] Travel VIP \| Your Lounge Booking Confirmed \| BR…7025` · 4:52 PM · ✓ Confirmed · QR image present · **no DragonPass** · fare 1105/−110.50/994.50 |
| **CS** | **PASS** | CSV2 adds **Lounge booking CONFIRMED** (Pending → Request Sent → Payment OK → Confirmed ✓) · 4:52 PM |
| **Notif** | **PASS** | A015: `Lounge Booking Confirmed` · text `BR1793358755367025` · `notif-confirmed.png` · `notif-dumpsys-confirmed.txt` |

### QR / Ref / DragonPass (Confirmed)

| Check | Page | Confirmed email (Admin BCC) |
|-------|------|------------------------------|
| QR | Visible (`Lounge QR`, uploaded dashboard asset) | Visible (`QR Code`, same `4969_qr_adult1_…` asset) |
| Sample ref | **`Id : 7896547`** | `Ref: N/A` (soft — page has sample ref) |
| Valid till | `21/11/2026` | `Valid till: 21/11/2026` |
| DragonPass | **None** (no logo / no text) | **None** (no logo / no text) |

### Soft (does not block flow PASS)
- Page Pass Id `7896547` vs Confirmed email `Ref: N/A` (soft)
- User → guest inbox (`shaileshg@scandid.in`)
- Copy: “Confirmed .” (space before period)
