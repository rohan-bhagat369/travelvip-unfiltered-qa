# Alpha-web desktop UI — Lounge / FastTrack / Flight vs Figma

**Env:** https://alpha-web.travelvip.ai/  
**Viewport:** 1440×900 (desktop)  
**Date:** 2026-09-10  
**Tool:** Playwright MCP  
**Figma:** [UI UX Flows from Sept 2025](https://www.figma.com/design/zcHVTFFeuycjKbCukynJNn/UI-UX-Flows-from-Sept-2025?node-id=5808-47325&p=f&t=Lo3HSF6rI2MIiM6t-0) (node `5808-47325`)  
**Scope:** Desktop Lounge + FastTrack + Flight. **Search pages ignored** (Book Now → search noted only).  
**Auth:** Guest (Login not completed)

---

## Score

**7 PASS / 1 BUG / 4 NOT TESTED**

---

## Flows tested

### Home entry
| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Home loads with product tiles incl. Lounge, Fast Track, Flights | Open `/home` | PASS |
| 2 | Attractions tile label | Re-check shows **Attractions** (correct) | PASS |

### Lounge (skip search)
| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Home → Airport Lounge opens membership landing | Click tile → `/membership/10565125` | PASS |
| 2 | Landing has H1 “Airport Lounge”, breadcrumb Home › Membership, Back | Snapshot | PASS |
| 3 | Description + How it works (5 steps) + Disclaimer + Member benefit 10% + Book Now | Snapshot | PASS |
| 4 | Book Now goes to lounge search | `/lounge/search` | PASS (entry only; search UI **NOT TESTED** per scope) |
| 5 | Pixel/layout match Figma Lounge frames | Figma open but frame-level compare not completed | NOT TESTED |

### FastTrack (skip search)
| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Home → Fast Track Immigration opens membership | Click tile → `/membership/10565135` | PASS |
| 2 | H1 + Member benefit 10% Off + Book Now | Snapshot | PASS |
| 3 | Parity with Lounge template: description, How it works, Disclaimer | Main content only: title + member benefit + Book Now — **no How it works / no Disclaimer / almost no body copy** | **BUG** |
| 4 | Book Now → fasttrack search | `/fasttrack/search` | PASS (search **NOT TESTED**) |
| 5 | Match Figma FastTrack frames | Not fully compared | NOT TESTED |

### Flight (deployed; skip deep search)
| # | Rule | How tested | Status |
|---|---|---|---|
| 1 | Home → Flights opens membership | `/membership/10565127` | PASS |
| 2 | Landing has long description, Legal T&C/Disclaimer links, Member benefit, Book Now | Snapshot | PASS |
| 3 | Book Now opens Flight v2 booking shell | `/flight-booking/v2/search` — hero “Effortless Flights Booking – Save More!”, Round Trip / One Way, passengers, airports, dates, Search Flights | PASS (shell only) |
| 4 | Flight **search** form validation / results | Out of scope | NOT TESTED |
| 5 | Match Figma Flight frames | Not fully compared | NOT TESTED |

---

## Bugs (detail)

### 1. FastTrack membership page incomplete vs Lounge pattern
- **Expected (vs Lounge / typical membership design):** Hero description, How it works steps, Disclaimer, member benefit, Book Now  
- **Actual (`/membership/10565135`):** Only title “Fast Track Immigration”, “Member benefit / Fast Track Your Airport Journey – 10% Off”, Book Now — **missing** How it works, Disclaimer, and descriptive body  
- **Lounge control (`/membership/10565125`):** Has full description + How it works 1–5 + Disclaimer + 10% benefit  
- **Status:** BUG (content/design parity)

### Observation (Flight search — not scored deep)
Flight search shell at `/flight-booking/v2/search` loads. A11y snapshot showed sparse/odd labels (e.g. empty CLASS/AIRLINE strings). **Not filed as BUG** until search pass is in scope.

---

## Figma comparison status

- Figma file **opens** in Playwright (design file accessible).  
- Cookie consent + canvas at 2% zoom; **layer/frame names for Lounge/FastTrack/Flight not extracted** for pixel QA this session.  
- Recommend: export Figma desktop frames for membership landings + flight search, or share Dev Mode specs / PNG exports — then do side-by-side screenshot diff in a follow-up.  
- Design link used: https://www.figma.com/design/zcHVTFFeuycjKbCukynJNn/UI-UX-Flows-from-Sept-2025?node-id=5808-47325  

---

## Route map (observed)

| Product | Membership | Book Now → |
|---|---|---|
| Airport Lounge | `/membership/10565125` | `/lounge/search` |
| Fast Track Immigration | `/membership/10565135` | `/fasttrack/search` |
| Flights | `/membership/10565127` | `/flight-booking/v2/search` |

---

## Next (when you want)
1. Full Figma frame-by-frame visual QA (need zoomed frames / exports)  
2. Search + booking flows for Lounge / FastTrack / Flight  
3. Logged-in member benefit % / pricing checks  

---

*Screenshots saved under `reports/playwright-mcp/` (and cwd copies: `alpha-fasttrack-membership.png`, `flights-membership-landing.png`, etc.).*
