# Nova vs Canary — Live booking results

**When:** 2026-11-18 ~18:50 IST  
**Node:** `https://dev-nova-api.travelvip.ai`  
**Canary:** `https://canary-api.travelvip.ai`  
**Partner:** `vgm` · tier `10546901`  
**Auth:** Node session still **400 Invalid tierId** → used Canary JWT + Node partner key for Node calls

---

## Breaking / result table (for devs)

| # | Product | Step | Canary (expected) | Node (actual) | Verdict |
|---|---------|------|-------------------|---------------|---------|
| 1 | **Hotel** | `POST /v1/hotels/finalize-booking` | **200** `Pending` → polled **Confirmed** · BR `BR1795007972937588` | **500** `{"status":500,"info":"Internal Server Error"}` · no BR | **BUG** |
| 2 | **Cab** | `POST /v1/airportServices/cabs/finalize-booking` | **200** BR `BR1795007994308980` · status **Pending** | **200** BR `BR1795008039742961` · status **Failed** | **DIFF** (Node book created but Failed) |
| 3 | **Flight** | search → pricing → `POST /v1/flights/booking/issue-ticket` | Search **400** `VENDOR_ERROR` (no inventory / vendor) → book not reached | Search+pricing **200**; issue-ticket **502** `TICKET_ISSUANCE_FAILED` · error also returns `bookingReference=BR1795008045715639` | **BUG** on Node issue-ticket (Canary blocked earlier at search) |

---

## Exact Node failures

### Hotel finalize — 500
```json
{"status":500,"info":"Internal Server Error"}
```
Same Sofitel Mumbai inventory path that **Confirmed on Canary**. Wrong envelope (no `error.code`).

### Cab finalize — book Failed
- Canary: `BR1795007994308980` · Pending  
- Node: `BR1795008039742961` · **Failed**  
Finalize HTTP both 200 with `bookingRefId` — outcome status differs.

### Flight issue-ticket — 502
```json
{
  "error": {
    "code": "TICKET_ISSUANCE_FAILED",
    "message": "Ticket issuance failed",
    "bookingReference": "BR1795008045715639"
  }
}
```
Note: Node search+pricing worked; Canary search stayed `VENDOR_ERROR` for same routes/dates.

---

## Request payloads used (book)

| Product | Flow | Request keys |
|---------|------|--------------|
| Hotel | search → details → prebook → **finalize-booking** | `bookingContext, bookingCode, requestId, checkin, checkout, rooms, contact` (+ PAN) |
| Cab | search → fare → **finalize-booking** | `bookingReference, priceId, passengers, contact, otherDetails` |
| Flight | search → details → pricing → **issue-ticket** | `type, currency, language, bookingReference, searchIds, journeyType, timezone, data` |

---

## Still open from earlier (non-book)

| Issue | Status |
|-------|--------|
| `POST /v1/auth/session` Invalid tierId | Still broken |
| `GET /v1/hotels/bookings/history` Node 500 | Still broken |

Raw: `other/_scratch/nova-live-book-report.json`
