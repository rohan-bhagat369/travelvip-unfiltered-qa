# ENG-767 BUG — Mixed-airline RT seatmap incomplete

**Status:** **BUG** (known / confirmed on preprod)  
**Task:** https://tracker.travelvip.ai/tasks/ENG-767  
**When:** 2026-11-09  
**Env:** `https://preprod-api.travelvip.ai` · partner `vgm` · tier `19597201`  
**No book.**

## AC (expected)

Riya RT with **different airlines** on onward vs return → **one GetAvailSeatMap per leg**; merge onward then return; seats labelled per leg. One leg fail may return the other with `requestStatus Completed` + alert — but product expectation for this QA: **both legs should return seat maps** when both carriers support seats.

## How tested

1. Search DEL↔BOM `2026-11-22` / `2026-11-24`, `fareType: "NORMAL, CORPORATE, SME"`, `maxStops: 0`.
2. Mixed pair: **SG 671 CORPORATE** + **9I 842 NORMAL** (Alliance Air).
3. Pricing → `fareType: MIXED`, `priceId: price_bfb09c744dc049a68af4da5d8e6991bc`.
4. Seatmap on `bookingContext`.

## Actual

| Field | Value |
|-------|--------|
| HTTP | 200 |
| `requestStatus` | `Completed` |
| Segments in `data.segments` | **1** (onward only) |
| Onward | SG671 DEL→BOM — **189** seats (163 Open) |
| Return | **9I 842 missing** — no return segment in seatmap |

## Verdict

**BUG** — Mixed fare type + **different airlines** (SG + 9I): seatmap returns only onward; return leg empty. Marked known issue for ENG-767.

## Evidence

- `onehit-user-flow-nobook.json` / `.md`
- `seatmap-full-response.json` (full body ~410KB)
- Correlation (seatmap dump): `587fe32a-7924-4563-b1ab-90c537ea28e1`

## Note

Same-airline mixed fare seatmap was OK earlier (SME+NORMAL both 6E). Failure is specific to **cross-airline** RT seatmap merge.
