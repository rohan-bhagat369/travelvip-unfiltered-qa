# ANS V2 check — 1793266178907429 (Hotel Deals · Request Submitted)

**Checked:** 2026-10-29 15:08 IST  
**Page:** https://lambda-shop.travelvip.ai/hotel-deals/booking-details/1793266178907429  
**Partner chrome:** Travel VIP  
**Device:** Nothing A015 · `ai.txv2.starter`

## Page

| Field | Value |
|-------|--------|
| Status | **Booking Submit Success** / Request Submitted |
| Hotel | Lefay Resort and SPA Lago di Garda, Gargnano |
| Request ID | 1793266178907429 |
| Confirmation Number | **NVL6EMF** |
| Guest | Shailesh Gaikwad |
| Stay | 29–30 Oct 2026 · 1 night · deluxe junior suite |
| Advance paid | **₹8,729.72** |
| Total | ₹87,297.24 · Pending ₹78,567.52 |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** | `rohan@travelvip.ai` | **PASS** | `[DEV] Travel VIP \| Your Hotel Booking Request Submitted \| 179…7429` · Lefay · Shailesh · advance INR 8729.72 · REQUEST SUBMITTED · 3:00 PM |
| **Admin** | `rohan@scandid.in` | **PASS** | Same Request Submitted body (BCC) |
| **CS** | CSV2 | **PASS** | Created → Payment Init → Payment OK → **Request Sent** · Conf No **NVL6EMF** on Request Submitted stage |

## Soft

| Item | Detail |
|------|--------|
| Conf No in User/Admin | Page + CS show **NVL6EMF**; User/Admin Request Submitted body does **not** show confirmation number |
| Subject | Uses generic “Hotel Booking” (not “Hotel Deals”) — same as prior Hotel Deals ANS pattern |

## Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Hotel Booking Request Submitted` / `1793266178907429` |
| Evidence | `notif-shade.png` · `notif-dumpsys.txt` |

## Verdict (Request Submitted · TC-HD-01)

| Emails User + Admin + CS | **PASS** |
| Notif | **PASS** |
| Overall TC-HD-01 | **PASS** |

---

## Cancellation Requested (UI) · 2026-10-29 15:12 IST

**Note:** UI cancel from Submitted landed in **Cancellation Requested** (not final Cancelled).

### Page

| Field | Value |
|-------|--------|
| Status | **Cancellation Requested** |
| Copy | Request submitted · under review |
| Conf No | NVL6EMF |
| Page refund | Hotel cancel charges ₹0 · **Total Refund ₹8,729.72** |

### Emails

| Channel | Result | Notes |
|---------|--------|-------|
| **User** | **PASS** | `[DEV] Travel VIP \| Your Hotel Booking Cancellation Requested \| 179…7429` · 3:11 PM · NVL6EMF · CANCELLATION REQUEST SUBMITTED |
| **Admin** | **PASS** | Same Cancellation Requested body (BCC) |
| **CS** | **PASS** | CSV2 stage **Cancellation Requested** · 3:12 PM |

### Soft

| Item | Detail |
|------|--------|
| Paid vs refund | Page: refund **₹8,729.72** (advance). User mail Refund Summary: **Total Amount Paid INR 87,297.24** (full) · no matching refund line; room still **Non Refundable** |
| Final Cancelled | Not yet — still Cancellation Requested |

### Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Hotel Booking Cancellation Requested` / `1793266178907429` |
| Evidence | `notif-shade-cancelled.png` |

### Verdict (Cancellation Requested)

| Emails + Notif (Cancellation Requested) | **PASS** |
| Final Cancelled (TC-HD-03) | see below |

---

## Cancelled (dashboard) · 2026-10-29 15:14 IST — TC-HD-03

### Page

| Field | Value |
|-------|--------|
| Status | **Cancelled** |
| Cancel charges | ₹1,000.00 |
| Total Refund | **₹7,729.72** |
| Conf No | NVL6EMF |

### Emails

| Channel | Result | Notes |
|---------|--------|-------|
| **User** | **PASS** | `[DEV] Travel VIP \| Your Hotel Booking Cancelled \| 179…7429` · 3:14 PM · ✓ Cancelled · charge −1000 · refund **7729.72** |
| **Admin** | **PASS** | Same Cancelled body (BCC) |
| **CS** | **PASS** | CSV2 → **Booking Cancelled** + **Booking Refunded** · refund INR 7729.72 · charge 1000 |

### Soft / content

| Item | Detail |
|------|--------|
| Paid Amount in Cancelled mail | Shows **INR 87,297.24** (full) but only advance ₹8,729.72 was paid; refund math = advance − 1000 ✓ |

### Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Hotel Booking Cancelled` / `1793266178907429` |
| Evidence | `notif-shade-cancelled-final.png` |

### Verdict (Cancelled)

| Delivery User + Admin + CS + Notif | **PASS** |
| Overall TC-HD-03 | **PASS delivery** · **1 content ISSUE** (room details) |

---

## ISSUE — HD-CANCEL-ROOM-NA (logged 2026-10-29)

| Field | Value |
|-------|--------|
| **ID** | HD-CANCEL-ROOM-NA |
| **BR** | **1793266178907429** |
| **Action** | Hotel Deals · **Cancelled** (dashboard) User/Admin mail |
| **Severity** | Content BUG |
| **Expected** | Room Details same as earlier mails on this BR |
| **Actual** | Room Details = `N/A` / Non Refundable / `N/A` / `N/A` |
| **Evidence (same BR)** | **Request Submitted** + **Cancellation Requested** both had: `deluxe junior suite-50 sqm-538 sqft-lake view- king bed-ac-free wifi-` · 1 Adult · Room Only · Virtuoso Rate |
| **Likely cause** | Cancelled `email_json` / template mapping does not copy room name, board, rate type on dashboard finalize |
| **Also soft** | Paid Amount shows full fare ₹87,297.24 vs advance paid ₹8,729.72 |

**Delivery still PASS** (User/Admin/CS/Notif sent). Flag for fix + retest Cancelled content.
