/**
 * Staging: one hotel book, then replay SAME finalize with new guest + PAN.
 * No entity/date/room retry loop.
 *
 * Hit 1: Rohan Bhagat / EUIPB1672M
 * Hit 2: Atul Ugale / ADDPU6247P  (same bookingCode, requestId, bookingContext)
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/probe-hotel-finalize-two-names-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', 'hotel-finalize-two-names-staging.json');

const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function brOf(d) {
  return d?.bookingRefId || d?.bookingReferenceId || d?.bookingReference || null;
}

async function statusOnce(hotel, br) {
  const res = await hotel.getBookingStatus(br);
  return {
    http: res.status,
    status: res.data?.status || null,
    message: res.data?.message || null,
    confirmationNumber: res.data?.confirmationNumber || null,
    snippet: brief(res.data, 360),
  };
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays: 28,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.type = 'HOTEL';
  searchBody.checkin = '2026-09-12';
  searchBody.checkout = '2026-09-13';

  const search = await hotel.search(searchBody);
  console.log('search', search.status);
  if (!search.ok) throw new Error(`search failed ${brief(search.data)}`);

  const details = await hotel.getDetails(searchBody);
  console.log('details', details.status);
  if (!details.ok) throw new Error(`details failed ${brief(details.data)}`);

  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const block = details.data?.results?.[0];
  const room = (block?.rooms || []).find((r) => r.available !== false && r.bookingCode);
  if (!requestId || !room) throw new Error('no requestId or bookable room');
  console.log('hotel', block.name, 'amt', room.price?.totalAmount);

  const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  console.log('prebook', pre.status, isPrebookSuccess(pre) ? 'ok' : brief(pre.data, 180));
  if (!isPrebookSuccess(pre)) throw new Error('prebook failed');

  const body1 = {
    bookingContext: extractBookingContext(pre.data),
    bookingCode: room.bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    rooms: [{
      guests: [{
        title: 'Mr',
        firstName: 'Rohan',
        lastName: 'Bhagat',
        type: 'Adult',
        isLead: true,
      }],
    }],
    contact: {
      email: `hotel.twohit.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
    gstDetails: { ...GST },
  };

  console.log('\n=== HIT 1 finalize Rohan Bhagat / EUIPB1672M ===');
  const fin1 = await hotel.finalizeBooking(body1);
  const br1 = brOf(fin1.data);
  console.log('finalize1 HTTP', fin1.status, 'br', br1, brief(fin1.data, 220));
  if (!br1) throw new Error(`hit1 no BR ${brief(fin1.data)}`);

  await sleep(4000);
  const st1a = await statusOnce(hotel, br1);
  console.log('status1a', st1a.status, st1a.message);
  await sleep(4000);
  const st1b = await statusOnce(hotel, br1);
  console.log('status1b', st1b.status, st1b.message);

  const body2 = clone(body1);
  body2.rooms[0].guests[0].firstName = 'Atul';
  body2.rooms[0].guests[0].lastName = 'Ugale';
  body2.contact.panCardNumber = 'ADDPU6247P';
  body2.contact.panCardName = 'Atul Ugale';

  console.log('\n=== HIT 2 same payload, Atul Ugale / ADDPU6247P ===');
  const fin2 = await hotel.finalizeBooking(body2);
  const br2 = brOf(fin2.data);
  console.log('finalize2 HTTP', fin2.status, 'br', br2, 'dup', fin2.data?.duplicate === true, brief(fin2.data, 280));

  let st2a = null;
  let st2b = null;
  if (br2) {
    await sleep(4000);
    st2a = await statusOnce(hotel, br2);
    console.log('status2a', st2a.status, st2a.message);
    await sleep(4000);
    st2b = await statusOnce(hotel, br2);
    console.log('status2b', st2b.status, st2b.message);
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    hotelName: block.name,
    entityId: '39627872',
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    requestId,
    hit1: {
      guest: 'Rohan Bhagat',
      pan: 'EUIPB1672M',
      panName: 'Rohan Bhagat',
      http: fin1.status,
      br: br1,
      finalize: brief(fin1.data, 400),
      statusAfterWait1: st1a,
      statusAfterWait2: st1b,
    },
    hit2: {
      guest: 'Atul Ugale',
      pan: 'ADDPU6247P',
      panName: 'Atul Ugale',
      sameBookingCode: body2.bookingCode === body1.bookingCode,
      sameRequestId: body2.requestId === body1.requestId,
      sameEmail: body2.contact.email === body1.contact.email,
      http: fin2.status,
      br: br2,
      duplicate: fin2.data?.duplicate === true,
      code: fin2.data?.error?.code || null,
      finalize: brief(fin2.data, 400),
      response: fin2.data,
      statusAfterWait1: st2a,
      statusAfterWait2: st2b,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nReport', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
