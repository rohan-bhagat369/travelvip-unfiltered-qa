/**
 * C06 mixed cancel: RT 2ADT
 *   1) Cancel RETURN PNR fully ONLINE (no cancellationPaxList)
 *   2) Cancel ONWARD PNR paxwise (PAX2 only) → Cancellation Requested / offline-like
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-c06-rt-2adt-mixed-canary.js
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

const OUT = 'reports/db-c06-rt-2adt-mixed-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 600) {
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

function adults2() {
  const city = { cityCode: 'Pune', cityName: 'Pune' };
  const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  const ssr = { baggage: [], meals: [], seats: [] };
  const tag = letterTag();
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true, city, passport, ssr,
      profile: { title: 'Mr', firstName: 'Kabir', lastName: `Mehta ${tag}`, gender: 'Male', dob: '1990-01-15', nationality: 'IN' },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false, city, passport, ssr,
      profile: { title: 'Ms', firstName: 'Ananya', lastName: `Iyer ${tag}`, gender: 'Female', dob: '1992-06-20', nationality: 'IN' },
    },
  ];
}

function extractLegs(detail) {
  return (detail?.bookingResponse?.itinerary || []).map((leg) => ({
    direction: String(leg.direction || '').toUpperCase(),
    pnr: leg.pnr || null,
    onlineCancellation: leg.onlineCancellation,
  }));
}

function cancelStatus(res) {
  return res.data?.data?.cancellationRequest?.status
    || res.data?.cancellationRequest?.status
    || null;
}

async function waitStatus(flight, br) {
  for (let i = 0; i < 14; i += 1) {
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

async function bookRt2adt(flight, client) {
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 20, rd: 25, airlines: ['SG'] },
    { o: 'BOM', d: 'DEL', od: 21, rd: 25, airlines: ['SG'] },
    { o: 'BLR', d: 'HYD', od: 22, rd: 25, airlines: [] },
    { o: 'MAA', d: 'BOM', od: 20, rd: 24, airlines: [] },
    { o: 'AMD', d: 'DEL', od: 23, rd: 25, airlines: [] },
  ];

  for (const a of attempts) {
    console.log(`BOOK RT 2ADT ${a.o}<->${a.d} +${a.od}/${a.rd}`, a.airlines?.length ? a.airlines : 'any');
    const body = buildRoundTripSearchBody(a.od, a.rd, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
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

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: search.searchIds,
      journeyType: 'ROUND_TRIP',
    });
    payload.data.passengers = adults2();

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
    const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
    console.log('  ->', br, detailStatus, legs, pax);

    if (!/confirm/i.test(String(detailStatus))) continue;
    if (pnrs.length < 2) {
      console.log('  need 2 PNRs for mixed cancel');
      continue;
    }

    const onward = legs.find((l) => /onward/i.test(l.direction)) || legs[0];
    const ret = legs.find((l) => /return/i.test(l.direction)) || legs[1];
    if (!onward?.pnr || !ret?.pnr) continue;

    return {
      br,
      status: detailStatus,
      route: `${a.o}-${a.d}`,
      legs,
      pnrs,
      pax: pax.length ? pax : ['PAX1', 'PAX2'],
      onwardPnr: onward.pnr,
      returnPnr: ret.pnr,
    };
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('C06 RT 2ADT mixed cancel on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookRt2adt(flight, client);
  if (!fixture) throw new Error('No Confirmed RT 2ADT with 2 PNRs');

  console.log('\n=== STEP 1: ONLINE full cancel RETURN', fixture.returnPnr, '===');
  const penRet = await cancelCall(client, fixture.br, { action: 'PENALTY', pnr: fixture.returnPnr });
  console.log('PENALTY return', penRet.status, cancelStatus(penRet));
  await sleep(2000);
  const canRet = await cancelCall(client, fixture.br, { action: 'CANCEL', pnr: fixture.returnPnr });
  const onlineResult = {
    pnr: fixture.returnPnr,
    leg: 'RETURN',
    mode: 'ONLINE_FULL',
    http: canRet.status,
    status: cancelStatus(canRet),
    paxScope: canRet.data?.data?.paxScope || canRet.data?.paxScope || null,
    body: brief(canRet.data),
  };
  console.log('CANCEL return', onlineResult.status, onlineResult.paxScope);
  await sleep(4000);

  const mid = await flight.getBookingStatus(fixture.br);
  console.log('After online return cancel:', mid.data?.status);

  console.log('\n=== STEP 2: PAXWISE cancel ONWARD', fixture.onwardPnr, 'PAX2 only ===');
  const penOw = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: fixture.onwardPnr,
    cancellationPaxList: ['PAX2'],
  });
  console.log('PENALTY onward paxwise', penOw.status, cancelStatus(penOw));
  await sleep(2000);
  const canOw = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: fixture.onwardPnr,
    cancellationPaxList: ['PAX2'],
  });
  const paxwiseResult = {
    pnr: fixture.onwardPnr,
    leg: 'ONWARD',
    mode: 'PAXWISE_PAX2',
    http: canOw.status,
    status: cancelStatus(canOw),
    paxScope: canOw.data?.data?.paxScope || canOw.data?.paxScope || null,
    body: brief(canOw.data),
  };
  console.log('CANCEL onward paxwise', paxwiseResult.status, paxwiseResult.paxScope);

  await sleep(5000);
  let afterStatus = (await flight.getBookingStatus(fixture.br)).data?.status;
  for (let i = 0; i < 6; i += 1) {
    console.log('  poll', i + 1, afterStatus);
    if (/cancel/i.test(String(afterStatus || ''))) break;
    await sleep(3000);
    afterStatus = (await flight.getBookingStatus(fixture.br)).data?.status;
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C06',
    checks: ['V076', 'V077'],
    fixture,
    midStatus: mid.data?.status,
    onlineReturnCancel: onlineResult,
    paxwiseOnwardCancel: paxwiseResult,
    afterStatus,
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      '',
      '-- V076: expect 2 cancellation_request — ONLINE (return) + OFFLINE/requested (onward paxwise)',
      `SELECT cr.id, cr.pnr, cr.flight_journey_id, fj.direction,
       cr.cancellation_type, cr.mode, cr.status, cr.created_at
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN flight_journey fj ON fj.id = cr.flight_journey_id
WHERE b.booking_reference = @br
ORDER BY cr.id;`,
      '',
      '-- V077: same booking_item',
      `SELECT cr.id, cr.booking_item_id, cr.pnr, cr.mode, cr.status
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id;`,
      '',
      `SELECT b.booking_reference, b.cancelled_at, bi.id, bsm.backend_status, bsm.user_status
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;`,
    ].join('\n'),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nAFTER', afterStatus);
  console.log('ONLINE return:', onlineResult.status);
  console.log('PAXWISE onward:', paxwiseResult.status, paxwiseResult.paxScope);
  console.log('Report', OUT);
  console.log(`\nSQL: SET @br := '${fixture.br}';`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
