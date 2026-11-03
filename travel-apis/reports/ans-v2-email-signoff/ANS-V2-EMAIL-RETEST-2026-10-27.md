# ANS V2 Email Retest — 2026-10-27 (lambda-shop)

**Trigger:** Backend update APIs re-pointed **delta → lambda**; Shailesh: flight working as expected after point. Full category email retest requested.  
**Shop:** `https://lambda-shop.travelvip.ai/`  
**Inboxes:**  
- **User:** `rohan@travelvip.ai`  
- **Admin / CS:** `rohan@scandid.in` (CS also `devcs@travelvip.ai`)  

**Mattermost context (ANS V2, today):**  
- BFL had `smt` partner / `booking_ticketed` / null `email_json` issues  
- Prerna: update APIs must point to **lambda-api**  
- Shailesh 19:03 IST: *“Working now — was pointed to delta, now pointed to lambda — working as expected for flight”*

---

## Session status

| Step | Status |
|------|--------|
| Gmail TravelVIP | **OK** — logged in |
| Gmail Scandid | **OK** — logged in |
| Partner | **BFL** (Bajaj Finserve chrome on lambda-shop) |
| Consolidated dump | [ANS-V2-BFL-EMAIL-DUMP-2026-10-28.md](./ANS-V2-BFL-EMAIL-DUMP-2026-10-28.md) |
| **All-services retest** | [ANS-V2-ALL-SERVICES-RETEST-BFL.md](./ANS-V2-ALL-SERVICES-RETEST-BFL.md) — full V2 matrix on BFL |
| Bookings checked | **8** — Duty Free **TX…5952** Submitted + **Cancelled** (emails + Notif **PASS**) |

---


## Result — FB1793174919474118 (2026-10-28)

**Page:** https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793174919474118;bookingReferenceId=FB1793174919474118  

| Field | Page |
|-------|------|
| Status | Booking Confirmation Successful |
| Booking Id | FB1793174919474118 |
| PNR | 7D9PBV |
| Route | Mumbai → Bengaluru · AIR INDIA AI-2863 · 10:05–11:45 |
| Pax | MR. ATUL BHAGAT (28) · MSTR. RAM GAIKWAD (1) |
| Baggage | Cabin 7 Kg · Check-in 15 Kg |
| Total | ₹21,220.24 |
| Ticket shared to | `rohan@travelvip.ai` · 7219784663 |
| Partner chrome | Bajaj Finance / Bajaj Finserve |

| Channel | Inbox | Mail found | Verdict |
|---------|-------|------------|---------|
| **User** | `rohan@travelvip.ai` | `[DEV] Bajaj Finserve \| Your Flight Booking Confirmed \| FB1793174919474118` · PNR 7D9PBV · BOM–BLR · 1:39 PM | **PASS** |
| **Admin** | `rohan@scandid.in` | Same Confirmed subject/PNR · 1:39 PM | **PASS** |
| **CS** | `rohan@scandid.in` / CSV2 | `[DEV] CSV2 Bajaj Finserve \| Your Flight Booking \| FB…` · stages Payment Init→OK→Submitted→**Ticketed** · Mobile **+91** 7219784663 · Total INR 21220.24 | **PASS** |

**Content notes (non-blockers):**  
- CS stage label text says “Booking Created” while checklist shows Ticketed — expected CSV2 pattern for confirm.  
- CS passenger name shows Atul Bhagat only (page has 2 pax).  
- Base fare page ₹17,355.20 vs CS INR 17355.24 (1‑paisa rounding).  

**Overall: PASS** for User + Admin + CS on this Confirmed Flight booking.

---

## Result — FB1793175453420082 (2026-10-28)

**Page:** https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793175453420082;bookingReferenceId=FB1793175453420082  

| Field | Page |
|-------|------|
| Status | Booking Confirmation Successful |
| Booking Id | FB1793175453420082 |
| Trip | **RT** BOM→BLR (IX-1549 · PNR **N9DJ7E**) + BLR→NMI (IX-2914 · PNR **N4INNG**) |
| Pax | MR. SHAILENDRA BHAGAT · MSTR. SHANTANU GAIKWAD |
| Total | ₹12,476.01 |
| Shared to | `rohan@travelvip.ai` · 7219784663 |

| Channel | Mail | Verdict |
|---------|------|---------|
| **User** | Confirmed · FB… · PNR **N9DJ7E** · BOM–BLR · 1:48 PM | **PASS** (delivery) |
| **Admin** | Same Confirmed · 1:48 PM | **PASS** (delivery) |
| **CS** | CSV2 Ticketed · Mobile **+91** · Total **12476.01** · IX-1549 BOM–BLR | **PASS** (delivery) |

**Content notes:** User/Admin/CS previews & CS body show **outbound only** (BOM–BLR / N9DJ7E). Page has **return** BLR–NMI / N4INNG — return sector not visible in CS journey block. CS passenger = Shailendra only (page has 2).  

**Overall: PASS** (emails received + totals/phone OK). Soft gap: RT return leg not in CS journey summary.

---

## Result — 1793180663401623 Hotel (2026-10-28)

**Page:** https://lambda-shop.travelvip.ai/hotel/booking-details/1793180663401623  

