/**
 * Replay the same hotel finalize payload with only the guest name changed.
 * Staging, Hilltop Mumbai, same stay as last book (12→13 Sep 2026).
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/probe-hotel-finalize-rename-replay.js
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
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';

const OUT = path.join('reports', 'hotel-finalize-rename-replay-staging.json');
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
function brief(d, n = 600) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function brOf(d) {
  return d?.bookingRefId || d?.bookingReferenceId || d?.bookingReference || null;
}

async function waitStatus(hotel, br, max = 24) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status ${br} poll ${i + 1}: ${st}`);
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(4000);
  }
  return last;
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
  if (!search.ok) throw new Error(`search ${search.status} ${brief(search.data)}`);
  const details = await hotel.getDetails(searchBody);
  if (!details.ok) throw new Error(`details ${details.status} ${brief(details.data)}`);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const rooms = (details.data?.results?.[0]?.rooms || [])
    .filter((r) => r.available !== false && r.bookingCode)
    .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
  if (!requestId || !rooms.length) throw new Error('no requestId/rooms');

  const room = rooms[0];
  const hotelName = details.data?.results?.[0]?.name;
  console.log('hotel', hotelName, 'amt', room.price?.totalAmount, 'rid', requestId);

  const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  if (!isPrebookSuccess(pre)) throw new Error(`prebook ${brief(pre.data)}`);

  const bodyA = {
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
      email: `hotel.rename.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: PAN.panCardNumber,
      panCardName: PAN.panCardName,
    },
    gstDetails: { ...VALID_GST },
  };

  console.log('\n=== Finalize #1 original name ===');
  console.log('guest', bodyA.rooms[0].guests[0].firstName, bodyA.rooms[0].guests[0].lastName);
  const fin1 = await hotel.finalizeBooking(bodyA);
  const br1 = brOf(fin1.data);
  console.log('HTTP', fin1.status, 'br', br1, 'dup', fin1.data?.duplicate === true, brief(fin1.data, 280));
  let st1 = null;
  if (br1) st1 = await waitStatus(hotel, br1);

  const bodyB = clone(bodyA);
  bodyB.rooms[0].guests[0].firstName = 'Arjun';
  bodyB.rooms[0].guests[0].lastName = 'Malhotra';
  // same bookingContext, bookingCode, requestId, dates, contact, PAN — name only

  console.log('\n=== Finalize #2 SAME payload, different passenger name ===');
  console.log('guest', bodyB.rooms[0].guests[0].firstName, bodyB.rooms[0].guests[0].lastName);
  const fin2 = await hotel.finalizeBooking(bodyB);
  const br2 = brOf(fin2.data);
  console.log('HTTP', fin2.status, 'br', br2, 'dup', fin2.data?.duplicate === true, 'code', fin2.data?.error?.code || '-', brief(fin2.data, 360));
  let st2 = null;
  if (br2 && br2 !== br1) st2 = await waitStatus(hotel, br2);
  else if (br2 && br2 === br1) console.log('same BR returned — not polling as a new booking');

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    hotelName,
    entityId: '39627872',
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    requestId,
    bookingCodePrefix: String(room.bookingCode).slice(0, 48),
    hit1: {
      guest: bodyA.rooms[0].guests[0],
      http: fin1.status,
      br: br1,
      duplicate: fin1.data?.duplicate === true,
      status: st1?.data?.status || null,
      snippet: brief(fin1.data, 500),
    },
    hit2: {
      guest: bodyB.rooms[0].guests[0],
      sameBookingCode: bodyB.bookingCode === bodyA.bookingCode,
      sameRequestId: bodyB.requestId === bodyA.requestId,
      sameBookingContext: bodyB.bookingContext === bodyA.bookingContext,
      sameEmail: bodyB.contact.email === bodyA.contact.email,
      http: fin2.status,
      br: br2,
      duplicate: fin2.data?.duplicate === true,
      code: fin2.data?.error?.code || null,
      sameBrAsHit1: Boolean(br1 && br2 && br1 === br2),
      status: st2?.data?.status || (br2 === br1 ? st1?.data?.status : null),
      snippet: brief(fin2.data, 800),
      response: fin2.data,
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    hit1: report.hit1,
    hit2: {
      guest: report.hit2.guest,
      http: report.hit2.http,
      br: report.hit2.br,
      duplicate: report.hit2.duplicate,
      code: report.hit2.code,
      sameBrAsHit1: report.hit2.sameBrAsHit1,
      snippet: report.hit2.snippet,
    },
  }, null, 2));
  console.log('Report', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
