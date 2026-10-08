/**
 * R01 — RT return cancel → reschedule new return leg (V085–V088).
 * Dates d+20..25 (cancellable window).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-r01-v085-v088-canary.js
 *   BR=BR1786532280192377 PNR=F9JCUZ  # optional: reuse existing partial cancel
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
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-r01-v085-v088-canary.json';
const Q = { ...FLIGHT_QUERY };
const REUSE_BR = process.env.BR || '';
const REUSE_PNR = process.env.PNR || '';

function brief(d, n = 500) {
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

function legsFrom(detail) {
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

async function waitStatus(flight, br, max = 12) {
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', br, i + 1, s);
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

async function bookRt(flight, client, tag) {
  const attempts = [
    { o: 'DEL', d: 'BOM', od: 20, rd: 25, airlines: ['SG'] },
    { o: 'BOM', d: 'DEL', od: 21, rd: 25, airlines: ['SG'] },
    { o: 'BLR', d: 'HYD', od: 22, rd: 25, airlines: [] },
    { o: 'MAA', d: 'BOM', od: 20, rd: 24, airlines: [] },
  ];
  for (const a of attempts) {
    console.log(`BOOK RT ${a.o}<->${a.d} +${a.od}/${a.rd}`);
    const body = buildRoundTripSearchBody(a.od, a.rd, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    if (a.airlines?.length) body.preferences.airlines = a.airlines;

    const search = await flight.searchRoundTripUntilComplete(body);
    if (!search.searchIds || search.searchIds.length < 2) continue;

    const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
    if (!pricing.data?.priceId) continue;

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: search.searchIds,
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
      console.log('  issue fail', brief(issue.data, 200));
      continue;
    }
    const status = await waitStatus(flight, br);
    const detail = await flight.getBookingDetail(br);
    const legs = legsFrom(detail.data);
    const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
    console.log('  ->', br, detail.data?.status || status, legs);
    if (!/confirm/i.test(String(detail.data?.status || status))) continue;
    if (pnrs.length < 2) continue;
    const onward = legs.find((l) => /onward/i.test(l.direction)) || legs[0];
    const ret = legs.find((l) => /return/i.test(l.direction)) || legs[1];
    return {
      br,
      route: `${a.o}-${a.d}`,
      legs,
      onwardPnr: onward.pnr,
      returnPnr: ret.pnr,
      origin: a.o,
      destination: a.d,
    };
  }
  return null;
}

async function rescheduleReturn(client, flight, oldBr, returnPnr, origin, destination, tag) {
  // New return = fly destination → origin on d+23..25
  const dayOpts = [23, 24, 25, 22, 21];
  for (const days of dayOpts) {
    console.log(`Reschedule search ${destination}->${origin} d+${days}`);
    const body = buildOneWaySearchBody(days, {
      origin: destination, destination: origin, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences = { ...(body.preferences || {}), airlines: ['SG'] };

    let sid = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      sid = extractFirstSearchId(s.data);
      if (sid) break;
      if (isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (!sid) continue;

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId) continue;

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [sid],
      journeyType: 'ONE_WAY',
      passengerProfile: {
        title: 'Mr', firstName: 'Tarun', lastName: `Mehra ${tag}`, gender: 'Male', dob: '1986-05-17',
      },
    });
    payload.reschedulingReferenceId = oldBr;
    payload.reschedulingPnr = returnPnr;

    const iss = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });

    const code = iss.data?.error?.code || null;
    const newBr = iss.data?.bookingReference || iss.data?.bookingReferenceId || null;
    console.log('  issue', iss.status, code || newBr, brief(iss.data, 280));
    if (code || !newBr) {
      return { http: iss.status, code, br: null, body: brief(iss.data, 600), days };
    }

    const newStatus = await waitStatus(flight, newBr);
    const detail = await flight.getBookingDetail(newBr);
    const newPnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
    return {
      http: iss.status,
      code: null,
      br: newBr,
      status: newStatus || detail.data?.status,
      pnr: newPnr,
      days,
      body: brief(iss.data, 400),
    };
  }
  return { error: 'no inventory for reschedule' };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('R01 V085–V088 on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);
  const tag = letterTag();

  let fixture;
  let cancelResult = null;

  if (REUSE_BR && REUSE_PNR) {
    console.log('Reuse', REUSE_BR, REUSE_PNR);
    const detail = await flight.getBookingDetail(REUSE_BR);
    const legs = legsFrom(detail.data);
    const onward = legs.find((l) => /onward/i.test(l.direction)) || legs[0];
    const ret = legs.find((l) => /return/i.test(l.direction)) || legs[1];
    const route = `${onward?.origin || 'DEL'}-${onward?.destination || 'BOM'}`;
    // Infer route from itinerary if present
    const it = detail.data?.bookingResponse?.itinerary || [];
    const oSeg = (it.find((x) => /onward/i.test(x.direction))?.segments || [])[0];
    const origin = oSeg?.departure?.airportCode || 'DEL';
    const destination = oSeg?.arrival?.airportCode || 'BOM';
    fixture = {
      br: REUSE_BR,
      returnPnr: REUSE_PNR,
      onwardPnr: onward?.pnr,
      legs,
      origin,
      destination,
      route: `${origin}-${destination}`,
      reused: true,
      status: detail.data?.status,
    };
    console.log('Reused fixture', fixture);
  } else {
    fixture = await bookRt(flight, client, tag);
    if (!fixture) throw new Error('No Confirmed RT 2-PNR for R01');

    console.log('\nCancel RETURN only', fixture.returnPnr);
    const pen = await cancelCall(client, fixture.br, { action: 'PENALTY', pnr: fixture.returnPnr });
    console.log('PENALTY', cancelStatus(pen));
    await sleep(2000);
    const can = await cancelCall(client, fixture.br, { action: 'CANCEL', pnr: fixture.returnPnr });
    cancelResult = {
      http: can.status,
      status: cancelStatus(can),
      body: brief(can.data, 500),
    };
    console.log('CANCEL', cancelResult.status);
    await sleep(4000);
    const mid = await flight.getBookingStatus(fixture.br);
    fixture.statusAfterCancel = mid.data?.status;
    console.log('After cancel', fixture.statusAfterCancel);

    if (!/cancel/i.test(String(cancelResult.status)) || /fail/i.test(String(cancelResult.status))) {
      throw new Error(`Return cancel failed: ${cancelResult.status}`);
    }
  }

  console.log('\nReschedule return leg…');
  const reschedule = await rescheduleReturn(
    client, flight, fixture.br, fixture.returnPnr, fixture.origin, fixture.destination, tag,
  );

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'R01',
    checks: ['V085', 'V086', 'V087', 'V088'],
    fixture,
    cancelResult,
    reschedule,
    dbSql: [
      'USE travelx;',
      `SET @old := '${fixture.br}';`,
      `SET @new := '${reschedule.br || ''}';`,
      '',
      '-- Old booking journeys + cancel',
      `SELECT fj.id, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id,
       fj.current_status_mapping_id, bsm.status_code, bsm.backend_status
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fj.current_status_mapping_id
WHERE b.booking_reference = @old
ORDER BY fj.sequence;`,
      '',
      `SELECT cr.id, cr.pnr, cr.flight_journey_id, cr.cancellation_type, cr.mode, cr.status,
       cr.cancellation_reason
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @old
ORDER BY cr.id DESC;`,
      '',
      '-- New booking journeys (expect rescheduled_from_journey_id = old return id)',
      `SELECT fj.id, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @new
ORDER BY fj.sequence;`,
      '',
      '-- Cells old vs new',
      `SELECT b.booking_reference, fj.direction, fj.airline_pnr, fjp.id AS cell_id, fjp.eticket_number
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN (@old, @new)
ORDER BY b.booking_reference, fj.sequence, fjp.id;`,
    ].join('\n'),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nOLD', fixture.br, 'NEW', reschedule.br, reschedule.code || reschedule.status);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