| Field | Page |
|-------|------|
| Status | Confirmed |
| Booking ID | 1793180663401623 |
| Confirmation No | **SNHAPI00011598** |
| Hotel | Pride Premier Pune · Deluxe Twin Room · 1N |
| Check-in / out | 29 Oct 2026 → 30 Oct 2026 |
| Guest | Rohan Bhagat · `rohan@travelvip.ai` · +917219784663 |
| Total | ₹7,523.84 |

| Channel | Mail | Verdict |
|---------|------|---------|
| **User** | `[DEV] Bajaj Finserve \| Your Hotel Booking Confirmed \| 1793180663401623` · Conf No **SNHAPI00011598** · 3:14 PM | **PASS** |
| **Admin** | Same Confirmed · Pride Premier Pune · SNHAPI00011598 · 3:14 PM | **PASS** |
| **CS** | CSV2 · stages → Confirmed · Mobile **+91** · Total **7523.84** · Pride Premier Pune · 3:15 PM | **PASS** |

**Soft note:** CS body opened in thread showed Stage “Booking Created” / Confirmation No. **N/A** while list snippet says CONFIRMED and page/User/Admin have **SNHAPI00011598** (thread may mix create + confirm). Totals/phone/hotel match.

**Overall: PASS** for User + Admin + CS delivery.

---

## Retest matrix (BFL)

| TC | Category | Action | User | Admin | CS | Notif | BR/SR/TX | Result | Notes |
|----|----------|--------|------|-------|-----|-------|----------|--------|-------|
| TC-DF-01 | Duty Free | Submitted | PASS | PASS | PASS | **PASS** | **TX1793266029536946** (also TX…5952) | **PASS** | 2nd: Arrival collect OK · Ciroc ₹9584 |
| TC-DF-02 | Duty Free | Confirmed | PASS | PASS | **EXPECT** | **PASS** | **TX1793266029536946** | **PASS (EXPECT)** | No CS confirm; User/Admin/Notif yes |
| TC-DF-03 | Duty Free | Cancelled | PASS | PASS | PASS | **PASS** | **TX1793264472515952** | **PASS** | Soft: full-refund copy vs INR 0 |
| TC-POR-01 | Porter | Submitted | | | | | | PENDING | |
| TC-POR-02 | Porter | Confirmed | | | | | | PENDING | |
| TC-ATT-01 | Attraction | Confirmed | PASS* | PASS | PASS | **NOT RCVD** | **BR1793257997359738** | **PASS emails** | TravelVIP · Notif miss |
| TC-FT-01 | Fast Track | Confirmed | | | | | | PENDING | |
| TC-MG-01 | Meet & Greet | Submitted | | | | | | PENDING | |
| TC-MG-02 | Meet & Greet | Confirmed | | | | | | PENDING | |
| TC-ESIM-01 | eSIM | Confirmed | | | | | | PENDING | |
| TC-FV1-01 | Flight | Confirmed (OW) | PASS | PASS | PASS | — | **FB1793174919474118** | **PASS** | PNR 7D9PBV · +91 · ₹21220.24 |
| TC-FV1-01b | Flight | Confirmed (RT) | PASS | PASS | PASS | **PASS** | **FB1793260814281305** | **PASS** | Full mail has both legs/PNRs; Notif PASS `ai.txv2.starter` |
| TC-FV1-02 | Flight | Cancel Requested | | | | | | PENDING | |
| TC-FV1-03 | Flight | Cancelled | | | | | | PENDING | |
| TC-FV2-01 | Flight V2 | Confirmed | PASS | PASS | PASS | **NOT RCVD** | **FB1793259782766802** | **PASS emails** | PNR Z9PYXX · soft DEL–IXB only · Notif miss |
| TC-HTL-01 | Hotel | Confirmed | PASS | PASS | PASS | — | **1793180663401623** | **PASS** | SNHAPI00011598 · soft CS Conf No N/A in thread |
| TC-HTL-01b | Hotel | Confirmed | PASS | PASS | PASS | — | **1793181215750533** | **PASS** | SNHAPI00011600 · Sheraton · ₹48279.18 · soft CS Conf No N/A on create stage |
| TC-HTL-02 | Hotel | Cancelled | | | | | | PENDING | |
| TC-HD-01 | Hotel Deals | Submitted | PASS | PASS | PASS | **PASS** | **1793267354550423** (also 179…7429) | **PASS** | St. Regis · room OK · soft Conf No User/Admin |
| TC-HD-02 | Hotel Deals | Confirmed | PASS | PASS | PASS | **PASS** | **1793267354550423** | **PASS** | Soft: CS Mobile KZ + check times N/A |
| TC-HD-03 | Hotel Deals | Cancelled | PASS | PASS | PASS | **PASS** | **1793266178907429** | **PASS delivery** | **ISSUE HD-CANCEL-ROOM-NA** · soft Paid=full fare |
| TC-LG-P-01 | Lounge Pune | Submitted | | | | | | PENDING | |
| TC-LG-P-02 | Lounge Pune | Confirmed | | | | | | PENDING | |
| TC-LG-H-01 | Lounge HAK | Confirmed | | | | | | PENDING | |
| TC-CON-01 | Concierge | Submitted | | | | | | PENDING | |

**Done so far:** 4 bookings · 4 PASS · dump → [ANS-V2-BFL-EMAIL-DUMP-2026-10-28.md](./ANS-V2-BFL-EMAIL-DUMP-2026-10-28.md)

**Out of scope this run:** ENG-555 Nexus manual CS · Cabs (if UI missing) · Bag Assure

