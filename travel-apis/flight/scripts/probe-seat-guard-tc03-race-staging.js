/**
 * TC-03 race on api-staging: two carts, same flight, same Open seat.
 * Both go search → price → seatmap. Book A first, then B with the same seat.
 * Flag ON (vgm): B should drop the seat, re-price, Confirmed without seat.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/probe-seat-guard-tc03-race-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  canSelectSeats,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions, pickFareSearchId } from '../src/searchPicker.js';
import { uniqueTag } from '../src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'seat-guard-tc03-parallel-staging.json');
const Q = { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 };
const ROUTE = { o: 'DEL', d: 'BOM', days: [42, 45, 48, 51], airlines: ['IX', '6E'] };

function classify(status) {
  const s = String(status || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

function isSettled(status) {
  return ['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classify(status));
}

function hasMandatorySsr(pricing) {
  return (pricing?.itinerary || []).some((leg) => {
    const m = leg.mandatorySsr;
    return Boolean(m?.meal || m?.seat || m?.baggage) || (Array.isArray(m?.types) && m.types.length > 0);
  });
}

function buildPax(tag) {
  return [{
    paxId: 'PAX1',
    type: 'adult',
    isLead: true,
    profile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: `Bhagat${tag}`,
      gender: 'Male',
      dob: '2001-05-29',
      nationality: 'IN',
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }];
}

function seatMapSegments(sm) {
  const data = sm?.data?.data || sm?.data || {};
  return data.segments || data.FlightSeat?.segments || [];
}

function openSeats(sm) {
  const out = [];
  for (const seg of seatMapSegments(sm)) {
    for (const s of seg.seatMap || seg.seats || []) {
      const avail = String(s.seatAvailability || s.availability || '');
      if (!/open/i.test(avail)) continue;
      const seatName = s.seatName || s.seatNumber;
      const seatId = s.seatId || s.seatKey;
      const pref = s.priceReference || s.priceDetail?.priceReference;
      if (!seatName || !seatId || !pref) continue;
      out.push({
        origin: s.origin || seg.origin,
        destination: s.destination || seg.destination,
        segmentId: s.segmentId || seg.segmentId || 'SEG_1',
        seatAvailability: 'Open',
        seatName,
        seatPosition: s.seatPosition || '',
        seatKey: String(s.seatKey || seatId),
        seatId: String(seatId),
        direction: 'ONWARD',
        priceReference: pref,
        amount: Number(s.amount || s.price || 0),
      });
    }
  }
  return out;
}

function seatOnDetail(detail) {
  const pax = detail?.data?.bookingResponse?.passengers || [];
  const seats = pax.flatMap((p) => p.ssr?.seats || p.ssr?.seat || []);
  return {
    count: seats.length,
    names: seats.map((s) => s.seatName || s.seatNumber).filter(Boolean),
    seatPrice: detail?.data?.bookingResponse?.salesSummary?.seatPrice ?? null,
    pnr: detail?.data?.bookingResponse?.itinerary?.[0]?.pnr || null,
  };
}

async function searchUntil(flight, body) {
  let last = null;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.search(body);
    if (last?.ok && (isSearchProgressComplete(last.data) || extractFirstSearchId(last.data))) {
      if (isSearchProgressComplete(last.data) || i >= 3) break;
    }
    await sleep(last?.data?.progress?.pollAfterMs || 2000);
  }
  return last;
}

function flightLabel(opt) {
  return (opt?.segments || []).map((s) => `${s.airline?.code || s.airlineCode} ${s.flightNumber}`).join(' / ');
}

function fareSearchIds(opt) {
  const fromFares = (opt?.fares || []).map((f) => f.searchId).filter(Boolean);
  if (fromFares.length) return [...new Set(fromFares)];
  return opt?.searchId ? [opt.searchId] : [];
}

async function priceAndMap(flight, searchId, opt) {
  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!pricing.ok || !pricing.data?.priceId) return { error: 'pricing failed' };
  if (hasMandatorySsr(pricing.data)) return { error: 'mandatorySsr' };
  if (!canSelectSeats(pricing.data)) return { error: 'no seats support' };
  const tag = uniqueTag();
  const passengers = buildPax(tag);
  const smPax = passengers.map((p, i) => ({
    paxRefNumber: String(i + 1),
    passengerType: 1,
    gender: p.profile.gender,
    title: p.profile.title,
    firstName: p.profile.firstName,
    lastName: p.profile.lastName,
  }));
  const sm = await flight.getSeatMap(pricing.data.bookingContext, smPax);
  return {
    searchId,
    priceId: pricing.data.priceId,
    pricing: pricing.data,
    passengers,
    seatmap: sm,
    opens: openSeats(sm),
    flight: flightLabel(opt),
  };
}

async function twoIndependentCarts(flight, { origin, destination, day, airline }) {
  const body = buildOneWaySearchBody(day, { origin, destination, fareType: 'NORMAL', maxStops: 0 });
  body.preferences = { airlines: [airline], maxStops: 0, refundableOnly: false };
  const searchA = await searchUntil(flight, body);
  const onward = collectOptions(searchA?.data, 'ONWARD');
  const optA = onward.find((o) => (o.totalStops ?? 0) === 0 && (o.segments?.length ?? 1) <= 1) || onward[0];
  const idsA = fareSearchIds(optA);
  if (!idsA[0]) return { error: 'no searchId A' };
  const a = await priceAndMap(flight, idsA[0], optA);
  if (a.error || !a.opens.length) return { error: a.error || 'no open seats A' };

  // Second quote MUST be a different searchId (other fare on same flight, else a new search).
  let searchIdB = idsA.find((id) => id !== a.searchId) || null;
  let optB = optA;
  if (!searchIdB) {
    const bodyB = buildOneWaySearchBody(day, { origin, destination, fareType: 'NORMAL', maxStops: 0 });
    bodyB.preferences = { airlines: [airline], maxStops: null, refundableOnly: true };
    const searchB = await searchUntil(flight, bodyB);
    optB = collectOptions(searchB?.data, 'ONWARD').find((o) => flightLabel(o) === a.flight)
      || collectOptions(searchB?.data, 'ONWARD')[0];
    searchIdB = fareSearchIds(optB).find((id) => id !== a.searchId) || null;
  }
  if (!searchIdB) return { error: 'could not get a second searchId (search cache returned the same quote)' };

  const b = await priceAndMap(flight, searchIdB, optB);
  if (b.error || !b.opens.length) return { error: b.error || 'no open seats B' };
  if (b.searchId === a.searchId) return { error: `B searchId still ${a.searchId}` };
  if (b.priceId === a.priceId) return { error: `B priceId still ${a.priceId}` };
  if (b.flight !== a.flight) return { error: `different flights ${a.flight} vs ${b.flight}` };

  const namesB = new Set(b.opens.map((s) => s.seatName));
  const shared = a.opens.find((s) => namesB.has(s.seatName));
  if (!shared) return { error: 'no shared Open seatName' };
  a.pick = shared;
  b.pick = b.opens.find((s) => s.seatName === shared.seatName);
  a.day = day;
  a.airline = airline;
  b.day = day;
  b.airline = airline;
  return { a, b };
}

async function issueTicket(client, pricing, searchId, passengers) {
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.bookingContext,
    priceId: pricing.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: passengers[0]?.profile,
  });
  payload.data.passengers = passengers;
  payload.data.passportType = pricing.passportType || 'NONE';
  if (pricing.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.gstDetails = {
      gstNumber: '27AABCT1429B1Z1',
      gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
      gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
      gstEmailID: 'accounts@travelvip.ai',
      gstMobileNumber: '9921862715',
    };
  }
  const res = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = res.data?.bookingReference || res.data?.bookingReferenceId || res.data?.bookingRefId || null;
  return { res, br };
}

async function pollSettled(flight, br) {
  let last = { status: '', polls: 0, raw: null };
  for (let i = 0; i < 24; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = { status: String(st.data?.status || ''), polls: i + 1, raw: st.data };
    console.log('  poll', br, i + 1, last.status);
    if (isSettled(last.status)) return last;
    await sleep(3000);
  }
  return last;
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;

  console.log('=== TC-03 race: same Open seat, BOTH issue-ticket at once ===');
  console.log('Base', config.baseUrl);

  let a = null;
  let b = null;
  for (const day of ROUTE.days) {
    for (const airline of ROUTE.airlines) {
      console.log(`pair carts ${ROUTE.o}-${ROUTE.d} d+${day} ${airline}`);
      const pair = await twoIndependentCarts(flight, { origin: ROUTE.o, destination: ROUTE.d, day, airline });
      if (pair.error) {
        console.log('  skip', pair.error);
        continue;
      }
      a = pair.a;
      b = pair.b;
      break;
    }
    if (a && b) break;
  }

  if (!a || !b) {
    const report = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl, error: 'could not pair two carts on same flight+Open seat' };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log('paired', a.flight, 'seat', a.pick.seatName);
  console.log('A searchId', a.searchId, 'priceId', a.priceId);
  console.log('B searchId', b.searchId, 'priceId', b.priceId);
  if (a.searchId === b.searchId || a.priceId === b.priceId) {
    console.error('REFUSING to issue — searchId/priceId still shared');
    process.exit(1);
  }

  a.passengers[0].ssr.seats = [a.pick];
  b.passengers[0].ssr.seats = [b.pick];

  console.log('HIT BOTH issue-ticket at the same time');
  const t0 = Date.now();
  const [issueA, issueB] = await Promise.all([
    issueTicket(client, a.pricing, a.searchId, a.passengers),
    issueTicket(client, b.pricing, b.searchId, b.passengers),
  ]);
  console.log('A issue', issueA.res.status, issueA.br, 'at', Date.now() - t0, 'ms');
  console.log('B issue', issueB.res.status, issueB.br, issueB.res.data?.error || '', 'at', Date.now() - t0, 'ms');

  async function settle(label, issue) {
    if (!issue.br) {
      return {
        br: null,
        issueHttp: issue.res.status,
        issueError: issue.res.data?.error || null,
        status: null,
        count: 0,
        names: [],
        seatPrice: null,
        pnr: null,
      };
    }
    const polled = await pollSettled(flight, issue.br);
    const detail = await flight.getBookingDetail(issue.br);
    const seats = seatOnDetail(detail);
    console.log(label, 'settled', polled.status, seats);
    return {
      br: issue.br,
      issueHttp: issue.res.status,
      issueError: issue.res.data?.error || null,
      status: polled.status,
      ...seats,
    };
  }

  const [outA, outB] = await Promise.all([settle('A', issueA), settle('B', issueB)]);
  const clsA = classify(outA.status);
  const clsB = classify(outB.status);
  const aHasSeat = clsA === 'Confirmed' && outA.count >= 1;
  const bHasSeat = clsB === 'Confirmed' && outB.count >= 1;
  const aNoSeat = clsA === 'Confirmed' && outA.count === 0;
  const bNoSeat = clsB === 'Confirmed' && outB.count === 0;
  const oneKeptOneDropped = (aHasSeat && bNoSeat) || (bHasSeat && aNoSeat);
  const bothSeated = aHasSeat && bHasSeat;
  const oneFailed = clsA === 'Failed' || clsB === 'Failed' || !issueA.br || !issueB.br;
  const walletBlock = [outA, outB].some((x) => x.issueError?.code === 'INSUFFICIENT_BALANCE');

  let status = 'NOT TESTED';
  if (oneKeptOneDropped) status = 'PASS';
  else if (walletBlock || clsA === 'Inprogress' || clsB === 'Inprogress') status = 'NOT TESTED';
  else if (bothSeated || oneFailed) status = 'BUG';

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    mode: 'parallel-issue',
    tc: 'TC-03 race parallel',
    rule: 'Same Open seat; both issue-ticket at once; one keeps seat, other Confirmed without seat (flag ON)',
    flight: a.flight,
    seatName: a.pick.seatName,
    status,
    a: { priceId: a.priceId, searchId: a.searchId, seatId: a.pick.seatId, ...outA },
    b: { priceId: b.priceId, searchId: b.searchId, seatId: b.pick.seatId, ...outB },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== TC-03 race ===', status);
  console.log(JSON.stringify({ a: report.a, b: report.b }, null, 2));
  if (status === 'BUG') process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
