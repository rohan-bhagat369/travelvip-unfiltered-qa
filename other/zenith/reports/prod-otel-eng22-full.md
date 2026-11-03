# ENG-22 full — PROD api.travelvip.ai

- Ran: 2026-10-28T11:59:15.698Z
- Prefix: `qa-otel-prod-full-1793188736699`
- Partner: vgm · tier `19597201`
- **No live Confirmed book**
- SigNoz checked: 2026-10-28 (logged-in) · filter `body CONTAINS '<corr>'` · last 2h

| Case | Rule | Status | How tested |
|---|---|---|---|
| TC-1 | Positives: hotel AC/search, airports, airlines, citySearch, flight search | **PASS** | API all 200; SigNoz has flight + hotel listing logs with `X-Correlation-ID` + `traceparent` |
| TC-2 | Client timings vs SigNoz duration (≤1s overhead) | **PASS** (partial span) | clientMs captured; hotel-search p50 **1052ms**; same corr shows Riya `took 538–573 ms`; root HTTP span duration not isolated in Traces UI, but vendor+client within ≤1s of each other for that hop |
| TC-5 | 4xx invalid payloads logged | **BUG** (logging gap) | API **400** `VALIDATION_ERROR` (dates + comma nationality); **no** SigNoz logs for `…-tc5-4xx` / `…-tc5-comma` (or request_ids) |
| TC-6 | Rejected book-shaped + PII/stack | **PASS_API** / **NOT TESTED** (SigNoz) | issue-ticket + hotel finalize **400** (no Confirmed); **no** SigNoz logs for `…-tc6-pii-*` → cannot verify stack traces or PII redaction |
| NEG | Auth/validation negatives | **PASS_API** / **GAP** (logs) | omit/garbage bearer → **403** `INVALID_PARTNER_KEY`; bad hotel/flight → **400**; no 500. Corr-tagged logs not found in SigNoz for these early rejects |

## SigNoz evidence (PASS)

| Corr suffix | In SigNoz? | Notes |
|---|---|---|
| `tc1-flight-search` | **YES** | `Before request` / `REQUEST DATA` `POST /api/flights/catalog-v2/search` with `X-Correlation-ID` + `traceparent` (`00-eb084a6c…`) |
| `tc2-hotel-search-0/1/2` | **YES** | Hotel listing + Riya CitySearch/GetStaticContent; `took 538–573 ms`; `traceparent` present (`00-a4acd3a5…` on -2) |
| `tc1-hotel-ac`, `tc2-airports-*`, `tc5-*`, `tc6-*`, `neg-*` | **NO** (body search) | Early/light endpoints and 4xx rejects not appearing under `body CONTAINS '<corr>'` |

Traces Explorer: spans present for `travelx-backend` in the window; could not cleanly join our PREFIX via `X-Correlation-ID` attribute filter in UI (needs attribute-key confirmation).

## Timing (clientMs)

| Endpoint | n | min | max | avg | p50 |
|---|---|---|---|---|---|
| airports | 3 | 78 | 87 | 81 | 79 |
| hotel-ac | 3 | 90 | 99 | 95 | 95 |
| hotel-search | 3 | 1043 | 1178 | 1091 | **1052** |

## API call summary (selected)

| Label | HTTP | error.code | clientMs |
|---|---|---|---|
| tc1-hotel-search | 200 | — | 12754 |
| tc1-flight-search | 200 | — | 170 |
| neg-omit/garbage-bearer | 403 | INVALID_PARTNER_KEY | 109 / 238 |
| neg-hotel-dates / html | 400 | VALIDATION_ERROR | 56 / 54 |
| neg-flight-same-od | 400 | VALIDATION_ERROR | 126 |
| neg-flight-html | 400 | INVALID_AIRPORT | 72 |
| tc5-4xx / tc5-comma | 400 | VALIDATION_ERROR | 50 / 55 |
| tc6-pii-flight (issue-ticket) | 400 | VALIDATION_ERROR | 130 |
| tc6-pii-hotel (finalize) | 400 | VALIDATION_ERROR | 60 |

## Verdict

- **Instrumentation works** for catalog flight search + hotel availability listing on prod (corr ID + traceparent in logs).
- **Gap / BUG:** early **4xx validation** (TC-5) and **rejected book-shaped** (TC-6) requests do **not** show up in SigNoz under the correlation ID — so “errors logged / stack / PII redaction” cannot be signed off from this run.
- Evidence JSON: `other/zenith/reports/prod-otel-eng22-full.json`
