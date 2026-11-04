# TravelVerse · Hotel Old Flow · 1793711798118379

**Category:** Hotel Old Flow  
**Page:** Confirmed (UI lag) · Pride Premier Pune · 17–18 Nov 2026 · Conf No SNHAPI00011673 · Total $112.79  
**Verdict: PASS** — Confirmed + Cancellation Requested User/Admin/CS; TravelVerse chrome; paid amount matches.  
**Note:** Old hotel flow — dashboard cancel stops at **Cancellation Requested**; do not expect a final **Cancelled** ANS for this path.

## Confirmed — PASS

| Channel | Result |
|---------|--------|
| User | PASS — `[DEV] TravelVerse \| Your Hotel Booking Confirmed` · 6:47 PM |
| Admin | PASS (BCC) |
| CS | PASS — CSV2 through Confirmed · USD 112.79 · SNHAPI00011673 |
| Amount | Base 103.31 · savings −10.30 · tax 19.81 · Total **USD 112.79** = page $112.79 |

## Cancellation Requested — PASS

| Channel | Result |
|---------|--------|
| User | PASS — `[DEV] TravelVerse \| Your Hotel Booking Cancellation Requested` · 12:53 AM · SNHAPI00011673 · under review |
| Admin | PASS (BCC) — same body |
| CS | PASS — CSV2 stage **Cancellation Requested** · Paid **USD 112.79** · Charges/Refund **USD 0.00** |
| Page | Still **Confirmed** + Cancel Booking CTA (soft lag vs cancel-req emails) |

## Page vs User Confirmed email

| Field | Page | User email | Match |
|-------|------|------------|-------|
| Booking ID | 1793711798118379 | same | Yes |
| Conf No | SNHAPI00011673 | same | Yes |
| Status | Confirmed | Confirmed | Yes |
| Hotel | Pride Premier Pune | Pride Premier Pune, Pune | Yes |
| Check-in / out | 17 Nov / 18 Nov 2026 | 17 Nov '26 / 18 Nov '26 | Yes |
| Room | Deluxe Twin Room · 1 Room | Deluxe Twin Room · 1 Room(s) | Yes |
| Guest | Shailesh Gaikwad | Shailesh Gaikwad | Yes |
| Base | $103.31 | USD 103.31 | Yes |
| Savings | -$10.30 | USD 10.30 (no minus) | Soft |
| Tax | $19.81 | USD 19.81 | Yes |
| **Total** | **$112.79** | **USD 112.79** | **Yes** |
| Chrome | — | TravelVerse | Yes |

Soft: page “Taxes & Service Fess” typo; email savings missing minus; CS fare omits savings line (total still 112.79); no separate User Request Submitted mail (direct Confirmed); Cancel Requested page status lag; CS Charges/Refund 0.00 pending provider (same as Flight V1 Cancel Requested).
