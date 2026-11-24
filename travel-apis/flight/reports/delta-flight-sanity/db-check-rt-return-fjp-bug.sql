-- =============================================================================
-- BUG repro: RT cancel → booking Cancelled, RETURN FJP still Confirmed
-- BR: BR1795011229391989 · travelx
-- Paste in phpMyAdmin → travelx
-- =============================================================================

USE travelx;

SET @br := 'BR1795011229391989';

SELECT id INTO @booking_id FROM booking WHERE booking_reference = @br LIMIT 1;
SELECT bi.id INTO @booking_item_id
FROM booking_item bi
WHERE bi.booking_id = @booking_id
  AND bi.service_type IN ('flight', 'flights', 'FLIGHT', 'FLIGHTS')
LIMIT 1;

-- 1) Header: booking Cancelled?
SELECT
  b.id AS booking_id,
  b.booking_reference,
  b.confirmed_at,
  b.cancelled_at,
  b.total_amount,
  CASE WHEN b.cancelled_at IS NOT NULL THEN 'CANCELLED' ELSE 'NOT_CANCELLED' END AS booking_flag
FROM booking b
WHERE b.id = @booking_id;

-- 2) Item status
SELECT
  bi.id AS booking_item_id,
  bi.total_amount,
  bsm.status_code,
  bsm.backend_status,
  bsm.user_status
FROM booking_item bi
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE bi.id = @booking_item_id;

-- 3) Cancel request: PARTIAL + ONWARD journey only?
SELECT
  cr.id AS cancellation_request_id,
  cr.booking_item_id,
  cr.flight_journey_id,
  cr.pnr,
  cr.cancellation_type,
  cr.mode,
  cr.cancelled_by,
  cr.cancelled_at,
  cr.status,
  cr.refund_status,
  cr.refund_amount,
  cr.penalty_amount,
  cr.original_amount,
  cr.paid_amount
FROM cancellation_request cr
WHERE cr.booking_item_id = @booking_item_id
ORDER BY cr.id;

-- 4) Journeys
SELECT
  fj.id AS flight_journey_id,
  fj.sequence,
  fj.direction,
  fj.origin,
  fj.destination,
  fj.airline_pnr
FROM flight_journey fj
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence;

-- 5) THE BUG CHECK — FJP cell status per direction
SELECT
  fj.direction,
  fj.id AS flight_journey_id,
  fj.origin,
  fj.destination,
  fjp.id AS fjp_cell_id,
  fjp.eticket_number,
  fjp.vendor_pnr,
  bsm.status_code,
  bsm.backend_status,
  bsm.user_status,
  CASE
    WHEN fj.direction = 'RETURN'
     AND UPPER(bsm.backend_status) = 'CONFIRMED'
    THEN 'BUG — RETURN still Confirmed'
    WHEN fj.direction = 'ONWARD'
     AND UPPER(bsm.backend_status) = 'CANCELLED'
    THEN 'OK — ONWARD Cancelled'
    ELSE CONCAT('CHECK — ', fj.direction, ' ', IFNULL(bsm.backend_status, 'NULL'))
  END AS verdict
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY fj.sequence;

-- 6) One-line mismatch summary
SELECT
  @br AS br,
  (SELECT CASE WHEN cancelled_at IS NOT NULL THEN 'YES' ELSE 'NO' END
     FROM booking WHERE id = @booking_id) AS booking_cancelled,
  (SELECT bsm.user_status
     FROM booking_item bi
     JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
     WHERE bi.id = @booking_item_id) AS item_status,
  (SELECT cr.cancellation_type
     FROM cancellation_request cr
     WHERE cr.booking_item_id = @booking_item_id
     ORDER BY cr.id DESC LIMIT 1) AS cancel_type,
  (SELECT bsm.user_status
     FROM flight_journey_passenger fjp
     JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
     JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
     WHERE fj.booking_item_id = @booking_item_id AND fj.direction = 'ONWARD'
     LIMIT 1) AS onward_fjp_status,
  (SELECT bsm.user_status
     FROM flight_journey_passenger fjp
     JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
     JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
     WHERE fj.booking_item_id = @booking_item_id AND fj.direction = 'RETURN'
     LIMIT 1) AS return_fjp_status,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM booking b
      WHERE b.id = @booking_id AND b.cancelled_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM flight_journey_passenger fjp
      JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
      JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
      WHERE fj.booking_item_id = @booking_item_id
        AND fj.direction = 'RETURN'
        AND UPPER(bsm.backend_status) = 'CONFIRMED'
    )
    THEN 'BUG'
    ELSE 'OK'
  END AS issue_verdict;
