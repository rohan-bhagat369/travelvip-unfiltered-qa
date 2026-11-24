# ENG-826 Dev-clarification retest — 23 Nov 2026

**Base:** https://canary-api.travelvip.ai · **Partner:** vgm · 2026-11-23T07:41:30.126Z

**Dev note:** finalize-booking is **not** the SMT flow; finalize **ignores** `offerId` / `pid`. SMT = create-booking (+ booking after Stripe).

## Score

| PASS | BUG | CHECK |
|---:|---:|---:|
| 20 | 3 | 1 |

| Case | Lounge | Fast Track | eSIM |
|---|---|---|---|
| INV | PASS | PASS | PASS |
| W1_finalize | CHECK `BR1795419689841072` | PASS `BR1795419696677398` | PASS `BR1795419703861551` |
| R1_status | PASS `BR1795419689841072` | PASS `BR1795419696677398` | PASS `BR1795419703861551` |
| R2_details | PASS `BR1795419689841072` | PASS `BR1795419696677398` | PASS `BR1795419703861551` |
| finalize_ignores_offerId | PASS `BR1795419690448138` | PASS `BR1795419698334650` | PASS `BR1795419704543553` |
| finalize_ignores_pid | PASS `BR1795419691960154` | PASS `BR1795419699142815` | PASS `BR1795419704359941` |
| C1_smt_create | PASS `BR1795419693753175` | PASS `BR1795419700691827` | PASS `BR1795419705783517` |
| C1_smt_requires_pid | CHECK (session auth still books w/o query pid) | CHECK | CHECK |

## BRs
```json
{
  "lounge_W1": "BR1795419689841072",
  "lounge_offerIgnore": "BR1795419690448138",
  "lounge_pidIgnore": "BR1795419691960154",
  "lounge_C1": "BR1795419693753175",
  "fasttrack_W1": "BR1795419696677398",
  "fasttrack_offerIgnore": "BR1795419698334650",
  "fasttrack_pidIgnore": "BR1795419699142815",
  "fasttrack_C1": "BR1795419700691827",
  "esim_W1": "BR1795419703861551",
  "esim_offerIgnore": "BR1795419704543553",
  "esim_pidIgnore": "BR1795419704359941",
  "esim_C1": "BR1795419705783517"
}
```

## Implication for prior issues
- **V4 invalid offerId on finalize** → **not a bug** (offerId ignored; pricing from bookingContext).
- **W5 pid=smt on finalize** → **not a bug** (pid ignored; partner from token + X-Partner-Key).
- SMT regressions belong on **create-booking / booking**, not finalize.
