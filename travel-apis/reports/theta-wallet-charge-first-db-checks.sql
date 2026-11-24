-- Theta wallet charge-first changelog — DB checks (phpMyAdmin → travelx)
-- Base: https://theta-api.travelvip.ai · partner vgm · 2026-11-18
--
-- Units (same as prior wallet packs):
--   payment.total_amount / refund_transaction.amount often ×100 (₹11153.32 → 1115332)
--   payment_transaction.amount often major units (₹11153.32 → 11153.32)
--
-- Cab: skip user_actions + booking_item_sales_summary (flow does not write them).
-- Flight: no BRs this run (search VENDOR_ERROR).

USE travelx;

-- ========== 0) All theta BRs in one pass ==========
SET @brs := 'BR1794987275429952,BR1794987280342725,BR1794987285553305,BR1794987290959353,BR1794987522262492,BR1794987546766716,BR1794987630902074,BR1794987329360718,BR1794987344402250,BR1794987359899598,BR1794987375501526,BR1794987402323818,BR1794987430226336,BR1794987458712474,BR1794987473835079,BR1794987588574703';

-- Booking + item status
SELECT
  b.id AS booking_id,
  b.booking_reference,
  b.partner_id,
  bi.id AS booking_item_id,
  bi.item_type,
  bi.status AS item_status,
  b.created_at
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.id;

-- ========== 1) Per-BR template — change @br only ==========
SET @br := 'BR1794987285553305';  -- Case C hotel (refund SUCCESS) — swap BR below

SELECT b.id AS booking_id, b.booking_reference, b.partner_id, b.created_at, b.confirmed_at, b.cancelled_at
FROM booking b
WHERE b.booking_reference = @br;

SELECT bi.id, bi.booking_id, bi.item_type, bi.status, bi.created_at, bi.updated_at
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

-- booking_item_status_history
-- NOTE: there is NO his.status column — status comes from booking_status_mapping
-- Run once if unsure of columns: SHOW COLUMNS FROM booking_item_status_history;
SELECT
  his.id,
  his.booking_item_id,
  his.status_mapping_id,
  m.status_code,
  m.backend_status,
  m.user_status,
  his.provider_timestamp,
  his.occurred_at,
  his.created_at
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping m ON m.id = his.status_mapping_id
WHERE b.booking_reference = @br
ORDER BY his.id;

-- Current item status (not history)
SELECT
  bi.id AS booking_item_id,
  bi.service_type,
  m.status_code,
  m.backend_status,
  m.user_status,
  bi.current_status_mapping_id
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping m ON m.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- payment (provider = wallet)
SELECT
  p.id,
  p.booking_id,
  p.provider,
  p.status,
  p.total_amount,
  p.currency,
  p.provider_id,
  p.is_used,
  p.created_at,
  p.updated_at
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY p.id;

-- payment_transaction
SELECT
  pt.id,
  pt.payment_id,
  p.provider,
  pt.transaction_type,
  pt.status,
  pt.amount,
  pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id;

-- refund_transaction
-- Note: supplier-reject refunds may attach differently than cancel refunds.
-- Try booking_id first; if empty, also check via cancellation_request.
SELECT
  rt.id,
  rt.cancellation_request_id,
  rt.destination,
  rt.status,
  rt.amount,
  rt.created_at,
  rt.refund_response
FROM refund_transaction rt
LEFT JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
JOIN booking b ON b.id = COALESCE(cr.booking_id, rt.booking_id)
WHERE b.booking_reference = @br
ORDER BY rt.id;

-- Fallback if destination/booking_id columns differ on this env:
-- SHOW COLUMNS FROM refund_transaction;
-- SHOW COLUMNS FROM booking_item_status_history;

-- user_actions (Hotel + Flight only — Cab should be empty / skip)
SELECT
  ua.id,
  ua.booking_id,
  ua.action,
  ua.amount,
  ua.created_at,
  ua.meta
FROM user_actions ua
JOIN booking b ON b.id = ua.booking_id
WHERE b.booking_reference = @br
ORDER BY ua.id;

-- If action column is named differently:
-- SHOW COLUMNS FROM user_actions;

-- booking_item_sales_summary (Hotel + Flight only — Cab skip)
SELECT
  ss.*
FROM booking_item_sales_summary ss
JOIN booking_item bi ON bi.id = ss.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;


-- ========== 2) Batch overview (all BRs) ==========
SELECT
  b.booking_reference,
  bi.item_type,
  bi.status AS item_status,
  p.id AS payment_id,
  p.provider,
  p.status AS payment_status,
  p.total_amount,
  (SELECT COUNT(*) FROM payment_transaction pt WHERE pt.payment_id = p.id) AS txn_count,
  (SELECT GROUP_CONCAT(CONCAT(pt.transaction_type, ':', pt.status) ORDER BY pt.id)
     FROM payment_transaction pt WHERE pt.payment_id = p.id) AS txns
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN payment p ON p.booking_id = b.id AND p.provider = 'wallet'
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference;

SELECT
  b.booking_reference,
  ua.action,
  ua.created_at
FROM user_actions ua
JOIN booking b ON b.id = ua.booking_id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference, ua.id;

SELECT
  b.booking_reference,
  ss.*
FROM booking_item_sales_summary ss
JOIN booking_item bi ON bi.id = ss.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference;


-- ========== 3) Expected by case (checklist) ==========
-- Hotel E  BR1794987275429952  wallet_commit_fail
--   history: FAILED reason wallet_charge_failed, process_by finalize_booking
--   payment / payment_transaction / refund_transaction: NONE
--   user_actions: NONE
--
-- Hotel F  BR1794987280342725  wallet_commit_fail,wallet_release_fail
--   same DB as E
--
-- Hotel C  BR1794987285553305  provider_reject
--   history: FAILED + details.provider_response (SIMULATED...) + details.wallet_refund SUCCESS
--   payment: refunded · txn: debit + refund · refund_transaction: 1 completed full amount
--   user_actions: payment_success → booking_failed
--
-- Hotel H  BR1794987290959353  wallet_debit_record_fail
--   history: normal then may be Failed (PAN) · payment / txn: NONE
--   user_actions: payment_success → booking_submit_success (even with no payment row)
--
-- Hotel G  BR1794987522262492  provider_reject,wallet_refund_fail
--   history: FAILED + wallet_refund.status FAILED
--   payment: stays captured · txn: debit only · refund_transaction: NONE
--   user_actions: payment_success → booking_failed
--
-- Hotel I  BR1794987546766716  provider_reject,wallet_debit_record_fail
--   history: FAILED + wallet_refund FAILED · payment/txn/refund: NONE
--   user_actions: payment_success → booking_failed
--
-- Hotel A  BR1794987630902074  happy (then cancelled J)
--   after book: payment captured · txn debit · no refund · user_actions payment_success → booking_submit_success
--   sales_summary: fully paid
--   after J cancel: payment refunded (or partial) · refund txn present
--
-- Cab E  BR1794987329360718  same as Hotel E but process_by = cabs_finalize · skip user_actions/sales
-- Cab F  BR1794987344402250  same as Hotel F
-- Cab C  BR1794987359899598  like Hotel C · skip user_actions/sales
-- Cab H  BR1794987375501526  like Hotel H · payment NONE · skip user_actions/sales
-- Cab A  BR1794987402323818 / BR1794987588574703  captured + debit · skip user_actions/sales
-- Cab D  BR1794987430226336  PENDING · captured + debit · no refund
-- Cab G  BR1794987458712474  like Hotel G
-- Cab I  BR1794987473835079  like Hotel I
