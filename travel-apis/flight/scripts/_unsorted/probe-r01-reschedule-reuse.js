/**
 * Find cancellable flights + reuse cancelled BRs for reschedule (R01 path).
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-r01-reschedule-reuse.js
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-r01-reschedule-reuse.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
  extractOnwardSearchIds,
  extractReturnSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/r01-reschedule-reuse.json';
const Q = { ...FLIGHT_QUERY };

/** Known cancelled / reschedule fixtures from prior runs */
const REUSE_CANDIDATES = [
  {
    env: 'staging',
    label: 'SG OW happy (cancelled source)',
    br: 'BR1786017179800507',
    pnr: 'B7SVXP',
    rescheduledTo: 'BR1786017237353711',
    type: 'OW',
  },
  {
    env: 'staging',
    label: 'SG OW cancel DEL-BOM',
    br: 'BR1786361308728715',
    pnr: 'KCIE7A',
    type: 'OW',
  },
  {
    env: 'staging',
    label: 'SG OW cancel scan',
    br: 'BR1786361337462087',
    pnr: 'FEG3NK',
    type: 'OW',
  },
  {
    env: 'canary',
    label: 'Canary 2ADT full cancel',
    br: 'BR1786450253892994',
    pnr: 'CQRUVC',
    type: 'OW',
  },
  {
    env: 'canary',
    label: 'C03 RT return cancel attempted',
    br: 'BR1786471471811570',
    pnr: 'WT9Q3L',
    leg: 'RETURN',
    type: 'RT_RETURN',
  },
];

function brief(d, n = 450) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function envKey() {
  return /canary/i.test(config.baseUrl) ? 'canary' : 'staging';
}

function extractPnrs(detail) {
  const legs = (detail?.bookingResponse?.itinerary || []).map((leg) => ({
    direction: String(leg.direction || '').toUpperCase(),
    pnr: leg.pnr || null,
  }));
  const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
  return { legs, pnrs };
}

async function waitStatus(flight, br, max = 12) {
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  poll', i + 1, br, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 3) return s;
    await sleep(2500);
  }
  return null;
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

function cancelStatus(res) {
  return res.data?.cancellationRequest?.status
    || res.data?.data?.cancellationRequest?.status
    || null;
}

async function tryReschedule(client, flight, { br, pnr, route, days = 35, airlines = ['SG'] }) {
  const body = buildOneWaySearchBody(days, {
    origin: route.from,
    destination: route.to,
    fareType: 'NORMAL',
    maxStops: 0,
  });
  if (airlines?.length) body.preferences = { ...(body.preferences || {}), airlines };
  body.travellers = { adults: 1, children: 0, infants: 0 };

  let sid = null;
  for (let i = 0; i < 8; i += 1) {
    const s = await flight.search(body);
    sid = extractFirstSearchId(s.data);
    if (sid) break;
    if (isSearchProgressComplete(s.data)) break;
    await sleep(2000);
  }
  if (!sid) return { ok: false, reason: 'no_search_id' };

  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  if (!pricing.data?.priceId) return { ok: false, reason: 'pricing_fail', detail: brief(pricing.data) };

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [sid],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      title: 'Mr', firstName: 'Ravi', lastName: 'Sharma r01', gender: 'Male', dob: '1988-03-12',
    },
  });
  payload.reschedulingReferenceId = br;
  payload.reschedulingPnr = pnr;

  const iss = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const newBr = iss.data?.bookingReference || iss.data?.bookingReferenceId || null;
  let newStatus = null;
  if (newBr) newStatus = await waitStatus(flight, newBr, 8);

  return {
    ok: Boolean(newBr) && /confirm/i.test(String(newStatus || iss.data?.status || '')),
    http: iss.status,
    code: iss.data?.error?.code || null,
    newBr,
    newStatus: newStatus || iss.data?.status || null,
    body: brief(iss.data, 600),
  };
}

