# Theta wallet charge-first changelog

- Ran: 2026-11-19T10:27:27.763Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **1 PASS / 1 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| flight | E | PASS | 502 | WALLET_COMMIT_FAILED |  | 0 |  |
| flight | C | BUG | 502 | TICKET_ISSUANCE_FAILED |  | -5983 | Balance restored (±2) |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
