# MCP / UI evidence — agent memory

**Synced:** **2026-10-08**  
Playwright MCP session dumps and UI page captures. **Not** API regression packs.

## Paths
- Sessions / consoles / page YAML: `mcp/reports/playwright-mcp/`
- Alpha-web Lounge/FastTrack/Flight vs Figma: `mcp/reports/alpha-web-lounge-fasttrack-flight-ui.md`

## Agent history (other UI agent)

### Alpha-web desktop (2026-09-10)
- Env: https://alpha-web.travelvip.ai/ · viewport 1440×900 · guest auth
- Scope: Lounge + FastTrack + Flight membership landings (search pages out of scope)
- Score: **7 PASS / 1 BUG / 4 NOT TESTED**
- **BUG:** FastTrack membership `/membership/10565135` missing How it works / Disclaimer / body vs Lounge template
- Flight Book Now opens `/flight-booking/v2/search` shell — PASS (search NOT TESTED)
- Figma: UI UX Flows Sept 2025 node `5808-47325`

## Rules
1. Treat MCP dumps as **evidence**, not as pass/fail for API packs.
2. When user asks UI vs Figma, read the alpha-web note first, then new Playwright captures.
3. Tracker for dedicated UI automation work: **QA-22** (separate Playwright repo / tx-ui rules).
