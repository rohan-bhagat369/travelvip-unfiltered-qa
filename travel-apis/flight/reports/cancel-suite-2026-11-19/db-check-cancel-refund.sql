-- =============================================================================
-- Flight cancellation suite — DB cancel + refund checks (travelx)
-- Paste in phpMyAdmin → select database travelx → SQL tab
-- Amounts: usually paise (×100). ₹4,520.50 → 452050
--
-- Default BR = settled cancel suite fixture (requests #102–#105)
-- Fresh Confirmed RT (no cancel yet): BR1795092868632177
-- =============================================================================

USE travelx;

-- Change me
SET @br := 'BR1795091441315761';

SELECT id INTO @booking_id FROM booking WHERE booking_reference = @br LIMIT 1;
SELECT bi.id INTO @booking_item_id
FROM booking_item bi
WHERE bi.booking_id = @booking_id
  AND bi.service_type IN ('flight', 'flights', 'FLIGHT', 'FLIGHTS')
LIMIT 1;

SELECT @br AS br, @booking_id AS booking_id, @booking_item_id AS booking_item_id;

-- -----------------------------------------------------------------------------
-- G2 — migration column exists (suite Version20261118130000)
-- Expect: 1 row. If 0 rows → G2 BUG (column missing on this DB)
-- -----------------------------------------------------------------------------
SHOW COLUMNS FROM cancellation_request LIKE 'estimated_breakdown';
SHOW COLUMNS FROM cancellation_request;

-- -----------------------------------------------------------------------------
-- A1 — booking
-- Partial cancels: cancelled_at often NULL (still Confirmed). Full cancel: set.
-- -----------------------------------------------------------------------------
SELECT id, booking_reference, total_amount, confirmed_at, cancelled_at, created_at
FROM booking
WHERE booking_reference = @br;

-- -----------------------------------------------------------------------------
-- Cells — which pax/legs are cancelled (suite A10 / B7–B8)
-- -----------------------------------------------------------------------------
SELECT
  bp.pax_id, bp.first_name, bp.last_name, bp.is_lead,
  fj.direction, fj.origin, fj.destination, fj.airline_pnr,
  fjp.id AS cell_id, fjp.vendor_pnr, fjp.eticket_number,
  bsm.status_code, bsm.backend_status, bsm.user_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE fj.booking_item_id = @booking_item_id
ORDER BY bp.pax_id, fj.sequence;

-- -----------------------------------------------------------------------------
-- CR rows — suite C1 / B3 / E3 / E4 / E10 / G4
-- (No estimated_breakdown here — column missing on this DB = G2/G3 blocked)
-- Expect for BR1795091441315761:
--   #102, #103, #104 settled success + COMPLETED refunds
--   #105 refused / rejected · no refund money
--   #104: provider_penalty_amount = 10000 (₹100) after E4 override
--   #104 refund_amount ≈ 442050; #102/#103 ≈ 452050
-- -----------------------------------------------------------------------------
-- CR has booking_item_id only (no booking_id on this schema)
SELECT *
FROM cancellation_request
WHERE booking_item_id = @booking_item_id
ORDER BY id;

-- -----------------------------------------------------------------------------
-- cancellation_passenger — which pax on each CR (E7 / E10)
-- -----------------------------------------------------------------------------
SELECT
  cr.id AS cr_id,
  cr.status AS cr_status,
  cp.id AS cp_id,
  cp.status AS cp_status,
  bp.pax_id, bp.first_name, bp.last_name,
  cp.created_at
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
WHERE cr.booking_item_id = @booking_item_id
ORDER BY cr.id, bp.pax_id;

-- -----------------------------------------------------------------------------
-- refund_transaction — one paid refund per settled CR (E3 / E4 / E10)
-- Expect 3 rows for #102/#103/#104; NONE for refused #105
-- cancellation_charge ≈ share − refund (paise)
-- -----------------------------------------------------------------------------
SELECT
  rt.id,
  rt.cancellation_request_id,
  rt.destination_type,
  rt.destination,
  rt.status,
  rt.amount,
  rt.cancellation_charge,
  rt.created_at
FROM refund_transaction rt
JOIN cancellation_request cr ON cr.id = rt.cancellation_request_id
WHERE cr.booking_item_id = @booking_item_id
ORDER BY rt.id;

-- Scorecard: refunds vs CR
SELECT
  cr.id AS cr_id,
  cr.status,
  cr.refund_status,
  cr.refund_amount AS cr_refund_amount,
  COUNT(rt.id) AS refund_rows,
  COALESCE(SUM(rt.amount), 0) AS sum_rt_amount
FROM cancellation_request cr
LEFT JOIN refund_transaction rt ON rt.cancellation_request_id = cr.id
WHERE cr.booking_item_id = @booking_item_id
GROUP BY cr.id, cr.status, cr.refund_status, cr.refund_amount
ORDER BY cr.id;

-- -----------------------------------------------------------------------------
-- payment + payment_transaction — wallet capture + refunds
-- Expect: 1 CAPTURE ~18832 (or 1883200 paise) · 3 REFUND lines for settled CRs
-- -----------------------------------------------------------------------------
SELECT p.id, p.provider, p.status, p.total_amount, p.currency, p.created_at
FROM payment p
WHERE p.booking_id = @booking_id
ORDER BY p.id;

SELECT
  pt.id, pt.payment_id, p.provider,
  pt.transaction_type, pt.status, pt.amount, pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
WHERE p.booking_id = @booking_id
ORDER BY pt.id;

-- -----------------------------------------------------------------------------
-- cancellation_event — E4 REFUND_ADJUSTED · E10 refuse · D4 NOTE
-- -----------------------------------------------------------------------------
SELECT ce.*
FROM cancellation_event ce
JOIN cancellation_request cr ON cr.id = ce.cancellation_request_id
WHERE cr.booking_item_id = @booking_item_id
ORDER BY ce.id;

-- -----------------------------------------------------------------------------
-- booking_item_sales_summary — ORIGINAL vs REVISED (suite F / H-a)
-- -----------------------------------------------------------------------------
SELECT *
FROM booking_item_sales_summary
WHERE booking_item_id = @booking_item_id
ORDER BY id;

-- -----------------------------------------------------------------------------
-- G8 — Nexus audit (may need SELECT privilege on tx_nexus)
-- Expect rows for desk settle / refuse actions on this BR
-- -----------------------------------------------------------------------------
SELECT *
FROM tx_nexus.offline_cancellation_audits
WHERE booking_reference = @br
   OR request_payload LIKE CONCAT('%', @br, '%')
   OR response_payload LIKE CONCAT('%', @br, '%')
ORDER BY id DESC
LIMIT 50;
