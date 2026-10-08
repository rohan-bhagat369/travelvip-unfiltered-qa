/**
 * Pending DB pack checks (11 rows): B08, V042, R01, C09, X01.
 * API side where possible; emits phpMyAdmin SQL for you to paste back.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-pending-pack.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';

const OUT = 'reports/db-pending-pack.json';

const B08_BR = 'BR1786476212954979';
const B07_BR = 'BR1786475320743051'; // X01 optimistic-lock fixture

function sqlBlock(title, lines) {
  return [`-- ===== ${title} =====`, ...lines, ''];
}

async function fetchB08Api(flight) {
  const detail = await flight.getBookingDetail(B08_BR);
  const d = detail.data || {};
  const pax = d.bookingResponse?.passengers?.[0];
  const contact = d.bookingResponse?.contact || d.contact || null;
  const sent = JSON.parse(fs.readFileSync('reports/book-b08-notify-canary.json', 'utf8'));
  return {
    br: B08_BR,
    http: detail.status,
    status: d.status,
    pnr: (d.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null,
    sentContact: sent.sentContact,
    sentPassenger: sent.sentPassenger,
    apiContact: contact,
    apiPax: pax
      ? {
          paxId: pax.paxId,
          name: `${pax.profile?.firstName || ''} ${pax.profile?.lastName || ''}`.trim(),
          email: pax.profile?.email || pax.email || null,
          phone: pax.profile?.mobile || pax.mobile || null,
        }
      : null,
    apiPreliminary: {
      V034: contact
        ? `API contact present: email=${contact.email || contact.contactEmail || '?'}` 
        : 'API detail did not surface contact — DB still authoritative for V033–V035',
      V035: pax && contact
        ? `Compare sent notify ${sent.sentContact.email} vs pax email ${pax.profile?.email || 'null'}`
        : 'Need DB notify_* vs passenger row',
    },
  };
}

function buildSql() {
  return [
    ...sqlBlock('B08 V033–V035 + G10 (notify)', [
      'USE travelx;',
      `SET @br := '${B08_BR}';`,
      "SHOW COLUMNS FROM booking LIKE 'notify%';",
      "SHOW COLUMNS FROM booking_item LIKE 'notify%';",
      `SELECT bi.id, bi.notify_name, bi.notify_email, bi.notify_phone, bi.notify_country_code
FROM booking_item bi JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
      `SELECT bp.pax_id, bp.first_name, bp.last_name, bp.email AS pax_email, bp.phone AS pax_phone,
       bi.notify_name, bi.notify_email, bi.notify_phone
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
JOIN booking_item bi ON bi.booking_id = b.id
WHERE b.booking_reference = @br;`,
      '-- Score: V033 PASS if notify_* only on booking_item and populated',
      '-- V034 PASS if notify_email/phone match issue-ticket contact (cardholder.qa@example.com / 9000011122)',
      '-- V035 PASS if notify ≠ passenger (Suresh Patil ptua; pax email/phone may be null)',
    ]),
    ...sqlBlock('B10 V042 schema (no booking needed)', [
      'USE travelx;',
      "SHOW COLUMNS FROM booking_item_flight LIKE 'refresh%';",
      "SHOW COLUMNS FROM booking_item LIKE 'refresh%';",
      '-- PASS if both empty (refresh_token absent post Phase D)',
      '-- FAIL if refresh_token column still on booking_item_flight',
    ]),
    ...sqlBlock('X01 V094–V095 optimistic lock (manual 2-tab test)', [
      'USE travelx;',
      `-- fixture B07 ${B07_BR}`,
      `SELECT bi.id AS booking_item_id, bi.version, b.booking_reference
FROM booking_item bi JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = '${B07_BR}';`,
      '-- Tab A: START TRANSACTION; read version v; UPDATE booking_item SET version = version + 1 WHERE id = <id> AND version = v; COMMIT;',
      '-- Tab B (before A commits): same UPDATE with same v — expect 0 rows affected (V095 PASS)',
      '-- Tab A after commit: version should be v+1 (V094 PASS)',
    ]),
    ...sqlBlock('C09 V084 + R01 V085–V088 (after R01 probe run)', [
      'USE travelx;',
      '-- Replace @br2 with RT fixture from reports/db-r01-c09-canary.json',
      "SET @br2 := '<RT_BR_FROM_R01_PROBE>';",
      `SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id,
       fj.current_status_mapping_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br2 ORDER BY fj.sequence;`,
      `SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.reason
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br2 ORDER BY cr.id DESC;`,
      "SHOW TABLES LIKE '%supplier%recovery%';",
      "SHOW TABLES LIKE '%supplier_refund%';",
      `-- If supplier table exists, join recovery rows for latest cancel on @br2`,
      `-- V084: customer refund minus supplier recovery computable`,
    ]),
  ].join('\n');
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);
  console.log('Pending pack: B08 API + SQL bundle for V033–V035, V042, X01, R01/C09');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  let b08 = null;
  try {
    b08 = await fetchB08Api(flight);
    console.log('B08', b08.br, b08.status, b08.pnr);
  } catch (e) {
    b08 = { error: e.message };
    console.log('B08 API error', e.message);
  }

  const sql = buildSql();
  fs.writeFileSync('reports/db-pending-pack.sql', sql);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    pending: {
      B08: { checks: ['V033', 'V034', 'V035'], br: B08_BR, status: 'NEED_DB_PASTE', api: b08 },
      V042: { check: 'V042', status: 'RUN_SQL_IN_PHPMYADMIN', passIf: 'no refresh% column on booking_item_flight' },
      X01: { checks: ['V094', 'V095'], br: B07_BR, status: 'MANUAL_DUAL_UPDATE', bookingItemHint: 'id from B07 SQL' },
      R01: { checks: ['V085', 'V086', 'V087', 'V088'], status: 'RUN probe-db-r01-c09-canary.js then DB' },
      C09: { check: 'V084', status: 'BLOCKED_UNLESS_CANCEL_OK', note: 'needs supplier_refund_recovery after successful cancel' },
    },
    nextSteps: [
      '1. Paste reports/db-pending-pack.sql in phpMyAdmin (travelx) — start with B08 + V042 blocks',
      '2. Run: BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-r01-c09-canary.js',
      '3. Paste R01/C09 SQL results + X01 dual-UPDATE outcome back here',
    ],
    sqlFile: 'reports/db-pending-pack.sql',
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('Wrote', OUT);
  console.log('Wrote reports/db-pending-pack.sql');
  console.log('\n--- Paste this first (B08 + V042) ---\n');
  console.log(sql.split('-- ===== C09')[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
