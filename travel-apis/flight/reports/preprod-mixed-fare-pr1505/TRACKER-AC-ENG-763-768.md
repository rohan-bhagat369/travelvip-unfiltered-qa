# Tracker acceptance — ENG-763…768 (PR #1505)

**Source:** https://tracker.travelvip.ai/tasks/ENG-763 … ENG-768  
**Pulled:** 2026-11-09  
**Status (all):** In QA · High · Assignee Mayur More · Project Travel VIP › Flight  
**PR:** https://github.com/travelx-ai/catalog-platform/pull/1505  
**Comment on each:** Deployed on preprod for QA.

---

## ENG-763 — Mixed fare types across Riya RT legs

**Title:** Flights v2: allow mixed fare types across Riya round-trip legs

**AC / description:**
- RT can combine **Normal, Corporate (incl. IX I), SME** across onward/return.
- Constraint: **same provider**, **same Riya TrackId**, **same search stage**.
- After onward pick, return list includes **other fare types** from same Riya search (fare-level filtering; card re-points to cheapest surviving fare).
- Single shared pairing check for **search, pricing, details, fare rules** (`V2SelectionValidator`); **missing trackingId rejected**.
- Still blocked: Student / Defence / Senior Citizen, Flexi-Cancel, Riya+TBO, **cross-search pairs**.
- **International unchanged**.
- Enabled by default; kill switch `V2_DISABLE_MIXED_FARE_ROUND_TRIP` (per-pid).

---

## ENG-764 — Per-leg fareType + MIXED top-level

**Title:** Flights v2: per-leg fareType and MIXED top-level fareType in pricing/details

**AC / description:**
- Each leg has own `fareType` / `fareCategory` in **pricing and details**; `mixedFareType` flag.
- Top-level `fareType = MIXED` for mixed RT (cache hit **and** miss); non-mixed unchanged.
- Encrypted pricing reference carries per-leg fare types; alerts like `ONWARD: NORMAL; RETURN: corporate`.
- Downstream must **not** treat MIXED as corporate/SME/flexi (standard ledger + cancellation fee).

---

## ENG-765 — Per-leg cancel / reschedule policies

**Title:** Flights v2: per-leg cancellation and reschedule policies for mixed round trips

**AC / description:**
- Policies resolved **per leg** from that leg’s fare type.
- **Corporate/SME legs:** policies sent.
- **Normal leg:** none.
- Independent of `selectedSearchIds` order.
- Applies to **pricing, details, and fare rules**.
- Single-fare-type trips unchanged.

---

## ENG-766 — Re-price expired leg

**Title:** Flights v2: re-price expired round-trip leg from one search, per-leg fare type

**AC / description:**
- Selection-pricing from **refresh token**: if either leg’s cached option expired → **both legs re-found** from **one** fresh Riya search using **each leg’s fare type** (pair stays under one TrackId).
- Refresh token + `selection.selectedFlights[]` carry per-leg `fareType`.
- Unavailable flight/fare type → `INVALID_SELECTION`.
- Nothing expired → **no** new search.
- Also: merged onward card stays selected; HINT listing evicted before search job cleared (CodeRabbit).

---

## ENG-767 — Seatmap per leg when airlines differ

**Title:** Flights v2: Riya seatmap per-leg calls when round-trip airlines differ

**AC / description:**
- Mixed-airline Riya RT (e.g. **6E + SG**) previously failed “Unable to fetch seat detail”.
- Split to **one GetAvailSeatMap per leg** when flight-number airlines differ; same-airline unchanged (one call).
- Per-leg request = whole-journey request (TripType R, same TrackId/pax) with FlightsInfo cut to that leg.
- Parallel calls (180s budget); merge onward then return; seats labelled with requested leg.
- **One leg fail** → other seats returned (`requestStatus Completed`) + alert naming leg.
- **Both fail** → **503**.
- Selection-pricing fetches only legs with chosen seats (`V2SeatmapRequest.directions`).
- Also from PR #1506 merged into #1505.

---

## ENG-768 — Per-leg fare rules

**Title:** Flights v2: per-leg fare rules for round trips (static for Corporate/SME legs)

**AC / description:**
- Fare rules fetched **per leg** on RT; response = one entry per leg (**onward then return**), titled with route.
- **Corporate/SME:** static rules (no vendor call).
- **Normal:** Riya rules for its flights.
- Each entry has own `fareType`; top-level `MIXED` when mixed.
- Failed vendor leg → remaining legs returned + alert; response **not** cached.
- `/fare-rules` + `ROUND_TRIP` + **single** `selectedSearchId` → that leg only.
- Pricing/details still need **2** IDs; TBO still requires 2.
