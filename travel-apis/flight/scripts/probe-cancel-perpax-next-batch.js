/**
 * Next batch: direct CANCEL on known BR + missing field negatives
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-next-batch.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { FLIGHT_QUERY } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const BR = process.env.FIXTURE_BR || 'BR1786561773208289';
const OUT = 'reports/cancel-perpax-next-batch.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 700) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}
function errOf(r) {
  return r?.data?.error || null;
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

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Next batch on', config.baseUrl, 'BR', BR);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const st0 = await flight.getBookingStatus(BR);
  const det = await flight.getBookingDetail(BR);
  const pnr = (det.data?.bookingResponse?.itinerary || [])[0]?.pnr;
  const fixture = { br: BR, status: st0.data?.status || det.data?.status, pnr };
  console.log('Fixture', fixture);
  if (!pnr) throw new Error('No PNR');

  const table = [];
  const cases = {};

  // --- N1: PENALTY then CANCEL full PNR (direct path) ---
  console.log('\n=== N1 PENALTY');
  const pen = await cancelCall(client, BR, {
    action: 'PENALTY', pnr, cancellationReason: 'N1',
  });
  console.log(pen.status, brief(pen.data));
  const p = cr(pen);
  table.push({
    rule: 'N1 PENALTY: Penalty Fetched + amounts',
    expected: 'Penalty Fetched with total/charge/refund',
    actual: `${p.status} total=${p.totalAmount} charge=${p.estimatedCancellationCharge} refund=${p.estimatedRefund}`,
    status: /penalty fetched/i.test(String(p.status || ''))
      && p.totalAmount != null && p.estimatedCancellationCharge != null && p.estimatedRefund != null
      ? 'PASS' : 'BUG',
  });
  table.push({
    rule: 'N1 PENALTY: refund = total − charge',
    expected: 'math holds',
    actual: `refund=${p.estimatedRefund} total=${p.totalAmount} charge=${p.estimatedCancellationCharge}`,
    status: nearly(num(p.estimatedRefund), num(p.totalAmount) - num(p.estimatedCancellationCharge))
      ? 'PASS' : 'BUG',
  });
  cases.penalty = { http: pen.status, raw: env(pen) };

  await sleep(1500);
  console.log('\n=== N1 CANCEL');
  const can = await cancelCall(client, BR, {
    action: 'CANCEL', pnr, cancellationReason: 'N1',
  });
  console.log(can.status, brief(can.data));
  const c = cr(can);
  table.push({
    rule: 'N1 CANCEL: Cancelled (direct path)',
    expected: 'Cancelled',
    actual: c.status || errOf(can)?.code || can.status,
    status: /cancelled/i.test(String(c.status || '')) && !/fail|request/i.test(String(c.status || ''))
      ? 'PASS' : 'BUG',
  });
  table.push({
    rule: 'N1 CANCEL: refund = total − charge',
    expected: 'math holds',
    actual: `refund=${c.estimatedRefund} total=${c.totalAmount} charge=${c.estimatedCancellationCharge}`,
    status: nearly(num(c.estimatedRefund), num(c.totalAmount) - num(c.estimatedCancellationCharge))
      ? 'PASS' : 'BUG',
  });
  cases.cancel = { http: can.status, raw: env(can) };

  await sleep(1500);
  const after = await flight.getBookingStatus(BR);
  table.push({
    rule: 'N1 booking status Cancelled',
    expected: 'Cancelled',
    actual: after.data?.status,
    status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
  });
  cases.afterStatus = after.data?.status;

  // --- N2: missing action (use another live BR if this one cancelled — use RT confirmed) ---
  const otherBr = process.env.OTHER_BR || 'BR1786569524287412';
  let otherPnr = null;
  try {
    const od = await flight.getBookingDetail(otherBr);
    otherPnr = (od.data?.bookingResponse?.itinerary || []).find((l) => /onward/i.test(l.direction))?.pnr
      || (od.data?.bookingResponse?.itinerary || [])[0]?.pnr;
  } catch {
    otherPnr = null;
  }
  const negBr = otherPnr ? otherBr : BR;
  const negPnr = otherPnr || pnr;

  console.log('\n=== N2 missing action on', negBr);
  const missAction = await cancelCall(client, negBr, {
    pnr: negPnr, cancellationReason: 'N2',
  });
  console.log(missAction.status, brief(missAction.data));
  {
    const err = errOf(missAction);
    const ok = missAction.status >= 400 || Boolean(err?.code);
    table.push({
      rule: 'N2 missing action rejected',
      expected: '4xx + error.code (VALIDATION_ERROR / etc)',
      actual: `${missAction.status} ${err?.code || brief(missAction.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.missingAction = { http: missAction.status, error: err, raw: brief(missAction.data, 400) };
  }

  console.log('\n=== N3 missing pnr on', negBr);
  const missPnr = await cancelCall(client, negBr, {
    action: 'PENALTY', cancellationReason: 'N3',
  });
  console.log(missPnr.status, brief(missPnr.data));
  {
    const err = errOf(missPnr);
    const ok = missPnr.status >= 400 || Boolean(err?.code);
    table.push({
      rule: 'N3 missing pnr rejected',
      expected: '4xx + error.code',
      actual: `${missPnr.status} ${err?.code || brief(missPnr.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.missingPnr = { http: missPnr.status, error: err, raw: brief(missPnr.data, 400) };
  }

  // --- N4: cancel already Cancelled booking ---
  console.log('\n=== N4 cancel already Cancelled', BR);
  const again = await cancelCall(client, BR, {
    action: 'CANCEL', pnr, cancellationReason: 'N4',
  });
  console.log(again.status, brief(again.data));
  {
    const err = errOf(again);
    const st = cr(again).status;
    const ok = again.status >= 400
      || Boolean(err?.code)
      || /fail|already|not allow|invalid|not available/i.test(String(st || '') + JSON.stringify(again.data || {}));
    table.push({
      rule: 'N4 re-cancel Cancelled booking rejected/guarded',
      expected: 'error or failed status (not silent success Cancelled again)',
      actual: `${again.status} ${err?.code || st || brief(again.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.recancel = { http: again.status, error: err, status: st, raw: brief(again.data, 400) };
  }

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'Direct CANCEL + missing-field negatives',
    fixture,
    cases,
    table,
    score,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', score);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
