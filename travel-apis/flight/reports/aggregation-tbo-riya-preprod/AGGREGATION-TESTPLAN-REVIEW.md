# Flights Multi-Vendor Aggregation (TBO + Riya) — Analysis & Test Plan (REVIEW)

**Status:** Analysis only — **no live calls yet** (awaiting your review)  
**Env:** `https://preprod-api.travelvip.ai`  
**Feature:** Merge TBO + Riya search results into one card when the same physical flight appears on both vendors  
**Sources:**
- `flights-aggregation-qa-tests__1_.md`
- `flights-how-results-are-combined.md`

---

## 1. Requirement understanding (plain words)

### What changed
On **merged tier `22101801`**, flight search calls **both TBO and Riya**, then combines results that are the **same physical flight** into **one option card**. Each fare keeps its vendor (`sourceCode`) and its own `searchId` for booking.

### Vendor codes
| `sourceCode` | Vendor |
|---|---|
| `402T` | TBO |
| `422R` | Riya |

### Tiers under test
| Tier ID | Vendors | Merge? |
|---|---|---|
| `22157551` | TBO only | No |
| `8` | Riya only | No |
| `15` | Riya only | No |
| `22101801` | TBO + Riya | **Yes** |

### When two results become one card
All segments must match (after normalisation):
- Flight number (ignore case/spaces/hyphens/leading zeros → e.g. `IX1391`)
- Dep airport + dep time (to the **minute**)
- Arr airport + arr time (to the **minute**)
- Cabin class  
ONWARD never merges with RETURN. Multi-city never merges. After onward selection, returns come from **one** vendor only.

### After merge
1. Cheaper result becomes the card base  
2. Other vendor’s fares are **appended** (none dropped)  
3. Card can show both `402T` and `422R`  
4. Displayed price = **min(fares[].pricing.totalAmount)** — merge can only make card **cheaper**, never dearer  
5. Booking uses the selected fare’s own `searchId` / provider  

### API under test (from QA doc)
```
POST /api/flights/catalog-v2/search
  ?pid={pid}&tierId={TIER}&subscriptionId={sub}&page=0&size=-1
Header: x-api-key: {key}
```
**Open question for you before run:** confirm this Mag/catalog path is live on **preprod-api** for the partner we will use (pack memory often uses B2B `POST /v1/flights/search`). We will not guess — confirm path + auth (x-api-key vs B2B Bearer) before automation.

### Doc routes / dates
- Intl: `DEL→DXB` · Dom: `DEL→BOM`
- Onward **+21d**, return **+28d**, 1 adult  
(We will **pin** these once per day for L2B — see §3.)

---

## 2. Risk analysis

| Risk | Why it matters | Priority |
|---|---|---|
| Round-trip merge never run before | Doc says highest risk | P0 |
| Mixed vendor codes on RETURN after selection | Cross-vendor RT not bookable | P0 |
| Empty `fares[]` on options | Unbookable cards | P0 |
| Display price > selectable fare | User shown wrong price | P0 |
| Single-vendor regression on tiers 8/15/22157551 | Merge must not break isolation | P0 |
| Booking wrong vendor / PNR fail on merged tier | Money path | P0 (manual / ALLOW_BOOK) |
| Duplicate schedule cards after merge | Merge key bug | P1 |
| Result-count sanity vs single tiers | Merge not happening or over-merging | P1 |
| Multi-city accidentally merged | Spec says never | P1 |
| Selection still merges | Spec: selection bypasses merge | P1 |
| Vendor down / timeout behaviour | Needs Dev simulate | P2 / NOT TESTED without Dev |
| Look-to-book blow-up | Preprod vendor cost | Process control |

---

## 3. Look-to-book (L2B) rules for this pack

Preprod must **not** spam unique OD+date searches.

