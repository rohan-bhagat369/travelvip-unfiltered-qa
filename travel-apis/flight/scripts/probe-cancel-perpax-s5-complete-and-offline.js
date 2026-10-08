/**
 * Next: (1) S5-complete on 6E partial RT — cancel return FR71YC
 *       (2) Probe offline path — book until onlineCancellation=false, PENALTY→CANCEL
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-s5-complete-and-offline.js
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

const OUT = 'reports/cancel-perpax-s5-complete-and-offline.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 800) {
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
function nearly(a, b, tol = 1) {
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

function scoreQuote(label, res, { expectStatusRe }) {
  const c = cr(res);
  const totalAmount = num(c.totalAmount);
  const charge = num(c.estimatedCancellationCharge);
  const refund = num(c.estimatedRefund);
  const rows = [];
  rows.push({
    rule: `${label}: amounts`,
    expected: 'total/charge/refund numeric',
    actual: `total=${totalAmount} charge=${charge} refund=${refund} msg=${c.message || ''}`,
    status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: refund math`,
    expected: 'refund = total - charge',
    actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
    status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: status`,
    expected: expectStatusRe,
    actual: c.status || res.data?.error?.code || res.status,
    status: new RegExp(expectStatusRe, 'i').test(String(c.status || ''))
      && !/not available/i.test(String(c.status || ''))
      ? 'PASS' : 'BUG',
  });
  return {
    rows,
    snapshot: { http: res.status, raw: env(res), status: c.status, totalAmount, charge, refund, perPax: c.perPax || null },
  };
}

async function s5Complete(client, flight, table) {
  const BR = 'BR1786568422897124';
  const RETURN_PNR = 'FR71YC';
  const ONWARD_PNR = 'G122SA';
  console.log('\n=== S5-complete: cancel return', BR, RETURN_PNR);

  const pen = await cancelCall(client, BR, {
    action: 'PENALTY', pnr: RETURN_PNR, cancellationReason: 'S5-complete 6E return',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = scoreQuote('S5c PENALTY return', pen, { expectStatusRe: 'Penalty Fetched' });
  table.push(...sPen.rows);

  await sleep(1500);
  const can = await cancelCall(client, BR, {
    action: 'CANCEL', pnr: RETURN_PNR, cancellationReason: 'S5-complete 6E return',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = scoreQuote('S5c CANCEL return', can, { expectStatusRe: 'Cancelled|Cancellation Requested' });
  // provider fail note
  if (/failed/i.test(String(cr(can).status || ''))) {
    table.push({
      rule: 'S5c CANCEL return status',
      expected: 'Cancelled / Cancellation Requested (6E preferred)',
      actual: cr(can).status,
      status: 'BUG',
      note: 'provider fail',
    });
  } else {
    table.push(...sCan.rows);
  }

  await sleep(1500);
  const after = await flight.getBookingStatus(BR);
  const det = await flight.getBookingDetail(BR);
  const itins = det.data?.bookingResponse?.itinerary || [];
  table.push({
    rule: 'S5c onward PNR still listed',
    expected: ONWARD_PNR,
    actual: itins.find((l) => /onward/i.test(l.direction))?.pnr || 'n/a',
    status: itins.some((l) => l.pnr === ONWARD_PNR) ? 'PASS' : 'BUG',
  });
  table.push({
    rule: 'S5c booking after return cancel',
    expected: 'Cancelled or Partially cancelled',
    actual: after.data?.status,
    status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
  });

  return {
    br: BR,
    returnPnr: RETURN_PNR,
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
    afterStatus: after.data?.status,
  };
}

async function tryOffline(flight, client, table) {
  const attempts = [
    { airline: 'AI', o: 'DEL', d: 'BOM', days: 58, fareType: 'CORPORATE', name: ['Manav', 'Chopra'] },
    { airline: 'UK', o: 'BOM', d: 'DEL', days: 62, fareType: 'NORMAL', name: ['Ishan', 'Bedi'] },
    { airline: 'AI', o: 'BLR', d: 'DEL', days: 66, fareType: 'NORMAL', name: ['Rudra', 'Anand'] },
    { airline: 'SG', o: 'DEL', d: 'MAA', days: 70, fareType: 'NORMAL', name: ['Neel', 'Batra'] },
    { airline: '6E', o: 'HYD', d: 'DEL', days: 74, fareType: 'NORMAL', name: ['Shaurya', 'Rana'] },
  ];
  const left = [];
  let onlineSeen = 0;

  for (const a of attempts) {
    console.log(`\nOFFLINE probe BOOK ${a.fareType} ${a.airline} ${a.o}-${a.d} d+${a.days}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: a.fareType, maxStops: 0,
    });
    body.preferences.airlines = [a.airline];

    let sid = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      const analysis = analyzeFlightOptions(s.data, 'ONWARD');
      const hit = [...analysis.nonStop, ...analysis.connecting]
        .find((o) => (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith(a.airline)));
      sid = hit?.searchId || extractFirstSearchId(s.data);
      if (sid || isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (!sid) {
      console.log('  no searchId');
      continue;
    }

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId) continue;

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
        title: 'Mr', firstName: a.name[0], lastName: `${a.name[1]} ${tag}`,
        gender: 'Male', dob: '1986-09-03', nationality: 'IN',
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
      console.log('  issue fail', brief(issue.data, 180));
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
        return { error: 'INSUFFICIENT_BALANCE', left, onlineSeen };
      }
      continue;
    }

    const { status, bail } = await waitConfirmOrBail(flight, br);
    if (bail || !/confirm/i.test(status)) {
      left.push({ br, status, airline: a.airline });
      continue;
    }

    const detail = await flight.getBookingDetail(br);
    const leg = (detail.data?.bookingResponse?.itinerary || [])[0] || {};
    const online = leg.onlineCancellation;
    console.log('  =>', br, leg.pnr, 'onlineCancellation=', online);

    if (online === true) {
      onlineSeen += 1;
      // leave online bookings alone for this probe (don't burn wallet on cancel unless last attempt)
      if (a !== attempts[attempts.length - 1]) {
        console.log('  online=true — leave BR, try other airline for offline');
        left.push({ br, status, airline: a.airline, online: true, note: 'skipped for offline hunt' });
        continue;
      }
    }

    if (online !== false && online !== 0) {
      table.push({
        rule: 'OFFLINE: found onlineCancellation=false inventory',
        expected: 'at least one Confirmed with onlineCancellation false',
        actual: `last online=${online} onlineSeen=${onlineSeen}`,
        status: 'NOT_TESTED',
      });
      return { found: false, last: { br, pnr: leg.pnr, online }, left, onlineSeen };
    }

    // offline path found
    console.log('\n=== OFFLINE PENALTY/CANCEL', br, leg.pnr);
    const pen = await cancelCall(client, br, {
      action: 'PENALTY', pnr: leg.pnr, cancellationReason: 'offline path',
    });
    console.log('PENALTY', pen.status, brief(pen.data));
    const sPen = scoreQuote('OFFLINE PENALTY', pen, { expectStatusRe: 'Penalty Fetched' });
    table.push(...sPen.rows);

    await sleep(1500);
    const can = await cancelCall(client, br, {
      action: 'CANCEL', pnr: leg.pnr, cancellationReason: 'offline path',
    });
    console.log('CANCEL', can.status, brief(can.data));
    const sCan = scoreQuote('OFFLINE CANCEL', can, { expectStatusRe: 'Cancellation Requested|Cancelled' });
    table.push(...sCan.rows);
    table.push({
      rule: 'OFFLINE: request path (Cancellation Requested expected)',
      expected: 'Cancellation Requested when onlineCancellation=false',
      actual: cr(can).status,
      status: /cancellation requested/i.test(String(cr(can).status || ''))
        ? 'PASS'
        : (/cancelled/i.test(String(cr(can).status || '')) ? 'PASS' : 'BUG'),
    });

    return {
      found: true,
      fixture: { br, pnr: leg.pnr, online, airline: a.airline },
      penalty: sPen.snapshot,
      cancel: sCan.snapshot,
      left,
      onlineSeen,
    };
  }

  table.push({
    rule: 'OFFLINE: found onlineCancellation=false inventory',
    expected: 'Confirmed booking with onlineCancellation false',
    actual: `none; onlineSeen=${onlineSeen}; left=${left.length}`,
    status: 'NOT_TESTED',
  });
  return { found: false, left, onlineSeen };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('S5-complete + offline probe on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const table = [];
  const s5 = await s5Complete(client, flight, table);
  const offline = await tryOffline(flight, client, table);

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
    NOT_TESTED: table.filter((t) => t.status === 'NOT_TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    s5Complete: s5,
    offline,
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
