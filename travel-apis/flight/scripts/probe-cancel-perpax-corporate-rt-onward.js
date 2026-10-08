/**
 * P0 S4 — CORPORATE RT cancel onward only
 * Book RT → PENALTY+CANCEL using onward PNR only → assert return still live + perPax amounts
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-corporate-rt-onward.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-corporate-rt-onward.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

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

function passengers(tag) {
  const pool = [
    { title: 'Mr', firstName: 'Dev', lastName: 'Nair', gender: 'Male', dob: '1988-06-21' },
    { title: 'Mrs', firstName: 'Isha', lastName: 'Nair', gender: 'Female', dob: '1992-12-05' },
  ];
  return pool.map((p, i) => {
    const prof = buildPassengerProfile({ ...p, lastName: `${p.lastName}${tag}${i + 1}` });
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: prof.title, firstName: prof.firstName, lastName: prof.lastName,
        gender: prof.gender, dob: prof.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  });
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
async function waitConfirm(flight, br, max = 4) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return last;
    if (/inprogress|in.?progress/i.test(last)) {
      console.log('  Inprogress — LEAVE BR immediately');
      return last;
    }
    if (isTerminalBookingStatus(last) && !/pending|progress/i.test(last)) return last;
    await sleep(2000);
  }
  return last;
}

function pickNonStop(analysis) {
  return analysis.nonStop[0] || analysis.connecting[0] || null;
}

async function bookCorporateRt(flight, client) {
  const routes = [
    { o: 'DEL', d: 'BOM' },
    { o: 'BOM', d: 'BLR' },
    { o: 'DEL', d: 'HYD' },
  ];
  const dayPairs = [[28, 35], [35, 42], [40, 48]];
  let nameIdx = 0;

  for (const r of routes) {
    for (const [od, rd] of dayPairs) {
      console.log(`\nBOOK CORPORATE RT 2ADT ${r.o}<->${r.d} +${od}/+${rd}`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: r.o, destination: r.d, fareType: 'CORPORATE', maxStops: 0,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };

      let onwardOpt = null;
      let searchData = null;
      for (let i = 0; i < 12; i += 1) {
        const s = await flight.search(body);
        searchData = s.data;
        const onward = analyzeFlightOptions(s.data, 'ONWARD');
        onwardOpt = pickNonStop(onward);
        console.log(`  onward poll ${i + 1}`, s.data?.progress?.state, 'ns', onward.nonStopCount);
        if (onwardOpt?.searchId || isSearchProgressComplete(s.data)) break;
        await sleep(s.data?.progress?.pollAfterMs || 2500);
      }
      if (!onwardOpt?.searchId) {
        console.log('  no onward');
        continue;
      }

      const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
      let returnOpt = null;
      for (let i = 0; i < 12; i += 1) {
        const s = await flight.search(refined);
        const ret = analyzeFlightOptions(s.data, 'RETURN');
        returnOpt = pickNonStop(ret);
        console.log(`  return poll ${i + 1}`, s.data?.progress?.state, 'ns', ret.nonStopCount);
        if (returnOpt?.searchId || isSearchProgressComplete(s.data)) break;
        await sleep(s.data?.progress?.pollAfterMs || 2500);
      }
      if (!returnOpt?.searchId) {
        console.log('  no return');
        continue;
      }

      const searchIds = [onwardOpt.searchId, returnOpt.searchId];
      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
        console.log('  pricing fail', brief(pricing.data, 220));
        continue;
      }
      console.log('  fare', pricing.data.pricing?.totalAmount, 'gst', pricing.data.addGstInfo);

      const tag = `${Date.now().toString(36).slice(-3)}${nameIdx}`;
      nameIdx += 1;
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds,
        journeyType: 'ROUND_TRIP',
      });
      payload.data.passengers = passengers(tag);
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
        console.log('  issue fail', brief(issue.data, 260));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        }
        continue;
      }

      const status = await waitConfirm(flight, br);
      if (/inprogress|in.?progress/i.test(String(status))) {
        console.log('  Inprogress — leave, retry other names/route');
        continue;
      }
      if (!/confirm/i.test(String(status))) continue;

      const detail = await flight.getBookingDetail(br);
      const itins = detail.data?.bookingResponse?.itinerary || [];
      const onward = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
      const ret = itins.find((l) => /return/i.test(l.direction)) || itins[1];
      console.log('  =>', br, 'onward', onward?.pnr, 'return', ret?.pnr,
        'online', onward?.onlineCancellation, ret?.onlineCancellation);

      if (!onward?.pnr || !ret?.pnr) continue;
      if (onward.pnr === ret.pnr) {
        console.log('  same PNR both legs — skip (need separate onward PNR)');
        continue;
      }

      return {
        br,
        status,
        fareType: 'CORPORATE',
        journeyType: 'ROUND_TRIP',
        route: `${r.o}-${r.d}`,
        totalAmount: pricing.data.pricing?.totalAmount,
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
  }
  return null;
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
    expected: `perPax chargedPax=${chargedPax} (or paxCount), penaltyBasis not NONE`,
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
  // onward-only full pax on that PNR → usually no PARTIAL_PAX paxScope
  rows.push({
    rule: `${label}: not PARTIAL_PAX (whole onward PNR)`,
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
  console.log('S4 CORPORATE RT onward-only cancel on', config.baseUrl);

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

  console.log('\n=== ONWARD-ONLY PENALTY', fixture.br, onwardPnr, '(return', returnPnr, ')');
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: onwardPnr,
    cancellationReason: 'S4 CORPORATE RT onward only',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = score('S4 PENALTY onward', pen);

  await sleep(1500);
  console.log('\n=== ONWARD-ONLY CANCEL');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: onwardPnr,
    cancellationReason: 'S4 CORPORATE RT onward only',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = score('S4 CANCEL onward', can);

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
      rule: 'S4 cancel targeted onward PNR only',
      expected: `request pnr=${onwardPnr}`,
      actual: `response pnr=${env(can).pnr || cr(can).pnr || 'n/a'}`,
      status: String(env(can).pnr || '') === onwardPnr || String(env(pen).pnr || '') === onwardPnr
        ? 'PASS' : 'BUG',
    },
    {
      rule: 'S4 return PNR still present',
      expected: `return pnr ${returnPnr} still on booking`,
      actual: `return=${returnAfter?.pnr} status=${returnAfter?.status || returnAfter?.bookingStatus || 'n/a'}`,
      status: returnAfter?.pnr === returnPnr ? 'PASS' : 'BUG',
    },
    {
      rule: 'S4 booking not fully wiped',
      expected: 'BR still exists; not both legs gone',
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
    scenario: 'S4 CORPORATE RT cancel onward only',
    fixture,
    request: { action: 'PENALTY/CANCEL', pnr: onwardPnr, cancellationPaxList: null },
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
    after: {
      bookingStatus: afterStatus.data?.status,
      onward: { pnr: onwardAfter?.pnr, onlineCancellation: onwardAfter?.onlineCancellation },
      return: { pnr: returnAfter?.pnr, onlineCancellation: returnAfter?.onlineCancellation },
    },
    table,
    score: scorecard,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
