/**
 * Cancel ALL pax via cancellationPaxList on CORPORATE OW 2ADT
 * Compare to full-PNR (no list): expect amounts ×2; note if PARTIAL_PAX when list=all
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-all-via-list.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
  analyzeFlightOptions,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-all-via-list.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const LIST = ['PAX1', 'PAX2'];

function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function nearly(a, b, tol = 2) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}
function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function waitConfirmOrBail(flight, br) {
  let last = null;
  for (let i = 0; i < 5; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return { status: last, bail: false };
    if (/inprogress|in.?progress/i.test(last)) {
      console.log('  Inprogress — LEAVE');
      return { status: last, bail: true };
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) {
      return { status: last, bail: !/confirm/i.test(last) };
    }
    await sleep(2000);
  }
  console.log('  still Pending — LEAVE');
  return { status: last, bail: true };
}

async function book(flight, client) {
  const attempts = [
    { o: 'DEL', d: 'BOM', days: 50, names: [['Kian', 'Mehta'], ['Aria', 'Mehta']] },
    { o: 'BOM', d: 'BLR', days: 56, names: [['Veer', 'Kapoor'], ['Nyra', 'Kapoor']] },
    { o: 'DEL', d: 'HYD', days: 63, names: [['Arjun', 'Bose'], ['Kiara', 'Bose']] },
  ];
  for (const a of attempts) {
    console.log(`\nBOOK CORPORATE OW 2ADT 6E ${a.o}-${a.d} d+${a.days}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: 'CORPORATE', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences.airlines = ['6E'];

    let sid = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      const analysis = analyzeFlightOptions(s.data, 'ONWARD');
      const hit = [...analysis.nonStop, ...analysis.connecting]
        .find((o) => (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith('6E')));
      sid = hit?.searchId || extractFirstSearchId(s.data);
      if (sid || isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (!sid) continue;

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId) continue;
    console.log('  fare', pricing.data.pricing?.totalAmount);

    const tag = letterTag();
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [sid],
      journeyType: 'ONE_WAY',
    });
    payload.data.passengers = a.names.map(([firstName, lastName], i) => ({
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: i === 0 ? 'Mr' : 'Mrs',
        firstName,
        lastName: `${lastName} ${tag}`,
        gender: i === 0 ? 'Male' : 'Female',
        dob: i === 0 ? '1986-01-20' : '1990-06-11',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    }));
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };

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
      console.log('  issue fail', brief(issue.data, 200));
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') return { error: 'INSUFFICIENT_BALANCE' };
      continue;
    }

    const { status, bail } = await waitConfirmOrBail(flight, br);
    if (bail || !/confirm/i.test(status)) continue;

    const detail = await flight.getBookingDetail(br);
    const pnr = (detail.data?.bookingResponse?.itinerary || [])[0]?.pnr;
    if (!pnr) continue;
    console.log('  =>', br, pnr);
    return { br, pnr, status, totalAmount: pricing.data.pricing?.totalAmount };
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Cancel ALL via list on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await book(flight, client);
  if (!fixture?.br) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_BOOKING' }, null, 2));
    throw new Error('NO_BOOKING');
  }

  console.log('\n=== PENALTY all via list', LIST);
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: fixture.pnr,
    cancellationPaxList: LIST,
    cancellationReason: 'all via list',
  });
  console.log('PENALTY', pen.status, brief(pen.data));

  await sleep(1500);
  console.log('\n=== CANCEL all via list');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: LIST,
    cancellationReason: 'all via list',
  });
  console.log('CANCEL', can.status, brief(can.data));

  const after = await flight.getBookingStatus(fixture.br);
  const table = [];

  for (const [label, res] of [['PENALTY', pen], ['CANCEL', can]]) {
    const c = cr(res);
    const scope = env(res).paxScope;
    const perPax = c.perPax;
    const totalAmount = num(c.totalAmount);
    const charge = num(c.estimatedCancellationCharge);
    const refund = num(c.estimatedRefund);

    table.push({
      rule: `${label}: amounts`,
      expected: 'total/charge/refund numeric',
      actual: `total=${totalAmount} charge=${charge} refund=${refund} msg=${c.message || ''}`,
      status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
    });
    table.push({
      rule: `${label}: refund math`,
      expected: 'refund = total - charge',
      actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
      status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
    });
    table.push({
      rule: `${label}: list=all documented scope`,
      expected: 'PARTIAL_PAX cancelled=2 total=2 OR no paxScope (full)',
      actual: scope ? brief(scope, 260) : 'absent (full-PNR style)',
      status: (!scope)
        || (scope.scope === 'PARTIAL_PAX' && Number(scope.cancelledPaxCount) === 2 && Number(scope.totalPaxOnPnr) === 2)
        ? 'PASS' : 'BUG',
    });

    let perOk = false;
    if (Array.isArray(perPax)) perOk = perPax.length === 2;
    else if (perPax) perOk = Number(perPax.chargedPax) === 2 || Number(perPax.paxCount) === 2;
    table.push({
      rule: `${label}: perPax ×2`,
      expected: '2 pax entries or chargedPax=2',
      actual: perPax ? brief(perPax, 280) : 'MISSING',
      status: perOk ? 'PASS' : 'BUG',
    });
    table.push({
      rule: `${label}: status`,
      expected: 'Penalty Fetched / Cancellation Requested / Cancelled',
      actual: c.status || res.status,
      status: /penalty fetched|cancellation requested|cancelled/i.test(String(c.status || ''))
        && !/failed|not available/i.test(String(c.status || ''))
        ? 'PASS' : 'BUG',
    });
  }

  table.push({
    rule: 'Final booking status',
    expected: 'Cancelled or Cancellation Requested path',
    actual: after.data?.status,
    status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
  });

  // Document path: list-all often stays request path even when online
  const cancelStatus = cr(can).status;
  table.push({
    rule: 'Path note: list-all vs no-list',
    expected: 'Document actual (Requested vs Cancelled)',
    actual: `CANCEL status=${cancelStatus}; booking=${after.data?.status}`,
    status: 'PASS',
  });

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'Cancel ALL pax via cancellationPaxList on 2ADT',
    fixture,
    request: { cancellationPaxList: LIST },
    penalty: env(pen),
    cancel: env(can),
    afterStatus: after.data?.status,
    table,
    score,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', score);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule.slice(0, 55) })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
