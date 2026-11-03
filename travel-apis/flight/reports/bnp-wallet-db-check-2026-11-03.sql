-- BNP wallet changelog §4 — paste in phpMyAdmin → travelx
-- BRs:
--   BR1793694660292286  Confirmed  → expect §4.2 (happy path #1)
--   BR1793694191425078  Cancelled  → expect §4.2 then §4.4 (partial cancel #8-ish)
-- Units: payment.total_amount + refund_transaction.amount are ×100 (₹5382.34 → 538234)
--        payment_transaction.amount is major units (₹5382.34 → 5382.34)

USE travelx;

-- ========== A) Confirmed happy path — BR1793694660292286 ==========
SET @br_ok := 'BR1793694660292286';

SELECT b.id AS booking_id, b.booking_reference, b.partner_id, b.created_at, b.confirmed_at, b.cancelled_at
FROM booking b
WHERE b.booking_reference = @br_ok;

-- payment: expect 2 rows (wallet + benepik), BOTH captured; exactly 1 wallet row
SELECT p.id, p.booking_id, p.provider, p.status, p.total_amount, p.currency,
       p.provider_id, p.is_used, p.created_at, p.updated_at
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br_ok
ORDER BY p.id;

-- payment_transaction: wallet CAPTURE success + Benepik capture; NO wallet REFUND yet
SELECT pt.id, pt.payment_id, p.provider, pt.transaction_type, pt.status, pt.amount,
       pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br_ok
ORDER BY pt.id;

-- refund / cancel should be empty for Confirmed
SELECT cr.id, cr.status, cr.created_at
FROM cancellation_request cr
JOIN booking b ON b.id = cr.booking_id
WHERE b.booking_reference = @br_ok;

SELECT rt.id, rt.cancellation_request_id, rt.destination, rt.status, rt.amount, rt.created_at
FROM refund_transaction rt
JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
JOIN booking b ON b.id = cr.booking_id
WHERE b.booking_reference = @br_ok;


-- ========== B) Cancelled partial refund — BR1793694191425078 ==========
SET @br_cx := 'BR1793694191425078';

SELECT b.id AS booking_id, b.booking_reference, b.partner_id, b.created_at, b.confirmed_at, b.cancelled_at
FROM booking b
WHERE b.booking_reference = @br_cx;

-- payment: 2 rows wallet+benepik; wallet STILL captured after partial refund (§4.4)
SELECT p.id, p.booking_id, p.provider, p.status, p.total_amount, p.currency,
       p.provider_id, p.is_used, p.created_at, p.updated_at
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br_cx
ORDER BY p.id;

-- payment_transaction: CAPTUREs + exactly ONE wallet REFUND (not two)
SELECT pt.id, pt.payment_id, p.provider, pt.transaction_type, pt.status, pt.amount,
       pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br_cx
ORDER BY pt.id;

SELECT
  SUM(CASE WHEN p.provider = 'wallet' AND pt.transaction_type IN ('REFUND','refund','Refund') THEN 1 ELSE 0 END) AS wallet_refund_rows,
  SUM(CASE WHEN p.provider = 'wallet' AND pt.transaction_type IN ('CAPTURE','capture','Capture') THEN 1 ELSE 0 END) AS wallet_capture_rows
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br_cx;

-- cancellation_request: refund status NOT FAILED
SELECT cr.id, cr.status, cr.refund_status, cr.created_at, cr.updated_at
FROM cancellation_request cr
JOIN booking b ON b.id = cr.booking_id
WHERE b.booking_reference = @br_cx
ORDER BY cr.id;

-- refund_transaction: 2 rows same cancel — SOURCE (Benepik) + APP_WALLET, equal amounts, both completed
-- expect amount ≈ 395060 (₹3,950.60 ×100) if units are ×100
SELECT rt.id, rt.cancellation_request_id, rt.destination, rt.status, rt.amount,
       rt.refund_response, rt.created_at
FROM refund_transaction rt
JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
JOIN booking b ON b.id = cr.booking_id
WHERE b.booking_reference = @br_cx
ORDER BY rt.id;

-- quick equal-amount check
SELECT
  cr.id AS cancellation_request_id,
  COUNT(*) AS refund_rows,
  SUM(CASE WHEN rt.destination IN ('SOURCE','source') THEN 1 ELSE 0 END) AS source_rows,
  SUM(CASE WHEN rt.destination IN ('APP_WALLET','app_wallet','WALLET','wallet') THEN 1 ELSE 0 END) AS wallet_rows,
  MIN(rt.amount) AS min_amt,
  MAX(rt.amount) AS max_amt,
  CASE WHEN MIN(rt.amount) = MAX(rt.amount) THEN 'EQUAL' ELSE 'MISMATCH' END AS amount_check,
  GROUP_CONCAT(CONCAT(rt.destination, ':', rt.status) ORDER BY rt.id) AS dest_status
FROM refund_transaction rt
JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
JOIN booking b ON b.id = cr.booking_id
WHERE b.booking_reference = @br_cx
GROUP BY cr.id;
