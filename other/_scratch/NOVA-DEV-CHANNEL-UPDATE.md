**Nova (Node) vs Canary (existing Dev) — QA sanity | 2026-11-18 (retested ~17:14 IST)**

**Env**
- Node: `https://dev-nova-api.travelvip.ai`
- Existing Dev: `https://canary-api.travelvip.ai`
- Partner: `vgm` · tierId: `10546901`
- Collection: nova-api Postman + nova-api_dev env

---

### Issue 1 — BLOCKER: Node session rejects valid tierId

Auth hop works until session.

| Step | Canary | Node |
|------|--------|------|
| `POST /auth/partner/token` | 200 | 200 |
| `GET /v1/tiers` (X-Partner-Key) | 200 → `[10546901]` | 200 → `[10546901]` |
| `POST /v1/auth/session` body `{"tierId":10546901}` | **200** `auth_token` | **400** |

**Node response:**
```json
{
  "status": "error",
  "code": "PARTNER_AUTH_SESSION_ERROR",
  "message": "Invalid tierId",
  "details": {}
}
```

**Why this is a bug:** Node itself returns tier `10546901` from `/v1/tiers` for the same partner token, then rejects that same tierId on session. Canary accepts it.

**Impact:** Cannot mint `auth_token` on Node alone → Flight/Hotel/Cab calls that need Bearer session JWT are blocked for normal partner flow.

**Ask:** Please check Node session/tier resolution for partner `vgm` (tier listed but rejected). Retested twice today — still failing.

---

### Issue 2 — Flight search behaviour / error mapping mismatch

`POST /v1/flights/search?lang=en&currency=INR&page=0&perpage=20`

**Body (same on both):**
```json
{
  "itinerary": [{ "origin": "DEL", "destination": "BOM", "date": "<+25d>" }],
  "travellers": { "adults": 1, "children": 0, "infants": 0 },
  "cabinClass": "ECONOMY",
  "journeyType": "ONE_WAY",
  "currency": "INR",
  "language": "en",
  "preferences": { "airlines": [], "maxStops": 2, "refundableOnly": false },
  "appliedFilters": {},
  "selection": { "selectedSearchIds": [] }
}
```

| Side | HTTP | Result |
|------|------|--------|
| Canary | **400** | `error.code = VENDOR_ERROR` · `Search failed.` |
| Node | **200** | Success · `progress.state = COMPLETE` · flights in `results[]` |

Also with `fareType: "CORPORATE"` both returned 400 but **different codes**:
- Canary → `VENDOR_ERROR`
- Node → `NO_FLIGHTS_FOUND`

**Ask:** Confirm intended contract — should empty/vendor failure normalize to `NO_FLIGHTS_FOUND`, or passthrough `VENDOR_ERROR`? Success envelope on Node includes `progress` / `tripType` / `totalResults: { ONWARD: N }` — please confirm this matches the PHP contract clients expect.

---

### What looks OK (parity)

| Area | Endpoints | Result |
|------|-----------|--------|
| Flight meta | airports, citySearch | Both 200 · same shape |
| Hotels | autocomplete, search | Both 200 · same shape (e.g. Mumbai CITY search both totalResults=527) |
| Cabs | locations, search | Both 200 · same shape (rental search both 9 cabs) |

---

**Note:** Product comparisons on Node were run using a Canary-minted `auth_token` + Node partner key (workaround only). Native Node session is still broken.

CC: please fix Issue 1 first so we can re-verify end-to-end on Node without the JWT workaround.
