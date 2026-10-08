/**
 * Cancel all OW/RT multipax matrix bookings (full PNR cancel, no pax list).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/cancel-ow-rt-multipax-matrix.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import { FLIGHT_QUERY } from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-ow-rt-multipax-matrix-canary.json';
const Q = { ...FLIGHT_QUERY };

const BRS = [
  'BR1786560435503256', // OW DIRECT
  'BR1786560441984802', // OW CONNECTING
  'BR1786560450765649', // RT DIRECT
  'BR1786560460797099', // RT CONNECTING
];

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractPnrs(detail) {
  const pnrs = [];
  const seen = new Set();
  for (const leg of detail?.bookingResponse?.itinerary || []) {
    if (leg.pnr && !seen.has(leg.pnr)) {
      seen.add(leg.pnr);
      pnrs.push({ pnr: leg.pnr, direction: leg.direction, onlineCancellation: leg.onlineCancellation });
    }
  }
  return pnrs;
}

function cancelStatus(res) {
  return res.data?.data?.cancellationRequest?.status
    || res.data?.cancellationRequest?.status
    || res.data?.status
    || null;
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
  console.log('Cancel matrix BRs on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const results = [];

  for (const br of BRS) {
    console.log(`\n=== ${br} ===`);
    const before = await flight.getBookingStatus(br);
    const detail = await flight.getBookingDetail(br);

    if (Number(before.status) === 500 || Number(detail.status) === 500) {
      console.log('  status/detail HTTP 500 — skip');
      results.push({ br, ok: false, reason: 'STATUS_OR_DETAIL_500', beforeHttp: before.status, detailHttp: detail.status });
      continue;
    }

    const beforeStatus = before.data?.status || detail.data?.status;
    const pnrs = extractPnrs(detail.data);
    console.log('  before', beforeStatus, 'pnrs', pnrs.map((p) => p.pnr));

    if (/cancel/i.test(String(beforeStatus))) {
      results.push({ br, ok: true, beforeStatus, note: 'already cancelled', pnrs });
      continue;
    }

    if (!pnrs.length) {
      console.log('  no PNR yet — cannot cancel');
      results.push({ br, ok: false, beforeStatus, reason: 'NO_PNR', body: brief(detail.data) });
      continue;
    }

    const steps = [];
    for (const { pnr, direction, onlineCancellation } of pnrs) {
      console.log(`  PENALTY ${pnr} (${direction}) online=${onlineCancellation}`);
      const pen = await cancelCall(client, br, { action: 'PENALTY', pnr });
      steps.push({ pnr, action: 'PENALTY', http: pen.status, status: cancelStatus(pen), body: brief(pen.data) });
      console.log('   ', pen.status, cancelStatus(pen), brief(pen.data, 180));
      await sleep(1500);

      console.log(`  CANCEL ${pnr}`);
      const can = await cancelCall(client, br, { action: 'CANCEL', pnr });
      steps.push({ pnr, action: 'CANCEL', http: can.status, status: cancelStatus(can), body: brief(can.data) });
      console.log('   ', can.status, cancelStatus(can), brief(can.data, 180));
      await sleep(2000);
    }

    const after = await flight.getBookingStatus(br);
    const afterStatus = after.data?.status;
    console.log('  after', afterStatus);
    results.push({
      br,
      ok: /cancel/i.test(String(afterStatus)),
      beforeStatus,
      afterStatus,
      pnrs,
      steps,
    });
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    results,
    summary: results.map((r) => ({
      br: r.br,
      before: r.beforeStatus,
      after: r.afterStatus || r.reason,
      ok: r.ok,
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.table(report.summary);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
