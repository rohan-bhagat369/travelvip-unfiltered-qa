# ANS V2 check — TX1793264472515952 (Duty Free V2 · Request Submitted)

**Checked:** 2026-10-29 14:35 IST  
**Page:** https://lambda-shop.travelvip.ai/dutyfreeV2/order/TX1793264472515952  
**Partner chrome:** Travel VIP  
**Device:** Nothing A015 · pkg `ai.txv2.starter`

## Page

| Field | Value |
|-------|--------|
| Status | Order Received / Reserved |
| Order | #TX1793264472515952 |
| Store | Mumbai Duty Free · BOM · T2 International **Arrival** |
| Collect on | 6 Nov 2026 · 02:30 PM |
| Pax | Pratik Thakare |
| Item | Chivas Regal 12 Yo + Extra 13 Rum combo |
| Paid | **₹6,706** (MRP ₹9,580 · save ₹2,874) |
| Email | `rohan@travelvip.ai` |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** | `rohan@travelvip.ai` | **PASS** | `[DEV] Travel VIP \| Your Dutyfree Booking Request Submitted \| TX…5952` · Under Progress · ₹6,706 · Chivas · pickup 06/11/2026 · T2 Arrival · 2:31 PM |
| **Admin** | `rohan@scandid.in` | **PASS** | Same user Confirmed/Submitted body (BCC) |
| **CS** | `devcs` / CS Alert | **PASS** | (1) **Payment Successful** · (2) **Booking Request Submitted** · Action ID 8540 · Total INR 6706 · no `CSV2` prefix (Duty Free CS Alert format) |

## Soft (content, not delivery)

| Item | Note |
|------|------|
| Collect copy | User mail says go to **Departures** counter; page/pickup = **Arrival** |
| Flight No. | `N/A` in mail |
| Typos | `sucessfully` / page `recieved` |

## Notification (device)

| Check | Result |
|-------|--------|
| Push | **PASS** |
| Title / body | `Duty Free Request Submitted` / `TX1793264472515952` |
| Evidence | `notif-shade.png` · `notif-dumpsys.txt` |

## Verdict (Submitted · TC-DF-01)

| Emails User + Admin + CS (Submitted) | **PASS** |
| Notif | **PASS** |
| Overall TC-DF-01 | **PASS** |

---

## Cancelled recheck · 2026-10-29 14:44 IST (TC-DF-03)

### Page

| Field | Value |
|-------|--------|
| Status | **Order Cancelled** |
| Copy | Will not be prepared for collection · refund requested / team will process |

### Emails

| Channel | Result | Notes |
|---------|--------|-------|
| **User** | **PASS** | `[DEV] Travel VIP \| Your Dutyfree Booking Cancelled \| TX…5952` · 2:43 PM · Cancelled · Chivas · Fare Paid ₹6,706 |
| **Admin** | **PASS** | Same Cancelled body (BCC) |
| **CS** | **PASS** | CS Alert · Stage **Booking Cancelled** · Action ID 8540 |

### Soft (content)

| Item | Detail |
|------|--------|
| Refund copy vs numbers | Body: “full refund has been initiated” · Summary: **Total refund initiated INR 0** · Policy: non-refundable · Page: refund requested |
| Pickup | Still shows Arrival (OK) |

### Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Duty Free Cancelled` / `TX1793264472515952` |
| Evidence | `notif-shade-cancelled.png` |

### Verdict (Cancelled)

| Emails + Notif | **PASS** |
| Overall TC-DF-03 | **PASS** (soft refund copy vs ₹0) |
