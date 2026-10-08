/**
 * Book ONE_WAY, 1 adult, connecting (1-stop) on canary.
 * Handles pricing addGstInfo; uses v2 issue-ticket. Does NOT cancel.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-ow-1adt-connecting-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-ow-1adt-connecting-canary.json';
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ROUTES = [
  { o: 'DEL', d: 'GOI', days: 58 },
  { o: 'BOM', d: 'CCU', days: 52 },
  { o: 'DEL', d: 'GAU', days: 55 },
  { o: 'BLR', d: 'PAT', days: 48 },
  { o: 'DEL', d: 'TRV', days: 60 },
  { o: 'BOM', d: 'IXR', days: 54 },
  { o: 'HYD', d: 'CCU', days: 50 },
];

function optionMeta(data, searchId) {
  for (const block of data?.results || []) {
    for (const opt of block?.options || []) {
      if (opt.searchId !== searchId) continue;
      return {
        searchId,
        totalStops: opt.totalStops ?? 0,
        segmentCount: opt.segments?.length ?? 0,
        durationMinutes: opt.totalDurationMinutes,
        flights: (opt.segments || []).map((s) => ({
          flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
          route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
          dep: s.departure?.time || s.departure?.dateTime,
          arr: s.arrival?.time || s.arrival?.dateTime,
        })),
      };
    }
  }
  return null;
}

function connectingList(data) {
  const { connecting } = analyzeFlightOptions(data, 'ONWARD');
  const one = connecting.filter((c) => c.totalStops === 1 || c.segmentCount === 2);
  return [...one, ...connecting.filter((c) => !one.includes(c))];
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);
  console.log('Base', config.baseUrl, 'issuePid', process.env.FLIGHT_ISSUE_PID);
  console.log('Goal: ONE_WAY | 1ADT | connecting');

  const attempts = [];
  let booked = null;

  outer: for (const r of ROUTES) {
    const body = buildOneWaySearchBody(r.days, {
      origin: r.o,
      destination: r.d,
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.preferences = { airlines: [], maxStops: null, refundableOnly: false };
    console.log(`\n=== ${r.o}→${r.d} +${r.days}d ===`);

    let data = null;
    for (let i = 0; i < 18; i += 1) {
      const res = await flight.search(body);
      data = res.data;
      const hasConn = analyzeFlightOptions(data, 'ONWARD').connectingCount > 0;
      const complete = isSearchProgressComplete(data);
      if (hasConn && (complete || i >= 5)) break;
      if (complete && !hasConn) break;
      await sleep(data?.progress?.pollAfterMs || 3500);
    }

    const list = connectingList(data);
    console.log('connecting options', list.length);
    if (!list.length) {
      attempts.push({ ...r, skip: 'no connecting' });
      continue;
    }

    for (const pick of list.slice(0, 5)) {
      const meta = optionMeta(data, pick.searchId) || pick;
      console.log('try', JSON.stringify(meta.flights || meta));

      const pricing = await flight.getPricing([pick.searchId], 'ONE_WAY');
      if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
        console.log('  pricing fail', JSON.stringify(pricing.data)?.slice(0, 180));
        attempts.push({ ...r, sid: pick.searchId, stage: 'pricing' });
        continue;
      }

      const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
      console.log('  price', total, 'addGst', pricing.data?.addGstInfo);

      const tag = String(Date.now()).slice(-4);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [pick.searchId],
        journeyType: 'ONE_WAY',
        passengerProfile: {
          title: 'Mr',
          firstName: 'Rohan',
          lastName: `Bhagat${tag}`,
          gender: 'Male',
          dob: '2001-05-29',
        },
      });

      if (pricing.data?.addGstInfo === true) {
        payload.data.includeGst = true;
        payload.data.addGstInfo = true;
        payload.data.gstDetails = { ...GST };
      }

      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });

      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      console.log('  issue', issue.status, br || JSON.stringify(issue.data)?.slice(0, 220));
      if (!br) {
        attempts.push({
          ...r,
          sid: pick.searchId,
          stage: 'issue',
          err: JSON.stringify(issue.data)?.slice(0, 220),
        });
        continue;
      }

      let status = issue.data?.status;
      for (let i = 0; i < 24; i += 1) {
        const st = await flight.getBookingStatus(br);
        if (st.status === 500 || st.data?.status === 500) {
          status = 500;
          console.log('  status', i + 1, 'HTTP/body 500');
          if (i >= 5) break;
          await sleep(4000);
          continue;
        }
        status = st.data?.status || status;
        console.log('  status', i + 1, status);
        if (isTerminalBookingStatus(status)) break;
        await sleep(4000);
      }

      if (!/confirm/i.test(String(status))) {
        attempts.push({ ...r, br, status, stage: 'status', meta });
        continue;
      }

      const detail = await flight.getBookingDetail(br);
      const it = detail.data?.bookingResponse?.itinerary || [];
      const segs = it.flatMap((l) => l.segments || []);
      const pnr = it.find((x) => x.pnr)?.pnr || null;

      booked = {
        bookingReference: br,
        bookingStatus: detail.data?.status || status,
        pnr,
        route: `${r.o} → ${r.d}`,
        journeyType: 'ONE_WAY',
        adults: 1,
        connecting: true,
        totalStops: meta.totalStops,
        segmentCount: segs.length || meta.segmentCount,
        flights: segs.length
          ? segs.map((s) => ({
              flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
              route: `${s.departure?.airportCode || ''}→${s.arrival?.airportCode || ''}`,
              dep: s.departure?.time,
              arr: s.arrival?.time,
            }))
          : meta.flights,
        salesSummary: detail.data?.bookingResponse?.salesSummary || null,
        price: {
          priceId: pricing.data.priceId,
          totalAmount: total,
          currency: pricing.data?.pricing?.currency || 'INR',
        },
        addGstInfo: Boolean(pricing.data?.addGstInfo),
      };
      attempts.push({ ...r, br, status, ok: true });
      break outer;
    }
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        booked,
        attempts,
      },
      null,
      2,
    ),
  );

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(booked || { error: 'no confirmed connecting booking', attempts }, null, 2));
  console.log('Report', OUT);
  if (!booked) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
