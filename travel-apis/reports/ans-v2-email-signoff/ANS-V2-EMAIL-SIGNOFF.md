# ANS V2 Email Testing — Sign-off pack (Dev / TravelVIP)

**Prepared for:** Preprod / Prod move sign-off  
**QA:** Rohan Bhagat  
**Product:** Travel VIP · ANS V2 emails (User + Admin + CS) + app notifications  
**Env tested:** Dev — `https://lambda-shop.travelvip.ai/` · Nexus `https://gamma-nexus.travelvip.ai/`  
**Inboxes checked:** TravelVIP Gmail · Scandid Gmail · mobile `7219784663` (where applicable)  
**Sheet (source of truth):** [ANS V2 Testing — 30/09/2026](https://docs.google.com/spreadsheets/d/1kU96tGaT8zPUS24PjsUWOO37E2SLpB4cBVjdVupq3XY/edit?gid=1737154204#gid=1737154204)  
**Channel:** Mattermost `ANS V2`  
**Hub / related:** ENG-294 · ENG-555 (out of scope — see §5)

---

## 1. Sign-off verdict

| Item | Result |
|------|--------|
| **Dev ANS V2 email matrix (TravelVIP)** | **PASS — signed off 2026-10-22** |
| Mattermost sign-off | *“I have tested the ANS V2 emails with TravelVIP across all categories and the specified user actions. Everything is working as expected on Dev, so you can proceed with the next steps for Preprod and Prod.”* — Rohan, 22 Oct 2026 |
| Scope of sign-off | Normal booking / status emails: **User · Admin · CS · Notification** per category & action in the sheet |
| **Out of scope** | Nexus **manual** dashboard Inprogress→Confirmed/Failed CS emails → **[ENG-555](https://tracker.travelvip.ai/tasks/ENG-555)** (Todo) — do **not** block this ANS V2 sign-off |
| Preprod / Prod | **Not re-run here** — proceed with config parity note (§4) |

---

## 2. What was tested (coverage)

For each applicable row we verified:

| Check | Meaning |
|-------|---------|
| **ANS V2** | New ANS V2 email path used |
| **User Email** | Customer / user inbox received expected mail |
| **Admin Email** | Admin inbox received expected mail |
| **CS Email** | Customer Success / Scandid CS inbox received expected mail |
| **Notification** | In-app / related notification as applicable |
| **Content** | Key fields vs booking page (where bugs were raised) |

**Categories covered**

| # | Category | Actions covered |
|---|----------|-----------------|
| 1 | Duty Free | Request Submitted · Confirmed · Cancelled |
| 2 | Porter | Request Submitted · Confirmed |
| 3 | Attraction | Booking Confirmed |
| 4 | Fast Track | Booking Confirmed |
| 5 | Meet & Greet | Request Submitted · Confirmed |
| 6 | eSIM | Booking Confirmed |
| 7 | Flight V1 | Booking Confirmed · Cancellation Requested · Cancelled |
| 8 | Flight V2 | Booking Confirmed |
| 9 | Hotel | Booking Confirmed · Cancelled |
| 10 | Hotel Deals | Request Submitted · Confirmed · Cancelled |
| 11 | Lounge — Pune (request-based) | Request Submitted · Confirmed |
| 12 | Lounge — HAK (online) | Confirmed |
| 13 | Trip Emergency Concierge | Booking Request Submitted |

**Not in Dev matrix / blocked**

| Category | Reason |
|----------|--------|
| Cabs | UI not deployed on Dev at test time |
| Bag Assure | Unable to book on Dev |

---

## 3. Results matrix (final QA status)

Legend: **PASS** = Done / working on final retest · **N/A** = not applicable or blocked · **EXPECT** = documented as expected behaviour

### 3.1 Final PASS (including fixed then retested)

| Category | Action | User | Admin | CS | Notif | Final QA | Retest / evidence |
|----------|--------|------|-------|-----|-------|----------|-------------------|
| Duty Free | Request Submitted | Yes | Yes | Yes | Yes | **PASS** | TX1790773064145716 |
| Duty Free | Cancelled | Yes | Yes | Yes | Yes | **PASS** | TX1790773064145716 |
| Porter | Request Submitted | Yes | Yes | Yes | Yes | **PASS** | SR1790774781323946 |
| Porter | Confirmed | Yes | Yes | Yes | Yes | **PASS** | SR1790774781323946 |
| Attraction | Booking Confirmed | Yes* | Yes* | Yes* | Yes* | **PASS** (after fix) | **BR1791890800383086** |
| Fast Track | Booking Confirmed | Yes* | Yes* | Yes* | Yes* | **PASS** (after fix) | **BR1791800740387332** |
| Meet & Greet | Request Submitted | Yes | Yes | Yes | Yes | **PASS** | SR1790763853260580 |
| Meet & Greet | Confirmed | Yes | Yes | Yes | Yes | **PASS**** | SR1790763853260580 |
| eSIM | Booking Confirmed | Yes | Yes | Yes | Yes | **PASS** | BR1790754147709756 |
| Flight V1 | Booking Confirmed | Yes | Yes | Yes | Yes | **PASS** | FB1790760941942394 |
| Flight V1 | Cancellation Requested | Yes | Yes | Yes | Yes | **PASS** | FB1790760941942394 |
| Flight V2 | Booking Confirmed | Yes* | Yes* | Yes | Yes* | **PASS** (after fix) | BR1790760106270492 → fixed `email_json` |
| Hotel | Booking Confirmed | Yes | Yes | Yes | Yes | **PASS** | 1790751643994741 |
| Hotel | Cancelled | Yes | Yes | Yes | Yes | **PASS** | 1790751643994741 |
| Hotel Deals | Request Submitted | Yes | Yes | Yes | Yes | **PASS** | 1790768390986193 |
| Hotel Deals | Confirmed | Yes | Yes | Yes | Yes | **PASS** (after fix) | **1791791597528121** |
| Hotel Deals | Cancelled | — | — | — | — | **PASS / closed**† | 1791791597528121 |
| Lounge Pune (request) | Request Submitted | Yes | Yes | Yes | Yes | **PASS** | BR1790766284498181 |
| Lounge Pune (request) | Confirmed | Yes | Yes | Yes | Yes | **PASS** (after fix) | **BR1791789547816145** |
| Lounge HAK (online) | Confirmed | Yes* | Yes* | Yes | Yes* | **PASS** (after fix) | **BR1791790717109602** |
| Trip Emergency Concierge | Request Submitted | Yes | Yes | —‡ | Yes | **PASS / closed** | SR1790770070619550 |

\* First run failed (missing user/admin and/or CS confirm / null `email_json`); **retest after Dev fix = PASS**.  
\*\* Airport name wording raised once; not listed as open blocker in final 22 Oct sign-off.  
† Cancel-from-dashboard-after-confirm called **not a valid issue** for this matrix; sheet marked Done.  
‡ CS naming / “Not Required” per Dev on sheet; closed Done for Dev sign-off.

### 3.2 Documented exception (not a Dev bug)

| Category | Action | Note | Final |
|----------|--------|------|-------|
| Duty Free | Confirmed | CS confirmation email **not** sent — Dev: **As Expected** | **EXPECT** — leave |

### 3.3 First-run bugs → fixed → retest PASS (detail)

| Issue (30 Sep) | Root cause / fix | Retest evidence | Final |
|----------------|------------------|-----------------|-------|
| Attraction — no user/admin; CS only till Submitted | Backend missing update API → `email_json` null → Fixed | BR1791890800383086 | **PASS** |
| Fast Track — same | Same `email_json` null → Fixed | BR1791800740387332 | **PASS** |
| Flight V2 — no user/admin | `email_json` null on V2 confirm → Added / deployed lambda-shop | Sheet Done | **PASS** |
| Lounge HAK — no user/admin | `email_json` null on confirm → Fixed | BR1791790717109602 | **PASS** |
| Lounge Pune confirm — Dragon Pass on QR / channel | `booking.channel` should be `request` → deployed gamma-nexus | BR1791789547816145 | **PASS** |
| Hotel Deals Confirmed — policy / phone IT / times | Nexus + Prerna fixes | 1791791597528121 | **PASS** |
| Hotel Deals Cancelled — charge/refund 0 in mail | Closed as invalid cancel path from dashboard after confirm; later Nexus cancel `email_json` order fixed (12 Oct Shailesh) | Done on sheet | **PASS / closed** |
| Flight V1 Cancelled — refund 0 / baggage N/A | Deployed on gamma-nexus; V2 cancel path confirmed working | Sheet updated | Covered under 22 Oct all-categories PASS |

---

## 4. Preprod / Prod handoff note (from Dev sign-off)

When promoting beyond Dev, verify parity of:

- Partner / TravelVIP configurations  
- DB schema · column names · property names  
- Mattermost alert wiring  
- ANS / email template & `email_json` / `user_actions` behaviour  

Testing sign-off above is **TravelVIP on Dev only**.

---

## 5. Explicitly out of scope (do not mix into this sign-off)

| Item | Tracker | Status |
|------|---------|--------|
| CS emails after **Nexus manual** Inprogress → Confirmed / Failed (and related cancel settle/reject) | [ENG-555](https://tracker.travelvip.ai/tasks/ENG-555) | Todo — Mattermost alerts PASS; CS email missing |
| Cabs email | — | UI not on Dev |
| Bag Assure email | — | Unable to book on Dev |

---

## 6. Timeline

| Date | Event |
|------|--------|
| 2026-09-30 | First full matrix — issues logged on sheet + Mattermost ANS V2 |
| 2026-10-01 → 12 | Fixes (`email_json`, Lounge channel, Hotel Deals, Flight V2, etc.) + sheet column **QA Status- 12/10/2026** |
| 2026-10-22 | **Dev sign-off** — all categories / specified actions working on TravelVIP Dev |
| 2026-10-22 | ENG-555 raised separately for Nexus **manual** CS emails (out of scope) |

---

## 7. Sign-off statement (copy-paste)

**ANS V2 email testing (User / Admin / CS / Notifications) on Travel VIP Dev is complete and PASS for all categories and actions covered in the ANS V2 Testing — 30/09/2026 sheet, including retests after fixes (Attraction, Fast Track, Flight V2, Lounge HAK/Pune, Hotel Deals, etc.).**  

**Signed off in Mattermost ANS V2 on 2026-10-22 for Preprod/Prod progression, subject to config parity.**  

**Excluded:** ENG-555 (Nexus manual dashboard CS emails), Cabs (UI not deployed), Bag Assure (unable to book on Dev). Duty Free Confirmed CS absence documented as expected.

---

## 8. Test cases (executed)

**Common precondition (all TCs unless noted):**  
- Dev TravelVIP shop: `https://lambda-shop.travelvip.ai/`  
- Partner / user logged in as TravelVIP test user  
- Inboxes open: **User** (TravelVIP Gmail) · **Admin** (admin inbox) · **CS** (Scandid / CS Gmail)  
- App notifications checked where product supports them  
- After status change, wait for mail delivery then verify subject/body vs booking details page  

**Common steps template:**  
1. Create / open booking for the category on lambda-shop.  
2. Drive status to the action under test (Submitted / Confirmed / Cancelled / Cancellation Requested) via product flow or Nexus as applicable for that product.  
3. Confirm booking detail page shows the expected status.  
4. Check User, Admin, CS inboxes + notification.  
5. Spot-check key fields (BR/SR/TX id, amounts, dates, phone, airport/hotel name) against the page.  

**Common expected (PASS row):** ANS V2 path used; User + Admin + CS + Notification received as marked **Yes** on sheet; content matches booking page (no null `email_json` for confirm where confirm mail is required).

---

### 8.1 Test case index

| TC ID | Category | Action | Result | Evidence |
|-------|----------|--------|--------|----------|
| TC-DF-01 | Duty Free | Request Submitted | **PASS** | TX1790773064145716 |
| TC-DF-02 | Duty Free | Confirmed | **PASS (EXPECT)** | TX1790773064145716 — CS confirm not sent (As Expected) |
| TC-DF-03 | Duty Free | Cancelled | **PASS** | TX1790773064145716 |
| TC-POR-01 | Porter | Request Submitted | **PASS** | SR1790774781323946 |
| TC-POR-02 | Porter | Confirmed | **PASS** | SR1790774781323946 |
| TC-ATT-01 | Attraction | Booking Confirmed | **PASS** (retest) | BR1791890800383086 |
| TC-FT-01 | Fast Track | Booking Confirmed | **PASS** (retest) | BR1791800740387332 |
| TC-MG-01 | Meet & Greet | Request Submitted | **PASS** | SR1790763853260580 |
| TC-MG-02 | Meet & Greet | Confirmed | **PASS** | SR1790763853260580 |
| TC-ESIM-01 | eSIM | Booking Confirmed | **PASS** | BR1790754147709756 |
| TC-FV1-01 | Flight V1 | Booking Confirmed | **PASS** | FB1790760941942394 |
| TC-FV1-02 | Flight V1 | Cancellation Requested | **PASS** | FB1790760941942394 |
| TC-FV1-03 | Flight V1 | Cancelled | **PASS** (final sign-off) | FB1790760941942394 |
| TC-FV2-01 | Flight V2 | Booking Confirmed | **PASS** (retest) | BR1790760106270492 |
| TC-HTL-01 | Hotel | Booking Confirmed | **PASS** | 1790751643994741 |
| TC-HTL-02 | Hotel | Cancelled | **PASS** | 1790751643994741 |
| TC-HD-01 | Hotel Deals | Request Submitted | **PASS** | 1790768390986193 |
| TC-HD-02 | Hotel Deals | Confirmed | **PASS** (retest) | 1791791597528121 |
| TC-HD-03 | Hotel Deals | Cancelled | **PASS / closed** | 1791791597528121 |
| TC-LG-P-01 | Lounge Pune (request) | Request Submitted | **PASS** | BR1790766284498181 |
| TC-LG-P-02 | Lounge Pune (request) | Confirmed | **PASS** (retest) | BR1791789547816145 |
| TC-LG-H-01 | Lounge HAK (online) | Confirmed | **PASS** (retest) | BR1791790717109602 |
| TC-CON-01 | Trip Emergency Concierge | Request Submitted | **PASS / closed** | SR1790770070619550 |
| TC-CAB-01 | Cabs | Confirmed / Cancelled | **NOT TESTED** | UI not deployed on Dev |
| TC-BAG-01 | Bag Assure | Request / Confirmed | **NOT TESTED** | Unable to book on Dev |

**Count:** 23 executed · 21 PASS · 1 PASS(EXPECT) · 1 PASS/closed (invalid path) · 2 NOT TESTED

---

### 8.2 Detailed test cases

#### Duty Free

| Field | TC-DF-01 |
|-------|----------|
| **Title** | Duty Free — Request Submitted emails |
| **Priority** | High |
| **Steps** | Place Duty Free order → status Request Submitted → check User/Admin/CS/Notification |
| **Expected** | All four channels Yes; ANS V2 |
| **Actual** | Received on all channels |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/dutyfreeV2/order/TX1790773064145716 |

| Field | TC-DF-02 |
|-------|----------|
| **Title** | Duty Free — Confirmed emails |
| **Priority** | High |
| **Steps** | Confirm Duty Free order → check User/Admin/CS/Notification |
| **Expected** | User/Admin/Notification Yes; CS confirm per product rule |
| **Actual** | User/Admin/Notification Yes; **CS confirmation not received** — Dev confirmed **As Expected** |
| **Status** | **PASS (EXPECT)** |
| **Evidence** | TX1790773064145716 |

| Field | TC-DF-03 |
|-------|----------|
| **Title** | Duty Free — Cancelled emails |
| **Priority** | High |
| **Steps** | Cancel Duty Free order → check User/Admin/CS/Notification |
| **Expected** | All four Yes |
| **Actual** | Received on all channels |
| **Status** | **PASS** |
| **Evidence** | TX1790773064145716 |

#### Porter

| Field | TC-POR-01 |
|-------|----------|
| **Title** | Porter — Request Submitted emails |
| **Steps** | Submit Porter request → check all inboxes + notification |
| **Expected** | User/Admin/CS/Notification Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/service/booking-details/SR1790774781323946 |

| Field | TC-POR-02 |
|-------|----------|
| **Title** | Porter — Confirmed emails |
| **Steps** | Confirm Porter booking → check all inboxes + notification |
| **Expected** | User/Admin/CS/Notification Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | SR1790774781323946 |

#### Attraction

| Field | TC-ATT-01 |
|-------|----------|
| **Title** | Attraction — Booking Confirmed emails (User/Admin/CS) |
| **Priority** | Critical |
| **Steps** | Confirm Attraction booking → verify User, Admin, CS confirm (not only Submitted) + notification; `email_json` present |
| **Expected** | User Yes · Admin Yes · CS confirm Yes · Notification Yes |
| **Actual (1st run)** | FAIL — no user/admin; CS only till Submitted (`email_json` null) |
| **Actual (retest)** | All channels received after backend update-API fix |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/tours-and-experiences/v2/confirmation/BR1791890800383086 |

#### Fast Track

| Field | TC-FT-01 |
|-------|----------|
| **Title** | Fast Track — Booking Confirmed emails |
| **Priority** | Critical |
| **Steps** | Confirm Fast Track → User/Admin/CS confirm + notification |
| **Expected** | All Yes on confirm (not only Submitted) |
| **Actual (1st run)** | FAIL — same null `email_json` pattern |
| **Actual (retest)** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/fasttrack/booking-confirmation/BR1791800740387332 |

#### Meet & Greet

| Field | TC-MG-01 |
|-------|----------|
| **Title** | Meet & Greet — Request Submitted emails |
| **Steps** | Submit M&G request → check all channels |
| **Expected** | User/Admin/CS/Notification Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/service/booking-details/SR1790763853260580 |

| Field | TC-MG-02 |
|-------|----------|
| **Title** | Meet & Greet — Confirmed emails + airport name |
| **Steps** | Confirm M&G → check emails; compare airport name to booking page |
| **Expected** | All channels Yes; airport name consistent with page |
| **Actual** | Emails received; airport wording raised once (Pune International vs Pune Airport) — not open on final 22 Oct sign-off |
| **Status** | **PASS** |
| **Evidence** | SR1790763853260580 |

#### eSIM

| Field | TC-ESIM-01 |
|-------|----------|
| **Title** | eSIM — Booking Confirmed emails |
| **Steps** | Confirm eSIM booking → check User/Admin/CS/Notification |
| **Expected** | All Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/esim/booking-detail/BR1790754147709756 |

#### Flight V1

| Field | TC-FV1-01 |
|-------|----------|
| **Title** | Flight V1 — Booking Confirmed emails |
| **Steps** | Confirm V1 flight → check all channels |
| **Expected** | User/Admin/CS/Notification Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1790760941942394 |

| Field | TC-FV1-02 |
|-------|----------|
| **Title** | Flight V1 — Cancellation Requested emails |
| **Steps** | Request cancel on V1 → check all channels |
| **Expected** | User/Admin/CS/Notification Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | FB1790760941942394 |

| Field | TC-FV1-03 |
|-------|----------|
| **Title** | Flight V1 — Cancelled emails (refund / baggage content) |
| **Steps** | Complete cancel → check User/Admin/CS; refund + baggage vs page |
| **Expected** | Emails received; refund/baggage align with page (or N/A defaults) |
| **Actual (1st run)** | Refund INR 0 vs page; baggage N/A; CS missing refund — fixed/deployed |
| **Actual (final)** | Covered under 22 Oct all-categories Dev PASS |
| **Status** | **PASS** |
| **Evidence** | FB1790760941942394 · gamma-nexus deploy notes |

#### Flight V2

| Field | TC-FV2-01 |
|-------|----------|
| **Title** | Flight V2 — Booking Confirmed User/Admin emails |
| **Priority** | Critical |
| **Steps** | Book via `/flights/search` V2 → Confirm → User/Admin/CS/Notification; `email_json` on user_action |
| **Expected** | User Yes · Admin Yes · CS Yes |
| **Actual (1st run)** | FAIL — no user/admin (`email_json` null) |
| **Actual (retest)** | Fixed on lambda-shop; sheet Done; final sign-off PASS |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/flights/booking-confirmation/BR1790760106270492 |

#### Hotel

| Field | TC-HTL-01 |
|-------|----------|
| **Title** | Hotel — Booking Confirmed emails |
| **Steps** | Confirm hotel → check all channels |
| **Expected** | All Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/hotel/booking-details/1790751643994741 |

| Field | TC-HTL-02 |
|-------|----------|
| **Title** | Hotel — Cancelled emails |
| **Steps** | Cancel hotel → check all channels |
| **Expected** | All Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | 1790751643994741 |

#### Hotel Deals

| Field | TC-HD-01 |
|-------|----------|
| **Title** | Hotel Deals — Request Submitted emails |
| **Steps** | Submit Hotel Deals request → check all channels |
| **Expected** | All Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/hotel-deals/booking-details/1790768390986193 |

| Field | TC-HD-02 |
|-------|----------|
| **Title** | Hotel Deals — Confirmed emails (policy / phone / check-in) |
| **Priority** | Critical |
| **Steps** | Confirm Hotel Deals → User/Admin/CS; verify cancel policy, phone country code (+91 not IT), check-in/out times |
| **Expected** | All emails Yes; phone +91; times not wrongly N/A; policy consistent |
| **Actual (1st run)** | FAIL — free-cancel vs non-refundable; phone IT; times N/A |
| **Actual (retest)** | Fixed (Nexus/Prerna); Done |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/hotel-deals/booking-details/1791791597528121 |

| Field | TC-HD-03 |
|-------|----------|
| **Title** | Hotel Deals — Cancelled emails (charge/refund) |
| **Steps** | Cancel confirmed Hotel Deals → charge/refund in User/Admin/CS vs page |
| **Expected** | Per product rules for valid cancel path |
| **Actual** | First-run content mismatch; closed as **invalid** to cancel from dashboard after confirm for this matrix; sheet Done |
| **Status** | **PASS / closed** |
| **Evidence** | 1791791597528121 |

#### Lounge

| Field | TC-LG-P-01 |
|-------|----------|
| **Title** | Lounge Pune (request-based) — Request Submitted emails |
| **Steps** | Submit request lounge → check all channels |
| **Expected** | All Yes |
| **Actual** | All received |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/lounge/booking-confirmation/BR1790766284498181 |

| Field | TC-LG-P-02 |
|-------|----------|
| **Title** | Lounge Pune (request-based) — Confirmed emails (channel / QR vendor) |
| **Priority** | High |
| **Steps** | Confirm after QR upload → emails; `booking.channel=request`; no wrong Dragon Pass on request-based QR |
| **Expected** | All Yes; channel request; vendor branding correct |
| **Actual (1st run)** | FAIL — Dragon Pass on QR / channel online |
| **Actual (retest)** | Fixed on gamma-nexus; Done |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/lounge/booking-confirmation/BR1791789547816145 |

| Field | TC-LG-H-01 |
|-------|----------|
| **Title** | Lounge HAK (online) — Confirmed User/Admin emails |
| **Priority** | Critical |
| **Steps** | Confirm online lounge → User/Admin/CS/Notification |
| **Expected** | User Yes · Admin Yes · CS Yes |
| **Actual (1st run)** | FAIL — no user/admin (`email_json` null) |
| **Actual (retest)** | Fixed; Done |
| **Status** | **PASS** |
| **Evidence** | https://lambda-shop.travelvip.ai/lounge/booking-confirmation/BR1791790717109602 |

#### Concierge

| Field | TC-CON-01 |
|-------|----------|
| **Title** | Trip Emergency Concierge — Request Submitted emails |
| **Steps** | Submit concierge request → User/Admin/CS/Notification; product name in mail |
| **Expected** | Per sheet (CS may be N/A / Not Required) |
| **Actual** | User/Admin Yes; CS marked Not Required / closed Done on sheet |
| **Status** | **PASS / closed** |
| **Evidence** | https://lambda-shop.travelvip.ai/service/booking-details/SR1790770070619550 |

#### Blocked / not executed

| Field | TC-CAB-01 |
|-------|----------|
| **Title** | Cabs — Confirmed / Cancelled emails |
| **Status** | **NOT TESTED** |
| **Reason** | UI not deployed on Dev at test time |

| Field | TC-BAG-01 |
|-------|----------|
| **Title** | Bag Assure — Request / Confirmed emails |
| **Status** | **NOT TESTED** |
| **Reason** | Unable to book on Dev |

---

### 8.3 Out-of-scope (not part of ANS V2 Dev sign-off TCs)

| TC ID | Title | Status | Tracker |
|-------|-------|--------|---------|
| TC-NX-01 | Nexus manual Inprogress → Confirmed / Failed → CS email | **FAIL / open** | [ENG-555](https://tracker.travelvip.ai/tasks/ENG-555) |

---

## 9. Links

| Resource | URL |
|----------|-----|
| Sheet tab | https://docs.google.com/spreadsheets/d/1kU96tGaT8zPUS24PjsUWOO37E2SLpB4cBVjdVupq3XY/edit?gid=1737154204#gid=1737154204 |
| Mattermost ANS V2 | team.scandid.in · channel `ans-v2` |
| ENG-555 (out of scope) | https://tracker.travelvip.ai/tasks/ENG-555 |
| Lambda shop (Dev) | https://lambda-shop.travelvip.ai/ |
| Gamma Nexus (Dev) | https://gamma-nexus.travelvip.ai/ |
