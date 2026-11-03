# Meet & Greet — SR1793356080195155 (SMT · 2026-10-30)

**Partner chrome:** Travel VIP (SMT)  
**Page:** https://lambda-shop.travelvip.ai/service/booking-details/SR1793356080195155  
**Page:** Booking Confirmed (was Request Submitted) · Pune Meet & Greet - Domestic · PNQ · Flight HGCVJV · arrival · Travel Date 2026-11-21 · Guest Pratik Thakare · ₹4,095.00 · `rohan@travelvip.ai` · +918888722680

## Request Submitted (3:58 PM)

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Spam → later Inbox) | `[DEV] Travel VIP \| Your Meet N Greet Request Submitted \| SR…5155` |
| **Admin** | **PASS** | Same BCC on `rohan@scandid.in` |
| **CS** | **PASS** | CSV2 Action ID **8686**: Pending → Payment OK → Request Submitted |
| **Notif** | **PASS** | A015: `Meet & Greet Booking Request Submitted` · `notif-shade.png` |

## Booking Confirmed (4:08 PM)

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Inbox) | `[DEV] Travel VIP \| Your Meet N Greet Confirmed \| SR…5155` · Pune International Airport · ✓ Confirmed · INR 4,095 |
| **Admin** | **PASS** | Same subject/body BCC · 4:08 PM |
| **CS** | **PASS** | CSV2 adds stage **Booking Confirmed** (“Meet & Greet booking CONFIRMED”) · Action ID 8686 |
| **Notif** | **PASS** | A015: `Meet & Greet Booking Confirmed` · text `SR1793356080195155` · `notif-confirmed.png` |

### Soft (both stages)
- Subject `Meet N Greet` vs page/notif `Meet & Greet`
- Terminal field = direction `arrival` (not a terminal code)
- Cancellation: “The bookings is non refundable”
