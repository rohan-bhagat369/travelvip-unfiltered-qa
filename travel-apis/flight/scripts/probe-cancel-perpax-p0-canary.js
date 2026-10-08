/**
 * P0 smoke — per-passenger cancel charges (post-deploy)
 *
 *   S1: OW 1ADT full PENALTY → CANCEL
 *   S2: OW 2ADT subset PENALTY → CANCEL (cancellationPaxList=[PAX1])
 *   S3: OW 2ADT full PNR CANCEL (no paxList)
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-p0-canary.js
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

const OUT = 'reports/cancel-perpax-p0-canary.json';
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
function cancelEnvelope(r) {
  return r?.data?.data || r?.data || {};
}
function cancelReq(r) {
  return cancelEnvelope(r).cancellationRequest || {};
}
function paxScope(r) {
  return cancelEnvelope(r).paxScope || null;
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
    { title: 'Mr', firstName: 'Kabir', lastName: 'Singh', gender: 'Male', dob: '1988-05-12' },
    { title: 'Mrs', firstName: 'Ananya', lastName: 'Singh', gender: 'Female', dob: '1990-10-03' },
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

async function waitConfirm(flight, br, max = 10) {
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

async function bookOw(flight, client, adults) {
  const routes = [
    { o: 'DEL', d: 'BOM' },
    { o: 'BOM', d: 'BLR' },
    { o: 'DEL', d: 'HYD' },
  ];
  for (const r of routes) {
    for (const days of [25, 32, 40]) {
      console.log(`\nBOOK OW ${adults}ADT ${r.o}-${r.d} d+${days}`);
      const body = buildOneWaySearchBody(days, {
        origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults, children: 0, infants: 0 };

      let searchData = null;
      let sid = null;
      for (let i = 0; i < 8; i += 1) {
        const s = await flight.search(body);
        searchData = s.data;
        sid = extractFirstSearchId(s.data);
        if (sid || isSearchProgressComplete(s.data)) break;
        await sleep(2000);
      }
      if (!sid) continue;

      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data, 200));
        continue;
      }

      const tag = Date.now().toString(36).slice(-4);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = passengers(adults, tag);
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
        console.log('  issue fail', brief(issue.data, 250));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        }
        continue;
      }

      const status = await waitConfirm(flight, br);
      const detail = await flight.getBookingDetail(br);
      const leg = (detail.data?.bookingResponse?.itinerary || [])[0] || {};
      const pnr = leg.pnr || null;
      const online = leg.onlineCancellation;
      console.log('  =>', br, status, 'pnr', pnr, 'online', online, 'fare', pricing.data.pricing?.totalAmount);

      if (!/confirm/i.test(String(status)) || !pnr) {
        console.log('  not usable');
        continue;
      }
      return {
        br,
        status,
        pnr,
        onlineCancellation: online,
        adults,
        route: `${r.o}-${r.d}`,
        totalAmount: pricing.data.pricing?.totalAmount,
        passengers: payload.data.passengers.map((p) => p.paxId),
      };
    }
  }
  return null;
}

function scoreQuote(label, res, { expectPaxScope, chargedPax, totalPaxOnPnr }) {
  const cr = cancelReq(res);
  const scope = paxScope(res);
  const perPax = cr.perPax || null;
  const totalAmount = num(cr.totalAmount);
  const totalPenalty = num(cr.totalPenalty);
  const charge = num(cr.estimatedCancellationCharge);
  const refund = num(cr.estimatedRefund);
  const rows = [];

  const reconcile = nearly(refund, (totalAmount ?? 0) - (charge ?? 0));
  rows.push({
    rule: `${label}: refund = totalAmount − charge`,
    expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
    actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
    status: reconcile ? 'PASS' : (refund == null ? 'NOT_READY' : 'BUG'),
  });

  rows.push({
    rule: `${label}: perPax block present`,
    expected: 'cancellationRequest.perPax object with penalty/cancellationFee/refund',
    actual: perPax ? brief(perPax, 220) : 'MISSING',
    status: perPax ? 'PASS' : 'BUG',
  });

  if (perPax && chargedPax != null) {
    const product = num(perPax.refund) != null ? Number(perPax.refund) * chargedPax : null;
    rows.push({
      rule: `${label}: perPax.refund × chargedPax ≈ estimatedRefund`,
      expected: `≈ ${refund}`,
      actual: `${perPax.refund} × ${chargedPax} = ${product}`,
      status: nearly(product, refund, 2) ? 'PASS' : 'BUG',
    });
    rows.push({
      rule: `${label}: perPax.chargedPax / paxCount`,
      expected: `chargedPax=${chargedPax}`,
      actual: `chargedPax=${perPax.chargedPax} paxCount=${perPax.paxCount} basis=${perPax.penaltyBasis}`,
      status: Number(perPax.chargedPax) === chargedPax || Number(perPax.paxCount) === chargedPax
        ? 'PASS' : 'BUG',
    });
  }

  if (expectPaxScope) {
    rows.push({
      rule: `${label}: paxScope PARTIAL_PAX`,
      expected: `scope=PARTIAL_PAX cancelledPaxCount=${chargedPax} totalPaxOnPnr=${totalPaxOnPnr} penaltyQuotable=true`,
      actual: scope ? brief(scope, 260) : 'MISSING',
      status: scope?.scope === 'PARTIAL_PAX'
        && Number(scope.cancelledPaxCount) === chargedPax
        && scope.penaltyQuotable === true
        ? 'PASS' : 'BUG',
    });
  } else {
    rows.push({
      rule: `${label}: paxScope absent (whole PNR)`,
      expected: 'no paxScope block',
      actual: scope ? brief(scope, 200) : 'absent',
      status: scope == null ? 'PASS' : 'BUG',
    });
  }

  rows.push({
    rule: `${label}: cancel status`,
    expected: 'Penalty Fetched / Cancellation Requested / Cancelled (not Failed / Not Available)',
    actual: cr.status || res.data?.error?.code || res.status,
    status: /penalty fetched|cancellation requested|cancelled/i.test(String(cr.status || ''))
      && !/not available|failed/i.test(String(cr.status || ''))
      ? 'PASS' : 'BUG',
  });

  return {
    rows,
    snapshot: {
      http: res.status,
      status: cr.status,
      totalAmount,
      totalPenalty,
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
  console.log('P0 per-pax cancel on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const results = [];
  const table = [];

  // --- Book fixtures ---
  const b1 = await bookOw(flight, client, 1);
  if (b1?.error === 'INSUFFICIENT_BALANCE') {
    fs.writeFileSync(OUT, JSON.stringify({ error: b1 }, null, 2));
    throw new Error('INSUFFICIENT_BALANCE');
  }
  const b2subset = await bookOw(flight, client, 2);
  const b2full = await bookOw(flight, client, 2);

  // ===== S1: 1ADT full =====
  if (b1?.br && b1.pnr) {
    console.log('\n=== S1 1ADT full PENALTY→CANCEL', b1.br, b1.pnr);
    const pen = await cancelCall(client, b1.br, {
      action: 'PENALTY', pnr: b1.pnr, cancellationReason: 'P0 S1',
    });
    console.log('PENALTY', pen.status, cancelReq(pen).status, brief(pen.data, 400));
    const sPen = scoreQuote('S1 PENALTY', pen, { expectPaxScope: false, chargedPax: 1, totalPaxOnPnr: 1 });
    table.push(...sPen.rows);

    await sleep(1500);
    const can = await cancelCall(client, b1.br, {
      action: 'CANCEL', pnr: b1.pnr, cancellationReason: 'P0 S1',
    });
    console.log('CANCEL', can.status, cancelReq(can).status, brief(can.data, 400));
    const sCan = scoreQuote('S1 CANCEL', can, { expectPaxScope: false, chargedPax: 1, totalPaxOnPnr: 1 });
    table.push(...sCan.rows);

    const after = await flight.getBookingStatus(b1.br);
    table.push({
      rule: 'S1 final booking status',
      expected: 'Cancelled or Cancellation Requested',
      actual: after.data?.status,
      status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
    });

    results.push({ id: 'S1', fixture: b1, penalty: sPen.snapshot, cancel: sCan.snapshot, after: after.data?.status });
  } else {
    table.push({ rule: 'S1 book 1ADT', expected: 'Confirmed+PNR', actual: brief(b1), status: 'NOT_TESTED' });
  }

  // ===== S2: 2ADT subset =====
  if (b2subset?.br && b2subset.pnr) {
    console.log('\n=== S2 2ADT subset PENALTY→CANCEL', b2subset.br, b2subset.pnr);
    const pen = await cancelCall(client, b2subset.br, {
      action: 'PENALTY',
      pnr: b2subset.pnr,
      cancellationPaxList: ['PAX1'],
      cancellationReason: 'P0 S2',
    });
    console.log('PENALTY', pen.status, cancelReq(pen).status, brief(pen.data, 500));
    const sPen = scoreQuote('S2 PENALTY subset', pen, {
      expectPaxScope: true, chargedPax: 1, totalPaxOnPnr: 2,
    });
    // R4: must NOT be "Penalty Not Available"
    const st = String(cancelReq(pen).status || '');
    table.push({
      rule: 'S2/R4 subset PENALTY quotable (was refused before)',
      expected: 'Penalty Fetched with amounts + penaltyQuotable=true',
      actual: `${st} ${brief(paxScope(pen), 180)}`,
      status: /penalty fetched/i.test(st) && paxScope(pen)?.penaltyQuotable === true ? 'PASS' : 'BUG',
    });
    table.push(...sPen.rows);

    await sleep(1500);
    const can = await cancelCall(client, b2subset.br, {
      action: 'CANCEL',
      pnr: b2subset.pnr,
      cancellationPaxList: ['PAX1'],
      cancellationReason: 'P0 S2',
    });
    console.log('CANCEL', can.status, cancelReq(can).status, brief(can.data, 500));
    const sCan = scoreQuote('S2 CANCEL subset', can, {
      expectPaxScope: true, chargedPax: 1, totalPaxOnPnr: 2,
    });
    table.push(...sCan.rows);

    results.push({ id: 'S2', fixture: b2subset, penalty: sPen.snapshot, cancel: sCan.snapshot });
  } else {
    table.push({ rule: 'S2 book 2ADT', expected: 'Confirmed+PNR', actual: brief(b2subset), status: 'NOT_TESTED' });
  }

  // ===== S3: 2ADT full PNR =====
  if (b2full?.br && b2full.pnr) {
    console.log('\n=== S3 2ADT full PNR PENALTY→CANCEL', b2full.br, b2full.pnr);
    const pen = await cancelCall(client, b2full.br, {
      action: 'PENALTY', pnr: b2full.pnr, cancellationReason: 'P0 S3',
    });
    console.log('PENALTY', pen.status, cancelReq(pen).status, brief(pen.data, 500));
    const sPen = scoreQuote('S3 PENALTY full', pen, {
      expectPaxScope: false, chargedPax: 2, totalPaxOnPnr: 2,
    });
    table.push(...sPen.rows);

    await sleep(1500);
    const can = await cancelCall(client, b2full.br, {
      action: 'CANCEL', pnr: b2full.pnr, cancellationReason: 'P0 S3',
    });
    console.log('CANCEL', can.status, cancelReq(can).status, brief(can.data, 500));
    const sCan = scoreQuote('S3 CANCEL full', can, {
      expectPaxScope: false, chargedPax: 2, totalPaxOnPnr: 2,
    });
    table.push(...sCan.rows);

    // Compare fee × pax vs S1 if both have perPax.cancellationFee
    const fee1 = results.find((x) => x.id === 'S1')?.penalty?.perPax?.cancellationFee;
    const fee2 = sPen.snapshot?.perPax?.cancellationFee;
    if (fee1 != null && fee2 != null) {
      table.push({
        rule: 'S3 vs S1: cancellationFee per pax same unit',
        expected: 'perPax.cancellationFee equal (then × chargedPax in totals)',
        actual: `S1 fee=${fee1} S3 fee=${fee2}`,
        status: nearly(fee1, fee2, 1) ? 'PASS' : 'BUG',
      });
    }

    results.push({ id: 'S3', fixture: b2full, penalty: sPen.snapshot, cancel: sCan.snapshot });
  } else {
    table.push({ rule: 'S3 book 2ADT full', expected: 'Confirmed+PNR', actual: brief(b2full), status: 'NOT_TESTED' });
  }

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
    NOT_TESTED: table.filter((t) => t.status === 'NOT_TESTED' || t.status === 'NOT_READY').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'P0 per-passenger cancel charges',
    fixtures: { b1, b2subset, b2full },
    results,
    table,
    score,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', score);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule.slice(0, 60) })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
