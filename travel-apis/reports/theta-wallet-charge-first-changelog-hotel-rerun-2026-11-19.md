# Theta wallet charge-first changelog

- Ran: 2026-11-19T10:09:03.420Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **5 PASS / 4 BUG / 2 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| hotel | E | PASS | 502 | WALLET_COMMIT_FAILED |  | 0 |  |
| hotel | F | PASS | 502 | WALLET_COMMIT_FAILED |  | -11153.319999999996 |  |
| hotel | C | BUG | 500 |  |  | 0 | Hotel FAILED / 400; refund.status SUCCESS + walletTransactionId |
| hotel | H | BUG | 500 |  |  | 0 | Booking continues normally; Wallet charged |
| hotel | A | PASS | 200 |  | BR1795082906334896 | -11153.320000000002 |  |
| hotel | D | BUG | 500 |  |  | 0 | Stays PENDING (not FAILED); Charged (no refund) |
| hotel | G | BUG | 500 |  |  | 0 | refund.status FAILED; Still charged (not refunded) |
| hotel | I | PASS | 200 |  | BR1795082930303131 | -11153.32 |  |
| hotel | J | PASS | 200 |  | BR1795082906334896 | 11153.32 |  |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
