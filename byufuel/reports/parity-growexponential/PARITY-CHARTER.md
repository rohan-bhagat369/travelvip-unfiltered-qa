# Byufuel parity — Azure UAT → TravelVIP Grow

**Goal:** TravelVIP dump must **replicate Azure UAT**. Future: remove Byufuel from Azure and run only on TravelVIP. Nothing functional should be missed.

## Rule (non-negotiable)

| Situation | Action |
|-----------|--------|
| **Same behaviour on Azure + Grow** (even if buggy / ugly UI) | **Leave** — log as `PARITY SAME` / inherited. Not a Grow blocker. |
| **Works on Azure, breaks / missing / different on Grow** | **FAIL / BLOCKER** — this is what we escalate. |
| **Works on Grow, broken on Azure** | Note only (Azure baseline bug); not a migration blocker unless product wants a fix. |
| **Cannot run on one side** (no data, no password, no APK) | `BLOCKED` — do not guess. |

**Branch on:** HTTP/status transition + next enabled action + same fields present — not copy tweaks alone.  
**IDs are env-local** (`SCH`/`IT` on Azure ≠ Grow).

## Environments

| | Azure UAT (baseline) | TravelVIP Grow (candidate) |
|--|--|--|
| Web | `https://u-byufuel.azurewebsites.net` | `https://uat-byufuel.growexponential.app/` |
| Build seen | `1.0.0 (20261014.1)` | `1.0.0 (20260922.1)` |
| Admin | `amaan@crediblesg.com` | `parity.admin@byufuel.localhost` |

## Surfaces to cover (nothing missed)

| Module | Surface | Positive | Negative |
|--------|---------|----------|----------|
| M01 Login / channel rules | Web + APK | Correct role login | Wrong channel (WH on APK, supplier on web), bad password |
| M02 Admin MDM | Web | OA, slots, UCO config, rates, types, countries | Empty required, invalid min>max weight |
| M03 Users | Web | Create/list Admin, Driver, Supplier, WH, TSM, Leads, Roles, Zipcodes | Duplicate email/phone, approve without KYC |
| M04 Warehouse master | Web | WH CRUD / active | Deactivate impact |
| M05 Supplier request | APK + Admin | Pickup + Drop, recurring, estimate | Weight out of range, past slot, cancel rules |
| M06 Bulk schedule | Web | Create / view bulk | Replace confirm (Azure TC05 behaviour) |
| M07 Approve / reject / reschedule | Web | Approve → status path | Reject, suggest new time, cancel |
| M08 Itinerary | Web | Create, assign driver, order stops | Partial assign (SCH assigned / IT still CREATED) |
| M09 Driver trip | APK | Accept → Start → QR JSON → qty → challan → Arrive WH | Invalid QR, capacity exceeded, start rule block |
| M10 WH Check-in | Web | **Check in Oil** scan → verify → confirm | Missing container → Pending Investigation |
| M11 WH Collect Oil | Web | **Drop only** path + docs | Using Collect Oil on driver IT (must match Azure bad-path behaviour) |
| M12 Payment | Web | Supplier payment after verified | Pay when pending investigation |
| M13 TSM / City / Area | APK | Visit, prospect, Sell Oil in zip scope | Empty scope / no supplier |
| M14 QR / containers | Web | Generate, print, scan | Reused QR behaviour vs Azure |
| M15 Support / chat / reports / penalty | Web | Open lists, basic actions | Empty / permission |

## Verdict labels

`PASS` · `FAIL (Grow only)` · `PARITY SAME` · `BLOCKED` · `NOT TESTED`

## Evidence

Per case: Step | Azure result | Grow result | Verdict | IDs/screenshots  
Folder: `byufuel/reports/parity-growexponential/`

## Current blockers for full matrix

1. Grow passwords for WH / Driver / Supplier / TSM  
2. Grow-pointed mobile APK (or API base)  
3. Until then: **web Admin + MDM + request/itinerary/payment** modules only
