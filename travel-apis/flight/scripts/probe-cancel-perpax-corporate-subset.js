/**
 * CORPORATE retest — subset per-pax cancel quote (amounts / perPax)
 *
 * Book OW CORPORATE 2ADT → PENALTY+CANCEL with cancellationPaxList=[PAX1]
 * Score: paxScope + estimated* + perPax (penaltyBasis != NONE)
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-corporate-subset.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  isTerminalBookingStatus,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-corporate-subset.json';
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
function cancelReq(r) {
  return env(r).cancellationRequest || {};
}
function paxScope(r) {
  return env(r).paxScope || null;
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

function passengers(n, tag) {
  const pool = [
    { title: 'Mr', firstName: 'Vikram', lastName: 'Mehta', gender: 'Male', dob: '1987-03-14' },
    { title: 'Mrs', firstName: 'Neha', lastName: 'Mehta', gender: 'Female', dob: '1991-11-22' },
  ];
  return pool.slice(0, n).map((p, i) => {
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

async function waitConfirm(flight, br, max = 12) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return last;
    if (isTerminalBookingStatus(last) && !/pending|progress/i.test(last)) return last;
    await sleep(2500);
  }
  return last;
}

async function bookCorporateOw2(flight, client) {
  const routes = [
    { o: 'DEL', d: 'BOM' },
    { o: 'BOM', d: 'DEL' },
    { o: 'BLR', d: 'DEL' },
    { o: 'DEL', d: 'HYD' },
    { o: 'BLR', d: 'SXV' },
  ];
  const dayList = [28, 35, 42, 50, 60];

  for (const r of routes) {
    for (const days of dayList) {
      console.log(`\nBOOK CORPORATE OW 2ADT ${r.o}-${r.d} d+${days}`);
      const body = buildOneWaySearchBody(days, {
        origin: r.o, destination: r.d, fareType: 'CORPORATE', maxStops: 0,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };

      let sid = null;
      for (let i = 0; i < 10; i += 1) {
        const s = await flight.search(body);
        sid = extractFirstSearchId(s.data);
        if (sid || isSearchProgressComplete(s.data)) break;
        await sleep(2000);
      }
      if (!sid) {
        console.log('  no searchId');
        continue;
      }

      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data, 220));
        continue;
      }

      const addGst = pricing.data.addGstInfo === true || pricing.data.pricing?.addGstInfo === true;
      const fareTypeActual = pricing.data.fareType
        || pricing.data.pricing?.fareType
        || pricing.data.bookingContext?.fareType
        || 'CORPORATE';
      console.log('  priced', pricing.data.pricing?.totalAmount, 'addGst', addGst, 'fare', fareTypeActual);

      const tag = Date.now().toString(36).slice(-4);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = passengers(2, tag);
      // CORPORATE usually needs GST
      if (addGst || true) {
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
        console.log('  issue fail', brief(issue.data, 280));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        }
        continue;
      }

      const status = await waitConfirm(flight, br);
      if (/inprogress|in.?progress/i.test(String(status))) {
        console.log('  Inprogress — leave BR, try new names/route');
        continue;
      }

      const detail = await flight.getBookingDetail(br);
      const leg = (detail.data?.bookingResponse?.itinerary || [])[0] || {};
      const pnr = leg.pnr || null;
      const online = leg.onlineCancellation;
      console.log('  =>', br, status, 'pnr', pnr, 'online', online);

      if (!/confirm/i.test(String(status)) || !pnr) continue;

      return {
        br,
        status,
        pnr,
        onlineCancellation: online,
        adults: 2,
        route: `${r.o}-${r.d}`,
        days,
        fareType: 'CORPORATE',
        totalAmount: pricing.data.pricing?.totalAmount,
        addGstInfo: addGst,
        passengers: ['PAX1', 'PAX2'],
      };
    }
  }
  return null;
}

function score(label, res) {
  const cr = cancelReq(res);
  const scope = paxScope(res);
  const perPax = cr.perPax || null;
  const totalAmount = num(cr.totalAmount);
  const charge = num(cr.estimatedCancellationCharge);
  const refund = num(cr.estimatedRefund);
  const rows = [];

  rows.push({
    rule: `${label}: paxScope PARTIAL_PAX + quotable`,
    expected: 'scope=PARTIAL_PAX cancelledPaxCount=1 totalPaxOnPnr=2 penaltyQuotable=true',
    actual: scope ? brief(scope, 280) : 'MISSING',
    status: scope?.scope === 'PARTIAL_PAX'
      && Number(scope.cancelledPaxCount) === 1
      && Number(scope.totalPaxOnPnr) === 2
      && scope.penaltyQuotable === true
      ? 'PASS' : 'BUG',
  });

  rows.push({
    rule: `${label}: amounts present`,
    expected: 'totalAmount, estimatedCancellationCharge, estimatedRefund all numeric',
    actual: `total=${totalAmount} charge=${charge} refund=${refund} msg=${cr.message || ''}`,
    status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
  });

  rows.push({
    rule: `${label}: refund = total − charge`,
    expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
    actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
    status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
  });

  rows.push({
    rule: `${label}: perPax present with chargedPax=1`,
    expected: 'perPax.chargedPax=1 (or paxCount=1), penaltyBasis != NONE',
    actual: perPax ? brief(perPax, 280) : 'MISSING',
    status: perPax
      && (Number(perPax.chargedPax) === 1 || Number(perPax.paxCount) === 1)
      && String(perPax.penaltyBasis || scope?.penaltyBasis || '') !== 'NONE'
      ? 'PASS' : 'BUG',
  });

  rows.push({
    rule: `${label}: status not Failed / Not Available`,
    expected: 'Penalty Fetched / Cancellation Requested / Cancelled',
    actual: cr.status || res.data?.error?.code || res.status,
    status: /penalty fetched|cancellation requested|cancelled/i.test(String(cr.status || ''))
      && !/not available|failed/i.test(String(cr.status || ''))
      ? 'PASS' : 'BUG',
  });

  return {
    rows,
    snapshot: {
      http: res.status,
      raw: env(res),
      status: cr.status,
      totalAmount,
      estimatedCancellationCharge: charge,
      estimatedRefund: refund,
      perPax,
      paxScope: scope,
      message: cr.message || null,
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('CORPORATE subset cancel quote on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookCorporateOw2(flight, client);
  if (fixture?.error === 'INSUFFICIENT_BALANCE') {
    fs.writeFileSync(OUT, JSON.stringify({ error: fixture }, null, 2));
    throw new Error('INSUFFICIENT_BALANCE');
  }
  if (!fixture?.br) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_CORPORATE_BOOKING', fixture }, null, 2));
    throw new Error('No CORPORATE Confirmed booking');
  }

  console.log('\n=== SUBSET PENALTY PAX1', fixture.br, fixture.pnr);
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX1'],
    cancellationReason: 'CORPORATE subset P0',
  });
  console.log('PENALTY', pen.status, brief(pen.data, 700));
  const sPen = score('CORP PENALTY subset', pen);

  await sleep(1500);
  console.log('\n=== SUBSET CANCEL PAX1');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX1'],
    cancellationReason: 'CORPORATE subset P0',
  });
  console.log('CANCEL', can.status, brief(can.data, 700));
  const sCan = score('CORP CANCEL subset', can);

  const table = [...sPen.rows, ...sCan.rows];
  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
    NOT_TESTED: table.filter((t) => t.status === 'NOT_TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fareType: 'CORPORATE',
    fixture,
    request: {
      penalty: { action: 'PENALTY', pnr: fixture.pnr, cancellationPaxList: ['PAX1'] },
      cancel: { action: 'CANCEL', pnr: fixture.pnr, cancellationPaxList: ['PAX1'] },
    },
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
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
