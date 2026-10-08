/**
 * C06 — mixed-mode cancel: RT with one online + one offline leg, cancel whole booking.
 * Tries mixed-airline RT (SG online + 6E/IX offline-prone), cancels both PNRs.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-c06-fresh-mixed-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  extractOnwardSearchIds,
  extractReturnSearchId,
  isSearchProgressComplete,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-c06-fresh-mixed-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function legsFrom(detail) {
  return (detail?.bookingResponse?.itinerary || []).map((leg) => ({
    direction: String(leg.direction || '').toUpperCase(),
    pnr: leg.pnr || null,
    onlineCancellation: leg.onlineCancellation,
    airline: leg.segments?.[0]?.airlineCode || leg.segments?.[0]?.marketingAirline || null,
  }));
}

function cancelStatus(res) {
  return res.data?.data?.cancellationRequest?.status
    || res.data?.cancellationRequest?.status
    || null;
}

function cancelMsg(res) {
  return res.data?.data?.cancellationRequest?.message
    || res.data?.cancellationRequest?.message
    || '';
}

async function searchRtPair(flight, body) {
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await flight.search(body);
    const onward = extractOnwardSearchIds(last.data, 1)[0];
    const ret = extractReturnSearchId(last.data);
    if (onward && ret) return [onward, ret];
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2000);
  }
  const onward = extractOnwardSearchIds(last?.data || {}, 1)[0];
  const ret = extractReturnSearchId(last?.data || {});
  return onward && ret ? [onward, ret] : [];
}

async function waitStatus(flight, br) {
  for (let i = 0; i < 12; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', i + 1, s);
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
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function cancelPnr(client, br, pnr) {
  const pen = await cancelCall(client, br, { action: 'PENALTY', pnr });
  const penSt = cancelStatus(pen);
  const penMsg = cancelMsg(pen);
  console.log('  PENALTY', pnr, pen.status, penSt, penMsg.slice(0, 80));
  await sleep(1500);
  const can = await cancelCall(client, br, { action: 'CANCEL', pnr });
  const canSt = cancelStatus(can);
  const canMsg = cancelMsg(can);
  console.log('  CANCEL', pnr, can.status, canSt, canMsg.slice(0, 80));
  return { pnr, penalty: { http: pen.status, status: penSt, message: penMsg, body: brief(pen.data) },
    cancel: { http: can.status, status: canSt, message: canMsg, body: brief(can.data) } };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('C06 fresh mixed-mode', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const tag = String(Date.now()).slice(-4);
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 20, rd: 25, onwardAir: ['SG'], returnAir: ['6E'] },
    { o: 'DEL', d: 'BOM', od: 21, rd: 25, onwardAir: ['6E'], returnAir: ['SG'] },
    { o: 'DEL', d: 'BOM', od: 22, rd: 25, onwardAir: ['SG'], returnAir: ['IX'] },
    { o: 'BLR', d: 'HYD', od: 20, rd: 25, onwardAir: ['6E'], returnAir: ['IX'] },
    { o: 'DEL', d: 'BOM', od: 20, rd: 25, onwardAir: [], returnAir: [] },
  ];

  let fixture = null;
  const bookAttempts = [];

  for (const a of attempts) {
    console.log(`\nTRY mixed RT ${a.o}<->${a.d} +${a.od}/${a.rd}`, a);
    try {
      const body = buildRoundTripSearchBody(a.od, a.rd, {
        origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      if (a.onwardAir?.length || a.returnAir?.length) {
        body.preferences = { ...(body.preferences || {}), airlines: [...new Set([...(a.onwardAir || []), ...(a.returnAir || [])])] };
      }
      const searchIds = await searchRtPair(flight, body);
      if (searchIds.length < 2) {
        bookAttempts.push({ ...a, result: 'NO_RT_PAIR' });
        continue;
      }
      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        bookAttempts.push({ ...a, result: 'NO_PRICING' });
        continue;
      }
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds,
        journeyType: 'ROUND_TRIP',
        passengerProfile: {
          title: 'Mr', firstName: 'Rahul', lastName: `Verma ${tag}`, gender: 'Male', dob: '1987-04-11',
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
        bookAttempts.push({ ...a, result: 'ISSUE_FAIL', detail: brief(issue.data) });
        continue;
      }
      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const legs = legsFrom(detail.data);
      const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
      console.log('  ->', br, detail.data?.status || status, legs);

      if (!/confirm/i.test(String(detail.data?.status || status))) {
        bookAttempts.push({ ...a, br, result: 'NOT_CONFIRMED' });
        continue;
      }
      if (pnrs.length < 2) {
        bookAttempts.push({ ...a, br, result: 'SINGLE_PNR', legs });
        continue;
      }

      fixture = { br, route: `${a.o}-${a.d}`, legs, pnrs, ...a };
      break;
    } catch (e) {
      bookAttempts.push({ ...a, result: 'ERROR', error: e.message });
    }
  }

  if (!fixture) throw new Error('No Confirmed RT with 2 PNRs for C06');

  console.log('\nC06 cancel both PNRs (whole booking intent)');
  const cancels = [];
  for (const pnr of fixture.pnrs) {
    cancels.push(await cancelPnr(client, fixture.br, pnr));
    await sleep(3000);
  }

  let afterStatus = (await flight.getBookingStatus(fixture.br)).data?.status;
  for (let i = 0; i < 10 && !/cancel/i.test(String(afterStatus || '')); i += 1) {
    await sleep(3000);
    afterStatus = (await flight.getBookingStatus(fixture.br)).data?.status;
    console.log('  after', i + 1, afterStatus);
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C06',
    checks: ['V076', 'V077'],
    fixture,
    bookAttempts,
    cancels,
    afterStatus,
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      `SELECT cr.id, cr.pnr, cr.flight_journey_id, fj.direction, cr.mode, cr.status, cr.cancellation_type
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN flight_journey fj ON fj.id = cr.flight_journey_id
WHERE b.booking_reference = @br ORDER BY cr.id;`,
      `SELECT cr.id, cr.booking_item_id, COUNT(*) OVER (PARTITION BY cr.booking_item_id) AS reqs_on_item
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
    ].join('\n'),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nFIXTURE', fixture.br, fixture.pnrs, 'AFTER', afterStatus);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
