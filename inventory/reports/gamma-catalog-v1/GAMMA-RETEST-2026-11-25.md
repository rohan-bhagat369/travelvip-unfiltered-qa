# ENG-826 catalog_v1 — gamma retest (2026-11-25)

**Base:** `https://gamma-api.travelvip.ai`  
**Partners:** `vgm` (B2B wallet) · `smt` (web/card + Stripe)  
**Sources:** Apidog envs `B2B_Dev_vgm` + `Web_Dev_smt` (base_url already gamma) · collections `api_services_booking` / `web_services_bookings`  
**Probes:** `probe-canary-catalog-v1-full.js` · `probe-canary-catalog-v1-remaining.js` · `probe-gamma-collection-bookings.js` · `probe-gamma-w7-wallet-disabled.js`

## Counts (after V4 reclass + W7 NT)

| Probe | PASS | BUG | CHECK | NOT TESTED |
|---|---:|---:|---:|---:|
| Full matrix | 48 | 0 | 16 | 99 |
| Remaining | 36 | 0* | 15* | 36 |
| Collection bookings | 14 | 0 | 0 | 0 |
| W7 wallet-disabled (later, wallet off) | 3 | 0 | 0 | 0 |

\*V4 raw probe = BUG (fake `offerId` accepted). Reclassed **CHECK** — same as 24 Nov: offers not implemented for Dev vgm.  
\*W7 re-run after wallet disabled → **PASS** `WALLET_UNAVAILABLE` all 3 products.

Full PASS list (API + DB): [PASS-REPORT-API-DB-2026-11-25.md](./PASS-REPORT-API-DB-2026-11-25.md)

## Happy path (must-pass)

| Case | Lounge | Fast Track | eSIM |
|---|---|---|---|
| W1 finalize | PASS `BR1795610839130093` | PASS `BR1795610852413742` | PASS `BR1795610867502945` |
| R1–R3 | PASS | PASS | PASS |
| C1 create | PASS | PASS | PASS |
| C2 pay→book | PASS (remaining/collection) | PASS | PASS |
| C3 webhook-only | PASS | PASS | PASS |
| C5 replay | PASS | PASS | PASS |
| Collection W1+C2 | PASS `BR1795610988365558` / `BR1795610988147578` | PASS `BR1795610992581719` / `BR1795610992626024` | — |

## Validations / guards

| Case | Lounge | Fast Track | eSIM |
|---|---|---|---|
| W4 no partner key | PASS | PASS | PASS |
| W6 currency mismatch | PASS | PASS | PASS |
| V1/V2/V3/V6 | PASS | PASS | PASS |
| V7 past travelDate | PASS | PASS | NT (no travelDate) |
| C7/C8/C9 | PASS | PASS | PASS |
| U1–U7 | PASS (U1 lounge after Pending) | PASS / U8 CHECK | PASS / U8 CHECK |
| L5/L6/L8 legacy key `ojny1swtigd4as` | PASS | — | PASS |
| L1 old create | PASS (catalog miss / key OK) | — | — |

## CHECKs (not signoff blockers)

| Case | Note |
|---|---|
| W5 smt→finalize | Still books with vgm partner key path — same CHECK as prior |
| V4 fake offerId | Accepts → CHECK until offers ship for vgm |
| I1/I2/I4 | Idempotency / concurrent Request-Id not clean |
| C4 failure sim | May be ignored after pay |
| U8 FT/eSIM | Wrong-partner update still 200 |
| A3 | Partial coverage only |

## Remaining NT chase (same day)

Probe: `probe-gamma-remaining-chase.js` → [REMAINING-CHASE-2026-11-25.md](./REMAINING-CHASE-2026-11-25.md)

| Case | Lounge | Fast Track | eSIM | Note |
|---|---|---|---|---|
| A1 / A2 / A4 | PASS | PASS | PASS | via update-booking proxy |
| C6 race | PASS | PASS | PASS | `PAYMENT_PROCESSING_CONFLICT` |
| U1 | (prior) | PASS | PASS | |
| L2 / L4 / L7 | — | — | — | PASS (history BR path) |
| W2 fail-sim | CHECK | CHECK | CHECK | `X-Simulate-Failure` ignored |
| C13 | NT | NT | NT | PI always `succeeded` (no uncaptured) |
| W8 / C12 | NT | NT | NT | no offerId |
| W3 / W7 / V8 / L3 | NT | NT | NT | need Dev/ops |

**Chase counts:** 17 PASS · 0 BUG · 3 CHECK · 19 NT

## Still NOT TESTED (need Dev/ops)

W3 low balance · W7 wallet disabled · W8/C12 real offer · C13 uncaptured auth · V8 offer down · L3 old payment webhook

## Verdict

**PASS for gamma B2B + SMT card happy path** — 0 product bugs for signoff scope.  
Same V4 CHECK stance as [FINAL-GAMMA-REPORT.md](./FINAL-GAMMA-REPORT.md) (24 Nov). Remaining chase cleared A*/C6/U1/L2/L4/L7.

### Artifacts
- `full-matrix-2026-11-25.json` / `FULL-CHANGELOG-REPORT-2026-11-25.md`
- `remaining-nt-2026-11-25.json` / `REMAINING-NT-REPORT-2026-11-25.md`
- `remaining-chase-2026-11-25.json` / `REMAINING-CHASE-2026-11-25.md`
- `collection-bookings-latest.json`
- `w7-wallet-disabled-latest.json`
- run logs `*-run-2026-11-25*.log`
