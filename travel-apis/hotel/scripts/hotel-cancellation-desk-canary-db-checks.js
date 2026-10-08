/**
 * Hotel Cancellation Desk — canary DB verification SQL after dashboard cancel.
 *
 * Fixture (booked for this test):
 *   BR1787830243867043 · Hilltop Hotel Mumbai · Confirmed · ₹7494.45
 *   checkin 2026-09-24 → 2026-09-25 · confirmationNumber SNHAPI00010877
 *
 * Steps:
 *   1) Cancel this BR from dashboard (Hotel Booking page).
 *   2) Confirm it appears in Cancellation Desk list.
 *   3) Paste SQL below in phpMyAdmin (USE travelx / canary DB).
 *   4) Then run Settle / Reject from desk and re-run payment_transaction SQL.
 */
console.log(`
USE travelx;  -- or canary DB name if different
SET @br := 'BR1787830243867043';

-- 1) Booking status / cancel timestamps
SELECT id, booking_reference, status, confirmed_at, cancelled_at, updated_at
FROM booking
WHERE booking_reference = @br;

-- 2) Hotel booking item
SELECT bi.id AS booking_item_id, bi.product_type, bi.status, bi.total_amount, bi.currency
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

-- 3) cancellation_request — MUST have a row after dashboard cancel request
SELECT cr.*
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;

-- Expect after request (before Settle/Reject):
--   status ≈ REQUESTED / PENDING / Cancellation Requested
--   booking_item_id matches hotel item
--   requested_by / source / reason populated as per desk flow
--   amount / penalty / refund fields match UI quote if present

-- 4) payment_transaction — refund / settlement rows
SELECT pt.*
FROM payment_transaction pt
JOIN booking b ON b.id = pt.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id DESC;

-- Or if payment_transaction links via booking_reference / booking_item:
-- SELECT * FROM payment_transaction
-- WHERE booking_reference = @br OR reference_id = @br
-- ORDER BY id DESC;

-- After Settle: expect refund CREDIT / REFUND row with correct amount, status SUCCESS/SETTLED
-- After Reject: expect request status REJECTED and NO successful refund credit (or reverse of settle)
`);
