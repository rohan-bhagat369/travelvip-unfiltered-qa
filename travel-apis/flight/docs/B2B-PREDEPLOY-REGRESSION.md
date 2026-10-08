# B2B pre-deploy regression

Partner pack for TravelVIP hotel + flight APIs. **Reschedule is out of pack.**

Copy `.env.example` → `.env` with partner secrets. Never commit `.env`.

```powershell
$env:BASE_URL='https://api-staging.travelvip.ai'
$env:TIER_ID='10546901'
npm install
```

## Commands

| Command | What it runs |
|---|---|
| `npm run b2b:regression` | Hotel then flight (full pack, includes 1 hotel book + 1 flight book) |
| `npm run b2b:regression:smoke` | Autocomplete/search/encrypt/correlation only — **no book** |
| `npm run hotel:regression` | Hotel only |
| `npm run flight:regression` | Flight only |
| `npm run probe:flight:faretypes` | fareTypes facet + filter on `POST /v1/flights/search` (OW+RT) — see `docs/FLIGHT-SEARCH-FARETYPES.md` |

Changelog → `--tags`:

| Change | Command |
|---|---|
| Smoke / correlation headers | `--tags SMOKE,CORR` |
| Flight fareTypes search filter | `flight:regression --tags SEARCH` or `npm run probe:flight:faretypes` |
| Hotel listing sort/filter | `hotel:regression --tags LISTING,STARBOOK` |
| Payload validators | hotel `--tags AUTH,VALIDATE,PAN,GST` · flight `--tags AUTH,VALIDATE` |
| Auth (partner token / refresh / user session) | `--tags AUTH` |
| Encryption / vendor leak | hotel `--tags ENCRYPT` |
| Price / confirm book | `--tags E2E,PRICE` |
| Hotel deploy pack (rows 157–224) | `npm run hotel:regression:deploy` or `--tags UNAVAIL,STARSRP,CHAINBRAND,CHAINBRANDVAL` |
| Hotel no-avail / star SRP / chain filters | `--tags UNAVAIL` · `--tags STARSRP` · `--tags CHAINBRAND` · `--tags CHAINBRANDVAL` |
| Hotel no negative prices (baseFare / breakup) | `--tags NEGPRICE` or `npm run hotel:regression:negprice` |

Exit **1** if any row is **BUG**. **NOT TESTED** is not a fail.

Reports: `reports/hotel-regression-<env>-<date>.*` and `reports/flight-regression-<env>-<date>.*` (json / md / html / xlsx). Latest copies under `reports/hotel-regression/latest.*` and `reports/flight-regression/latest.*`.

## Defaults

- Hotel book fixture: Hilltop Mumbai `39627872`, PAN `EUIPB1672M` / Rohan Bhagat
- Flight E2E books: OW 1ADT, RT 1ADT, intl OW 2ADT + passport, OW 1ADT with **seat + meal + baggage** SSR, plus an OW with **`onlineCancellation: true`** used only for penalty → cancel (booking status becomes **Cancelled**; `Cancellation Requested` is not a booking status)
- If flight status is **Inprogress**, leave that BR, retry **once** with new names **and different travel dates**, then poll the second BR until Confirmed / Inprogress / Failed / Cancelled and stop
- `X-Correlation-ID` is pinned for the session

## fareTypes filter (SEARCH)

**Not** SEARCH `fare.1` (`fareType=CORPORATE`) and **not** VALIDATE `S8` (`fareType=GARBAGE`). Those are request enum. These cases are **`filters.*.fareTypes` facet** + **`appliedFilters.*.fareTypes`**.

| Role | Path |
|---|---|
| Probe | `scripts/probe-flight-search-faretypes-filter.js` (or alias `probe-flight-v2-faretypes-filter-canary.js`) |
| Spawn | `src/flight/regression/layers/search.js` (`--tags SEARCH`) |
| Case IDs | FT.1–FT.INTL2 in `AGENTS.md` → Flight SEARCH → fareTypes filter |
| How-to | `docs/FLIGHT-SEARCH-FARETYPES.md` |

Path under test: **`POST /v1/flights/search`**. Mag `POST /api/flights/catalog-v2/search` is **out of pack**.
