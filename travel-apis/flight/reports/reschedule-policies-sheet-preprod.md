# Reschedule policies vs sheet — preprod-api (fare filter, no airline filter)

- Ran: 2026-10-27T12:38:58.282Z
- Base: https://preprod-api.travelvip.ai · tier 19597201
- Search with fareType only (no airline filter); pick available sheet airlines from response; check details+fareRules+pricing; no book
- Searches: 6 · hop calls: 9 · **no books**
- **3 PASS** / **0 BUG** / **0 NOTE** / **9 NOT TESTED**

| Scenario | Airline | Fare exp/act | details | fareRules | pricing | Status | Issues |
|---|---|---|---|---|---|---|---|
| OW-DOM-CORP | QP Akasa Air | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | — |
| OW-DOM-CORP | 6E IndiGo | CORPORATE/- | - | - | - | NOT TESTED | not in fareType=CORPORATE search (saw QP) |
| OW-DOM-CORP | IX Air India Express | CORPORATE/- | - | - | - | NOT TESTED | not in fareType=CORPORATE search (saw QP) |
| OW-DOM-CORP | SG SpiceJet | CORPORATE/- | - | - | - | NOT TESTED | not in fareType=CORPORATE search (saw QP) |
| OW-DOM-SME | AI Air India | SME/SME | PASS | PASS | PASS | PASS | — |
| OW-INT-CORP | -  | /- | - | - | - | NOT TESTED | http=400 NO_FLIGHTS_FOUND |
| OW-INT-SME | -  | /- | - | - | - | NOT TESTED | target airlines absent; saw 6E,IX |
| RT-DOM-CORP | QP Akasa Air | CORPORATE/CORPORATE | PASS | PASS | PASS | PASS | — |
| RT-DOM-CORP | 6E IndiGo | CORPORATE/- | - | - | - | NOT TESTED | not in fareType=CORPORATE search (saw QP) |
| RT-DOM-CORP | IX Air India Express | CORPORATE/- | - | - | - | NOT TESTED | not in fareType=CORPORATE search (saw QP) |
| RT-DOM-CORP | SG SpiceJet | CORPORATE/- | - | - | - | NOT TESTED | not in fareType=CORPORATE search (saw QP) |
| RT-INT-CORP | -  | /- | - | - | - | NOT TESTED | http=400 NO_FLIGHTS_FOUND |

## Inventory
```json
{
  "OW-DOM-CORP": {
    "fareType": "CORPORATE",
    "airlines": [
      "QP"
    ],
    "fareSamples": [
      "QP:CORPORATE"
    ]
  },
  "OW-DOM-SME": {
    "fareType": "SME",
    "airlines": [
      "6E",
      "QP",
      "IX",
      "AI"
    ],
    "fareSamples": [
      "6E:SME",
      "QP:SME",
      "IX:SME",
      "AI:SME"
    ]
  },
  "OW-INT-CORP": {
    "fareType": "CORPORATE",
    "airlines": [],
    "fareSamples": []
  },
  "OW-INT-SME": {
    "fareType": "SME",
    "airlines": [
      "6E",
      "IX"
    ],
    "fareSamples": [
      "6E:SME",
      "IX:SME"
    ]
  },
  "RT-DOM-CORP-RETURN": [
    "QP"
  ],
  "RT-DOM-CORP": {
    "fareType": "CORPORATE",
    "airlines": [
      "QP"
    ],
    "fareSamples": [
      "QP:CORPORATE"
    ]
  },
  "RT-INT-CORP": {
    "fareType": "CORPORATE",
    "airlines": [],
    "fareSamples": []
  }
}
```
