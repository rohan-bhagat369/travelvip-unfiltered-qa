/**
 * api-staging: book hotels with multipax occupancy scenarios.
 * Hilltop Mumbai first; retry later checkin if unavail.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/book-hotel-multipax-staging.js
 */
import fs from 'fs';
import path from 'path';
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

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', 'book-hotel-multipax-staging.json');
const CITY = process.env.HOTEL_CITY_ENTITY || '357389:IN'; // Mumbai
const ENTITY_FALLBACK = process.env.HOTEL_ENTITY_ID || '39627872'; // Hilltop if city empty
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const SCENARIOS = [
  {
    id: '3ADT+4CHD',
    rooms: [{ adults: 3, children: 4, childrenAges: [4, 6, 8, 10] }],
  },
  {
    id: '2ADT+2CHD',
    rooms: [{ adults: 2, children: 2, childrenAges: [5, 9] }],
  },
  {
    id: '4ADT+2CHD',
    rooms: [{ adults: 4, children: 2, childrenAges: [7, 11] }],
  },
  {
    id: '2R-2ADT2CHD+2ADT1CHD',
    rooms: [
      { adults: 2, children: 2, childrenAges: [3, 8] },
      { adults: 2, children: 1, childrenAges: [6] },
    ],
  },
  {
    id: '5ADT',
    rooms: [{ adults: 5, children: 0, childrenAges: [] }],
  },
];

const CHECKIN_DAYS = [28, 35, 42, 21];

function brief(d, n = 350) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function buildGuestsForRoom(room, tag, roomIdx) {
  const guests = [];
  for (let i = 0; i < room.adults; i += 1) {
    guests.push({
      title: i === 0 && roomIdx === 0 ? 'Mr' : (i % 2 === 0 ? 'Mr' : 'Ms'),
      firstName: i === 0 && roomIdx === 0 ? 'Rohan' : `Adult${roomIdx + 1}${i + 1}`,
      lastName: `Bhagat${tag}`,
      type: 'Adult',
      isLead: i === 0 && roomIdx === 0,
    });
  }
  for (let i = 0; i < room.children; i += 1) {
    guests.push({
      title: 'Mstr',
      firstName: `Child${roomIdx + 1}${i + 1}`,
      lastName: `Bhagat${tag}`,
      type: 'Child',
      age: room.childrenAges[i],
      isLead: false,
    });
  }
  return guests;
}

async function findAvailable(hotel, scenario, days) {
  const roomsOcc = scenario.rooms.map((r) => ({
    adults: r.adults,
    children: r.children,
    childrenAges: [...r.childrenAges],
  }));
  const base = {
    nationality: 'IN',
    checkin: futureDate(days),
    checkout: futureDate(days + 1),
    rooms: roomsOcc,
  };

  // Prefer city search for multipax inventory
  const cityBody = { ...base, entityId: CITY, type: 'CITY' };
  const search = await hotel.search(cityBody);
  const hotels = search.data?.results || search.data?.hotels || search.data?.content || [];
  const list = Array.isArray(hotels) ? hotels : [];
  // Partner search shape: results[] with entityId / hotelId
  const candidates = list
    .map((h) => ({
      entityId: String(h.entityId || h.hotelId || h.id || ''),
      name: h.name || h.hotelName || h.title,
      available: h.available !== false && h.price != null,
    }))
    .filter((h) => h.entityId && h.available)
    .slice(0, 8);

  const tryIds = [
    ...candidates.map((c) => ({ entityId: c.entityId, name: c.name })),
    { entityId: ENTITY_FALLBACK, name: 'Hilltop fallback' },
  ];

  for (const cand of tryIds) {
    const searchBody = {
      ...base,
      entityId: cand.entityId,
      type: 'HOTEL',
    };
    const details = await hotel.getDetails(searchBody);
    const result = details.data?.results?.[0];
    const roomsAvail = (result?.rooms || [])
      .filter((r) => r?.bookingCode && r.available !== false)
      .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
    if (details.ok && roomsAvail[0]) {
      return {
        searchBody,
        result,
        room: roomsAvail[0],
        requestId: extractRequestId(details.data),
        hotelName: result?.name || cand.name,
      };
    }
  }
  return null;
}

