# PROD OTEL / SigNoz smoke — flight + hotel search (no book)

- Base: `https://api.travelvip.ai`
- Partner: vgm · tier `19597201`
- Scope: **1 flight search + 1 hotel search only** · **no book**
- SigNoz checked: 2026-10-28 (logged-in session)

## API calls

| Call | Correlation ID | HTTP | clientMs | Result |
|---|---|---|---|---|
| flight-search | `qa-otel-prod-1793188313819-flight-search` | 200 | 13612 | OK · 20 options DEL–BOM |
| hotel-search | `qa-otel-prod-1793188340954-hotel-search` | 200 | 1133 | OK |

## SigNoz logs (PASS)

Filter: `body CONTAINS '<corr-prefix>'` · last 2h

| Corr | In SigNoz? | What we saw |
|---|---|---|
| `…-flight-search` | **YES** | Multiple `Before request` / `REQUEST DATA` for `POST /api/flights/catalog-v2/search` with `X-Correlation-ID` + `traceparent` |
| `…-hotel-search` | **YES** | Hotel listing request + Riya availability logs tagged with same correlationId (incl. vendor 400 after ~610ms on one Riya call; overall API still 200) |

**Verdict:** Prod OTEL logging is working for both flight and hotel search — correlation IDs and `traceparent` appear in SigNoz.

## Evidence JSON

`other/zenith/reports/prod-otel-flight-hotel-search.json`
