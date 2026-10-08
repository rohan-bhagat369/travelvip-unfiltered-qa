# TravelVIP Unfiltered QA — agent memory (index)

**Read this file first**, then open the domain `AGENTS.md` / `README.md` for the product you are changing.

- Repo: **travelvip-unfiltered-qa** · https://github.com/rohan-bhagat369/travelvip-unfiltered-qa
- Staging: `https://api-staging.travelvip.ai` · partner `vgm` · `TIER_ID=10546901` · secrets in `.env` (never commit)
- Shared clients: `shared/lib` (auth, TravelVipClient, signature) · `shared/config`
- Date memory last synced: **2026-10-08**

Unfiltered on purpose: raw reports live **next to each product**. If it is not under a domain `reports/`, we did not keep the receipt.

## Domain map

| Domain | Path | What |
|--------|------|------|
| Inventory | [inventory/](inventory/) | Lounge, FastTrack, Attractions (GlobalTix) availability / sheets |
| Travel APIs | [travel-apis/](travel-apis/) | Hotel, Flight, Cab B2B book packs |
| Byufuel | [byufuel/](byufuel/) | UCO / admin / WH-TSM validates · Tracker QA-19 |
| MCP / UI | [mcp/](mcp/) | Playwright MCP session dumps (UI evidence) |
| Other | [other/](other/) | eSIM, Entertainer, Zenith, Tracker tooling, scratch |
| Shared | [shared/](shared/) | Auth, HTTP client, signing, CLI, validators |
| Postman | [postman/](postman/) | Collections + envs (secrets in `postman/share/` — gitignored) |
| Sheets / PDFs | under each domain `sheets/` + `docs/` | QA CSVs, contracts, lounge/GlobalTix dumps — not at repo root |

### Per-product memory (all agents)

| Product / agent | Memory file | Also from |
|-----------------|-------------|-----------|
| Hotel | [travel-apis/hotel/AGENTS.md](travel-apis/hotel/AGENTS.md) | Merged sibling B2B `AGENTS.md` (2026-10-07) + ENG-299 tripType |
| Flight | [travel-apis/flight/AGENTS.md](travel-apis/flight/AGENTS.md) | Merged B2B pack memory + ENG-297 + QA-24 TBO books |
| Cab | [travel-apis/cab/AGENTS.md](travel-apis/cab/AGENTS.md) | Error-contract / multipax / DOB agent work |
| Inventory | [inventory/AGENTS.md](inventory/AGENTS.md) | Lounge / FastTrack / Attractions inventory agents |
| Byufuel | [byufuel/AGENTS.md](byufuel/AGENTS.md) | + handoff `byufuel/reports/byufuel-drive/` · rule `byufuel-qa-agent.mdc` |
| MCP / UI evidence | [mcp/AGENTS.md](mcp/AGENTS.md) | Alpha-web Lounge/FT/Flight vs Figma (2026-09-10) |
| Other | [other/AGENTS.md](other/AGENTS.md) | eSIM, Entertainer, Zenith ENG-22, Tracker probes |

### Sibling repos (other agents — do not delete; already merged where noted)

