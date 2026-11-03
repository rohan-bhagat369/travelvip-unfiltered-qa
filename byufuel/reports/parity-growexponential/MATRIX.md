# Parity matrix — Azure UAT vs TravelVIP Grow

**Rule:** Fail only if Azure works and Grow breaks/missing. Same-on-both → `PARITY SAME`.  
**Updated:** 2026-10-26

## Module rollup

| Module | Status | Notes |
|--------|--------|-------|
| M01 Login (admin web) | **PASS** | Both login OK |
| M02 MDM inventory | **IN PROGRESS** | Both have OA/slots/UCO/rates; seed data differs (Pune vs multi) — OK if behaviour same |
| M03 Users lists | **IN PROGRESS** | Grow seeded; Admin Users list empty on Grow while logged in — **suspect Grow-only** (Azure has admins) |
| M04 Warehouse | **PASS (smoke)** | Both list WH |
| M05–M09 Request→Driver | **BLOCKED** Grow mobile + some role pwds |
| M10–M11 WH Check-in / Collect | **BLOCKED** Grow WH password |
| M12 Payment | **SMOKE** | Both list opens; Grow has VERIFIED+Pay row |
| M13 TSM/Leads APK | **BLOCKED** |
| M14 QR | **PARTIAL** | Grow has QR; Azure amaan QR list empty this session — compare generate later |
| M15 Support/Reports | **NOT TESTED** |
| UI cosmetics | See below | Most = `PARITY SAME`; only flag Grow-worse when Azure OK |

## UI issues under the rule

| ID | Issue | Azure | Grow | Verdict under rule |
|----|-------|-------|------|--------------------|
| UI-01 Advance Search truncate | Not re-opened | Yes | Re-check; if Azure same → PARITY SAME |
| UI-02 Time slot column clip | Dense table same family | Yes | PARITY SAME (worse strings on Grow data) |
| UI-03 Contact Nu… truncate | **Yes** | Yes | **PARITY SAME — leave** |
| UI-04 EST.AMOUNT header | Full `EST.AMOUNT` | Full this viewport (2026-10-27) | **PARITY SAME — leave** (prior truncate viewport) |
| UI-05 QR code wrap under modal | No QR data | Yes | **Candidate FAIL (Grow)** until Azure QR compared |
| UI-06 New Time Slot layout | Same | Same | **PARITY SAME — leave** |
| UI-07 Hours show 1–24 | Same | Same | **PARITY SAME — leave** |
| UI-08 Schedule Location blank / CTA stack | Compact CTA pattern elsewhere | Location blank + full-width stacked actions | **FAIL_GROW → UI-SCHED-01** |
| UI-11 “List of Requests” subtitle | Same on Payment | Same | **PARITY SAME — leave** |
| **UI-PROSPECT-01/02** | Clean Prospect View | Broken tabs/actions/layout | **FAIL_GROW** |
| **UI-ADMIN-01** | Full Admin View profile | Incomplete fields + stacked actions | **FAIL_GROW** |
| Supplier/Driver/TSM/WH/Itinerary Views | Compact actions | Compact actions | **PASS** (2026-10-27 detail sweep) |

## Functional candidates already (Grow-only suspects)

| Case | Azure | Grow | Next check |
|------|-------|------|------------|
| F-01 Admin Users list empty while super/admin logged in | Admins visible (amaan) | **NO DATA AVAILABLE** | Confirm filters / role of `parity.admin` |
| F-02 Build older on Grow | `20261014.1` | `20260922.1` | Confirm dump freshness with Dev |

## Evidence folders

- Grow deep UI: `day0/ui-deep/`
- Azure compare: `day0/ui-azure-compare/`
- Day 0 readiness: `day0/DAY0-READINESS.md`
