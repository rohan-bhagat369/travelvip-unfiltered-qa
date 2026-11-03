# Bus — BB1793352327120871 (SMT · 2026-10-30) · Confirmed

**Verdict: PASS** — SMT partner · Bus Confirmed (User / Admin / CS / Notif)

**Partner chrome:** Travel VIP (SMT)  
**Booking:** BB1793352327120871 · PNR **253268189** · Mumbai → Pune (Sangamwadi) · 31 Oct 2026 · Infinity Infoway · Seat SL34 · Rohan Bhagat

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Spam) | `[DEV] Travel VIP \| Your Bus Booking Confirmed \| BB…0871` |
| **Admin** | **PASS** | Same BCC on `rohan@scandid.in` |
| **CS** | **PASS** | CSV2: Payment Init → Payment OK → Submitted → **Booking Confirmed** |
| **Notif** | **PASS** | A015: `Bus Booking Confirmed` · `BB1793352327120871` (also Cancelled notif seen later in dumpsys) |

### Soft
- Duration / boarding-drop times content softs noted in session
