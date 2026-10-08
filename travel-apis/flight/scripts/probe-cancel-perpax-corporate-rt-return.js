/**
 * P0 S5 — CORPORATE RT cancel return only
 *
 * Inprogress rule (strict): if status is Inprogress after a short poll → LEAVE that BR.
 * Immediately book another with DIFFERENT airline + dates + passenger names.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-corporate-rt-return.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-corporate-rt-return.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ATTEMPTS = [
  { airline: 'SG', o: 'DEL', d: 'BOM', od: 33, rd: 40, names: [['Kabir', 'Saxena'], ['Anvi', 'Saxena']] },
  { airline: '6E', o: 'BOM', d: 'BLR', od: 41, rd: 48, names: [['Yash', 'Kulkarni'], ['Diya', 'Kulkarni']] },
  { airline: 'AI', o: 'DEL', d: 'HYD', od: 50, rd: 57, names: [['Harsh', 'Malhotra'], ['Riya', 'Malhotra']] },
  { airline: 'IX', o: 'BLR', d: 'DEL', od: 36, rd: 44, names: [['Aarav', 'Bose'], ['Kiara', 'Bose']] },
  { airline: 'SG', o: 'HYD', d: 'BOM', od: 55, rd: 62, names: [['Vivek', 'Menon'], ['Sana', 'Menon']] },
  { airline: '6E', o: 'DEL', d: 'MAA', od: 29, rd: 37, names: [['Rohan', 'Pillai'], ['Meera', 'Pillai']] },
  { airline: 'AI', o: 'BOM', d: 'DEL', od: 46, rd: 53, names: [['Nikhil', 'Ahuja'], ['Pooja', 'Ahuja']] },
  { airline: 'IX', o: 'DEL', d: 'BOM', od: 60, rd: 67, names: [['Aditya', 'Ghosh'], ['Naina', 'Ghosh']] },
];

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
function nearly(a, b, tol = 1) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function passengers(names, tag) {
  return names.map(([firstName, lastName], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: {
      title: i === 0 ? 'Mr' : 'Mrs',
      firstName,
      lastName: `${lastName}${tag}`,
      gender: i === 0 ? 'Male' : 'Female',
      dob: i === 0 ? '1987-03-14' : '1991-08-22',
      nationality: 'IN',
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
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

/** Short poll. On Inprogress → return immediately (do NOT keep waiting). */
async function waitConfirmOrBail(flight, br, { maxPending = 4 } = {}) {
  let last = null;
  for (let i = 0; i < maxPending; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return { status: last, bail: false };
    if (/inprogress|in.?progress/i.test(last)) {
      console.log('  Inprogress — LEAVE BR, book another (diff airline/dates/names)');
      return { status: last, bail: true };
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) {
      return { status: last, bail: !/confirm/i.test(last) };
    }
    await sleep(2000);
  }
  // still Pending after short poll — leave and try another
  console.log('  still Pending after short poll — LEAVE BR, try another');
  return { status: last, bail: true };
}

function pickForAirline(analysis, airline) {
  const code = String(airline).toUpperCase();
  const pool = [...analysis.nonStop, ...analysis.connecting];
  const hit = pool.find((o) => (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith(code)));
  return hit || analysis.nonStop[0] || analysis.connecting[0] || null;
}

