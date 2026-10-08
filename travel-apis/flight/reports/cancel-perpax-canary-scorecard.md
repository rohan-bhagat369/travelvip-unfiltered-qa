# Per-passenger cancel charges — Canary scorecard

**Env:** `https://canary-api.travelvip.ai` · Partner `vgm`  
**Endpoint:** `POST /v1/flights/booking/{BR}/cancel`  
**Generated:** 2026-08-13 (session)

## Summary

| Bucket | Result |
|---|---|
| Live canary runnable cases | **Complete** |
| Known product gaps | NORMAL partial quote empty (`penaltyBasis: NONE`) |
| Provider/IX flakes | Expected — not scored as product bugs |
| Deferred (needs seed/offline inventory) | Offline `onlineCancellation=false`, FIXED/PERCENT exact math, DB row asserts |

---

## P0 smoke

| # | Case | Result | Notes |
|---|---|---|---|
| S1 | 1ADT OW full PENALTY→CANCEL | **PASS** | perPax / math OK |
| S2 | 2ADT subset `[PAX1]` | **PASS** (CORPORATE) | NORMAL often empty quote |
| S3 | 2ADT full PNR | **PASS** | fee×2, Cancelled |
| S4 | RT onward only | **PASS** | return intact |
| S5 | RT return only | **PASS** (6E) | IX CANCEL fail = provider |

## Core formula / path

| # | Case | Result |
|---|---|---|
| SSR withheld | **PASS** | `ssr` / `ssrCharge` 2420 not refunded |
| Sequential PAX1→PAX2 | **PASS** | request path; quotes OK |
| Multi-pax list `[PAX1,PAX2]` on 3ADT | **PASS** (CORPORATE) | NORMAL empty quote again |
| Remaining PAX3 after multi | **PASS** | quoted 849 |
| 3ADT full PNR | **PASS** | fee 1050 (=350×3), Cancelled |
| Cancel all via list (2ADT) | **PASS** | `scope: FULL_PAX` → Cancelled |

## Validations / edges

| # | Case | Actual | Result |
|---|---|---|---|
| Invalid pax | 422 `PAX_NOT_IN_BOOKING` | **PASS** |
| Bad PNR | 422 `PNR_INVALID` | **PASS** |
| Unknown BR | 404 `BOOKING_NOT_FOUND` | **PASS** |
| Already in progress | 409 `CANCELLATION_ALREADY_IN_PROGRESS` | **PASS** |
| Already cancelled | 409 `BOOKING_ALREADY_CANCELLED` | **PASS** |
| Missing action | 400 `VALIDATION_ERROR` | **PASS** |
| Missing / empty pnr | 400 `VALIDATION_ERROR` | **PASS** |
| Invalid action / lowercase | 400 `VALIDATION_ERROR` | **PASS** |
| Mixed `[PAX1,PAX99]` | 422 `PAX_NOT_IN_BOOKING` | **PASS** |
| Duplicate `[PAX1,PAX1]` | 400 `VALIDATION_ERROR` | **PASS** |
| Whitespace `" PAX1 "` | trims → Penalty Fetched | **PASS** |
| Numeric alias `"1"` | maps to PAX1 quote | **PASS** |
| Duplicate PENALTY | stable refund | **PASS** |
| `cancellationPaxList: null` | full-PNR Penalty Fetched | **PASS** |
| Empty `[]` paxList | treated as full-PNR quote | **PASS** |
| CANCEL without prior PENALTY | handled (IX may fail provider) | **PASS** |

## DB (started)

| BR | CR/CP | Cells | Policy | `estimated_*` vs CANCEL |
|---|---|---|---|---|
| `BR1786572460100067` (all-via-list) | PASS · FULL · ONLINE · 2 CP | PASS cancelled | PASS | **PASS (by design)** — columns store PENALTY **quote** (cents), not final CANCEL |

## Product issues to track

| ID | Issue | Severity |
|---|---|---|
| BUG-1 | **NORMAL** partial cancel: `penaltyQuotable:true` but `penaltyBasis:NONE` / no amounts / no perPax | Medium — CORPORATE OK |
| NOTE-1 | `perPax` is now an **array** of per-passenger rows (not summary object) | Contract change — update clients/harness |
| NOTE-2 | List-all-pax → `scope: FULL_PAX` (not PARTIAL) | Expected |
| NOTE-3 | IX online cancel often `Cancellation Failed` after good PENALTY | Provider |
| NOTE-4 | CR `estimated_*` = PENALTY quote only (by design) | Not a bug |

## Deferred (do after seed / offline inventory)

| Case | Why blocked |
|---|---|
| Offline full PNR (`onlineCancellation=false`) | No live Confirmed offline inventory found |
| FIXED policy exact ×pax math (R1) | Needs seeded policy amounts |
| PERCENT policy (R7) | Needs seed |
| No-policy (R8) | Needs seed |
| DB: cr/cp rows, cells, PENALTY writes nothing | Needs DB access |

## Key fixtures (reference)

| BR | Role |
|---|---|
| `BR1786567896898911` | CORPORATE subset quote PASS |
| `BR1786568283637573` | CORPORATE 2ADT full PASS |
| `BR1786568422897124` | RT onward+return 6E PASS |
| `BR1786570315695002` | SSR withheld PASS |
| `BR1786572156401139` | 3ADT multi-list + remaining PAX3 |
| `BR1786572337739872` | 3ADT full PNR PASS |
| `BR1786572460100067` | All-via-list → FULL_PAX PASS |

## Reports folder

All run artifacts under `reports/cancel-perpax-*.json`.
