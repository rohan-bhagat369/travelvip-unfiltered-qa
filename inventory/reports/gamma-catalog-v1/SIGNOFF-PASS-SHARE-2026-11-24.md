# ENG-826 catalog_v1 — Signoff PASS share (gamma)

**Env:** `https://gamma-api.travelvip.ai` · **Partner:** `vgm` (B2B) + `smt` (Web/card)  
**Date:** 2026-11-24 (matrix) · W7 from 2026-11-23 (wallet disabled)  
**Inventory:** Lounge Marhaba `ol0oanfxamjcbjhkodvy` · Apidog: `B2B_Dev_vgm` + `Web_Dev_smt`  
**Open bugs:** none (V4 = CHECK — offers not implemented on Dev vgm yet)

## Signoff PASS cases (single table)

| Case | What we tested | Lounge | Fast Track | eSIM | Evidence / note |
|---|---|---|---|---|---|
| **W1** | Wallet finalize happy path | PASS | PASS | PASS | BR1795506794185234 / BR1795506839495541 / BR1795506891597424 |
| **W4** | Missing `X-Partner-Key` → reject | PASS | PASS | PASS | `MISSING_HEADER` |
| **W6** | Currency mismatch → reject | PASS | PASS | PASS | `CURRENCY_MISMATCH` |
| **W7** | Wallet disabled → reject | PASS* | PASS* | PASS* | *2026-11-23 while wallet off → `WALLET_UNAVAILABLE` (wallet on again today) |
| **R1** | Status poll after book | PASS | PASS | PASS | Same BR as W1 |
| **R2** | Booking details | PASS | PASS | PASS | Same BR as W1 |
| **R3** | Booking history | PASS | PASS | PASS | List OK |
| **C1** | create-booking + Stripe PI | PASS | PASS | PASS | BR1795506815557699 / BR1795506869472048 / BR1795506914806511 |
| **C2** | Stripe confirm → booking | PASS | PASS | PASS | Same BR as C1 (eSIM C2 fixed vs 23-Nov) |
| **C3** | Webhook-only completion (no booking call) | PASS | PASS | PASS | BR1795506953332784 / BR1795506987289531 / BR1795507025562110 |
| **C5** | Paid booking path | PASS | PASS | PASS | BR1795506949140574 / BR1795506983733986 / BR1795507021725943 |
| **C7** | Unknown payment txn → reject | PASS | PASS | PASS | `PAYMENT_TRANSACTION_NOT_FOUND` |
| **C8** | Bad payment payload → reject | PASS | PASS | PASS | `VALIDATION_ERROR` |
| **C9** | Fake PI → reject | PASS | PASS | PASS | `PAYMENT_TRANSACTION_NOT_FOUND` |
| **C10** | Cross-product / wrong payment | PASS | PASS | PASS | `PAYMENT_TRANSACTION_NOT_FOUND` |
| **C11** | Invalid payment reuse | PASS | PASS | PASS | `PAYMENT_TRANSACTION_NOT_FOUND` |
| **U1** | Update on Confirmed/Pending path | PASS | PASS | PASS | Lounge e.g. BR1795506794185234 |
| **U2** | Update → CANCELLED | PASS | PASS | PASS | BR1795506944413961 / BR1795506975749899 / BR1795507015795621 |
| **U3** | Update status path | PASS | PASS | PASS | BR1795506945730597 / BR1795506977999259 / BR1795507016748911 |
| **U4** | Idempotent / repeat update | PASS | PASS | PASS | BR1795506946778998 / BR1795506978405280 / BR1795507018854457 |
| **U5** | Update allowed transition | PASS | PASS | PASS | BR1795506947363288 / BR1795506980618609 / BR1795507019948103 |
| **U6** | Bad update payload → reject | PASS | PASS | PASS | `VALIDATION_ERROR` |
| **U7** | Unknown BR update → reject | PASS | PASS | PASS | `BOOKING_NOT_FOUND` |
| **U8** | Partner check on update | PASS | — | — | Lounge PASS BR1795506948236905 (FT/eSIM = CHECK, not signoff block) |
| **V1** | Invalid passenger / required fields | PASS | PASS | PASS | `VALIDATION_ERROR` |
| **V2** | Bad bookingContext | PASS | PASS | PASS | `INVALID_BOOKING_CONTEXT` |
| **V3** | Tampered / undecryptable context | PASS | PASS | PASS | `INVALID_BOOKING_CONTEXT` |
| **V6** | No lead passenger | PASS | PASS | PASS | `VALIDATION_ERROR` |
| **V7** | Past travelDate | PASS | PASS | — | `VALIDATION_ERROR` (eSIM N/A) |
| **I3** | Non-identical replay not treated as same | PASS | PASS | PASS | Distinct behaviour OK |
| **L1** | Old catalog option reject (new flow) | PASS | PASS | PASS | Option not in catalog / 400 |
| **L5** | Old booking list | — | — | — | PASS (old/other) |
| **L6** | Missing serviceType on old | — | — | — | PASS `serviceType is required` |
| **L8** | Legacy partner key accepted | PASS | PASS† | PASS | Legacy `ojny1swtigd4as` · †FT immigration PASS |

## Apidog collection (also PASS for signoff)

| Flow | Lounge | Fast Track |
|---|---|---|
| W1 finalize (B2B collection body) | PASS `BR1795506790511647` | PASS `BR1795506792886180` |
| C1 → Stripe → C2 (omit stale offerId) | PASS `BR1795507084160278` | PASS `BR1795507102172771` |

Note: env `offer_id=10558702` on create-booking → `OFFER_INVALID` (stale). Happy path PASS when `offerId` omitted. Offers not implemented on Dev vgm B2B yet.

## Signoff verdict

| Item | Status |
|---|---|
| Wallet book + read (W1, R1–R3) | PASS |
| Card create + pay + book (C1, C2, C5) | PASS |
| Webhook completion (C3) | PASS |
| Wallet disabled (W7) | PASS (23-Nov) |
| Validations / negatives (W4/W6, V*, C7–C11, U6/U7) | PASS |
| Updates (U1–U5) | PASS |
| Legacy key / old list (L1/L5/L6/L8) | PASS |
| **Open bugs** | **None** |
| V4 invalid offerId | CHECK — offers not on Dev vgm yet; not a blocker |

**QA recommendation:** gamma catalog_v1 Lounge + Fast Track + eSIM **OK to sign off** for covered cases above. Remaining NT/CHECK are env/ops or product-call items (low-balance, fail-sim, 100% offer, supplier control, idempotency rules), not open defects.
