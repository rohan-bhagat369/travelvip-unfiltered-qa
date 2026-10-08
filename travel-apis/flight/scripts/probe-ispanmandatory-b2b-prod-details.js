/**
 * B2B PRODUCTION — isPANMandatory must be false on hotel DETAILS rooms.
 * NEVER calls prebook / finalize / cancel / book.
 *
 * Hotels: Sundeep Inn, Bloom HSR, + 5 cities × 5 hotels (same sample as mealType prod check).
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../../hotel/src/service.js';

const FORBIDDEN = /prebook|finalize|cancel|issue-ticket|\/book/i;
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const OUT = path.join('reports', 'ispanmandatory-b2b-prod-details.json');

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Bengaluru', entityId: '341153:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
];

const FOCUS = [
  { key: 'Sundeep Inn', city: 'Delhi', entityId: '39637795' },
  { key: 'Bloom Hotel - Hsr Layout Sec 6', city: 'Bengaluru', entityId: '53602106' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertNoBook(label) {
  if (FORBIDDEN.test(label)) throw new Error(`Refusing booking path: ${label}`);
}

function citySearchBody(cityEntityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(cityEntityId),
    nationality: 'IN',
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

function hotelDetailsBody(hotelEntityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(hotelEntityId),
    nationality: 'IN',
    type: 'HOTEL',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

function listingHotels(searchData) {
  const results = searchData?.results || searchData?.content || [];
  if (!Array.isArray(results)) return [];
  return results
    .map((h) => ({
      name: h.name || h.title || h.hotelName || '',
      entityId: String(h.entityId || h.id || h.hotelId || ''),
    }))
    .filter((h) => h.entityId);
}

function panFlag(room) {
  if (Object.prototype.hasOwnProperty.call(room, 'isPANMandatory')) return room.isPANMandatory;
  if (Object.prototype.hasOwnProperty.call(room, 'IsPANMandatory')) return room.IsPANMandatory;
  return undefined;
}

function scoreHotel(detailsData, entityId) {
  const hotel = detailsData?.results?.[0] || {};
  const rooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
  const flags = rooms.map((r, i) => {
    const name = r.title || r.roomType || r.name || `Room ${i + 1}`;
    const flag = panFlag(r);
    return {
      name: Array.isArray(name) ? name.join(' / ') : String(name),
      isPANMandatory: flag,
      total: r.price?.totalAmount ?? null,
    };
  });

  const present = flags.filter((f) => f.isPANMandatory !== undefined);
  const trueFlags = present.filter((f) => f.isPANMandatory === true);
  const falseFlags = present.filter((f) => f.isPANMandatory === false);
  const missing = flags.length - present.length;

  let verdict = 'NOT TESTED';
  let note = '';
  if (rooms.length === 0) {
    note = 'no rooms on details';
  } else if (missing === rooms.length) {
    note = 'isPANMandatory key missing on all rooms';
  } else if (trueFlags.length > 0) {
    verdict = 'BUG';
    note = `${trueFlags.length}/${rooms.length} room(s) isPANMandatory=true (expected false)`;
  } else if (falseFlags.length === rooms.length) {
    verdict = 'PASS';
    note = `all ${rooms.length} rooms isPANMandatory=false`;
  } else if (falseFlags.length > 0 && trueFlags.length === 0) {
    verdict = 'PASS';
    note = `${falseFlags.length} false, ${missing} missing key`;
  } else {
    verdict = 'BUG';
    note = 'unexpected pan flag mix';
  }

  return {
    hotelName: hotel.name || entityId,
    address: hotel.address || null,
    entityId: String(entityId),
    roomCount: rooms.length,
    trueCount: trueFlags.length,
    falseCount: falseFlags.length,
    missingCount: missing,
    trueSamples: trueFlags.slice(0, 5),
    verdict,
    note,
  };
}

async function checkDetails(hotelSvc, entityId) {
  assertNoBook('/v1/hotels/details');
  const det = await hotelSvc.getDetails(hotelDetailsBody(entityId));
  const scored = scoreHotel(det.data, entityId);
  return { http: det.status, ok: Boolean(det.ok), error: det.ok ? null : det.data?.error || null, ...scored };
}

async function main() {
  console.log('=== B2B PROD isPANMandatory=false (DETAILS ONLY — no book) ===');
  console.log('BASE_URL', process.env.BASE_URL);
  console.log('TIER_ID', process.env.TIER_ID);
  console.log('dates', CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    expect: 'isPANMandatory === false on all details rooms',
    focus: [],
    cities: [],
    counts: { PASS: 0, BUG: 0, NOT_TESTED: 0 },
    bugs: [],
  };

  const bump = (v) => {
    if (v === 'PASS') report.counts.PASS += 1;
    else if (v === 'BUG') report.counts.BUG += 1;
    else report.counts.NOT_TESTED += 1;
  };

  for (const f of FOCUS) {
    console.log(`\n=== FOCUS: ${f.key} (${f.entityId}) ===`);
    const res = await checkDetails(hotel, f.entityId);
    const row = { focus: true, city: f.city, asked: f.key, ...res };
    report.focus.push(row);
    bump(res.verdict);
    if (res.verdict === 'BUG') report.bugs.push(row);
    console.log(`  [${res.verdict}] ${res.hotelName} rooms=${res.roomCount} true=${res.trueCount} false=${res.falseCount} missing=${res.missingCount} | ${res.note}`);
    await sleep(400);
  }

  for (const city of CITIES) {
    console.log(`\n=== CITY: ${city.key} ===`);
    assertNoBook('/v1/hotels/search');
    const search = await hotel.search(citySearchBody(city.entityId), { page: 0, perpage: 10 });
    const list = listingHotels(search.data).slice(0, 5);
    console.log(`  search http=${search.status} hotels=${list.length}`);
    const cityRow = { city: city.key, cityEntityId: city.entityId, searchHttp: search.status, hotels: [] };

    for (const h of list) {
      const res = await checkDetails(hotel, h.entityId);
      const row = { askedName: h.name, ...res };
      cityRow.hotels.push(row);
      bump(res.verdict);
      if (res.verdict === 'BUG') report.bugs.push({ city: city.key, ...row });
      console.log(
        `  [${res.verdict}] ${String(res.hotelName || h.name).slice(0, 55)} | rooms=${res.roomCount} true=${res.trueCount} false=${res.falseCount} | ${res.note}`
      );
      await sleep(350);
    }
    report.cities.push(cityRow);
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', report.counts);
  console.log('bugs', report.bugs.length);
  console.log('Report', OUT);
  console.log('DONE — no bookings made.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
