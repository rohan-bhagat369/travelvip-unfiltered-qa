# flight_journey_passenger cell-model verification

**Env:** canary · DB `travelx` · 2026-08-13  
**Change:** `flight_segment_id` dropped · cell = passenger × journey (leg)  
**Verdict: PASS**

---

## Test cases

| ID | Case | How tested | Expected | Actual | Status |
|---|---|---|---|---|---|
| TC0 | Schema — `flight_segment_id` dropped | `SHOW COLUMNS` + `information_schema` | Column absent / count = 0 | Column absent / count = 0 | **Pass** |
| TC1 | RT connecting → 4 cells | Book + COUNT + matrix | journeys=2, pax=2, cells=4 | 2 / 2 / 4 | **Pass** |
| TC1b | RT direct → 4 cells | Book + COUNT + matrix | journeys=2, pax=2, cells=4 | 2 / 2 / 4 | **Pass** |
| TC2 | OW direct → 2 cells | Book + COUNT + matrix | journeys=1, pax=2, cells=2 | 1 / 2 / 2 | **Pass** |
| TC2b | OW connecting → 2 cells | Book + COUNT + matrix | journeys=1, pax=2, cells=2 | 1 / 2 / 2 | **Pass** |
| TC3 | Connecting ≠ segments × pax | OW/RT connecting cell count | cells = journeys × pax | OW conn cells=2; RT conn cells=4 | **Pass** |
| TC4 | Data quality | Inspect cell rows | FKs set; eticket per pax; vendor_pnr set; pnr_override NULL | All met on all 4 BRs | **Pass** |
| TC5 | UNIQUE(journey, pax) | Duplicate INSERT | Reject duplicate | Not run | **Not tested** |

| Score | Count |
|---|---|
| Pass | 7 |
| Not tested | 1 |
| Fail | 0 |

---

## Pass for OW direct `BR1786561427255395`

| Check | Expected | Actual |
|---|---|---|
| Journeys | 1 | 1 |
| Passengers | 2 | 2 |
| Cells | 2 | 2 |

| Pax | Leg | PNR | Cell | Eticket | vendor_pnr | pnr_override |
|---|---|---|---|---|---|---|
| PAX1 Kabir | ONWARD | JZBNQS | 370 | BX13HH00221-1 | BX13HH0022 | NULL |
| PAX2 Ananya | ONWARD | JZBNQS | 371 | BX13HH00221-2 | BX13HH0022 | NULL |

---

## Pass for OW connecting `BR1786561629552992`

| Check | Expected | Actual |
|---|---|---|
| Journeys | 1 | 1 |
| Passengers | 2 | 2 |
| Cells | 2 | 2 |

| Pax | Leg | PNR | Cell | Eticket | vendor_pnr | pnr_override |
|---|---|---|---|---|---|---|
| PAX1 Dev | ONWARD | KSRJ5J | 392 | BX13HH00331-1 | BX13HH0033 | NULL |
| PAX2 Arjun | ONWARD | KSRJ5J | 393 | BX13HH00331-2 | BX13HH0033 | NULL |

---

## Pass for RT direct `BR1786561521735923`

| Check | Expected | Actual |
|---|---|---|
| Journeys | 2 | 2 |
| Passengers | 2 | 2 |
| Cells | 4 | 4 |

| Pax | Leg | PNR | Cell | Eticket | vendor_pnr | pnr_override |
|---|---|---|---|---|---|---|
| PAX1 Kabir | ONWARD | DS4I2L | 380 | BX13HH00271-1 | BX13HH0027 | NULL |
| PAX2 Ananya | ONWARD | DS4I2L | 382 | BX13HH00271-2 | BX13HH0027 | NULL |
| PAX1 Kabir | RETURN | V9B7TX | 381 | BX13HH00281-1 | BX13HH0028 | NULL |
| PAX2 Ananya | RETURN | V9B7TX | 383 | BX13HH00281-2 | BX13HH0028 | NULL |

---

## Pass for RT connecting `BR1786561552340517`

| Check | Expected | Actual |
|---|---|---|
| Journeys | 2 | 2 |
| Passengers | 2 | 2 |
| Cells | 4 | 4 |

| Pax | Leg | PNR | Cell | Eticket | vendor_pnr | pnr_override |
|---|---|---|---|---|---|---|
| PAX1 Kabir | ONWARD | LSNZ3L | 388 | BX13HH00311-1 | BX13HH0031 | NULL |
| PAX2 Ananya | ONWARD | LSNZ3L | 390 | BX13HH00311-2 | BX13HH0031 | NULL |
| PAX1 Kabir | RETURN | F6WY2K | 389 | BX13HH00321-1 | BX13HH0032 | NULL |
| PAX2 Ananya | RETURN | F6WY2K | 391 | BX13HH00321-2 | BX13HH0032 | NULL |

---

## Pass for schema TC0

| Check | Expected | Actual |
|---|---|---|
| `flight_segment_id` on `flight_journey_passenger` | Absent | Absent |
| `information_schema` count | 0 | 0 |

Columns present: `id`, `flight_journey_id`, `booking_passenger_id`, `vendor_pnr`, `pnr_override`, `eticket_number`, `current_status_mapping_id`, `created_at`, `updated_at`.

---

## Booking summary

| # | Scenario | BR | Expected cells | Actual cells | Status |
|---|---|---|---|---|---|
| 1 | OW direct | `BR1786561427255395` | 2 | 2 | Pass |
| 2 | OW connecting | `BR1786561629552992` | 2 | 2 | Pass |
| 3 | RT direct | `BR1786561521735923` | 4 | 4 | Pass |
| 4 | RT connecting | `BR1786561552340517` | 4 | 4 | Pass |

**Conclusion:** Correct data stored per passenger × per leg after booking on canary.
