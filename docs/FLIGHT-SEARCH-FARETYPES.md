# Flight SEARCH — fareTypes facet + filter

**API:** `POST /v1/flights/search`  
**Not Mag:** `POST /api/flights/catalog-v2/search` is out of pack (404 on canary).  
Prefer pack repo: `D:\Travel VIP B2B API Automation` (also mirrored in this workspace).

## Files

| Role | Path |
|---|---|
| Probe | `scripts/probe-flight-search-faretypes-filter.js` |
| Alias | `scripts/probe-flight-v2-faretypes-filter-canary.js` |
| SEARCH spawn | `src/flight/regression/layers/search.js` |
| Case list (B2B) | `tests/data/flight/search-faretypes.json` |
| Memory | `AGENTS.md` → Flight → SEARCH → **fareTypes filter** |
| Pre-deploy | `docs/B2B-PREDEPLOY-REGRESSION.md` |

## Run

```powershell
$env:BASE_URL='https://canary-api.travelvip.ai'
npm run probe:flight:faretypes
```

Or via pack:

```powershell
npm run flight:regression -- --tags SEARCH
```

Report: `reports/flight-search-faretypes-filter.json`

## Cases (FT.1–FT.INTL2)

See `tests/data/flight/search-faretypes.json` and `AGENTS.md`.  
Not the same as SEARCH fare.1 (`fareType=CORPORATE`) or VALIDATE S8 (`fareType=GARBAGE`).
