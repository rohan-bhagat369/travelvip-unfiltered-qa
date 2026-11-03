# ANS V2 check — BR1793257997359738 (Attraction)

**Checked:** 2026-10-29 12:50 IST  
**Page:** https://lambda-shop.travelvip.ai/tours-and-experiences/v2/confirmation/BR1793257997359738  
**Partner chrome:** Travel VIP (lambda-shop)  
**Device:** Nothing A015 (`00117648V003247`)

## Page

| Field | Value |
|-------|--------|
| Status | **Confirmed** |
| Booking ID | BR1793257997359738 |
| Booking date | 29 Oct 2026 |
| Journey | Sun, 15 Nov 2026 · Singapore |
| Guest | Shailesh Gaikwad · Adult x 1 |
| Conf code | **GTRAV4NC** · Valid till 15/11/2026 |
| Shared to | `shaileshg@scandid.in` · +91 8010778440 |
| Total | **₹1,239.75** (base 821.95 −82.2 + tax 500) |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** (customer) | `shaileshg@scandid.in` | **PASS*** | Page says tickets shared here. Admin BCC copy received on Scandid (To: shaileshg). `rohan@travelvip.ai` correctly has **no** this BR. |
| **Admin** | `rohan@scandid.in` | **PASS** | `[DEV] Travel VIP \| Your Attractions Booking Confirmed \| BR1793257997359738` · 12:43 PM · GTRAV4NC · INR 1239.75 · +91 |
| **CS** | `rohan@scandid.in` / CSV2 → `devcs` | **PASS** | Stages: Payment Init → OK → Submitted → **Confirmed** · Total 1239.75 · +91 8010778440 |

\* User channel verified via Admin BCC envelope (To shaileshg) + page “shared to”; customer mailbox not opened in this session.

## Notification (device)

| Check | Result |
|-------|--------|
| TravelVIP / ollie push for this BR | **NOT RECEIVED** |
| Shade evidence | `notif-shade-awake.png` (lock screen; only “USB debugging connected”) |
| Notes | Phone locked / Emergency calls only. Booking user is **Shailesh** — device must be logged into TravelVIP as that user (or same tier) for push. |

## Verdict

| Overall emails (User path via Admin BCC + CS) | **PASS** |
| Notif on A015 | **FAIL / NOT RECEIVED** (setup / user mismatch likely) |
