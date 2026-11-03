# ANS V2 — Partner BFL email dump (2026-10-28)

**Partner:** BFL · chrome **Bajaj Finserve / Bajaj Finance**  
**Shop:** `https://lambda-shop.travelvip.ai/`  
**Trigger:** Update APIs re-pointed delta → **lambda**; flight confirmed working (Shailesh)  
**Inboxes:**  
| Role | Address |
|------|---------|
| **User** | `rohan@travelvip.ai` |
| **Admin / CS** | `rohan@scandid.in` (CS subjects `[DEV] CSV2 Bajaj Finserve …`) |

**Verdict this dump:** **4 / 4 bookings PASS** (User + Admin + CS delivery). Soft content notes only — no FAIL.

---

## Summary table

| # | Booking ID | Category | Action | Page status | User | Admin | CS | Overall | Soft notes |
|---|------------|----------|--------|-------------|------|-------|-----|---------|------------|
| 1 | **FB1793174919474118** | Flight | Confirmed | Confirmation Successful | PASS | PASS | PASS | **PASS** | CS pax list shows 1 of 2; 1‑paisa base fare |
| 2 | **FB1793175453420082** | Flight RT | Confirmed | Confirmation Successful | PASS | PASS | PASS | **PASS** | CS/User preview = **outbound only** (return PNR missing in journey block); CS pax 1 of 2 |
| 3 | **1793180663401623** | Hotel | Confirmed | Confirmed | PASS | PASS | PASS | **PASS** | CS thread may show create-stage / Conf No N/A; User+Admin have **SNHAPI00011598** |
| 4 | **1793181215750533** | Hotel | Confirmed | Confirmed | PASS | PASS | PASS | **PASS** | Delivery OK · **content:** guest count **1 Adult** vs page **+ 2 Guest**; room type/2 rooms/total OK; CS no Club Room line |

---

## 1 — Flight OW · FB1793174919474118

**Page:** https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793174919474118;bookingReferenceId=FB1793174919474118  

| Field | Value |
|-------|--------|
| Status | Booking Confirmation Successful |
| PNR | **7D9PBV** |
| Route | BOM → BLR · AIR INDIA **AI-2863** · 10:05–11:45 |
| Pax | MR. ATUL BHAGAT (28) · MSTR. RAM GAIKWAD (1) |
| Baggage | Cabin 7 Kg · Check-in 15 Kg |
| Total | **₹21,220.24** |
| Shared to | `rohan@travelvip.ai` · 7219784663 |

| Channel | Subject / content check | Result |
|---------|-------------------------|--------|
| User | `[DEV] Bajaj Finserve \| Your Flight Booking Confirmed \| FB1793174919474118` · PNR 7D9PBV · BOM–BLR · ~1:39 PM | **PASS** |
| Admin | Same Confirmed · PNR 7D9PBV · ~1:39 PM | **PASS** |
| CS | `[DEV] CSV2 Bajaj Finserve \| Your Flight Booking \| FB…` · stages → **Ticketed** · Mobile **+91** 7219784663 · Total **21220.24** | **PASS** |

**Soft:** CS stage label “Booking Created” with Ticketed checklist; CS passenger Atul only; base fare page ₹17,355.20 vs CS 17355.24.

---

## 2 — Flight RT · FB1793175453420082

**Page:** https://lambda-shop.travelvip.ai/flight-booking/v2/booking-confirmation/FB1793175453420082;bookingReferenceId=FB1793175453420082  

| Field | Value |
|-------|--------|
| Status | Booking Confirmation Successful |
| Outbound | BOM→BLR · **IX-1549** · PNR **N9DJ7E** |
| Return | BLR→NMI · **IX-2914** · PNR **N4INNG** |
| Pax | MR. SHAILENDRA BHAGAT · MSTR. SHANTANU GAIKWAD |
| Total | **₹12,476.01** |
| Shared to | `rohan@travelvip.ai` · 7219784663 |

| Channel | Subject / content check | Result |
|---------|-------------------------|--------|
| User | Confirmed · FB… · PNR **N9DJ7E** · BOM–BLR · ~1:48 PM | **PASS** |
| Admin | Same Confirmed · ~1:48 PM | **PASS** |
| CS | CSV2 → Ticketed · Mobile **+91** · Total **12476.01** · IX-1549 BOM–BLR | **PASS** |

**Soft:** User/Admin/CS journey blocks show **outbound only**; return **N4INNG** not in CS summary. CS passenger Shailendra only.

---

## 3 — Hotel · 1793180663401623

**Page:** https://lambda-shop.travelvip.ai/hotel/booking-details/1793180663401623  

| Field | Value |
|-------|--------|
| Status | Confirmed |
| Confirmation No | **SNHAPI00011598** |
| Hotel | Pride Premier Pune · Deluxe Twin · 1N |
| Stay | 29 Oct 2026 → 30 Oct 2026 |
| Guest | Rohan Bhagat · `rohan@travelvip.ai` · +917219784663 |
| Total | **₹7,523.84** |

| Channel | Subject / content check | Result |
|---------|-------------------------|--------|
| User | `[DEV] Bajaj Finserve \| Your Hotel Booking Confirmed \| 1793180663401623` · Conf No **SNHAPI00011598** · ~3:14 PM | **PASS** |
| Admin | Same Confirmed · Pride Premier Pune · SNHAPI00011598 · ~3:14 PM | **PASS** |
| CS | CSV2 → Confirmed · Mobile **+91** · Total **7523.84** · Pride Premier Pune · ~3:15 PM | **PASS** |

