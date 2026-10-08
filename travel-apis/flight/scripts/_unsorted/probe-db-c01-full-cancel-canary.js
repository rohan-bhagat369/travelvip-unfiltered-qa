/**
 * C01 on canary: full online cancel (all pax / all legs on PNR).
 * Books fresh 1ADT OW, CANCEL without cancellationPaxList (full), dumps DB SQL.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-c01-full-cancel-canary.js
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
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-c01-full-cancel-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 16; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 3) return st;
    await sleep(3000);
  }
  return last?.data?.status;
}

function extractPnr(detail) {
  const it = detail?.bookingResponse?.itinerary || [];
  return it.find((x) => x.pnr)?.pnr || null;
}

async function book1adt(flight, client) {
  const routes = [
    { o: 'MAA', d: 'BOM', days: 111 },
    { o: 'AMD', d: 'DEL', days: 112 },
    { o: 'HYD', d: 'BLR', days: 113 },
    { o: 'PNQ', d: 'GOI', days: 114 },
    { o: 'CCU', d: 'BOM', days: 115 },
    { o: 'DEL', d: 'HYD', days: 116 },
  ];
  for (const r of routes) {
    console.log(`BOOK OW 1ADT ${r.o}->${r.d}`);
    const body = buildOneWaySearchBody(r.days, {
      origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    const search = await flight.searchUntilComplete(body);
    const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
    if (!pricing.data?.priceId) {
      console.log('  pricing fail', brief(pricing.data, 200));
      continue;
    }
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [search.searchId],
      journeyType: 'ONE_WAY',
      passengerProfile: {
        title: 'Mr', firstName: 'Suresh', lastName: 'Patil', gender: 'Male', dob: '1985-09-22',
      },
    });
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
      continue;
    }
    const status = await waitStatus(flight, br);
    const detail = await flight.getBookingDetail(br);
    const detailStatus = detail.data?.status || status;
    const pnr = extractPnr(detail.data);
    console.log('  ->', br, detailStatus, pnr);
    if (pnr && /confirm/i.test(String(detailStatus)) && pnr !== 'FVRVRV') {
      return { br, pnr, status: detailStatus, route: `${r.o}-${r.d}` };
    }
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await book1adt(flight, client);
  if (!fixture) throw new Error('No Confirmed OW for C01');

  console.log('FIXTURE', fixture);
  console.log('C01 FULL CANCEL on', fixture.br, fixture.pnr);

  const cancel = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body: { action: 'CANCEL', pnr: fixture.pnr },
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const cancelResult = {
    http: cancel.status,
    code: cancel.data?.error?.code || null,
    cancelStatus: cancel.data?.cancellationRequest?.status
      || cancel.data?.data?.cancellationRequest?.status
      || null,
    paxScope: cancel.data?.paxScope || cancel.data?.data?.paxScope || null,
    body: brief(cancel.data, 800),
  };
  console.log('CANCEL', cancelResult);

  await sleep(5000);
  let afterStatus = null;
  for (let i = 0; i < 6; i += 1) {
    const st = await flight.getBookingStatus(fixture.br);
    afterStatus = st.data?.status;
    console.log('  after', i + 1, afterStatus);
    if (/cancel/i.test(String(afterStatus)) && !/request|fail/i.test(String(afterStatus))) break;
    if (/fail/i.test(String(afterStatus))) break;
    await sleep(4000);
  }
  const detail = await flight.getBookingDetail(fixture.br);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C01',
    checks: ['V051', 'V052', 'V053', 'V054', 'V055', 'V056', 'V057', 'V058', 'V059', 'V060', 'V061', 'V062', 'V063'],
    note: 'Full cancel — interpretation from C01 intent; paste sheet Expected to align exactly.',
    interpretation: {
      V051: 'cancellation_request row created for PNR',
      V052: 'cancellation_type FULL (full booking/PNR cancel)',
      V053: 'mode ONLINE',
      V054: 'status requested→completed (or failed if vendor)',
      V055: 'cancellation_passenger covers all pax on PNR',
      V056: 'cells linked via flight_journey_passenger_id',
      V057: 'booking cancelled_at set when success',
      V058: 'journey/cells cancelled when success',
      V059: 'refund fields populated when success',
      V060_V063: 'money/refund legs — check if present',
    },
    fixture,
    cancelResult,
    afterStatus,
    afterDetailStatus: detail.data?.status,
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      '',
      `SELECT id, booking_reference, confirmed_at, cancelled_at
FROM booking WHERE booking_reference = @br;`,
      '',
      `SELECT fj.id, fj.sequence, fj.direction, fj.airline_pnr
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
      '',
      `SELECT cr.*
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;`,
      '',
      `SELECT cp.*, bp.pax_id, bp.first_name
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cp.id;`,
      '',
      `SELECT bp.pax_id, fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override, fj.airline_pnr
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
