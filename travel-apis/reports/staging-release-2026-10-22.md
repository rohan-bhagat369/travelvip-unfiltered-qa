# Staging release test report — 2026-10-22

Env: `https://api-staging.travelvip.ai` · partner `vgm` · Nexus `https://dev-nexus.travelvip.ai/`  
Alerts: Mattermost **DEV | Booking & Cancellation Alerts** (`flight-alerts-dev`)

## Summary

| Area | PASS | BUG | NOT TESTED |
|---|---|---|---|
| Nexus flight alerts (§4.1) | 5 | 0 | 0 |
| Cab lead-time + distance (§2.1) | 10 | 0 | 0 |
| Phone validation hotel/flight/cab (§7) | 11 | 0 | 0 |
| Cab pax gender/title (§2.2) | 2 | 0 | 0 |
| Wallet activity (§5.2) | 3 | 0 | 0 |
| Partner emp (§6) | 1 | 0 | 0 |
| Hotel request-action desk (§3) | 0 | 0 | 0 (skipped — no alert; X-Api-Key not needed) |
| Cab webhooks / trip timeline (§2.5–2.6) | 1 | 0 | 0 (BR1792661199773760 full lifecycle) |
| DB / cab in-trip status → dispatch (§2.8) | 1 | 0 | 0 (verified via cab.location server logs) |

JSON evidence: `travel-apis/reports/staging-release-phase1.json`

---

## Phase 2 — Nexus + alerts (§4.1)

| ID | Case | BR | Status | Evidence |
|---|---|---|---|---|
| F-CONF | Inprogress → Confirmed via Nexus | BR1789475320867763 | **PASS** | Staging Confirmed; Mattermost `[Manual] Flight Booking Confirmed` · vendorPNR ABDGXCBU |
| F-FAIL | Inprogress → Failed via Nexus | BR1788947977221632 | **PASS** | Staging Failed; `[Manual] Flight Booking Failed` · Price change |
| F-CXL-REQ | Partner offline cancel | BR1792652443426890, BR1792652225697532 | **PASS** | Both `[Manual] Flight Cancellation Requested` |
| F-CXL-OK | Ops settle cancel | BR1792652443426890 | **PASS** | Staging **Cancelled**; `[Manual] Flight Cancellation Completed` · SUCCESS |
| F-CXL-REJ | Ops reject cancel | BR1792652225697532 | **PASS** | Staging still **Confirmed**; `[Manual] Flight Cancellation Failed` |

---

## Phase 1 — API

### Cab pickup lead-time (§2.1)

| ID | Rule | Status | Notes |
|---|---|---|---|
| C-LT-ARR-SOON | ARRIVAL +5m | PASS | 400 VALIDATION_ERROR · needs 20 minutes |
| C-LT-ARR-OK | ARRIVAL +25m | PASS | Lead-time OK (provider SEARCH_REJECTED — not lead-time) |
| C-LT-DEP-SOON | DEPARTURE +30m | PASS | needs 2 hours |
| C-LT-DEP-OK | DEPARTURE +130m | PASS | Lead-time OK |
| C-LT-REN-SOON / OK | RENTAL | PASS | same |
| C-LT-OUT-SOON / OK | OUTSTATION | PASS | same |
| C-LT-PAST | past pickup | PASS | “is in the past” |
| C-DIST-PAST | distance + past pickup | PASS | HTTP 200 (not affected) |

### Phone validation (§7)

| ID | Rule | Status |
|---|---|---|
| PH-H-999 / +999 / short / long | Hotel finalize | PASS (400 VALIDATION_ERROR) |
| PH-F-999 / +999 / short | Flight issue-ticket | PASS (400, no BR) |
| PH-C-999 / +999 / short | Cab finalize | PASS (calling-code messages) |

### Cab pax (§2.2)

| ID | Rule | Status |
|---|---|---|
| C-PAX-GENDER | gender `other` | PASS · Allowed: male, female |
| C-PAX-TITLE | title `Mr,` | PASS · Allowed: Mr, Mrs, Miss, Ms |

### Wallet (§5.2)

| ID | Rule | Status | Notes |
|---|---|---|---|
| W-ACT-100 | activity page (partner token) | PASS | HTTP 200 · pagination present |
| W-ACT-101 | limit/perPage 101 | PASS | 400 VALIDATION_ERROR |
| W-TOP | internal topup + `wallet.topup.success` | **PASS** | `alerts-dev`: rupees, `82754+100=82854`, ref `BANKTXN-0011`, `bank_transfer` |

### Cab statuses / location (§2.8 + dispatch)

| ID | Case | Status | Evidence |
|---|---|---|---|
| C-STAT / C-LOC | In-trip codes removed from booking status; GPS via `cab.location` dispatch (not DB) | **PASS** | Server logs BR1792668068505691: `cab.location` HTTP 200 · not stored in DB (by design) · lat/lng updates |

### Skipped by QA

| ID | Why |
|---|---|
| H-SETTLE | Hotel ops `request-action` / X-Api-Key — **not required**; hotel cancellation has **no alert** to verify |

---

## Next

QA pack complete for this release.  



