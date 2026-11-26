# Standup — 2026-11-26

**Owner:** Rohan Bhagat (QA)  
**Date:** 2026-11-26  

## One-liner for manager

> Covering catalog booking (Lounge/FT/eSIM), hotel unification + callback/Stripe race, Node migration parity, Benepik headers/cancel-refund, Byufuel web/APK, flight dashboard cancel, and flight merge results — several done on Dev; others waiting on Dev bug fixes before retest.

## What I’m working on

### Done on Dev (tested / signed off)

| # | Owner (Dev) | Task | In plain words | Status |
|---|---|---|---|---|
| 1 | Chaitanya | [ENG-826](https://tracker.travelvip.ai/tasks/ENG-826) | One common booking flow for Lounge / Fast Track / eSIM (wallet + card); old APIs still work | Done on Dev |
| 2 | Janhavi | [ENG-336](https://tracker.travelvip.ai/tasks/ENG-336) | One common hotel book/pay/refund path for B2B wallet and web/card | Done on Dev |
| 3 | Akash | [ENG-856](https://tracker.travelvip.ai/tasks/ENG-856) | Benepik B2B headers (signature, request id, correlation id) checked across APIs | Done on Dev |
| 4 | Akash | [ENG-637](https://tracker.travelvip.ai/tasks/ENG-637) | Benepik cancel / refund / reschedule testing done | Done |

### In progress (bugs / fixes / retest)

| # | Owner (Dev) | Task | In plain words | Status |
|---|---|---|---|---|
| 5 | Amaan | [ENG-822](https://tracker.travelvip.ai/tasks/ENG-822) | PHP → Node migration QA (Nova vs Canary for Hotel/Flight/Cab) | Bug fix in progress |
| 6 | Janhavi | [ENG-902](https://tracker.travelvip.ai/tasks/ENG-902) | Hotel callback + Stripe race on gamma; cancel “request in progress” UX | Bug fix in progress (cancel-related) |
| 7 | Mayur | [ENG-639](https://tracker.travelvip.ai/tasks/ENG-639) (Byufuel Grow) | Byufuel web + APKs vs Azure — Grow UAT parity; bugs in Dev / QA / some closed after retest | Bug fixes in progress |
| 8 | Akshay | [ENG-294](https://tracker.travelvip.ai/tasks/ENG-294) | Flight cancellation from dashboard vs QA suite | Bug fixes in progress |

### Next / follow-up

| # | Owner (Dev) | Task | In plain words | Status |
|---|---|---|---|---|
| 9 | Sharayu | [ENG-893](https://tracker.travelvip.ai/tasks/ENG-893) | Flight merged (TBO+Riya) results on preprod — iteration 1 done; start iteration 2 after fix | Ready for 2nd iteration |

## Blockers

- Waiting on Dev bug fixes for ENG-822, ENG-902 cancel UX, Byufuel, ENG-294 before next retest rounds.

## Notes (standup speak)

1. **ENG-826** — Chaitanya’s catalog_v1 engine for Lounge/FT/eSIM (shared wallet + card).
2. **ENG-822** — Amaan’s Node migration; comparing Nova vs Canary.
3. **ENG-336** — Janhavi’s hotel booking unification (one wallet + card path).
4. **ENG-902** — Janhavi’s hotel callback/Stripe race hardening on gamma.
5. **ENG-856** — Akash’s Benepik header checks.
6. **ENG-639 (Mayur / Byufuel Grow)** — Web + APK parity vs Azure; bugs in Dev / QA / some passed.
7. **ENG-294** — Akshay’s flight dashboard cancellation suite.
8. **ENG-893** — Sharayu’s flight merged results; iteration 2 next.
9. **ENG-637** — Akash’s Benepik cancel/refund/reschedule done.
