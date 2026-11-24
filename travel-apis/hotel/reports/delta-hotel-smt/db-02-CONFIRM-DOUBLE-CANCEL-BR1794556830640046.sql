-- 2/2 CONFIRM → DOUBLE → CANCEL (same BR)
-- BR1794556830640046 · Confirmed SNHAPI00011741 → Cancelled · pi_3UbFPPEWyGwVPuvk0tKLghHx · ₹9400.74
USE travelx;
SET @br := 'BR1794556830640046';

-- 1) Booking
SELECT b.id, b.booking_reference, b.partner, b.confirmed_at, b.cancelled_at,
       bi.id AS booking_item_id, bi.current_status_mapping_id,
       bsm.status_code, bsm.user_status, bsm.backend_status
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- 2) Payment (expect ONE stripe payment; DOUBLE must not add a second)
SELECT p.id, p.booking_id, p.booking_item_id, p.provider, p.status, p.total_amount
FROM payment p JOIN booking b ON b.id = p.booking_id WHERE b.booking_reference = @br;

SELECT pt.id, pt.payment_id, pt.transaction_type, pt.status, pt.amount, pt.payment_status,
       pt.provider_reference, pt.payment_intent
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br ORDER BY pt.id;

SELECT bis.booking_item_id, bis.total_amount, bis.paid_amount, bis.due_amount
FROM booking_item_sales_summary bis
JOIN booking_item bi ON bi.id = bis.booking_item_id
JOIN booking b ON b.id = bi.booking_id WHERE b.booking_reference = @br;

-- 3) Cancellation
SELECT cr.id, cr.booking_item_id, cr.status, cr.provider_status, cr.refund_status,
       cr.refund_amount, cr.penalty_amount, cr.cancelled_at, cr.status_message
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id WHERE b.booking_reference = @br;

-- 4) Refund
SELECT rt.id, rt.booking_item_id, rt.payment_transaction_id, rt.amount, rt.status,
       rt.destination_type, rt.wallet_ledger_id, rt.completed_at
FROM refund_transaction rt
JOIN booking_item bi ON bi.id = rt.booking_item_id
JOIN booking b ON b.id = bi.booking_id WHERE b.booking_reference = @br;

SELECT pt.id, pt.transaction_type, pt.status, pt.amount, pt.provider_reference
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br AND pt.transaction_type = 'REFUND';

-- 5) Status trail
SELECT his.booking_item_id, his.status_mapping_id, bsm.status_code, bsm.user_status, bsm.backend_status, his.created_at
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = his.status_mapping_id
WHERE b.booking_reference = @br ORDER BY his.created_at;

SELECT action_id, action_name, created_at FROM user_actions WHERE action_id = @br ORDER BY created_at;
