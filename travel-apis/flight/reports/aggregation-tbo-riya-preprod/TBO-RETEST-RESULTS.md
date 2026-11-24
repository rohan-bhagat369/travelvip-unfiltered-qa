# TBO-back retest results

Checked: **2026-11-23T09:57:50Z** · `https://preprod-api.travelvip.ai` · DEL–DXB/BOM **2026-12-14** / **2026-12-21**  
Flow: search → details (+ pricing) · **no book**

## Summary: 15 PASS · 3 BUG · 0 NOT TESTED

## Headline

| Result | Detail |
|---|---|
| Merged tier `22101801` | **Working** — both `402T`+`422R`, dual cards, RT both vendors, C15 TBO/Riya selection PASS, details `402T` PASS |
| Single-vendor isolation | **BUG** — TBO-only `22157551` and Riya `8` both return **both** codes |
| TBO pricing | **BUG** — `POST /v1/flights/pricing` for `402T` → `400 VENDOR_ERROR` “Pricing failed.” (details OK) |

## Cases

| Case | How | Status | Notes |
|---|---|---|---|
| A1 | TBO-only `22157551` CODES=={402T} | **BUG** | got `{422R,402T}` |
| A2 | Riya tier 8 CODES=={422R} | **BUG** | got `{422R,402T}` |
| A3 | Merged both vendors | **PASS** | |
| A4 | Dual-vendor option | **PASS** | |
| B9 | Merged card segments | **PASS** | |
| B10 | Fare retention both vendors | **PASS** | |
| B3 / B4 | Count bounds | **PASS** | |
| DET1 / DET2 | Details+pricing 422R | **PASS** | |
| DET3 | Details 402T | **PASS** | |
| DET4 | Pricing 402T | **BUG** | `VENDOR_ERROR` Pricing failed |
| C1 / C3 | RT dirs + both codes | **PASS** | |
| C15 / C15a / C15b | TBO vs Riya selection | **PASS** | |
| C13 | DEL–BOM RT both vendors | **PASS** | |

## Evidence

- Dumps: `travel-apis/flight/reports/aggregation-tbo-riya-preprod/dumps-retest/`
- JSON: `TBO-RETEST-RESULTS.json`
