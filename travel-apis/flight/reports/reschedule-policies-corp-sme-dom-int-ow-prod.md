# Reschedule policies — PROD OW DOM + INT (fareType=CORPORATE,SME)

- Ran: 2026-10-27T13:24:42.854Z
- Base: https://api.travelvip.ai · tier 19597201
- Correlation: 16b58ed6-b93f-4def-aadf-f792141bffdb
- **no books**
- **8 PASS** / **0 BUG** / **2 NT**

| Scenario | Airline | Fare exp/act | details | fareRules | pricing | Status | Issues |
|---|---|---|---|---|---|---|---|
| OW-DOM | 6E IndiGo | CORPORATE/SME | PASS | PASS | PASS | PASS | details: fareCategory SME (sheet CORPORATE); amounts matched sheet; fareRules: fareCategory SME (sheet CORPORATE); amounts matched sheet; pricing: fareCategory SME (sheet CORPORATE); amounts matched sheet |
| OW-DOM | AI Air India | SME/SME | PASS | PASS | PASS | PASS | — |
| OW-DOM | IX Air India Express | CORPORATE/SME | PASS | PASS | PASS | PASS | details: fareCategory SME (sheet CORPORATE); amounts matched sheet; fareRules: fareCategory SME (sheet CORPORATE); amounts matched sheet; pricing: fareCategory SME (sheet CORPORATE); amounts matched sheet |
| OW-DOM | QP Akasa Air | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | — |
| OW-DOM | SG SpiceJet | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | — |
| OW-INT | 6E IndiGo | CORPORATE/SME | PASS | PASS | PASS | PASS | details: fareCategory SME (sheet CORPORATE); amounts matched sheet; fareRules: fareCategory SME (sheet CORPORATE); amounts matched sheet; pricing: fareCategory SME (sheet CORPORATE); amounts matched sheet |
| OW-INT | AI Air India | SME/- | - | - | - | NOT TESTED | not in search |
| OW-INT | IX Air India Express | CORPORATE/SME | PASS | PASS | PASS | PASS | details: fareCategory SME (sheet CORPORATE); amounts matched sheet; fareRules: fareCategory SME (sheet CORPORATE); amounts matched sheet; pricing: fareCategory SME (sheet CORPORATE); amounts matched sheet |
| OW-INT | QP Akasa Air | CORPORATE/- | - | - | - | NOT TESTED | not in search |
| OW-INT | SG SpiceJet | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | — |

## Inventory
- DOM: SG, 6E, QP, AI, IX · SG:CORPORATE, 6E:SME, QP:SME, QP:CORPORATE, AI:SME, IX:SME
- INT: IX, 6E, SG · IX:SME, 6E:SME, SG:CORPORATE
