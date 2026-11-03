# ANS V2 check — FB1793259782766802 (Flight)

**Checked:** 2026-10-29 13:29 IST  
**Page:** https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793259782766802  
**Partner chrome:** Travel VIP  
**Device:** Nothing A015 (`00117648V003247`)

## Page

| Field | Value |
|-------|--------|
| Status | Successful |
| Booking Id | FB1793259782766802 |
| PNR | **Z9PYXX** |
| Route | New Delhi → Mumbai (via IXB) · IX-1274 + IX-1547 |
| Pax | MR. PRATIK THAKARE (26) |
| Baggage | Cabin 7 Kg · Check-in 15 Kg |
| Total | **₹5,316.00** |
| Shared to | `rohan@travelvip.ai` · 7219784663 |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** | `rohan@travelvip.ai` | **PASS** | `[DEV] Travel VIP \| Your Flight Booking Confirmed \| FB1793259782766802` · PNR Z9PYXX · 1:13 PM |
| **Admin** | `rohan@scandid.in` | **PASS** | Same Confirmed · DEL–IXB preview |
| **CS** | CSV2 | **PASS** | Payment Init→OK→Submitted→**Ticketed** · 1:13 PM |

**Soft:** User/Admin preview shows **DEL→IXB** only; page is full DEL→BOM with layover at Siliguri (same pattern as prior multi-leg soft gap).

## Notification (device)

| Check | Result |
|-------|--------|
| TravelVIP push for this FB | **NOT RECEIVED** |
| Shade evidence | `notif-shade.png` — lock screen; only USB debugging |
| Notes | Phone locked · Emergency calls only · no ollie.travelvip push in dumpsys |

## Verdict

| Emails User + Admin + CS | **PASS** |
| Notif on A015 | **NOT RECEIVED** |
