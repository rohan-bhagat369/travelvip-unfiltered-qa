-- Theta wallet charge-first — DB checks 2026-11-19
-- phpMyAdmin → travelx · base https://theta-api.travelvip.ai · partner vgm
--
-- Units reminder:
--   payment.total_amount / refund_transaction.amount often ×100 (₹6552 → 655200)
--   payment_transaction.amount often major units (₹6552 → 6552.00)
--
-- Hotel G: NOT RUN today (no BR)

USE travelx;

-- ========== Today's BRs ==========
-- Hotel E  BR1795082879986356  wallet_commit_fail          → expect NO payment/txn/refund
-- Hotel F  BR1795082889920346  commit+release fail         → expect NO payment/txn/refund
-- Hotel C  BR1795082950296274  provider_reject             → payment refunded + CAPTURE+REFUND
-- Hotel H  BR1795082960448054  debit_record_fail           → NO payment row (charged in wallet)
-- Hotel I  BR1795082930303131  reject+debit_record_fail    → NO payment/txn/refund
-- Hotel A  BR1795082906334896  happy (+J cancel)           → captured then refunded on cancel
-- Hotel D  BR1795082850562848  provider_no_response        → captured, no refund (status may move)
--
-- Flight E  BR1795084563564784  wallet_commit_fail         → NO payment/txn/refund
-- Flight F  BR1795084569811467  commit+release fail        → NO payment/txn/refund
-- Flight C  BR1795084574923655  provider_reject            → refunded + CAPTURE+REFUND
-- Flight H  BR1795086058563137  debit_record_fail (PASS)   → NO payment row
-- Flight H0 BR1795084580431254  debit_record_fail (flake)  → optional
-- Flight G  BR1795085536658169  reject+refund_fail         → stays captured; CAPTURE only; no refund_txn
-- Flight I  BR1795085979614259  reject+debit_record_fail   → NO payment/txn/refund
-- Flight A  BR1795085917199887  happy (+J cancel)          → captured then refunded/partial
-- Flight D  BR1795086092715867  provider_no_response       → captured, no refund

SET @brs := CONCAT_WS(',',
  'BR1795082879986356',  -- Hotel E
  'BR1795082889920346',  -- Hotel F
  'BR1795082950296274',  -- Hotel C
  'BR1795082960448054',  -- Hotel H
  'BR1795082930303131',  -- Hotel I
  'BR1795082906334896',  -- Hotel A
  'BR1795082850562848',  -- Hotel D
  'BR1795084563564784',  -- Flight E
  'BR1795084569811467',  -- Flight F
  'BR1795084574923655',  -- Flight C
  'BR1795086058563137',  -- Flight H
  'BR1795084580431254',  -- Flight H first
  'BR1795085536658169',  -- Flight G
  'BR1795085979614259',  -- Flight I
  'BR1795085917199887',  -- Flight A
  'BR1795086092715867'   -- Flight D
);

-- ========== Q1) Booking + item overview ==========
SELECT
  b.id AS booking_id,
  b.booking_reference,
  b.partner_id,
  bi.id AS booking_item_id,
  bi.item_type,
  bi.service_type,
  bi.status AS item_status,
  m.status_code,
  m.backend_status,
  m.user_status,
  b.created_at
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping m ON m.id = bi.current_status_mapping_id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference;

-- ========== Q2) Payment + txn summary (main check) ==========
SELECT
  b.booking_reference,
  bi.item_type,
  bi.status AS item_status,
  p.id AS payment_id,
  p.provider,
  p.status AS payment_status,
  p.total_amount,
  p.currency,
  (SELECT COUNT(*) FROM payment_transaction pt WHERE pt.payment_id = p.id) AS txn_count,
  (SELECT GROUP_CONCAT(CONCAT(pt.transaction_type, ':', pt.status, ':', pt.amount)
                       ORDER BY pt.id SEPARATOR ' | ')
     FROM payment_transaction pt WHERE pt.payment_id = p.id) AS txns
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN payment p ON p.booking_id = b.id AND p.provider = 'wallet'
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference;

-- ========== Q3) All payment_transaction rows ==========
SELECT
  b.booking_reference,
  p.id AS payment_id,
  p.status AS payment_status,
  pt.id AS txn_id,
  pt.transaction_type,
  pt.status AS txn_status,
  pt.amount,
  pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference, pt.id;

-- ========== Q4) refund_transaction ==========
SELECT
  b.booking_reference,
  rt.id,
  rt.cancellation_request_id,
  rt.destination,
  rt.status,
  rt.amount,
  rt.created_at
FROM refund_transaction rt
LEFT JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
JOIN booking b ON b.id = COALESCE(cr.booking_id, rt.booking_id)
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference, rt.id;

-- ========== Q5) user_actions (Hotel + Flight) ==========
SELECT
  b.booking_reference,
  ua.id,
  ua.action,
  ua.amount,
  ua.created_at
FROM user_actions ua
JOIN booking b ON b.id = ua.booking_id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference, ua.id;

-- If empty, try action_id = BR (some envs key this way):
-- SELECT * FROM user_actions WHERE action_id IN (...BRs...) OR booking_id IN (SELECT id FROM booking WHERE FIND_IN_SET(booking_reference,@brs));

-- ========== Q6) sales summary ==========
SELECT
  b.booking_reference,
  ss.*
FROM booking_item_sales_summary ss
JOIN booking_item bi ON bi.id = ss.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE FIND_IN_SET(b.booking_reference, @brs)
ORDER BY b.booking_reference;
