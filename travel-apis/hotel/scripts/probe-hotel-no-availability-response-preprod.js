/**
 * Preprod — hotel search "no availability" response reshape.
 * OLD: totalResults=0, results=[], message="No hotels found..."
 * NEW: hotel still in results with available:false, price:null (no empty message envelope required)
 *
 * Also verify AVAILABLE hotels still return full listing fields.
 * Search only — NO book / prebook / details required for availability flag (details optional smoke).
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-no-availability-response-preprod.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const PERPAGE = Number(process.env.HOTEL_PERPAGE || '20');

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
  { key: 'Pune', entityId: '328605:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Goa', entityId: '328649:IN' },
  { key: 'Ahmedabad', entityId: '246774:IN' },
];

const TARGET_HOTELS = [
  { key: 'Sahara Star', entityId: '39649446', note: 'changelog example' },
];

const DATE_SETS = [
  { label: 'baseline', checkin: CHECKIN, checkout: CHECKOUT },
  { label: 'near', checkin: '2026-08-28', checkout: '2026-08-29' },
  { label: 'far', checkin: '2027-03-15', checkout: '2027-03-16' },
  { label: 'peak', checkin: '2026-12-24', checkout: '2026-12-26' },
];

function cityBody(entityId, checkin, checkout) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin,
    checkout,
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: 'vgm',
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
}

function hotelBody(entityId, checkin, checkout) {
  return { ...cityBody(entityId, checkin, checkout), type: 'HOTEL' };
}

function summarizeHotel(h) {
  const price = h?.price || null;
  const total = price?.totalAmount ?? price?.total ?? null;
  return {
    id: h?.id ?? null,
    name: h?.name ?? null,
    starRating: h?.starRating ?? null,
    available: h?.available,
    hasAvailableKey: Object.prototype.hasOwnProperty.call(h || {}, 'available'),
    priceIsNull: h?.price === null,
    priceMissing: h?.price === undefined,
    totalAmount: total,
    refundable: h?.refundable,
    isGSTClaimable: h?.isGSTClaimable,
    amenitiesCount: Array.isArray(h?.amenities) ? h.amenities.length : 0,
    hasImage: Boolean(h?.image),
    hasAddress: Boolean(h?.address),
  };
}

function isUnavailableShape(h) {
  // New contract: listed but not bookable on these dates
  return h && h.available === false && (h.price === null || h.price === undefined);
}

function isAvailableShape(h) {
  const total = h?.price?.totalAmount ?? h?.price?.total;
  return (
    h &&
    h.available !== false &&
    h.price &&
    typeof h.price === 'object' &&
    typeof total === 'number' &&
    total >= 0 &&
    Boolean(h.name) &&
    h.starRating != null &&
    typeof h.isGSTClaimable === 'boolean'
  );
}

function oldEmptyEnvelope(data) {
  return (
    Number(data?.totalResults) === 0 &&
    Array.isArray(data?.results) &&
    data.results.length === 0 &&
    typeof data?.message === 'string' &&
    /no hotels found/i.test(data.message)
  );
}

async function main() {
  console.log('=== Hotel no-availability response PREPROD (search only) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const rows = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  let n = 0;
  const add = (section, rule, how, expected, status, actual, extra = {}) => {
    n += 1;
    rows.push({ id: n, section, rule, how, expected, status, actual, ...extra });
    counts[status] += 1;
    console.log(`[${status}] ${section}.${n} ${rule} — ${actual}`);
  };

  const unavailableSamples = [];
  const availableSamples = [];

  // ---- A. CITY searches: available hotels must still look correct ----
  for (const city of CITIES) {
    const res = await hotel.search(cityBody(city.entityId, CHECKIN, CHECKOUT), {
      pid: 'vgm', page: 0, perpage: PERPAGE, sort: 'price_ASC',
    });
    const data = res.data || {};
    const results = data.results || [];
    const summaries = results.map(summarizeHotel);
    const avail = summaries.filter((h) => h.available !== false);
    const unavail = summaries.filter((h) => h.available === false);
    const availOk = avail.filter((h, i) => isAvailableShape(results[summaries.indexOf(h)] || results.find((r) => r.id === h.id)));
    // recount properly
    const availHotels = results.filter((h) => h.available !== false);
    const unavailHotels = results.filter((h) => h.available === false);
    const availShapeOk = availHotels.every(isAvailableShape);
    const unavailShapeOk = unavailHotels.every(isUnavailableShape);
    const hasOldEmpty = oldEmptyEnvelope(data);

    for (const h of unavailHotels) unavailableSamples.push({ city: city.key, ...summarizeHotel(h), checkin: CHECKIN });
    for (const h of availHotels.slice(0, 3)) availableSamples.push({ city: city.key, ...summarizeHotel(h) });

    add(
      'CITY_AVAIL',
      `${city.key}: available hotels still have price + listing fields`,
      `POST /v1/hotels/search CITY ${city.entityId}`,
      'HTTP 200; available hotels have name, starRating, price.totalAmount>=0, isGSTClaimable boolean; available!==false',
      res.status === 200 && availHotels.length > 0 && availShapeOk && !hasOldEmpty
        ? 'PASS'
        : res.status === 200 && availHotels.length === 0
          ? 'NOT_TESTED'
          : 'BUG',
      `http=${res.status} total=${data.totalResults} page=${results.length} avail=${availHotels.length} unavail=${unavailHotels.length} availShapeOk=${availShapeOk} oldEmptyMsg=${hasOldEmpty}`,
      {
        city: city.key,
        entityId: city.entityId,
        availableSample: availHotels.slice(0, 3).map(summarizeHotel),
        unavailableSample: unavailHotels.slice(0, 5).map(summarizeHotel),
      },
    );

    if (unavailHotels.length) {
      add(
        'CITY_UNAVAIL',
        `${city.key}: unavailable hotels use new shape (available:false, price:null)`,
        `same CITY search — available:false rows`,
        'available===false and price===null; still has id/name/starRating; no legacy empty-only envelope',
        unavailShapeOk ? 'PASS' : 'BUG',
        `n=${unavailHotels.length} shapeOk=${unavailShapeOk} sample=${unavailHotels.slice(0, 2).map((h) => `${h.id}:${h.name}:avail=${h.available}:price=${h.price}`).join(' | ')}`,
        { sample: unavailHotels.slice(0, 5).map(summarizeHotel) },
      );
    } else {
      add(
        'CITY_UNAVAIL',
        `${city.key}: unavailable hotels on baseline dates`,
        'CITY search',
        'at least one available:false OR covered by HOTEL probes',
        'NOT_TESTED',
        'no available:false on first page baseline dates',
      );
    }
  }

  // ---- B. Targeted HOTEL searches (Sahara Star + date sets) ----
  for (const th of TARGET_HOTELS) {
    let sawNewUnavail = false;
    let sawAvail = false;
    let sawOldEmpty = false;
    const attempts = [];

    for (const ds of DATE_SETS) {
      const res = await hotel.search(hotelBody(th.entityId, ds.checkin, ds.checkout), {
        pid: 'vgm', page: 0, perpage: 20, sort: 'price_ASC',
      });
      const data = res.data || {};
      const results = data.results || [];
      const hit = results.find((h) => String(h.id) === String(th.entityId)) || results[0] || null;
      const oldEmpty = oldEmptyEnvelope(data);
      if (oldEmpty) sawOldEmpty = true;
      const row = {
        dates: ds.label,
        checkin: ds.checkin,
        checkout: ds.checkout,
        http: res.status,
        totalResults: data.totalResults,
        message: data.message || null,
        oldEmptyEnvelope: oldEmpty,
        resultsCount: results.length,
        hotel: hit ? summarizeHotel(hit) : null,
        newUnavailShape: hit ? isUnavailableShape(hit) : false,
        availableShape: hit ? isAvailableShape(hit) : false,
      };
      attempts.push(row);
      if (row.newUnavailShape) sawNewUnavail = true;
      if (row.availableShape) sawAvail = true;
      console.log(
        `  HOTEL ${th.key} ${ds.label}: http=${res.status} total=${data.totalResults} n=${results.length} avail=${hit?.available} priceNull=${hit?.price === null} oldEmpty=${oldEmpty}`,
      );
    }

    add(
      'HOTEL_TARGET',
      `${th.key} (${th.entityId}): new unavailable response when sold out`,
      'POST /v1/hotels/search type=HOTEL across date sets',
      'When no inventory: hotel still returned with available:false, price:null (NOT empty results+message only)',
      sawNewUnavail ? 'PASS' : sawOldEmpty ? 'BUG' : 'NOT_TESTED',
      sawNewUnavail
        ? 'saw available:false + price:null'
        : sawOldEmpty
          ? 'still old empty envelope with message'
          : 'never hit unavailable on date sets (hotel always available or missing)',
      { attempts },
    );

    // If we saw available on some dates, confirm not broken
    if (sawAvail) {
      const okAttempts = attempts.filter((a) => a.availableShape);
      add(
        'HOTEL_TARGET',
        `${th.key}: available dates still return priced hotel`,
        'HOTEL search when inventory exists',
        'available!==false, price.totalAmount present',
        okAttempts.length ? 'PASS' : 'BUG',
        `availableDateHits=${okAttempts.length}`,
        { sample: okAttempts[0] },
      );
    }
  }

  // ---- C. Scan more Mumbai HOTEL ids from city list for unavailable ----
  const mum = await hotel.search(cityBody('357389:IN', CHECKIN, CHECKOUT), {
    pid: 'vgm', page: 0, perpage: 10, sort: 'price_ASC',
  });
  const mumHotels = (mum.data?.results || []).slice(0, 5);
  // Try peak dates on these hotel IDs to force unavailability
  let forcedUnavail = 0;
  let forcedOldEmpty = 0;
  const forced = [];
  for (const h of mumHotels) {
    const res = await hotel.search(hotelBody(h.id, '2026-12-24', '2026-12-26'), {
      pid: 'vgm', page: 0, perpage: 5,
    });
    const data = res.data || {};
    const hit = (data.results || [])[0];
    if (oldEmptyEnvelope(data)) forcedOldEmpty += 1;
    if (hit && isUnavailableShape(hit)) forcedUnavail += 1;
    forced.push({
      id: h.id,
      name: h.name,
      http: res.status,
      total: data.totalResults,
      message: data.message || null,
      oldEmpty: oldEmptyEnvelope(data),
      hotel: hit ? summarizeHotel(hit) : null,
    });
  }
  add(
    'FORCE_UNAVAIL',
    'Mumbai sample hotels on peak dates — prefer new unavail shape over old empty message',
    'HOTEL search ids from Mumbai listing, dates 2026-12-24/26',
    'If no inventory: available:false+price:null (not only empty+message)',
    forcedUnavail > 0 ? 'PASS' : forcedOldEmpty > 0 ? 'BUG' : 'NOT_TESTED',
    `forcedUnavail=${forcedUnavail} oldEmpty=${forcedOldEmpty} probed=${forced.length}`,
    { forced },
  );

  // ---- D. Contract: never regress available hotels' core fields across cities ----
  const brokenAvail = availableSamples.filter((h) => {
    return !(
      h.name &&
      h.starRating != null &&
      h.totalAmount != null &&
      h.totalAmount >= 0 &&
      typeof h.isGSTClaimable === 'boolean' &&
      h.available !== false
    );
  });
  add(
    'REGRESSION',
    'Available hotel listing fields not impacted',
    'sampled available hotels from 8 cities',
    'name, starRating, totalAmount>=0, isGSTClaimable boolean, available!==false',
    brokenAvail.length === 0 && availableSamples.length > 0 ? 'PASS' : 'BUG',
    `sampled=${availableSamples.length} broken=${brokenAvail.length}`,
    { brokenAvail: brokenAvail.slice(0, 10), availableSamples: availableSamples.slice(0, 16) },
  );

  // ---- E. If any unavailable found globally, message field should not be required empty envelope ----
  add(
    'CONTRACT',
    'Unavailable hotels collected across run',
    'aggregate',
    'at least one example of new shape OR documented NOT_TESTED',
    unavailableSamples.length || rows.some((r) => r.section === 'HOTEL_TARGET' && r.status === 'PASS')
      ? 'PASS'
      : 'NOT_TESTED',
    `unavailableSamples=${unavailableSamples.length}`,
    { unavailableSamples: unavailableSamples.slice(0, 20) },
  );

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    note: 'No book. Verify no-availability listing reshape + available hotels unchanged.',
    expectedNewUnavail: {
      available: false,
      price: null,
      hotelStillInResults: true,
      notOnlyEmptyMessageEnvelope: true,
    },
    counts,
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
