# travelvip-unfiltered-qa

Unfiltered TravelVIP API QA — raw reports, payloads, BRs, and matrices as we moved from **manual clicks → automation**.

If it is not next to the product under `reports/`, we did not keep the receipt.

**GitHub:** https://github.com/rohan-bhagat369/travelvip-unfiltered-qa

## Read the map

| Folder | Contents |
|--------|----------|
| [`inventory/`](inventory/) | Lounge, FastTrack, Attractions inventory / sheet checks |
| [`travel-apis/`](travel-apis/) | Hotel, Flight, Cab B2B APIs + regression packs |
| [`byufuel/`](byufuel/) | Byufuel / UCO QA (Tracker QA-19) |
| [`mcp/`](mcp/) | Playwright MCP / UI session dumps |
| [`other/`](other/) | eSIM, Entertainer, Zenith, Tracker tooling |
| [`shared/`](shared/) | Auth, signing, HTTP client, config, CLI |
| [`postman/`](postman/) | Postman collections + envs (secrets not in git) |

Excel / CSV / PDF live under each domain as `sheets/` or `docs/` (cab contracts, lounge Dragonpass, GlobalTix dump, hotel QA suite, wallet guide) — root stays clean.

Agent memory: root [`AGENTS.md`](AGENTS.md) (index + timeline through **2026-10-08**), then domain `AGENTS.md` files.

## Quick start

1. Copy `.env` with staging `BASE_URL`, `PARTNER_ID`, `PARTNER_SECRET`, `SIGNING_KEY`, `TIER_ID`.
2. `npm install`
3. Smoke (no book): `npm run hotel:regression:smoke` · `npm run flight:regression:smoke`
4. Inventory: `npm run report:lounge` · `npm run report:fasttrack`

## Postman

Import collection + **environment** together. Empty `signing_key` → invalid signature. See [`postman/README.md`](postman/README.md).

## Tracker

- Hub: [ENG-290](https://tracker.travelvip.ai/tasks/ENG-290)  
- TBO books: [QA-24](https://tracker.travelvip.ai/tasks/QA-24)  
- tripType: [ENG-297](https://tracker.travelvip.ai/tasks/ENG-297) · [ENG-299](https://tracker.travelvip.ai/tasks/ENG-299)
