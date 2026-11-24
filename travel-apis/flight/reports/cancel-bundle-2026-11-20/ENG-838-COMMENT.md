## Flight Cancellation Bundle V2 — QA results

**@Akshay Kanchan**

| | |
|---|---|
| **Tested** | **20 Nov 2026** (IST) · recheck evening same day |
| **Posted** | **23 Nov 2026** |
| **API** | `ak-api.travelvip.ai` · partner **vgm** · DEL↔PNQ sim |
| **Nexus** | `dev-nexus.travelvip.ai` |
| **Plan** | `QA_Plan_Flight_Cancellation_Bundlev2.md` |

Bugs already raised on channel — coverage only below.

| TC | What | Status | Evidence / block reason |
|----|------|--------|-------------------------|
| **A1** | Migrations (fare type, actor_ref, fare family, estimated_breakdown) | **PASS** | 20 Nov · `travelx_migration_testing.migration_versions_v2`: `20261015120000`, `20261030120000`, `20261118120000`, `20261118130000` + columns. *Live `travelx` still missing `20261118130000` / `estimated_breakdown`.* |
| **A2** | Code without migrations (scratch only) | **NOT TESTED** | Scratch env not in scope |
| **B1** | OW all-pax online cancel | **PASS** | 20 Nov · `BR1795175943421935` · #126 Refunded |
| **B2** | RT 2-PNR online cancel | **PASS** | 20 Nov · `BR1795175949819362` / `BR1795177933483097` · #140+#141 |
| **B3** | Untick → offline raise | **PASS** | 20 Nov · `BR1795175950342953` |
| **B4** | Open request blocks online | **PASS** | 20 Nov · `BR1795175952747196` / `BR1795177936898217` |
| **B5** | Airline refuse online → desk | **NOT TESTED** | Need Dev refuse-PNR; sim always succeeds. Spare: `BR1795178259149288` |
| **B6** | Stuck online → Move to offline desk | **NOT TESTED** | Need stuck online cancel >10m; no stuck request / CTA |
| **B7** | Stale page online cancel | **PASS** | 20 Nov · `BR1795176756105306` · HTTP **409** |
| **C1** | Offline one PNR both pax | **PASS** | 20 Nov · `BR1795177935264777` #143 · refund ₹7,843 |
| **C2** | Offline some pax one PNR | **PASS** | 20 Nov · `BR1795176758889392` #135 PAX1 only |
| **C3** | Re-raise already-covered pax | **PASS** | 20 Nov · UI/API blocks re-raise |
| **D1–D7** | Desk settle / refuse / override / math | **PASS** | 20 Nov · incl. `BR1795177936898217` #142+#145 |
| **E1–E3** | Display: SSR / fare type / timeline | **PASS** | 20 Nov · Fare · Corporate; no empty SSR |
| **E4** | 2nd-PNR refund / wallet settle | **PASS** | 20 Nov · `BR1795177933483097` #140+#141 Credited (lag cleared on evening recheck) |
| **F1–F3** | Partner cancel API + wallet refund | **PASS** | 20 Nov · `BR1795175947533723` |
| **F4** | Partner mismatch | **NOT TESTED** | No `PARTNER_ID_2` / `PARTNER_SECRET_2` |
| **G1** | Fare share after prior settle | **PASS** | 20 Nov · fare share ₹4,708 |
| **G2** | Coupon / discounted cancel cap | **NOT TESTED** | No working coupon path on issue/book |
| **G3** | Convenience fee once per booking | **PASS** | 20 Nov · executed (issue raised separately on channel) |
| **H1** | List filters / export | **PASS** | 20 Nov · filters + Export present |
| **H2** | Role without settle permission | **PASS** | 20 Nov evening · Rohan Test Role (Release Test) · #101 view-only |
| **H3** | Older / pending booking | **PASS** | 20 Nov · `BR1795084333109554` |
| **Duplicate-guard (smoke)** | Parallel cancel de-dupe | **PASS** | 20 Nov · `BR1795177930648305` · Success + `DUPLICATE_IN_PROGRESS` |
| **Duplicate-guard TC-01…08,13** | Full matrix from spec | **NOT TESTED** | Spec `docs/cancellation-duplicate-guard-qa.md` not in repo / 404 |

### Pending (need Dev / setup)
| Need | Unblocks |
|------|----------|
| Simulator refuse-PNR | B5 |
| Stuck online cancel (>10m) | B6 |
| Second partner creds | F4 |
| Coupon book path | G2 |
| Duplicate-guard QA doc | TC-01…08,13 |
| Apply `20261118130000` on live `travelx` (optional) | A1 parity with testing DB |