async function bookCorporateRt(flight, client) {
  const leftBrs = [];

  for (const attempt of ATTEMPTS) {
    const { airline, o, d, od, rd, names } = attempt;
    console.log(`\nBOOK CORPORATE RT 2ADT ${airline} ${o}<->${d} +${od}/+${rd} pax=${names.map((n) => n.join(' ')).join(' / ')}`);

    const body = buildRoundTripSearchBody(od, rd, {
      origin: o, destination: d, fareType: 'CORPORATE', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences.airlines = [airline];

    let onwardOpt = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      const onward = analyzeFlightOptions(s.data, 'ONWARD');
      onwardOpt = pickForAirline(onward, airline);
      console.log(`  onward poll ${i + 1}`, s.data?.progress?.state, 'ns', onward.nonStopCount);
      if (onwardOpt?.searchId || isSearchProgressComplete(s.data)) break;
      await sleep(s.data?.progress?.pollAfterMs || 2000);
    }
    if (!onwardOpt?.searchId) {
      console.log('  no onward — next attempt');
      continue;
    }

    const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
    let returnOpt = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(refined);
      const ret = analyzeFlightOptions(s.data, 'RETURN');
      returnOpt = pickForAirline(ret, airline);
      console.log(`  return poll ${i + 1}`, s.data?.progress?.state, 'ns', ret.nonStopCount);
      if (returnOpt?.searchId || isSearchProgressComplete(s.data)) break;
      await sleep(s.data?.progress?.pollAfterMs || 2000);
    }
    if (!returnOpt?.searchId) {
      console.log('  no return — next attempt');
      continue;
    }

    const searchIds = [onwardOpt.searchId, returnOpt.searchId];
    const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      console.log('  pricing fail', brief(pricing.data, 200));
      continue;
    }
    console.log('  fare', pricing.data.pricing?.totalAmount);

    const tag = Date.now().toString(36).slice(-4);
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: 'ROUND_TRIP',
    });
    payload.data.passengers = passengers(names, tag);
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
      console.log('  issue fail', brief(issue.data, 240));
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
        return { error: 'INSUFFICIENT_BALANCE', details: issue.data, leftBrs };
      }
      continue;
    }

    const { status, bail } = await waitConfirmOrBail(flight, br);
    if (bail || !/confirm/i.test(String(status))) {
      leftBrs.push({ br, status, airline, route: `${o}-${d}`, reason: 'Inprogress/Pending — left' });
      continue;
    }

    const detail = await flight.getBookingDetail(br);
    const itins = detail.data?.bookingResponse?.itinerary || [];
    const onward = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
    const ret = itins.find((l) => /return/i.test(l.direction)) || itins[1];
    console.log('  => Confirmed', br, 'onward', onward?.pnr, 'return', ret?.pnr);

    if (!onward?.pnr || !ret?.pnr) {
      leftBrs.push({ br, status, reason: 'missing PNR' });
      continue;
    }
    if (onward.pnr === ret.pnr) {
      console.log('  same PNR both legs — leave, next');
      leftBrs.push({ br, status, reason: 'shared PNR' });
      continue;
    }

    return {
      br,
      status,
      fareType: 'CORPORATE',
      journeyType: 'ROUND_TRIP',
      airline,
      route: `${o}-${d}`,
      totalAmount: pricing.data.pricing?.totalAmount,
      passengers: payload.data.passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
      leftBrs,
      onward: {
        pnr: onward.pnr,
        onlineCancellation: onward.onlineCancellation,
        airline: onward.segments?.[0]?.airlineCode || onward.segments?.[0]?.airline?.code,
      },
      return: {
        pnr: ret.pnr,
        onlineCancellation: ret.onlineCancellation,
        airline: ret.segments?.[0]?.airlineCode || ret.segments?.[0]?.airline?.code,
      },
    };
  }
  return { error: 'NO_CONFIRMED', leftBrs };
}

