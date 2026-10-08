/**
 * S5 — RT cancel return only on existing BR
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-s5-rt-return-existing.js BR1786569524287412
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import { FLIGHT_QUERY } from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const BR = process.argv[2] || 'BR1786569524287412';
const OUT = `reports/cancel-perpax-s5-rt-return-${BR}.json`;
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 1000) {
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
  console.log('S5 return-only on', BR, config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const st = await flight.getBookingStatus(BR);
  const det = await flight.getBookingDetail(BR);
  const d = det.data || {};
  const itins = d.bookingResponse?.itinerary || [];
  const onward = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
  const ret = itins.find((l) => /return/i.test(l.direction)) || itins[1];
  const pax = d.bookingResponse?.passengers || [];
  const chargedPax = pax.length || 2;

  const fixture = {
    br: BR,
    bookingStatus: d.status || st.data?.status,
    tripType: d.bookingResponse?.summary?.tripType,
    totalPassengers: chargedPax,
    passengers: pax.map((p) => ({ paxId: p.paxId, name: [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' ') })),
    onward: { pnr: onward?.pnr, onlineCancellation: onward?.onlineCancellation, airline: onward?.segments?.[0]?.airlineCode },
    return: { pnr: ret?.pnr, onlineCancellation: ret?.onlineCancellation, airline: ret?.segments?.[0]?.airlineCode },
  };
  console.log('FIXTURE', JSON.stringify(fixture, null, 2));

  const returnPnr = process.env.PNR || ret?.pnr;
  const onwardPnr = onward?.pnr;
  if (!returnPnr || !onwardPnr) throw new Error('Missing PNRs');
  if (returnPnr === onwardPnr) throw new Error('Same PNR both legs — cannot isolate return');

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

  function score(label, res) {
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
      rule: `${label}: perPax basis!=NONE`,
      expected: `chargedPax=${chargedPax} (or paxCount), penaltyBasis not NONE`,
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
      rule: `${label}: response pnr is return`,
      expected: returnPnr,
      actual: env(res).pnr || 'n/a',
      status: String(env(res).pnr || '') === returnPnr ? 'PASS' : 'BUG',
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

  console.log('\n=== PENALTY return', returnPnr);
  const pen = await cancelCall({
    action: 'PENALTY',
    pnr: returnPnr,
    cancellationReason: 'S5 RT return only',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = score('S5 PENALTY', pen);

  await sleep(1500);
  console.log('\n=== CANCEL return', returnPnr);
  const can = await cancelCall({
    action: 'CANCEL',
    pnr: returnPnr,
    cancellationReason: 'S5 RT return only',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = score('S5 CANCEL', can);

  await sleep(2000);
  const afterDet = await flight.getBookingDetail(BR);
  const afterSt = await flight.getBookingStatus(BR);
  const afterItins = afterDet.data?.bookingResponse?.itinerary || [];
  const onwardAfter = afterItins.find((l) => /onward/i.test(l.direction)) || afterItins[0];
  const returnAfter = afterItins.find((l) => /return/i.test(l.direction)) || afterItins[1];

  const table = [
    ...sPen.rows,
    ...sCan.rows,
    {
      rule: 'S5 onward PNR untouched',
      expected: `onward ${onwardPnr} still present`,
      actual: `onward=${onwardAfter?.pnr}`,
      status: onwardAfter?.pnr === onwardPnr ? 'PASS' : 'BUG',
    },
    {
      rule: 'S5 booking partially cancelled / still exists',
      expected: 'Partially cancelled or similar; BR exists',
      actual: afterSt.data?.status,
      status: afterDet.status === 200 && /partial|cancel|confirm/i.test(String(afterSt.data?.status || ''))
        ? 'PASS' : 'BUG',
    },
  ];

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'S5 RT cancel return only',
    fixture,
    request: { pnr: returnPnr, cancellationPaxList: null },
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
    after: {
      bookingStatus: afterSt.data?.status,
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
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
