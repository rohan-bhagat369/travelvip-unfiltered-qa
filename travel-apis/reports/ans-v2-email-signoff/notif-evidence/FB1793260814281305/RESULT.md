# ANS V2 check — FB1793260814281305 (Flight RT / V1 path)

**Checked:** 2026-10-29 13:32 IST  
**Page:** https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793260814281305  
**Partner chrome:** Travel VIP  
**Device:** Nothing A015 (`00117648V003247`) · pkg `ai.txv2.starter`

## Page

| Field | Value |
|-------|--------|
| Status | Successful |
| Booking Id | FB1793260814281305 |
| Outbound | DEL → BOM · IX-1056 · PNR **S5QMJD** |
| Return | BOM → DEL · IX-1050 · PNR **U7K2VN** |
| Pax | MR. RAJ THAKARE (28) · MSTR. SHAN DUBYE (1) |
| Total | **₹10,834.00** |
| Shared to | `rohan@travelvip.ai` · 7219784663 |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** | `rohan@travelvip.ai` | **PASS** | Confirmed · both legs in body (S5QMJD + **U7K2VN**) · 2 travellers · ₹10834 · 1:31 PM |
| **Admin** | `rohan@scandid.in` | **PASS** | Same Confirmed body (BCC) |
| **CS** | CSV2 | **PASS** | Payment Init→OK→Submitted→**Ticketed** · 1:31 PM |

**Note:** Gmail *list* snippet shows only header `DEL to BOM` / `S5QMJD`. Full open has return **Mumbai To New Delhi** + PNR **U7K2VN**. Header line still summarises outbound only — not a missing-return bug.

## Notification (device)

| Check | Result |
|-------|--------|
| TravelVIP / TX push | **PASS** |
| Title / body | `Flight Booking Confirmed` / `FB1793260814281305` |
| Package | `ai.txv2.starter` (FCM) |
| Shade evidence | `notif-shade.png` · dumpsys `notif-dumpsys.txt` |

## Verdict

| Emails User + Admin + CS | **PASS** |
| Notif on A015 | **PASS** |
| Overall | **PASS** |
