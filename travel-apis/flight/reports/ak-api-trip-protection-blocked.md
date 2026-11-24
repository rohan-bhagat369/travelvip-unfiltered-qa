# ak-api trip protection books — blocked

## Request
Book Delay Care + Bag Assure + Concierge on:
1. 1 pax OW DEL→PNQ 2026-12-20
2. 2 pax OW DEL→PNQ 2026-12-20
3. 2 pax RT DEL↔PNQ 27–29 Dec  
Surname: `Confirmed` · Base: `https://ak-api.travelvip.ai`

## Verdict
**NOT TESTED** — trip protection not attachable via current B2B flight APIs on ak-api.

## Evidence
| Probe | Result |
|-------|--------|
| `POST /v1/flights/ssr` | meal + baggage only (no delay/bag/concierge) |
| value-adds / protection / insurance paths | 404 or not an offer catalog |
| issue-ticket + guessed `valueAdds` / `tripProtection` | HTTP 200 Confirmed but **ignored** — fare stays ₹5983, detail has no protection |
| api-docs.travelvip.ai | no Delay Care / Bag Assure / Concierge flight endpoints |

## Baseline (already booked earlier, no protection)
| # | Scenario | BR | ₹ | Status |
|---|----------|----|---|--------|
| 1 | 1 pax 1 leg | BR1794999805178468 | 5,983 | Confirmed |
| 2 | 2 pax 1 leg | BR1794999814604621 | 11,616 | Confirmed |
| 3 | 2 pax return | BR1794999687989592 | 31,134 | Confirmed |

## Need
Product/API contract for B2B: how to fetch offers and attach **delay care**, **bag assure**, **concierge** on issue-ticket (or post-book) for OW/RT multi-pax.
