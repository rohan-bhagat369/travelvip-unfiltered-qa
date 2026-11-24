-- S3 DOUBLE (retry)
USE travelx;
SET @br := 'BR1794556830640046';
SELECT b.id, b.booking_reference, b.partner, b.confirmed_at, b.cancelled_at,
       bi.id AS booking_item_id, bi.current_status_mapping_id, bsm.status_code, bsm.user_status, bsm.backend_status
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;
SELECT p.id, p.provider, p.status, p.total_amount FROM payment p JOIN booking b ON b.id=p.booking_id WHERE b.booking_reference=@br;
SELECT pt.id, pt.transaction_type, pt.status, pt.amount, pt.payment_status, pt.provider_reference, pt.payment_intent
FROM payment_transaction pt JOIN payment p ON p.id=pt.payment_id JOIN booking b ON b.id=p.booking_id
WHERE b.booking_reference=@br ORDER BY pt.id;
SELECT bis.total_amount, bis.paid_amount, bis.due_amount FROM booking_item_sales_summary bis
JOIN booking_item bi ON bi.id=bis.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br;
SELECT cr.id, cr.status, cr.refund_status, cr.refund_amount, cr.penalty_amount, cr.cancelled_at FROM cancellation_request cr
JOIN booking_item bi ON bi.id=cr.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br;
SELECT rt.id, rt.amount, rt.status, rt.destination_type, rt.completed_at FROM refund_transaction rt
JOIN booking_item bi ON bi.id=rt.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference=@br;
SELECT pt.id, pt.transaction_type, pt.status, pt.amount FROM payment_transaction pt
JOIN payment p ON p.id=pt.payment_id JOIN booking b ON b.id=p.booking_id
WHERE b.booking_reference=@br AND pt.transaction_type='REFUND';
SELECT his.status_mapping_id, bsm.status_code, bsm.user_status, bsm.backend_status, his.created_at
FROM booking_item_status_history his JOIN booking_item bi ON bi.id=his.booking_item_id JOIN booking b ON b.id=bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id=his.status_mapping_id WHERE b.booking_reference=@br ORDER BY his.created_at;
SELECT action_id, action_name, created_at FROM user_actions WHERE action_id=@br ORDER BY created_at;
