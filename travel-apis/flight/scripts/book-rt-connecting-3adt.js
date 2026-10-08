/**
 * Book ROUND_TRIP connecting (both legs prefer 1+ stop), 3 adults.
 * If status/detail returns HTTP 500 → skip that BR and try next option/route.
 * Does NOT cancel after booking.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-rt-connecting-3adt.js
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

const OUT = path.join('reports', 'book-rt-connecting-3adt-canary.json');
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

function build3AdtPayload({ bookingContext, priceId, searchIds, tag }) {
  const pool = [
    [
      { title: 'Mr', firstName: 'Nikhil', lastName: 'Bansal', gender: 'Male', dob: '1987-04-11' },
      { title: 'Mrs', firstName: 'Sneha', lastName: 'Bansal', gender: 'Female', dob: '1989-09-18' },
      { title: 'Mr', firstName: 'Kabir', lastName: 'Bansal', gender: 'Male', dob: '1995-03-07' },
    ],
    [
      { title: 'Mr', firstName: 'Harsh', lastName: 'Malhotra', gender: 'Male', dob: '1985-11-03' },
      { title: 'Mr', firstName: 'Yash', lastName: 'Malhotra', gender: 'Male', dob: '1993-06-27' },
      { title: 'Ms', firstName: 'Riya', lastName: 'Malhotra', gender: 'Female', dob: '1996-01-19' },
    ],
    [
      { title: 'Mr', firstName: 'Aditya', lastName: 'Kulkarni', gender: 'Male', dob: '1991-01-22' },
      { title: 'Ms', firstName: 'Isha', lastName: 'Kulkarni', gender: 'Female', dob: '1994-12-08' },
      { title: 'Mr', firstName: 'Rohan', lastName: 'Kulkarni', gender: 'Male', dob: '1992-08-14' },
    ],
  ];
  const pick = pool[Number(tag) % pool.length];
  const profiles = pick.map((p) => buildPassengerProfile({
    ...p,
    lastName: `${p.lastName}${tag}`,
  }));
  console.log(
    '  passengers',
    profiles.map((p) => `${p.firstName} ${p.lastName}`).join(' | '),
  );

  const payload = buildIssueTicketPayload({
    bookingContext,
    priceId,
    searchIds,
    journeyType: 'ROUND_TRIP',
    passengerProfile: profiles[0],
  });

  payload.data.passengers = profiles.map((p, idx) => ({
    paxId: `PAX${idx + 1}`,
    type: 'adult',
    isLead: idx === 0,
    profile: {
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      gender: p.gender,
      dob: p.dob,
      nationality: 'IN',
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
  return payload;
}

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
    salesSummary: detailRes.data?.bookingResponse?.salesSummary || null,
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base:', config.baseUrl);
  console.log('Goal: RT connecting | 3 ADT');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const routes = [
    { o: 'BOM', d: 'CCU' },
    { o: 'DEL', d: 'IXC' },
    { o: 'BLR', d: 'PAT' },
    { o: 'DEL', d: 'GOI' },
    { o: 'BOM', d: 'GAU' },
    { o: 'DEL', d: 'TRV' },
  ];
  const windows = [[22, 29], [26, 33], [30, 37]];

  let booked = null;
  const attempts = [];

  outer:
  for (const route of routes) {
    for (const [od, rd] of windows) {
      console.log(`\n=== ${route.o}-${route.d} RT d+${od}/${rd} 3ADT ===`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: route.o,
        destination: route.d,
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 3, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('search fail', e.message);
        attempts.push({ route, od, rd, error: e.message });
        continue;
      }

      let data = searchRes.response?.data;
      let onwardConn = analyzeFlightOptions(data, 'ONWARD').connecting || [];
      let returnConn = analyzeFlightOptions(data, 'RETURN').connecting || [];
      console.log('connecting onward', onwardConn.length, 'return', returnConn.length);

      // Refine return with connecting onward if return connecting missing
      if (onwardConn[0]?.searchId && !returnConn.length) {
        const refined = {
          ...body,
          selection: { selectedSearchIds: [onwardConn[0].searchId] },
        };
        try {
          const ref = await flight.pollReturnSearch(body, refined);
          data = ref.data || data;
          returnConn = analyzeFlightOptions(data, 'RETURN').connecting || [];
          console.log('after refine return connecting', returnConn.length);
        } catch (e) {
          console.log('refine fail', e.message);
        }
      }

      if (!onwardConn.length || !returnConn.length) {
        console.log('need both legs connecting — skip');
        attempts.push({
          route,
          od,
          rd,
          skip: 'no both-connecting',
          onward: onwardConn.length,
          return: returnConn.length,
        });
        continue;
      }

      const onwardIds = onwardConn.slice(0, 3).map((c) => c.searchId);
      const returnIds = returnConn.slice(0, 3).map((c) => c.searchId);
      const pairs = [];
      for (const oId of onwardIds) {
        for (const rId of returnIds) {
          pairs.push([oId, rId]);
          if (pairs.length >= 4) break;
        }
        if (pairs.length >= 4) break;
      }

      for (const [oId, rId] of pairs) {
        const finalMetaO = optionMeta(data, oId);
        const finalMetaR = optionMeta(data, rId);

        console.log('try onward', finalMetaO.flights || oId);
        console.log('try return', finalMetaR.flights || rId);

        const pricing = await flight.getPricing([oId, rId], 'ROUND_TRIP');
        if (!pricing.data?.priceId) {
          console.log('pricing fail', brief(pricing.data));
          attempts.push({ route, od, rd, stage: 'pricing', err: brief(pricing.data) });
          continue;
        }
        console.log('price', pricing.data?.pricing?.totalAmount, 'addGst', pricing.data?.addGstInfo);

        const tag = String(Date.now()).slice(-4);
        const payload = build3AdtPayload({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [oId, rId],
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

        let final = await checkOnce(flight, br);
        if (final.aborted) {
          console.log('500 on BR — skip', br, final.reason);
          attempts.push({ route, od, rd, br, stage: 'status500', reason: final.reason });
          continue;
        }
        console.log('status', final.status, 'detail', final.detailStatus, final.legs);

        if (!isTerminalBookingStatus(final.status) && !isTerminalBookingStatus(final.detailStatus)) {
          for (let i = 0; i < 8; i += 1) {
            await sleep(3500);
            final = await checkOnce(flight, br);
            if (final.aborted) {
              console.log('500 mid-poll — skip', br, final.reason);
              attempts.push({ route, od, rd, br, stage: 'status500', reason: final.reason });
              final = null;
              break;
            }
            console.log('poll', i + 1, final.status || final.detailStatus);
            if (isTerminalBookingStatus(final.status) || isTerminalBookingStatus(final.detailStatus)) break;
          }
        }

        if (!final) continue;

        const status = final.detailStatus || final.status;
        booked = {
          br,
          route: `${route.o}-${route.d}`,
          days: { od, rd },
          adults: 3,
          total: pricing.data?.pricing?.totalAmount,
          currency: pricing.data?.pricing?.currency || 'INR',
          onward: finalMetaO,
          return: finalMetaR,
          status,
          legs: final.legs,
          salesSummary: final.salesSummary,
          connectingBoth: Boolean(finalMetaO.connecting) && Boolean(finalMetaR.connecting),
        };
        attempts.push({ route, od, rd, br, status, ok: /confirm/i.test(String(status)) });

        if (/confirm/i.test(String(status))) break outer;
        // Failed/Cancelled — try next pair
        console.log('not Confirmed (', status, ') — try next');
      }
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    goal: 'RT connecting 3ADT',
    booked,
    attempts,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (!booked) {
    console.error('No booking created');
    process.exit(1);
  }

  console.log('\nRESULT', booked.br, booked.status);
  console.log('Report', OUT);
  if (!/confirm/i.test(String(booked.status || ''))) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
