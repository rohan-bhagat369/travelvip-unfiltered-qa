# Theta wallet charge-first changelog

- Ran: 2026-11-19T11:01:53.407Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **2 PASS / 0 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| flight | H | PASS | 200 |  | BR1795086058563137 | -4757 |  |
| flight | D | PASS | 200 |  | BR1795086092715867 | -4757 |  |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
