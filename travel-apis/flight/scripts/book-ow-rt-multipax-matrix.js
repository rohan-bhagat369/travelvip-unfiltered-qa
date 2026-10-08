/**
 * Book flight matrix:
 *   OW multipax DIRECT, OW multipax CONNECTING
 *   RT multipax DIRECT, RT multipax CONNECTING
 *
 * Abort immediately if status/detail HTTP 500 (no poll loop).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-ow-rt-multipax-matrix.js
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
  buildOneWaySearchBody,
  buildPassengerProfile,
  buildRoundTripSearchBody,
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-ow-rt-multipax-matrix-canary.json');
const Q = { ...FLIGHT_QUERY };
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const PAX_PAIRS = [
  [
    { title: 'Mr', firstName: 'Kabir', lastName: 'Singh', gender: 'Male', dob: '1988-05-12' },
    { title: 'Mrs', firstName: 'Ananya', lastName: 'Singh', gender: 'Female', dob: '1990-10-03' },
  ],
  [
    { title: 'Mr', firstName: 'Dev', lastName: 'Chopra', gender: 'Male', dob: '1986-02-19' },
    { title: 'Mr', firstName: 'Arjun', lastName: 'Chopra', gender: 'Male', dob: '1991-08-27' },
  ],
  [
    { title: 'Mr', firstName: 'Ravi', lastName: 'Nair', gender: 'Male', dob: '1989-11-08' },
    { title: 'Ms', firstName: 'Meera', lastName: 'Nair', gender: 'Female', dob: '1993-04-15' },
  ],
  [
    { title: 'Mr', firstName: 'Siddharth', lastName: 'Jain', gender: 'Male', dob: '1987-07-21' },
    { title: 'Mrs', firstName: 'Kavya', lastName: 'Jain', gender: 'Female', dob: '1992-01-30' },
  ],
];

function brief(d, n = 320) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function isHttp500(res) {
  return Number(res?.status) === 500
    || String(res?.data?.status) === '500'
    || /internal server error/i.test(JSON.stringify(res?.data || {}));
}

function pickOption(searchData, direction, wantConnecting) {
  const a = analyzeFlightOptions(searchData, direction);
  const list = wantConnecting ? a.connecting : a.nonStop;
  return list[0] || null;
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

function buildMultipaxPayload({ bookingContext, priceId, searchIds, journeyType, pairIndex, tag }) {
  const pair = PAX_PAIRS[pairIndex % PAX_PAIRS.length];
  const p1 = buildPassengerProfile({ ...pair[0], lastName: `${pair[0].lastName}${tag}` });
  const p2 = buildPassengerProfile({ ...pair[1], lastName: `${pair[1].lastName}${tag}` });

  const payload = buildIssueTicketPayload({
    bookingContext,
    priceId,
    searchIds,
    journeyType,
    passengerProfile: p1,
  });

  payload.data.passengers = [
    {
      paxId: 'PAX1', type: 'adult', isLead: true,
      profile: {
        title: p1.title, firstName: p1.firstName, lastName: p1.lastName,
        gender: p1.gender, dob: p1.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false,
      profile: {
        title: p2.title, firstName: p2.firstName, lastName: p2.lastName,
        gender: p2.gender, dob: p2.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];

  return { payload, passengers: [p1, p2] };
}

async function checkOnceNoLoop(flight, br) {
  const statusRes = await flight.getBookingStatus(br);
  if (isHttp500(statusRes)) {
    return { aborted: true, reason: 'STATUS_API_500', statusHttp: statusRes.status, body: statusRes.data };
  }
  const detailRes = await flight.getBookingDetail(br);
  if (isHttp500(detailRes)) {
    return {
      aborted: true,
      reason: 'DETAIL_API_500',
      statusHttp: statusRes.status,
      status: statusRes.data?.status,
      detailHttp: detailRes.status,
      body: detailRes.data,
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
    status: statusRes.data?.status,
    detailStatus: detailRes.data?.status,
    legs,
  };
}

async function searchOwUntil(flight, body, max = 8) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const sid = extractFirstSearchId(last.data);
    if (sid) return last;
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2000);
  }
  return last;
}

async function bookOw({ flight, client, wantConnecting, pairIndex, routes, daysList }) {
  for (const r of routes) {
    for (const days of daysList) {
      console.log(`\n[OW ${wantConnecting ? 'CONN' : 'DIRECT'}] ${r.o}-${r.d} d+${days}`);
      const body = buildOneWaySearchBody(days, {
        origin: r.o, destination: r.d, maxStops: wantConnecting ? null : 0, fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: wantConnecting ? null : 0, refundableOnly: false };

      const search = await searchOwUntil(flight, body);
      const data = search?.data;
      const picked = pickOption(data, 'ONWARD', wantConnecting)
        || (wantConnecting ? null : { searchId: extractFirstSearchId(data) });
      if (!picked?.searchId) {
        console.log('  no option');
        continue;
      }
      const meta = optionMeta(data, picked.searchId);
      if (wantConnecting && !meta.connecting) {
        console.log('  not connecting — skip');
        continue;
      }
      if (!wantConnecting && meta.connecting) {
        console.log('  connecting when wanted direct — skip');
        continue;
      }
      console.log('  pick', meta.connecting ? 'CONN' : 'DIRECT', meta.flights);

      const pricing = await flight.getPricing([picked.searchId], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      console.log('  price', pricing.data.pricing?.totalAmount);

      const tag = `${Date.now().toString(36).slice(-3)}${pairIndex}`;
      const { payload, passengers } = buildMultipaxPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [picked.searchId],
        journeyType: 'ONE_WAY',
        pairIndex,
        tag,
      });
      if (pricing.data.addGstInfo === true) {
        payload.data.includeGst = true;
        payload.data.addGstInfo = true;
        payload.data.gstDetails = { ...VALID_GST };
      }
      console.log('  pax', passengers.map((p) => `${p.firstName} ${p.lastName}`).join(' + '));

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
        console.log('  issue fail', brief(issue.data));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        }
        continue;
      }

      const check = await checkOnceNoLoop(flight, br);
      return {
        kind: `OW_${wantConnecting ? 'CONNECTING' : 'DIRECT'}`,
        br,
        route: `${r.o}-${r.d}`,
        days,
        total: pricing.data.pricing?.totalAmount,
        passengers,
        meta,
        issueStatus: issue.data?.status,
        check,
      };
    }
  }
  return null;
}

async function bookRt({ flight, client, wantConnecting, pairIndex, routes, windows }) {
  for (const r of routes) {
    for (const [od, rd] of windows) {
      console.log(`\n[RT ${wantConnecting ? 'CONN' : 'DIRECT'}] ${r.o}-${r.d} d+${od}/${rd}`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: r.o, destination: r.d, maxStops: wantConnecting ? null : 0, fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: wantConnecting ? null : 0, refundableOnly: false };

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('  search fail', e.message);
        continue;
      }
      const data = searchRes.response?.data;
      const onward = pickOption(data, 'ONWARD', wantConnecting);
      const ret = pickOption(data, 'RETURN', wantConnecting);
      if (!onward?.searchId || !ret?.searchId) {
        console.log('  missing pair options');
        continue;
      }
      const metaO = optionMeta(data, onward.searchId);
      const metaR = optionMeta(data, ret.searchId);
      if (wantConnecting && !(metaO.connecting && metaR.connecting)) {
        console.log('  not both connecting');
        continue;
      }
      if (!wantConnecting && (metaO.connecting || metaR.connecting)) {
        console.log('  not both direct');
        continue;
      }
      console.log('  onward', metaO.connecting ? 'CONN' : 'DIRECT', metaO.flights);
      console.log('  return', metaR.connecting ? 'CONN' : 'DIRECT', metaR.flights);

      const pricing = await flight.getPricing([onward.searchId, ret.searchId], 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      console.log('  price', pricing.data.pricing?.totalAmount);

      const tag = `${Date.now().toString(36).slice(-3)}${pairIndex}`;
      const { payload, passengers } = buildMultipaxPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [onward.searchId, ret.searchId],
        journeyType: 'ROUND_TRIP',
        pairIndex,
        tag,
      });
      if (pricing.data.addGstInfo === true) {
        payload.data.includeGst = true;
        payload.data.addGstInfo = true;
        payload.data.gstDetails = { ...VALID_GST };
      }
      console.log('  pax', passengers.map((p) => `${p.firstName} ${p.lastName}`).join(' + '));

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
        console.log('  issue fail', brief(issue.data));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        }
        continue;
      }

      const check = await checkOnceNoLoop(flight, br);
      return {
        kind: `RT_${wantConnecting ? 'CONNECTING' : 'DIRECT'}`,
        br,
        route: `${r.o}-${r.d}`,
        days: { od, rd },
        total: pricing.data.pricing?.totalAmount,
        passengers,
        onward: metaO,
        return: metaR,
        issueStatus: issue.data?.status,
        check,
      };
    }
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base:', config.baseUrl);
  console.log('Matrix: OW/RT × DIRECT/CONNECTING × 2ADT | abort on status 500');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const owRoutes = [
    { o: 'DEL', d: 'BOM' },
    { o: 'BOM', d: 'BLR' },
    { o: 'DEL', d: 'HYD' },
    { o: 'BLR', d: 'DEL' },
  ];
  const owConnRoutes = [
    { o: 'DEL', d: 'GOI' },
    { o: 'BOM', d: 'CCU' },
    { o: 'DEL', d: 'IXC' },
    { o: 'BLR', d: 'PAT' },
  ];
  const rtRoutes = [
    { o: 'DEL', d: 'BOM' },
    { o: 'BOM', d: 'BLR' },
    { o: 'DEL', d: 'HYD' },
  ];
  const rtConnRoutes = [
    { o: 'DEL', d: 'GOI' },
    { o: 'BOM', d: 'CCU' },
    { o: 'DEL', d: 'IXC' },
  ];

  const results = [];
  const jobs = [
    () => bookOw({ flight, client, wantConnecting: false, pairIndex: 0, routes: owRoutes, daysList: [21, 28] }),
    () => bookOw({ flight, client, wantConnecting: true, pairIndex: 1, routes: owConnRoutes, daysList: [22, 30] }),
    () => bookRt({ flight, client, wantConnecting: false, pairIndex: 2, routes: rtRoutes, windows: [[21, 28], [25, 32]] }),
    () => bookRt({ flight, client, wantConnecting: true, pairIndex: 3, routes: rtConnRoutes, windows: [[22, 29], [26, 33]] }),
  ];

  for (const job of jobs) {
    const r = await job();
    if (!r) {
      results.push({ ok: false, note: 'no inventory / issue failed' });
      continue;
    }
    if (r.error === 'INSUFFICIENT_BALANCE') {
      results.push({ ok: false, ...r });
      console.log('\nSTOP — INSUFFICIENT_BALANCE');
      break;
    }
    results.push({ ok: true, ...r });
    console.log('=>', r.kind, r.br, r.check?.aborted ? r.check.reason : (r.check?.detailStatus || r.check?.status));
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    results,
    table: results.filter((x) => x.ok).map((x, i) => ({
      n: i + 1,
      kind: x.kind,
      br: x.br,
      route: x.route,
      total: x.total,
      pax: (x.passengers || []).map((p) => `${p.firstName} ${p.lastName}`).join(' + '),
      status: x.check?.aborted ? x.check.reason : (x.check?.detailStatus || x.check?.status || x.issueStatus),
    })),
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.table(report.table);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
