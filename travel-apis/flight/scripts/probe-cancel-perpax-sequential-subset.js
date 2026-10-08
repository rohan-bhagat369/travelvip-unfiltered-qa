/**
 * Next case: sequential subset cancel — PAX1 then remaining PAX2
 * Book OW 2ADT → PENALTY+CANCEL [PAX1] → PENALTY+CANCEL [PAX2]
 * Assert: each step chargedPax=1, amounts present, PARTIAL then last pax
 *
 * Inprogress → leave; next = different airline/dates/names
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-sequential-subset.js
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

const OUT = 'reports/cancel-perpax-sequential-subset.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ATTEMPTS = [
  { airline: '6E', o: 'DEL', d: 'BOM', days: 40, fareType: 'CORPORATE', names: [['Arnav', 'Kapoor'], ['Isha', 'Kapoor']] },
  { airline: '6E', o: 'BOM', d: 'HYD', days: 47, fareType: 'NORMAL', names: [['Reyansh', 'Bhat'], ['Anaya', 'Bhat']] },
  { airline: 'SG', o: 'DEL', d: 'BLR', days: 52, fareType: 'NORMAL', names: [['Vihaan', 'Seth'], ['Myra', 'Seth']] },
  { airline: '6E', o: 'BLR', d: 'DEL', days: 36, fareType: 'CORPORATE', names: [['Kabir', 'Lal'], ['Zara', 'Lal']] },
];

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
  for (let i = 0; i < 4; i += 1) {
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

function pickAirline(analysis, airline) {
  const code = String(airline).toUpperCase();
  const pool = [...analysis.nonStop, ...analysis.connecting];
  return pool.find((o) => (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith(code)))
    || analysis.nonStop[0]
    || null;
}

async function book(flight, client) {
  const left = [];
  for (const a of ATTEMPTS) {
    console.log(`\nBOOK ${a.fareType} OW 2ADT ${a.airline} ${a.o}-${a.d} d+${a.days}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: a.fareType, maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences.airlines = [a.airline];

    let sid = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      const analysis = analyzeFlightOptions(s.data, 'ONWARD');
      sid = pickAirline(analysis, a.airline)?.searchId || extractFirstSearchId(s.data);
      console.log('  search', i + 1, s.data?.progress?.state, !!sid);
      if (sid || isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (!sid) continue;

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId) {
      console.log('  pricing fail', brief(pricing.data, 180));
      continue;
    }
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
        dob: i === 0 ? '1987-04-11' : '1990-11-19',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    }));
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
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
        return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
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
    if (!leg.pnr) {
      left.push({ br, status, reason: 'no pnr' });
      continue;
    }
    console.log('  =>', br, leg.pnr, 'online', leg.onlineCancellation);
    return {
      br,
      pnr: leg.pnr,
      status,
      airline: a.airline,
      fareType: a.fareType,
      route: `${a.o}-${a.d}`,
      totalAmount: pricing.data.pricing?.totalAmount,
      onlineCancellation: leg.onlineCancellation,
      left,
    };
  }
  return { error: 'NO_BOOKING', left };
}

function score(label, res, { cancelPax, totalOnPnr }) {
  const c = cr(res);
  const scope = env(res).paxScope || null;
  const perPax = c.perPax || null;
  const totalAmount = num(c.totalAmount);
  const charge = num(c.estimatedCancellationCharge);
  const refund = num(c.estimatedRefund);
  const rows = [];
  const err = res.data?.error;

  if (err) {
    rows.push({
      rule: `${label}: no hard error`,
      expected: 'success cancel/penalty envelope',
      actual: `${err.code}: ${err.message}`,
      status: 'BUG',
    });
    return { rows, snapshot: { http: res.status, error: err, raw: env(res) } };
  }

  rows.push({
    rule: `${label}: amounts present`,
    expected: 'total, charge, refund numeric',
    actual: `total=${totalAmount} charge=${charge} refund=${refund} msg=${c.message || ''}`,
    status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: refund = total − charge`,
    expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
    actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
    status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: perPax chargedPax=1 basis!=NONE`,
    expected: 'chargedPax=1, penaltyBasis not NONE',
    actual: perPax ? brief(perPax, 260) : 'MISSING',
    status: perPax
      && (Number(perPax.chargedPax) === 1 || Number(perPax.paxCount) === 1)
      && String(perPax.penaltyBasis) !== 'NONE'
      ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: paxScope PARTIAL_PAX`,
    expected: `PARTIAL_PAX cancelledPaxCount=1 list=[${cancelPax}] totalOnPnr=${totalOnPnr}`,
    actual: scope ? brief(scope, 260) : 'MISSING',
    status: scope?.scope === 'PARTIAL_PAX'
      && Number(scope.cancelledPaxCount) === 1
      && Array.isArray(scope.cancellationPaxList)
      && scope.cancellationPaxList.includes(cancelPax)
      ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: status OK`,
    expected: 'Penalty Fetched / Cancellation Requested / Cancelled',
    actual: c.status || res.status,
    status: /penalty fetched|cancellation requested|cancelled/i.test(String(c.status || ''))
      && !/failed|not available/i.test(String(c.status || ''))
      ? 'PASS' : 'BUG',
  });

  return {
    rows,
    snapshot: {
      http: res.status,
      raw: env(res),
      status: c.status,
      totalAmount,
      charge,
      refund,
      perPax,
      paxScope: scope,
      message: c.message || null,
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Sequential subset cancel on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await book(flight, client);
  if (fixture?.error) {
    fs.writeFileSync(OUT, JSON.stringify({ error: fixture }, null, 2));
    throw new Error(fixture.error);
  }

  const steps = [];
  const table = [];

  for (const pax of ['PAX1', 'PAX2']) {
    console.log(`\n=== PENALTY ${pax}`);
    const pen = await cancelCall(client, fixture.br, {
      action: 'PENALTY',
      pnr: fixture.pnr,
      cancellationPaxList: [pax],
      cancellationReason: `seq ${pax}`,
    });
    console.log('PENALTY', pen.status, brief(pen.data));
    const sPen = score(`${pax} PENALTY`, pen, { cancelPax: pax, totalOnPnr: 2 });
    table.push(...sPen.rows);

    await sleep(1500);
    console.log(`=== CANCEL ${pax}`);
    const can = await cancelCall(client, fixture.br, {
      action: 'CANCEL',
      pnr: fixture.pnr,
      cancellationPaxList: [pax],
      cancellationReason: `seq ${pax}`,
    });
    console.log('CANCEL', can.status, brief(can.data));
    const sCan = score(`${pax} CANCEL`, can, { cancelPax: pax, totalOnPnr: 2 });
    table.push(...sCan.rows);

    steps.push({ pax, penalty: sPen.snapshot, cancel: sCan.snapshot });
    await sleep(2000);
  }

  const after = await flight.getBookingStatus(fixture.br);
  table.push({
    rule: 'Final booking status cancelled / partial',
    expected: 'Cancelled or Partially cancelled',
    actual: after.data?.status,
    status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
  });

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'Sequential subset cancel PAX1 then PAX2',
    fixture,
    steps,
    afterStatus: after.data?.status,
    table,
    score: scorecard,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule.slice(0, 55) })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
