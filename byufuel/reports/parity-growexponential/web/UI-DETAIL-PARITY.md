# UI Detail-page parity sweep (Azure vs TravelVIP Grow)

**Date:** 2026-10-27  
**Rule:** Azure = baseline. Grow differs → **FAIL_GROW**. Same on both → **PARITY SAME** (leave).  
**Builds:** Azure `1.0.0 (20261014.1)` · Grow `1.0.0 (20260922.1)`  
**Method:** Open **View** (not list smoke) on both; measure action button boxes + field chrome; full-page screenshots.  
**Evidence:** `web/e2e/ui-detail/ui-audit-*.png`

---

## Why prior pass missed these

List/module smoke only checked pages **load**. It did **not** open every **View/Edit detail** and compare layout (tabs, address card, action row, missing fields). That gap is closed by this sweep.

---

## Summary

| ID | Screen | Verdict | One-liner |
|----|--------|---------|-----------|
| **UI-PROSPECT-01** | Prospect → View (Personal details) | **FAIL_GROW** | Tabs stretched; address/columns misaligned; Back/Edit/Convert full-width stacked; no `Prospect Users / View Prospect` chrome |
| **UI-PROSPECT-02** | Prospect → Visits tab | **FAIL_GROW** | Visits table exists, but same broken action stack + tab stretch as Personal |
| **UI-ADMIN-01** | Admin Users → View | **FAIL_GROW** | Grow missing large field set + avatar/KYC/Address; actions stacked text; Azure has full profile + compact Back/Edit |
| **UI-SCHED-01** | Manage Requests → View Schedule | **FAIL_GROW** | Actions Back / Suggest / Cancel / Reject full-width stacked; Location blank (Address filled) — Azure pattern is compact CTA |
| **UI-SUP-01** | Suppliers → View | **PASS** (layout) | Breadcrumb + compact Back/Edit/Approve bottom-right on Grow; matches Azure family |
| **UI-DRV-01** | Drivers → View | **PASS** (layout) | Compact Back/Edit; address card present |
| **UI-TSM-01** | TSM & Leads → View | **PASS** (layout) | Compact Back/Edit; tabs present |
| **UI-WHW-01** | WH Workers → View | **PASS** (layout) | Compact Back/Edit |
| **UI-WH-01** | Warehouses → View | **PASS** (layout) | Overview/Details tabs load |
| **UI-IT-01** | Itinerary → View | **PASS** (layout) | Tabs + content OK (data quirks = low / prior UI-09) |
| — | Payment list headers | **PARITY SAME** / leave | `EST.AMOUNT` readable this viewport; prior truncate was viewport-sensitive |
| — | Create Supplier/Driver forms | **NOT RE-RUN** | Still blocked on automation bind (see WEB-E2E-FULL USR-CREATE) |

---

## FAIL_GROW detail

### UI-PROSPECT-01 / 02 — Prospect View

| Check | Azure | Grow |
|-------|-------|------|
| Title | `Prospect Users` + `View Prospect` | `View Prospect` only |
| Tabs | Personal details · Visits usable | Tabs present but **~592px each** (Visits pushed far right) |
| Address | Card in grid | Address block + Country/Lat/Long dump; layout break vs Azure |
| Actions | Back + Edit **compact** (~64px), bottom-right row | Back / Edit / Convert **~1201px wide**, **stacked** |
| Visits | Table: Visited By, User Type, dates, Remarks | Table OK; **same stacked actions** under tab |

**Evidence:** `ui-audit-grow-prospect-personal.png`, `ui-audit-grow-prospect-visits.png`, `ui-audit-azure-prospect-personal.png`

### UI-ADMIN-01 — Admin View (high)

Grow Admin View is not just misaligned — **content is incomplete** vs Azure for the same kind of user:

| Element | Azure | Grow |
|---------|-------|------|
| Avatar / Active / Deactivate / Reset Password | Present | Missing chrome (only stacked text actions) |
| First / Last name | Shown | **Missing** |
| Roles | Super Admin | `-` |
| Employee Id / Age / Department | Shown | **Missing** |
| KYC documents | Card | **Missing** |
| Address card | Building…Postal | **Missing** |
| Back / Edit | Compact bottom-right | Full-width stacked Back / Deactivate / Edit |

**Evidence:** `ui-audit-azure-admin.png` vs `ui-audit-grow-admin-recheck.png`

### UI-SCHED-01 — Schedule View

| Check | Grow (measured) |
|-------|-----------------|
| Actions | Back, Suggest a new time, Cancel Schedule, Reject — each **w≈1201**, stacked |
| Location | Blank while Address filled (same family as day0 UI-08) |

Azure schedule list had no openable row in this session (empty / redirect); CTA pattern on Azure elsewhere is compact bottom-right → treat Grow stack as **FAIL_GROW**.

**Evidence:** `ui-audit-grow-schedule-detail.png`

---

## PASS detail screens (no Grow-only layout break found)

Supplier, Driver, TSM & Leads, WH Worker, Warehouse, Itinerary Views: Grow keeps **compact** Back/Edit (≈64–80px) bottom-right, with breadcrumb-style `h2`/`h3` where Azure has them. Do **not** fail these for CSS stack.

Residual low items (data/copy, not this sweep’s blockers): itinerary distance empty, “List of Requests” subtitle on Payment — leave if Azure same (day0).

---

## Pattern for Dev

Broken screens share one CSS/layout family on Grow dump `20260922.1`:

1. **Footer actions rendered as full-width stacked blocks** instead of compact horizontal row.  
2. **Prospect tabs** stretch to half content width.  
3. **Admin View** missing profile sections (possible older template / incomplete dump, not only CSS).

Ask Dev: refresh Grow web package to Azure `20261014.1` (or later) and re-verify UI-PROSPECT-*, UI-ADMIN-01, UI-SCHED-01.

---

## Coverage checklist (this run)

| View opened | Azure | Grow |
|-------------|-------|------|
| Prospect Personal | Yes | Yes |
| Prospect Visits | Yes | Yes |
| Admin | Yes | Yes |
| Supplier | Yes | Yes |
| Driver | Yes | Yes |
| TSM & Leads | Yes | Yes |
| WH Worker | Partial (list empty once) | Yes |
| Warehouse | Partial | Yes |
| Schedule detail | Blocked (no rows / nav) | Yes |
| Itinerary | List | Yes |
| Payment list | — | Yes |
| Create forms | — | Prior only |
