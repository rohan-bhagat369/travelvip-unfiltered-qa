-- =============================================================================
-- Flight booking DB mapping pack (full checklist)
-- Paste in phpMyAdmin → select travelx → SQL → Go
-- Change @br only.
-- =============================================================================

USE travelx;

SET @br := 'BR1790075773101525';

-- Resolve ids once
SELECT b.id INTO @booking_id
FROM booking b WHERE b.booking_reference = @br;

SELECT bi.id INTO @booking_item_id
FROM booking_item bi
WHERE bi.booking_id = @booking_id
  AND bi.service_type IN ('flight', 'flights', 'FLIGHT', 'FLIGHTS')
LIMIT 1;

-- ---------------------------------------------------------------------------
-- A) CORE MAPPING (must PASS)
-- ---------------------------------------------------------------------------

-- A1) booking — booking_reference, confirmed_at
SELECT
  id,
  booking_reference,
  confirmed_at,
  cancelled_at,
  created_at
FROM booking
WHERE booking_reference = @br;
-- Expect: 1 row; confirmed_at NOT NULL if Confirmed

-- A2) booking_item — flight item + version (optimistic lock)
SELECT
  bi.id AS booking_item_id,
  bi.booking_id,
  bi.service_type,
  bi.version,
  bi.current_status_mapping_id,
  bsm.code AS item_status
FROM booking_item bi
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE bi.booking_id = @booking_id;
-- Expect: 1 flight item; version >= 1; status Confirmed (or Cancelled if cancelled)

-- A3) booking_passenger — pax rows, lead, names
SELECT
  bp.id,
  bp.pax_id,
  bp.title,
  bp.first_name,
  bp.last_name,
  bp.gender,
  bp.dob,
  bp.passenger_type,
  bp.is_lead,
  bp.nationality
FROM booking_passenger bp
WHERE bp.booking_id = @booking_id
ORDER BY bp.id;
-- Expect: N pax rows; exactly 1 is_lead = 1; names match API

-- A4) flight_journey — 1 row per leg (OW=1, RT=2)
SELECT
  fj.id AS journey_id,
  fj.sequence,
  fj.origin,
  fj.destination,
  fj.airline_pnr,
  fj.stops
FROM flight_journey fj
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence;
-- Expect: OW → 1 row; RT → 2 rows (seq 1,2)

-- A5) flight_journey_passenger — cells = pax × journey; PNR / eticket / vendor_pnr / pnr_override
SELECT
  bp.pax_id,
  bp.first_name,
  bp.last_name,
  bp.is_lead,
  fj.sequence AS journey_seq,
  fj.origin,
  fj.destination,
  fjp.id AS cell_id,
  fjp.eticket_number,
  fjp.vendor_pnr,
  fjp.pnr_override,
  fjp.current_status_mapping_id,
  bsm.code AS cell_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY bp.pax_id, fj.sequence;
-- Expect: Confirmed cells have vendor_pnr and/or eticket_number

-- A6) Cell-model scorecard (PASS if cells = journeys × pax)
SELECT
  @br AS booking_reference,
  COUNT(DISTINCT fj.id) AS journeys,
  COUNT(DISTINCT bp.id) AS pax,
  COUNT(fjp.id) AS cells,
  COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) AS expected_cells,
  CASE
    WHEN COUNT(fjp.id) = COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id)
    THEN 'PASS'
    ELSE 'BUG'
  END AS cell_model
FROM flight_journey fj
JOIN booking_passenger bp ON bp.booking_id = @booking_id
LEFT JOIN flight_journey_passenger fjp
  ON fjp.flight_journey_id = fj.id
 AND fjp.booking_passenger_id = bp.id
WHERE fj.booking_item_id = @booking_item_id;
-- Expect: cell_model = PASS  (one booking → one item → journeys × pax cells)

-- ---------------------------------------------------------------------------
-- B) ALSO QUERIED
-- ---------------------------------------------------------------------------

-- B1) booking_status_mapping — via current_status_mapping_id on cells (+ item)
SELECT
  'item' AS scope,
  bi.id AS ref_id,
  bi.current_status_mapping_id,
  bsm.code,
  bsm.id AS mapping_id
FROM booking_item bi
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE bi.id = @booking_item_id

UNION ALL

SELECT
  'cell' AS scope,
  fjp.id AS ref_id,
  fjp.current_status_mapping_id,
  bsm.code,
  bsm.id AS mapping_id
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id;

-- B2) flight_segment — connecting ≠ segments × pax
--     (segments belong to journey, NOT multiplied by passenger count)
SELECT
  fj.sequence AS journey_seq,
  fj.origin,
  fj.destination,
  fj.stops AS journey_stops,
  COUNT(fs.id) AS segment_count
