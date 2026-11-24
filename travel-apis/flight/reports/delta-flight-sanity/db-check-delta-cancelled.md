# delta-api flight DB check — Cancelled BRs

**DB:** `travelx` (phpMyAdmin)  
**SQL:** `db-check-delta-cancelled.sql`  
**API status now:** both Cancelled

| Case | BR | Route | PNR |
|------|-----|-------|-----|
| OW | `BR1795011222488918` | PNQ→DEL | `SIM-WOOP5J` |
| RT | `BR1795011229391989` | PNQ↔DXB | `SIM-ASVFSY` |

## Expect (Cancelled)

| Check | Expect |
|-------|--------|
| A1 booking | row exists; `confirmed_at` set; **`cancelled_at` SET** |
| A2 item | 1 flight item; status **Cancelled** (not stuck Confirmed) |
| A3 pax | 1 adult; exactly 1 `is_lead=1` |
| A4 journeys | OW=1 · RT=2; `airline_pnr` present |
| A5/A6 cells | cells = journeys × pax; cell status Cancelled |
| B3 cancel | ≥1 `cancellation_request` |
| C money | booking ≈ item ≈ payment totals (paise) |

Paste SQL results here / back in chat for scoring.
