/**
 * B04 — Round trip, 1 adult — different pax / route / airline
 * BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-b04-rt-distinct.js
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

const OUT = 'reports/flight-db-pack-b04-rt-distinct.json';
const Q = { ...FLIGHT_QUERY };

const PAX = {
  title: 'Mr',
  firstName: 'Kabir',
  lastName: 'Mehta',
  gender: 'Male',
  dob: '1993-07-18',
};

// Different from prior DEL-BOM / BOM-HYD / Rohan fixtures
const ATTEMPTS = [
  { origin: 'MAA', destination: 'CCU', onwardDays: 68, returnDays: 75, airlines: ['6E'], label: 'MAA-CCU IndiGo' },
  { origin: 'AMD', destination: 'GOI', onwardDays: 71, returnDays: 78, airlines: ['SG'], label: 'AMD-GOI SpiceJet' },
  { origin: 'PNQ', destination: 'IXC', onwardDays: 73, returnDays: 80, airlines: ['AI'], label: 'PNQ-IXC AirIndia' },
  { origin: 'CCU', destination: 'HYD', onwardDays: 76, returnDays: 83, airlines: ['UK'], label: 'CCU-HYD Vistara' },
  { origin: 'GAU', destination: 'DEL', onwardDays: 69, returnDays: 76, airlines: ['6E'], label: 'GAU-DEL IndiGo' },
];

function brief(d, n = 350) {
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

function extractLegs(detailData) {
  const it = detailData?.bookingResponse?.itinerary || [];
  return it.map((leg) => {
    const seg = leg.segments?.[0] || {};
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

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'pax', `${PAX.firstName} ${PAX.lastName}`);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = { ranAt: new Date().toISOString(), passenger: PAX, attempts: [], fixture: null };

  for (const a of ATTEMPTS) {
    console.log(`\n=== ${a.label} ${a.origin}<->${a.destination} airlines=${a.airlines.join(',')} ===`);
    try {
      const body = buildRoundTripSearchBody(a.onwardDays, a.returnDays, {
        origin: a.origin,
        destination: a.destination,
        fareType: 'NORMAL',
        maxStops: 0,
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      body.preferences.airlines = a.airlines;

      const search = await flight.searchRoundTripUntilComplete(body);
      if (!search.searchIds || search.searchIds.length < 2) {
        throw new Error('no RT searchIds');
      }

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
      // ensure passenger profile applied
      payload.data.passengers[0].profile = {
        title: PAX.title,
        firstName: PAX.firstName,
        lastName: PAX.lastName,
        gender: PAX.gender,
        dob: PAX.dob,
        nationality: 'IN',
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
      const legs = extractLegs(detail.data);
      const pnrs = legs.map((l) => l.pnr).filter(Boolean);
      const row = {
        ...a,
        br,
        status: detailStatus,
        passenger: `${PAX.firstName} ${PAX.lastName}`,
        legs,
        pnrs,
        usable: pnrs.length > 0 && !/fail|cancel/i.test(String(detailStatus)),
      };
      report.attempts.push(row);
      console.log('  ->', br, detailStatus, 'pnrs', pnrs, 'airlines', legs.map((l) => l.airline || l.flightNumber));

      if (row.usable || /confirm/i.test(String(detailStatus))) {
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
