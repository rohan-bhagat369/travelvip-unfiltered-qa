-- Canary catalog_v1 full-matrix DB checks
USE travelx;

-- Gate (already PASS)
SHOW COLUMNS FROM booking_item_lounge LIKE 'booking_flow';
SHOW COLUMNS FROM booking_item_fast_track LIKE 'booking_flow';
SHOW COLUMNS FROM booking_item_esim LIKE 'booking_flow';

-- Helper: set @br then run block below
-- FT W1 Pending→Confirmed via U1
SET @br := 'BR1795000846337454';
-- eSIM W1
-- SET @br := 'BR1795000894123981';
-- Lounge W1 provider fail
-- SET @br := 'BR1795000835517130';
-- Card C1/C2 FT
-- SET @br := 'BR1795000874224264';
-- Card C1/C2 eSIM
-- SET @br := 'BR1795000917367721';
-- Card C2 Lounge (pay ok, submit failed)
-- SET @br := 'BR1795000843953152';

SELECT b.booking_reference, bi.id AS booking_item_id, bi.service_type,
       lounge.booking_flow AS lounge_flow,
       ft.booking_flow AS ft_flow,
       esim.booking_flow AS esim_flow
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_item_lounge lounge ON lounge.booking_item_id = bi.id
LEFT JOIN booking_item_fast_track ft ON ft.booking_item_id = bi.id
LEFT JOIN booking_item_esim esim ON esim.booking_item_id = bi.id
WHERE b.booking_reference = @br;

SELECT p.id, p.provider, p.status, p.total_amount, p.is_used
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br;

SELECT pt.id, pt.transaction_type, pt.status, pt.amount
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id;

SELECT rt.id, rt.amount, rt.status, rt.destination_type, rt.completed_at
FROM refund_transaction rt
JOIN booking_item bi ON bi.id = rt.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

SELECT action_id, action_name, created_at
FROM user_actions WHERE action_id = @br ORDER BY created_at;

SELECT b.booking_reference, bsm.status_code, bsm.user_status, bsm.backend_status
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;
