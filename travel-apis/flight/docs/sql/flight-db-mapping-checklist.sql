-- =============================================================================
-- Flight DB mapping checklist — travelx
-- Docs: docs/FLIGHT-DB-MAPPING-CHECKS.md
-- Change @br only. Prefer pinning numeric ids after A1/A2.
-- =============================================================================

USE travelx;

SET @br := 'BR1790243528138745';  -- <-- change me

SELECT id INTO @booking_id FROM booking WHERE booking_reference = @br;
SELECT bi.id INTO @booking_item_id
FROM booking_item bi
WHERE bi.booking_id = @booking_id
  AND bi.service_type IN ('flight', 'flights', 'FLIGHT', 'FLIGHTS')
LIMIT 1;

SELECT @br AS br, @booking_id AS booking_id, @booking_item_id AS booking_item_id;

-- A1 booking
SELECT id, booking_reference, confirmed_at, cancelled_at, created_at, total_amount
FROM booking WHERE booking_reference = @br;

-- A2 item + status (status_code NOT code)
SELECT bi.id AS booking_item_id, bi.service_type, bi.version,
       bi.current_status_mapping_id,
       bi.total_amount, bi.currency, bi.vendor_price, bi.vendor_price_cents,
       bsm.status_code, bsm.backend_status, bsm.user_status
FROM booking_item bi
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE bi.booking_id = @booking_id;

-- A3 passengers (date_of_birth / role — not dob / passenger_type)
SELECT bp.id, bp.pax_id, bp.title, bp.first_name, bp.last_name, bp.gender,
       bp.date_of_birth, bp.is_lead, bp.nationality, bp.role
FROM booking_passenger bp
WHERE bp.booking_id = @booking_id
ORDER BY bp.id;

-- A4 journeys (no stops column)
SELECT fj.id, fj.sequence, fj.direction, fj.origin, fj.destination, fj.airline_pnr, fj.gst_total
FROM flight_journey fj
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence;

-- A5 FJP cells
SELECT bp.pax_id, bp.first_name, bp.last_name, bp.is_lead,
       fj.sequence AS journey_seq, fj.direction, fj.origin, fj.destination,
       fjp.id AS cell_id, fjp.eticket_number, fjp.vendor_pnr, fjp.pnr_override,
       fjp.current_status_mapping_id,
       bsm.status_code, bsm.backend_status, bsm.user_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY bp.pax_id, fj.sequence;

-- A6 cell model
SELECT
  @br AS booking_reference,
  COUNT(DISTINCT fj.id) AS journeys,
  COUNT(DISTINCT bp.id) AS pax,
  COUNT(fjp.id) AS cells,
  COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) AS expected_cells,
  CASE
    WHEN COUNT(fjp.id) = COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) THEN 'PASS'
    ELSE 'BUG'
  END AS cell_model
FROM flight_journey fj
JOIN booking_passenger bp ON bp.booking_id = @booking_id
LEFT JOIN flight_journey_passenger fjp
  ON fjp.flight_journey_id = fj.id AND fjp.booking_passenger_id = bp.id
WHERE fj.booking_item_id = @booking_item_id;

-- B2 segments (optional)
SELECT fj.sequence AS journey_seq, COUNT(fs.id) AS segment_count
FROM flight_journey fj
LEFT JOIN flight_segment fs ON fs.flight_journey_id = fj.id
WHERE fj.booking_item_id = @booking_item_id
GROUP BY fj.id, fj.sequence
ORDER BY fj.sequence;

SELECT fs.id, fj.sequence AS journey_seq, fs.sequence AS seg_seq,
       fs.airline_code, fs.flight_number, fs.origin, fs.destination
FROM flight_segment fs
JOIN flight_journey fj ON fj.id = fs.flight_journey_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence, fs.sequence;

-- B3/B4 cancel (empty if not cancelled)
SELECT cr.* FROM cancellation_request cr
WHERE cr.booking_item_id = @booking_item_id OR cr.booking_id = @booking_id;

SELECT cp.*, bp.pax_id, bp.first_name, bp.last_name
FROM cancellation_passenger cp
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
WHERE bp.booking_id = @booking_id;

-- B5 SSR
SELECT 'meal' AS kind, pm.* FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
WHERE bp.booking_id = @booking_id;
SELECT 'baggage' AS kind, pb.* FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
WHERE bp.booking_id = @booking_id;
SELECT 'seat' AS kind, ps.* FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
WHERE bp.booking_id = @booking_id;

-- C price + payment (payment has booking_id; payment_transaction does NOT)
SELECT id, booking_reference, total_amount, confirmed_at
FROM booking WHERE id = @booking_id;

SELECT id, total_amount, currency, vendor_price, vendor_price_cents,
       (total_amount - vendor_price_cents) AS gap_paise
FROM booking_item WHERE id = @booking_item_id;

SELECT * FROM payment WHERE booking_id = @booking_id;

SELECT pt.id, pt.payment_id, pt.amount, pt.status, pt.transaction_type,
       p.total_amount AS payment_total_amount, p.currency, p.status AS payment_status
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
WHERE p.booking_id = @booking_id
ORDER BY pt.id;

SHOW COLUMNS FROM payment_transaction LIKE 'amount';

-- D offers (separate tables — not columns on booking/item)
SELECT * FROM booking_item_offer WHERE booking_item_id = @booking_item_id;

SELECT bio.*, o.code, o.name, o.discount_type, o.discount_value
FROM booking_item_offer bio
LEFT JOIN offer o ON o.id = bio.offer_id
WHERE bio.booking_item_id = @booking_item_id;

-- order_discounts is legacy (order_id / order_item_id) — not flight booking_id
SHOW COLUMNS FROM order_discounts;
