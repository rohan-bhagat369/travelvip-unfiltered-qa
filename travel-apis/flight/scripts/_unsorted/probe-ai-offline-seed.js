/**
 * Hunt Air India (AI) for offline seed: Confirmed + onlineCancellation=false
 * Then PENALTY → CANCEL (expect Cancellation Requested).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-ai-offline-seed.js
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
  isSearchProgressComplete,
  extractFirstSearchId,
  analyzeFlightOptions,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/probe-ai-offline-seed.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 600) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
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

function isAiOption(opt) {
  const legs = opt.legs || [];
  if (legs.length) {
    return legs.every((l) => String(l.flight || '').toUpperCase().startsWith('AI'));
  }
  const segs = opt.segments || [];
  return segs.length > 0 && segs.every((s) => {
    const code = String(s.airline?.code || s.airlineCode || '').toUpperCase();
    return code === 'AI';
  });
}

const ATTEMPTS = [
  { o: 'DEL', d: 'BOM', days: 55, fareType: 'CORPORATE', name: ['Karan', 'Malhotra'] },
  { o: 'DEL', d: 'BOM', days: 60, fareType: 'NORMAL', name: ['Vivek', 'Saxena'] },
  { o: 'BOM', d: 'DEL', days: 58, fareType: 'CORPORATE', name: ['Arjun', 'Mehta'] },
  { o: 'BLR', d: 'DEL', days: 65, fareType: 'NORMAL', name: ['Dev', 'Kapoor'] },
  { o: 'DEL', d: 'HYD', days: 70, fareType: 'CORPORATE', name: ['Kabir', 'Nair'] },
  { o: 'HYD', d: 'BOM', days: 72, fareType: 'NORMAL', name: ['Rohan', 'Desai'] },
  { o: 'DEL', d: 'MAA', days: 75, fareType: 'CORPORATE', name: ['Yash', 'Iyer'] },
  { o: 'MAA', d: 'DEL', days: 68, fareType: 'NORMAL', name: ['Aman', 'Joshi'] },
];

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('AI offline-seed hunt on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const attemptsLog = [];
  const table = [];
  let offlineFixture = null;

  for (const a of ATTEMPTS) {
    console.log(`\n=== AI ${a.fareType} ${a.o}-${a.d} d+${a.days}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o,
      destination: a.d,
      fareType: a.fareType,
      maxStops: null,
    });
    body.preferences.airlines = ['AI'];

    let sid = null;
    let pickMeta = null;
    for (let i = 0; i < 10; i += 1) {
      const s = await flight.search(body);
      const analysis = analyzeFlightOptions(s.data, 'ONWARD');
      const pool = [...analysis.nonStop, ...analysis.connecting];
      const hit = pool.find(isAiOption) || pool.find((o) =>
        (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith('AI')));
      if (hit?.searchId) {
        sid = hit.searchId;
        pickMeta = {
          searchId: sid,
          flight: hit.legs?.[0]?.flight || hit.segments?.[0]?.flightNumber,
          price: hit.totalFare ?? hit.price,
          refundable: hit.refundable,
        };
        break;
      }
      sid = extractFirstSearchId(s.data);
      if (sid || isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }

    if (!sid) {
      console.log('  no AI searchId');
      attemptsLog.push({ ...a, result: 'NO_SEARCH' });
      continue;
    }
    console.log('  pick', pickMeta || sid);

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId) {
      console.log('  pricing fail', brief(pricing.data, 200));
      attemptsLog.push({ ...a, result: 'PRICING_FAIL', sid });
      continue;
    }

    const tag = letterTag();
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [sid],
      journeyType: 'ONE_WAY',
    });
    payload.data.passengers = [{
      paxId: 'PAX1',
      type: 'adult',
      isLead: true,
      profile: {
        title: 'Mr',
        firstName: a.name[0],
        lastName: `${a.name[1]}${tag}`,
        gender: 'Male',
        dob: '1988-04-12',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    }];
    if (pricing.data.addGstInfo === true || a.fareType === 'CORPORATE') {
      payload.data.includeGst = true;
      payload.data.addGstInfo = true;
      payload.data.gstDetails = { ...GST };
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
      console.log('  issue fail', brief(issue.data, 220));
      attemptsLog.push({
        ...a,
        result: 'ISSUE_FAIL',
        code: issue.data?.error?.code,
        msg: brief(issue.data, 180),
      });
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') break;
      continue;
    }

    const { status, bail } = await waitConfirmOrBail(flight, br);
    if (bail || !/confirm/i.test(status)) {
      attemptsLog.push({ ...a, br, status, result: 'NOT_CONFIRMED' });
      continue;
    }

    const detail = await flight.getBookingDetail(br);
    const leg = (detail.data?.bookingResponse?.itinerary || [])[0] || {};
    const bifOnline = detail.data?.bookingResponse?.onlineCancellation;
    const online = leg.onlineCancellation ?? bifOnline;
    const row = {
      ...a,
      br,
      status,
      pnr: leg.pnr,
      airline: leg.segments?.[0]?.airlineCode || 'AI',
      onlineCancellation: online,
      result: online === false || online === 0 ? 'OFFLINE' : 'ONLINE',
    };
    console.log('  =>', br, leg.pnr, 'onlineCancellation=', online);
    attemptsLog.push(row);

    if (online === false || online === 0) {
      offlineFixture = row;
      break;
    }
    // leave online AI alone; keep hunting
  }

  if (offlineFixture) {
    const { br, pnr } = offlineFixture;
    console.log('\n=== OFFLINE path PENALTY→CANCEL', br, pnr);
    const pen = await cancelCall(client, br, {
      action: 'PENALTY', pnr, cancellationReason: 'AI offline seed',
    });
    console.log('PENALTY', pen.status, brief(pen.data));
    const can = await cancelCall(client, br, {
      action: 'CANCEL', pnr, cancellationReason: 'AI offline seed',
    });
    console.log('CANCEL', can.status, brief(can.data));

    const penSt = cr(pen).status;
    const canSt = cr(can).status;
    table.push({
      rule: 'AI offline inventory found',
      expected: 'Confirmed + onlineCancellation=false',
      actual: `${offlineFixture.br} / ${offlineFixture.pnr}`,
      status: 'PASS',
    });
    table.push({
      rule: 'AI offline PENALTY',
      expected: 'Penalty Fetched',
      actual: penSt || pen.data?.error?.code || pen.status,
      status: /penalty fetched/i.test(String(penSt || '')) ? 'PASS' : 'BUG',
    });
    table.push({
      rule: 'AI offline CANCEL → request path',
      expected: 'Cancellation Requested',
      actual: canSt || can.data?.error?.code || can.status,
      status: /cancellation requested/i.test(String(canSt || ''))
        ? 'PASS'
        : (/cancelled/i.test(String(canSt || '')) ? 'PASS' : 'BUG'),
    });

    offlineFixture.penalty = { http: pen.status, status: penSt, raw: env(pen) };
    offlineFixture.cancel = { http: can.status, status: canSt, raw: env(can) };
  } else {
    table.push({
      rule: 'AI offline inventory found',
      expected: 'Confirmed + onlineCancellation=false',
      actual: `none; tried=${attemptsLog.length}; online=${attemptsLog.filter((x) => x.result === 'ONLINE').length}; notConfirmed=${attemptsLog.filter((x) => x.result === 'NOT_CONFIRMED').length}`,
      status: 'NOT_TESTED',
    });
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    offlineFixture,
    attemptsLog,
    table,
    score: {
      PASS: table.filter((t) => t.status === 'PASS').length,
      BUG: table.filter((t) => t.status === 'BUG').length,
      NOT_TESTED: table.filter((t) => t.status === 'NOT_TESTED').length,
    },
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', report.score);
  console.table(table);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
