/**
 * Book ROUND_TRIP connecting, 2 adults.
 * If status/detail returns HTTP 500 → stop immediately (no poll loop).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-rt-connecting-2adt.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildIssueTicketPayload,
  buildPassengerProfile,
  buildRoundTripSearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-rt-connecting-2adt-canary.json');
const Q = { ...FLIGHT_QUERY };

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function isHttp500(res) {
  return Number(res?.status) === 500
    || String(res?.data?.status) === '500'
    || /internal server error/i.test(JSON.stringify(res?.data || {}));
}

function optionMeta(searchData, searchId) {
  for (const block of searchData?.results || []) {
    for (const opt of block?.options || []) {
      if (opt.searchId === searchId) {
        const stops = opt.totalStops ?? 0;
        const segCount = opt.segments?.length ?? 0;
        return {
          direction: block.direction,
          searchId,
          totalStops: stops,
          segmentCount: segCount,
          connecting: stops > 0 || segCount > 1,
          flights: (opt.segments || []).map((s) => ({
            flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
          })),
        };
      }
    }
  }
  return { searchId };
}

function build2AdtPayload({ bookingContext, priceId, searchIds, tag }) {
  // Rotate names each run (tag keeps uniqueness for airline duplicate checks)
  const pool = [
    [{ title: 'Mr', firstName: 'Nikhil', lastName: 'Bansal', gender: 'Male', dob: '1987-04-11' },
     { title: 'Mrs', firstName: 'Sneha', lastName: 'Bansal', gender: 'Female', dob: '1989-09-18' }],
    [{ title: 'Mr', firstName: 'Harsh', lastName: 'Malhotra', gender: 'Male', dob: '1985-11-03' },
     { title: 'Mr', firstName: 'Yash', lastName: 'Malhotra', gender: 'Male', dob: '1993-06-27' }],
    [{ title: 'Mr', firstName: 'Aditya', lastName: 'Kulkarni', gender: 'Male', dob: '1991-01-22' },
     { title: 'Ms', firstName: 'Isha', lastName: 'Kulkarni', gender: 'Female', dob: '1994-12-08' }],
    [{ title: 'Mr', firstName: 'Manish', lastName: 'Aggarwal', gender: 'Male', dob: '1986-07-14' },
     { title: 'Mrs', firstName: 'Pooja', lastName: 'Aggarwal', gender: 'Female', dob: '1988-02-25' }],
  ];
  const pick = pool[Number(tag) % pool.length];
  const p1 = buildPassengerProfile({ ...pick[0], lastName: `${pick[0].lastName}${tag}` });
  const p2 = buildPassengerProfile({ ...pick[1], lastName: `${pick[1].lastName}${tag}` });
  console.log('  passengers', p1.firstName, p1.lastName, '+', p2.firstName, p2.lastName);

  const payload = buildIssueTicketPayload({
    bookingContext,
    priceId,
    searchIds,
    journeyType: 'ROUND_TRIP',
    passengerProfile: p1,
  });

  payload.data.passengers = [
    {
      paxId: 'PAX1',
      type: 'adult',
      isLead: true,
      profile: {
        title: p1.title, firstName: p1.firstName, lastName: p1.lastName,
        gender: p1.gender, dob: p1.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX2',
      type: 'adult',
      isLead: false,
      profile: {
        title: p2.title, firstName: p2.firstName, lastName: p2.lastName,
        gender: p2.gender, dob: p2.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];
  return payload;
}

/** One status + one detail. Stop immediately on HTTP 500. */
async function checkOnce(flight, br) {
  const statusRes = await flight.getBookingStatus(br);
  if (isHttp500(statusRes)) {
    return {
      aborted: true,
      reason: 'STATUS_API_500',
      statusHttp: statusRes.status,
      statusBody: statusRes.data,
    };
  }

  const detailRes = await flight.getBookingDetail(br);
  if (isHttp500(detailRes)) {
    return {
      aborted: true,
      reason: 'DETAIL_API_500',
      statusHttp: statusRes.status,
      status: statusRes.data?.status,
      detailHttp: detailRes.status,
      detailBody: detailRes.data,
    };
  }

  const legs = (detailRes.data?.bookingResponse?.itinerary || []).map((leg) => ({
    direction: leg.direction,
    pnr: leg.pnr,
    stops: leg.totalStops,
    segments: (leg.segments || []).length,
  }));

  return {
    aborted: false,
    statusHttp: statusRes.status,
    status: statusRes.data?.status,
    detailHttp: detailRes.status,
    detailStatus: detailRes.data?.status,
    legs,
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base:', config.baseUrl);
  console.log('Goal: RT connecting | 2 ADT | no poll loop on HTTP 500');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  // Prefer routes that often have connecting inventory
  const routes = [
    { o: 'BOM', d: 'CCU' },
    { o: 'DEL', d: 'IXC' },
    { o: 'BLR', d: 'PAT' },
    { o: 'DEL', d: 'GOI' },
  ];
  const windows = [[22, 29], [26, 33]];

  let booked = null;
  const attempts = [];

  outer:
  for (const route of routes) {
    for (const [od, rd] of windows) {
      console.log(`\n=== ${route.o}-${route.d} RT d+${od}/${rd} 2ADT ===`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: route.o,
        destination: route.d,
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('search fail', e.message);
        attempts.push({ route, od, rd, error: e.message });
        continue;
      }

      const data = searchRes.response?.data;
      const onwardConn = analyzeFlightOptions(data, 'ONWARD').connecting || [];
      const returnConn = analyzeFlightOptions(data, 'RETURN').connecting || [];
      console.log('connecting onward', onwardConn.length, 'return', returnConn.length);

      const onwardId = onwardConn[0]?.searchId;
      const returnId = returnConn[0]?.searchId;
      if (!onwardId || !returnId) {
        console.log('need both legs connecting — skip');
        attempts.push({ route, od, rd, skip: 'no both-connecting' });
        continue;
      }

      const metaO = optionMeta(data, onwardId);
      const metaR = optionMeta(data, returnId);
      console.log('onward CONN', metaO.flights);
      console.log('return CONN', metaR.flights);

      const pricing = await flight.getPricing([onwardId, returnId], 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        console.log('pricing fail', brief(pricing.data));
        attempts.push({ route, od, rd, stage: 'pricing', err: brief(pricing.data) });
        continue;
      }
      console.log('price', pricing.data?.pricing?.totalAmount, 'addGst', pricing.data?.addGstInfo);

      const tag = String(Date.now()).slice(-4);
      const payload = build2AdtPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [onwardId, returnId],
        tag,
      });
      if (pricing.data?.addGstInfo === true) {
        payload.data.includeGst = true;
        payload.data.addGstInfo = true;
        payload.data.gstDetails = { ...VALID_GST };
      }

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
        console.log('issue fail', brief(issue.data));
        attempts.push({ route, od, rd, stage: 'issue', err: brief(issue.data) });
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') break outer;
        continue;
      }
      console.log('issued', br, issue.data?.status || issue.status);

      // Single check — NO loop if 500
      const check = await checkOnce(flight, br);
      if (check.aborted) {
        console.log('ABORT —', check.reason, 'http', check.statusHttp || check.detailHttp);
        booked = {
          br,
          route: `${route.o}-${route.d}`,
          days: { od, rd },
          adults: 2,
          total: pricing.data?.pricing?.totalAmount,
          onward: metaO,
          return: metaR,
          issueStatus: issue.data?.status,
          poll: check,
          note: 'Status/detail HTTP 500 — stopped immediately, no retry loop',
        };
        break outer;
      }

      console.log('status', check.status, 'detail', check.detailStatus, check.legs);

      // Optional short poll ONLY if not 500 and not terminal yet (max 3, still abort on 500)
      let final = check;
      if (!isTerminalBookingStatus(check.status) && !isTerminalBookingStatus(check.detailStatus)) {
        for (let i = 0; i < 3; i += 1) {
          await sleep(3000);
          final = await checkOnce(flight, br);
          if (final.aborted) {
            console.log('ABORT mid-poll —', final.reason);
            booked = {
              br,
              route: `${route.o}-${route.d}`,
              days: { od, rd },
              adults: 2,
              total: pricing.data?.pricing?.totalAmount,
              onward: metaO,
              return: metaR,
              issueStatus: issue.data?.status,
              poll: final,
              note: 'Status/detail HTTP 500 mid-poll — stopped',
            };
            break outer;
          }
          console.log('poll', i + 1, final.status || final.detailStatus);
          if (isTerminalBookingStatus(final.status) || isTerminalBookingStatus(final.detailStatus)) break;
        }
      }

      booked = {
        br,
        route: `${route.o}-${route.d}`,
        days: { od, rd },
        adults: 2,
        total: pricing.data?.pricing?.totalAmount,
        onward: metaO,
        return: metaR,
        status: final.detailStatus || final.status,
        legs: final.legs,
        poll: final,
      };
      break outer;
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    booked,
    attempts,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (!booked) {
    console.error('No booking created');
    process.exit(1);
  }

  console.log('\nRESULT', booked.br, booked.status || booked.poll?.reason);
  console.log('Report', OUT);
  if (booked.poll?.aborted) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
