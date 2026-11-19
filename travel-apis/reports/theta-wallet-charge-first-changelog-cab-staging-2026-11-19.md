# Theta wallet charge-first changelog

- Ran: 2026-11-19T12:13:55.064Z
- Base: https://api-staging.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **7 PASS / 2 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| cab | E | PASS | 502 | WALLET_COMMIT_FAILED |  | 0 |  |
| cab | F | PASS | 502 | WALLET_COMMIT_FAILED |  | -640.5 |  |
| cab | C | PASS | 200 |  | BR1795090335304415 | 0 |  |
| cab | H | PASS | 200 |  | BR1795090350873489 | -640.5 |  |
| cab | A | PASS | 200 |  | BR1795090370654013 | -640.5 |  |
| cab | D | BUG | 200 |  | BR1795090391819082 | -640.5 | Stays PENDING (not FAILED) |
| cab | G | BUG | 200 |  | BR1795090411330014 | 3260.0999999999767 | Still charged (not refunded) |
| cab | I | PASS | 200 |  | BR1795090426507451 | -640.5 |  |
| cab | J | PASS | 200 |  | BR1795090370654013 | 590.5 |  |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
