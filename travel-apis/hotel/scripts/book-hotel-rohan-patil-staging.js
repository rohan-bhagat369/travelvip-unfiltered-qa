/**
 * Staging: one hotel book. Guest Rohan Patil, PAN EUIPB1672M / Rohan Patil.
 * Fail-fast. No retries.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/book-hotel-rohan-patil-staging.js
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
const OUT = path.join('reports', 'book-hotel-rohan-patil-staging.json');
const GUEST = { firstName: 'Rohan', lastName: 'Patil' };
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Patil' };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

function stop(step, data) {
  const report = { status: 'BUG', step, actual: brief(data) };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.error('FAIL FAST:', step, brief(data));
  process.exit(1);
}

clearSession();
console.log('Base:', config.baseUrl, 'guest:', `${GUEST.firstName} ${GUEST.lastName}`, 'PAN:', PAN.panCardNumber, PAN.panCardName);
const { client } = await authenticate(true);
const hotel = new HotelService(client);

const auto = await hotel.autocomplete('hiltop', 0, 20);
const hits = (auto.data?.content || []).filter((x) => String(x.type || '').toUpperCase() === 'HOTEL');
const picked = hits.find((h) => /hiltop hotel/i.test(h.title) && /mumbai/i.test(h.city || ''));
if (!auto.ok || !picked?.entityId) stop('autocomplete', auto.data);

const entityId = String(picked.entityId);
const searchBody = buildSearchBody({
  entityId,
  checkinDays: 28,
  nights: 1,
  rooms: [{ adults: 1, children: 0, childrenAges: [] }],
});
searchBody.type = 'HOTEL';
searchBody.nationality = 'IN';

const search = await hotel.search(searchBody);
const details = await hotel.getDetails(searchBody);
const result = details.data?.results?.[0];
const rooms = (result?.rooms || [])
  .filter((r) => r?.bookingCode && r.available !== false)
  .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
const room = rooms[0];
console.log(`hotel=${result?.name} entityId=${entityId} rooms=${rooms.length} isPANMandatory=${room?.isPANMandatory}`);
if (!search.ok || !details.ok || !room) stop('details', details.data);

const requestId = extractRequestId(details.data);
const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
if (!isPrebookSuccess(pre)) stop('prebook', pre.data);

const body = {
  bookingContext: extractBookingContext(pre.data),
  bookingCode: room.bookingCode,
  requestId,
  checkin: searchBody.checkin,
  checkout: searchBody.checkout,
  rooms: [{
    guests: [{
      title: 'Mr',
      firstName: GUEST.firstName,
      lastName: GUEST.lastName,
      type: 'Adult',
      isLead: true,
    }],
  }],
  contact: {
    email: `hotel.patil.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: config.hotel.contactMobile,
    panCardNumber: PAN.panCardNumber,
    panCardName: PAN.panCardName,
  },
};
if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

const fin = await hotel.finalizeBooking(body);
const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
console.log('finalize', fin.status, br || brief(fin.data));
if (!fin.ok || !br) stop('finalize', fin.data);

let st = await hotel.getBookingStatus(br);
for (let i = 0; i < 8 && !isTerminalHotelStatus(st.data?.status); i += 1) {
  console.log(`  status ${i + 1}: ${st.data?.status}`);
  await sleep(3500);
  st = await hotel.getBookingStatus(br);
}
console.log(`  status: ${st.data?.status}`);

const det = await hotel.getBookingDetail(br);
const bookStatus = String(st.data?.status || '');
const confirmed = /confirm/i.test(bookStatus);
const report = {
  host: config.baseUrl,
  at: new Date().toISOString(),
  hotel: result?.name,
  entityId,
  guest: `${GUEST.firstName} ${GUEST.lastName}`,
  panCardNumber: PAN.panCardNumber,
  panCardName: PAN.panCardName,
  isPANMandatory: room.isPANMandatory === true,
  checkin: searchBody.checkin,
  checkout: searchBody.checkout,
  amount: room.price?.totalAmount,
  br,
  confirmationNumber: det.data?.confirmationNumber || st.data?.confirmationNumber || null,
  bookStatus,
  status: confirmed ? 'PASS' : 'BUG',
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('Report:', OUT);
if (!confirmed) process.exit(1);
