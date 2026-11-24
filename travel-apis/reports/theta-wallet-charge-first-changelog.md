# Theta wallet charge-first changelog — live results

- Ran: 2026-11-18 (API + wallet activity)
- Base: `https://theta-api.travelvip.ai`
- Partner: `vgm` · tier `10546901` (api-staging creds)
- Wallet start available: **₹809,106.52** · end ~**₹737,703** (G/I left charged; F holds reserved; A cancel refunded)
- Probe: `travel-apis/scripts/probe-theta-wallet-charge-first-changelog.js`
- Raw JSON: `travel-apis/reports/theta-wallet-charge-first-changelog.json`

**Overall (rescored after retries):** API surface **PASS-heavy on Cab + Hotel sim cases**; **Flight blocked**; a few product **BUGs**.

| Area | PASS | BUG | NOT TESTED |
|------|------|-----|------------|
| Flight | E F C H A G I J(+1.5) **D** (pending recheck PASS) | — | B, K |
| Hotel | E, F*, C, H, A†, G†, I†, J† | D (null BR) | B, K, DB |
| Cab | E, F*, C, H, A, D, G, I | J (status/cancel HTTP 500) | B, K, DB |
| Mattermost E–I | Hotel+Cab all matched | 0 | Flight |

\* F: available drops while hold is retained — expected per changelog (expires ~15m).  
† Hotel A/G/I/J confirmed on **retry** with PAN name `Rohan Bhagat` (unique last names broke supplier PAN check).  
Mattermost: `critical-partner-alerts-dev` · dump `theta-wallet-mattermost-alerts.json`.

---

## Flight

**Unblocked** with user route **DEL → PNQ** · **2026-12-27** (OW). Other metros still `VENDOR_ERROR`. Full score: `theta-wallet-charge-first-changelog-flight-delpnq.md`.

| Case | Verdict | BR / evidence |
|------|---------|---------------|
| E | **PASS** | 502 `WALLET_COMMIT_FAILED`; balance unchanged |
| F | **PASS** | 502; hold retained (−₹5983 available) |
| C | **PASS** | 502 `TICKET_ISSUANCE_FAILED`; refund SUCCESS + walletTxnId |
| H | **PASS** | `BR1794997429614414` Confirmed; charged |
| A | **PASS** | `BR1794997435876435` Confirmed; charged |
| D | **PASS** (recheck) | `BR1795000063318051` stayed **Pending** across 8 polls under `provider_no_response` (earlier BUG Confirmed on same sim — now holds). Wallet charged; no refund. |
| G | **PASS** | refund FAILED / no walletTxnId; still charged |
| I | **PASS** | refund FAILED; still charged |
| J + §1.5 | **PASS** | Cancel A Success → Cancelled; wallet **+₹4619.70** |
| B / K | NOT TESTED | low-balance / Stripe |

Also: RT search smoke DEL–PNQ **27→29 Dec** returned options (matrix books used OW 27 Dec).

---

## Hotel

| Case | Header | Verdict | BR / evidence |
|------|--------|---------|---------------|
| E | `wallet_commit_fail` | **PASS** | HTTP 502 `WALLET_COMMIT_FAILED`; balance unchanged |
| F | `wallet_commit_fail,wallet_release_fail` | **PASS** | HTTP 502 `WALLET_COMMIT_FAILED`; available −₹11,153.32 (hold retained; `reserved` rose) |
| C | `provider_reject` | **PASS** | `BR1794987285553305` FAILED; `refund.status=SUCCESS` amount 11153.32 + walletTxnId; balance restored |
| H | `wallet_debit_record_fail` | **PASS** (API) | `BR1794987290959353` booked then supplier Failed (PAN name); wallet charged. Alert / missing payment row = DB NOT TESTED |
| A | (none) | **PASS** (retry) | `BR1794987630902074` → **Confirmed** (lead+PAN `Rohan Bhagat`) |
| D | `provider_no_response` | **BUG** | HTTP 200 `status:Pending` but **`bookingRefId: null`** twice — cannot webhook/track. Changelog expects PENDING booking + real supplier book |
| G | `provider_reject,wallet_refund_fail` | **PASS** (retry) | `BR1794987522262492` FAILED; `refund.status=FAILED`, walletTxnId null; still charged |
| I | `provider_reject,wallet_debit_record_fail` | **PASS** (retry) | `BR1794987546766716` FAILED; `refund.status=FAILED`, walletTxnId null |
| J | cancel Confirmed A | **PASS** (retry) | Cancel `BR1794987630902074` HTTP 200 Success; refund ₹11,153.32 |
| B / K | — | **NOT TESTED** | no low-balance partner / no card path this run |

### Hotel notes
- Case C returned HTTP **200** with `status: FAILED` (changelog text mentioned statusCode 400). G/I use `statusCode: 400` on the body.
- First-batch A/D/G/I returned bare HTTP **500** with empty body under rapid load — treat as flake unless it reproduces; retries succeeded for A/G/I.
- Unique last names + PAN `EUIPB1672M` → supplier reject *"Pan car…"* after wallet charge. Use **Rohan Bhagat** for Confirmed hotel books.

