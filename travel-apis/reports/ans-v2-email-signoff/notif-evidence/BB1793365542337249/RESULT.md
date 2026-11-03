# Bus — BB1793365542337249 (SMT · 2026-10-30) · **PASS Confirmed + Cancelled**

**Partner chrome:** Travel VIP (SMT)  
**Page:** https://lambda-shop.travelvip.ai/bus/booking-confirmation/BB1793365542337249  
**Trip:** Pune → Mumbai · 13 Nov 2026 · Infinity Infoway Volvo A/C Multi Axle Sleeper · Seat **E** · Rohan · PNR **253288080** · Total **₹667.16** · refund shown at cancel UI **₹527.06** (20% charge) · `rohan@travelvip.ai` / +91 7219784663

---

## Confirmed · ~18:36 IST — **PASS**

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Inbox) | `[DEV] Travel VIP \| Your Bus Booking Confirmed \| BB…7249` · PNR 253288080 · `email/user-confirmed.png` |
| **Admin** | **PASS** | Same Confirmed BCC on `rohan@scandid.in` · 6:36 PM |
| **CS** | **PASS** | CSV2: Payment Init → Payment OK → Submitted → **Confirmed** · 6:36 PM |
| **Notif** | **PASS** | A015: `Bus Booking Confirmed` · `BB1793365542337249` · `notif-dumpsys-confirmed.txt` |

---

## Cancelled · ~18:38–18:39 IST — **PASS**

Page status: **Cancelled** · Seat marked Cancelled.

| Channel | Result | Notes |
|---------|--------|--------|
| **User** | **PASS** (Inbox) | `[DEV] Travel VIP \| Your Bus Booking Cancelled \| BB…7249` · 6:38 PM · `email/user-cancelled.png` |
| **Admin** | **PASS** | Same Cancelled BCC on `rohan@scandid.in` · 6:38 PM |
| **CS** | **PASS** | `[DEV] CSV2 Travel VIP \| Your Bus Booking Cancelled \| BB…7249` · 6:39 PM |
| **Notif** | **PASS** | A015: `Bus Booking Cancelled` · text `BB1793365542337249` · `notif-dumpsys-cancelled.txt` · `notif-shade-cancelled.png` |

**Note:** First cancel UI attempt returned “only cancel again after 5 minutes”; cancel still completed (~18:38) and all ANS channels fired.

### Overall
| Confirmed | Cancelled |
|-----------|-----------|
| **PASS** (User/Admin/CS/Notif) | **PASS** (User/Admin/CS/Notif) |
