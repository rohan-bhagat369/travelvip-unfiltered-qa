USE travelx;

-- TC0 SCHEMA GATE
SHOW COLUMNS FROM flight_journey_passenger;
SELECT COUNT(*) AS flight_segment_id_cols FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='travelx' AND TABLE_NAME='flight_journey_passenger' AND COLUMN_NAME='flight_segment_id';
-- expect 0

-- ========== OW_2ADT_DIRECT  BR=BR1786561427255395  expect cells=2 ==========
SET @br := 'BR1786561427255395';
SELECT
  (SELECT COUNT(*) FROM flight_journey fj JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS journeys,
  (SELECT COUNT(*) FROM booking_passenger bp JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,
  (SELECT COUNT(*) FROM flight_journey_passenger fjp JOIN flight_journey fj ON fj.id=fjp.flight_journey_id JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells,
  2 AS expected_cells;
SELECT bp.pax_id, bp.first_name, bp.last_name,
       fj.id AS journey_id, fj.direction, fj.sequence, fj.airline_pnr,
       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, bp.pax_id;

-- ========== OW_2ADT_CONNECTING  BR=BR1786561629552992  expect cells=2 ==========
SET @br := 'BR1786561629552992';
SELECT
  (SELECT COUNT(*) FROM flight_journey fj JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS journeys,
  (SELECT COUNT(*) FROM booking_passenger bp JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,
  (SELECT COUNT(*) FROM flight_journey_passenger fjp JOIN flight_journey fj ON fj.id=fjp.flight_journey_id JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells,
  2 AS expected_cells;
SELECT bp.pax_id, bp.first_name, bp.last_name,
       fj.id AS journey_id, fj.direction, fj.sequence, fj.airline_pnr,
       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, bp.pax_id;

-- ========== RT_2ADT_DIRECT  BR=BR1786561521735923  expect cells=4 ==========
SET @br := 'BR1786561521735923';
SELECT
  (SELECT COUNT(*) FROM flight_journey fj JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS journeys,
  (SELECT COUNT(*) FROM booking_passenger bp JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,
  (SELECT COUNT(*) FROM flight_journey_passenger fjp JOIN flight_journey fj ON fj.id=fjp.flight_journey_id JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells,
  4 AS expected_cells;
SELECT bp.pax_id, bp.first_name, bp.last_name,
       fj.id AS journey_id, fj.direction, fj.sequence, fj.airline_pnr,
       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, bp.pax_id;

-- ========== RT_2ADT_CONNECTING  BR=BR1786561552340517  expect cells=4 ==========
SET @br := 'BR1786561552340517';
SELECT
  (SELECT COUNT(*) FROM flight_journey fj JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS journeys,
  (SELECT COUNT(*) FROM booking_passenger bp JOIN booking b ON b.id=bp.booking_id WHERE b.booking_reference=@br) AS passengers,
  (SELECT COUNT(*) FROM flight_journey_passenger fjp JOIN flight_journey fj ON fj.id=fjp.flight_journey_id JOIN booking_item bi ON bi.id=fj.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br) AS cells,
  4 AS expected_cells;
SELECT bp.pax_id, bp.first_name, bp.last_name,
       fj.id AS journey_id, fj.direction, fj.sequence, fj.airline_pnr,
       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, bp.pax_id;

-- ALL FIXTURES
SELECT b.booking_reference, COUNT(DISTINCT fj.id) AS journeys, COUNT(DISTINCT bp.id) AS pax, COUNT(fjp.id) AS cells
FROM booking b
JOIN booking_item bi ON bi.booking_id=b.id
JOIN flight_journey fj ON fj.booking_item_id=bi.id
JOIN booking_passenger bp ON bp.booking_id=b.id
LEFT JOIN flight_journey_passenger fjp ON fjp.flight_journey_id=fj.id AND fjp.booking_passenger_id=bp.id
WHERE b.booking_reference IN ('BR1786561427255395','BR1786561629552992','BR1786561521735923','BR1786561552340517')
GROUP BY b.booking_reference;