---

## Cab

| Case | Header | Verdict | BR / evidence |
|------|--------|---------|---------------|
| E | `wallet_commit_fail` | **PASS** | HTTP 502 `WALLET_COMMIT_FAILED`; balance unchanged |
| F | `wallet_commit_fail,wallet_release_fail` | **PASS** | HTTP 502; available −₹640.50 (hold retained) |
| C | `provider_reject` | **PASS** | `BR1794987359899598` FAILED; refund SUCCESS 640.5 + walletTxnId |
| H | `wallet_debit_record_fail` | **PASS** | `BR1794987375501526` PENDING; charged |
| A | (none) | **PASS** | `BR1794987402323818` / retry `BR1794987588574703` PENDING; charged |
| D | `provider_no_response` | **PASS** | `BR1794987430226336` PENDING; charged; no refund |
| G | `provider_reject,wallet_refund_fail` | **PASS** | `BR1794987458712474` FAILED; `refund.status=FAILED`, walletTxnId null; still charged |
| I | `provider_reject,wallet_debit_record_fail` | **PASS** | `BR1794987473835079` FAILED; refund FAILED; still charged |
| J | cancel | **BUG** | All status/cancel paths for cab BRs return **HTTP 500** with empty body (`/cabs/{br}/status`, `/cabs/bookings/{br}/status`, GET/POST cancel) |
| B / K | — | **NOT TESTED** | |

### Cab notes
- Finalize + wallet sim headers work. Post-book **status/cancel are broken on theta** (500).
- Skip user_actions / sales-summary per changelog (not checked).

---

## Mattermost — Cases E–I (`critical-partner-alerts-dev`)

All alerts: header **DEV**, partner **Vouchagram Partner (vgm)**, Service never `-`, Source **Booking (finalize)**.

| Product | Case | Expected alert(s) | BR | Mattermost | Verdict |
|---------|------|-------------------|----|------------|---------|
| Hotel | E | Commit Failed (warning); Hold Released Yes; Provider Called No | BR1794987275429952 | ⚠️ Commit Failed · Hold Released **Yes** · Provider Called **No — booking aborted** · Commit Error present | **PASS** |
| Hotel | F | Commit+Release Failed (critical) only — no Commit Failed | BR1794987280342725 | 🚨 Commit and Release Failed · Provider Called No · Commit+Release Error · **no** separate Commit Failed | **PASS** |
| Hotel | C | none (successful refund) | BR1794987285553305 | no post | **PASS** |
| Hotel | H | Payment Record Missing (warning); Wallet Charged Yes | BR1794987290959353 | ⚠️ Payment Record Missing · Wallet Charged **Yes** | **PASS** |
| Hotel | G | Refund Failed (critical) | BR1794987522262492 | 🚨 Refund Failed · 11153.32 INR | **PASS** |
| Hotel | I | Payment Record Missing + Refund Skipped | BR1794987546766716 | ⚠️ Missing + 🚨 Refund Skipped | **PASS** |
| Cab | E | Commit Failed (warning) | BR1794987329360718 | ⚠️ Commit Failed · Hold Released Yes · Provider Called No | **PASS** |
| Cab | F | Commit+Release Failed only | BR1794987344402250 | 🚨 Commit and Release Failed · no Commit Failed twin | **PASS** |
| Cab | C | none | BR1794987359899598 | no post | **PASS** |
| Cab | H | Payment Record Missing | BR1794987375501526 | ⚠️ Payment Record Missing · Wallet Charged Yes | **PASS** |
| Cab | G | Refund Failed | BR1794987458712474 | 🚨 Refund Failed · 640.50 INR | **PASS** |
| Cab | I | Missing + Refund Skipped | BR1794987473835079 | ⚠️ Missing + 🚨 Refund Skipped | **PASS** |
| Flight | E–I | — | — | **NOT TESTED** (search down) | — |

Extra (pre-matrix smoke): BR1794987264197187 also got Wallet Commit Failed — ignore for case scoring.

---

## Not tested (all products)

| Check | Why |
|-------|-----|
| Case B `INSUFFICIENT_BALANCE` | Need a low-balance partner |
| Case K card/Stripe | **NOT TESTED** — see `theta-case-k-card-stripe.md`. Changelog: web Stripe unchanged; card-paid flight no-answer still failure; non-wallet partners unaffected; no alert on success book/refund. Blocked: only `vgm` wallet creds; no shop/Stripe/non-wallet partner. |
| DB payment/txn/refund/user_actions | **Hotel + Cab cases scored PASS** — see DB section below |
| Case D webhook finish (CONFIRMED / FAILED / refund-fail) | **Still NOT TESTED** — see Case D recheck below |
| Flight cancel wallet credit (1.5) | Flight search down |

---

## DB checks (phpMyAdmin travelx — live)

