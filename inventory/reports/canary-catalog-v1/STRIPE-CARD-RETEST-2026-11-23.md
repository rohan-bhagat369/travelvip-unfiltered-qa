# ENG-826 Stripe card-path retest — 23 Nov 2026

**Env:** `https://canary-api.travelvip.ai` · smt create-booking + Stripe confirm  
**Probe:** `probe-canary-catalog-v1-remaining.js` with `STRIPE_SECRET_KEY` set (session only; not committed)  
**Stripe smoke:** `GET /v1/balance` → 200

## Card cases (C*)

| Case | Lounge | Fast Track | eSIM |
|---|---|---|---|
| **C5** pay → booking (happy) | NT — `BOOKING_SUBMIT_FAILED` after pay (supplier) | **PASS** `BR1795424336317374` | **PASS** `BR1795424467382055` |
| **C3** pay only, wait webhook | CHECK — no progress (webhook may be off) | CHECK same | CHECK same |
| **C4** reject after pay | **PASS** `BOOKING_SUBMIT_FAILED` `BR1795424325847917` | CHECK — sim may be ignored `BR1795424457558305` | CHECK — sim may be ignored `BR1795424580416848` |
| C10 / C11 | PASS | PASS | PASS |

## Takeaways

1. **Stripe key is valid** — confirm + booking step works for **FT / eSIM**.
2. **Lounge card** still dies at supplier (`BOOKING_SUBMIT_FAILED` / same provider issue as wallet).
3. **C3 webhook-only** never advances status on canary without the `/booking` call — webhook delivery likely not wired or not firing for these PIs (signing secret provided separately; probe waits only).
4. **C4** `X-Simulate-Failure` after pay: Lounge fails as expected; FT/eSIM still Pending (sim ignored — same as 19 Nov).

## Still blocked (unchanged)

W3/W7 · W8/C12 · A1/A2/A4 · C6/C13 · L2–L7 · Lounge U*
