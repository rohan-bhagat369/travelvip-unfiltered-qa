-- Case D webhook finish — DB evidence (phpMyAdmin → travelx)
-- Changelog §5: PENDING book + later supplier webhook CONFIRMED / FAILED / FAILED+wallet_refund_fail
--
-- Signal of webhook in DB (no dedicated webhook_events table in our packs):
--   booking_item_status_history.provider_timestamp  ← set from supplier webhook timeStamp
--   status_mapping transition PENDING → CONFIRMED / FAILED
--   payment / payment_transaction / refund_transaction for charge/refund
--   user_actions.partner_webhook_status (hotel/flight; cab often skips ua)
--
-- Known Case D BRs (theta 2026-11-18):
--   Flight D pending (recheck PASS): BR1795000063318051
--   Cab D: BR1794987430226336 , BR1794995178921937
--   Hotel D: no BR (null bookingRefId) — cannot query

USE travelx;

-- 0) Discover webhook-ish tables (optional)
SHOW TABLES LIKE '%webhook%';
SHOW TABLES LIKE '%provider%event%';
SHOW COLUMNS FROM booking_item_status_history;
SHOW COLUMNS FROM user_actions LIKE '%webhook%';

-- ========== Pin one BR ==========
SET @br := 'BR1795000063318051';  -- swap: cab BR1794987430226336 / BR1794995178921937

-- 1) Resolve booking + item
SELECT
  b.id AS booking_id,
  b.booking_reference,
  b.partner_id,
  bi.id AS booking_item_id,
  bi.service_type,
  bi.current_status_mapping_id,
  m.status_code,
  m.backend_status,
  m.user_status
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping m ON m.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- Keep ids for later blocks (run after seeing results above)
-- SET @booking_id := ...;
-- SET @booking_item_id := ...;

-- 2) Status history = webhook / lifecycle trail
--    provider_timestamp populated ⇒ supplier webhook (or provider time) was recorded
SELECT
  his.id,
  his.booking_item_id,
  his.status_mapping_id,
  m.status_code,
  m.backend_status,
  m.user_status,
  his.provider_timestamp,
  CASE
    WHEN his.provider_timestamp IS NULL THEN 'no provider_ts (may be internal)'
    ELSE 'has provider_ts (webhook/provider signal)'
  END AS webhook_signal,
  his.occurred_at,
  his.created_at
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping m ON m.id = his.status_mapping_id
WHERE b.booking_reference = @br
ORDER BY his.id;

-- 3) Score Case D finish from current status + money
--    CONFIRMED webhook expect: user_status Confirmed/CONFIRMED; payment captured; no refund
--    FAILED webhook expect: Failed; payment refunded; CAPTURE+REFUND; refund_transaction completed
--    FAILED + wallet_refund_fail: Failed; payment stays captured; NO refund_transaction
SELECT
  b.booking_reference,
  m.user_status AS current_status,
  p.id AS payment_id,
  p.status AS payment_status,
  p.total_amount,
  p.provider,
  (SELECT COUNT(*) FROM payment_transaction pt WHERE pt.payment_id = p.id AND pt.transaction_type = 'CAPTURE') AS capture_rows,
  (SELECT COUNT(*) FROM payment_transaction pt WHERE pt.payment_id = p.id AND pt.transaction_type = 'REFUND') AS refund_txn_rows,
  (SELECT COUNT(*) FROM refund_transaction rt WHERE rt.booking_item_id = bi.id) AS refund_transaction_rows,
  CASE
    WHEN m.user_status REGEXP 'confirm' AND p.status IN ('captured','CAPTURED') THEN 'looks like CONFIRMED webhook path'
    WHEN m.user_status REGEXP 'fail|pending' = 0 AND p.status IN ('refunded','REFUNDED') THEN 'looks like FAILED webhook + refund'
    WHEN m.user_status REGEXP 'fail' AND p.status IN ('captured','CAPTURED')
      AND (SELECT COUNT(*) FROM refund_transaction rt WHERE rt.booking_item_id = bi.id) = 0
      THEN 'looks like FAILED + refund-fail (or still pending charge)'
    WHEN m.user_status REGEXP 'pending' AND p.status IN ('captured','CAPTURED')
      THEN 'still PENDING — webhook not applied yet (Case D open)'
    ELSE 'review history + payment manually'
  END AS case_d_finish_read
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping m ON m.id = bi.current_status_mapping_id
LEFT JOIN payment p ON p.booking_id = b.id
WHERE b.booking_reference = @br;

-- 4) payment_transaction detail
SELECT
  pt.id,
  pt.payment_id,
  pt.transaction_type,
  pt.status,
  pt.amount,
  pt.created_at
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id;

-- 5) refund_transaction (FAILED webhook success path)
SELECT
  rt.*
FROM refund_transaction rt
JOIN booking_item bi ON bi.id = rt.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY rt.id;

-- 6) user_actions (hotel/flight; cab often empty)
SELECT
  ua.id,
  ua.action_name,
  ua.action_id,
  ua.partner_webhook_status,
  ua.status,
  ua.action_timestamp_utc,
  ua.created_at
