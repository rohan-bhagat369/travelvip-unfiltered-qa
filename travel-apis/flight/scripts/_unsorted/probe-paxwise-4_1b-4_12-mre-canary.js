/**
 * MRE retest: paxwise cancel rules 4.1b + 4.12 on canary.
 * Books fresh 2ADT OW (needed so ["PAX1","PAX9"] is not PAX_LIST_TOO_LARGE by size).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-paxwise-4_1b-4_12-mre-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/paxwise-4_1b-4_12-mre-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 800) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function cancelStatus(r) {
  return (
    r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || r?.data?.status
    || null
  );
}

function adultProfiles() {
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true,
      profile: { title: 'Mr', firstName: 'Karan', lastName: 'Mehta', gender: 'Male', dob: '1993-06-11', nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false,
      profile: { title: 'Mr', firstName: 'Dev', lastName: 'Mehta', gender: 'Male', dob: '1994-09-19', nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 14; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 4) {
      console.log('  leave Inprogress');
      return st;
    }
    await sleep(3500);
  }
  return last?.data?.status;
}

function extractPnr(detailData) {
  const it = detailData?.bookingResponse?.itinerary || [];
  for (const leg of it) if (leg?.pnr) return leg.pnr;
  return null;
}

async function book2adt(flight, client) {
  const routes = [
    { o: 'DEL', d: 'BOM', days: 88 },
    { o: 'BLR', d: 'DEL', days: 90 },
    { o: 'BOM', d: 'HYD', days: 92 },
    { o: 'MAA', d: 'BOM', days: 94 },
    { o: 'HYD', d: 'BLR', days: 96 },
    { o: 'AMD', d: 'DEL', days: 98 },
  ];

  for (const r of routes) {
    console.log(`BOOK 2ADT OW ${r.o}->${r.d} +${r.days}d`);
    const body = buildOneWaySearchBody(r.days, {
      origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences = { airlines: ['IX', 'SG'], maxStops: 0, refundableOnly: false };

    let search;
    try {
      search = await flight.searchUntilComplete(body);
    } catch (e) {
      console.log('  search fail', e.message);
      continue;
    }

    const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      console.log('  pricing fail', brief(pricing.data, 200));
      continue;
    }

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [search.searchId],
      journeyType: 'ONE_WAY',
    });
    payload.data.passengers = adultProfiles();

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
      console.log('  issue fail', brief(issue.data, 250));
      continue;
    }

    const status = await waitStatus(flight, br);
    const detail = await flight.getBookingDetail(br);
    const detailStatus = detail.data?.status || status;
    const pnr = extractPnr(detail.data);
    const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
    console.log('  ->', br, detailStatus, pnr, 'pax=', pax);

    if (!pnr || pnr === 'FVRVRV') {
      console.log('  skip no/stub PNR');
      continue;
    }
    if (/fail|cancel|inprogress/i.test(String(detailStatus))) {
      console.log('  leave non-confirmed');
      continue;
    }
    if (pax.length < 2) {
      console.log('  need 2 pax for 4.12');
      continue;
    }
    return {
      br, pnr, status: detailStatus, route: `${r.o}-${r.d}`, adults: 2, paxIds: pax,
    };
  }
  return null;
}

function mreCase({ id, how, expected, request, response }) {
  const code = errCode(response);
  const actual = `${response.status} ${code || cancelStatus(response) || ''}`.trim();
  const expectedHttp = Number(String(expected).split(' ')[0]);
  const expectedCode = String(expected).split(' ').slice(1).join(' ');
  const pass = response.status === expectedHttp && code === expectedCode;
  return {
    id,
    how,
    expected,
    actual,
    status: pass ? 'PASS' : 'BUG',
    request: {
      method: 'POST',
      path: request.path,
      body: request.body,
    },
    response: {
      httpStatus: response.status,
      errorCode: code,
      cancelStatus: cancelStatus(response),
      fullBody: response.data,
    },
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  // reload base from env already read — force via config usage note
  console.log('Base from config (set BASE_URL before start):', config.baseUrl);
  if (!/canary/i.test(config.baseUrl)) {
    console.warn('WARNING: config.baseUrl is not canary. Re-run with BASE_URL=https://canary-api.travelvip.ai');
  }

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await book2adt(flight, client);
  if (!fixture) throw new Error('No usable 2ADT Confirmed fixture on canary');
  console.log('FIXTURE', fixture);

  const cancelPath = `/v1/flights/booking/${fixture.br}/cancel`;
  const cancelApi = (body) => client.request({
    method: 'POST',
    path: cancelPath,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // --- 4.1b ---
  const body41b = {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: { 0: 'PAX1' },
  };
  console.log('\n=== 4.1b object {0:"PAX1"} ===');
  console.log('REQUEST', JSON.stringify(body41b));
  const r41b = await cancelApi(body41b);
  console.log('RESPONSE HTTP', r41b.status);
  console.log('RESPONSE BODY', JSON.stringify(r41b.data, null, 2));

  const case41b = mreCase({
    id: '4.1b',
    how: 'object {0:"PAX1"}',
    expected: '400 VALIDATION_ERROR',
    request: { path: cancelPath, body: body41b },
    response: r41b,
  });

  // --- 4.12 ---
  const body412 = {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX1', 'PAX9'],
  };
  console.log('\n=== 4.12 ["PAX1","PAX9"] ===');
  console.log('REQUEST', JSON.stringify(body412));
  const r412 = await cancelApi(body412);
  console.log('RESPONSE HTTP', r412.status);
  console.log('RESPONSE BODY', JSON.stringify(r412.data, null, 2));

  const case412 = mreCase({
    id: '4.12',
    how: '["PAX1","PAX9"] on 2ADT booking',
    expected: '422 PAX_NOT_IN_BOOKING',
    request: { path: cancelPath, body: body412 },
    response: r412,
  });

  // Control: same list size on 2ADT should NOT be TOO_LARGE if both exist
  const bodyOk = {
    action: 'PENALTY',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX1'],
  };
  const rOk = await cancelApi(bodyOk);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    note: 'MRE for known bugs 4.1b + 4.12. Fixture is 2ADT so list length 2 is not over-size.',
    fixture,
    results: [case41b, case412],
    score: {
      PASS: [case41b, case412].filter((x) => x.status === 'PASS').length,
      BUG: [case41b, case412].filter((x) => x.status === 'BUG').length,
    },
    controlPenaltyPax1: {
      request: bodyOk,
      httpStatus: rOk.status,
      errorCode: errCode(rOk),
      cancelStatus: cancelStatus(rOk),
      body: rOk.data,
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSCORE', report.score);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