async function bookOne(hotel, scenario) {
  const tag = String(Date.now()).slice(-5);
  const row = {
    id: scenario.id,
    rooms: scenario.rooms,
    status: 'NOT TESTED',
    br: null,
    bookStatus: null,
    hotel: null,
    amount: null,
    checkin: null,
    checkout: null,
    actual: '',
  };

  for (const days of CHECKIN_DAYS) {
    console.log(`\n[${scenario.id}] city/hotel search d+${days} rooms=${JSON.stringify(scenario.rooms)}`);
    const hit = await findAvailable(hotel, scenario, days);
    if (!hit) {
      row.actual = `no rooms d+${days}`;
      console.log('  no rooms');
      continue;
    }
    const { searchBody, room, requestId, hotelName, result } = hit;
    console.log(`  hotel=${hotelName} entity=${searchBody.entityId} pan=${room?.isPANMandatory} amt=${room?.price?.totalAmount}`);

    const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    if (!isPrebookSuccess(pre)) {
      row.actual = `prebook fail ${brief(pre.data)}`;
      console.log('  prebook fail', brief(pre.data));
      continue;
    }

    const finalizeRooms = scenario.rooms.map((r, idx) => ({
      guests: buildGuestsForRoom(r, tag, idx),
    }));
    const body = {
      bookingContext: extractBookingContext(pre.data),
      bookingCode: room.bookingCode,
      requestId,
      checkin: searchBody.checkin,
      checkout: searchBody.checkout,
      rooms: finalizeRooms,
      contact: {
        email: `hotel.mpax.${tag}@travelvip.ai`,
        countryCode: '+91',
        mobile: config.hotel.contactMobile,
        panCardNumber: PAN.panCardNumber,
        panCardName: PAN.panCardName,
      },
    };
    if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

    const fin = await hotel.finalizeBooking(body);
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
    console.log('  finalize', fin.status, br || brief(fin.data));
    if (!fin.ok || !br) {
      row.actual = `finalize HTTP ${fin.status} ${brief(fin.data)}`;
      if (fin.status === 400) {
        row.status = 'BUG';
        return row;
      }
      continue;
    }

    let st = await hotel.getBookingStatus(br);
    for (let i = 0; i < 10 && !isTerminalHotelStatus(st.data?.status); i += 1) {
      console.log(`  status ${i + 1}: ${st.data?.status}`);
      await sleep(3500);
      st = await hotel.getBookingStatus(br);
    }
    const bookStatus = String(st.data?.status || '');
    const det = await hotel.getBookingDetail(br);
    row.hotel = hotelName || result?.name || null;
    row.entityId = searchBody.entityId;
    row.br = br;
    row.bookStatus = bookStatus;
    row.checkin = searchBody.checkin;
    row.checkout = searchBody.checkout;
    row.amount = room.price?.totalAmount ?? det.data?.totalAmount ?? null;
    row.guestCount = finalizeRooms.reduce((n, r) => n + r.guests.length, 0);
    row.actual = `status=${bookStatus}`;
    if (/confirm/i.test(bookStatus)) row.status = 'PASS';
    else if (/inprogress/i.test(bookStatus)) row.status = 'NOT TESTED';
    else row.status = 'BUG';
    return row;
  }

  if (row.status === 'NOT TESTED' && !row.actual) row.actual = 'no availability across checkin dates';
  return row;
}

async function main() {
  clearSession();
  console.log('=== Hotel multipax books on api-staging ===');
  console.log('Base', config.baseUrl, 'city', CITY, 'fallback', ENTITY_FALLBACK);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const results = [];
  for (const sc of SCENARIOS) {
    const row = await bookOne(hotel, sc);
    results.push(row);
    console.log(`[${row.status}] ${row.id} br=${row.br} ${row.actual}`);
  }

  const summary = {
    PASS: results.filter((r) => r.status === 'PASS').length,
    BUG: results.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: results.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    cityEntityId: CITY,
    summary,
    results,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===', summary);
  console.log('Report', OUT);
  if (summary.BUG > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
