# Theta wallet charge-first changelog

- Ran: 2026-11-19T10:58:25.326Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **6 PASS / 0 BUG / 5 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| flight | E | PASS | 502 | WALLET_COMMIT_FAILED |  | 0 |  |
| flight | F | PASS | 502 | WALLET_COMMIT_FAILED |  | -6552 |  |
| flight | C | PASS | 502 | TICKET_ISSUANCE_FAILED |  | 0 |  |
| flight | H | PASS | 200 |  | BR1795084580431254 | -6552 |  |
| flight | A | NOT TESTED |  |  |  |  |  |
| flight | D | PASS | 200 |  | BR1795085364531396 | -7713 |  |
| flight | G | PASS | 502 | TICKET_ISSUANCE_FAILED |  | -4757 |  |
| flight | I | NOT TESTED |  |  |  |  |  |
| flight | J | NOT TESTED |  |  |  |  | no Case A BR to cancel |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
