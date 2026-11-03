# Porter — SR1793356493625548 (SMT · 2026-10-30)

**Partner chrome:** Travel VIP (SMT)  
**Page:** https://lambda-shop.travelvip.ai/service/booking-details/SR1793356493625548  
**Page:** Booking Confirmed (was Request Submitted) · Pune Porter Service - Domestic · arrival · Bags **5** · Flight JHBJKHB · Travel Date 2026-11-20 · Guest Pratik Thakare · Base ₹1,950 · Discount −₹195 · **₹1,755.00** · `rohan@travelvip.ai`

## Request Submitted (4:05 PM)

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Inbox) | `[DEV] Travel VIP \| Your Porter Request Submitted \| SR…5548` |
| **Admin** | **PASS** | Same BCC on `rohan@scandid.in` |
| **CS** | **PASS** | CSV2 Action ID **8687**: Pending → Payment OK → Request Submitted |
| **Notif** | **PASS** | A015: `Porter Booking Request Submitted` · `notif-shade.png` |

## Booking Confirmed (4:32–4:33 PM)

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Inbox) | `[DEV] Travel VIP \| Your Porter Confirmed \| SR…5548` · 4:33 PM · Base 1950 / Savings −195 / Total 1755 · ✓ Confirmed |
| **Admin** | **PASS** | Same BCC · 4:33 PM |
| **CS** | **PASS** | CSV2 adds stage **Booking Confirmed** (“Porter booking CONFIRMED”) · Action ID 8687 |
| **Notif** | **PASS** | A015: `Porter Booking Confirmed` · text `SR1793356493625548` · `notif-confirmed.png` |

### Soft
- Terminal field = direction `arrival` (both stages)
- Page Bags **5** not in User/Admin body
- **Submitted only:** “Booking Date Date”; Base Fare shown as 1755 + Savings −195; “The bookings is non refundable”
- **Confirmed:** fare/grammar fixed (Base 1950; “The booking is non-refundable”)
