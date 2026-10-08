/**
 * CORPORATE subset cancel validate on existing BR
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-existing-br.js BR1786567896898911
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { FLIGHT_QUERY } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const BR = process.argv[2] || 'BR1786567896898911';
const CANCEL_PAX = (process.env.CANCEL_PAX || 'PAX1').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = `reports/cancel-perpax-corporate-${BR}.json`;
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 1200) {
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

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Check+subset cancel', BR, 'on', config.baseUrl, 'pax', CANCEL_PAX);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const st = await flight.getBookingStatus(BR);
  const det = await flight.getBookingDetail(BR);
  const d = det.data || {};
  const itins = d.bookingResponse?.itinerary || [];
  const pax = d.bookingResponse?.passengers || [];
  const summary = {
    br: BR,
    bookingStatus: d.status || st.data?.status,
    tripType: d.bookingResponse?.summary?.tripType || null,
    totalPassengers: d.bookingResponse?.summary?.totalPassengers || pax.length,
    fareType: d.fareType || d.bookingResponse?.fareType || d.bookingResponse?.summary?.fareType || null,
    passengers: pax.map((p) => ({
      paxId: p.paxId,
      name: [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' '),
      type: p.type,
    })),
    itinerary: itins.map((leg) => ({
      direction: leg.direction,
      pnr: leg.pnr,
      onlineCancellation: leg.onlineCancellation,
      airline: leg.segments?.[0]?.airlineCode || leg.segments?.[0]?.airline?.code,
      flights: (leg.segments || []).map((s) => s.flightNumber).filter(Boolean),
    })),
  };
  console.log('SUMMARY', JSON.stringify(summary, null, 2));

  const pnr = process.env.PNR || itins[0]?.pnr;
  if (!pnr) throw new Error('No PNR on booking');

  async function cancelCall(body) {
    return client.request({
      method: 'POST',
      path: `/v1/flights/booking/${BR}/cancel`,
      query: Q,
      body: { retryCount: 2, ...body },
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  console.log('\n=== PENALTY subset', CANCEL_PAX, 'pnr', pnr);
  const pen = await cancelCall({
    action: 'PENALTY',
    pnr,
    cancellationPaxList: CANCEL_PAX,
    cancellationReason: 'CORP subset validate',
  });
  console.log('PENALTY', pen.status, brief(pen.data));

  await sleep(1500);
  console.log('\n=== CANCEL subset');
  const can = await cancelCall({
    action: 'CANCEL',
    pnr,
    cancellationPaxList: CANCEL_PAX,
    cancellationReason: 'CORP subset validate',
  });
  console.log('CANCEL', can.status, brief(can.data));

  function score(label, res) {
    const c = cr(res);
    const scope = env(res).paxScope || null;
    const perPax = c.perPax || null;
    const totalAmount = num(c.totalAmount);
    const charge = num(c.estimatedCancellationCharge);
    const refund = num(c.estimatedRefund);
    const rows = [];
    rows.push({
      rule: `${label}: paxScope PARTIAL_PAX quotable`,
      expected: `PARTIAL_PAX cancelledPaxCount=${CANCEL_PAX.length} penaltyQuotable=true`,
      actual: scope ? JSON.stringify(scope) : 'MISSING',
      status: scope?.scope === 'PARTIAL_PAX'
        && Number(scope.cancelledPaxCount) === CANCEL_PAX.length
        && scope.penaltyQuotable === true
        ? 'PASS' : 'BUG',
    });
    rows.push({
      rule: `${label}: amounts present`,
      expected: 'totalAmount, charge, refund numeric',
      actual: `total=${totalAmount} charge=${charge} refund=${refund} msg=${c.message || ''}`,
      status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
    });
    rows.push({
      rule: `${label}: refund = total - charge`,
      expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
      actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
      status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
    });
    rows.push({
      rule: `${label}: perPax chargedPax + basis!=NONE`,
      expected: `perPax chargedPax=${CANCEL_PAX.length}, penaltyBasis not NONE`,
      actual: perPax ? JSON.stringify(perPax) : 'MISSING',
      status: perPax
        && (Number(perPax.chargedPax) === CANCEL_PAX.length || Number(perPax.paxCount) === CANCEL_PAX.length)
        && String(perPax.penaltyBasis || scope?.penaltyBasis || '') !== 'NONE'
        ? 'PASS' : 'BUG',
    });
    rows.push({
      rule: `${label}: status`,
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

  const sPen = score('PENALTY', pen);
  const sCan = score('CANCEL', can);
  const table = [...sPen.rows, ...sCan.rows];
  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixture: summary,
    request: { pnr, cancellationPaxList: CANCEL_PAX },
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