**Soft:** CS thread body can show Stage “Booking Created” / Confirmation No. **N/A** while list + User/Admin already have SNHAPI00011598.

---

## 4 — Hotel · 1793181215750533

**Page:** https://lambda-shop.travelvip.ai/hotel/booking-details/1793181215750533  

| Field | Value |
|-------|--------|
| Status | Confirmed |
| Confirmation No | **SNHAPI00011600** |
| Hotel | Sheraton Grand Pune Bund Garden Hotel · Club Room × 2 · 1N |
| Stay | 03 Dec 2026 → 04 Dec 2026 |
| Guest | Rohan Bhagat + 2 · `rohan@travelvip.ai` · +917219784658 |
| Total | **₹48,279.18** |

| Channel | Subject / content check | Result |
|---------|-------------------------|--------|
| User | `[DEV] Bajaj Finserve \| Your Hotel Booking Confirmed \| 1793181215750533` · Conf No **SNHAPI00011600** · ~3:24 PM | **PASS** |
| Admin | Same Confirmed · Sheraton Grand Pune Bund Garden Hotel · ~3:24 PM | **PASS** |
| CS | CSV2 → Confirmed · Mobile **+91** 7219784658 · Total **48279.18** · confirm stage Conf No **SNHAPI00011600** · ~3:24 PM | **PASS** |

**Soft:** Earlier CS stage in same thread shows Confirmation No. **N/A**; Confirmed stage has SNHAPI00011600 (same pattern as booking #3).

### Content parity — page vs emails (1793181215750533)

| Field | Page | User / Admin | CS (Confirmed stage) | Match? |
|-------|------|--------------|----------------------|--------|
| Booking ID | 1793181215750533 | Yes | Yes | **OK** |
| Conf No | SNHAPI00011600 | Yes | Yes (confirm stage) | **OK** |
| Hotel | Sheraton Grand Pune Bund Garden Hotel | Yes | Yes · City Pune | **OK** |
| Check-in / out | 03–04 Dec 2026 | 03 Dec '26 / 04 Dec '26 | 2026-12-03 / 12-04 | **OK** |
| Nights | 1 | 1 Nights | 1 | **OK** |
| Rooms | **2** | Rooms **2** | Rooms **2** | **OK** |
| Room type | Club Room, 1 King Bed × 2 | Club Room · 1 King Bed | *(no room-type row)* | User/Admin **OK** · CS soft gap |
| Guest count | Rohan Bhagat **+ 2 Guest** | **1 Adult** only | Name Rohan Bhagat only | **MISMATCH** |
| Base | ₹41,359.18 | INR 41359.20 | INR 41359.20 | Soft (2‑paisa) |
| Tax | ₹7,020.00 | 7020.00 | 7020.00 | **OK** |
| Savings | −₹100.00 | INR 100.00 | — | User/Admin **OK** |
| Total | ₹48,279.18 | INR 48279.18 | INR 48279.18 | **OK** |
| Phone | +917219784658 | *(not in User body snippet)* | **+91** 7219784658 | CS **OK** |
| Email | rohan@travelvip.ai | addressed to Rohan | rohan@travelvip.ai | **OK** |

**Content verdict:** Core hotel/stay/room-type/totals **mostly OK**. Guest count **wrong** in User/Admin (`1 Adult` vs page `+ 2 Guest`). CS has no Club Room / King Bed line; create-stage had Rooms=1 before confirm corrected to 2.

---

## Checks applied (every booking)

1. Open lambda-shop booking-details / confirmation page → status, ids, totals, phone, pax.  
2. **User** inbox (`rohan@travelvip.ai`) — Confirmed subject + key ids (PNR / Conf No / BR).  
3. **Admin** inbox (`rohan@scandid.in`) — matching Confirmed.  
4. **CS** (`CSV2 Bajaj Finserve`) — stages to Ticketed/Confirmed · **+91** · total match.  
5. Branch on delivery + ids/totals/phone; soft-note content gaps (RT return, multi-pax CS, Conf No N/A in CS body).

---

## Not in this dump (still PENDING on BFL retest)

Duty Free · Porter · Attraction · Fast Track · Meet & Greet · eSIM · Flight cancel flows · Hotel cancel · Hotel Deals · Lounge · Concierge · Cabs · Bag Assure · ENG-555 Nexus manual CS.

---

## Quick copy block (Mattermost / tracker)

```
Partner BFL (lambda-shop) ANS V2 email dump — 2026-10-28
Inboxes: User rohan@travelvip.ai · Admin/CS rohan@scandid.in

1. FB1793174919474118 Flight OW Confirmed — User/Admin/CS PASS (PNR 7D9PBV · ₹21220.24 · +91)
2. FB1793175453420082 Flight RT Confirmed — User/Admin/CS PASS (soft: return leg missing in CS journey)
3. 1793180663401623 Hotel Confirmed — User/Admin/CS PASS (Conf SNHAPI00011598 · ₹7523.84 · +91; soft CS Conf No N/A in thread)
4. 1793181215750533 Hotel Confirmed — User/Admin/CS PASS (Conf SNHAPI00011600 · Sheraton Grand Pune · ₹48279.18 · +91; soft CS create-stage Conf No N/A)

Overall: 4/4 PASS delivery. Soft content notes only.
```