| Case | BR | booking/item | DB verdict | Notes |
|------|-----|--------------|------------|-------|
| Hotel C | BR1794987285553305 | 5190 / 5293 | **PASS** | FAILED; payment refunded; CAPTURE+REFUND; refund completed SOURCE; ua payment_success→booking_failed; sales paid=total due=0 |
| Hotel E | BR1794987275429952 | 5188 / 5291 | **PASS** | FAILED; no payment/refund/ua |
| Hotel G | BR1794987522262492 | 5206 / 5309 | **PASS** | payment stays captured; CAPTURE only; no refund_txn; ua payment_success→booking_failed |
| Hotel I | BR1794987546766716 | 5207 / 5310 | **PASS** | no payment/refund; ua still payment_success→booking_failed |
| Hotel H | BR1794987290959353 | 5191 / 5294 | **PASS** | no payment; ua payment_success→booking_submit_success (+ later booking_failed from PAN) |
| Hotel A+J | BR1794987630902074 | 5210 / 5313 | **PASS** | captured→refunded; CAPTURE+REFUND; refund completed SOURCE; ua payment_success→booking_submit_success→booking_confirmed→booking_cancelled |
| Hotel F | BR1794987280342725 | 5189 / 5292 | **PASS** | FAILED; no payment (same as E; hold-only difference is wallet/Mattermost) |
| Cab C | BR1794987359899598 | 5198 / 5301 | **PASS** | refunded; CAPTURE+REFUND; refund completed SOURCE; item status_mapping NULL (soft) |
| Cab G | BR1794987458712474 | 5202 / 5305 | **PASS** | stays captured; CAPTURE only; no refund_txn |
| Cab I | BR1794987473835079 | 5203 / 5306 | **PASS** | no payment/refund rows |
| Cab E | BR1794987329360718 | 5196 / 5299 | **PASS** | no payment/refund |
| Cab F | BR1794987344402250 | 5197 / 5300 | **PASS** | no payment/refund |
| Cab H | BR1794987375501526 | 5199 / 5302 | **PASS** | no payment/refund |
| Cab A | BR1794987402323818 | 5200 / 5303 | **PASS** | captured · CAPTURE · no refund |
| Cab D | BR1794987430226336 | 5201 / 5304 | **PASS** | captured · CAPTURE · no refund (PENDING path) |

Schema notes: history has no `status` (use `status_mapping_id`); `user_actions` keyed by `action_id`=BR; `refund_transaction` has `booking_item_id`.

---

## Case D recheck (2026-11-18 ~15:15 IST) — webhook finish

| Check | Verdict | Evidence |
|-------|---------|----------|
| Hotel D finalize `provider_no_response` | **BUG** | 3/3 → HTTP 200 `status:Pending` **`bookingRefId: null`** (corr `6ad59eb0-cd40-4624-9121-06775670077d`) |
| Cab D finalize | **PASS** | `BR1794995178921937` PENDING (also prior `BR1794987430226336`) |
| Cab status API | **BUG** | Both BRs: `GET /cabs/{br}/status` + `/bookings/{br}/status` → **HTTP 500 null body** |
| Cab cancel API | **BUG** | Both BRs: GET+POST `/bookings/{br}/cancel` (+ bare `/cabs/{br}`) → **HTTP 500 null body** |
| Webhook finish → CONFIRMED | **NOT TESTED** | Blocked: hotel null BR; cab cannot poll status; no `CAB_WEBHOOK_*` |
| Webhook finish → FAILED + refund | **NOT TESTED** | Same blockers |
| Webhook finish → FAILED + refund-fail | **NOT TESTED** | Same blockers |
| Cab `partner-webhook` auth gate | shape OK | no-auth / bad-auth → 401 `INVALID_WEBHOOK_CREDENTIALS` (cannot inject CONFIRMED/FAILED without creds) |

Raw: `travel-apis/reports/theta-case-d-webhook-recheck.json`

## Bugs to raise / confirm

1. **Flight search on theta** — most metros `VENDOR_ERROR`; **DEL–PNQ works**. Prefer that route until supplier fixed.
2. **Hotel Case D** — `provider_no_response` returns Pending with **null `bookingRefId`** (**reconfirmed 3/3**).
3. **Cab status + cancel** — HTTP 500 empty body for valid wallet BRs including fresh Case D `BR1794995178921937` (blocks Case J + webhook follow-up).
4. *(Soft)* Hotel Case C HTTP 200 vs documented statusCode 400 — confirm intended contract.
5. *(Resolved)* Flight Case D — recheck **PASS** `BR1795000063318051` stayed Pending (`theta-flight-case-d-pending-recheck.json`). Webhook finish CONFIRMED/FAILED still NOT TESTED.

---

## Ops follow-up

- Top up **vgm** wallet for Cases **G** and **I** (hotel + cab) — money intentionally not refunded.
- Case **F** holds (~₹11,793 reserved) should expire ~15 minutes.
- Cancel leftover PENDING cab books once status/cancel is fixed (or via admin/supplier).
- Hotel Confirmed cancel for J already done on `BR1794987630902074`.
