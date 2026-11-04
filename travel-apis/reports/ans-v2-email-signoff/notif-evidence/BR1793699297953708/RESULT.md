# Thomas Cook · Fast Track · BR1793699297953708

**Partner:** Thomas Cook (`lambda-shop.travelvip.ai`)  
**Page:** Confirmed · Test Airport Domestic Departure · CAN T1 · 23 Nov 2026 6:56 AM · Id **8576029826430326** · Valid till **23/11/2026** · Atul Ugale · Flight FB56526521651 · Total **₹5,250.53**  
**Verdict: PASS** — User/Admin/CS Confirmed; Thomas Cook chrome; amounts + Ref + Valid till match; Dragon Pass present (online FT).

| Check | Result |
|-------|--------|
| User | PASS — `[DEV] Thomas Cook \| Your Fast Track Booking Confirmed` · 3:18 PM |
| Admin | PASS (BCC of user Confirmed · to rohan@travelvip.ai) |
| CS | PASS — CSV2 through Confirmed · INR 5250.53 · Test Airport / CAN T1 |
| Amount | Ticket / Sub / Total **INR 5250.53** = page ₹5,250.53 |
| QR / Ref | Page Id **8576029826430326** = email Dragon Pass Ref |
| Valid till | Page **23/11/2026** = email Valid Till (trailing comma soft) |

## Page vs User email

| Field | Page | User email | Match |
|-------|------|------------|-------|
| Booking ID | BR1793699297953708 | Ticket Number same | Yes |
| Status | Confirmed | ✓ Confirmed | Yes |
| Service | Test Airport, Domestic Departure | Test Airport,Domestic Departure | Yes |
| Airport / terminal | CAN · Terminal 1 | Terminal 1 - CAN | Yes |
| Journey | 23 Nov 2026 · 6:56 AM | Mon, 23 Nov 2026, 06:56 | Yes |
| Pass / QR Ref | Id 8576029826430326 | Dragon Pass Ref same | Yes |
| Valid till | 23/11/2026 | Valid Till: 23/11/2026, | Yes (soft trailing comma) |
| Dragon Pass | (page QR section) | Dragon Pass logo present | Yes — expected for online FT |
| Guest | Mr Atul Ugale | Atul Ugale | Yes |
| Flight | FB56526521651 | (not in user mail body) | Soft — email omits flight |
| Ticket / Total | ₹5,250.53 | INR 5250.53 | Yes |
| Savings / Tax | **not on page** (only Base + Total) | -INR 0.00 / INR 0.00 | Soft — email-only zeros |
| Chrome | — | Thomas Cook | Yes |

Soft: Valid Till trailing comma; email shows Savings/Tax at 0.00 but page Fare Break-Up has only Base Price + Total (no those lines); flight omitted from user mail; page footer Travel VIP T&C.
