/**
 * Quick OW 1ADT book on canary (leave Confirmed).
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-ow-1adt-canary-quick.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-ow-1adt-canary.json';

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);
  console.log('Base', config.baseUrl);

  const attempts = [
    { o: 'BOM', d: 'DEL', days: 55, airlines: ['SG'] },
    { o: 'DEL', d: 'BOM', days: 58, airlines: ['IX'] },
    { o: 'BLR', d: 'DEL', days: 60, airlines: ['IX'] },
    { o: 'HYD', d: 'BOM', days: 52, airlines: ['SG', '6E'] },
    { o: 'MAA', d: 'BOM', days: 65, airlines: [] },
  ];

  let booked = null;
  for (const a of attempts) {
    console.log(`Search ${a.o}->${a.d} +${a.days}d ${(a.airlines || []).join(',') || 'any'}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    if (a.airlines?.length) body.preferences.airlines = a.airlines;

    let sid = null;
    for (let i = 0; i < 12; i += 1) {
      const last = await flight.search(body);
      sid = extractFirstSearchId(last.data);
      if (sid) break;
      if (isSearchProgressComplete(last.data)) break;
      await sleep(last.data?.progress?.pollAfterMs || 3000);
    }
    if (!sid) {
      console.log('  no searchId');
      continue;
    }
    console.log('  searchId', sid);

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      console.log('  pricing fail', JSON.stringify(pricing.data)?.slice(0, 200));
      continue;
    }

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [sid],
      journeyType: 'ONE_WAY',
      passengerProfile: {
        title: 'Mr', firstName: 'Arjun', lastName: 'Nair', gender: 'Male', dob: '1994-07-18',
      },
    });

    const issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });

    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    console.log('  issue', issue.status, br || JSON.stringify(issue.data)?.slice(0, 200));
    if (!br) continue;

    let status = issue.data?.status;
    for (let i = 0; i < 14; i += 1) {
      const st = await flight.getBookingStatus(br);
      status = st.data?.status || status;
      console.log('  status', i + 1, status);
      if (isTerminalBookingStatus(status)) break;
      if (/inprogress/i.test(String(status)) && i >= 4) {
        console.log('  leave Inprogress, try next');
        break;
      }
      await sleep(3000);
    }
    if (!/confirm/i.test(String(status))) continue;

    const detail = await flight.getBookingDetail(br);
    const it = detail.data?.bookingResponse?.itinerary || [];
    const segs = it.flatMap((l) => l.segments || []);
    const pnr = it.find((x) => x.pnr)?.pnr || null;
    booked = {
      bookingReference: br,
      bookingStatus: detail.data?.status || status,
      pnr,
      route: `${a.o} → ${a.d}`,
      journeyType: 'ONE_WAY',
      adults: 1,
      passenger: 'Mr Arjun Nair',
      flights: segs.map((s) => ({
        flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
        route: `${s.departure?.airportCode || ''}→${s.arrival?.airportCode || ''}`,
        dep: s.departure?.time,
        arr: s.arrival?.time,
      })),
      salesSummary: detail.data?.bookingResponse?.salesSummary || null,
      priceId: pricing.data.priceId,
    };
    break;
  }

  fs.writeFileSync(OUT, JSON.stringify({
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    booked,
  }, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(booked || { error: 'no confirmed booking' }, null, 2));
  console.log('Report', OUT);
  if (!booked) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
