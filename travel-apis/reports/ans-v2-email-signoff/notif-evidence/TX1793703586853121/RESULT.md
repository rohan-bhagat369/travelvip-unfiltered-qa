# Thomas Cook · Duty Free · TX1793703586853121

**Partner:** Thomas Cook (`lambda-shop.travelvip.ai`)  
**Page:** Order Confirmed · Mumbai Duty Free · BOM T2 Intl Arrival · Collect **21 Nov 2026 · 06:05 AM** · Rohan Bhagat · Baileys Salted Caramel 100Cl · Paid **₹2,720**  
**CS:** No (EXPECT) — no `[DEV] CSV2 Thomas Cook` mail (same as TVS Duty Free)

## Request Submitted

| Channel | Result |
|---------|--------|
| User | PASS — `[DEV] Thomas Cook \| Your Dutyfree Booking Request Submitted` · 4:30 PM |
| Admin | PASS (BCC of user Request) |
| CS | No (EXPECT) |
| Amount | Total **INR 2,720** = page ₹2,720 |

## Confirmed

| Channel | Result |
|---------|--------|
| User | PASS — `[DEV] Thomas Cook \| Your Dutyfree Booking Confirmed` · 1:28 AM |
| Admin | PASS (BCC) |
| CS | No (EXPECT) — CSV2 search empty |
| Amount | Total **INR 2,720** = page ₹2,720 |

## Page vs User email (Confirmed)

| Field | Page | User email | Match |
|-------|------|------------|-------|
| Booking ID | TX1793703586853121 | same | Yes |
| Store Order ID | — | N/A | Soft |
| Status | Order Confirmed | ✓ Confirmed (+ header “Conifrmed”) | Soft typo |
| Product | Baileys Salted Caramel 100Cl | same | Yes |
| Airport / pickup | BOM T2 Intl Arrival | CSIA · TERMINAL 2 · Terminal 2 - International - Arrival | Yes |
| Pick-up date | 21 Nov,2026 · 06:05 AM | 21/11/2026 (no time) | Soft — time omitted |
| Guest | Rohan Bhagat | same | Yes |
| Contact | rohan@travelvip.ai | +91 8010778440 · same email | Yes |
| Base | ₹2,720 | INR 2720.00 | Yes |
| Savings | (none on page) | -INR 0.00 | Soft — email-only |
| **Paid** | **₹2,720** | **INR 2,720** | **Yes** |
| Chrome | — | Thomas Cook | Yes |

Admin also has Payment Success + Request ops-style internal notices (not CSV2). Softs (same family as TVS DF): `Conifrmed` typo; Store Order ID N/A; subject `Dutyfree`; Request body `sucessfully`; email savings 0.00; pick-up time not in mail.
