## QA Plan: Flight Cancellation Bundle (V2)

**Source:** Akshay Kanchan · Nov 20, 2026 · `QA_Plan_Flight_Cancellation_Bundlev2.md`

### Testing window
| | |
|---|---|
| **Suite executed** | **20 Nov 2026** (IST) — Nexus + partner API on ak-api · DEL↔PNQ sim |
| **Pending recheck / H2 / A1 DB** | **20 Nov 2026** evening (~19:00 IST) |
| **Results posted on ENG-838** | **23 Nov 2026** |
| **Tester** | Rohan Bhagat |

### Scope
This release must pass cases **A–H** below, plus the **duplicate-guard** regression (TC-01 … TC-08 and TC-13 in `docs/cancellation-duplicate-guard-qa.md`), before production.

| | |
|---|---|
| **Dashboard** | `https://dev-nexus.travelvip.ai` |
| **API** | `https://ak-api.travelvip.ai` |
| **Partner** | vgm |
| **PRs** | travelx-ai/gmr-server-php#296 · travelx-ai/nexus#86 |
| **Branch** | `staging/akshay-flight-bundle-2026-10-30` |

### What changed
| Area | What changed |
| --- | --- |
| Ops online cancel | Ops cancel a whole journey online from the booking page: one request per live PNR, in travel order. A PNR the airline can't cancel online becomes an offline desk request. |
| Ops raise offline | Ops raise an offline request for part of a journey (one PNR of a round trip) or some passengers of a PNR. |
| Split settlement | At the desk, "Cancelled some": the airline cancels some passengers and refuses others. Every fee line is scaled to the passengers cancelled. |
| Refund math | Online refunds no longer withhold the convenience or flexi fee twice. Discounted bookings are capped at what was paid. Quotes after an earlier settlement are priced from the original sale. |
| Display | Seats, meals, baggage and trip protection; fare type and fare family; a merged activity feed. "Refunded" shows only when the refund was paid. |
| Safety | Online cancel is blocked while a cancellation is open. "Move to offline desk" recovers a stuck online cancel. Interrupted cancels answer with their real state instead of a 500. |
| Bookings list | Date range picker, sortable columns, CSV export, query bar. |

### Rules the build must hold to
1. Online cancellation is whole-journey only. Anything partial (some passengers, or one PNR of several) goes offline.
2. The API cancels one PNR per request: a round trip with two PNRs produces two requests.
3. No passenger is charged another passenger's fees, and no fee is withheld twice across requests on one booking.
4. A refund never exceeds what the customer paid.
5. The partner API response structure is unchanged. Only values change, and only as listed in section G.

### Test cases (suite outline)
- **A. Deployment** — A1 migrations (fare type, actor_ref, fare family, estimated_breakdown) · A2 code without migrations (scratch only)
- **B. Ops online cancel** — B1 OW all-pax · B2 RT 2-PNR · B3 untick→offline · B4 open blocks online · B5 airline refuse→desk · B6 stuck→Move to offline desk · B7 stale page
- **C. Ops raise offline** — C1 one PNR both pax · C2 some pax · C3 already-covered refused
- **D. Desk settlement** — D1 Cancelled some · D2 refused later · D3 overrides · D4 Cancelled all · D5 Refused · D6 historical #122 shortfall · D7 quote sanity
- **E. Display** — E1 ancillaries · E2 fare type/family · E3 activity feed · E4 Refunded vs not paid yet
- **F. Partner API** `/api/v2/flight/cancel` — F1 structure · F2 values · F3 wallet refund · F4 partner mismatch
- **G. Refund math** — G1 quote after settle · G2 coupon cap · G3 convenience once per booking
- **H. List / perms / older** — H1 bookings list · H2 permissions · H3 older booking
- **Duplicate-guard** — TC-01 … TC-08 and TC-13

### Sign-off checklist
- [x] A1 migrations *(tested 20 Nov 2026 — PASS* on `travelx_migration_testing`)*
- [x] B1–B4, B7 online cancel *(20 Nov 2026)* — B5/B6 NOT TESTED
- [x] C1–C3 raise offline *(20 Nov 2026)*
- [x] D1–D7 settlement *(20 Nov 2026)*
- [x] E1–E4 display *(20 Nov 2026)*
- [x] F1–F3 partner API *(20 Nov 2026)* — F4 NOT TESTED
- [x] G1, G3 refund math *(20 Nov 2026)* — G2 NOT TESTED
- [x] H1–H3 list, permissions, older bookings *(20 Nov 2026; H2 evening)*
- [ ] Duplicate-guard regression: TC-01 … TC-08 and TC-13 *(smoke only 20 Nov 2026; full matrix NOT TESTED)*
- [x] Wallet balance movements spot-checked on money cases *(20 Nov 2026)*

### Known issues (don't file / don't block)
- Split settlement shares ancillaries by passenger count, not each passenger's own seats and meals.
- Card (Stripe) RT: 2nd PNR refund may show in progress (also on master).
- Raise offline re-check misses some older coverage (API still refuses).
- Older RTs without journey rows can't raise offline for return PNR.
- Offline-only booking with no passenger grid has no cancel-dialog path.
- Query bar breaks multi-value filters in quotes.
- ~1.2s window after success where cancel can be submitted twice.

**Full PASS / NOT TESTED scoreboard:** see Activity comment dated **23 Nov 2026**.
