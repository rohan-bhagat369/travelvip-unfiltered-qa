/**
 * Book DEL <-> DXB (RT 1ADT) restricted to IX / AI / 6E / SG
 * BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-del-dxb-rt.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-del-dxb-rt.json';
const Q = { ...FLIGHT_QUERY };
const AIRLINES = ['IX', 'AI', '6E', 'SG'];

const PAX = {
  title: 'Mr',
  firstName: 'Kabir',
  lastName: 'Mehta',
  gender: 'Male',
  dob: '1993-07-18',
  nationality: 'IN',
};

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 14; i += 1) {
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

function legsFromDetail(detailData) {
  const it = detailData?.bookingResponse?.itinerary || [];
  return it.map((leg) => {
    const seg = (leg.segments || [])[0] || {};
    return {
      direction: leg.direction,
      pnr: leg.pnr,
      origin: seg.departure?.airportCode || seg.origin,
      destination: seg.arrival?.airportCode || seg.destination,
      airline: seg.airlineCode || seg.marketingAirline || seg.operatingAirline || seg.carrierCode,
      flightNumber: seg.flightNumber,
    };
  });
}

async function tryBook(flight, client, { onwardDays, returnDays, airlines }) {
  console.log(`\nTRY DEL<->DXB +${onwardDays}/${returnDays} airlines=${airlines.join(',')}`);
  const body = buildRoundTripSearchBody(onwardDays, returnDays, {
    origin: 'DEL',
    destination: 'DXB',
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  body.preferences.airlines = airlines;

  const search = await flight.searchRoundTripUntilComplete(body);
  if (!search.searchIds || search.searchIds.length < 2) {
    throw new Error('no RT searchIds (no inventory for filter?)');
  }
  console.log('  searchIds', search.searchIds.length);

  const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    throw new Error(`pricing: ${brief(pricing.data)}`);
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: search.searchIds,
    journeyType: 'ROUND_TRIP',
    passengerProfile: PAX,
  });
  payload.data.passportType = 'FULL';
  payload.data.passengers[0].profile = {
    title: PAX.title,
    firstName: PAX.firstName,
    lastName: PAX.lastName,
    gender: PAX.gender,
    dob: PAX.dob,
    nationality: PAX.nationality,
  };
  payload.data.passengers[0].passport = {
    number: 'M1234567',
    expiry: '2030-12-31',
    issuedDate: '2020-01-15',
    issuedCountryCode: 'IN',
  };

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
  const legs = legsFromDetail(detail.data);
  const pnrs = legs.map((l) => l.pnr).filter(Boolean);
  return {
    br,
    status: detailStatus,
    passenger: `${PAX.firstName} ${PAX.lastName}`,
    route: 'DEL-DXB-DEL',
    airlinesFilter: airlines,
    legs,
    pnrs,
    usable: pnrs.length > 0 && !/fail|cancel/i.test(String(detailStatus)),
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'partner', config.partnerId);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = { ranAt: new Date().toISOString(), attempts: [], fixture: null };

  const datePairs = [
    [55, 62],
    [60, 67],
    [65, 72],
  ];

  // Prefer combined filter first, then single-airline fallbacks
  const airlineSets = [AIRLINES, ['6E'], ['AI'], ['IX'], ['SG']];

  outer: for (const airlines of airlineSets) {
    for (const [onwardDays, returnDays] of datePairs) {
      try {
        const row = await tryBook(flight, client, { onwardDays, returnDays, airlines });
        report.attempts.push(row);
        console.log('  ->', row.br, row.status, row.pnrs, row.legs.map((l) => l.airline || l.flightNumber));
        if (row.usable || /confirm/i.test(String(row.status))) {
          report.fixture = row;
          break outer;
        }
      } catch (e) {
        console.log('  FAIL', e.message);
        report.attempts.push({ airlines, onwardDays, returnDays, error: e.message });
      }
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nFIXTURE', JSON.stringify(report.fixture, null, 2));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
