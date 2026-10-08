/**
 * C03 on canary: RT 1ADT, cancel RETURN PNR only (onward stays).
 * DB checks V067–V070.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-c03-return-leg-canary.js
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
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-c03-return-leg-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 18; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 4) return st;
    await sleep(3000);
  }
  return last?.data?.status;
}

function extractLegs(detail) {
  const it = detail?.bookingResponse?.itinerary || [];
  return it.map((leg) => ({
    direction: String(leg.direction || '').toUpperCase(),
    pnr: leg.pnr || null,
    onlineCancellation: leg.onlineCancellation,
  }));
}

async function bookRt1adt(flight, client) {
  // d+20..25 — same window that cancelled successfully for B05 / OW canary
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 20, rd: 25, airlines: ['SG'] },
    { o: 'BOM', d: 'DEL', od: 21, rd: 25, airlines: ['SG'] },
    { o: 'BLR', d: 'HYD', od: 22, rd: 25, airlines: [] },
    { o: 'MAA', d: 'BOM', od: 23, rd: 25, airlines: [] },
    { o: 'AMD', d: 'DEL', od: 20, rd: 24, airlines: [] },
    { o: 'PNQ', d: 'BLR', od: 21, rd: 25, airlines: [] },
  ];

  for (const a of attempts) {
    console.log(`BOOK RT 1ADT ${a.o}<->${a.d} +${a.od}/${a.rd}`, a.airlines?.length ? a.airlines : 'any');
    const body = buildRoundTripSearchBody(a.od, a.rd, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    if (a.airlines?.length) body.preferences.airlines = a.airlines;

    const search = await flight.searchRoundTripUntilComplete(body);
    if (!search.searchIds || search.searchIds.length < 2) {
      console.log('  no RT pair');
      continue;
    }
    const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
    if (!pricing.data?.priceId) {
      console.log('  pricing fail', brief(pricing.data, 200));
      continue;
    }
    const tag = String(Date.now()).slice(-4);
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: search.searchIds,
      journeyType: 'ROUND_TRIP',
      passengerProfile: {
        title: 'Mr', firstName: 'Vivek', lastName: `Kapoor ${tag}`, gender: 'Male', dob: '1988-03-14',
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
      console.log('  issue fail', brief(issue.data, 250));
      continue;
    }
    const status = await waitStatus(flight, br);
    const detail = await flight.getBookingDetail(br);
    const detailStatus = detail.data?.status || status;
    const legs = extractLegs(detail.data);
    const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
    console.log('  ->', br, detailStatus, legs.map((l) => `${l.direction}:${l.pnr}`).join(' | '));

    if (!/confirm/i.test(String(detailStatus))) continue;
    if (!pnrs.length || pnrs.every((p) => p === 'FVRVRV')) continue;

    const onward = legs.find((l) => /onward|outbound/i.test(l.direction)) || legs[0];
    const ret = legs.find((l) => /return|inbound/i.test(l.direction)) || legs[1];
    if (!ret?.pnr) {
      console.log('  no return PNR');
      continue;
    }
    return {
      br,
      status: detailStatus,
      route: `${a.o}-${a.d}`,
      legs,
      pnrs,
      onwardPnr: onward?.pnr || null,
      returnPnr: ret.pnr,
      distinctPnrs: pnrs.length > 1,
    };
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookRt1adt(flight, client);
  if (!fixture) throw new Error('No Confirmed RT 1ADT on canary for C03');

  console.log('FIXTURE', fixture);
  console.log('C03 CANCEL RETURN ONLY', fixture.returnPnr, '(keep onward', fixture.onwardPnr, ')');

  const penalty = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body: { action: 'PENALTY', pnr: fixture.returnPnr, retryCount: 2 },
    correlation: true,
    partnerKey: client.partnerKey,
  });
  console.log('PENALTY', penalty.status, brief(penalty.data, 280));
  await sleep(2000);

  const cancel = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body: {
      action: 'CANCEL',
      pnr: fixture.returnPnr,
      retryCount: 2,
      // full pax on that PNR (return leg only)
    },
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const cancelResult = {
    http: cancel.status,
    code: cancel.data?.error?.code || null,
    cancelStatus: cancel.data?.cancellationRequest?.status
      || cancel.data?.data?.cancellationRequest?.status
      || null,
    paxScope: cancel.data?.paxScope || cancel.data?.data?.paxScope || null,
    body: brief(cancel.data, 700),
    penaltyStatus: penalty.data?.cancellationRequest?.status
      || penalty.data?.data?.cancellationRequest?.status
      || null,
  };
  console.log('CANCEL', cancelResult);

  await sleep(5000);
  const after = await flight.getBookingDetail(fixture.br);
  const afterStatus = after.data?.status;
  const afterLegs = extractLegs(after.data);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C03',
    checks: ['V067', 'V068', 'V069', 'V070'],
    interpretation: {
      V067: 'cancellation_request only for RETURN journey/PNR',
      V068: 'return journey/cells cancelled or cancel-requested; onward not',
      V069: 'onward PNR/journey still live',
      V070: 'booking not fully cancelled (cancelled_at NULL / still Confirmed or partial)',
    },
    fixture,
    cancelResult,
    afterStatus,
    afterLegs,
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      '',
      '-- booking',
      `SELECT id, booking_reference, confirmed_at, cancelled_at
FROM booking WHERE booking_reference = @br;`,
      '',
      '-- journeys (expect return cancel; onward live)',
      `SELECT fj.id, fj.sequence, fj.direction, fj.origin, fj.destination, fj.airline_pnr, fj.status
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence;`,
      '',
      '-- V067: cancel requests — should be return PNR only',
      `SELECT cr.*
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;`,
      '',
      '-- cancel passengers linked',
      `SELECT cp.*, bp.pax_id, bp.first_name, cr.pnr AS request_pnr, cr.flight_journey_id
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cp.id;`,
      '',
      '-- cells both legs',
      `SELECT bp.pax_id, fj.sequence, fj.direction, fj.airline_pnr,
       fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY fj.sequence, bp.pax_id;`,
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('AFTER', afterStatus, afterLegs);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
