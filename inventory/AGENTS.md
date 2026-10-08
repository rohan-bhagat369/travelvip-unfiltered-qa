# Inventory agents — Lounge / FastTrack / Attractions

**Synced:** **2026-10-08**  
Not B2B book packs — sheet + API **availability / catalog** checks.

| Product | Paths | Notes |
|---------|-------|--------|
| Lounge | [lounge/](lounge/) `src` · `scripts` · `reports` · `sheets/` | Availability report, sheet compare, Dragonpass CSVs |
| FastTrack | [fasttrack/](fasttrack/) | Availability report + sheet vs API |
| Attractions | [attractions/](attractions/) · `sheets/` | GlobalTix probes + production product dump CSV |

## Commands
- `npm run report:lounge` → `inventory/lounge/scripts/generate-lounge-availability-report.js`
- `npm run report:fasttrack` → `inventory/fasttrack/scripts/generate-fasttrack-availability-report.js`
- `npm run report:zero-terminals` → `inventory/lounge/scripts/list-zero-count-terminals.js`

## Agent history (preserve)
- Lounge / FastTrack inventory QA (Oct 2026): availability JSON + sheet compare under domain `reports/`
- Attractions: `probe-globaltix-attraction-qa-*.js` — all countries / categories / status
- Combined UI check of Lounge + FastTrack membership landings lives under **mcp** (alpha-web vs Figma), not here

## Rules
1. Inventory failures → **NOT TESTED** or inventory BUG — do not invent hotel/flight pack bugs.
2. Reports stay under `inventory/<product>/reports/`.
