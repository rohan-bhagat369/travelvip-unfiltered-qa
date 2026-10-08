/**
 * B05 — Round trip, 6 adults
 * BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-b05-rt-6adt.js
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

const OUT = 'reports/flight-db-pack-b05-rt-6adt.json';
const Q = { ...FLIGHT_QUERY };

const PAX_BASE = [
  ['Kabir', 'Mehta', 'Mr', 'Male', '1993-07-18'],
  ['Ananya', 'Iyer', 'Ms', 'Female', '1996-03-21'],
  ['Rohit', 'Das', 'Mr', 'Male', '1991-11-09'],
  ['Sneha', 'Kulkarni', 'Mrs', 'Female', '1994-08-02'],
  ['Imran', 'Sheikh', 'Mr', 'Male', '1989-01-30'],
  ['Pooja', 'Nair', 'Ms', 'Female', '1997-05-12'],
];

function adults6() {
  return PAX_BASE.map(([firstName, lastName, title, gender, dob], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { title, firstName, lastName, gender, dob, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
}

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 16; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 2) {
      console.log('  leave Inprogress');
      return st;
    }
    await sleep(3000);
  }
  return last?.data?.status;
}

function extractLegs(detailData) {
  const it = detailData?.bookingResponse?.itinerary || [];
  return it.map((leg) => {
    const seg = (leg.segments || [])[0] || {};
    return {
      direction: leg.direction,
      pnr: leg.pnr,
      origin: seg.departure?.airportCode || seg.origin,
      destination: seg.arrival?.airportCode || seg.destination,
      airline: seg.airlineCode || seg.marketingAirline || seg.carrierCode,
      flightNumber: seg.flightNumber,
    };
  });
}

async function tryBook(flight, client, attempt) {
  console.log(`\n=== B05 ${attempt.label} ${attempt.origin}<->${attempt.destination} +${attempt.onwardDays}/${attempt.returnDays} ===`);
  const body = buildRoundTripSearchBody(attempt.onwardDays, attempt.returnDays, {
    origin: attempt.origin,
    destination: attempt.destination,
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.travellers = { adults: 6, children: 0, infants: 0 };
  if (attempt.airlines?.length) body.preferences.airlines = attempt.airlines;

  const search = await flight.searchRoundTripUntilComplete(body);
  if (!search.searchIds || search.searchIds.length < 2) throw new Error('no RT searchIds');

  const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    throw new Error(`pricing: ${brief(pricing.data)}`);
  }
  console.log('  priceId', pricing.data.priceId, 'total?', pricing.data?.totalAmount || pricing.data?.pricing?.totalAmount);

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: search.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = adults6();

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) throw new Error(`issue: ${brief(issue.data)}`);

  const status = await waitStatus(flight, br);
  const detail = await flight.getBookingDetail(br);
  const detailStatus = detail.data?.status || status;
  const legs = extractLegs(detail.data);
  const pnrs = [...new Set(legs.map((l) => l.pnr).filter(Boolean))];
  const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => ({
    paxId: p.paxId,
    name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
  }));

  return {
    scenarioId: 'B05',
    ...attempt,
    br,
    status: detailStatus,
    adults: 6,
    passengerNames: PAX_BASE.map((p) => `${p[0]} ${p[1]}`),
    legs,
    pnrs,
    paxCount: pax.length || 6,
    usable: pnrs.length > 0 && !/fail|cancel/i.test(String(detailStatus)),
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'B05 RT 6ADT');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const attempts = [
    { label: 'DEL-BOM', origin: 'DEL', destination: 'BOM', onwardDays: 20, returnDays: 25, airlines: [] },
    { label: 'BLR-HYD', origin: 'BLR', destination: 'HYD', onwardDays: 21, returnDays: 25, airlines: [] },
    { label: 'BOM-MAA', origin: 'BOM', destination: 'MAA', onwardDays: 22, returnDays: 25, airlines: ['6E'] },
  ];

  const report = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl, attempts: [], fixture: null };

  for (const a of attempts) {
    try {
      const row = await tryBook(flight, client, a);
      report.attempts.push(row);
      console.log('  ->', row.br, row.status, 'pnrs', row.pnrs, 'legs', row.legs.map((l) => `${l.airline} ${l.flightNumber}`));
      if (row.usable || /confirm/i.test(String(row.status))) {
        report.fixture = row;
        break;
      }
    } catch (e) {
      console.log('  FAIL', e.message);
      report.attempts.push({ ...a, error: e.message });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nFIXTURE', JSON.stringify(report.fixture, null, 2));
  console.log('Report', OUT);
  if (report.fixture?.br) {
    console.log('\nSQL: SET @br := \'' + report.fixture.br + '\';');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
