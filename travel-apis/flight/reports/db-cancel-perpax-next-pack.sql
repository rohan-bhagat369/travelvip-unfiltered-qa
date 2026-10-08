-- Per-pax cancel DB pack (next BRs)
-- Paste results back for scoring
USE travelx;

-- ========== A) 3ADT full Cancelled ==========
SET @br := 'BR1786572337739872';

SELECT 'A_CR' AS q, cr.id, cr.pnr, cr.mode, cr.status, cr.refund_status,
       cr.estimated_refund_amount, cr.estimated_penalty_amount, cr.cancellation_type
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;

SELECT 'A_CP' AS q, cp.id, cp.flight_journey_passenger_id, cp.status, bp.pax_id,
       cp.refund_amount, cp.penalty_amount
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN flight_journey_passenger fjp ON fjp.id = cp.flight_journey_passenger_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

SELECT 'A_CELLS' AS q, bp.pax_id, fjp.id AS cell_id, bsm.backend_status, bsm.user_status, bsm.status_code
FROM flight_journey_passenger fjp
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE b.booking_reference = @br
ORDER BY bp.pax_id;

-- ========== B) Partial multipax (PAX1+2 then PAX3 requested) ==========
SET @br := 'BR1786572156401139';

SELECT 'B_CR' AS q, cr.id, cr.pnr, cr.mode, cr.status, cr.refund_status,
       cr.estimated_refund_amount, cr.estimated_penalty_amount, cr.cancellation_type
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;

SELECT 'B_CP' AS q, cp.id, cr.id AS cr_id, bp.pax_id, cp.status
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN flight_journey_passenger fjp ON fjp.id = cp.flight_journey_passenger_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id, bp.pax_id;

SELECT 'B_CELLS' AS q, bp.pax_id, fjp.id AS cell_id, bsm.backend_status, bsm.user_status
FROM flight_journey_passenger fjp
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE b.booking_reference = @br
ORDER BY bp.pax_id;

-- ========== C) RT — return cancelled, onward intact ==========
SET @br := 'BR1786568422897124';

SELECT 'C_CR' AS q, cr.id, cr.pnr, cr.mode, cr.status, cr.cancellation_type,
       cr.estimated_refund_amount, cr.estimated_penalty_amount
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;

SELECT 'C_CELLS' AS q, fj.direction, fj.airline_pnr, bp.pax_id, fjp.id AS cell_id,
       bsm.backend_status, bsm.user_status
FROM flight_journey_passenger fjp
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE b.booking_reference = @br
ORDER BY fj.direction, bp.pax_id;

-- ========== D) SSR withheld ==========
SET @br := 'BR1786570315695002';

SELECT 'D_CR' AS q, cr.id, cr.pnr, cr.mode, cr.status,
       cr.estimated_refund_amount, cr.estimated_penalty_amount, cr.cancellation_policy
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;

SELECT 'D_CP' AS q, cp.id, bp.pax_id, cp.status, cp.refund_amount, cp.penalty_amount
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN flight_journey_passenger fjp ON fjp.id = cp.flight_journey_passenger_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;
