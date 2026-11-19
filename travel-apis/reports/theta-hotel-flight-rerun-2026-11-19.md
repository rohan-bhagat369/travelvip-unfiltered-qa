# Theta recheck — Hotel D + all cases (no cab) — 2026-11-19

- Base: `https://theta-api.travelvip.ai`
- Partner: `vgm`
- Cab: **skipped** (per request)
- Wallet end: available **₹5,213.31** · reserved **₹11,153.32** (Case F hold) → blocked further debit books

## Hotel D bug

| Check | Prior | Today | Verdict |
|-------|-------|-------|---------|
| Pending + **null `bookingRefId`** | **BUG** (3/3) | Issue returns **real BR** e.g. `BR1795082850562848`, `BR1795082960448054` | **FIXED** (null BR no longer reproduces) |
| Stays PENDING under `provider_no_response` | expected | Immediate `Pending`, then poll → **Failed** or **Confirmed** | **Still BUG / flaky** (not held PENDING) |

Evidence:
- First D today: HTTP 200 `Pending` + BR `BR1795082850562848` → poll **Failed** (unique PAN name); charged, no refund section
- Matrix D: HTTP 500 flake once; retry returned BR then **Confirmed** (also hit 15m duplicate cache vs Case H once)
- Later D retries: **INSUFFICIENT_BALANCE** (wallet drained)

## Hotel A–J (today)

| Case | Verdict | Evidence |
|------|---------|----------|
| E | **PASS** | 502 `WALLET_COMMIT_FAILED`; balance flat |
| F | **PASS** | 502; hold retained (−₹11,153.32 available / reserved up) |
| C | **PASS** (retry) | `BR1795082950296274` FAILED; refund SUCCESS + txn |
| H | **PASS** (retry) | `BR1795082960448054` → Confirmed; charged (cancelled after) |
| A | **PASS** | `BR1795082906334896` → Confirmed; charged; **J cancelled** |
| D | **BUG** | BR returned (null-BR fixed) but does **not** stay PENDING |
| G | **NOT TESTED** | `INSUFFICIENT_BALANCE` after prior charges / F hold |
| I | **PASS** | `BR1795082930303131` FAILED; refund FAILED; still charged |
| J | **PASS** | Cancel A Success |
| B | **PASS** | HTTP 403 `INSUFFICIENT_BALANCE` (need ₹11,153.32 / avail ₹5,213.31); no charge |
| K | **NOT TESTED** | Card/Stripe web — blocked (wallet-only `vgm`) |

First-pass HTTP **500** empty on C/H/D/G under load — retries recovered for C/H/I.

## Flight A–J (today)

| Case | Verdict | Evidence |
|------|---------|----------|
| A, C–I | **NOT TESTED** | Wallet too low for charge cases (avail ₹5,213; F hold reserved) |
| J | **NOT TESTED** | no Case A BR |
| B | **PASS** | HTTP 403 `INSUFFICIENT_BALANCE` (need ₹12,414 / avail ₹5,213.31); no charge |
| K | **NOT TESTED** | Card/Stripe web — blocked (wallet-only `vgm`) |

Prior Flight pack (2026-11-18 DEL–PNQ) still stands until wallet topped up for a fresh run.

## Ops

1. Top up **vgm** wallet on theta (and/or wait ~15m for Case F hold release).
2. Re-run Hotel D + G + Flight A–J after top-up.
3. Hotel D tracking: score **null-BR = fixed**; **PENDING hold = still open bug**.
