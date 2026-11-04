# ANS V2 Email Testing — Full Partner Sign-off Pack

**QA:** Rohan Bhagat  
**Product:** Travel VIP · ANS V2 emails (**User** + **Admin** + **CS**) · partner chrome / theme  
**Last updated:** 2026-11-04  
**Google Sheet (source of truth):** [ANS V2 Email Testing](https://docs.google.com/spreadsheets/d/1kU96tGaT8zPUS24PjsUWOO37E2SLpB4cBVjdVupq3XY/edit)  
**Evidence:** `travel-apis/reports/ans-v2-email-signoff/notif-evidence/{bookingId}/` · see `EMAIL-EVIDENCE-STANDARD.md`  
**Channel:** Mattermost `ANS V2`

---

## 1. Executive summary

| Item | Result |
|------|--------|
| **Partners tested** | **6** — BFL · SMT · **JSP** · TravelVerse · Thomas Cook · Entertainer |
| **Overall verdict** | **PASS** — all executed partner matrix rows are Done / PASS (as of 04 Nov 2026) |
| **Open sheet bugs** | **None** (prior TVS Attraction + TC request-lounge Ref bugs marked fixed & deployed) |
| **Original TravelVIP Dev baseline** | Signed off **2026-10-22** (see §13) |
| **JSP note** | Sheet tab **JSP Email Testing** — same booking refs / evidence as **SMT**. **Package booking emails NOT TESTED** (still V1 / in development — Prerna; retest when V2 ready — discussed with Shailesh Gaikwad) |

**How to read this doc:** Each partner section lists every test case (category × status), channels checked, booking ID / URL, and result. Soft notes are non-blocking. Soft ≠ fail.

---

## 2. What every test case checks

| Check | Meaning | PASS when |
|-------|---------|-----------|
| **ANS V2** | New ANS V2 email path / template | Subject + body use partner ANS V2 chrome (not legacy-only) |
| **User Email** | Customer inbox (`rohan@travelvip.ai` / guest where noted) | Mail received for that status |
| **Admin Email** | Admin / same travelvip inbox (BCC or To) | Mail received |
| **CS Email** | Scandid / CSV2 CS inbox | Mail received **or** documented **EXPECT** absent |
| **Notification** | In-app / push (where run) | Received **or** N/A / device note |
| **Content** | IDs, amounts, Ref/Valid till, PNR, Conf No., partner branding | Align User ↔ CS (and page when UI checked) |

**Hosts**

| Partner | Host |
|---------|------|
| TravelVIP baseline / BFL / SMT / **JSP** / Thomas Cook | `https://lambda-shop.travelvip.ai` |
| TravelVerse | `https://lambda-tvs.travelvip.ai` |
| Entertainer | `https://lambda-ent.travelvip.ai` (**email-only** — no UI session) |

---

## 3. Partner roll-up

| # | Partner | Sheet tab | When | Cases Done | Not tested / N/A | Bugs open |
|---|---------|-----------|------|------------|------------------|-----------|
| 1 | **BFL** | Partner BFL email testing | 28 Oct | 4 | 0 | 0 |
| 2 | **SMT** | Partner SMT email testing | 29–30 Oct | 26 | 1 (old hotel final Cancelled) | 0 |
| 3 | **JSP** | JSP Email Testing | 04 Nov (sheet) | 26 | 1 (old hotel final Cancelled) | 0 |
| 4 | **TravelVerse** | Partner TravelVerse testing | 3–4 Nov | 18 | 1 (Concierge Confirmed — page still Pending) | 0 |
| 5 | **Thomas Cook** | Partner Thomas Cook testing | 3–4 Nov | 9 | 0 | 0 |
| 6 | **Entertainer** | Partner Entertainer email testing | 4 Nov | 10 | 0 | 0 |

**Local CSVs:** `sheet-partner-{bfl|smt|jsp|tvs|thomas-cook|entertainer}-email-testing.csv`  
**JSP ↔ SMT:** Same booking IDs and `notif-evidence/` folders (results copied as SMT for JSP partner sign-off).

---

## 4. Partner BFL — test cases (28 Oct 2026)

**Scope:** Flight V1 OW/RT + Hotel (1 room / 2 rooms). User / Admin / CS.

| TC | Category | Action | Booking | User | Admin | CS | Result |
|----|----------|--------|---------|------|-------|-----|--------|
| BFL-01 | Flight V1 | Booking Confirmed (OW) | [FB1793174919474118](https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793174919474118) | Yes | Yes | Yes | **PASS** |
| BFL-02 | Flight V1 | Booking Confirmed (RT) | [FB1793175453420082](https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793175453420082) | Yes | Yes | Yes | **PASS** |
| BFL-03 | Hotel | Booking Confirmed | [1793180663401623](https://lambda-shop.travelvip.ai/hotel/booking-details/1793180663401623) | Yes | Yes | Yes | **PASS** |
| BFL-04 | Hotel | Booking Confirmed (2 rooms) | [1793181215750533](https://lambda-shop.travelvip.ai/hotel/booking-details/1793181215750533) | Yes | Yes | Yes | **PASS** |

**Softs (non-blocking):** CS pax “1 of 2”; journey block outbound-only on RT; CS create-stage Conf No N/A; guest count soft on 2-room hotel.

---

## 5. Partner SMT — test cases (29–30 Oct 2026)

**Scope:** Broad matrix including Notif where device allowed. Softs only unless noted.

| TC | Category | Action | Booking | User | Admin | CS | Notif | Result |
|----|----------|--------|---------|------|-------|-----|-------|--------|
| SMT-01 | Flight V1 | Confirmed (OW) | FB1793259782766802 | Yes | Yes | Yes | No* | **PASS** |
| SMT-02 | Flight V1 | Confirmed (RT) | FB1793260814281305 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-03 | Attraction | Booking Confirmed | BR1793257997359738 | Yes | Yes | Yes | No* | **PASS** |
| SMT-04 | Duty Free | Request Submitted | TX1793264472515952 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-05 | Duty Free | Cancelled | TX1793264472515952 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-06 | Duty Free | Request Submitted | TX1793266029536946 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-07 | Duty Free | Confirmed | TX1793266029536946 | Yes | Yes | No (EXPECT) | Yes | **PASS** |
| SMT-08 | Hotel Deals | Request Submitted | 1793266178907429 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-09 | Hotel Deals | Cancellation Requested | 1793266178907429 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-10 | Hotel Deals | Cancelled | 1793266178907429 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-11 | Hotel Deals | Request Submitted | 1793267354550423 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-12 | Hotel Deals | Confirmed | 1793267354550423 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-13 | Bus | Booking Confirmed | BB1793352327120871 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-14 | Bus | Booking Confirmed | BB1793365542337249 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-15 | Bus | Cancelled | BB1793365542337249 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-16 | Fast Track | Booking Confirmed | BR1793354606301154 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-17 | eSIM | Booking Confirmed | BR1793355821859872 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-18 | Meet & Greet | Request Submitted | SR1793356080195155 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-19 | Meet & Greet | Confirmed | SR1793356080195155 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-20 | Porter | Request Submitted | SR1793356493625548 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-21 | Porter | Confirmed | SR1793356493625548 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-22 | Hotel | Booking Confirmed | 1793356264366542 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-23 | Hotel | Cancellation Requested | 1793356264366542 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-24 | Hotel | Cancelled | 1793356264366542 | — | — | — | — | **N/A** (old hotel final Cancelled not expected) |
| SMT-25 | Lounge (Online HAK) | Confirmed | BR1793357650298985 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-26 | Lounge (Request PNQ) | Request Submitted | BR1793358755367025 | Yes | Yes | Yes | Yes | **PASS** |
| SMT-27 | Lounge (Request PNQ) | Confirmed | BR1793358755367025 | Yes | Yes | Yes | Yes | **PASS** |

\* Notif NOT RCVD = device lock / user mismatch — not an email bug.

**Duty Free Confirmed CS:** absent = **EXPECT** (product rule).

---

## 6. Partner JSP — test cases (sheet 04 Nov 2026)

**Sheet tab:** [JSP Email Testing](https://docs.google.com/spreadsheets/d/1kU96tGaT8zPUS24PjsUWOO37E2SLpB4cBVjdVupq3XY/edit#gid=1730046671)  
**Host:** `lambda-shop.travelvip.ai`  
**Note:** JSP matrix uses the **same booking refs and evidence as SMT** (shared `notif-evidence/{bookingId}`). QA Status column dated **04/11/2026** on sheet. Local CSV: `sheet-partner-jsp-email-testing.csv`.

> **JSP package booking emails — NOT TESTED (in development)**  
> Per discussion with **Shailesh Gaikwad**: while ANS V2 was being developed, the related changes landed on **V1**, so JSP **package booking** emails are still on the V1 path and were **left out of this matrix**. **Prerna** is working on bringing them onto V2. Once the V2 change is available, QA will **retest** JSP package booking emails and update this pack / the sheet.

| TC | Category | Action | Booking (same as SMT) | User | Admin | CS | Notif | Result |
|----|----------|--------|------------------------|------|-------|-----|-------|--------|
| JSP-01 | Flight V1 | Confirmed (OW) | FB1793259782766802 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-02 | Flight V1 | Confirmed (RT) | FB1793260814281305 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-03 | Attraction | Booking Confirmed | BR1793257997359738 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-04 | Duty Free | Request Submitted | TX1793264472515952 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-05 | Duty Free | Cancelled | TX1793264472515952 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-06 | Duty Free | Request Submitted | TX1793266029536946 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-07 | Duty Free | Confirmed | TX1793266029536946 | Yes | Yes | No (EXPECT) | Yes | **PASS** |
| JSP-08 | Hotel Deals | Request Submitted | 1793266178907429 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-09 | Hotel Deals | Cancellation Requested | 1793266178907429 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-10 | Hotel Deals | Cancelled | 1793266178907429 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-11 | Hotel Deals | Request Submitted | 1793267354550423 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-12 | Hotel Deals | Confirmed | 1793267354550423 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-13 | Bus | Booking Confirmed | BB1793365542337249 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-14 | Bus | Cancelled | BB1793365542337249 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-15 | Fast Track | Booking Confirmed | BR1793354606301154 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-16 | Trip Emergency Concierge | Request Submitted | SR1793354121787122 | Yes | Yes | No | Yes | **PASS** |
| JSP-17 | eSIM | Booking Confirmed | BR1793355821859872 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-18 | Meet & Greet | Request Submitted | SR1793356080195155 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-19 | Meet & Greet | Confirmed | SR1793356080195155 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-20 | Porter | Request Submitted | SR1793356493625548 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-21 | Porter | Confirmed | SR1793356493625548 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-22 | Hotel | Booking Confirmed | 1793356264366542 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-23 | Hotel | Cancellation Requested | 1793356264366542 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-24 | Hotel | Cancelled | 1793356264366542 | — | — | — | — | **N/A** |
| JSP-25 | Lounge (Online HAK) | Confirmed | BR1793357650298985 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-26 | Lounge (Request PNQ) | Request Submitted | BR1793358755367025 | Yes | Yes | Yes | Yes | **PASS** |
| JSP-27 | Lounge (Request PNQ) | Confirmed | BR1793358755367025 | Yes | Yes | Yes | Yes | **PASS** |

**Evidence refs (from sheet):** same `notif-evidence/` paths as SMT for each booking ID above.

---

## 7. Partner TravelVerse — test cases (3–4 Nov 2026)

**Host:** `lambda-tvs.travelvip.ai` · Chrome: **TravelVerse**

| TC | Category | Action | Booking | User | Admin | CS | Result |
|----|----------|--------|---------|------|-------|-----|--------|
| TVS-01 | Lounge (Online) | Booking Confirmed | BR1793690922489315 | Yes | Yes | Yes | **PASS** |
| TVS-02 | Duty Free | Request Submitted | TX1793691173946414 | Yes | Yes | No (EXPECT) | **PASS** |
| TVS-03 | Duty Free | Confirmed | TX1793691173946414 | Yes | Yes | No (EXPECT) | **PASS** |
| TVS-04 | Meet & Greet | Request Submitted | SR1793691405272102 | Yes | Yes | Yes | **PASS** |
| TVS-05 | Meet & Greet | Confirmed | SR1793691405272102 | Yes | Yes | Yes | **PASS** |
| TVS-06 | Trip Emergency Concierge | Request Submitted | SR1793692744169322 | Yes | Yes | No (EXPECT) | **PASS** |
| TVS-07 | Trip Emergency Concierge | Confirmed | SR1793692744169322 | — | — | — | **NOT TESTED** (page still Confirmation Pending) |
| TVS-08 | Porter | Request Submitted | SR1793693247905420 | Yes | Yes | Yes | **PASS** |
| TVS-09 | Porter | Confirmed | SR1793693247905420 | Yes | Yes | Yes | **PASS** |
| TVS-10 | Attraction | Booking Confirmed | BR1793693520238832 | Yes | Yes | Yes | **PASS** (prior User typo `rohaan@` — **fixed & deployed**) |
| TVS-11 | eSIM | Booking Confirmed | BR1793693683463272 | Yes | Yes | Yes | **PASS** |
| TVS-12 | Fast Track | Booking Confirmed | BR1793693827617960 | Yes | Yes | Yes | **PASS** |
| TVS-13 | Bus | Booking Confirmed | BB1793694549715997 | Yes | Yes | Yes | **PASS** |
| TVS-14 | Bus | Booking Cancelled | BB1793694549715997 | Yes | Yes | Yes | **PASS** |
| TVS-15 | Flight V1 | Booking Confirmed | FB1793702354303940 | Yes | Yes | Yes | **PASS** |
| TVS-16 | Flight V1 | Cancellation Requested | FB1793702354303940 | Yes | Yes | Yes | **PASS** |
| TVS-17 | Flight V1 | Cancelled | FB1793702354303940 | Yes | Yes | Yes | **PASS** (route DEL→BLR retest 04/11) |
| TVS-18 | Hotel Old Flow | Booking Confirmed | 1793711798118379 | Yes | Yes | Yes | **PASS** |
| TVS-19 | Hotel Old Flow | Cancellation Requested | 1793711798118379 | Yes | Yes | Yes | **PASS** |

**Softs (examples):** Conifrmed typo (later DF re-send fixed); airport “Maharaj” omit; bags not in Porter mail; Esim casing; page duration mismatch on Bus; pax age 12y observation on lounges.

---

## 8. Partner Thomas Cook — test cases (3–4 Nov 2026)

**Host:** `lambda-shop.travelvip.ai` · Chrome: **Thomas Cook**

| TC | Category | Action | Booking | User | Admin | CS | Result |
|----|----------|--------|---------|------|-------|-----|--------|
| TC-01 | Lounge (Online) | Booking Confirmed | BR1793695253218812 | Yes | Yes | Yes | **PASS** |
| TC-02 | Lounge (Request) | Request Submitted | BR1793695540768117 | Yes | Yes | Yes | **PASS** |
| TC-03 | Lounge (Request) | Booking Confirmed | BR1793695540768117 | Yes | Yes | Yes | **PASS** (prior email Ref N/A — **fixed & deployed**) |
| TC-04 | Meet & Greet | Request Submitted | SR1793696092917464 | Yes | Yes | Yes | **PASS** |
| TC-05 | Meet & Greet | Confirmed | SR1793696092917464 | Yes | Yes | Yes | **PASS** |
| TC-06 | eSIM | Booking Confirmed | BR1793699150165663 | Yes | Yes | Yes | **PASS** |
| TC-07 | Fast Track | Booking Confirmed | BR1793699297953708 | Yes | Yes | Yes | **PASS** |
| TC-08 | Duty Free | Request Submitted | TX1793703586853121 | Yes | Yes | No (EXPECT) | **PASS** |
| TC-09 | Duty Free | Booking Confirmed | TX1793703586853121 | Yes | Yes | No (EXPECT) | **PASS** |

**Notes**

- Online lounge / FT: Dragon Pass present where expected.  
- Request lounge Confirmed: Dragon Pass **absent** (correct).  
- Softs: Valid Till trailing comma; flight omitted on some user mails; email Savings/Tax 0.00 lines (email-only, not on page); Esim casing; DF Conifrmed / sucessfully typos (template-wide).

---

## 9. Partner Entertainer — test cases (4 Nov 2026)

**Host:** `lambda-ent.travelvip.ai` · Chrome: **the ENTERTAINER Lifestyle**  
**Mode:** **Email-only** (UI sign-in not available — page not compared).

| TC | Category | Action | Booking | User | Admin | CS | Result |
|----|----------|--------|---------|------|-------|-----|--------|
| ENT-01 | Fast Track | Booking Confirmed | BR1793709558169530 | Yes | Yes | Yes | **PASS** |
| ENT-02 | eSIM | Booking Confirmed | BR1793709774965900 | Yes | Yes | Yes | **PASS** |
| ENT-03 | Flight V1 | Booking Confirmed | FB1793710236506747 | Yes | Yes | Yes | **PASS** |
| ENT-04 | Lounge (Request) | Request Submitted | BR1793710793512577 | Yes | Yes | Yes | **PASS** |
| ENT-05 | Lounge (Request) | Booking Confirmed | BR1793710793512577 | Yes | Yes | Yes | **PASS** |
| ENT-06 | Lounge (Online) | Booking Confirmed | BR1793710966533216 | Yes | Yes | Yes | **PASS** |
| ENT-07 | Hotel Deals | Request Submitted | 1793711129201427 | Yes | Yes | Yes | **PASS** |
| ENT-08 | Hotel Deals | Booking Confirmed | 1793711129201427 | Yes | Yes | Yes | **PASS** |
| ENT-09 | Meet & Greet | Request Submitted | SR1793711490708381 | Yes | Yes | Yes | **PASS** |
| ENT-10 | Meet & Greet | Confirmed | SR1793711490708381 | Yes | Yes | Yes | **PASS** |

**Key content checks that passed**

| Product | Highlights |
|---------|------------|
| Fast Track | Total GBP 34.61 · Ref 8576741027757549 · Valid till 25/11/2026 · Dragon Pass |
| eSIM | Singapore 1D/500MB · Order 6ae9d6e0… · GBP 1.50 |
| Flight V1 | BLR→DEL via GOI · PNR R6USTQ · GBP 44.64 (route-subject soft cleared 04/11) |
| Lounge request | Elysian PNQ · Ref 987456 · no Dragon Pass (correct) · GBP 7.28 |
| Lounge online | Aspire MAN · Ref 8576018579415392 · Dragon Pass · GBP 24.01 |
| Hotel Deals | Lefay · Conf **1TAK4GDS** · Total Paid GBP 677.06 |
| Meet & Greet | Belfast BFS · Flight JHBKJBK · GBP 422.08 · Action ID 8694 |

**Softs:** Valid Till trailing comma; Esim casing; legacy TravelVIP CSV2 duplicate on some CS; pax age 12y observation; Request banner “Confirmation”; CS hotel mobile IT vs +44; M&G Confirmed “Request Date” stamped confirm day.

---

## 10. Fixed issues (no longer open)

| Partner | Case | Was | Resolution (04 Nov) |
|---------|------|-----|---------------------|
| TravelVerse | Attraction BR1793693520238832 | User NOT RCVD (`rohaan@` typo) | **PASS** — fixed & deployed; upcoming emails correct |
| Thomas Cook | Request lounge Confirmed BR1793695540768117 | Email Ref N/A vs page Id 789654 | **PASS** — fixed & deployed; upcoming emails correct |

---

## 11. Documented EXPECT behaviour (not bugs)

| Rule | Applies to |
|------|------------|
| Duty Free **Confirmed** → CS CSV2 mail **not** sent | SMT · TravelVerse · Thomas Cook (and TravelVIP baseline) |
| Trip Concierge Request → CS often **EXPECT** absent | TravelVerse |
| Request-based lounge Confirmed → **no** Dragon Pass logo | SMT · TC · Entertainer |
| Online lounge / online FT → Dragon Pass **present** | When product is online inventory |
| Old hotel flow → final **Cancelled** ANS mail **N/A** | SMT · TravelVerse Hotel Old Flow |

---

## 12. How a test case is executed (common steps)

1. Book / open the product booking on the partner host.  
2. Drive status to the action under test (Request Submitted / Confirmed / Cancelled / Cancellation Requested).  
3. Search Gmail User (`u/0` travelvip) and CS (`u/1` scandid) by booking ID.  
4. Verify ANS V2 partner subject + chrome.  
5. Cross-check booking ID, amounts, Ref/Valid till / PNR / Conf No. User ↔ CS.  
6. Record Done + comment on partner sheet tab; save evidence under `notif-evidence/{id}/`.

---

## 13. Counts (partner packs only)

| Partner | PASS / Done | EXPECT (CS absent) | NOT TESTED | N/A |
|---------|-------------|--------------------|------------|-----|
| BFL | 4 | 0 | 0 | 0 |
| SMT | 26 | 1 (inside Done row) | 0 | 1 |
| JSP | 26 | DF Confirmed + Concierge CS No | 0 | 1 |
| TravelVerse | 18 | several DF/Concierge rows | 1 | 0 |
| Thomas Cook | 9 | DF rows | 0 | 0 |
| Entertainer | 10 | 0 | 0 | 0 |

**Partner matrix open bugs: 0.**

---

## 14. Original TravelVIP Dev baseline (22 Oct 2026) — short archive

First full matrix on TravelVIP Dev (`lambda-shop`) was signed off in Mattermost ANS V2 on **2026-10-22** after fixes for Attraction / Fast Track / Flight V2 / Lounge / Hotel Deals `email_json` issues.

| Categories covered then | Actions |
|-------------------------|---------|
| Duty Free · Porter · Attraction · Fast Track · Meet & Greet · eSIM · Flight V1/V2 · Hotel · Hotel Deals · Lounge request/online · Trip Concierge | Submitted / Confirmed / Cancelled / Cancel Requested as applicable |

**Out of scope then (unchanged):** Cabs (UI not on Dev) · Bag Assure (unable to book) · Nexus **manual** Inprogress→Confirmed/Failed CS → [ENG-555](https://tracker.travelvip.ai/tasks/ENG-555).

Detail of that Oct matrix remains historically on sheet tabs **ANS V2 Testing- 15/07/2026** and **ANS V2 Testing- 30/09/2026**.

---

## 15. Sign-off statement (current)

**ANS V2 partner email testing is complete for BFL, SMT, JSP, TravelVerse, Thomas Cook, and Entertainer.**  

All executed sheet rows are **Done / PASS** as of **2026-11-04**. **JSP** uses the same booking refs and results as **SMT** (sheet tab JSP Email Testing). **JSP package booking emails are NOT TESTED** — still V1 / in development (discussed with Shailesh Gaikwad; Prerna working on V2; retest when ready). Prior TravelVerse Attraction and Thomas Cook request-lounge Ref issues are **fixed and deployed** (upcoming emails will show correct details). Soft observations only remain.  

**Google Sheet:** [ANS V2 Email Testing](https://docs.google.com/spreadsheets/d/1kU96tGaT8zPUS24PjsUWOO37E2SLpB4cBVjdVupq3XY/edit)  
**Evidence:** `travel-apis/reports/ans-v2-email-signoff/notif-evidence/`
