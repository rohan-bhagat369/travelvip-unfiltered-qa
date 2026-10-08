/**
 * Book one hotel + one OW flight on api-staging. Leave both Confirmed.
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-one-hotel-one-flight-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { FlightService } from '../../flight/src/service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../../flight/src/helpers.js';
import { collectOptions, pickFareSearchId } from '../../flight/src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
const OUT = 'reports/book-one-hotel-one-flight-staging.json';
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 240) {
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

async function bookHotel(hotel) {
  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays: 28,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.type = 'HOTEL';
  const search = await hotel.search(searchBody);
  if (!search.ok) throw new Error(`hotel search ${search.status} ${brief(search.data)}`);
  const details = await hotel.getDetails(searchBody);
  if (!details.ok) throw new Error(`hotel details ${details.status}`);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const hotelObj = details.data?.results?.[0];
  const room = (hotelObj?.rooms || [])
    .filter((r) => r.available !== false && r.bookingCode)
    .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12))[0];
  if (!requestId || !room) throw new Error('no bookable hotel room');

  const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  if (!isPrebookSuccess(pre)) throw new Error(`prebook fail ${brief(pre.data)}`);

  const body = {
    bookingContext: extractBookingContext(pre.data),
    bookingCode: room.bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    rooms: [{
      guests: [{ title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }],
    }],
    contact: {
      email: `hotel.staging.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: PAN.panCardNumber,
      panCardName: PAN.panCardName,
    },
  };
  if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

  const fin = await hotel.finalizeBooking(body);
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
  if (!fin.ok || !br) throw new Error(`finalize ${fin.status} ${brief(fin.data)}`);

  let last = null;
  for (let i = 0; i < 16; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('hotel status', i + 1, st, last.data?.message || '');
    if (last.ok && isTerminalHotelStatus(st)) break;
    await sleep(4000);
  }
  const status = String(last?.data?.status || '');
  if (!/confirm/i.test(status)) throw new Error(`hotel ${br} ${status} ${last?.data?.message || ''}`);
  return {
    br,
    status,
    hotel: hotelObj?.name || 'Hilltop Mumbai',
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    amount: room.price?.totalAmount,
  };
}

async function bookFlight(flight, client) {
  const names = [
    ['Arjun', `Nair${letterTag()}`],
    ['Vivaan', `Mehta${letterTag()}`],
  ];
  const searchBody = buildOneWaySearchBody(42, {
    origin: 'BOM',
    destination: 'DEL',
    maxStops: 0,
    fareType: 'NORMAL',
  });
  searchBody.preferences.airlines = ['6E'];

  let last = null;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.search(searchBody);
    if (last.ok && isSearchProgressComplete(last.data)) break;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  const opt = collectOptions(last?.data, 'ONWARD').find(
    (o) => String(o.segments?.[0]?.airline?.code || '').toUpperCase() === '6E',
  );
  if (!opt) throw new Error('no 6E option');
  const searchId = pickFareSearchId(opt, { fareType: 'NORMAL' }) || opt.searchId;
  const flightLabel = `${opt.segments?.[0]?.airline?.code} ${opt.segments?.[0]?.flightNumber}`;
  console.log('picked', flightLabel, searchId);

  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
    throw new Error(`pricing ${brief(pricing.data)}`);
  }

  const left = [];
  for (const [firstName, lastName] of names) {
    const issueBody = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [searchId],
      journeyType: 'ONE_WAY',
      passengerProfile: { firstName, lastName },
    });
    const issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: issueBody,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const br = issue.data?.bookingReference;
    console.log('issue', issue.status, br || brief(issue.data), firstName, lastName);
    if (!br) throw new Error(`issue fail ${brief(issue.data)}`);

    let status = null;
    for (let i = 0; i < 8; i += 1) {
      const st = await flight.getBookingStatus(br);
      status = String(st.data?.status || '');
      console.log('flight status', i + 1, status);
      if (/confirm/i.test(status)) {
        const det = await flight.getBookingDetail(br);
        return {
          br,
          status,
          flight: flightLabel,
          route: 'BOM-DEL',
          passenger: `${firstName} ${lastName}`,
          pnr: det.data?.bookingResponse?.itinerary?.[0]?.pnr || null,
        };
      }
      if (/inprogress/i.test(status)) {
        console.log('leave Inprogress', br);
        left.push({ br, status });
        break;
      }
      if (isTerminalBookingStatus(status) && !/pending/i.test(status)) {
        left.push({ br, status });
        break;
      }
      await sleep(4000);
    }
  }
  throw new Error(`no confirmed flight ${JSON.stringify(left)}`);
}

async function main() {
  clearSession();
  console.log('Base', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);
  const flight = new FlightService(session.client);

  console.log('\n=== HOTEL ===');
  const hotelBook = await bookHotel(hotel);
  console.log('HOTEL', hotelBook);

  console.log('\n=== FLIGHT ===');
  const flightBook = await bookFlight(flight, session.client);
  console.log('FLIGHT', flightBook);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    hotel: hotelBook,
    flight: flightBook,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nWrote', OUT);
}

main().catch((e) => {
  console.error('STOP:', e.message || e);
  process.exit(1);
});
