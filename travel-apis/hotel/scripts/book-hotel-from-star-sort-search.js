/**
 * Book from filtered+sorted CITY search (4★ + free cancel, price_ASC and price_DESC).
 * Checks listing params do not break details → prebook → finalize.
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/book-hotel-from-star-sort-search.js
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
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
const OUT = 'reports/book-hotel-from-star-sort-search.json';

const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const FQ = {
  df_long_star_rating: [4],
  'Reservation policy': ['Free cancellation'],
};
const STAY = { checkin: '2026-10-14', checkout: '2026-10-15' };
const ROOMS = [{ adults: 1, children: 0, childrenAges: [] }];

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function citySearch(client, { entityId, sort }) {
  return client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { currency: 'INR', page: 0, perpage: 20, lang: 'en', sort },
    body: {
      ...STAY,
      entityId,
      nationality: 'IN',
      type: 'CITY',
      rooms: ROOMS,
      fq: FQ,
    },
    correlation: true,
  });
}

async function waitTerminal(hotel, br) {
  let last = null;
  for (let i = 0; i < 16; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', i + 1, st, last.data?.message || '');
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(4000);
  }
  return last;
}

async function tryBook(hotel, client, hotelHit, pickLabel) {
  const entityId = String(hotelHit.id);
  console.log(`  details ${hotelHit.name} ${entityId} star=${hotelHit.starRating}`);

  const searchHotel = await client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { currency: 'INR', page: 0, perpage: 20, lang: 'en' },
    body: { ...STAY, entityId, nationality: 'IN', type: 'HOTEL', rooms: ROOMS },
    correlation: true,
  });
  if (!searchHotel.ok) {
    return { ok: false, step: 'hotel-search', http: searchHotel.status, error: searchHotel.data?.error };
  }

  const details = await hotel.getDetails({
    ...STAY,
    entityId,
    nationality: 'IN',
    rooms: ROOMS,
  });
  const requestId = extractRequestId(details.data);
  const hotelObj = details.data?.results?.[0];
  const rooms = (hotelObj?.rooms || [])
    .filter((r) => r.available !== false && r.bookingCode)
    .sort((a, b) => (money(a.price?.totalAmount) ?? 1e12) - (money(b.price?.totalAmount) ?? 1e12));
  if (!requestId || !rooms.length) {
    return { ok: false, step: 'details', name: hotelObj?.name || hotelHit.name, rooms: rooms.length };
  }

  const room = rooms[0];
  const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  if (!isPrebookSuccess(pre)) {
    return {
      ok: false,
      step: 'prebook',
      http: pre.status,
      error: pre.data?.error || pre.data,
      name: hotelObj?.name,
    };
  }

  const body = {
    bookingContext: extractBookingContext(pre.data),
    bookingCode: room.bookingCode,
    requestId,
    checkin: STAY.checkin,
    checkout: STAY.checkout,
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
      email: `hotel.sort.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: PAN.panCardNumber,
      panCardName: PAN.panCardName,
    },
  };
  if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

  const fin = await hotel.finalizeBooking(body);
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
  if (!fin.ok || !br) {
    return {
      ok: false,
      step: 'finalize',
      http: fin.status,
      error: fin.data?.error || fin.data,
      name: hotelObj?.name,
    };
  }

  const stRes = await waitTerminal(hotel, br);
  const status = String(stRes?.data?.status || '');
  const confirmed = /confirm/i.test(status);
  return {
    ok: confirmed,
    step: confirmed ? 'confirmed' : 'status',
    br,
    status,
    message: stRes?.data?.message || null,
    name: hotelObj?.name || hotelHit.name,
    starRating: hotelHit.starRating,
    refundable: hotelHit.refundable,
    searchFare: money(hotelHit.price?.baseFare ?? hotelHit.price?.totalAmount),
    room: room.name || room.roomType,
    amount: money(room.price?.totalAmount),
    pick: pickLabel,
  };
}

async function runScenario(hotel, client, { city, entityId, sort, pick }) {
  console.log(`\n=== ${city} sort=${sort} pick=${pick} ===`);
  const search = await citySearch(client, { entityId, sort });
  const list = search.data?.results || [];
  const fares = list.map((h) => money(h.price?.baseFare));
  console.log('city search HTTP', search.status, 'n', list.length, 'total', search.data?.totalResults);
  console.log('stars', list.map((h) => h.starRating).join(','));
  console.log('fares', fares.join(','));

  if (!search.ok || !list.length) {
    return {
      scenario: `${city} ${sort}`,
      status: 'BUG',
      actual: `CITY search failed HTTP ${search.status} n=${list.length}`,
    };
  }

  const starOk = list.every((h) => Number(h.starRating) === 4);
  const refundOk = list.every((h) => h.refundable === true);
  const hit = pick === 'first' ? list[0] : list[list.length - 1];

  const booked = await tryBook(hotel, client, hit, pick);
  const flowOk = booked.ok === true;
  return {
    scenario: `${city} 4★+freeCancel ${sort} (${pick} hotel)`,
    how: `CITY search fq+sort → HOTEL details → prebook → finalize (${hit.name})`,
    expected: 'Confirmed booking; listing filters do not break book path',
    status: flowOk ? 'PASS' : 'BUG',
    actual: flowOk
      ? `${booked.br} Confirmed ${booked.name} amt=${booked.amount}`
      : `${booked.step} ${booked.br || ''} ${booked.status || ''} ${JSON.stringify(booked.error || booked.message || booked).slice(0, 220)}`,
    searchOk: { starOk, refundOk, hotelCount: list.length, total: search.data?.totalResults },
    booked,
  };
}

async function main() {
  clearSession();
  console.log('Base', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);
  const client = session.client;

  const rows = [];
  rows.push(await runScenario(hotel, client, {
    city: 'Mumbai',
    entityId: '357389:IN',
    sort: 'price_ASC',
    pick: 'first',
  }));
  rows.push(await runScenario(hotel, client, {
    city: 'Mumbai',
    entityId: '357389:IN',
    sort: 'price_DESC',
    pick: 'first',
  }));
  rows.push(await runScenario(hotel, client, {
    city: 'Pune',
    entityId: '328605:IN',
    sort: 'price_ASC',
    pick: 'first',
  }));

  const counts = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
    total: rows.length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    stay: STAY,
    fq: FQ,
    counts,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nScore', counts);
  rows.forEach((r, i) => console.log(`${i + 1} [${r.status}] ${r.scenario} — ${r.actual}`));
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error('STOP:', e.message || e);
  process.exit(1);
});
