# ANS V2 — All services retest (Partner BFL)

**Started:** 2026-10-28  
**Partner:** BFL · Bajaj Finserve · `https://lambda-shop.travelvip.ai/`  
**Engine:** ANS V2 only (User + Admin BCC + CS + Notif where applicable)  
**Inboxes:** User `rohan@travelvip.ai` · Admin/CS `rohan@scandid.in`  
**Checks:** Page status · `[DEV]` · Bajaj theme · User · Admin (same body) · CS stages · key fields vs page · Notif when possible  

**Out of scope:** ENG-555 Nexus manual · Cabs (if UI missing) · Bag Assure (if unable to book)

---

## Progress

| | Count |
|--|------:|
| Done PASS emails | 13 action rows (+ Hotel Deals Confirmed) |
| Notif miss | 2 (ATT + FLT V2 on A015) |
| Notif PASS | 7 (+ Hotel Deals Confirmed) |
| Remaining TCs | ~11 action rows |
| FAIL | 0 |

Carry-forward evidence: [ANS-V2-BFL-EMAIL-DUMP-2026-10-28.md](./ANS-V2-BFL-EMAIL-DUMP-2026-10-28.md)

---

## Full matrix

| # | TC | Category | Action | User | Admin | CS | Notif | Evidence | Result |
|---|-----|----------|--------|------|-------|-----|-------|----------|--------|
| 1 | TC-DF-01 | Duty Free | Request Submitted | PASS | PASS | PASS | **PASS** | **TX1793264472515952** · also **TX1793266029536946** | **PASS** · 2nd book Arrival collect copy OK · evidence `notif-evidence/TX1793266029536946/` |
| 2 | TC-DF-02 | Duty Free | Confirmed | PASS | PASS | **EXPECT** | **PASS** | **TX1793266029536946** | **PASS (EXPECT)** · no CS confirm · User/Admin/Notif yes · `notif-evidence/TX1793266029536946/` |
| 3 | TC-DF-03 | Duty Free | Cancelled | PASS | PASS | PASS | **PASS** | **TX1793264472515952** | **PASS** · soft: “full refund initiated” vs refund INR 0 / non-refundable · `notif-evidence/TX1793264472515952/` |
| 4 | TC-POR-01 | Porter | Request Submitted | | | | | | PENDING |
| 5 | TC-POR-02 | Porter | Confirmed | | | | | | PENDING |
| 6 | TC-ATT-01 | Attraction | Confirmed | PASS* | PASS | PASS | **NOT RCVD** | **BR1793257997359738** | **PASS emails** · Notif miss · TravelVIP chrome · evidence `notif-evidence/BR1793257997359738/` |
| 7 | TC-FT-01 | Fast Track | Confirmed | | | | | | PENDING · P0 |
| 8 | TC-MG-01 | Meet & Greet | Request Submitted | | | | | | PENDING |
| 9 | TC-MG-02 | Meet & Greet | Confirmed | | | | | | PENDING |
| 10 | TC-ESIM-01 | eSIM | Confirmed | | | | | | PENDING |
| 11 | TC-FLT-OW | Flight | Confirmed OW | PASS | PASS | PASS | — | FB1793174919474118 | **PASS** |
| 12 | TC-FLT-RT | Flight | Confirmed RT | PASS | PASS | PASS | **PASS** | **FB1793260814281305** (also FB1793175453420082) | **PASS** · both PNRs in full mail · evidence `notif-evidence/FB1793260814281305/` |
| 12b | TC-FV2-01 | Flight V2 | Confirmed | PASS | PASS | PASS | **NOT RCVD** | **FB1793259782766802** | **PASS emails** · PNR Z9PYXX · DEL–BOM via IXB · ₹5316 · soft DEL–IXB only in mail · evidence `notif-evidence/FB1793259782766802/` |
| 13 | TC-FLT-02 | Flight | Cancellation Requested | | | | | | PENDING |
| 14 | TC-FLT-03 | Flight | Cancelled | | | | | | PENDING |
| 15 | TC-HTL-01 | Hotel | Confirmed | PASS | PASS | PASS | — | 1793180663401623 | **PASS** |
| 16 | TC-HTL-01b | Hotel | Confirmed (2R) | PASS | PASS | PASS | — | 1793181215750533 | **PASS** |
| 17 | TC-HTL-02 | Hotel | Cancelled | | | | | | PENDING |
| 18 | TC-HD-01 | Hotel Deals | Request Submitted | PASS | PASS | PASS | **PASS** | **1793267354550423** (also 179…7429) | **PASS** · St. Regis · 14V975LB · room OK · `notif-evidence/1793267354550423/` |
| 19 | TC-HD-02 | Hotel Deals | Confirmed | PASS | PASS | PASS | **PASS** | **1793267354550423** | **PASS** · dashboard · 14V975LB · room OK · soft CS phone `KZ` + times N/A · `notif-evidence/1793267354550423/` |
| 20 | TC-HD-03 | Hotel Deals | Cancelled | PASS | PASS | PASS | **PASS** | **1793266178907429** | **PASS delivery** · **ISSUE HD-CANCEL-ROOM-NA** room=`N/A` on Cancelled (OK on Submitted/CancelReq) · soft Paid=full · `notif-evidence/1793266178907429/` |
| 21 | TC-LG-P-01 | Lounge Pune (request) | Request Submitted | | | | | | PENDING |
| 22 | TC-LG-P-02 | Lounge Pune (request) | Confirmed | | | | | | PENDING · P1 |
| 23 | TC-LG-H-01 | Lounge HAK (online) | Confirmed | | | | | | PENDING · P0 |
| 24 | TC-CON-01 | Concierge | Request Submitted | | | | | | PENDING |
| 25 | TC-CAB-01 | Cabs | Confirmed / Cancel | | | | | | NOT TESTED if UI missing |
| 26 | TC-BAG-01 | Bag Assure | Request / Confirmed | | | | | | NOT TESTED if unable to book |

