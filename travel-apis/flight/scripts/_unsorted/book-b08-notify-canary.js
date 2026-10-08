/**
 * B08: OW 1ADT — notify/contact ≠ passenger.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-b08-notify-canary.js
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

const OUT = 'reports/book-b08-notify-canary.json';
const Q = { ...FLIGHT_QUERY };
const ROUTES = [
  { o: 'AMD', d: 'DEL', days: 81 },
  { o: 'PNQ', d: 'BLR', days: 83 },
  { o: 'HYD', d: 'MAA', days: 85 },
];

const NOTIFY = {
  email: 'cardholder.qa@example.com',
  mobile: '9000011122',
  countryCode: '+91',
  // name if API accepts — some stacks use notify_name separately
};

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

async function searchOnce(flight, body) {
  for (let i = 0; i < 8; i += 1) {
    const last = await flight.search(body);
    const sid = extractFirstSearchId(last.data);
    console.log('  search', i + 1, last.data?.progress?.state, !!sid);
    if (sid) return sid;
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2000);
  }
  return null;
}

async function waitStatus(flight, br) {
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', i + 1, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 2) {
      console.log('  leave Inprogress');
      return s;
    }
    await sleep(2500);
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);
  console.log('B08: contact/notify ≠ passenger');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  for (const r of ROUTES) {
    const tag = letterTag();
    const paxName = { firstName: 'Suresh', lastName: `Patil ${tag}` };
    console.log(`TRY ${r.o}->${r.d} pax=${paxName.firstName} ${paxName.lastName} notify=${NOTIFY.email}/${NOTIFY.mobile}`);
    try {
      const body = buildOneWaySearchBody(r.days, {
        origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      const searchId = await searchOnce(flight, body);
      if (!searchId) continue;

      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
        passengerProfile: {
          title: 'Mr',
          firstName: paxName.firstName,
          lastName: paxName.lastName,
          gender: 'Male',
          dob: '1985-07-21',
        },
      });
      // Override contact so notify ≠ passenger
      payload.data.contact = {
        ...payload.data.contact,
        ...NOTIFY,
      };
      // If API supports explicit notify fields on contact, keep them distinct from pax
      payload.data.contact.name = 'Card Holder QA';

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
        console.log('  issue fail', brief(issue.data));
        continue;
      }

      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const detailStatus = detail.data?.status || status;
      const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
      const pax = detail.data?.bookingResponse?.passengers?.[0];
      const contact = detail.data?.bookingResponse?.contact
        || detail.data?.contact
        || null;

      const report = {
        ranAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        scenario: 'B08',
        checks: ['V033', 'V034', 'V035', 'G10'],
        expected: {
          V033: 'notify_* on booking_item (not booking)',
          V034: 'notify email/phone set from contact override',
          V035: 'notify name/email ≠ passenger name/email',
        },
        route: `${r.o}-${r.d}`,
        br,
        status: detailStatus,
        pnr,
        sentContact: payload.data.contact,
        sentPassenger: paxName,
        detailContact: contact,
        detailPax: pax ? {
          paxId: pax.paxId,
          name: `${pax.profile?.firstName || ''} ${pax.profile?.lastName || ''}`.trim(),
          email: pax.profile?.email || pax.email || null,
        } : null,
        usable: Boolean(pnr && /confirm/i.test(String(detailStatus)) && pnr !== 'FVRVRV'),
        dbSql: [
          'USE travelx;',
          `SET @br := '${br}';`,
          `-- passenger`,
          `SELECT bp.id, bp.pax_id, bp.first_name, bp.last_name, bp.email, bp.phone
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;`,
          `-- V033/G10: notify on booking_item (not booking)`,
          `SHOW COLUMNS FROM booking LIKE 'notify%';`,
          `SHOW COLUMNS FROM booking_item LIKE 'notify%';`,
          `SELECT bi.id, bi.notify_name, bi.notify_email, bi.notify_phone, bi.notify_country_code
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
          `-- V035: compare notify vs passenger`,
          `SELECT
  bp.first_name, bp.last_name, bp.email AS pax_email, bp.phone AS pax_phone,
  bi.notify_name, bi.notify_email, bi.notify_phone
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
JOIN booking_item bi ON bi.booking_id = b.id
WHERE b.booking_reference = @br;`,
        ],
      };
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      console.log('RESULT', br, detailStatus, pnr);
      console.log('Report', OUT);
      if (report.usable) return;
      // Leave Inprogress alone — try next route, do not keep polling this BR
      console.log('  not Confirmed — next route');
    } catch (e) {
      console.log('  error', e.message);
    }
  }
  throw new Error('No Confirmed B08');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