function score(label, res, { chargedPax = 2 } = {}) {
  const c = cr(res);
  const scope = env(res).paxScope || null;
  const perPax = c.perPax || null;
  const totalAmount = num(c.totalAmount);
  const charge = num(c.estimatedCancellationCharge);
  const refund = num(c.estimatedRefund);
  const rows = [];

  rows.push({
    rule: `${label}: amounts present`,
    expected: 'totalAmount, charge, refund numeric',
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
    rule: `${label}: perPax present basis!=NONE`,
    expected: `perPax chargedPax=${chargedPax}, penaltyBasis not NONE`,
    actual: perPax ? brief(perPax, 280) : 'MISSING',
    status: perPax
      && (Number(perPax.chargedPax) === chargedPax || Number(perPax.paxCount) === chargedPax)
      && String(perPax.penaltyBasis) !== 'NONE'
      ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: status`,
    expected: 'Penalty Fetched / Cancellation Requested / Cancelled',
    actual: c.status || res.data?.error?.code || res.status,
    status: /penalty fetched|cancellation requested|cancelled/i.test(String(c.status || ''))
      && !/failed|not available/i.test(String(c.status || ''))
      ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: not PARTIAL_PAX (whole return PNR)`,
    expected: 'paxScope absent or not PARTIAL_PAX',
    actual: scope ? brief(scope, 200) : 'absent',
    status: !scope || scope.scope !== 'PARTIAL_PAX' ? 'PASS' : 'BUG',
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
      error: res.data?.error || null,
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('S5 CORPORATE RT return-only cancel on', config.baseUrl);
  console.log('Rule: Inprogress → leave immediately; new airline + dates + names');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookCorporateRt(flight, client);
  if (fixture?.error === 'INSUFFICIENT_BALANCE') {
    fs.writeFileSync(OUT, JSON.stringify({ error: fixture }, null, 2));
    throw new Error('INSUFFICIENT_BALANCE');
  }
  if (!fixture?.br) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_BOOKING', fixture }, null, 2));
    throw new Error('No CORPORATE RT Confirmed booking');
  }

  const onwardPnr = fixture.onward.pnr;
  const returnPnr = fixture.return.pnr;

  console.log('\n=== RETURN-ONLY PENALTY', fixture.br, returnPnr, '(onward', onwardPnr, ')');
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: returnPnr,
    cancellationReason: 'S5 CORPORATE RT return only',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = score('S5 PENALTY return', pen);

  await sleep(1500);
  console.log('\n=== RETURN-ONLY CANCEL');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: returnPnr,
    cancellationReason: 'S5 CORPORATE RT return only',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = score('S5 CANCEL return', can);

  await sleep(2000);
  const after = await flight.getBookingDetail(fixture.br);
  const afterStatus = await flight.getBookingStatus(fixture.br);
  const itins = after.data?.bookingResponse?.itinerary || [];
  const onwardAfter = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
  const returnAfter = itins.find((l) => /return/i.test(l.direction)) || itins[1];

  const table = [
    ...sPen.rows,
    ...sCan.rows,
    {
      rule: 'S5 cancel targeted return PNR only',
      expected: `request pnr=${returnPnr}`,
      actual: `response pnr=${env(can).pnr || 'n/a'}`,
      status: String(env(can).pnr || '') === returnPnr || String(env(pen).pnr || '') === returnPnr
        ? 'PASS' : 'BUG',
    },
    {
      rule: 'S5 onward PNR still present (untouched leg)',
      expected: `onward pnr ${onwardPnr} still on booking`,
      actual: `onward=${onwardAfter?.pnr}`,
      status: onwardAfter?.pnr === onwardPnr ? 'PASS' : 'BUG',
    },
    {
      rule: 'S5 booking not fully wiped',
      expected: 'BR still exists',
      actual: `bookingStatus=${afterStatus.data?.status} legs=${itins.length}`,
      status: after.status === 200 && itins.length >= 1 ? 'PASS' : 'BUG',
    },
  ];

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'S5 CORPORATE RT cancel return only',
    fixture,
    request: { action: 'PENALTY/CANCEL', pnr: returnPnr, cancellationPaxList: null },
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
    after: {
      bookingStatus: afterStatus.data?.status,
      onward: { pnr: onwardAfter?.pnr },
      return: { pnr: returnAfter?.pnr },
    },
    table,
    score: scorecard,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Left BRs (Inprogress/Pending):', fixture.leftBrs || []);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
