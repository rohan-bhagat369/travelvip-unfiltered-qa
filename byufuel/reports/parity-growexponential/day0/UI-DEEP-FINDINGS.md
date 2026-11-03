# Grow admin — deep-flow UI findings

**Date:** 2026-10-26  
**Env:** `https://uat-byufuel.growexponential.app/` (admin `parity.admin@byufuel.localhost`)  
**Scope:** Admin web deep pages only (view/edit schedule, itinerary, MDM forms, QR modal, bulk, payment, advance search).  
**Not in scope yet:** WH Check-in / Collect Oil, Driver/Supplier/TSM APK (blocked on passwords + app pointing).  
**Evidence:** `byufuel/reports/parity-growexponential/day0/ui-deep/*.png`

---

## Deep pages opened

| # | Flow | Result |
|---|------|--------|
| 1 | Manage Requests list → View `SCH-000000007` | Opened |
| 2 | Itinerary list → View `IT-000000003` | Opened |
| 3 | Add New Driver form | Opened |
| 4 | Add New Supplier form | Opened |
| 5 | Time slots list → New Time Slot | Opened |
| 6 | UCO Configuration → Edit | Opened |
| 7 | QR list → QR modal + print | Opened |
| 8 | Incoming Deliveries | Opened |
| 9 | Create Bulk Request (supplier pick) | Opened |
| 10 | Supplier Payment list | Opened |
| 11 | Advance Search panel | Opened |
| 12 | Edit Schedule (`SCH-000000001`) | Opened |

---

## UI / alignment issues (highlight)

Severity: **H** = hurts use · **M** = messy / hard to read · **L** = polish / known Azure-ish

| ID | Sev | Screen | Issue | Evidence |
|----|-----|--------|-------|----------|
| UI-01 | **H** | Manage Requests → **Advance Search** | Almost all filter labels **truncated** (`Schedule C…`, `Establishm…`, `Supplier Pi…`, `Planned W…`, `Wareho…`, etc.). Hard to know which field is which. | `15-advance-search.png` |
| UI-02 | **H** | Manage Requests **table** | **Time Slot** column text clipped (`4 PM to E…` / cut at edge). Horizontal column squeeze. | `02-requests-list.png` |
| UI-03 | **M** | Create New Supplier | **Contact Number** label truncated to `Contact Nu…` | `07-add-supplier-form.png` |
| UI-04 | **M** | Supplier Payment table | Header **EST.AMO** truncated (should be Est. Amount) | `14-supplier-payment.png` |
| UI-05 | **M** | QR Code modal | Container code under QR **wraps awkwardly** (`B-2610-Pune-` then `00001` on next line) | `11-qr-row-click.png` |
| UI-06 | **M** | New Time Slot form | Large empty white area left; fields clustered right — **uneven layout / wasted space** | `09-time-slot-add.png` |
| UI-07 | **M** | Time slots list | Shows raw **`1` / `24`** instead of readable AM–PM (same class of UX as Azure “1–24” labels) | `08-time-slots.png` |
| UI-08 | **M** | View Schedule Details | **Location** blank while **Pickup Address** filled; big empty band before UCO table; Approve/Reject/etc. are plain text stack (weak primary CTA hierarchy) | `03-request-after-sch-click.png` |
| UI-09 | **L** | View Itinerary | **Total distance** empty; Planned vs Collected **Kg** formatting inconsistent (`10.00 Kg` vs `10 Kg`); drop address has stray `-` | `05-itinerary-after-it-click.png` |
| UI-10 | **L** | Dashboard tiles | Several module cards are **empty shells** (Itinerary, Warehouse, QR, Payment, etc.) while sibling cards have shortcut buttons — uneven density | `01-dashboard.png` |
| UI-11 | **L** | Itinerary / Incoming / Payment | Subtitle says **“List of Requests”** on non-request modules (copy mismatch) | `04` / `12` / `14` |
| UI-12 | **L** | Edit Schedule | Toggle affordance for Remind / Keep-container looks like a **circle control**, not a clear on/off switch; dual amount UI (`Price estimate` gold chip + Save) | `16-request-row-actions.png` |
| UI-13 | **M** | Requests list data display | Some slots show odd values e.g. **`1 AM to 1 AM`** (data/display) | `02-requests-list.png` |

---

## Functional notes seen while deep-diving (not pure UI)

| Note | Detail |
|------|--------|
| Happy path data exists | `IT-000000003` / `SCH-000000005` already **Delivered At Warehouse**; payment row **VERIFIED** with Pay |
| `IT-000000002` | Still **Arrived At Warehouse** — good candidate for WH Check-in once WH login works |
| Admin Users list | Still empty while logged in as admin (Day 0 oddity) |

---

## Still blocked for deeper parity

1. WH web passwords → Check in Oil / Collect Oil UI  
2. Mobile app pointing at Grow → Driver / Supplier / TSM screens  
3. Side-by-side Azure screenshot of same screens (to mark **parity vs new dump-only**)

---

## Next chunk options

- **A)** You send WH (+ mobile) passwords → WH Check-in UI deep pass  
- **B)** Stay on admin: Approve `SCH-000000007` → create itinerary UI (still no driver app)  
- **C)** Open Azure same screens and mark each UI-* as BOTH / GROW-ONLY
