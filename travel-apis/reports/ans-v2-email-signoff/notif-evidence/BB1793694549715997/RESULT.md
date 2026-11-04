# TravelVerse · Bus · BB1793694549715997

**Page:** Cancelled · Mumbai → Pune · 15 Nov 2026 · Infinity Infoway · Seat SL16 · Paid $56.12 · Refund $44.33  
**Verdict: PASS** — User/Admin/CS Confirmed + Cancelled; TravelVerse chrome; amounts match.

## Confirmed

| Channel | Result |
|---------|--------|
| User | PASS — `[DEV] TravelVerse \| Your Bus Booking Confirmed` · 1:59 PM |
| Admin | PASS (BCC) |
| CS | PASS — CSV2 through Confirmed · USD 56.12 · PNR 253594059 |
| Amount | Base USD 55.14 · disc -USD 1.60 · tax USD 2.63 · Total **USD 56.12** = page $56.12 |

## Cancelled

| Channel | Result |
|---------|--------|
| User | PASS — `[DEV] TravelVerse \| Your Bus Booking Cancelled` · 12:23 AM |
| Admin | PASS (BCC) |
| CS | PASS — CSV2 Cancelled · refund USD 44.33 |
| Refund | Cancel charge USD 11.79 · Refund **USD 44.33** = page $44.33 |

## Page vs User email (Cancelled)

| Field | Page | User email | Match |
|-------|------|------------|-------|
| Booking ID | BB1793694549715997 | Ticket Number same | Yes |
| PNR | 253594059 | same | Yes |
| Status | Cancelled | ✓ Cancelled | Yes |
| Operator | Infinity Infoway Pvt. Ltd. | same | Yes |
| Route | Mumbai → Pune | Mumbai → Pune | Yes |
| Journey | 15 Nov 2026 · 4:50 AM → 7:30 AM | same times | Yes |
| Duration | **10h 0m** | **2h 40m** | Soft — page wrong |
| Seat | Cancelled Seat : SL16 | Cancelled seatSL16 | Soft — missing space |
| Fare paid | $56.12 | USD 56.12 | Yes |
| Cancel charge | (implied 56.12−44.33) | USD 11.79 | Yes |
| Tax in refund block | — | USD 2.63 | Soft — shown in refund summary |
| **Refund** | **$44.33** | **USD 44.33** | **Yes** |
| Cancelled On / By | — | 03/11/2026, 6:53 PM · Rohit Kohli | Yes (CS same) |
| Chrome | — | TravelVerse | Yes |

Soft (carry from Confirmed): greeting `Hey Rohit KohliThank you`; page T&C Travel VIP; Confirmed fare line TravelVIP Discount.