| Repo / path | Role |
|-------------|------|
| `D:\Travel VIP B2B API Automation\AGENTS.md` | Hotel+Flight pack source (ALLOW_BOOK, release:gate, RESPSCHEMA, date stepping) — **merged into** travel-apis hotel/flight on 2026-10-08 |
| `D:\tx ui automation\.cursor\rules\` / `D:\tx-ui-automation\.cursor\rules\` | Playwright UI framework rules → Tracker **QA-22** (not copied; pointer in `other/AGENTS.md` + `mcp/AGENTS.md`) |

## Tracker

| Work | Task | URL |
|------|------|-----|
| B2B Hotel + Flight hub | **ENG-290** | https://tracker.travelvip.ai/tasks/ENG-290 |
| TBO flight booking testing (staging vgm) | **QA-24** | https://tracker.travelvip.ai/tasks/QA-24 |
| Flight airports tripType | **ENG-297** | https://tracker.travelvip.ai/tasks/ENG-297 |
| Hotel autocomplete tripType | **ENG-299** | https://tracker.travelvip.ai/tasks/ENG-299 |
| tripType combined release | **ENG-333** | https://tracker.travelvip.ai/tasks/ENG-333 |
| Byufuel / Centvis UCO | **QA-19** | https://tracker.travelvip.ai/tasks/QA-19 |
| UI Automation (Playwright) | **QA-22** | https://tracker.travelvip.ai/tasks/QA-22 |

After a testing day: Activity on **ENG-290** (and **QA-24** when TBO books). New product bugs → separate ENG/QA tasks.

## How to work (all API domains)

1. Valid baseline payload → clone → mutate one field → call API.
2. **PASS** = HTTP status + `error.code` match docs (branch on code, not message).
3. **BUG** = invalid accepted, wrong code/envelope, or HTTP 500 on bad input.
4. **NOT TESTED** ≠ fail (inventory missing, Inprogress left, tag not run).
5. Special chars / HTML → **4xx + error.code**, never 500, never 200 accept.
6. Never leak **Riya** in fareRules / bookingCode. Do not commit `.env`.

### Auth hop

1. `POST /auth/partner/token` → access + refresh  
2. `POST /v1/auth/session` + `X-Partner-Key` + `{ tierId }` → auth_token  
3. Product: `Authorization: Bearer {auth_token}` + `X-Partner-Key`  
Pin one `X-Correlation-ID` for the session.

### Signing (Postman)

`HMAC-SHA256(body + timestamp, signing_key)` → `X-Signature`.  
Sharing collection without env **`signing_key`** → invalid signature. Use `postman/share/` env pack (gitignored) or set staging signing key in the active environment.

## Commands (entrypoints)

| Command | Domain |
|---------|--------|
| `npm run hotel:regression` / `:smoke` / `:validate` / `:deploy` / `:negprice` | Hotel |
| `npm run flight:regression` / `:smoke` / `:validate` | Flight |
| `npm run b2b:regression` / `:smoke` | Hotel then Flight |
| `npm run probe:flight:faretypes` | Flight |
| `npm run cab:regression:validate:staging` | Cab |
| `npm run report:lounge` / `report:fasttrack` | Inventory |

## Jul → Oct 2026 (high-level)

| Month | Focus |
|-------|--------|
| **Jul** | Flight/hotel seed books; early lounge/cab/eSIM/fast-track smoke |
| **Aug** | Hotel listing/VALIDATE/PAN-GST/E2E; deploy packs UNAVAIL/STARSRP/CHAINBRAND/NEGPRICE; Flight per-pax cancel, SSR, fareTypes; Postman signing; DB mapping start |
| **Sep** | Hotel filters/ranking preprod↔prod; Cab error-contract + multipax/DOB; seat-guard; wallet; ENG-290 hub; Flight DB map |
| **Oct** | Hotel + Flight **tripType**; TBO staging books → QA-24; Postman share pack; lounge/fasttrack inventory; domain reframe → this layout |

## Oct 2026 highlights (must know)

### tripType
- Flight airports: `GET /v1/flights/airports?tripType=domestic|international` — domestic = India-only; international or omit = unfiltered; legacy `domestic=` is a no-op. Staging **33 PASS / 0 BUG** + leak scan **29 PASS** (2026-10-01) · ENG-297.
- Hotel autocomplete: `tripType` staging **44 PASS / 0 BUG** · ENG-299.

### TBO live books (api-staging vgm) — QA-24

| Booking ID | Trip | Route | Pax | Ancillary | Status |
|---|---|---|---|---|---|
| BR1791300381444156 | OW domestic | BOM–GOI | 2 ADT | seat+meal+bag | Confirmed |
| BR1791300463267996 | RT domestic | BOM–BLR | 2 ADT | seat+meal+bag | Confirmed |
| BR1791300499871517 | RT international | DEL–DXB | 2 ADT | seat+meal+bag | Confirmed |

OW intl DEL–DXB Failed (no PNR; cancel → `PNR_NOT_FOUND`). No Mattermost `vendor-alerts-dev` post for that BR. When user says do not loop: **stop + check Mattermost by BR**. `INSUFFICIENT_BALANCE` on issue → abort remaining cases.

## Layout reminder

```text
inventory/   lounge | fasttrack | attractions
travel-apis/ hotel | flight | cab
byufuel/
mcp/
other/       esim | entertainer | zenith | tracker | _scratch
shared/      lib | config | cli | validators
postman/
```
