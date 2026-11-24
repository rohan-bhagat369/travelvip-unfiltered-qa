-- =============================================================================
-- delta-api flight sanity — DB mapping (travelx)
-- Paste in phpMyAdmin → select database travelx → SQL tab
-- Ignore #1142 pma__recent ACL noise.
--
-- BRs (API status now Cancelled):
--   BR1795011222488918  OW PNQ→DEL   PNR SIM-WOOP5J
--   BR1795011229391989  RT PNQ↔DXB   PNR SIM-ASVFSY
--
-- Expect:
--   A: 1 booking → 1 flight booking_item → journeys (OW=1 / RT=2) → 1 pax → cells=journeys×pax
--   Status: item + FJP cells Cancelled (not stuck Confirmed)
--   booking.cancelled_at SET
--   cancellation_request present
--   payment totals ≈ booking/item (paise)
-- =============================================================================

USE travelx;

-- ========== 1) OW Cancelled — BR1795011222488918 ==========
SET @br := 'BR1795011222488918';
SELECT id INTO @booking_id FROM booking WHERE booking_reference = @br;
SELECT bi.id INTO @booking_item_id
FROM booking_item bi
WHERE bi.booking_id = @booking_id
  AND bi.service_type IN ('flight', 'flights', 'FLIGHT', 'FLIGHTS')
LIMIT 1;

SELECT 'OW' AS case_label, @br AS br, @booking_id AS booking_id, @booking_item_id AS booking_item_id;

-- A1 booking
SELECT id, booking_reference, confirmed_at, cancelled_at, created_at, total_amount
FROM booking WHERE booking_reference = @br;

-- A2 item + status
SELECT bi.id AS booking_item_id, bi.service_type, bi.version,
       bi.current_status_mapping_id,
       bi.total_amount, bi.currency, bi.vendor_price, bi.vendor_price_cents,
       bsm.status_code, bsm.backend_status, bsm.user_status
FROM booking_item bi
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE bi.booking_id = @booking_id;

-- A3 passengers (no is_lead / role on this travelx schema — use SELECT *)
SELECT bp.*
FROM booking_passenger bp
WHERE bp.booking_id = @booking_id
ORDER BY bp.id;

-- A4 journeys
SELECT fj.id, fj.sequence, fj.direction, fj.origin, fj.destination, fj.airline_pnr, fj.gst_total
FROM flight_journey fj
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence;

-- A5 FJP cells + status
SELECT bp.id AS booking_passenger_id, bp.pax_id, bp.first_name, bp.last_name,
       fj.sequence AS journey_seq, fj.direction, fj.origin, fj.destination,
       fjp.id AS cell_id, fjp.eticket_number, fjp.vendor_pnr, fjp.pnr_override,
       fjp.current_status_mapping_id,
       bsm.status_code, bsm.backend_status, bsm.user_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY bp.id, fj.sequence;

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

-- B3 cancel (no booking_id column on this schema)
SELECT cr.*
FROM cancellation_request cr
WHERE cr.booking_item_id = @booking_item_id
ORDER BY cr.id;

SELECT cp.*, bp.pax_id, bp.first_name, bp.last_name
FROM cancellation_passenger cp
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
WHERE bp.booking_id = @booking_id;

-- B5 SSR (OW had meal)
SELECT 'meal' AS kind, pm.id, pm.booking_passenger_id, pm.code, pm.title, pm.amount
FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
WHERE bp.booking_id = @booking_id;

-- C price + payment
SELECT id, booking_reference, total_amount, confirmed_at, cancelled_at
FROM booking WHERE id = @booking_id;

SELECT id, total_amount, currency, vendor_price, vendor_price_cents,
       (total_amount - IFNULL(vendor_price_cents, 0)) AS gap_paise
FROM booking_item WHERE id = @booking_item_id;

SELECT p.id, p.provider, p.status, p.total_amount, p.currency, p.is_used, p.created_at
FROM payment p WHERE p.booking_id = @booking_id ORDER BY p.id;

SELECT pt.id, pt.payment_id, p.provider, pt.transaction_type, pt.status, pt.amount, pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
WHERE p.booking_id = @booking_id
ORDER BY pt.id;


-- ========== 2) RT Cancelled — BR1795011229391989 ==========
SET @br := 'BR1795011229391989';
SELECT id INTO @booking_id FROM booking WHERE booking_reference = @br;
SELECT bi.id INTO @booking_item_id
FROM booking_item bi
WHERE bi.booking_id = @booking_id
  AND bi.service_type IN ('flight', 'flights', 'FLIGHT', 'FLIGHTS')
LIMIT 1;

SELECT 'RT' AS case_label, @br AS br, @booking_id AS booking_id, @booking_item_id AS booking_item_id;

SELECT id, booking_reference, confirmed_at, cancelled_at, created_at, total_amount
FROM booking WHERE booking_reference = @br;

SELECT bi.id AS booking_item_id, bi.service_type, bi.version,
       bi.current_status_mapping_id,
       bi.total_amount, bi.currency, bi.vendor_price, bi.vendor_price_cents,
       bsm.status_code, bsm.backend_status, bsm.user_status
FROM booking_item bi
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE bi.booking_id = @booking_id;

SELECT bp.*
FROM booking_passenger bp
WHERE bp.booking_id = @booking_id
ORDER BY bp.id;

SELECT fj.id, fj.sequence, fj.direction, fj.origin, fj.destination, fj.airline_pnr, fj.gst_total
FROM flight_journey fj
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence;

SELECT bp.id AS booking_passenger_id, bp.pax_id, bp.first_name, bp.last_name,
       fj.sequence AS journey_seq, fj.direction, fj.origin, fj.destination,
       fjp.id AS cell_id, fjp.eticket_number, fjp.vendor_pnr, fjp.pnr_override,
       fjp.current_status_mapping_id,
       bsm.status_code, bsm.backend_status, bsm.user_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY bp.id, fj.sequence;

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

SELECT cr.*
FROM cancellation_request cr
WHERE cr.booking_item_id = @booking_item_id
ORDER BY cr.id;

SELECT cp.*, bp.pax_id, bp.first_name, bp.last_name
FROM cancellation_passenger cp
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
WHERE bp.booking_id = @booking_id;

SELECT id, booking_reference, total_amount, confirmed_at, cancelled_at
FROM booking WHERE id = @booking_id;

SELECT id, total_amount, currency, vendor_price, vendor_price_cents,
       (total_amount - IFNULL(vendor_price_cents, 0)) AS gap_paise
FROM booking_item WHERE id = @booking_item_id;

SELECT p.id, p.provider, p.status, p.total_amount, p.currency, p.is_used, p.created_at
FROM payment p WHERE p.booking_id = @booking_id ORDER BY p.id;

SELECT pt.id, pt.payment_id, p.provider, pt.transaction_type, pt.status, pt.amount, pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
WHERE p.booking_id = @booking_id
ORDER BY pt.id;
