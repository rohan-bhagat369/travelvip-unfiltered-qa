# Theta wallet charge-first changelog

- Ran: 2026-11-19T10:07:35.267Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **0 PASS / 1 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| hotel | D | BUG | 200 |  | BR1795082850562848 | -11153.319999999996 | Stays PENDING (not FAILED) |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
