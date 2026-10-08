USE travelx;

-- R01 fixture (canary) — return-leg cancel failed at vendor; still check partial DB
SET @br := 'BR1786518103996534';
-- prior attempt: BR1786517972927912 (BLR-HYD, cancel failed penalty)

-- V085: cancellation_request for return PNR / RESCHEDULE reason
SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.reason,
       cr.flight_journey_id, cr.refund_status, cr.provider_status
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;

-- V086: rescheduled_from_journey_id on journeys (expect NULL until reschedule succeeds)
SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr,
       fj.rescheduled_from_journey_id, fj.current_status_mapping_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence;

-- V087: onward journey should still be active (unchanged PNR/status)
-- Compare ONWARD row above vs pre-cancel snapshot airline_pnr=UUP3XL

-- V088: cell matrix — return cells should stay BOOKED until cancel completes
SELECT fjp.id AS cell_id, fj.direction, fj.airline_pnr,
       fjp.eticket_number, fjp.status, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, fjp.id;

-- Score guide (until vendor cancel works):
-- V085-V088 = NOT TESTED if no RESCHEDULE cancel + new journey
-- Partial: cr.status=failed / Penalty Check Failed → R01 scenario FAIL (vendor)