FROM user_actions ua
WHERE ua.action_id = @br
ORDER BY ua.id;

-- ========== Batch: all known Case D BRs ==========
SELECT
  b.booking_reference,
  bi.id AS booking_item_id,
  bi.service_type,
  m.user_status,
  p.status AS payment_status,
  (SELECT COUNT(*) FROM booking_item_status_history h WHERE h.booking_item_id = bi.id AND h.provider_timestamp IS NOT NULL) AS history_rows_with_provider_ts,
  (SELECT COUNT(*) FROM booking_item_status_history h WHERE h.booking_item_id = bi.id) AS history_rows_total,
  (SELECT COUNT(*) FROM refund_transaction rt WHERE rt.booking_item_id = bi.id) AS refund_rows
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping m ON m.id = bi.current_status_mapping_id
LEFT JOIN payment p ON p.booking_id = b.id
WHERE b.booking_reference IN (
  'BR1795000063318051',  -- flight D pending recheck
  'BR1794987430226336',  -- cab D
  'BR1794995178921937'   -- cab D recheck
)
ORDER BY b.id;

-- ========== webhook_events (payloads in `data`) ==========
-- Table: travelx.webhook_events
-- booking_id here = booking.id (numeric), NOT booking_reference
-- Case D flight BR1795000063318051 → booking.id 5311 (from payment row)

-- A) Resolve BR → booking_id, then payloads
SELECT
  b.booking_reference,
  b.id AS booking_id,
  we.id AS webhook_event_id,
  we.partner,
  we.name,
  we.type,
  we.booking_status,
  we.status AS event_status,
  we.retry_count,
  we.sent_at_ts,
  we.created_at,
  we.updated_at,
  we.data
FROM booking b
LEFT JOIN webhook_events we ON we.booking_id = b.id
WHERE b.booking_reference IN (
  'BR1795000063318051',  -- Flight Case D (PENDING)
  'BR1794987430226336',  -- Cab Case D
  'BR1794995178921937'   -- Cab Case D recheck
)
ORDER BY b.id, we.id;

-- B) Single BR (Flight D)
SELECT we.*
FROM webhook_events we
JOIN booking b ON b.id = we.booking_id
WHERE b.booking_reference = 'BR1795000063318051'
ORDER BY we.id;

-- C) By known booking.id (Flight D = 5311)
SELECT id, partner, name, type, booking_id, booking_status, status, retry_count, sent_at_ts, created_at, data
FROM webhook_events
WHERE booking_id = 5311
ORDER BY id;

-- D) Score helper: any outbound/inbound event yet?
SELECT
  b.booking_reference,
  b.id AS booking_id,
  COUNT(we.id) AS webhook_event_count,
  GROUP_CONCAT(DISTINCT we.name ORDER BY we.id) AS event_names,
  GROUP_CONCAT(DISTINCT we.booking_status ORDER BY we.id) AS booking_statuses
FROM booking b
LEFT JOIN webhook_events we ON we.booking_id = b.id
WHERE b.booking_reference IN (
  'BR1795000063318051',
  'BR1794987430226336',
  'BR1794995178921937'
)
GROUP BY b.booking_reference, b.id;

-- E) If join returns nothing, search data JSON for BR (fallback)
SELECT id, partner, name, type, booking_id, booking_status, status, created_at, data
FROM webhook_events
WHERE data LIKE '%BR1795000063318051%'
   OR data LIKE '%BR1794987430226336%'
   OR data LIKE '%BR1794995178921937%'
ORDER BY id DESC
LIMIT 50;

-- ========== Follow-up: empty payment_transaction / user_actions ==========
-- phpMyAdmin often drops @br between tabs — always re-SET, or use literal BR.

SET @br := 'BR1795000063318051';

-- Confirm payment row exists
SELECT p.id AS payment_id, p.booking_id, p.status, p.total_amount, p.provider, p.created_at
FROM payment p
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = 'BR1795000063318051';

-- payment_transaction via payment_id (literal BR — no @var)
SELECT pt.*
FROM payment_transaction pt
WHERE pt.payment_id = (
  SELECT p.id FROM payment p
  JOIN booking b ON b.id = p.booking_id
  WHERE b.booking_reference = 'BR1795000063318051'
  LIMIT 1
);

-- If still empty: check column names / orphan txns
SHOW COLUMNS FROM payment_transaction;
SELECT pt.id, pt.payment_id, pt.transaction_type, pt.status, pt.amount, pt.created_at
FROM payment_transaction pt
ORDER BY pt.id DESC
LIMIT 20;

-- user_actions — try action_id = BR and LIKE
SELECT * FROM user_actions WHERE action_id = 'BR1795000063318051' ORDER BY id;
SELECT * FROM user_actions WHERE action_id LIKE '%1795000063318051%' ORDER BY id;
SELECT * FROM user_actions WHERE action_id LIKE '%BR1795000063318051%' ORDER BY id DESC LIMIT 20;
