-- Hotel Cancellation Desk — SETTLE verification for BR1787585875844464
-- Env: canary / travelx (phpMyAdmin)
-- UI evidence (screenshot):
--   Request #588 | Full | Cancelled and refunded
--   Booking amount / collected: 7364.86
--   Hotel cancel charge 100 + convenience 500 + service 200 = withheld 800
--   Refunded 6564.86 | txn #1005 completed
--   Hotel: Hiltop Hotel Mumbai | checkin 2026-09-22 | conf SNHAPI00010852
--   Raised: 2026-08-24 15:38

USE travelx;
SET @br := 'BR1787585875844464';
SET @req := 588;
SET @txn := 1005;

-- ========== A) booking + hotel item ==========
SELECT b.id AS booking_id,
       b.booking_reference,
       b.status AS booking_status,
       b.confirmed_at,
       b.cancelled_at,
       b.updated_at
FROM booking b
WHERE b.booking_reference = @br;

SELECT bi.id AS booking_item_id,
       bi.product_type,
       bi.status AS item_status,
       bi.total_amount,
       bi.currency,
       bi.confirmation_number
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

-- ========== B) cancellation_request (must match desk Settle) ==========
SELECT cr.*
FROM cancellation_request cr
WHERE cr.id = @req
   OR cr.id IN (
        SELECT cr2.id
        FROM cancellation_request cr2
        JOIN booking_item bi ON bi.id = cr2.booking_item_id
        JOIN booking b ON b.id = bi.booking_id
        WHERE b.booking_reference = @br
      )
ORDER BY cr.id DESC;

-- Expected after SETTLE (adjust column names if schema differs):
--   id = 588
--   status IN ('SETTLED','COMPLETED','REFUNDED','CANCELLED') — NOT PENDING
--   scope/type = Full / FULL
--   collected / booking amount ~ 7364.86
--   quoted_refund ~ 7364.86 (pre-settle quote; may remain)
--   final refund ~ 6564.86
--   withheld / charges ~ 800.00
--   hotel_cancellation_charge ~ 100
--   convenience_fee ~ 500
--   service_fee ~ 200
--   refund_status completed/success
--   settled_at / processed_at populated

-- Soft field probe if exact names unknown:
SHOW COLUMNS FROM cancellation_request;

-- ========== C) payment_transaction refund row ==========
SELECT pt.*
FROM payment_transaction pt
WHERE pt.id = @txn
   OR pt.booking_id IN (SELECT id FROM booking WHERE booking_reference = @br)
   OR pt.reference_id = @br
   OR pt.booking_reference = @br
ORDER BY pt.id DESC;

-- Fallback if join column differs:
-- SELECT * FROM payment_transaction WHERE id = 1005 OR amount IN (6564.86, -6564.86) ORDER BY id DESC LIMIT 20;

SHOW COLUMNS FROM payment_transaction;

-- Expected for txn #1005:
--   id = 1005
--   type/nature = REFUND / CREDIT / WALLET_REFUND (not CHARGE)
--   amount = 6564.86 (or -6564.86 if signed convention)
--   status = completed / SUCCESS / SETTLED
--   linked to this booking / cancellation_request 588
--   currency INR

-- ========== D) consistency checks ==========
-- 1) 7364.86 - 800.00 = 6564.86
-- 2) cancellation_request no longer PENDING
-- 3) booking / booking_item status Cancelled (or equivalent)
-- 4) exactly one completed refund txn for this settle (txn 1005)
