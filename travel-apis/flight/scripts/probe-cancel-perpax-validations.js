/**
 * Cancel validation / negatives (§8 must-not-break)
 * Uses one Confirmed OW fixture + optional "already in progress" BR.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-validations.js
 *   FIXTURE_BR=BRxxx  (optional existing Confirmed)
 *   INPROGRESS_BR=BRyyy (optional BR with pending cancel)
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

const OUT = 'reports/cancel-perpax-validations.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function errOf(r) {
  return r?.data?.error || null;
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
  return { status: last, bail: true };
}

async function bookFresh(flight, client) {
  const attempts = [
    { airline: '6E', o: 'DEL', d: 'BOM', days: 43, name: ['Laksh', 'Mehra'] },
    { airline: '6E', o: 'BOM', d: 'BLR', days: 49, name: ['Ayaan', 'Khanna'] },
    { airline: 'SG', o: 'DEL', d: 'HYD', days: 55, name: ['Devansh', 'Gill'] },
  ];
  for (const a of attempts) {
    console.log(`\nBOOK NORMAL OW 1ADT ${a.airline} ${a.o}-${a.d} d+${a.days}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: 'NORMAL', maxStops: 0,
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
    if (!sid) continue;

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
        gender: 'Male', dob: '1989-06-18', nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    }];
    if (pricing.data.addGstInfo === true) {
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
    return { br, pnr, status, airline: a.airline };
  }
  return null;
}

async function loadExisting(flight, br) {
  const st = await flight.getBookingStatus(br);
  const det = await flight.getBookingDetail(br);
  const pnr = (det.data?.bookingResponse?.itinerary || [])[0]?.pnr;
  return {
    br,
    pnr,
    status: det.data?.status || st.data?.status,
  };
}

function scoreCase(id, res, { expectHttp, expectCode, expectOkStatus }) {
  const err = errOf(res);
  const status = env(res).cancellationRequest?.status || null;
  const rows = [];

  if (expectOkStatus) {
    rows.push({
      rule: `${id}: success status`,
      expected: expectOkStatus,
      actual: status || brief(res.data, 180),
      status: new RegExp(expectOkStatus, 'i').test(String(status || '')) ? 'PASS' : 'BUG',
    });
  } else {
    rows.push({
      rule: `${id}: HTTP`,
      expected: String(expectHttp),
      actual: String(res.status),
      status: Number(res.status) === Number(expectHttp) ? 'PASS' : 'BUG',
    });
    rows.push({
      rule: `${id}: error.code`,
      expected: expectCode,
      actual: err?.code || status || 'none',
      status: err?.code === expectCode
        || (expectCode === 'ANY_ERROR' && (err?.code || /fail|not available|invalid/i.test(String(status || ''))))
        ? 'PASS' : 'BUG',
    });
  }

  return {
    rows,
    snapshot: {
      http: res.status,
      error: err,
      status,
      message: err?.message || env(res).cancellationRequest?.message || null,
      raw: brief(res.data, 600),
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Cancel validations on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  let fixture = null;
  if (process.env.FIXTURE_BR) {
    fixture = await loadExisting(flight, process.env.FIXTURE_BR);
  } else {
    fixture = await bookFresh(flight, client);
  }
  if (!fixture?.br || !fixture?.pnr) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_FIXTURE', fixture }, null, 2));
    throw new Error('No Confirmed fixture');
  }
  console.log('Fixture', fixture);

  const table = [];
  const cases = [];

  // V1 invalid pax
  {
    console.log('\n=== V1 invalid paxId');
    const res = await cancelCall(client, fixture.br, {
      action: 'PENALTY', pnr: fixture.pnr, cancellationPaxList: ['PAX99'],
      cancellationReason: 'V1',
    });
    console.log(res.status, brief(res.data, 300));
    const s = scoreCase('V1 invalid pax', res, {
      expectHttp: 400,
      expectCode: 'ANY_ERROR', // VALIDATION_ERROR or similar
    });
    // also accept 200 with failed/not available / invalid in body
    if (s.rows.every((r) => r.status === 'BUG') && res.status === 200) {
      const st = env(res).cancellationRequest?.status || '';
      const msg = JSON.stringify(res.data || {});
      const ok = /fail|not available|invalid|not found|unknown/i.test(st + msg)
        || errOf(res)?.code;
      s.rows.push({
        rule: 'V1 invalid pax: rejected in body if HTTP 200',
        expected: 'error or failed/invalid status',
        actual: brief(res.data, 220),
        status: ok ? 'PASS' : 'BUG',
      });
      // soften HTTP row if body rejected
      if (ok) s.rows[0].status = 'PASS';
    }
    table.push(...s.rows);
    cases.push({ id: 'V1', ...s.snapshot });
  }

  // V2 empty pax list
  {
    console.log('\n=== V2 empty cancellationPaxList');
    const res = await cancelCall(client, fixture.br, {
      action: 'PENALTY', pnr: fixture.pnr, cancellationPaxList: [],
      cancellationReason: 'V2',
    });
    console.log(res.status, brief(res.data, 300));
    // empty list may mean full PNR — document actual
    const s = scoreCase('V2 empty paxList', res, {
      expectOkStatus: 'Penalty Fetched|Penalty Check Failed|Cancellation',
    });
    // reclassify: either validation error OR treated as full PNR quote
    const err = errOf(res);
    const st = env(res).cancellationRequest?.status;
    const acceptable = Boolean(err?.code)
      || /penalty fetched|penalty check failed|not available/i.test(String(st || ''));
    table.push({
      rule: 'V2 empty paxList: deterministic (validate OR full-PNR quote)',
      expected: 'VALIDATION_ERROR or full-PNR Penalty Fetched/Failed',
      actual: err?.code || st || res.status,
      status: acceptable ? 'PASS' : 'BUG',
    });
    cases.push({ id: 'V2', http: res.status, error: err, status: st, raw: brief(res.data, 400) });
  }

  // V3 bad PNR
  {
    console.log('\n=== V3 unknown PNR');
    const res = await cancelCall(client, fixture.br, {
      action: 'PENALTY', pnr: 'ZZZZZZ', cancellationReason: 'V3',
    });
    console.log(res.status, brief(res.data, 300));
    const err = errOf(res);
    const st = env(res).cancellationRequest?.status;
    const ok = res.status >= 400
      || Boolean(err?.code)
      || /fail|not found|invalid|not available/i.test(String(st || '') + JSON.stringify(res.data || {}));
    table.push({
      rule: 'V3 unknown PNR rejected',
      expected: '4xx error.code or failed status',
      actual: `${res.status} ${err?.code || st || brief(res.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.push({ id: 'V3', http: res.status, error: err, status: st, raw: brief(res.data, 400) });
  }

  // V4 unknown BR
  {
    console.log('\n=== V4 unknown BR');
    const res = await cancelCall(client, 'BR0000000000000000', {
      action: 'PENALTY', pnr: fixture.pnr, cancellationReason: 'V4',
    });
    console.log(res.status, brief(res.data, 300));
    const err = errOf(res);
    const ok = res.status >= 400 || Boolean(err?.code);
    table.push({
      rule: 'V4 unknown BR rejected',
      expected: '4xx + error.code (NOT_FOUND / etc)',
      actual: `${res.status} ${err?.code || brief(res.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.push({ id: 'V4', http: res.status, error: err, raw: brief(res.data, 400) });
  }

  // V5 already-in-progress (optional env or prior sequential BR)
  const inprogBr = process.env.INPROGRESS_BR || 'BR1786570951120374';
  {
    console.log('\n=== V5 already in progress', inprogBr);
    try {
      const ip = await loadExisting(flight, inprogBr);
      const pnr = ip.pnr || fixture.pnr;
      const res = await cancelCall(client, inprogBr, {
        action: 'PENALTY',
        pnr,
        cancellationPaxList: ['PAX1'],
        cancellationReason: 'V5',
      });
      console.log(res.status, brief(res.data, 300));
      const err = errOf(res);
      const ok = err?.code === 'CANCELLATION_ALREADY_IN_PROGRESS'
        || /already|in progress|pending/i.test(JSON.stringify(res.data || {}));
      table.push({
        rule: 'V5 already-in-progress guarded',
        expected: 'CANCELLATION_ALREADY_IN_PROGRESS (or clear already/pending message)',
        actual: `${res.status} ${err?.code || brief(res.data, 180)}`,
        status: ok ? 'PASS' : 'BUG',
      });
      cases.push({ id: 'V5', br: inprogBr, http: res.status, error: err, raw: brief(res.data, 400) });
    } catch (e) {
      table.push({
        rule: 'V5 already-in-progress guarded',
        expected: 'testable BR',
        actual: e.message,
        status: 'NOT_TESTED',
      });
    }
  }

  // V6 valid baseline still works on fresh fixture (sanity)
  {
    console.log('\n=== V6 valid PENALTY baseline');
    const res = await cancelCall(client, fixture.br, {
      action: 'PENALTY', pnr: fixture.pnr, cancellationReason: 'V6',
    });
    console.log(res.status, brief(res.data, 300));
    const st = env(res).cancellationRequest?.status;
    table.push({
      rule: 'V6 valid PENALTY still works after negatives',
      expected: 'Penalty Fetched (or provider failed with envelope)',
      actual: st || errOf(res)?.code || res.status,
      status: /penalty fetched|penalty check failed/i.test(String(st || '')) ? 'PASS' : 'BUG',
    });
    cases.push({ id: 'V6', http: res.status, status: st, raw: brief(res.data, 400) });
  }

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
    NOT_TESTED: table.filter((t) => t.status === 'NOT_TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'Cancel validation / negatives',
    fixture,
    cases,
    table,
    score: scorecard,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule.slice(0, 60) })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
