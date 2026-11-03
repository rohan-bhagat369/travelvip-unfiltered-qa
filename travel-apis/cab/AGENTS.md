# Cab API — agent memory

Date synced: **2026-10-23**

## Where the hotel/flight-style pack lives

**Cab B2B regression pack is in the sibling B2B project** (same harness as hotel/flight):

| Item | Path |
|------|------|
| Repo | `D:\Travel VIP B2B API Automation` |
| Client / layers | `src/cab/**` |
| Suite | `scripts/cab-regression-suite.js` → `npm run cab:regression` |
| Docs schema baseline | `tests/data/cab/docs-schema-baseline.json` |
| Canonical property names | `tests/data/cab/canonical-properties.json` |
| Agent memory (pack) | `D:\Travel VIP B2B API Automation\AGENTS.md` → **Cab B2B pack** section |
| Tracker hub | **QA-20** (B2B) · also note on **ENG-290** when logging unfiltered days |

```bash
cd "D:\Travel VIP B2B API Automation"
npm run cab:regression:smoke
npm run cab:regression:validate
npm run cab:regression:respschema          # RESPSCHEMA + CONSIST vs api-docs
npm run cab:regression:e2e                # ALLOW_BOOK via --allow-book
```

Tags: `SMOKE`, `AUTH`, `VALIDATE`, `RESPSCHEMA`, `CONSIST`, `CORR`, `E2E`, `CANCEL`.  
`ALLOW_BOOK` defaults **false** (same as hotel/flight).

**RESPSCHEMA / CONSIST:** baseline = [api-docs Cabs](https://api-docs.travelvip.ai/#tag/Cabs). Property renames and cross-API name drift (`price` vs `priceDetail`, etc.) = **BUG**.

---

## This repo (`travel-apis/cab`) — probes & historical evidence

Clients: `travel-apis/cab/src` · Scripts: `travel-apis/cab/scripts` · Reports: `travel-apis/cab/reports`

**Merged from:** cab error-contract / property-matrix / multipax / DOB agents (Sep 2026 staging). Prefer promoting new cases into the **B2B pack** above; keep one-shot probes here for deep dives.

### Error contract (VALIDATE seed)

| Artifact | Path |
|---|---|
| Full contract (93 rows) | `travel-apis/cab/src/regression/cab-error-contract-full.json` |
| Runnable cases | `travel-apis/cab/src/regression/errorContractCases.js` |
| Runner | `travel-apis/cab/src/regression/runErrorContract.js` |
| Docs | `docs/CAB-API-ERROR-CONTRACT.md` |

```bash
npm run cab:regression:validate:staging
```

Open bugs (Sep 2026): **HI-1** omit `userId` → HTTP 200; omit/empty DOB still books; age vs `paxType`; garbage `priceId`; cancel HTML reason.

### Property matrix / flow audit (pre-pack schema)

- `probe-cab-property-matrix.js` → `reports/cab-property-matrix.json` (Postman trees — superseded as baseline by B2B docs JSON)
- `probe-cab-flow-all-types.js` → E2E × 4 journey types
- Multipax / DOB / lead-time probes under `scripts/probe-cab-*.js`

### Product conventions

- Search/fare pricing field is **`priceDetail`** (not `price`)
- Flight-style auth hop + `X-Partner-Key` on finalize/cancel
- Tracking docs path singular `/cab/tracking/`; live often `/cabs/tracking/`

## When the user asks for a change

- Prefer **B2B pack layers** (`D:\Travel VIP B2B API Automation\src\cab\regression\layers`) for new VALIDATE / RESPSCHEMA / CONSIST / E2E cases.
- Update `docs-schema-baseline.json` / `canonical-properties.json` when api-docs change.
- Clone → mutate one field → branch on `error.code`.
- Do not commit `.env`. Do not commit unless the user asks.
