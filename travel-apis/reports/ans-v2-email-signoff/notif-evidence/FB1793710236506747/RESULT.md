# Entertainer · Flight V1 · FB1793710236506747

**Partner:** the ENTERTAINER Lifestyle (`lambda-ent.travelvip.ai`)  
**Flow:** Flight booking V1 (confirmation URL v2 path)  
**Page:** email-only  
**Verdict: PASS** — User/Admin/CS received; Entertainer chrome; PNR + fare match. Route-subject soft cleared (fixed per QA 04/11).

| Check | Result |
|-------|--------|
| User | PASS — `[DEV] the ENTERTAINER Lifestyle \| Your Flight Booking Confirmed \| FB1793710236506747` · to `rohan@travelvip.ai` |
| Admin | PASS — same Confirmed mail (customer = `rohan@travelvip.ai`) |
| CS | PASS — `[DEV] CSV2 the ENTERTAINER Lifestyle \| Your Flight Booking \| FB1793710236506747` · through **Booking Confirmed** / Flight **TICKETED** · Partner = the ENTERTAINER Lifestyle |
| Theme | PASS — Entertainer logo + “the ENTERTAINER Lifestyle Information” flight chrome |
| PNR | **R6USTQ** User = CS |
| Amount | Total **GBP 44.64** (Base 26.23 · Tax 18.41 · Savings 0.00) = CS |
| Airline | AIR INDIA EXPRESS 1534 (+ connecting IX 2224 on User legs) |

## User ↔ CS Confirmed/Ticketed

| Field | User | CS | Match |
|-------|------|-----|-------|
| Booking ID | FB1793710236506747 | FB1793710236506747 | Yes |
| Partner | the ENTERTAINER Lifestyle | the ENTERTAINER Lifestyle | Yes |
| PNR | R6USTQ | R6USTQ | Yes |
| Pax | DAVID JUNIOR | DAVID JUNIOR | Yes |
| Travel date | 21 Nov 2026 | 2026-11-21 | Yes |
| Origin / Dest (CS) | BLR→DEL via GOI (legs) | Bengaluru → New Delhi | Yes (route subject fixed) |
| Flight | IX 1534 + IX 2224 | AIR INDIA EXPRESS-1534 | Yes |
| Total | GBP 44.64 | GBP 44.64 | Yes |
| Status | ✓ Confirmed | Booking Confirmed / TICKETED | Yes |

## Evidence
- `email/user-confirmed.png` / `user-confirmed-lower.png`
- `email/cs-ticketed.png` / `cs-ticketed-lower.png`