FROM flight_journey fj
LEFT JOIN flight_segment fs ON fs.flight_journey_id = fj.id
WHERE fj.booking_item_id = @booking_item_id
GROUP BY fj.id, fj.sequence, fj.origin, fj.destination, fj.stops
ORDER BY fj.sequence;
-- Expect: connecting journey → segment_count > 1; still NOT × pax

SELECT
  fs.id,
  fj.sequence AS journey_seq,
  fs.sequence AS seg_seq,
  fs.airline_code,
  fs.flight_number,
  fs.origin,
  fs.destination,
  fs.departure_at,
  fs.arrival_at
FROM flight_segment fs
JOIN flight_journey fj ON fj.id = fs.flight_journey_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence, fs.sequence;

-- B3) cancellation_request — full / partial / return-leg cancel
SELECT
  cr.*
FROM cancellation_request cr
WHERE cr.booking_item_id = @booking_item_id
   OR cr.booking_id = @booking_id
ORDER BY cr.id;
-- Expect: empty if never cancelled; else rows for full / partial / return-leg

-- B4) cancellation_passenger — which pax cancelled
SELECT
  cp.*,
  bp.pax_id,
  bp.first_name,
  bp.last_name
FROM cancellation_passenger cp
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
WHERE bp.booking_id = @booking_id
ORDER BY cp.id;
-- Expect: empty if no cancel; else only cancelled pax

-- B5) SSR — passenger_meal / passenger_baggage / passenger_seat (B07)
SELECT 'meal' AS kind, pm.*
FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
WHERE bp.booking_id = @booking_id;

SELECT 'baggage' AS kind, pb.*
FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
WHERE bp.booking_id = @booking_id;

SELECT 'seat' AS kind, ps.*
FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
WHERE bp.booking_id = @booking_id;
-- Expect: empty if no SSR booked; else match API ancillary

-- B6) booking_item_flight — schema: no leftover refresh%
SHOW COLUMNS FROM booking_item_flight LIKE 'refresh%';
-- Expect: 0 rows (no leftover refresh% columns)

SELECT bif.*
FROM booking_item_flight bif
WHERE bif.booking_item_id = @booking_item_id;
-- Expect: 0 or 1 row linked to this item (if table used)

-- B7) payment_transaction — schema amount type + rows
SHOW COLUMNS FROM payment_transaction LIKE 'amount';
-- Expect: amount type as designed (e.g. decimal/bigint — note actual type)

SELECT
  pt.id,
  pt.status,
  pt.amount,
  pt.txn_type,
  pt.created_at
FROM payment_transaction pt
WHERE pt.booking_id = @booking_id
ORDER BY pt.id;

-- ---------------------------------------------------------------------------
-- C) SCHEMA-ONLY (columns exist / not full row mapping)
-- ---------------------------------------------------------------------------

SHOW COLUMNS FROM booking LIKE 'notify%';
SHOW COLUMNS FROM booking_item LIKE 'notify%';
SHOW COLUMNS FROM booking_item LIKE 'vendor_price%';
-- Note results: which notify% / vendor_price% columns exist (schema audit only)

-- ---------------------------------------------------------------------------
-- D) QUICK VERDICT (run last)
-- ---------------------------------------------------------------------------
SELECT
  @br AS booking_reference,
  (SELECT COUNT(*) FROM booking WHERE id = @booking_id) AS booking_rows,
  (SELECT COUNT(*) FROM booking_item WHERE booking_id = @booking_id) AS item_rows,
  (SELECT COUNT(*) FROM booking_passenger WHERE booking_id = @booking_id) AS pax_rows,
  (SELECT COUNT(*) FROM flight_journey WHERE booking_item_id = @booking_item_id) AS journey_rows,
  (SELECT COUNT(*) FROM flight_journey_passenger fjp
     JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
    WHERE fj.booking_item_id = @booking_item_id) AS cell_rows,
  (SELECT COUNT(*) FROM flight_journey WHERE booking_item_id = @booking_item_id)
    * (SELECT COUNT(*) FROM booking_passenger WHERE booking_id = @booking_id) AS expected_cells,
  CASE
    WHEN (SELECT COUNT(*) FROM booking WHERE id = @booking_id) = 1
     AND (SELECT COUNT(*) FROM booking_item WHERE booking_id = @booking_id
            AND service_type IN ('flight','flights','FLIGHT','FLIGHTS')) = 1
     AND (SELECT COUNT(*) FROM flight_journey_passenger fjp
            JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
           WHERE fj.booking_item_id = @booking_item_id)
         = (SELECT COUNT(*) FROM flight_journey WHERE booking_item_id = @booking_item_id)
           * (SELECT COUNT(*) FROM booking_passenger WHERE booking_id = @booking_id)
    THEN 'PASS — 1 booking → 1 flight item → cells = journeys × pax'
    ELSE 'BUG — check A1–A6'
  END AS mapping_verdict;