---

## Suggested booking order (you book → send URL)

1. **Attraction** Confirmed  
2. **Fast Track** Confirmed  
3. **Lounge HAK** Confirmed  
4. **eSIM** Confirmed  
5. **Porter** Submitted → Confirmed  
6. **Meet & Greet** Submitted → Confirmed  
7. **Duty Free** Submitted → Confirmed (EXPECT no CS) → Cancelled  
8. **Lounge Pune** Submitted → Confirmed  
9. **Hotel Deals** Submitted → Confirmed → Cancelled  
10. **Hotel** Cancelled (can use new book or cancel one of today’s if allowed)  
11. **Flight** Cancel Requested → Cancelled  
12. **Concierge** Submitted  
13. Cabs / Bag Assure only if bookable  

For each URL I will: open page → User → Admin → CS → Notif → update this matrix + BFL dump.

---

## Open content issues (delivery PASS)

| ID | BR | Service / action | Issue |
|----|-----|------------------|--------|
| **HD-CANCEL-ROOM-NA** | **1793266178907429** | Hotel Deals · Cancelled | Room Details in User/Admin Cancelled mail = `N/A` (full room present on Request Submitted + Cancellation Requested). Soft: Paid Amount = full fare vs advance. Evidence `notif-evidence/1793266178907429/` |

**Hotel Deals flow:** Submitted + Confirmed + Cancelled covered (open ISSUE: HD-CANCEL-ROOM-NA).

---

## Pass rule (every service)

| Channel | Pass |
|---------|------|
| User | Mail received · correct action subject · `[DEV]` · Bajaj · key ids/totals |
| Admin | Same Confirmed/action body (BCC) |
| CS | CSV2 stage for that action (except Duty Free Confirmed = no CS) |
| Notif | **Android device** push after PWA book (same logged-in user) |
| Content | Spot-check vs details page (+91, dates, room/pax where relevant) |

---

## Android notification check (PWA → device push)

**Status 2026-10-28 16:50 IST:** `adb` → **Nothing A015** (`00117648V003247` · Android 16) **device** — ready for Notif watch after PWA books.

**Setup**
1. Phone USB → PC · Developer options → **USB debugging** ON · Allow RSA prompt  
2. App / PWA install logged in as same user as lambda-shop (`rohan@travelvip.ai` / BFL tier)  
3. Notification permission allowed for the app  

**Watch**
```powershell
cd "d:\Travel VIP API Automation\travel-apis\reports\ans-v2-email-signoff\scripts"
powershell -File .\watch-android-notifications.ps1
```
Then book on PWA → confirm shade + logcat lines · mark Notif PASS/FAIL on the matrix.
