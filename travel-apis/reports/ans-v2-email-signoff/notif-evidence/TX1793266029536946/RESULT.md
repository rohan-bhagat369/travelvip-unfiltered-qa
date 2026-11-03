# ANS V2 check — TX1793266029536946 (Duty Free V2 · Request Submitted)

**Checked:** 2026-10-29 14:57 IST  
**Page:** https://lambda-shop.travelvip.ai/dutyfreeV2/order/TX1793266029536946  
**Partner chrome:** Travel VIP  
**Device:** Nothing A015 · `ai.txv2.starter`

## Page

| Field | Value |
|-------|--------|
| Status | Order Received / Reserved |
| Store | Mumbai Duty Free · BOM · T2 International **Arrival** |
| Collect on | 6 Nov 2026 · 02:56 PM |
| Pax | Pratik Thakare |
| Item | Ciroc Vodka 100 Cl & Ciroc Red Berry 100 Cl |
| Paid | **₹9,584** (MRP ₹11,980 · save ₹2,396) |
| Email | `rohan@travelvip.ai` |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** | `rohan@travelvip.ai` | **PASS** | Request Submitted · Under Progress · Ciroc · ₹9,584 · pickup Arrival · 2:57 PM |
| **Admin** | `rohan@scandid.in` | **PASS** | Same user body (BCC) |
| **CS** | CS Alert | **PASS** | Payment Successful + Booking Request Submitted · Action ID **8541** · Total INR 9584 |

**Collect copy:** `Head to the Duty Free counter at the TERMINAL 2 - International - Arrival` — **matches page** (Departures mismatch from TX…5952 not present here). Mild soft: still says “before boarding” on an Arrival pickup.

## Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Duty Free Request Submitted` / `TX1793266029536946` |
| Evidence | `notif-shade.png` |

## Verdict (Submitted)

| Emails + Notif | **PASS** |
| Overall TC-DF-01 | **PASS** |

---

## Confirmed recheck · 2026-10-29 14:59 IST (TC-DF-02)

### Page

| Field | Value |
|-------|--------|
| Status | **Order Confirmed** |
| Copy | Your order is confirmed · Ciroc · ₹9,584 · T2 Arrival |

### Emails

| Channel | Result | Notes |
|---------|--------|-------|
| **User** | **PASS** | `[DEV] Travel VIP \| Your Dutyfree Booking Confirmed \| TX…6946` · 2:59 PM · ✓ Confirmed · ₹9,584 · Arrival collect |
| **Admin** | **PASS** | Same Confirmed body (BCC) · no CS block in thread |
| **CS Confirm** | **PASS (EXPECT)** | **No** CS Alert / Stage Booking Confirmed (wiki EXPECT) · prior Payment + Submitted CS still present only |

### Soft

| Item | Detail |
|------|--------|
| Typo | Header `Conifrmed` |
| Store Order ID | `N/A` |
| Collect | Arrival location OK · still “before boarding” |

### Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Duty Free Confirmed` / `TX1793266029536946` |
| Evidence | `notif-shade-confirmed.png` |

### Verdict (Confirmed)

| User + Admin + Notif | **PASS** |
| CS confirm absent | **PASS (EXPECT)** |
| Overall TC-DF-02 | **PASS (EXPECT)** |
