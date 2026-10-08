-- Flight DB mapping check for BR1790075773101525
-- phpMyAdmin → select travelx (or staging schema) → SQL tab → Go

USE travelx;

SET @br := 'BR1790075773101525';

-- 1) Booking header
SELECT b.id, b.booking_reference, b.confirmed_at, b.cancelled_at, b.created_at
FROM booking b
WHERE b.booking_reference = @br;

-- 2) Booking item + status
SELECT
  b.booking_reference,
  bi.id AS booking_item_id,
  bi.service_type,
  bi.version,
  bsm.code AS item_status,
  bi.current_status_mapping_id
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- 3) Passengers
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
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br
ORDER BY bp.id;

-- 4) Journeys
SELECT
  fj.id,
  fj.sequence,
  fj.origin,
  fj.destination,
  fj.airline_pnr,
  fj.stops
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence;

-- 5) Segments (skip if flight_segment table missing)
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
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, fs.sequence;

-- 6) FJP cells (1 passenger × 1 journey)
SELECT
  bp.pax_id,
  bp.first_name,
  bp.last_name,
  fj.sequence AS journey_seq,
  fj.origin,
  fj.destination,
  fjp.id AS cell_id,
  fjp.eticket_number,
  fjp.vendor_pnr,
  fjp.pnr_override,
  bsm.code AS cell_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE b.booking_reference = @br
ORDER BY bp.pax_id, fj.sequence;

-- 7) Cell count vs expected (journeys × pax)
SELECT
  b.booking_reference,
  COUNT(DISTINCT fj.id) AS journeys,
  COUNT(DISTINCT bp.id) AS pax,
  COUNT(fjp.id) AS cells,
  COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) AS expected_cells,
  CASE
    WHEN COUNT(fjp.id) = COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) THEN 'PASS'
    ELSE 'BUG'
  END AS cell_model
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
JOIN flight_journey fj ON fj.booking_item_id = bi.id
JOIN booking_passenger bp ON bp.booking_id = b.id
LEFT JOIN flight_journey_passenger fjp
  ON fjp.flight_journey_id = fj.id
 AND fjp.booking_passenger_id = bp.id
WHERE b.booking_reference = @br
GROUP BY b.booking_reference;

-- 8) SSR
SELECT 'meal' AS kind, pm.*
FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;

SELECT 'baggage' AS kind, pb.*
FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;

SELECT 'seat' AS kind, ps.*
FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;

-- 9) Payment
SELECT pt.id, pt.status, pt.amount, pt.txn_type, pt.created_at
FROM payment_transaction pt
JOIN booking b ON b.id = pt.booking_id
WHERE b.booking_reference = @br;
