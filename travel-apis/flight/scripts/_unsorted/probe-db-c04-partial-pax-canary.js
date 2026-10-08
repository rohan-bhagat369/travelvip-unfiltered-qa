/**
 * C04 on canary: book 2ADT OW, cancel PAX2 only (paxwise cancellationPaxList).
 * DB checks V071–V073 — paste SQL in phpMyAdmin (canary/shared travelx).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-c04-partial-pax-canary.js
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
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-c04-partial-pax-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 16; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    // canary: leave Inprogress after brief wait
    if (/inprogress/i.test(st) && i >= 3) {
      console.log('  leaving Inprogress');
      return st;
    }
    await sleep(3000);
  }
  return last?.data?.status;
}

function extractLegs(detail) {
  const it = detail?.bookingResponse?.itinerary || [];
  return it.map((leg) => ({
    direction: leg.direction,
    pnr: leg.pnr,
    onlineCancellation: leg.onlineCancellation,
  }));
}

function paxTemplate() {
  const city = { cityCode: 'Pune', cityName: 'Pune' };
  const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  const ssr = { baggage: [], meals: [], seats: [] };
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true, city, passport, ssr,
      profile: { title: 'Mr', firstName: 'Kabir', lastName: 'Mehta', gender: 'Male', dob: '1990-01-15', nationality: 'IN' },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false, city, passport, ssr,
      profile: { title: 'Mr', firstName: 'Arjun', lastName: 'Nair', gender: 'Male', dob: '1991-06-20', nationality: 'IN' },
    },
  ];
}

async function issueAndWait(flight, client, payload) {
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
    console.log('  issue fail', brief(issue.data, 280));
    return null;
  }
  const status = await waitStatus(flight, br);
  const detail = await flight.getBookingDetail(br);
  const detailStatus = detail.data?.status || status;
  const legs = extractLegs(detail.data);
  const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
  const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
  console.log('  ->', br, detailStatus, pnrs.join('|'), pax.join(','));
  if (!pnrs.length || /fail|cancel/i.test(String(detailStatus))) return null;
  if (pnrs.every((p) => p === 'FVRVRV')) {
    console.log('  skip stub PNR FVRVRV');
    return null;
  }
  if (pax.length < 2 && !/confirm/i.test(String(detailStatus))) {
    // still usable if Confirmed-ish with PNR
  }
  if (!/confirm/i.test(String(detailStatus)) && !pnrs.length) return null;
  // Prefer Confirmed; accept with real PNR if canary stuck Pending briefly after PNR
  if (!/confirm/i.test(String(detailStatus))) {
    console.log('  not Confirmed yet — skip for C04 DB');
    return null;
  }
  return {
    br,
    status: detailStatus,
    legs,
    pnrs,
    pax,
    pnr: pnrs[0],
  };
}

async function book2adtOw(flight, client) {
  const routes = [
    { o: 'MAA', d: 'BOM', days: 93 },
    { o: 'AMD', d: 'DEL', days: 94 },
    { o: 'HYD', d: 'BLR', days: 95 },
    { o: 'PNQ', d: 'GOI', days: 96 },
    { o: 'CCU', d: 'BOM', days: 97 },
    { o: 'DEL', d: 'HYD', days: 98 },
  ];
  for (const r of routes) {
    console.log(`BOOK 2ADT OW ${r.o}->${r.d}`);
    const body = buildOneWaySearchBody(r.days, {
      origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    const search = await flight.searchUntilComplete(body);
    const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
    if (!pricing.data?.priceId) {
      console.log('  pricing fail', brief(pricing.data, 200));
      continue;
    }
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [search.searchId],
      journeyType: 'ONE_WAY',
    });
    payload.data.passengers = paxTemplate();
    const fix = await issueAndWait(flight, client, payload);
    if (fix) return { ...fix, route: `${r.o}-${r.d}`, journeyType: 'ONE_WAY' };
  }
  return null;
}

async function book2adtRt(flight, client) {
  const attempts = [
    { o: 'BLR', d: 'HYD', od: 100, rd: 107 },
    { o: 'DEL', d: 'BOM', od: 101, rd: 108 },
    { o: 'MAA', d: 'AMD', od: 102, rd: 109 },
  ];
  for (const a of attempts) {
    console.log(`BOOK 2ADT RT ${a.o}<->${a.d}`);
    const body = buildRoundTripSearchBody(a.od, a.rd, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
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
    payload.data.passengers = paxTemplate();
    const fix = await issueAndWait(flight, client, payload);
    if (fix) return { ...fix, route: `${a.o}-${a.d}`, journeyType: 'ROUND_TRIP' };
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

  // Prefer RT for C04 "one pax all legs"; fall back to OW
  let fixture = await book2adtRt(flight, client);
  if (!fixture) {
    console.log('RT failed — trying OW');
    fixture = await book2adtOw(flight, client);
  }
  if (!fixture) throw new Error('No Confirmed 2ADT fixture on canary for C04');

  console.log('FIXTURE', fixture);

  const cancelApi = (body) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const cancelResults = [];
  for (const pnr of fixture.pnrs) {
    console.log('C04 CANCEL PAX2 on PNR', pnr);
    const r = await cancelApi({
      action: 'CANCEL',
      pnr,
      cancellationPaxList: ['PAX2'],
    });
    const row = {
      pnr,
      http: r.status,
      code: r.data?.error?.code || null,
      cancelStatus: r.data?.cancellationRequest?.status
        || r.data?.data?.cancellationRequest?.status
        || null,
      paxScope: r.data?.paxScope || r.data?.data?.paxScope || null,
      body: brief(r.data, 700),
    };
    cancelResults.push(row);
    console.log('  ->', row.http, row.cancelStatus || row.code, brief(row.paxScope, 200));
    await sleep(2000);
  }

  await sleep(4000);
  const after = await flight.getBookingDetail(fixture.br);
  const afterStatus = after.data?.status;
  const afterPax = (after.data?.bookingResponse?.passengers || []).map((p) => ({
    paxId: p.paxId,
    status: p.status,
    name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
  }));
  const afterLegs = extractLegs(after.data);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C04',
    checks: ['V071', 'V072', 'V073'],
    note: 'Paxwise cancellationPaxList on canary. Paste dbSql in phpMyAdmin (USE travelx if shared).',
    fixture,
    cancelResults,
    afterStatus,
    afterPax,
    afterLegs,
    dbSql: [
      'USE travelx;  -- or canary DB name if different',
      `SET @br := '${fixture.br}';`,
      '',
      '-- booking + passengers',
      `SELECT b.id, b.booking_reference, b.confirmed_at, b.cancelled_at
FROM booking b WHERE b.booking_reference = @br;`,
      `SELECT bp.id, bp.pax_id, bp.is_lead, bp.first_name, bp.last_name
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br
ORDER BY bp.pax_id;`,
      '',
      '-- V071: cancellation_request — expect PARTIAL / ONLINE, PAX2 scope',
      `SELECT cr.id, cr.scope, cr.channel, cr.status, cr.pnr, cr.created_at
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;`,
      '',
      '-- V072: cancellation_passenger — expect ONLY PAX2 (not PAX1)',
      `SELECT cp.id, cp.cancellation_request_id, cp.booking_passenger_id, bp.pax_id, bp.first_name
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cp.id;`,
      '',
      '-- V073: cells — PAX2 cancelled/marked; PAX1 still active (all legs)',
      `SELECT bp.pax_id, fj.id AS journey_id, fj.sequence, fj.direction, fj.airline_pnr,
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
  console.log('AFTER', afterStatus, afterPax);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
