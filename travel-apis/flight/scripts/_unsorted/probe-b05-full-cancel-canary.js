/**
 * Full online cancel for B05 RT fixture (both PNRs, no cancellationPaxList).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-b05-full-cancel-canary.js
 *   BR=BR1786522372190926 node scripts/probe-b05-full-cancel-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import { FLIGHT_QUERY } from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/b05-full-cancel-canary.json';
const Q = { ...FLIGHT_QUERY };
const BR = process.env.BR || 'BR1786522372190926';

function brief(d, n = 600) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractPnrs(detail) {
  const pnrs = [];
  const seen = new Set();
  for (const leg of detail?.bookingResponse?.itinerary || []) {
    if (leg.pnr && !seen.has(leg.pnr)) {
      seen.add(leg.pnr);
      pnrs.push(leg.pnr);
    }
  }
  return pnrs;
}

function cancelStatus(res) {
  return res.data?.data?.cancellationRequest?.status
    || res.data?.cancellationRequest?.status
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
  console.log('Full cancel', BR, 'on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const before = await flight.getBookingStatus(BR);
  const detail = await flight.getBookingDetail(BR);
  const pnrs = extractPnrs(detail.data);
  console.log('Before', before.data?.status, 'PNRs', pnrs);

  const steps = [];
  for (const pnr of pnrs) {
    console.log('\nPENALTY', pnr);
    const pen = await cancelCall(client, BR, { action: 'PENALTY', pnr });
    steps.push({
      pnr,
      action: 'PENALTY',
      http: pen.status,
      status: cancelStatus(pen),
      body: brief(pen.data),
    });
    console.log(' ', pen.status, cancelStatus(pen));
    await sleep(2000);

    console.log('CANCEL', pnr);
    const can = await cancelCall(client, BR, { action: 'CANCEL', pnr });
    steps.push({
      pnr,
      action: 'CANCEL',
      http: can.status,
      status: cancelStatus(can),
      body: brief(can.data),
    });
    console.log(' ', can.status, cancelStatus(can));
    const st = await flight.getBookingStatus(BR);
    console.log('  booking status', st.data?.status);
    await sleep(3000);
  }

  let afterStatus = (await flight.getBookingStatus(BR)).data?.status;
  for (let i = 0; i < 12 && !/cancel/i.test(String(afterStatus || '')); i += 1) {
    await sleep(4000);
    afterStatus = (await flight.getBookingStatus(BR)).data?.status;
    console.log('  poll', i + 1, afterStatus);
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    br: BR,
    pnrs,
    beforeStatus: before.data?.status,
    afterStatus,
    steps,
    dbSql: [
      'USE travelx;',
      `SET @br := '${BR}';`,
      'SELECT booking_reference, confirmed_at, cancelled_at FROM booking WHERE booking_reference = @br;',
      'SELECT cr.id, cr.pnr, cr.flight_journey_id, cr.cancellation_type, cr.mode, cr.status, cr.refund_status, cr.estimated_refund_amount, cr.estimated_penalty_amount FROM cancellation_request cr JOIN booking_item bi ON bi.id = cr.booking_item_id JOIN booking b ON b.id = bi.booking_id WHERE b.booking_reference = @br ORDER BY cr.id DESC;',
      'SELECT COUNT(*) AS cp_rows, COUNT(DISTINCT cp.flight_journey_passenger_id) AS distinct_cells FROM cancellation_passenger cp JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id JOIN booking_item bi ON bi.id = cr.booking_item_id JOIN booking b ON b.id = bi.booking_id WHERE b.booking_reference = @br;',
      'SELECT bi.id, bi.version, bsm.status_code, bsm.backend_status FROM booking_item bi JOIN booking b ON b.id = bi.booking_id LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id WHERE b.booking_reference = @br;',
    ].join('\n'),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nAFTER', afterStatus);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
