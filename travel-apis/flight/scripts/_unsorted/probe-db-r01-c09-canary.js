/**
 * R01 + C09 attempt on canary:
 *   1) Book RT 1ADT (prefer 2 PNRs)
 *   2) CANCEL return PNR only
 *   3) If cancel requested/completed → issue-ticket reschedule with both refs
 *   4) Dump SQL for R01 (V085–V088) + C09 (supplier recovery)
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-r01-c09-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
  extractOnwardSearchIds,
  extractReturnSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-r01-c09-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

async function searchRtPair(flight, body) {
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await flight.search(body);
    const onward = extractOnwardSearchIds(last.data, 1)[0];
    const ret = extractReturnSearchId(last.data);
    console.log('  search', i + 1, last.data?.progress?.state, 'onward', !!onward, 'return', !!ret);
    if (onward && ret) return [onward, ret];
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2000);
  }
  const onward = extractOnwardSearchIds(last?.data || {}, 1)[0];
  const ret = extractReturnSearchId(last?.data || {});
  return onward && ret ? [onward, ret] : [];
}

async function waitStatus(flight, br, max = 10) {
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', i + 1, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 2) return s;
    await sleep(2500);
  }
  return null;
}

function legsFrom(detail) {
  return (detail?.bookingResponse?.itinerary || []).map((leg) => ({
    direction: String(leg.direction || '').toUpperCase(),
    pnr: leg.pnr || null,
  }));
}

function cancelStatusOf(res) {
  return res.data?.cancellationRequest?.status
    || res.data?.data?.cancellationRequest?.status
    || null;
}

function cancelOk(status) {
  const s = String(status || '');
  return /request|complet|success|cancel/i.test(s) && !/fail/i.test(s);
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function cancelReturnLeg(client, br, returnPnr) {
  const penalty = await cancelCall(client, br, { action: 'PENALTY', pnr: returnPnr });
  console.log('PENALTY', returnPnr, penalty.status, brief(penalty.data, 280));
  await sleep(1500);
  const cancel = await cancelCall(client, br, { action: 'CANCEL', pnr: returnPnr });
  const status = cancelStatusOf(cancel);
  console.log('CANCEL', returnPnr, cancel.status, status, brief(cancel.data, 320));
  return { penalty, cancel, status };
}

function r01Sql(br) {
  return [
    'USE travelx;',
    `SET @br := '${br}';`,
    `-- V085: old return journey CANCELLED via cancellation_request reason=RESCHEDULE`,
    `SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.reason, cr.flight_journey_id
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY cr.id DESC;`,
    `-- V086: new return journey linked rescheduled_from_journey_id`,
    `SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id,
       fj.current_status_mapping_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY fj.sequence;`,
    `-- V087: onward journey unchanged (compare status + airline_pnr to pre-reschedule)`,
    `-- V088: new cells for new journey; old return cells CANCELLED`,
    `SELECT fjp.id AS cell_id, fj.id AS journey_id, fj.direction, fj.airline_pnr,
       fjp.eticket_number, fjp.status, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, fjp.id;`,
  ].join('\n');
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const tag = letterTag();
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 112, rd: 119, airlines: ['SG'] },
    { o: 'BOM', d: 'GOX', od: 114, rd: 121, airlines: ['IX'] },
    { o: 'BLR', d: 'HYD', od: 100, rd: 107, airlines: [] },
    { o: 'DEL', d: 'BOM', od: 102, rd: 109, airlines: [] },
  ];

  let fixture = null;
  let cancelFlow = null;
  for (const a of attempts) {
    console.log(`BOOK RT ${a.o}<->${a.d}`);
    try {
      const body = buildRoundTripSearchBody(a.od, a.rd, {
        origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      if (a.airlines?.length) body.preferences = { ...(body.preferences || {}), airlines: a.airlines };
      const searchIds = await searchRtPair(flight, body);
      if (searchIds.length < 2) {
        console.log('  no RT pair');
        continue;
      }
      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds,
        journeyType: 'ROUND_TRIP',
        passengerProfile: {
          title: 'Mr', firstName: 'Tarun', lastName: `Mehra ${tag}`, gender: 'Male', dob: '1986-05-17',
        },
      });
      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        console.log('  issue fail', brief(issue.data));
        continue;
      }
      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const legs = legsFrom(detail.data);
      const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
      console.log('  ->', br, status || detail.data?.status, legs);
      if (!/confirm/i.test(String(detail.data?.status || status))) continue;
      if (!pnrs.length || pnrs.every((p) => p === 'FVRVRV')) continue;
      const onward = legs.find((l) => /onward/i.test(l.direction)) || legs[0];
      const ret = legs.find((l) => /return/i.test(l.direction)) || legs[1];
      if (!ret?.pnr) continue;
      fixture = {
        br,
        status: detail.data?.status || status,
        route: `${a.o}-${a.d}`,
        airlines: a.airlines || [],
        legs,
        onwardPnr: onward?.pnr,
        returnPnr: ret.pnr,
        pnrs,
      };
      cancelFlow = await cancelReturnLeg(client, br, ret.pnr);
      if (cancelOk(cancelFlow.status)) break;
      console.log('  cancel not ok on this fixture — try next route');
      fixture = null;
    } catch (e) {
      console.log('  error', e.message);
    }
  }

  if (!fixture) throw new Error('No Confirmed RT with successful return-leg cancel for R01');

  const cancelStatus = cancelFlow.status;
  await sleep(4000);
  const afterCancel = await flight.getBookingDetail(fixture.br);
  const afterCancelStatus = afterCancel.data?.status;

  let reschedule = null;
  if (cancelOk(cancelStatus)) {
    console.log('R01 reschedule issue-ticket…');
    // price a new OW/RT leg for return replacement — simple OW same route return direction
    const [o, d] = fixture.route.split('-');
    const body = buildOneWaySearchBody(110, {
      origin: d, destination: o, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    let sid = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      sid = extractFirstSearchId(s.data);
      if (sid) break;
      if (isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (sid) {
      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (pricing.data?.priceId) {
        const payload = buildIssueTicketPayload({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [sid],
          journeyType: 'ONE_WAY',
          passengerProfile: {
            title: 'Mr', firstName: 'Tarun', lastName: `Mehra ${tag}`, gender: 'Male', dob: '1986-05-17',
          },
        });
        payload.reschedulingReferenceId = fixture.br;
        payload.reschedulingPnr = fixture.returnPnr;
        const iss = await client.request({
          method: 'POST',
          path: '/api/v2/flights/booking/issue-ticket',
          query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
          body: payload,
          correlation: true,
          partnerKey: client.partnerKey,
        });
        reschedule = {
          http: iss.status,
          code: iss.data?.error?.code || null,
          br: iss.data?.bookingReference || iss.data?.bookingReferenceId || null,
          body: brief(iss.data, 500),
        };
        console.log('RESCHEDULE', reschedule);
      }
    }
  } else {
    console.log('Skip R01 reschedule — cancel not successful:', cancelStatus);
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenarios: ['R01', 'C09'],
    fixture,
    cancel: {
      penaltyHttp: cancelFlow.penalty.status,
      cancelHttp: cancelFlow.cancel.status,
      cancelStatus,
      penaltyBody: brief(cancelFlow.penalty.data, 400),
      cancelBody: brief(cancelFlow.cancel.data, 600),
    },
    afterCancelStatus,
    reschedule,
    marks: {
      R01: cancelOk(cancelStatus) && reschedule?.br
        ? 'PENDING DB (V085–V088)'
        : cancelOk(cancelStatus)
          ? 'PARTIAL — cancel OK, reschedule issue failed'
          : `FAIL / BLOCKED — cancel=${cancelStatus}`,
      C09: /fail/i.test(String(cancelStatus))
        ? 'NOT TESTED — cancel failed (no supplier recovery row expected)'
        : 'PENDING DB — check supplier_refund_recovery',
    },
    v085_v088: {
      V085: 'Old return journey CANCELLED; cancellation_request reason=RESCHEDULE',
      V086: 'New return journey has rescheduled_from_journey_id = old return journey id',
      V087: 'Onward journey unchanged',
      V088: 'New cells on new journey; old return cells CANCELLED',
    },
    dbSql: {
      r01_c09_br: fixture.br,
      r01RescheduleSqlFile: 'reports/db-r01-reschedule.sql',
      sql: [
        'USE travelx;',
        `-- ===== M01 GST (B07) =====`,
        `SET @br := 'BR1786475320743051';`,
        `SELECT fj.id, fj.direction, fj.gst_total, fj.gst_breakup, bi.vendor_price, bi.vendor_price_cents
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
        `-- ===== M02 money schema =====`,
        `SHOW COLUMNS FROM booking_item LIKE 'vendor_price%';`,
        `SHOW COLUMNS FROM payment_transaction LIKE 'amount';`,
        `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='travelx' AND TABLE_NAME='payment_transaction' AND COLUMN_NAME='amount';`,
        `-- ===== X01 optimistic lock (READ first, then dual UPDATE in 2 tabs) =====`,
        `SELECT bi.id, bi.version FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = 'BR1786475320743051';`,
        `-- Tab A: UPDATE booking_item SET version = version + 1 WHERE id = <id> AND version = <v>;`,
        `-- Tab B (same version): same UPDATE — expect 0 rows affected on loser`,
        `-- ===== R01 / C09 on RT fixture =====`,
        `SET @br2 := '${fixture.br}';`,
        `SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.refund_status, cr.provider_status
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br2 ORDER BY cr.id DESC;`,
        `SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br2 ORDER BY fj.sequence;`,
        `SHOW TABLES LIKE '%supplier_refund%';`,
        `SHOW TABLES LIKE '%recovery%';`,
      ],
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync('reports/db-r01-reschedule.sql', r01Sql(fixture.br));
  console.log('MARKS', report.marks);
  console.log('Report', OUT);
  console.log('SQL reports/db-r01-reschedule.sql');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
