# Reschedule policies — OW DOM + INT (fareType=CORPORATE,SME)

- Preprod VGM · **no books**
- DOM: DEL–BOM · INT: BOM–DXB
- Fare filter: `CORPORATE,SME` (no airline filter)
- **4 PASS** / **0 BUG** / **4 NOTE** / **2 NT**

| Scenario | Airline | Fare exp/act | details | fareRules | pricing | Status | Notes |
|---|---|---|---|---|---|---|---|
| OW-DOM | SpiceJet | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | 599/599 · fees 50/300 · cutoffs 4h/12h |
| OW-DOM | Akasa | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | 299/299 · fees 50/300 |
| OW-DOM | Air India | SME/SME | PASS | PASS | PASS | PASS | 1047/1999 · fees 50/300 |
| OW-DOM | IndiGo | CORPORATE/SME | NOTE | NOTE | NOTE | NOTE | policies present; only SME in inventory |
| OW-DOM | Air India Express | CORPORATE/SME | NOTE | NOTE | NOTE | NOTE | policies present; only SME in inventory |
| OW-INT | SpiceJet | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | 599/599 · **INT fees 100/600** · cutoffs 4h/12h |
| OW-INT | IndiGo | CORPORATE/SME | NOTE | NOTE | NOTE | NOTE | policies present; only SME |
| OW-INT | Air India Express | CORPORATE/SME | NOTE | NOTE | NOTE | NOTE | policies present; only SME |
| OW-INT | Air India | SME/- | - | - | - | NOT TESTED | not in BOM–DXB search |
| OW-INT | Akasa | CORPORATE/- | - | - | - | NOT TESTED | not in BOM–DXB search |

## Inventory
- DOM airlines: SG, 6E, QP, AI, IX
- INT airlines: IX, 6E, SG
- INT fares: IX:SME, 6E:SME, SG:CORPORATE

## INT fee check
SpiceJet Corporate on BOM–DXB correctly returned **online 100 / offline 600** (international sheet values), not DOM 50/300.
