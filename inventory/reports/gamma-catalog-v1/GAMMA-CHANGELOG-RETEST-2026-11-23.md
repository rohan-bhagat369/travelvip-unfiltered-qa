# catalog_v1 changelog on gamma — 23 Nov 2026

**Env:** `https://gamma-api.travelvip.ai` · partner **vgm** (+ smt card)  
**Scope focus:** Lounge + Fast Track (eSIM also ran; deferred for sign-off per QA)  
**Probes:** `probe-canary-catalog-v1-full.js` + `probe-canary-catalog-v1-remaining.js`  
**Legacy key:** `ojny1swtigd4as` · Stripe test key (session)

## Score

| Probe | PASS | BUG | CHECK | NOT TESTED |
|---|---:|---:|---:|---:|
| Full | 57 | 0 | 11 | 95 |
| Remaining | 31 | 2 | 11 | 43 |

## Lounge + Fast Track (priority)

| Case | Lounge | Fast Track | Notes |
|---|---|---|---|
| **W1** finalize | CHECK `PROVIDER_BOOKING_FAILED` `BR1795431335722922` | **PASS** `BR1795431348597194` | Same Lounge supplier issue as canary |
| **W4** no partner key | **PASS** | **PASS** | |
| **W6** currency | **PASS** | **PASS** | |
| **C1** create | **PASS** | **PASS** | |
| **C2** pay→book | CHECK `BOOKING_SUBMIT_FAILED` | **PASS** `BR1795431359254325` | |
| **C5** replay path | NT (C2 fail) | **PASS** `BR1795431424534753` | |
| **C3** webhook-only | CHECK no progress | **PASS** `BR1795431428586257` | **Better than canary** — FT webhook completes |
| **C4** reject after pay | **PASS** (submit fail) | CHECK sim ignored | |
| **U2–U5** | NT (no Pending) | **PASS** | |
| **U8** | NT | CHECK still 200 | |
| **R1–R3** | **PASS** | **PASS** | |
| **V1/V2/V6/V7** | **PASS** | **PASS** | |
| **I2** | **PASS** | CHECK | |
| **I3** | **PASS** | **PASS** | |
| **L5/L6/L8** old | **PASS** (key works) | — | |
| **L1** old create | CHECK catalog miss | CHECK catalog miss | Key OK; option not in old catalog |

## vs canary (notable)

| Topic | Canary | Gamma |
|---|---|---|
| FT wallet / card happy path | PASS | PASS |
| Lounge supplier | FAIL | FAIL (same) |
| **C3 webhook-only FT** | CHECK (no progress) | **PASS** (completes) |
| Legacy key `ojny1swtigd4as` | works | works |
| Old L1 create | catalog miss | catalog miss |

## Open issues on gamma (Lounge + FT)

1. **Lounge supplier** — wallet + card fail (`PROVIDER_BOOKING_FAILED` / `BOOKING_SUBMIT_FAILED`)
2. **U8** FT — wrong-partner update still **200**
3. **I1/I2** FT — idempotency / concurrent Request-Id not clean
4. **C4** FT — failure sim ignored after pay
5. **C3** Lounge — webhook-only still no progress (FT OK)
6. **Old L1** — `… option not found in catalog` (key valid)

## Still blocked (need Dev/ops)

W3/W7 · W8/C12 · A1/A2/A4 · C6/C13 · V8 · Lounge U* · L2/L4/L7 (need L1 BR) · L3 old webhook

## Key BRs (gamma)

| Product | W1 | C2 / C5 |
|---|---|---|
| Lounge | `BR1795431335722922` (Failed) | C1 `BR1795431342275121` → submit fail |
| Fast Track | `BR1795431348597194` (Pending) | C2 `BR1795431359254325` · C5 `BR1795431424534753` · C3 `BR1795431428586257` |

Artifacts: `full-matrix-latest.json` · `remaining-nt-latest.json` · `FULL-CHANGELOG-REPORT.md` · `REMAINING-NT-REPORT.md` under `inventory/reports/gamma-catalog-v1/`