| Rule | How we apply it |
|---|---|
| Pin OD | Only `DEL→BOM` and `DEL→DXB` |
| Pin dates | One onward / one return for the whole day (doc default +21 / +28, or env pin). **No date stepping loop** |
| Reuse searches | Same route+date reused across tiers 22157551 / 8 / 15 / 22101801 for count comparisons |
| Prefer search-only | Sections A–E, G–H = **no book** by default |
| Books gated | Section F only if you say `ALLOW_BOOK=true` — min books (1 Riya OW, 1 TBO OW, 1 RT) |
| Page wisely | Prefer `size=-1` or controlled paging; don’t invent extra ODs for paging |
| Cache reuse | Run tier comparisons back-to-back so vendor cache stays warm |
| Stop conditions | Inventory empty → NOT TESTED; `INSUFFICIENT_BALANCE` → abort books |

**Estimated unique looks (search-only day):**  
~2 ODs × 1 date pair × few journey shapes (OW + RT + optional MULTI_CITY) ≈ **small fixed set**, not hundreds.

---

## 4. Scope

### In scope
- Routing by tier (`sourceCode` isolation vs merge)
- Merge correctness (schedule key, display price, fare retention)
- OW + RT on merged tier (incl. selection behaviour)
- Single-vendor regression
- Multi-city / selection “never merge” guards
- Negatives / edges / schema
- L2B-safe execution plan
- Optional booking (F*) only when approved

### Out of scope (unless you ask)
- PayU / other vendors beyond TBO+Riya  
- UI / Mag front-end  
- Prod / canary (this plan is **preprod** only)  
- E* resilience without Dev simulation hooks  
- Hotel / other products  

---

## 5. Helpers (assertions)

```
CODES(resp)           = set of all fares[].sourceCode
OPTS(resp, dir)       = results[direction=dir].options[]
N(resp, dir)          = len(OPTS)
scheduleKey(o)        = ordered (flightNumber*, depAirport, depTime*, arrAirport, arrTime*, cabin*)
                        * normalised per merge doc
displayPrice(o)       = o.displayPricing.pricing.totalAmount
minFare(o)            = min(o.fares[].pricing.totalAmount)
```

---

## 6. Test cases

Legend: **P** = positive · **N** = negative · **E** = edge · Status later: PASS / BUG / NOT TESTED

### A. Routing (positive)

| ID | Type | Tier | Journey | Route | How tested | Expected |
|---|---|---|---|---|---|---|
| A1 | P | 22157551 | OW | DEL–DXB | Search | `CODES == {402T}` |
| A2 | P | 8 | OW | DEL–DXB | Search | `CODES == {422R}` |
| A3 | P | 15 | OW | DEL–DXB | Search | `CODES == {422R}` |
| A4 | P | 22101801 | OW | DEL–DXB | Search | `CODES == {402T,422R}` |
| A5 | P | 22101801 | OW | DEL–DXB | Find any option | ∃ option with both codes in `fares[]` |
| A6 | P | any | OW/RT | pinned | Scan all fares | no `sourceCode == null` / missing |

### A-N. Routing negatives / edges

| ID | Type | How tested | Expected |
|---|---|---|---|
| A-N1 | N | Invalid / unknown `tierId` | 4xx + `error.code` (not 500, not silent merge) |
| A-N2 | N | Missing `tierId` / `pid` / api-key | 401/403/400 with clear code |
| A-N3 | N | Wrong api-key | 401/403 |
| A-N4 | E | Merged tier but force only one vendor up (Dev) | see E* |
| A-N5 | E | Response must never invent a third `sourceCode` | only `402T`/`422R` (or empty on error) |

### B. Merge — one-way (tier 22101801)

| ID | Type | Assertion |
|---|---|---|
| B1 | P | No duplicate schedule: `len(set(scheduleKey(o))) == N(ONWARD)` |
| B2 | P | ∀ option: `displayPrice == minFare` |
| B3 | P | Same OD+dates: `N(merged) >= max(N(TBO), N(Riya))` |
| B4 | P | `N(merged) <= N(TBO) + N(Riya)` |
| B5 | P | Airline facet values case-unique (`lower`) |
| B6 | P | `sort=price_asc` → cheapest fare per card non-decreasing across list |
| B7 | P | Paging `size=20`: concat pages, no dup `searchId`, length == `totalResults` |
| B8 | P | ∀ fare `totalAmount > 0` |
| B9 | P | Merged card with both codes: segment flight#/times/cabin match after normalisation |
| B10 | P | Merge never drops fares: count of fares on merged card ≥ each contributing vendor’s fare count for that flight |
| B11 | E | Card with only one vendor still valid (unmatched flight) — single `sourceCode` OK |
| B12 | E | Display price strictly equals a real fare’s amount (not a rounded phantom) |
| B-N1 | N | If display price **>** any selectable fare → **BUG** |
| B-N2 | N | Duplicate identical `scheduleKey` cards after merge → **BUG** |
| B-N3 | E | Same aircraft codeshare different FN → **two cards** (expected, not defect) |

