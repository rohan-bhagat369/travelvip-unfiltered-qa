/**
 * Multipax OW on canary + cancel one pax (PAX2).
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-multipax-ow-cancel-one-pax-canary.js
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

const OUT = 'reports/db-multipax-ow-cancel-one-pax-canary.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 600) {
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

function pax3() {
  const city = { cityCode: 'Pune', cityName: 'Pune' };
  const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  const ssr = { baggage: [], meals: [], seats: [] };
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true, city, passport, ssr,
      profile: { title: 'Mr', firstName: 'Kabir', lastName: 'Mehta', gender: 'Male', dob: '1990-01-15', nationality: 'IN' },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false, city, passport, ssr,
      profile: { title: 'Mr', firstName: 'Arjun', lastName: 'Nair', gender: 'Male', dob: '1991-06-20', nationality: 'IN' },
    },
    {
      paxId: 'PAX3', type: 'adult', isLead: false, city, passport, ssr,
      profile: { title: 'Mrs', firstName: 'Neha', lastName: 'Patil', gender: 'Female', dob: '1992-03-12', nationality: 'IN' },
    },
  ];
}

function pax2() {
  return pax3().slice(0, 2);
}

async function bookMultipaxOw(flight, client) {
  const adultsOpts = [2, 3];
  const routes = [
    { o: 'DEL', d: 'BOM', days: 55 },
    { o: 'BLR', d: 'HYD', days: 60 },
    { o: 'MAA', d: 'BOM', days: 65 },
    { o: 'AMD', d: 'DEL', days: 70 },
    { o: 'HYD', d: 'BLR', days: 75 },
    { o: 'PNQ', d: 'DEL', days: 80 },
    { o: 'GOI', d: 'BOM', days: 85 },
    { o: 'CCU', d: 'DEL', days: 90 },
  ];
  for (const adults of adultsOpts) {
    for (const r of routes) {
      try {
        console.log(`BOOK ${adults}ADT OW ${r.o}->${r.d}`);
        const body = buildOneWaySearchBody(r.days, {
          origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
        });
        body.travellers = { adults, children: 0, infants: 0 };
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
        });
        payload.data.passengers = adults === 2 ? pax2() : pax3();
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
          console.log('  issue fail', brief(issue.data, 280));
          continue;
        }
        const status = await waitStatus(flight, br);
        const detail = await flight.getBookingDetail(br);
        const detailStatus = detail.data?.status || status;
        const pnr = extractPnr(detail.data);
        const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => ({
          paxId: p.paxId,
          name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
        }));
        console.log('  ->', br, detailStatus, pnr, pax.map((x) => x.paxId).join(','));
        if (pnr && /confirm/i.test(String(detailStatus)) && pnr !== 'FVRVRV' && pax.length >= 2) {
          return {
            br, pnr, status: detailStatus, route: `${r.o}-${r.d}`, pax, adults,
          };
        }
      } catch (e) {
        console.log('  skip route', e.message);
      }
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

  const fixture = await bookMultipaxOw(flight, client);
  if (!fixture) throw new Error('No Confirmed multipax OW on canary');

  const cancelBody = {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX2'],
  };
  console.log('FIXTURE', fixture);
  console.log('CANCEL ONE PAX payload', cancelBody);

  const cancel = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body: cancelBody,
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
    body: cancel.data,
  };
  console.log('CANCEL RESULT', {
    http: cancelResult.http,
    cancelStatus: cancelResult.cancelStatus,
    paxScope: cancelResult.paxScope,
    brief: brief(cancel.data, 500),
  });

  await sleep(4000);
  const after = await flight.getBookingDetail(fixture.br);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    note: 'Multipax OW + cancel one pax (PAX2). Sheet C04-style on OW (not return-leg C03).',
    fixture,
    cancelPayload: cancelBody,
    cancelResult: {
      http: cancelResult.http,
      code: cancelResult.code,
      cancelStatus: cancelResult.cancelStatus,
      paxScope: cancelResult.paxScope,
      bodyBrief: brief(cancel.data, 800),
    },
    afterStatus: after.data?.status,
    afterPax: (after.data?.bookingResponse?.passengers || []).map((p) => ({
      paxId: p.paxId,
      name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
    })),
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      `SELECT id, booking_reference, confirmed_at, cancelled_at FROM booking WHERE booking_reference = @br;`,
      `SELECT bp.id, bp.pax_id, bp.is_lead, bp.first_name, bp.last_name
FROM booking_passenger bp JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br ORDER BY bp.pax_id;`,
      `SELECT cr.* FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY cr.id DESC;`,
      `SELECT cp.*, bp.pax_id, bp.first_name FROM cancellation_passenger cp
JOIN cancellation_request cr ON cr.id = cp.cancellation_request_id
JOIN booking_passenger bp ON bp.id = cp.booking_passenger_id
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br ORDER BY cp.id;`,
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
