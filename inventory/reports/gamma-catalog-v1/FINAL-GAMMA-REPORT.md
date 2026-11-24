# ENG-826 catalog_v1 — FINAL gamma report (2026-11-24)

**Base:** https://gamma-api.travelvip.ai · **Partner:** vgm · **Lounge:** Marhaba `ol0oanfxamjcbjhkodvy` · **Legacy:** `ojny1swtigd4as`
**Sources:** Apidog envs `B2B_Dev_vgm` + `Web_Dev_smt` · collections api/web services bookings · full + remaining matrix

## Counts

| Status | Count |
|---|---|
| PASS | 92 |
| BUG | 0 |
| CHECK | 24 |
| NOT TESTED | 52 |

## Single matrix

| Case | Lounge | Fast Track | eSIM | old/other |
|---|---|---|---|---|
| W1 | PASS | PASS | PASS | — |
| W2 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| W3 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| W4 | PASS | PASS | PASS | — |
| W5 | CHECK | CHECK | CHECK | — |
| W6 | PASS | PASS | PASS | — |
| W7 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| W8 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| R1 | PASS | PASS | PASS | — |
| R2 | PASS | PASS | PASS | — |
| R3 | PASS | PASS | PASS | — |
| C1 | PASS | PASS | PASS | — |
| C2 | PASS | PASS | PASS | — |
| C3 | PASS | PASS | PASS | — |
| C4 | CHECK | CHECK | CHECK | — |
| C5 | PASS | PASS | PASS | — |
| C6 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| C7 | PASS | PASS | PASS | — |
| C8 | PASS | PASS | PASS | — |
| C9 | PASS | PASS | PASS | — |
| C10 | PASS | PASS | PASS | — |
| C11 | PASS | PASS | PASS | — |
| C12 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| C13 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| A1 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| A2 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| A3 | CHECK | CHECK | CHECK | — |
| A4 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| U1 | PASS | PASS | PASS | — |
| U2 | PASS | PASS | PASS | — |
| U3 | PASS | PASS | PASS | — |
| U4 | PASS | PASS | PASS | — |
| U5 | PASS | PASS | PASS | — |
| U6 | PASS | PASS | PASS | — |
| U7 | PASS | PASS | PASS | — |
| U8 | PASS | CHECK | CHECK | — |
| V1 | PASS | PASS | PASS | — |
| V2 | PASS | PASS | PASS | — |
| V3 | PASS | PASS | PASS | — |
| V4 | CHECK | CHECK | CHECK | — |
| V5 | NOT TESTED | NOT TESTED | CHECK | — |
| V6 | PASS | PASS | PASS | — |
| V7 | PASS | PASS | NOT TESTED | — |
| V8 | NOT TESTED | NOT TESTED | NOT TESTED | — |
| I1 | CHECK | CHECK | CHECK | — |
| I2 | CHECK | CHECK | CHECK | — |
| I3 | PASS | PASS | PASS | — |
| I4 | CHECK | CHECK | CHECK | — |
| L1 | PASS | PASS | PASS | — |
| L2 | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| L3 | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| L4 | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| L5 | — | — | — | PASS |
| L6 | NOT TESTED | NOT TESTED | NOT TESTED | PASS |
| L7 | NOT TESTED | — | — | — |
| L8 | PASS | — | PASS | fast_track_immigration:PASS |

## Bugs

None open for gamma B2B signoff.

## V4 — reclassed CHECK (not a bug)

**Reason (QA):** Offer is **not implemented yet on Dev vgm**. Finalize accepting a fake `offerId` (200 Pending) is expected until offers ship for B2B/vgm.

| Product | Was | Now | BR (2026-11-24) |
|---|---|---|---|
| Lounge | BUG | CHECK | BR1795506970810048 |
| Fast Track | BUG | CHECK | BR1795507011701555 |
| eSIM | BUG | CHECK | BR1795507043624947 |

Retest V4 as real validation when offers are enabled for vgm.

## Collection bookings (Apidog)

| Flow | Lounge | Fast Track |
|---|---|---|
| W1 finalize | PASS BR1795506790511647 | PASS BR1795506792886180 |
| C1→Stripe→C2 (omit stale offerId) | PASS BR1795507084160278 | PASS BR1795507102172771 |
| C1 with env offer_id 10558702 | FAIL OFFER_INVALID | FAIL OFFER_INVALID |

## Webhook (C3) — PASS (locked)

| Product | Status | Yesterday BR | Today BR |
|---|---|---|---|
| Lounge | PASS | BR1795434649115197 | BR1795506953332784 |
| Fast Track | PASS | BR1795434674570653 | BR1795506987289531 |
| eSIM | PASS | BR1795434703430427 | BR1795507025562110 |

Webhook completion without booking call — passed yesterday and again today. Treated as **PASS** (not pending).

## Notes
- Wallet is **enabled** this run → W7 left NOT TESTED (yesterday PASS when disabled).
- eSIM C2 **PASS** this run (was BUG yesterday).
- V4 → CHECK: offers not implemented on Dev vgm yet (not a signoff blocker).
- C6 (webhook+booking race) and L3 (old webhook) remain NOT TESTED — different cases from C3.