### C. Merge — round trip (tier 22101801) — P0

| ID | Type | Assertion |
|---|---|---|
| C1 | P | `directions == {ONWARD,RETURN}`, both non-empty |
| C2 | P | ∀ option ∀ direction: `len(fares) > 0` — empty fares = **BUG** |
| C3 | P | `CODES == {402T,422R}` on full RT search (before selection) |
| C4 | P | ∀ fare: `fareType` non-null / non-empty |
| C5 | P | ∀ option: displayPrice == minFare |
| C6 | P | After select onward `searchId`: `N(RETURN) > 0` |
| C7 | P | `N(RETURN after) <= N(RETURN before)` (shrink OK) |
| C8 | P | All return fares share **selected onward’s** `sourceCode` — mixed = **BUG** |
| C9 | P | ∃ return option with `combinedPricing.type == COMBINATION` |
| C10 | P | `combinedPricing.totalAmount != 2 * onwardFare.totalAmount` |
| C11 | P | `combinedPricing.totalAmount >= onwardFare.totalAmount` |
| C12 | P | Repeat C6–C11 for each fare on one card + 3 different cards |
| C13 | P | Repeat C1–C11 on **DEL→BOM** (TBO shape differs — do not skip) |
| C14 | E | Select cheapest vs dearest onward fare — returns stay single-vendor |
| C15 | E | Select TBO onward vs Riya onward — return codes follow selection |
| C-N1 | N | Empty RETURN after selection → **BUG** (C6) |
| C-N2 | N | Mixed return `sourceCode` after selection → **BUG** (C8) |
| C-N3 | N | ONWARD option merged into RETURN (or vice versa) → **BUG** |
| C-N4 | E | `combinedPricing` missing on all returns after selection → CHECK/BUG per contract |

### D. Regression — single-vendor + guards

| ID | Type | Tier | Assertion |
|---|---|---|---|
| D1 | P | 22157551, 8, 15 | RT: ∀ option `len(fares) > 0` |
| D2 | P | 22157551, 8, 15 | RT: `len(CODES) == 1` |
| D3 | P | 22157551, 8, 15 | Selection → non-empty RETURN |
| D4 | P | 22101801 | MULTI_CITY: `len(CODES) == 1` (never merged) |
| D5 | P | 22101801 | Any request with `selection` set: `len(CODES) == 1` |
| D6 | P | 8 vs 15 | Both Riya-only; no TBO codes |
| D-N1 | N | Single tier showing both 402T and 422R → **BUG** |
| D-N2 | N | MULTI_CITY showing both codes → **BUG** |

### E. Resilience (needs Dev) — mark NOT TESTED without hooks

| ID | Type | Condition | Expected |
|---|---|---|---|
| E1 | E | One vendor down | HTTP 200, `len(CODES)==1`, options > 0 |
| E2 | E | One vendor slow | Within merge timeout; partial results OK |
| E3 | E | Both down | Clean 4xx/5xx envelope with `error.code`, no hang |
| E4 | E | Vendor returns malformed option | Dropped or isolated; no 500 for whole search |

### F. Booking (manual / ALLOW_BOOK only — L2B costly)

