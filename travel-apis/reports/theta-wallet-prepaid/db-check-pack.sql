-- theta-api prepaid wallet — DB check pack (2026-11-18)
-- DB: travelx (staging). Change @br each time. Paste each result block back.

USE travelx;

-- ========== CHANGE THIS ==========
SET @br := 'BR1794993146220335';  -- Hotel A (start here)

-- 1) Booking + item + current status
SELECT b.id, b.booking_reference, b.partner, b.confirmed_at, b.cancelled_at,
       bi.id AS booking_item_id, bi.current_status_mapping_id,
       bsm.status_code, bsm.user_status, bsm.backend_status
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- 2) payment (provider should be wallet)
SELECT p.id, p.booking_id, p.booking_item_id, p.provider, p.status, p.total_amount
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br;

-- 3) payment_transaction
SELECT pt.id, pt.payment_id, pt.transaction_type, pt.status, pt.amount, pt.payment_status,
       pt.provider_reference, pt.payment_intent, pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id;

-- 4) refund_transaction
SELECT rt.id, rt.booking_item_id, rt.payment_transaction_id, rt.amount, rt.status,
       rt.destination_type, rt.wallet_ledger_id, rt.completed_at
FROM refund_transaction rt
JOIN booking_item bi ON bi.id = rt.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY rt.id;

-- 5) booking_item_status_history (+ mapping)
-- Note: no process_by / reason / details columns on this table
SELECT his.id, his.booking_item_id, his.status_mapping_id,
       bsm.status_code, bsm.user_status, bsm.backend_status,
       his.provider_timestamp, his.occurred_at, his.created_at
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = his.status_mapping_id
WHERE b.booking_reference = @br
ORDER BY his.created_at;

-- 5b) raw row (look for wallet_refund / provider_response in extra cols)
SELECT his.*
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY his.id;

-- 6) user_actions (skip for Cab)
SELECT action_id, action_name, created_at
FROM user_actions
WHERE action_id = @br
ORDER BY created_at;

-- 7) sales summary (skip for Cab)
SELECT bis.booking_item_id, bis.total_amount, bis.paid_amount, bis.due_amount
FROM booking_item_sales_summary bis
JOIN booking_item bi ON bi.id = bis.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;
