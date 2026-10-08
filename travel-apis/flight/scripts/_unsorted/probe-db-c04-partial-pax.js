/**
 * Clean C04 fixture: book 2ADT OW on staging, cancel PAX2 only, dump API + SQL checklist.
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-c04-partial-pax.js
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

const OUT = 'reports/db-c04-partial-pax-fresh.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 400) {
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

async function book2adt(flight, client) {
  const routes = [
    { o: 'MAA', d: 'BOM', days: 88 },
    { o: 'AMD', d: 'DEL', days: 89 },
    { o: 'HYD', d: 'BLR', days: 90 },
    { o: 'PNQ', d: 'DEL', days: 91 },
    { o: 'CCU', d: 'BOM', days: 92 },
  ];
  for (const r of routes) {
    console.log(`BOOK 2ADT OW ${r.o}->${r.d}`);
    const body = buildOneWaySearchBody(r.days, {
      origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
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
        title: 'Mr', firstName: 'Kabir', lastName: 'Mehta', gender: 'Male', dob: '1990-01-15',
      },
    });
    const city = { cityCode: 'Pune', cityName: 'Pune' };
    const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
    const ssr = { baggage: [], meals: [], seats: [] };
    payload.data.passengers = [
      {
        paxId: 'PAX1', type: 'adult', isLead: true, city, passport, ssr,
        profile: { title: 'Mr', firstName: 'Kabir', lastName: 'Mehta', gender: 'Male', dob: '1990-01-15', nationality: 'IN' },
      },
      {
        paxId: 'PAX2', type: 'adult', isLead: false, city, passport, ssr,
        profile: { title: 'Mr', firstName: 'Arjun', lastName: 'Nair', gender: 'Male', dob: '1991-06-20', nationality: 'IN' },
      },
    ];
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
    const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
    console.log('  ->', br, detailStatus, pnr, pax.join(','));
    if (pnr && /confirm/i.test(String(detailStatus)) && pnr !== 'FVRVRV' && pax.length >= 2) {
      return { br, pnr, status: detailStatus, route: `${r.o}-${r.d}`, pax };
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

  const fixture = await book2adt(flight, client);
  if (!fixture) throw new Error('No Confirmed 2ADT fixture for C04');

  const cancelApi = (body) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  console.log('C04 CANCEL PAX2 only on', fixture.br, fixture.pnr);
  const cancel = await cancelApi({
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX2'],
  });

  await sleep(4000);
  const after = await flight.getBookingDetail(fixture.br);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'C04',
    checks: ['V071', 'V072', 'V073'],
    fixture,
    cancel: {
      http: cancel.status,
      code: cancel.data?.error?.code || null,
      cancelStatus: cancel.data?.cancellationRequest?.status
        || cancel.data?.data?.cancellationRequest?.status
        || null,
      paxScope: cancel.data?.paxScope || cancel.data?.data?.paxScope || null,
      body: brief(cancel.data, 600),
    },
    afterStatus: after.data?.status,
    afterPax: (after.data?.bookingResponse?.passengers || []).map((p) => ({
      paxId: p.paxId, status: p.status,
    })),
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      `-- V071: cancellation_request scope PARTIAL for PAX2 only`,
      `SELECT cr.id, cr.scope, cr.channel, cr.status, cr.pnr, cr.created_at
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cr.id DESC;`,
      `-- V072: cancellation_passenger should list ONLY PAX2 (not all pax)`,
      `SELECT cp.*
FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY cp.id;`,
      `-- V073 / cells: PAX2 cells cancelled or marked; PAX1 still active`,
      `SELECT bp.pax_id, fjp.id AS cell_id, fjp.eticket_number, fjp.pnr_override,
       fj.airline_pnr, fj.direction
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
ORDER BY bp.pax_id;`,
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('CANCEL', report.cancel);
  console.log('AFTER', report.afterStatus, report.afterPax);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