| ID | Type | Tier | Case | Expected |
|---|---|---|---|---|
| F1 | P | 22101801 | OW book `422R` fare | PNR / Confirmed |
| F2 | P | 22101801 | OW book `402T` fare | PNR / Confirmed |
| F3 | P | 22101801 | **RT book** (most important) | PNR / Confirmed |
| F4 | P | 22157551, 8, 15 | RT regression book | PNR |
| F5 | P | all | Search fare price == payment/issue price | No silent increase |
| F-N1 | N | Book with stale/wrong `searchId` | 4xx clear code |
| F-N2 | N | Try to combine TBO onward + Riya return manually | Rejected / not offered |
| F-N3 | E | Book cheapest fare on merged card | Goes to correct vendor |

**Default recommendation:** run **search-only A–D** first; F only after you approve books.

### G. Extra negatives / validation (edge)

| ID | Type | How tested | Expected |
|---|---|---|---|
| G1 | N | Past travel date | 4xx `VALIDATION_ERROR` (or product-equivalent) |
| G2 | N | Same-day / invalid RT (return before onward) | 4xx |
| G3 | N | 0 adults / invalid pax | 4xx |
| G4 | N | Empty body | 4xx |
| G5 | N | Huge `size` / negative page | 4xx or safe clamp — never 500 |
| G6 | E | `size=-1` vs paged: same unique `searchId` set |
| G7 | E | Filters (airline) after merge: no cross-vendor ghost airlines |
| G8 | E | Special chars in optional fields | 4xx, not 500 |
| G9 | E | Response time merged vs single: flag only if **several×** slower or timeout |
| G10 | E | No **Riya** string leak in bookingCode/fareRules payloads we send (repo rule) |

### H. L2B process cases

| ID | Type | Assertion |
|---|---|---|
| H1 | P | Entire search-only pack uses **one** pinned date pair per OD |
| H2 | P | Tier comparison B3/B4 uses **same** OD+dates (not three different days) |
| H3 | P | No accidental second OD invented for “extra coverage” |
| H4 | P | Book section skipped unless `ALLOW_BOOK=true` |
| H5 | P | Report includes search timestamp (to the minute) for log lookup |

---

## 7. Not defects (do not raise)

1. Return list shrinks after onward selection (single-vendor rebuild) — only C6/C8 are failures  
2. Different fare counts per card  
3. Different prices for same flight across vendors  
4. Different result counts per tier  
5. Merged tier slower than single (unless extreme)  
6. `sourceCode` present in API (internal; not for UI display)  
7. Codeshare under different flight numbers = two cards  

---

## 8. Suggested execution order (after your approval)

1. Confirm **API path + auth + pid/key/subscription** on preprod  
2. Confirm **tier IDs** enabled for partner (22101801 has **both** TBO+Riya)  
3. Pin L2B dates  
4. Run **A → B → C (DXB) → C13 (BOM) → D** search-only  
5. Log times + save JSON per case  
6. Pause for review  
7. Only then **F** books if you allow  

### Reporting format
`Tier | Case ID | Route+dates | Search time | sourceCodes seen | Status | Evidence JSON`

Priority if fail: **book/price increase > C8 mixed returns > C2 empty fares > D regression > rest**

---

## 9. Open questions (need your answer before testing)

1. **Auth/path:** Mag `POST /api/flights/catalog-v2/search` + `x-api-key`, or B2B `POST /v1/flights/search` + Bearer on preprod?  
2. **Partner:** which `pid` / subscription on preprod for these tiers?  
3. **Books:** search-only first, or include F1–F3 in first run?  
4. **Dates:** lock to doc +21/+28 from today, or a fixed calendar pair you prefer?  
5. **Tier 15:** always include (doc has it) or treat as optional twin of tier 8?  

---

## 10. Case count summary

| Section | Cases (approx) |
|---|---|
| A routing + A-N | 11 |
| B merge OW + edges | 15 |
| C merge RT + edges | 19 |
| D regression | 8 |
| E resilience | 4 (likely NT without Dev) |
| F booking | 8 (gated) |
| G validation/edges | 10 |
| H L2B process | 5 |
| **Total** | **~80** (~60 runnable search-only without Dev/books) |

---

**Next step after your review:** confirm §9 answers → I’ll automate/run on preprod with L2B pins and report PASS/BUG/NOT TESTED.