async function checkReusePool(flight, client) {
  const ek = envKey();
  const pool = REUSE_CANDIDATES.filter((c) => c.env === ek);
  const results = [];

  for (const c of pool) {
    console.log('\nCHECK reuse', c.label, c.br, c.pnr);
    let status = null;
    let detailStatus = null;
    let legs = [];
    try {
      const st = await flight.getBookingStatus(c.br);
      status = st.data?.status || null;
      const detail = await flight.getBookingDetail(c.br);
      detailStatus = detail.data?.status || status;
      ({ legs } = extractPnrs(detail.data));
    } catch (e) {
      results.push({ ...c, error: e.message });
      continue;
    }

    const row = {
      ...c,
      currentStatus: detailStatus || status,
      legs,
      cancellable: /confirm/i.test(String(detailStatus || status)),
      cancelled: /cancel/i.test(String(detailStatus || status)),
    };

    if (row.cancelled) {
      console.log('  -> cancelled; try reschedule');
      row.reschedule = await tryReschedule(client, flight, {
        br: c.br,
        pnr: c.pnr,
        route: { from: 'DEL', to: 'BOM' },
        days: 40 + results.length,
      });
      console.log('  reschedule', row.reschedule.ok ? 'OK' : row.reschedule.code || row.reschedule.reason, row.reschedule.newBr);
    } else if (row.cancellable) {
      console.log('  -> still Confirmed; try PENALTY+CANCEL');
      const pen = await cancelCall(client, c.br, { action: 'PENALTY', pnr: c.pnr });
      await sleep(1500);
      const can = await cancelCall(client, c.br, { action: 'CANCEL', pnr: c.pnr });
      row.cancel = {
        penaltyStatus: cancelStatus(pen),
        cancelStatus: cancelStatus(can),
        penaltyHttp: pen.status,
        cancelHttp: can.status,
      };
      if (/cancel/i.test(String(row.cancel.cancelStatus)) && !/fail/i.test(String(row.cancel.cancelStatus))) {
        row.reschedule = await tryReschedule(client, flight, {
          br: c.br,
          pnr: c.pnr,
          route: { from: 'DEL', to: 'BOM' },
          days: 45 + results.length,
        });
      }
    }

    results.push(row);
  }
  return results;
}

async function freshSgOwCancelReschedule(client, flight) {
  console.log('\n=== FRESH SG OW book → cancel → reschedule ===');
  const body = buildOneWaySearchBody(52, {
    origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0,
  });
  body.preferences = { ...(body.preferences || {}), airlines: ['SG'] };
  body.travellers = { adults: 1, children: 0, infants: 0 };

  let sid = null;
  for (let i = 0; i < 10; i += 1) {
    const s = await flight.search(body);
    sid = extractFirstSearchId(s.data);
    if (sid) break;
    await sleep(2000);
  }
  if (!sid) return { ok: false, reason: 'search_fail' };

  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  if (!pricing.data?.priceId) return { ok: false, reason: 'pricing_fail' };

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [sid],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      title: 'Mr', firstName: 'Neha', lastName: 'Kapoor r01', gender: 'Female', dob: '1990-11-08',
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
  if (!br) return { ok: false, reason: 'issue_fail', body: brief(issue.data) };

  const bookStatus = await waitStatus(flight, br);
  const detail = await flight.getBookingDetail(br);
  const { legs, pnrs } = extractPnrs(detail.data);
  const pnr = pnrs[0];
  if (!/confirm/i.test(String(detail.data?.status || bookStatus)) || !pnr) {
    return { ok: false, reason: 'not_confirmed', br, status: bookStatus, pnrs };
  }

  const pen = await cancelCall(client, br, { action: 'PENALTY', pnr });
  await sleep(1500);
  const can = await cancelCall(client, br, { action: 'CANCEL', pnr });
  const cancelSt = cancelStatus(can);

  const reschedule = /cancel/i.test(String(cancelSt)) && !/fail/i.test(String(cancelSt))
    ? await tryReschedule(client, flight, { br, pnr, route: { from: 'BOM', to: 'DEL' }, days: 58 })
    : { ok: false, reason: 'cancel_failed', cancelSt };

  return {
    ok: reschedule.ok,
    br,
    pnr,
    bookStatus,
    legs,
    cancel: { penaltyStatus: cancelStatus(pen), cancelStatus: cancelSt },
    reschedule,
  };
}

