# ANS V2 check — 1793267354550423 (Hotel Deals · Request Submitted)

**Checked:** 2026-10-29 15:22 IST  
**Page:** https://lambda-shop.travelvip.ai/hotel-deals/booking-details/1793267354550423  
**Partner chrome:** Travel VIP  
**Device:** Nothing A015 · `ai.txv2.starter`

## Page

| Field | Value |
|-------|--------|
| Status | **Booking Submit Success** / Request Submitted |
| Hotel | The St. Regis Astana |
| Request ID | 1793267354550423 |
| Confirmation Number | **14V975LB** |
| Guest | Rohan Bhagat |
| Stay | 05–06 Nov 2026 · 1 night · **2 rooms** |
| Room | spacious 68 sq m deluxe… · Room Only · STARS Exclusive Rate |
| Advance | **₹4,722.24** |
| Total | ₹47,222.32 · Pending ₹42,500.08 |

## Emails

| Channel | Inbox | Result | Notes |
|---------|-------|--------|-------|
| **User** | `rohan@travelvip.ai` | **PASS** | Request Submitted · 3:19 PM · St. Regis · Rohan · advance 4722.24 · **room details present** (deluxe 68 sq m · Room Only · STARS) |
| **Admin** | `rohan@scandid.in` | **PASS** | Same Request Submitted body (BCC) · room OK |
| **CS** | CSV2 | **PASS** | Created → Pay Init → Pay OK → **Request Sent** · Conf No **14V975LB** on Request Submitted stage |

## Soft

| Item | Detail |
|------|--------|
| Conf No | Page + CS have **14V975LB**; User/Admin body does not show it (same as prior HD Submitted) |
| Guests line | Mail: `2 Room(s) , Rohan Bhagat + 2 Guest` but room block shows `1 Adult` |

## Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Hotel Booking Request Submitted` / `1793267354550423` |
| Evidence | `notif-shade.png` |

## Verdict (Request Submitted)

| Emails + Notif | **PASS** |
| Overall TC-HD-01 | **PASS** |

---

## Confirmed (dashboard) · 2026-10-29 15:23 IST — TC-HD-02

### Page

| Field | Value |
|-------|--------|
| Status | **Confirmed** |
| Conf No | **14V975LB** |
| Totals | Advance ₹4,722.24 · Pending paid ₹42,500.08 · Total paid ₹47,222.32 |

### Emails

| Channel | Result | Notes |
|---------|--------|-------|
| **User** | **PASS** | `[DEV] Travel VIP \| Your Hotel Booking Confirmed \| 179…0423` · 3:23 PM · **14V975LB** · room details OK · Total Paid 47222.32 |
| **Admin** | **PASS** | Same Confirmed body (BCC) · room OK |
| **CS** | **PASS** | CSV2 → **Booking Confirmed** · Conf No 14V975LB |

### Soft (C6-style content)

| Item | Detail |
|------|--------|
| CS phone on Confirmed | Shows **`KZ 7410015224`** (Created stage had **+91 7410015224**) |
| CS check-in/out times | Confirmed stage: `2026-11-05 N/A` / `2026-11-06 N/A` |
| Check-in times on User mail | Dates only (no clock times) — page also date-only |

### Notification

| Check | Result |
|-------|--------|
| Push | **PASS** — `Hotel Booking Confirmed` / `1793267354550423` |
| Evidence | `notif-shade-confirmed.png` |

### Verdict (Confirmed)

| Emails + Notif | **PASS** |
| Overall TC-HD-02 | **PASS** (soft CS phone KZ / times N/A) |
