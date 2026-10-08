-- zeta-api flight DB mapping checks
-- Paste in phpMyAdmin against travelx (or the zeta DB schema if different).
USE travelx;

SELECT b.booking_reference, b.confirmed_at, b.cancelled_at, COUNT(DISTINCT bi.id) AS items
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977')
GROUP BY b.id, b.booking_reference, b.confirmed_at, b.cancelled_at;

SELECT b.booking_reference, bi.id AS booking_item_id, bi.service_type, bi.version, bsm.code AS item_status
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977');

SELECT b.booking_reference, bp.pax_id, bp.first_name, bp.last_name, bp.is_lead, bp.passenger_type
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977')
ORDER BY b.booking_reference, bp.pax_id;

SELECT b.booking_reference, fj.id AS journey_id, fj.sequence, fj.origin, fj.destination, fj.airline_pnr
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977')
ORDER BY b.booking_reference, fj.sequence;

SELECT
  b.booking_reference,
  bp.pax_id,
  fj.sequence AS journey_seq,
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
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977')
ORDER BY b.booking_reference, bp.pax_id, fj.sequence;

SELECT
  b.booking_reference,
  COUNT(DISTINCT fj.id) AS journeys,
  COUNT(DISTINCT bp.id) AS pax,
  COUNT(fjp.id) AS cells,
  COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) AS expected_cells
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
JOIN flight_journey fj ON fj.booking_item_id = bi.id
JOIN booking_passenger bp ON bp.booking_id = b.id
LEFT JOIN flight_journey_passenger fjp
  ON fjp.flight_journey_id = fj.id AND fjp.booking_passenger_id = bp.id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977')
GROUP BY b.booking_reference;

SELECT b.booking_reference, pm.*
FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977');

SELECT b.booking_reference, pb.*
FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977');

SELECT b.booking_reference, ps.*
FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977');

SELECT b.booking_reference, pt.id, pt.status, pt.amount, pt.txn_type
FROM payment_transaction pt
JOIN booking b ON b.id = pt.booking_id
WHERE b.booking_reference IN ('BR1789649949228838', 'BR1789650033245160', 'BR1789650093559430', 'BR1789650450419977');