async function freshRtReturnCancelReschedule(client, flight) {
  console.log('\n=== FRESH RT return-leg cancel → reschedule (R01) ===');
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 60, rd: 67, airlines: ['SG'] },
    { o: 'BOM', d: 'GOX', od: 62, rd: 69, airlines: ['IX'] },
    { o: 'BLR', d: 'HYD', od: 64, rd: 71, airlines: [] },
  ];

  for (const a of attempts) {
    console.log(`RT try ${a.o}<->${a.d}`, a.airlines);
    const body = buildRoundTripSearchBody(a.od, a.rd, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
    });
    if (a.airlines?.length) body.preferences = { ...(body.preferences || {}), airlines: a.airlines };
    body.travellers = { adults: 1, children: 0, infants: 0 };

    let searchIds = [];
    for (let i = 0; i < 10; i += 1) {
      const s = await flight.search(body);
      const onward = extractOnwardSearchIds(s.data, 1)[0];
      const ret = extractReturnSearchId(s.data);
      if (onward && ret) { searchIds = [onward, ret]; break; }
      if (isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (searchIds.length < 2) continue;

    const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
    if (!pricing.data?.priceId) continue;

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: 'ROUND_TRIP',
      passengerProfile: {
        title: 'Mr', firstName: 'Arjun', lastName: 'Verma r01', gender: 'Male', dob: '1987-04-25',
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
    if (!br) continue;

    const bookStatus = await waitStatus(flight, br);
    const detail = await flight.getBookingDetail(br);
    const { legs, pnrs } = extractPnrs(detail.data);
    if (!/confirm/i.test(String(detail.data?.status || bookStatus))) continue;

    const retLeg = legs.find((l) => /return/i.test(l.direction)) || legs[1];
    const onwardLeg = legs.find((l) => /onward/i.test(l.direction)) || legs[0];
    if (!retLeg?.pnr) continue;

    console.log('  RT booked', br, legs);
    const pen = await cancelCall(client, br, { action: 'PENALTY', pnr: retLeg.pnr });
    await sleep(1500);
    const can = await cancelCall(client, br, { action: 'CANCEL', pnr: retLeg.pnr });
    const cancelSt = cancelStatus(can);
    console.log('  return cancel', cancelSt);

    let reschedule = null;
    if (/cancel|request/i.test(String(cancelSt)) && !/fail/i.test(String(cancelSt))) {
      reschedule = await tryReschedule(client, flight, {
        br,
        pnr: retLeg.pnr,
        route: { from: a.d, to: a.o },
        days: a.rd + 5,
        airlines: a.airlines,
      });
    }

    return {
      ok: Boolean(reschedule?.ok),
      br,
      route: `${a.o}-${a.d}`,
      legs,
      pnrs,
      onwardPnr: onwardLeg?.pnr,
      returnPnr: retLeg.pnr,
      cancel: { penaltyStatus: cancelStatus(pen), cancelStatus: cancelSt },
      reschedule,
      dbSqlFile: 'reports/db-r01-reschedule.sql',
      vChecks: ['V085', 'V086', 'V087', 'V088'],
    };
  }
  return { ok: false, reason: 'no_rt_path' };
}

function r01Sql(br) {
  return [
    'USE travelx;',
    `SET @br := '${br}';`,
    `SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.reason, cr.flight_journey_id
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY cr.id DESC;`,
    `SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY fj.sequence;`,
    `SELECT fjp.id AS cell_id, fj.direction, fj.airline_pnr, fjp.eticket_number, fjp.status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY fj.sequence, fjp.id;`,
  ].join('\n');
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'env', envKey());

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const reusePool = await checkReusePool(flight, client);
  const freshOw = await freshSgOwCancelReschedule(client, flight);
  const freshRt = await freshRtReturnCancelReschedule(client, flight);

  const bestRt = freshRt.ok ? freshRt : reusePool.find((r) => r.reschedule?.ok && r.type === 'RT_RETURN');
  const bestOw = freshOw.ok ? freshOw : reusePool.find((r) => r.reschedule?.ok);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    reusePool,
    freshSgOw: freshOw,
    freshRtR01: freshRt,
    recommendation: {
      owRescheduleWorks: Boolean(bestOw),
      rtR01Works: Boolean(bestRt?.ok),
      useForDb: bestRt?.ok
        ? { scenario: 'R01', br: freshRt.br, newBr: freshRt.reschedule?.newBr, checks: 'V085-V088' }
        : bestOw
          ? { scenario: 'OW_reschedule_only', br: freshOw.br, newBr: freshOw.reschedule?.newBr, note: 'Not full R01 RT — API path only' }
          : { scenario: 'BLOCKED', note: 'No successful cancel+reschedule on this env today' },
    },
  };

  if (freshRt.br) fs.writeFileSync('reports/db-r01-reschedule.sql', r01Sql(freshRt.br));
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nRECOMMENDATION', report.recommendation);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
