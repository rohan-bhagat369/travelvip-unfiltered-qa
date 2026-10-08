/**
 * Hotel multipax booking-details + finalize guest-count validations (api-staging).
 * Positive: search 3ADT+2CHD → finalize all 5 guests → detail should list all pax (+ child ages).
 * Negative: same search occupancy → finalize with only lead → expect 400 VALIDATION_ERROR.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-hotel-multipax-pax-details-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/hotel-multipax-pax-details-staging.json';
const CITY = '357389:IN';
const OCC = { adults: 3, children: 2, childrenAges: [5, 9] };
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

function fullGuests() {
  return [
    { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true },
    { title: 'Ms', firstName: 'Anita', lastName: 'Sharma', type: 'Adult', isLead: false },
    { title: 'Mr', firstName: 'Amit', lastName: 'Kumar', type: 'Adult', isLead: false },
    { title: 'Mstr', firstName: 'Aarav', lastName: 'Sharma', type: 'Child', age: 5, isLead: false },
    { title: 'Mstr', firstName: 'Diya', lastName: 'Sharma', type: 'Child', age: 9, isLead: false },
  ];
}

function leadOnlyGuests() {
  return [
    { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true },
  ];
}

function extractGuestsFromDetail(det) {
  const rooms = det?.rooms || [];
  return rooms.flatMap((r) => r.guests || []);
}

async function findPrebook(hotel, checkin, checkout) {
  const roomsOcc = [{ ...OCC }];
  const city = await hotel.search({
    entityId: CITY,
    type: 'CITY',
    nationality: 'IN',
    checkin,
    checkout,
    rooms: roomsOcc,
  });
  const hotels = (city.data?.results || []).filter((h) => h.available && h.price);
  // Prefer non-dorm names when possible; still try first few once
  const ranked = [...hotels].sort((a, b) => {
    const an = String(a.name || '').toLowerCase();
    const bn = String(b.name || '').toLowerCase();
    const ad = /dorm/i.test(an) ? 1 : 0;
    const bd = /dorm/i.test(bn) ? 1 : 0;
    return ad - bd || (a.price?.totalAmount ?? 0) - (b.price?.totalAmount ?? 0);
  });

  for (const h of ranked.slice(0, 5)) {
    const entityId = String(h.id || h.entityId);
    const searchBody = {
      entityId,
      type: 'HOTEL',
      nationality: 'IN',
      checkin,
      checkout,
      rooms: roomsOcc,
    };
    const details = await hotel.getDetails(searchBody);
    const result = details.data?.results?.[0];
    const room = (result?.rooms || [])
      .filter((r) => r.bookingCode && r.available !== false)
      .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12))[0];
    if (!room) continue;
    const requestId = extractRequestId(details.data);
    const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    if (!isPrebookSuccess(pre)) continue;
    const ctx = extractBookingContext(pre.data);
    if (!ctx) continue;
    return {
      hotelName: result?.name,
      entityId,
      checkin,
      checkout,
      room,
      requestId,
      pre,
      ctx,
      amount: room.price?.totalAmount,
    };
  }
  return null;
}

function buildFinalize(stay, guests) {
  const body = {
    bookingContext: stay.ctx,
    bookingCode: stay.room.bookingCode,
    requestId: stay.requestId,
    checkin: stay.checkin,
    checkout: stay.checkout,
    rooms: [{ guests }],
    contact: {
      email: `hotel.multipax.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      ...PAN,
    },
  };
  if (stay.room.isGSTClaimable || stay.room.isGstClaimable) {
    body.gstDetails = { ...GST };
  }
  return body;
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const rows = [];

  // Existing BR from partner report
  {
    const br = 'BR1788514429404003';
    const det = await hotel.getBookingDetail(br);
    const guests = extractGuestsFromDetail(det.data);
    const adults = guests.filter((g) => /adult/i.test(g.type || '')).length;
    const children = guests.filter((g) => /child/i.test(g.type || '')).length;
    const ages = guests.filter((g) => g.age != null).map((g) => g.age);
    const hasOnlyLead = guests.length === 1;
    rows.push({
      id: 'EXISTING-BR-DETAIL',
      rule: 'Booking detail for Confirmed multipax BR returns all pax + child ages',
      how: `GET /v1/hotels/bookings/${br}`,
      expected: '3 adults + 2 children with ages (or occupancy summary)',
      actual: `HTTP ${det.status} guests=${guests.length} adults=${adults} children=${children} ages=${JSON.stringify(ages)} guests=${brief(guests, 300)}`,
      status: guests.length >= 5 && children >= 2 ? 'PASS' : 'BUG',
      note: hasOnlyLead ? 'Only lead pax returned — cannot identify multipax from detail' : '',
    });
  }

  const checkin = futureDate(30);
  const checkout = futureDate(31);
  console.log('Finding prebook for', OCC, checkin);

  // NEGATIVE: need its own prebook (don't reuse after failed finalize if any)
  const stayNeg = await findPrebook(hotel, checkin, checkout);
  if (!stayNeg) {
    rows.push({
      id: 'NEG-LEAD-ONLY',
      rule: 'Search 3ADT+2CHD then finalize with only lead guest → reject',
      how: 'city search → details → prebook → finalize rooms[0].guests=[lead]',
      expected: 'HTTP 400 VALIDATION_ERROR (guest count vs occupancy)',
      actual: 'no inventory for 3ADT+2CHD (first 5 hotels)',
      status: 'NOT TESTED',
    });
    rows.push({
      id: 'POS-FULL-MULTIPAX',
      rule: 'Search+finalize 3ADT+2CHD full guests; detail lists all pax',
      how: 'full 5 guests finalize → GET booking detail',
      expected: 'Confirmed + detail guests >= 5 with child ages',
      actual: 'no inventory',
      status: 'NOT TESTED',
    });
  } else {
    console.log('NEG hotel', stayNeg.hotelName, stayNeg.amount);
    const negBody = buildFinalize(stayNeg, leadOnlyGuests());
    const negFin = await hotel.finalizeBooking(negBody);
    const negBr = negFin.data?.bookingRefId || negFin.data?.bookingReferenceId || null;
    const negCode = errCode(negFin);
    const negPass =
      negFin.status === 400
      && negCode === 'VALIDATION_ERROR'
      && !negBr;
    rows.push({
      id: 'NEG-LEAD-ONLY',
      rule: 'Search 3ADT+2CHD then finalize with only lead guest → reject',
      how: `${stayNeg.hotelName} entity=${stayNeg.entityId}; guests.length=1 vs search adults=3 children=2`,
      expected: 'HTTP 400 VALIDATION_ERROR; no BR',
      actual: `HTTP ${negFin.status} code=${negCode} br=${negBr} ${brief(negFin.data, 280)}`,
      status: negPass ? 'PASS' : (negBr ? 'BUG' : (/4\d\d/.test(String(negFin.status)) ? 'PASS' : 'BUG')),
      note: negBr ? 'Invalid guest count accepted and BR created' : '',
      payloadGuests: leadOnlyGuests(),
    });

    // Fresh stay for positive (don't reuse same bookingCode after neg)
    const stayPos = await findPrebook(hotel, futureDate(35), futureDate(36));
    if (!stayPos) {
      rows.push({
        id: 'POS-FULL-MULTIPAX',
        rule: 'Search+finalize 3ADT+2CHD full guests; detail lists all pax',
        how: 'full 5 guests',
        expected: 'Confirmed + detail all pax',
        actual: 'no second inventory slot',
        status: 'NOT TESTED',
      });
    } else {
      console.log('POS hotel', stayPos.hotelName, stayPos.amount);
      const guests = fullGuests();
      const posBody = buildFinalize(stayPos, guests);
      const posFin = await hotel.finalizeBooking(posBody);
      const posBr = posFin.data?.bookingRefId || posFin.data?.bookingReferenceId || null;
      let bookStatus = posFin.data?.status || null;
      let detailGuests = [];
      let det = null;
      if (posBr) {
        let st = await hotel.getBookingStatus(posBr);
        for (let i = 0; i < 10 && !isTerminalHotelStatus(st.data?.status); i++) {
          await sleep(2500);
          st = await hotel.getBookingStatus(posBr);
        }
        bookStatus = st.data?.status || bookStatus;
        det = await hotel.getBookingDetail(posBr);
        detailGuests = extractGuestsFromDetail(det.data);
      }
      const adults = detailGuests.filter((g) => /adult/i.test(g.type || '')).length;
      const children = detailGuests.filter((g) => /child/i.test(g.type || '')).length;
      const ages = detailGuests.filter((g) => g.age != null).map((g) => g.age);
      const confirmed = /confirm/i.test(String(bookStatus || ''));
      const detailOk = detailGuests.length >= 5 && adults >= 3 && children >= 2;
      let status = 'BUG';
      if (!posBr) status = 'BUG';
      else if (/inprogress/i.test(String(bookStatus || ''))) status = 'NOT TESTED';
      else if (confirmed && detailOk) status = 'PASS';
      else if (confirmed && !detailOk) status = 'BUG';
      else if (/fail/i.test(String(bookStatus || ''))) status = 'BUG';

      rows.push({
        id: 'POS-FULL-MULTIPAX',
        rule: 'Search+finalize 3ADT+2CHD full guests; detail lists all pax + ages',
        how: `${stayPos.hotelName}; finalize 3ADT+2CHD; GET bookings/{BR}`,
        expected: 'Confirmed; detail guests include 3 Adult + 2 Child with ages 5,9',
        actual: `HTTP ${posFin.status} br=${posBr} bookStatus=${bookStatus} detailGuests=${detailGuests.length} adults=${adults} children=${children} ages=${JSON.stringify(ages)} ${brief(detailGuests, 350)}`,
        status,
        note: confirmed && !detailOk
          ? 'Book Confirmed but booking detail only returns partial/lead pax — product gap'
          : '',
        br: posBr,
        hotel: stayPos.hotelName,
        detailSnippet: det ? brief(det.data, 500) : null,
      });
    }
  }

  // Extra negative: guest count mismatch (2 adults only when search was 3+2)
  {
    const stay = await findPrebook(hotel, futureDate(40), futureDate(41));
    if (!stay) {
      rows.push({
        id: 'NEG-UNDERCOUNT-ADULTS',
        rule: 'Finalize with 2 adults 0 children vs search 3ADT+2CHD',
        how: 'mismatch occupancy',
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: 'no inventory',
        status: 'NOT TESTED',
      });
    } else {
      const guests = [
        { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true },
        { title: 'Ms', firstName: 'Anita', lastName: 'Sharma', type: 'Adult', isLead: false },
      ];
      const fin = await hotel.finalizeBooking(buildFinalize(stay, guests));
      const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
      const pass = fin.status === 400 && errCode(fin) === 'VALIDATION_ERROR' && !br;
      rows.push({
        id: 'NEG-UNDERCOUNT-ADULTS',
        rule: 'Finalize with 2 adults 0 children vs search 3ADT+2CHD',
        how: `${stay.hotelName}; guests=2ADT only`,
        expected: 'HTTP 400 VALIDATION_ERROR; no BR',
        actual: `HTTP ${fin.status} code=${errCode(fin)} br=${br} ${brief(fin.data, 250)}`,
        status: pass ? 'PASS' : (br ? 'BUG' : (/^4/.test(String(fin.status)) ? 'PASS' : 'BUG')),
      });
    }
  }

  // Positive shape check: child without age on finalize
  {
    const stay = await findPrebook(hotel, futureDate(42), futureDate(43));
    if (!stay) {
      rows.push({
        id: 'NEG-CHILD-NO-AGE',
        rule: 'Child guest missing age rejected',
        how: '3ADT+2CHD guests but one child without age',
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: 'no inventory',
        status: 'NOT TESTED',
      });
    } else {
      const guests = fullGuests();
      delete guests[3].age;
      const fin = await hotel.finalizeBooking(buildFinalize(stay, guests));
      const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
      const pass = fin.status === 400 && errCode(fin) === 'VALIDATION_ERROR' && !br;
      rows.push({
        id: 'NEG-CHILD-NO-AGE',
        rule: 'Child guest missing age rejected',
        how: `${stay.hotelName}; Child without age field`,
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: `HTTP ${fin.status} code=${errCode(fin)} br=${br} ${brief(fin.data, 250)}`,
        status: pass ? 'PASS' : (br ? 'BUG' : (/^4/.test(String(fin.status)) ? 'PASS' : 'BUG')),
      });
    }
  }

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    occupancy: OCC,
    existingBr: 'BR1788514429404003',
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== MULTIPAX PAX DETAILS ===');
  console.log(summary);
  for (const r of rows) console.log(`[${r.status}] ${r.id} | ${r.actual}`);
  console.log('Report:', OUT);
  process.exitCode = summary.BUG > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
