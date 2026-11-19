# Theta wallet charge-first changelog

- Ran: 2026-11-19T10:09:46.597Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **2 PASS / 2 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| hotel | C | PASS | 200 |  | BR1795082950296274 | 0 |  |
| hotel | H | PASS | 200 |  | BR1795082960448054 | -11153.32 |  |
| hotel | D | BUG | 200 |  | BR1795082960448054 | 0 | Stays PENDING (not FAILED); Charged (no refund) |
| hotel | G | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | refund.status FAILED; Still charged (not refunded) |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
