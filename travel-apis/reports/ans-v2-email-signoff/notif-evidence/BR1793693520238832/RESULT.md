# TravelVerse · Attractions · BR1793693520238832

**Page:** Confirmed · Singapore · GTMINXDI · Journey 20 Nov 2026 · Total $12.56  
**Verdict: PASS (fixed & deployed)** — Was User NOT RCVD (`rohaan@` typo). Marked PASS 04/11 — fix deployed; upcoming emails will show correct details. Admin + CS were already PASS.

## Confirmed

| Channel | Result |
|---------|--------|
| User | **BUG / NOT RCVD** — 0 hits in u/0; To header on Admin BCC = `rohaan@travelvip.ai` |
| Admin | PASS (BCC) — `[DEV] TravelVerse \| … Attractions Booking Confirmed` · 1:42 PM |
| CS | PASS — CSV2 stages through Confirmed · USD 12.56 |
| Amount | Base 8.61 · disc −1.29 · tax 5.24 · Total **USD 12.56** = page $12.56 |

## Page vs Admin BCC email (user template)

| Field | Page | Email | Match |
|-------|------|-------|-------|
| Booking ID | BR1793693520238832 | Ticket Number same | Yes |
| Status | Confirmed | ✓ Confirmed | Yes |
| Activity title | Ticket 1 | Ticket 1 / Entry to Ticket 1 | Soft — placeholder name |
| Location | Singapore, Singapore | (in template) | Yes |
| Journey / Valid | 20 Nov 2026 | Valid Till 20/11/2026 | Yes |
| Conf code | GTMINXDI | QR Ref GTMINXDI | Yes |
| Guest | Shailesh Bhagat | same | Yes |
| Contact email | **rohaan@travelvip.ai** | **rohaan@travelvip.ai** | Yes (typo vs QA `rohan@`) |
| Phone | +91 8010778440 | same | Yes |
| Adult | 1 x $8.61 | Base USD 8.61 | Yes |
| Discount | -$1.29 | -USD 1.29 | Yes |
| Taxes | $5.24 | USD 5.24 | Yes |
| **Total** | **$12.56** | **USD 12.56** | **Yes** |
| Chrome | page T&C “Travel VIP” | TravelVerse | Soft on page footer |

**Root cause of User miss:** booking contact email typed as `rohaan@` (extra **a**). Template content + amounts OK via Admin BCC.
