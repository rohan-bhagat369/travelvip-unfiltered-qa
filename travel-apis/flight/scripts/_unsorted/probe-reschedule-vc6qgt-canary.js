/**
 * Reschedule cancelled BR1786519576464787 / VC6QGT (d+20-25 replacement).
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-reschedule-vc6qgt-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OLD_BR = 'BR1786519576464787';
const OLD_PNR = 'VC6QGT';
const OUT = 'reports/reschedule-vc6qgt-canary.json';
const Q = { ...FLIGHT_QUERY };

function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);
  console.log('Reschedule', OLD_BR, OLD_PNR);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const oldSt = await flight.getBookingStatus(OLD_BR);
  console.log('Old status', oldSt.data?.status);

  const tag = letterTag();
  const routes = [
    { from: 'DEL', to: 'BOM', airlines: ['SG'], days: [21, 22, 23, 24, 25] },
    { from: 'BOM', to: 'DEL', airlines: ['SG'], days: [21, 23, 25] },
  ];

  let win = null;
  for (const r of routes) {
    for (const days of r.days) {
      console.log(`Search ${r.from}-${r.to} d+${days}`);
      const body = buildOneWaySearchBody(days, {
        origin: r.from, destination: r.to, fareType: 'NORMAL', maxStops: 0,
      });
      if (r.airlines.length) body.preferences = { ...(body.preferences || {}), airlines: r.airlines };
      body.travellers = { adults: 1, children: 0, infants: 0 };

      let sid = null;
      for (let i = 0; i < 8; i += 1) {
        const s = await flight.search(body);
        sid = extractFirstSearchId(s.data);
        if (sid) break;
        if (isSearchProgressComplete(s.data)) break;
        await sleep(2000);
      }
      if (!sid) continue;

      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.data?.priceId) continue;
      const total = Number(pricing.data?.pricing?.totalAmount || 0);
      console.log('  priced', total);

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
        passengerProfile: {
          title: 'Mrs', firstName: 'Kavita', lastName: `Menon ${tag}`, gender: 'Female', dob: '1990-08-22',
        },
      });
      payload.reschedulingReferenceId = OLD_BR;
      payload.reschedulingPnr = OLD_PNR;

      const iss = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });

      const code = iss.data?.error?.code || null;
      const newBr = iss.data?.bookingReference || iss.data?.bookingReferenceId || null;
      console.log('  issue', iss.status, code || newBr);
      if (code || !newBr) continue;

      let newStatus = iss.data?.status || null;
      for (let j = 0; j < 10; j += 1) {
        const st = await flight.getBookingStatus(newBr);
        newStatus = st.data?.status || newStatus;
        console.log('  poll', j + 1, newStatus);
        if (isTerminalBookingStatus(newStatus)) break;
        if (/inprogress|pending/i.test(String(newStatus)) && j >= 4) break;
        await sleep(2500);
      }

      const detail = await flight.getBookingDetail(newBr);
      const newPnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
      win = {
        ranAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        oldBr: OLD_BR,
        oldPnr: OLD_PNR,
        oldStatus: oldSt.data?.status,
        passenger: `Kavita Menon ${tag}`,
        route: `${r.from}-${r.to}`,
        days,
        total,
        newBr,
        newPnr,
        newStatus: detail.data?.status || newStatus,
        ok: /confirm/i.test(String(detail.data?.status || newStatus)),
        issueBody: iss.data,
      };
      break;
    }
    if (win) break;
  }

  if (!win) throw new Error('Reschedule failed');

  win.dbSql = [
    'USE travelx;',
    `SET @old := '${OLD_BR}';`,
    `SET @new := '${win.newBr}';`,
    'SELECT booking_reference, id, confirmed_at, cancelled_at FROM booking WHERE booking_reference IN (@old, @new);',
    `SELECT b.booking_reference, fj.id, fj.direction, fj.airline_pnr, fj.rescheduled_from_journey_id
FROM flight_journey fj JOIN booking_item bi ON bi.id = fj.booking_item_id JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN (@old, @new) ORDER BY b.booking_reference, fj.sequence;`,
    `SELECT cr.id, cr.pnr, cr.cancellation_type, cr.mode, cr.status, cr.refund_status
FROM cancellation_request cr JOIN booking_item bi ON bi.id = cr.booking_item_id JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @old ORDER BY cr.id DESC;`,
  ].join('\n');

  fs.writeFileSync(OUT, JSON.stringify(win, null, 2));
  console.log('OK', win.ok, win.newBr, win.newPnr, win.newStatus);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
