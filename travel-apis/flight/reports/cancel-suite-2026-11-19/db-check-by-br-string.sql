-- Resolve cancel-suite BR by STRING / PNR / CR id — never trust Nexus URL id alone
USE travelx;
SELECT DATABASE() AS db, @@hostname AS host, NOW() AS now_ts;

-- 1) Booking by reference (authoritative)
SELECT *
FROM booking
WHERE booking_reference = 'BR1795091441315761';

-- 2) All items on that booking
SELECT bi.*
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = 'BR1795091441315761';

-- 3) Journeys by PNR (then note real booking_item_id)
SELECT *
FROM flight_journey
WHERE airline_pnr IN ('SIM-93EUK6', 'SIM-5RQG6F');

-- 4) CRs by id (102-105) and by PNR
SELECT *
FROM cancellation_request
WHERE id IN (102, 103, 104, 105)
ORDER BY id;

SELECT *
FROM cancellation_request
WHERE pnr IN ('SIM-93EUK6', 'SIM-5RQG6F')
ORDER BY id;

-- 5) Refunds / events by CR id
SELECT *
FROM refund_transaction
WHERE cancellation_request_id IN (102, 103, 104, 105)
ORDER BY id;

SELECT *
FROM cancellation_event
WHERE cancellation_request_id IN (102, 103, 104, 105)
ORDER BY id;

-- 6) Passengers on those CRs
SELECT cr.id AS cr_id, cr.booking_item_id, cr.pnr, cr.status, cr.refund_status,
       cp.status AS cp_status, bp.pax_id, bp.first_name, bp.last_name, bp.booking_id
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
WHERE cr.id IN (102, 103, 104, 105)
ORDER BY cr.id, bp.pax_id;

-- 7) Payments: use booking.id from step 1 (not 1523)
-- After step 1, replace <BOOKING_ID> with the real id:
-- SELECT * FROM payment WHERE booking_id = <BOOKING_ID>;
-- SELECT pt.* FROM payment_transaction pt JOIN payment p ON p.id = pt.payment_id WHERE p.booking_id = <BOOKING_ID>;
