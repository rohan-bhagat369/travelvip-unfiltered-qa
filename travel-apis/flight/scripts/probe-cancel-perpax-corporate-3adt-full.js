/**
 * CORPORATE OW 3ADT full PNR cancel (no cancellationPaxList)
 * Assert: no PARTIAL_PAX (or full scope), amounts ×3, perPax covers 3
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-corporate-3adt-full.js
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

const OUT = 'reports/cancel-perpax-corporate-3adt-full.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ATTEMPTS = [
  { airline: '6E', o: 'DEL', d: 'BOM', days: 48, names: [['Dev', 'Saxena'], ['Ira', 'Saxena'], ['Om', 'Saxena']] },
  { airline: '6E', o: 'BOM', d: 'DEL', days: 54, names: [['Neil', 'Khurana'], ['Aisha', 'Khurana'], ['Jay', 'Khurana']] },
  { airline: '6E', o: 'HYD', d: 'BOM', days: 59, names: [['Ronit', 'Grewal'], ['Tia', 'Grewal'], ['Avi', 'Grewal']] },
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
  for (const a of ATTEMPTS) {
    console.log(`\nBOOK CORPORATE OW 3ADT ${a.airline} ${a.o}-${a.d} d+${a.days}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: 'CORPORATE', maxStops: 0,
    });
    body.travellers = { adults: 3, children: 0, infants: 0 };
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
        title: i === 1 ? 'Mrs' : 'Mr',
        firstName,
        lastName: `${lastName} ${tag}`,
        gender: i === 1 ? 'Female' : 'Male',
        dob: i === 0 ? '1983-08-08' : i === 1 ? '1987-12-12' : '1991-04-04',
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
    return {
      br, pnr, status, airline: a.airline,
      totalAmount: pricing.data.pricing?.totalAmount,
    };
  }
  return null;
}

function score(label, res) {
  const c = cr(res);
  const scope = env(res).paxScope || null;
  const perPax = c.perPax;
  const totalAmount = num(c.totalAmount);
  const charge = num(c.estimatedCancellationCharge);
  const refund = num(c.estimatedRefund);
  const fee = num(c.cancellationFee);
  const rows = [];

  rows.push({
    rule: `${label}: amounts`,
    expected: 'total/charge/refund numeric',
    actual: `total=${totalAmount} charge=${charge} refund=${refund}`,
    status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: refund math`,
    expected: 'refund = total - charge',
    actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
    status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: no PARTIAL_PAX (full PNR)`,
    expected: 'paxScope absent or not PARTIAL_PAX',
    actual: scope ? brief(scope, 200) : 'absent',
    status: !scope || scope.scope !== 'PARTIAL_PAX' ? 'PASS' : 'BUG',
  });

  let perOk = false;
  let perActual = 'MISSING';
  if (Array.isArray(perPax)) {
    perActual = `len=${perPax.length} ${brief(perPax, 280)}`;
    perOk = perPax.length === 3;
  } else if (perPax && typeof perPax === 'object') {
    perActual = brief(perPax, 280);
    perOk = Number(perPax.chargedPax) === 3 || Number(perPax.paxCount) === 3;
  }
  rows.push({
    rule: `${label}: perPax covers 3 pax`,
    expected: 'array len 3 OR chargedPax/paxCount=3',
    actual: perActual,
    status: perOk ? 'PASS' : 'BUG',
  });

  if (fee != null) {
    rows.push({
      rule: `${label}: cancellationFee × 3 in totals`,
      expected: `fee field ${fee} implies ×3 contribution ${fee} or per-pax 350×3`,
      actual: `cancellationFee=${fee} charge=${charge}`,
      status: fee === 1050 || fee === 350 || (charge != null && charge >= 1050 - 1) ? 'PASS' : 'BUG',
    });
  }

  rows.push({
    rule: `${label}: status`,
    expected: 'Penalty Fetched / Cancelled / Cancellation Requested',
    actual: c.status || res.status,
    status: /penalty fetched|cancelled|cancellation requested/i.test(String(c.status || ''))
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
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('CORPORATE 3ADT full PNR cancel on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await book(flight, client);
  if (!fixture?.br) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_BOOKING' }, null, 2));
    throw new Error('NO_BOOKING');
  }

  console.log('\n=== FULL PNR PENALTY', fixture.br, fixture.pnr);
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY', pnr: fixture.pnr, cancellationReason: '3ADT full',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = score('PENALTY', pen);

  await sleep(1500);
  console.log('\n=== FULL PNR CANCEL');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL', pnr: fixture.pnr, cancellationReason: '3ADT full',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = score('CANCEL', can);

  const after = await flight.getBookingStatus(fixture.br);
  const table = [
    ...sPen.rows,
    ...sCan.rows,
    {
      rule: 'Final booking Cancelled',
      expected: 'Cancelled',
      actual: after.data?.status,
      status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
    },
  ];

  // Compare to known 1-pax unit from prior CORPORATE (849 = 499+350)
  const unit = 849;
  const charge = num(cr(can).estimatedCancellationCharge) ?? num(cr(pen).estimatedCancellationCharge);
  if (charge != null) {
    table.push({
      rule: 'Charge ≈ 3 × single-pax unit (849)',
      expected: `≈ ${unit * 3}`,
      actual: String(charge),
      status: nearly(charge, unit * 3, 50) ? 'PASS' : 'BUG',
    });
  }

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'CORPORATE OW 3ADT full PNR cancel',
    fixture,
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
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
