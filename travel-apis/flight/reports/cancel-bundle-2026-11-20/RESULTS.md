# Cancel Bundle — Nexus + partner results (2026-11-20)

**API:** `https://ak-api.travelvip.ai` · partner `vgm` · route **DEL↔PNQ** sim only  
**Nexus:** `https://dev-nexus.travelvip.ai` · Superadmin Rohan Bhagat  

Wallet topped up ~18:00 IST — RT books resumed. Latest fixtures: `fixtures.json` (Batch C ~12:32Z).

## Ops online / offline / desk

| TC | BR | Status | Evidence |
|----|----|--------|----------|
| **B1** OW all-pax online | `BR1795175943421935` | **PASS** | #126 · Refunded ₹4,969.70 · ADMIN |
| **B2** RT 2-PNR online | `BR1795175949819362` | **PASS*** | #127+#128 · G3 watch · #128 unpaid |
| **B2 recheck / G3** | `BR1795177933483097` | **PASS / G3 BUG** | #140+#141 Cancelled · **Convenience ₹350 on each** · #141 still **Refund not paid yet** · #140 also shows **Other deductions ₹252** |
| **B3** untick → offline | `BR1795175950342953` | **PASS** | Raise offline |
| **B4** open blocks online | `BR1795175952747196` / recheck `BR1795177936898217` #142 | **PASS** | Warning while open · after refuse unlocks |
| **B7** stale page | `BR1795176756105306` | **PASS** | HTTP **409** online-cancel stale |
| **C1** offline both / one PNR | `BR1795175950342953` / recheck `BR1795177935264777` #143 | **PASS*** | Refund ₹7,843 · banner **BUG** |
| **C2 / C3** | `BR1795176758889392` | **PASS** | #135 PAX1 only · UI blocks re-raise |
| **D1–D7** | (see prior rows) | **PASS*** | D6 Short by ₹187.50 on #122 · D3 override · D7 no high/low |
| **H3** older booking | `BR1795084333109554` | **PASS*** | Loads · Pending · no Cancel |

## Display / list / math

| TC | Status | Evidence |
|----|--------|----------|
| **E1–E3** | **PASS** | No empty SSR · Fare Corporate · timeline |
| **E4** | **PASS*** | 2nd PNR often **Refund not paid yet** (B2 / B2-recheck) |
| **G1** | **PASS** | Fare share ₹4,708 after prior settle |
| **G3** | **BUG** | Confirmed twice: convenience ₹350 × **both** online RT requests (booking only has ₹350) |
| **H1** | **PASS*** | List filters / CSV / sort present |

## Partner API F + duplicate

| TC | BR | Status | Evidence |
|----|----|--------|----------|
| **F1–F3** | `BR1795175947533723` | **PASS** | Structure + wallet refund completed |
| **F4** partner mismatch | — | **NOT TESTED** | No second partner in `.env` / Postman envs |
| **Duplicate-guard (API)** | `BR1795177930648305` | **PASS** | Parallel CANCEL → 1× Success + **`DUPLICATE_IN_PROGRESS`** (`duplicate:true`) |
| **Double raise-offline** | `BR1795177936898217` | **PASS*** | Double-click → 200 recorded + **422** “unrecognised result” (not clean 409; only **#142** open) |

## Bugs

1. Desk banner: “all N still travelling” after settle while cells Cancelled.
2. **G3** convenience kept once per PNR on RT online cancel (expect ≤ ₹350 / booking).
3. B4 multi-raise / double-submit window (422 unknown vs 409).
4. 2nd-PNR wallet refund lag (**Refund not paid yet**) after online RT cancel.

## Later pass (post top-up)

| TC | BR | Status | Evidence |
|----|----|--------|----------|
| **D1+D2 recheck** | `BR1795177936898217` #142+#145 | **PASS*** | ₹3,921.50 + ₹3,921.50 = **₹7,843** · banner **BUG** |
| **G3 partner sequential** | `BR1795176756105306` return `SIM-AR08FS` | **BUG** | After onward already cancelled, return CANCEL still `convenienceFee: 350` |
| **H1 Export** | flights list | **PASS*** | **Export** button present (download event not captured in automation) |
| **B5** refuse→desk | spare OW online | **NOT TESTED** | Sim succeeds online (`BR1795177931571781` #147 Refunded) — need Dev refuse-PNR |
| **E4 recheck** | `BR1795177933483097` #141 | **see pending re-run** | Unpaid cleared; money gap / G3 still open |

## Pending re-run (2026-11-20 ~19:00 IST)

| TC | BR / setup | Status | Evidence |
|----|------------|--------|----------|
| **E4 recheck** | `BR1795177933483097` #140+#141 | **PASS → G3 money BUG** | Both now **Credited to wallet** (unpaid lag cleared). Booking fully cancelled · MONEY **Doesn't add up** · **Unaccounted ₹9,668.00** · both refunds **Doesn't match breakup** · convenience **₹350 on each** (#141 Over by ₹602). Shot: `screenshots/cancel-pending-e4-g3-money.png` |
| **B5** | spare `BR1795178259149288` | **STILL BLOCKED** | Still Confirmed · Cancel dialog online available · copy says refuse→offline desk auto, but **no Dev refuse-PNR** — did **not** cancel (would succeed on sim). Shot: `screenshots/cancel-pending-spare-dialog.png` |
| **B6** | stuck online >10m | **STILL BLOCKED** | No stuck online request in desk list · **Move to offline desk** not on `/cancellations` or spare dialog · `/cancellations/online-cancel/recover` empty shell |
| **F4** | `PARTNER_ID_2` | **STILL BLOCKED** | Missing from `.env` + all Postman envs (`pending-f4-probe.json`) |
| **G2** | coupon book | **STILL BLOCKED** | No coupon/promo path in flight client / issue payload |
| **H2** | role **Rohan Test Role (Release Test)** · #101 `BR1795090713905455` | **PASS** | View settle OK · **You have view-only access to settlements** · **Review settlement** disabled · no settle action. Shot: `screenshots/cancel-h2-view-only-settle.png` |
| **A1** | `travelx_migration_testing` + `travelx` | **PASS*** | testing DB: all 4 versions in `migration_versions_v2` + columns present. **travelx** missing `20261118130000` / `estimated_breakdown` / `fare_family`+`vendor_fare_*` (see A1 note below) |

## Still blocked (need Dev / extra setup)

| TC | Why |
|----|-----|
| **B5 / B6** | Simulator refuse-PNR / stuck online >10m (“Move to offline desk”) |
| **H2** | ~~Role without `settle.cancellation`~~ → **PASS** (see pending re-run) |
| **G2** | No working coupon path in pack (issue payload rejects ad-hoc coupon fields) |
| **A1** | ~~Migrations~~ → **PASS*** on `travelx_migration_testing`; **travelx** gap (no `20261118130000`) |
| **Duplicate-guard TC-01…08,13** | Spec doc not in this repo / GitHub 404 |
| **F4** | Second partner credentials (`PARTNER_ID_2` / `PARTNER_SECRET_2`) |

## Spares

| BR | Type | Notes |
|----|------|-------|
| `BR1795178259149288` | OW | accidental baseline from G2 probe — Confirmed |
| `BR1795177370162842` / `BR1795177368195446` | OW | earlier |
