-- ===== B08 V033–V035 + G10 (notify) =====
USE travelx;
SET @br := 'BR1786476212954979';
SHOW COLUMNS FROM booking LIKE 'notify%';
SHOW COLUMNS FROM booking_item LIKE 'notify%';
SELECT bi.id, bi.notify_name, bi.notify_email, bi.notify_phone, bi.notify_country_code
FROM booking_item bi JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;
SELECT bp.pax_id, bp.first_name, bp.last_name, bp.email AS pax_email, bp.phone AS pax_phone,
       bi.notify_name, bi.notify_email, bi.notify_phone
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
JOIN booking_item bi ON bi.booking_id = b.id
WHERE b.booking_reference = @br;
-- Score: V033 PASS if notify_* only on booking_item and populated
-- V034 PASS if notify_email/phone match issue-ticket contact (cardholder.qa@example.com / 9000011122)
-- V035 PASS if notify ≠ passenger (Suresh Patil ptua; pax email/phone may be null)

-- ===== B10 V042 schema (no booking needed) =====
USE travelx;
SHOW COLUMNS FROM booking_item_flight LIKE 'refresh%';
SHOW COLUMNS FROM booking_item LIKE 'refresh%';
-- PASS if both empty (refresh_token absent post Phase D)
-- FAIL if refresh_token column still on booking_item_flight

-- ===== X01 V094–V095 optimistic lock (manual 2-tab test) =====
USE travelx;
-- fixture B07 BR1786475320743051
SELECT bi.id AS booking_item_id, bi.version, b.booking_reference
FROM booking_item bi JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = 'BR1786475320743051';
-- Tab A: START TRANSACTION; read version v; UPDATE booking_item SET version = version + 1 WHERE id = <id> AND version = v; COMMIT;
-- Tab B (before A commits): same UPDATE with same v — expect 0 rows affected (V095 PASS)
-- Tab A after commit: version should be v+1 (V094 PASS)

-- ===== C09 V084 + R01 V085–V088 (after R01 probe run) =====
USE travelx;
-- Replace @br2 with RT fixture from reports/db-r01-c09-canary.json
SET @br2 := '<RT_BR_FROM_R01_PROBE>';
SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id,
       fj.current_status_mapping_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br2 ORDER BY fj.sequence;
SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.reason
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br2 ORDER BY cr.id DESC;
SHOW TABLES LIKE '%supplier%recovery%';
SHOW TABLES LIKE '%supplier_refund%';
-- If supplier table exists, join recovery rows for latest cancel on @br2
-- V084: customer refund minus supplier recovery computable
