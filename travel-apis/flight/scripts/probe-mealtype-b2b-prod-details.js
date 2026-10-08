/**
 * B2B PRODUCTION — mealType vs inclusion check through hotel DETAILS only.
 * NEVER calls prebook / finalize / cancel / book.
 *
 * Scope:
 *  - Focus hotels: Sundeep Inn (Delhi), Bloom HSR (Bengaluru)
 *  - Cities: Mumbai, Delhi, Bengaluru, Hyderabad, Chennai — 5 hotels each
 *
 * Scoring:
 *  - Same room title with multiple rate plans = EXPECTED (not a bug)
 *  - BUG only when MealType=No Meal AND Inclusion contains Breakfast
 *  - Dev confirmed different room titles (Bloom) = expected
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../../hotel/src/service.js';

const FORBIDDEN = /prebook|finalize|cancel|issue-ticket|\/book/i;
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const OUT = path.join('reports', 'mealtype-b2b-prod-details.json');

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Bengaluru', entityId: '341153:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
];

const FOCUS = [
  { key: 'Sundeep Inn', city: 'Delhi', entityId: '39637795', cityEntityId: '227760:IN' },
  { key: 'Bloom Hotel - Hsr Layout Sec 6', city: 'Bengaluru', entityId: '53602106', cityEntityId: '341153:IN' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasBF = (s) => /breakfast|\bbb\b|\bcp\b/i.test(String(s || ''));
const isNoMeal = (s) => /^no\s*meal$/i.test(String(s || '').trim());

function assertNoBookPath(label) {
  if (FORBIDDEN.test(label)) {
    throw new Error(`Refusing booking path: ${label}`);
  }
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
      star: h.starRating ?? h.star ?? h.rating ?? null,
      address: h.address || h.location || null,
    }))
    .filter((h) => h.entityId);
}

function extractRooms(detailsData) {
  const hotel = detailsData?.results?.[0] || detailsData?.content?.[0] || {};
  const rooms = hotel.rooms || hotel.data?.roomDetail?.Rooms || detailsData?.roomsInfo || [];
  if (!Array.isArray(rooms)) return [];
  const hotelName = hotel.name || hotel.title || detailsData?.results?.[0]?.name || '';
  const address = hotel.address || hotel.location || null;

  return rooms.map((r, i) => {
    const nameRaw = r.title || r.Title || r.roomType || r.RoomType || r.name || r.Name || `Room ${i + 1}`;
    const name = Array.isArray(nameRaw) ? nameRaw.join(' / ') : String(nameRaw);
    const mealType = r.mealType || r.MealType || '';
    const inclusion = r.inclusion || r.Inclusion || '';
    const total =
      r.price?.totalAmount ??
      r.TotalFare ??
      r.totalAmount ??
      r.priceDetail?.totalPrice ??
      null;
    return {
      name,
      mealType: String(mealType || ''),
      inclusion: Array.isArray(inclusion) ? inclusion.join(' | ') : String(inclusion || ''),
      total,
      hotelName,
      address,
    };
  });
}

function scoreRoom(room) {
  if (isNoMeal(room.mealType) && hasBF(room.inclusion)) {
    return { verdict: 'BUG', note: 'MealType=No Meal but Inclusion has Breakfast' };
  }
  if (hasBF(room.mealType) && hasBF(room.inclusion)) {
    return { verdict: 'PASS', note: 'Breakfast MealType + Inclusion aligned' };
  }
  if (isNoMeal(room.mealType) && !hasBF(room.inclusion)) {
    return { verdict: 'PASS', note: 'Room Only consistent' };
  }
  return { verdict: 'PASS', note: `meal=${room.mealType || '(empty)'}` };
}

function hotelSummary(rows) {
  const bugs = rows.filter((r) => r.verdict === 'BUG');
  const titles = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  return {
    rates: rows.length,
    uniqueTitles: titles.size,
    mismatches: bugs.length,
    verdict: bugs.length ? 'BUG' : rows.length ? 'PASS' : 'NOT TESTED',
    bugSamples: bugs.slice(0, 5).map((b) => ({
      name: b.name,
      mealType: b.mealType,
      inclusion: String(b.inclusion).replace(/<br\s*\/?>/gi, ' | ').slice(0, 160),
      total: b.total,
    })),
  };
}

async function detailsForHotel(hotel, body) {
  assertNoBookPath('/v1/hotels/details');
  const det = await hotel.getDetails(body);
  const rooms = extractRooms(det.data).map((r) => ({ ...r, ...scoreRoom(r) }));
  const hotelBlock = det.data?.results?.[0] || {};
  return {
    http: det.status,
    ok: Boolean(det.ok),
    hotelName: hotelBlock.name || rooms[0]?.hotelName || body.entityId,
    address: hotelBlock.address || rooms[0]?.address || null,
    entityId: String(body.entityId),
    rooms,
    summary: hotelSummary(rooms),
    error: det.ok ? null : det.data?.error || { status: det.status },
  };
}

async function main() {
  console.log('=== B2B PROD mealType check (DETAILS ONLY — no book) ===');
  console.log('BASE_URL', process.env.BASE_URL);
  console.log('TIER_ID', process.env.TIER_ID);
  console.log('dates', CHECKIN, '→', CHECKOUT);
  console.log('paths: POST /v1/hotels/search , POST /v1/hotels/details ONLY');

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
    note: 'No prebook/finalize/cancel. Same room title multi rates = expected. BUG = No Meal + Breakfast inclusion.',
    focus: [],
    cities: [],
    counts: { hotelPASS: 0, hotelBUG: 0, hotelNOT_TESTED: 0, ratePASS: 0, rateBUG: 0 },
  };

  // --- Focus hotels ---
  for (const f of FOCUS) {
    console.log(`\n=== FOCUS: ${f.key} (${f.city}) entityId=${f.entityId} ===`);
    const res = await detailsForHotel(hotel, hotelDetailsBody(f.entityId));
    const row = {
      focus: true,
      city: f.city,
      asked: f.key,
      ...res,
      rooms: res.rooms,
    };
    report.focus.push(row);
    const s = res.summary;
    console.log(`  http=${res.http} hotel=${res.hotelName} rates=${s.rates} uniqueTitles=${s.uniqueTitles} mismatches=${s.mismatches} → ${s.verdict}`);
    for (const r of res.rooms) {
      if (r.verdict === 'BUG') {
        const incl = String(r.inclusion).replace(/<br\s*\/?>/gi, ' | ').slice(0, 100);
        console.log(`  [BUG] ${r.name.trim()} | meal=${r.mealType} | ₹${r.total} | ${incl}`);
      }
    }
    for (const r of res.rooms) {
      if (r.verdict === 'BUG') report.counts.rateBUG += 1;
      else report.counts.ratePASS += 1;
    }
    if (s.verdict === 'BUG') report.counts.hotelBUG += 1;
    else if (s.verdict === 'PASS') report.counts.hotelPASS += 1;
    else report.counts.hotelNOT_TESTED += 1;
    await sleep(400);
  }

  // --- 5 cities × 5 hotels ---
  for (const city of CITIES) {
    console.log(`\n=== CITY: ${city.key} ===`);
    assertNoBookPath('/v1/hotels/search');
    const search = await hotel.search(citySearchBody(city.entityId), { page: 0, perpage: 10 });
    const list = listingHotels(search.data).slice(0, 5);
    console.log(`  search http=${search.status} hotels=${list.length}`);

    const cityRow = {
      city: city.key,
      cityEntityId: city.entityId,
      searchHttp: search.status,
      hotels: [],
    };

    if (!search.ok || list.length === 0) {
      cityRow.error = search.data?.error || { note: 'no hotels' };
      report.cities.push(cityRow);
      report.counts.hotelNOT_TESTED += 5;
      continue;
    }

    for (const h of list) {
      const res = await detailsForHotel(hotel, hotelDetailsBody(h.entityId));
      const entry = {
        askedName: h.name,
        listingStar: h.star,
        ...res,
      };
      // drop full rooms from city summary to keep report smaller — keep mismatches + count
      entry.roomCount = res.rooms.length;
      entry.mismatchRooms = res.rooms.filter((r) => r.verdict === 'BUG');
      delete entry.rooms;

      cityRow.hotels.push(entry);
      const s = res.summary;
      console.log(
        `  [${s.verdict}] ${String(res.hotelName || h.name).slice(0, 50)} | rates=${s.rates} titles=${s.uniqueTitles} mismatches=${s.mismatches}`
      );
      for (const r of res.rooms) {
        if (r.verdict === 'BUG') report.counts.rateBUG += 1;
        else report.counts.ratePASS += 1;
      }
      if (s.verdict === 'BUG') report.counts.hotelBUG += 1;
      else if (s.verdict === 'PASS') report.counts.hotelPASS += 1;
      else report.counts.hotelNOT_TESTED += 1;
      await sleep(350);
    }
    report.cities.push(cityRow);
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===');
  console.log(JSON.stringify(report.counts, null, 2));
  console.log('Report', OUT);
  console.log('DONE — no bookings made.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
