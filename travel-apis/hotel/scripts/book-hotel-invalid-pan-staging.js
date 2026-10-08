/**
 * Staging: valid hotel flow, then finalize with ONLY panCardNumber mutated invalid.
 * One hotel, one finalize. No retries.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/book-hotel-invalid-pan-staging.js
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

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', 'book-hotel-invalid-pan-staging.json');
const INVALID_PAN = 'BADPAN';
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

clearSession();
console.log('Base:', config.baseUrl, 'invalid PAN:', INVALID_PAN);
const { client } = await authenticate(true);
const hotel = new HotelService(client);

const auto = await hotel.autocomplete('hiltop', 0, 20);
const hits = (auto.data?.content || []).filter((x) => String(x.type || '').toUpperCase() === 'HOTEL');
const picked = hits.find((h) => /hiltop hotel/i.test(h.title) && /mumbai/i.test(h.city || ''));
if (!auto.ok || !picked?.entityId) {
  const report = { status: 'BUG', step: 'autocomplete', actual: brief(auto.data) };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.error('FAIL FAST: autocomplete', brief(auto.data));
  process.exit(1);
}

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

if (!details.ok || !room) {
  fs.writeFileSync(OUT, JSON.stringify({ status: 'BUG', step: 'details', actual: brief(details.data) }, null, 2));
  console.error('FAIL FAST: no rooms');
  process.exit(1);
}

const requestId = extractRequestId(details.data);
const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
if (!isPrebookSuccess(pre)) {
  fs.writeFileSync(OUT, JSON.stringify({ status: 'BUG', step: 'prebook', actual: brief(pre.data) }, null, 2));
  console.error('FAIL FAST: prebook', brief(pre.data));
  process.exit(1);
}

const body = {
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
    email: `hotel.badpan.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: config.hotel.contactMobile,
    panCardNumber: INVALID_PAN,
    panCardName: 'Rohan Bhagat',
  },
};
if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

console.log('finalize with panCardNumber=', INVALID_PAN, 'isPANMandatory=', room.isPANMandatory);
const fin = await hotel.finalizeBooking(body);
const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
const err = fin.data?.error || null;
const booked = Boolean(fin.ok && br);

let bookStatus = null;
if (br) {
  const st = await hotel.getBookingStatus(br);
  bookStatus = st.data?.status || null;
  console.log('status', bookStatus);
}

const rejected = fin.status === 400 && String(err?.code || '') === 'VALIDATION_ERROR';
const status = booked ? 'BUG' : (rejected ? 'PASS' : 'BUG');

const report = {
  host: config.baseUrl,
  at: new Date().toISOString(),
  note: 'Baseline Hilltop flow; only contact.panCardNumber mutated to BADPAN. Expected reject.',
  hotel: result?.name,
  entityId,
  isPANMandatory: room.isPANMandatory === true,
  invalidPan: INVALID_PAN,
  panCardName: 'Rohan Bhagat',
  checkin: searchBody.checkin,
  checkout: searchBody.checkout,
  finalizeHttp: fin.status,
  errorCode: err?.code || null,
  errorMessage: err?.message || null,
  errorDetails: err?.details || null,
  br,
  bookStatus,
  expected: 'HTTP 400 VALIDATION_ERROR (invalid PAN); no booking',
  actual: booked
    ? `HTTP ${fin.status} booked br=${br} status=${bookStatus}`
    : `HTTP ${fin.status} code=${err?.code} details=${JSON.stringify(err?.details || fin.data).slice(0, 240)}`,
  status,
  finalizeSnippet: brief(fin.data, 600),
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status, finalizeHttp: fin.status, errorCode: err?.code, br, bookStatus, actual: report.actual }, null, 2));
console.log('Report:', OUT);
if (status === 'BUG') process.exit(1);
