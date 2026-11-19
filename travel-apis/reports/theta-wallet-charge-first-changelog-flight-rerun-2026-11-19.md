# Theta wallet charge-first changelog

- Ran: 2026-11-19T10:12:05.034Z
- Base: https://theta-api.travelvip.ai
- Partner: vgm · tier 10546901
- Summary: **0 PASS / 8 BUG / 3 NOT TESTED**

| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |
|---------|------|---------|------|------|----|----------|-------|
| flight | E | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | WALLET_COMMIT_FAILED HTTP 502; Response is wallet commit failure (supplier not charged path) |
| flight | F | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | WALLET_COMMIT_FAILED HTTP 502; Response is wallet commit failure (supplier not charged path) |
| flight | C | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | TICKET_ISSUANCE_FAILED / 502; refund.status SUCCESS + walletTransactionId |
| flight | H | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | Booking continues normally; Wallet charged |
| flight | A | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | Booking accepted / not wallet-fail |
| flight | D | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | Stays PENDING (not FAILED); Charged (no refund) |
| flight | G | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | refund.status FAILED; Still charged (not refunded) |
| flight | I | BUG | 403 | INSUFFICIENT_BALANCE |  | 0 | refund.status FAILED; Still charged (not refunded) |
| flight | J | NOT TESTED |  |  |  |  | no Case A BR to cancel |
| all | B | NOT TESTED |  |  |  |  | needs low-balance partner; not forced in this run |
| all | K | NOT TESTED |  |  |  |  | Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner |

DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.
