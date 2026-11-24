# Theta wallet charge-first changelog

- Ran: 2026-11-19T11:31:35.844Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **1 PASS / 0 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| hotel | G | PASS | 200 |  | BR1795087891927038 | -11153.319999999949 |  |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
