/**
 * B2B preprod — hotel listing starRating bucket mapping + isGSTClaimable present.
 * NO book / prebook / finalize.
 *
 * Star buckets (product):
 *   -1,0,1 → 1★ | 1.5,2 → 2★ | 2.5,3 → 3★ | 3.5,4 → 4★ | 4.5,5 → 5★
 * Listing must expose integer starRating in {1,2,3,4,5} only (no halves / -1 / 0).
 * Every listing hotel must include boolean isGSTClaimable.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-star-gst-listing-preprod.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const PERPAGE = Number(process.env.HOTEL_PERPAGE || '20');
const PAGES = Number(process.env.HOTEL_PAGES || '3'); // pages per city unfiltered

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
  { key: 'Pune', entityId: '328605:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Goa', entityId: null, resolveQ: ['north goa', 'goa', 'panaji', 'panjim'] },
  { key: 'Ahmedabad', entityId: '246774:IN', alias: 'AMD' },
];

const ALLOWED_STARS = new Set([1, 2, 3, 4, 5]);
const FORBIDDEN = /prebook|finalize|cancel|issue-ticket|\/book/i;

function assertNoBook(label) {
  if (FORBIDDEN.test(label)) throw new Error(`Refusing booking path: ${label}`);
}

function searchBody(entityId) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
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

function hotelsOf(data) {
  return (data?.results || []).map((h) => ({
    id: h.id || h.entityId || null,
    name: h.name || h.title || '',
    starRating: h.starRating,
    isGSTClaimable: Object.prototype.hasOwnProperty.call(h, 'isGSTClaimable')
      ? h.isGSTClaimable
      : (Object.prototype.hasOwnProperty.call(h, 'isGstClaimable') ? h.isGstClaimable : undefined),
    rawKeys: Object.keys(h),
  }));
}

function scoreStars(hotels) {
  const bad = [];
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, other: 0, missing: 0 };
  for (const h of hotels) {
    if (h.starRating === undefined || h.starRating === null || h.starRating === '') {
      dist.missing += 1;
      bad.push({ name: h.name, starRating: h.starRating, reason: 'missing' });
      continue;
    }
    const n = Number(h.starRating);
    if (!Number.isFinite(n) || !ALLOWED_STARS.has(n) || !Number.isInteger(n)) {
      dist.other += 1;
      bad.push({ name: h.name, starRating: h.starRating, reason: 'not_bucketed_1_to_5_int' });
    } else {
      dist[n] += 1;
    }
  }
  return { dist, bad, pass: bad.length === 0 && hotels.length > 0 };
}

function scoreGst(hotels) {
  const missing = [];
  const nonBool = [];
  let trueCount = 0;
  let falseCount = 0;
  for (const h of hotels) {
    if (h.isGSTClaimable === undefined) {
      missing.push({ name: h.name });
      continue;
    }
    if (typeof h.isGSTClaimable !== 'boolean') {
      nonBool.push({ name: h.name, value: h.isGSTClaimable });
      continue;
    }
    if (h.isGSTClaimable) trueCount += 1;
    else falseCount += 1;
  }
  return {
    missing,
    nonBool,
    trueCount,
    falseCount,
    pass: hotels.length > 0 && missing.length === 0 && nonBool.length === 0,
  };
}

async function resolveGoa(hotel) {
  for (const q of ['north goa', 'south goa', 'panaji', 'panjim', 'goa india', 'calangute']) {
    const ac = await hotel.autocomplete(q, 0, 20);
    const hits = (ac.data?.content || []).filter((x) => {
      const type = String(x.type || '').toUpperCase();
      const id = String(x.entityId || '');
      const title = String(x.title || x.name || '');
      return /CITY|TBOCITY/.test(type) && id.endsWith(':IN') && /goa|panaji|panjim|calangute/i.test(title);
    });
    if (hits[0]?.entityId) {
      return { entityId: String(hits[0].entityId), title: hits[0].title, q };
    }
  }
  return null;
}

async function main() {
  console.log('=== Hotel starRating + isGSTClaimable listing (PREPROD, no book) ===');
  console.log('BASE', process.env.BASE_URL);
  console.log('dates', CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);
  assertNoBook('/v1/hotels/search');

  // resolve Goa IN
  for (const c of CITIES) {
    if (c.entityId) continue;
    const g = await resolveGoa(hotel);
    if (!g) throw new Error('Could not resolve Indian Goa city entityId');
    c.entityId = g.entityId;
    c.resolvedAs = g;
    console.log('Goa resolved', g);
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    starRule: '-1/0/1→1; 1.5/2→2; 2.5/3→3; 3.5/4→4; 4.5/5→5 (listing must show 1..5 int only)',
    note: 'Listing only POST /v1/hotels/search. No book.',
    cities: [],
    counts: { PASS: 0, BUG: 0, NOT_TESTED: 0 },
  };

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} (${city.entityId}) ===`);
    const cityRow = {
      city: city.key,
      alias: city.alias || null,
      entityId: city.entityId,
      resolvedAs: city.resolvedAs || null,
      searchHttp: null,
      hotelsSampled: 0,
      star: null,
      gst: null,
      filterChecks: [],
      verdict: 'NOT_TESTED',
      issues: [],
    };

    const collected = [];
    let searchOk = false;
    for (let page = 0; page < PAGES; page += 1) {
      const res = await hotel.search(searchBody(city.entityId), {
        pid: 'vgm',
        offset: page * PERPAGE,
        limit: PERPAGE,
        page: 0,
        perpage: PERPAGE,
      });
      if (page === 0) cityRow.searchHttp = res.status;
      if (!res.ok) {
        cityRow.issues.push(`search page${page} http=${res.status}`);
        break;
      }
      searchOk = true;
      const batch = hotelsOf(res.data);
      if (batch.length === 0) break;
      collected.push(...batch);
    }

    cityRow.hotelsSampled = collected.length;
    if (!searchOk || collected.length === 0) {
      cityRow.verdict = 'NOT_TESTED';
      report.counts.NOT_TESTED += 1;
      report.cities.push(cityRow);
      console.log('  NOT TESTED — no hotels');
      continue;
    }

    const star = scoreStars(collected);
    const gst = scoreGst(collected);
    cityRow.star = { pass: star.pass, dist: star.dist, badSample: star.bad.slice(0, 8) };
    cityRow.gst = {
      pass: gst.pass,
      trueCount: gst.trueCount,
      falseCount: gst.falseCount,
      missing: gst.missing.length,
      nonBool: gst.nonBool.length,
      missingSample: gst.missing.slice(0, 5),
      nonBoolSample: gst.nonBool.slice(0, 5),
    };

    // Filter each star 1..5 using partner fq string form: df_long_star_rating:N
    for (const want of [1, 2, 3, 4, 5]) {
      const body = searchBody(city.entityId);
      body.fq = [`df_long_star_rating:${want}`];
      const res = await hotel.search(body, { pid: 'vgm', offset: 0, limit: PERPAGE, page: 0, perpage: PERPAGE });
      const hotels = hotelsOf(res.data);
      if (!res.ok) {
        cityRow.filterChecks.push({
          star: want, http: res.status, n: 0, allMatch: false, used: 'fq[] string', status: 'BUG',
        });
        continue;
      }
      if (hotels.length === 0) {
        cityRow.filterChecks.push({
          star: want, http: 200, n: 0, allMatch: true, used: 'fq[] string', status: 'NOT_TESTED', note: 'no inventory',
        });
        continue;
      }
      const mismatch = hotels.filter((h) => Number(h.starRating) !== want);
      const halfOrBad = hotels.filter((h) => {
        const n = Number(h.starRating);
        return !Number.isInteger(n) || !ALLOWED_STARS.has(n);
      });
      const allMatch = mismatch.length === 0 && halfOrBad.length === 0;
      cityRow.filterChecks.push({
        star: want,
        http: 200,
        n: hotels.length,
        allMatch,
        used: 'fq[] string',
        status: allMatch ? 'PASS' : 'BUG',
        mismatchSample: mismatch.slice(0, 5).map((h) => ({ name: h.name, starRating: h.starRating })),
        badBucketSample: halfOrBad.slice(0, 5).map((h) => ({ name: h.name, starRating: h.starRating })),
      });
    }

    const filterBugs = cityRow.filterChecks.filter((f) => f.status === 'BUG').length;
    const starOk = star.pass;
    const gstOk = gst.pass;
    if (starOk && gstOk && filterBugs === 0) {
      cityRow.verdict = 'PASS';
      report.counts.PASS += 1;
    } else {
      cityRow.verdict = 'BUG';
      report.counts.BUG += 1;
      if (!starOk) cityRow.issues.push('starRating not fully bucketed to 1..5 int');
      if (!gstOk) cityRow.issues.push('isGSTClaimable missing or not boolean on some hotels');
      if (filterBugs) cityRow.issues.push(`${filterBugs} star filter mismatch(es)`);
    }

    console.log(
      `  [${cityRow.verdict}] hotels=${collected.length} stars=${JSON.stringify(star.dist)} gstT/F=${gst.trueCount}/${gst.falseCount} missingGst=${gst.missing.length} filterBugs=${filterBugs}`
    );
    report.cities.push(cityRow);
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', report.counts);
  console.log('Report', OUT);
  console.log('DONE — no bookings.');
  if (report.counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
