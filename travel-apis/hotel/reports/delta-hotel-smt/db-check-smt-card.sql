-- SMT / delta-api hotel card books — paste in phpMyAdmin → USE travelx;
-- BRs from 2026-11-13 API runs (paymentMethod=CARD / Stripe)
--   BR1794555145766910  Confirmed  SNHAPI00011740  pi_3UbEyEEWyGwVPuvk0R3cko9X  (smt env creds)
--   BR1794554712975108  Confirmed  SNHAPI00011739  pi_3UbErFEWyGwVPuvk1KhISRWa  (earlier card)

USE travelx;

SET @br1 := 'BR1794555145766910';
SET @br2 := 'BR1794554712975108';

-- =============================================================================
-- 1) Find the Booking
-- =============================================================================
SELECT
  b.id,
  b.booking_reference,
  b.partner,
  b.confirmed_at,
  b.cancelled_at,
  bi.id AS booking_item_id,
  bi.current_status_mapping_id,
  bsm.status_code,
  bsm.user_status,
  bsm.backend_status
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, bi.id;

-- =============================================================================
-- 2) Payment Taken (Deduction)
-- =============================================================================
SELECT
  b.booking_reference,
  p.id AS payment_id,
  p.booking_id,
  p.booking_item_id,
  p.provider,
  p.status,
  p.total_amount
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, p.id;

SELECT
  b.booking_reference,
  pt.id AS payment_txn_id,
  pt.payment_id,
  pt.transaction_type,
  pt.status,
  pt.amount,
  pt.payment_status,
  pt.provider_reference,
  pt.payment_intent
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, pt.id;

SELECT
  b.booking_reference,
  bis.booking_item_id,
  bis.total_amount,
  bis.paid_amount,
  bis.due_amount
FROM booking_item_sales_summary bis
JOIN booking_item bi ON bi.id = bis.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, bis.booking_item_id;

-- Expect (card / Stripe success):
--   payment.provider = stripe (or similar), status captured/succeeded
--   payment_transaction: AUTH and/or CAPTURE, status success, payment_intent = pi_3UbEy… / pi_3UbEr…
--   sales_summary.paid_amount ≈ total_amount, due_amount = 0

-- =============================================================================
-- 3) Cancellation (none yet for these BRs — expect empty)
-- =============================================================================
SELECT
  b.booking_reference,
  cr.id,
  cr.booking_item_id,
  cr.status,
  cr.provider_status,
  cr.refund_status,
  cr.refund_amount,
  cr.penalty_amount,
  cr.cancelled_at,
  cr.status_message
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, cr.id;

-- =============================================================================
-- 4) Refund Given Back (none until cancel — expect empty)
-- =============================================================================
SELECT
  b.booking_reference,
  rt.id,
  rt.booking_item_id,
  rt.payment_transaction_id,
  rt.amount,
  rt.status,
  rt.destination_type,
  rt.wallet_ledger_id,
  rt.completed_at,
  LEFT(rt.refund_response, 200) AS refund_response_preview
FROM refund_transaction rt
JOIN booking_item bi ON bi.id = rt.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, rt.id;

SELECT
  b.booking_reference,
  pt.id,
  pt.transaction_type,
  pt.status,
  pt.amount,
  pt.provider_reference
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference IN (@br1, @br2)
  AND pt.transaction_type = 'REFUND'
ORDER BY b.booking_reference, pt.id;

-- =============================================================================
-- 5) Status Trail
-- =============================================================================
SELECT
  b.booking_reference,
  his.booking_item_id,
  his.status_mapping_id,
  bsm.status_code,
  bsm.user_status,
  bsm.backend_status,
  his.created_at
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = his.status_mapping_id
WHERE b.booking_reference IN (@br1, @br2)
ORDER BY b.booking_reference, his.created_at, his.id;

SELECT
  ua.action_id AS booking_reference,
  ua.action_name,
  ua.created_at
FROM user_actions ua
WHERE ua.action_id IN (@br1, @br2)
ORDER BY ua.action_id, ua.created_at;

-- Expect trail roughly:
--   payment_success → booking_confirmed (or status_codes 100/120 → 200)
--   No booking_cancelled / booking_failed for these two
