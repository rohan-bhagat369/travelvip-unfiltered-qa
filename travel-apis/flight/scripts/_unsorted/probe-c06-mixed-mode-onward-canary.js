/**
 * C06 follow-up on partially-cancelled RT:
 *   Return already cancelled ONLINE (C03 on BR1786532280192377).
 *   Cancel remaining ONWARD leg via paxwise cancellationPaxList (PAX1).
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-c06-mixed-mode-onward-canary.js
 *   BR=BR1786532280192377 node scripts/probe-c06-mixed-mode-onward-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import { FLIGHT_QUERY } from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-c06-mixed-mode-canary.json';
const Q = { ...FLIGHT_QUERY };
const BR = process.env.BR || 'BR1786532280192377';

function brief(d, n = 700) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractLegs(detail) {
  return (detail?.bookingResponse?.itinerary || []).map((leg) => ({
    direction: String(leg.direction || '').toUpperCase(),
    pnr: leg.pnr || null,
    onlineCancellation: leg.onlineCancellation,
  }));
}

function extractPax(detail) {
  return (detail?.bookingResponse?.passengers || []).map((p) => ({
    paxId: p.paxId,
    name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
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

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('C06 mixed-mode onward cancel', BR, 'on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const before = await flight.getBookingDetail(BR);
  const beforeStatus = before.data?.status;
  const legs = extractLegs(before.data);
  const pax = extractPax(before.data);
  const onward = legs.find((l) => /onward|outbound/i.test(l.direction)) || legs[0];
  const ret = legs.find((l) => /return|inbound/i.test(l.direction)) || legs[1];
  const pax1 = pax[0]?.paxId || 'PAX1';

  console.log('Before', beforeStatus, legs, pax);
  if (!onward?.pnr) throw new Error('No onward PNR on booking');

  const steps = [];

  console.log('\nPENALTY onward', onward.pnr, 'pax', pax1);
  const pen = await cancelCall(client, BR, {
    action: 'PENALTY',
    pnr: onward.pnr,
    cancellationPaxList: [pax1],
  });
  steps.push({
    step: 'PENALTY',
    pnr: onward.pnr,
    cancellationPaxList: [pax1],
    http: pen.status,
    status: pen.data?.data?.cancellationRequest?.status || pen.data?.cancellationRequest?.status,
    body: brief(pen.data),
  });
  console.log(' ', pen.status, steps.at(-1).status);
  await sleep(2000);

  console.log('CANCEL onward paxwise', onward.pnr, pax1);
  const can = await cancelCall(client, BR, {
    action: 'CANCEL',
    pnr: onward.pnr,
    cancellationPaxList: [pax1],
  });
  steps.push({
    step: 'CANCEL',
    pnr: onward.pnr,
    cancellationPaxList: [pax1],
    http: can.status,
    status: can.data?.data?.cancellationRequest?.status || can.data?.cancellationRequest?.status,
    paxScope: can.data?.data?.paxScope || can.data?.paxScope || null,
    body: brief(can.data),
  });
  console.log(' ', can.status, steps.at(-1).status, steps.at(-1).paxScope);

  await sleep(5000);
  let afterStatus = (await flight.getBookingStatus(BR)).data?.status;
  for (let i = 0; i < 8 && !/cancel/i.test(String(afterStatus || '')); i += 1) {
    await sleep(3000);
    afterStatus = (await flight.getBookingStatus(BR)).data?.status;
    console.log('  poll', i + 1, afterStatus);
  }

  const afterDetail = await flight.getBookingDetail(BR);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C06',
    checks: ['V076', 'V077'],
    note: 'Return leg already ONLINE-cancelled (cr 320). This step cancels onward via paxwise list.',
    fixture: {
      br: BR,
      beforeStatus,
      onwardPnr: onward.pnr,
      returnPnr: ret?.pnr || null,
      pax,
      priorOnlineCancel: { crId: 320, pnr: 'F9JCUZ', journeyId: 214 },
    },
    steps,
    afterStatus,
    afterLegs: extractLegs(afterDetail.data),
    dbSql: [
      'USE travelx;',
      `SET @br := '${BR}';`,
      '',
      '-- V076: expect 2 cancellation_request rows — one ONLINE (return), one OFFLINE (onward)',
      `SELECT cr.id, cr.pnr, cr.flight_journey_id, fj.direction,
       cr.cancellation_type, cr.mode, cr.status, cr.created_at
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN flight_journey fj ON fj.id = cr.flight_journey_id
WHERE b.booking_reference = @br
ORDER BY cr.id;`,
      '',
      '-- V077: both requests same booking_item',
      `SELECT cr.id, cr.booking_item_id, cr.pnr, cr.mode, cr.flight_journey_id
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id;`,
      '',
      `SELECT b.booking_reference, b.cancelled_at, bi.id AS booking_item_id,
       bsm.backend_status, bsm.user_status
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;`,
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
