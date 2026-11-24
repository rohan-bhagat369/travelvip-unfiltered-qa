# Theta wallet charge-first changelog

- Ran: 2026-11-19T11:00:18.104Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **3 PASS / 0 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| flight | A | PASS | 200 |  | BR1795085917199887 | -4757 |  |
| flight | I | PASS | 502 | TICKET_ISSUANCE_FAILED |  | -4757 |  |
| flight | J | PASS | 200 |  | BR1795085917199887 | 832 |  |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
