/**
 * Hotel B2B — no negative prices on search / details price breakup.
 * Domestic + international cities. Search + details only. No book.
 *
 * Spawned by hotel regression `--tags NEGPRICE`.
 *
 *   node scripts/probe-hotel-no-negative-prices.js
 *   NEGPRICE_DETAILS_PER_CITY=3 npm run hotel:regression:negprice
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { HILLTOP } from '../src/regression/fixtures.js';

const OUT = path.join('reports', process.env.REPORT_OUT || process.env.HOTEL_NEGPRICE_OUT || 'hotel-regression-negprice.json');

function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CHECKIN = process.env.HOTEL_CHECKIN || plusDays(28);
const CHECKOUT = process.env.HOTEL_CHECKOUT || plusDays(29);
const DETAILS_PER_CITY = Math.max(1, Number(process.env.NEGPRICE_DETAILS_PER_CITY || 3));
const PAGE_SIZE = Math.max(10, Number(process.env.NEGPRICE_PAGE_SIZE || 20));

/** Fixed hotels that previously caught negative-price regressions. */
const ANCHOR_HOTELS = [
  { id: 'H-NP-Hilltop', entityId: HILLTOP.entityId, name: HILLTOP.name, region: 'domestic' },
  { id: 'H-NP-Rotana', entityId: '39657625', name: 'Towers Rotana', region: 'domestic' },
];

/** CITY SRP + sample details — domestic India. */
const DOMESTIC_CITIES = [
  { key: 'Mumbai', entityId: '357389:IN', region: 'domestic' },
  { key: 'Delhi', entityId: '227760:IN', region: 'domestic' },
  { key: 'Bangalore', entityId: '341153:IN', region: 'domestic' },
  { key: 'Pune', entityId: '328605:IN', region: 'domestic' },
  { key: 'Goa', entityId: '328649:IN', region: 'domestic' },
];

/** CITY SRP + sample details — international. */
const INTL_CITIES = [
  { key: 'Dubai', entityId: '221688:AE', region: 'international' },
  { key: 'Singapore', entityId: '246673:SG', region: 'international' },
  { key: 'Bangkok', entityId: '328619:TH', region: 'international' },
  { key: 'Paris', entityId: '437227:FR', region: 'international' },
];

const CITIES = [...DOMESTIC_CITIES, ...INTL_CITIES];

const PRICE_KEY_RE = /^(baseFare|totalAmount|taxes|tax|gstAmount|amount|price|total|net|gross|selling|markup|discount|convenienceFee|serviceFee|otherCharges)$/i;
const PRICEISH_KEY_RE = /price|fare|tax|gst|amount|total|fee|net|gross|discount|markup|charge|breakup/i;

function walkNegatives(node, trail, out) {
  if (node == null) return;
  if (typeof node === 'number') {
    if (node < 0 && PRICE_KEY_RE.test(trail.split('.').pop() || '')) {
      out.push({ path: trail, value: node });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkNegatives(v, `${trail}[${i}]`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'number' && v < 0 && (PRICEISH_KEY_RE.test(k) || PRICE_KEY_RE.test(k))) {
        out.push({ path: trail ? `${trail}.${k}` : k, value: v });
      } else {
        walkNegatives(v, trail ? `${trail}.${k}` : k, out);
      }
    }
  }
}

function searchBody({ entityId, type = 'HOTEL' }) {
  return {
    entityId,
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type,
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

function firstHotel(data) {
  return (data?.results || [])[0] || data?.hotel || data || {};
}

function roomsOf(detailsData, hotelRow) {
  return (
    hotelRow.rooms ||
    detailsData?.rooms ||
    detailsData?.hotel?.rooms ||
    detailsData?.content?.rooms ||
    []
  );
}

function roomBreakup(r, i) {
  const price = r.price || r.pricing || {};
  const fields = {
    baseFare: Number(price.baseFare ?? price.base ?? r.baseFare ?? NaN),
    taxes: Number(price.taxes ?? price.tax ?? r.taxes ?? NaN),
    gstAmount: Number(price.gstAmount ?? r.gstAmount ?? NaN),
    convenienceFee: Number(price.convenienceFee ?? r.convenienceFee ?? NaN),
    totalAmount: Number(price.totalAmount ?? price.total ?? r.totalAmount ?? r.total ?? NaN),
  };
  const negatives = Object.entries(fields)
    .filter(([, v]) => Number.isFinite(v) && v < 0)
    .map(([k, v]) => ({ field: k, value: v }));
  return {
    i,
    title: r.title || r.name || r.roomName || '',
    ...fields,
    negative: negatives.length > 0,
    negatives,
  };
}

function priceHasNegative(price) {
  if (!price || typeof price !== 'object') return false;
  return [price.baseFare, price.taxes, price.totalAmount, price.gstAmount, price.convenienceFee]
    .some((v) => typeof v === 'number' && v < 0);
}

/** Spread-sample available hotels across the page (first / mid / last …). */
function pickHotels(available, n) {
  if (!available.length) return [];
  if (available.length <= n) return available.slice();
  const picks = [];
  const used = new Set();
  for (let i = 0; i < n; i += 1) {
    const idx = Math.round((i * (available.length - 1)) / Math.max(n - 1, 1));
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push(available[idx]);
  }
  return picks;
}

function shortName(name) {
  return String(name || 'hotel').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 18) || 'hotel';
}

async function main() {
  console.log('=== Hotel NEGPRICE (domestic + international, no negative breakup) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);
  console.log('Cities', CITIES.length, 'detailsPerCity', DETAILS_PER_CITY, 'pageSize', PAGE_SIZE);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotelSvc = new HotelService(session.client);

  const rows = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  let n = 0;
  const add = (caseId, section, rule, how, expected, status, actual, extra = {}) => {
    n += 1;
    rows.push({ id: n, caseId, section, rule, how, expected, status, actual, ...extra });
    counts[status] = (counts[status] || 0) + 1;
    console.log(`[${status}] ${caseId} ${rule} — ${actual}`);
  };

  async function checkHotelSearchDetails(h) {
    const body = searchBody({ entityId: h.entityId, type: 'HOTEL' });
    const search = await hotelSvc.search(body, { pid: 'vgm', page: 0, perpage: PAGE_SIZE });
    const searchNeg = [];
    walkNegatives(search.data, 'search', searchNeg);
    const hit = firstHotel(search.data);
    const priced = hit && hit.available !== false && hit.price != null;
    const searchStatus = !search.ok
      ? 'BUG'
      : !priced
        ? 'NOT_TESTED'
        : searchNeg.length === 0
          ? 'PASS'
          : 'BUG';

    add(
      `${h.id}-S`,
      'NEGPRICE',
      `${h.name} [${h.region}]: search has no negative price fields`,
      `POST /v1/hotels/search type=HOTEL entityId=${h.entityId} ${CHECKIN}`,
      'HTTP 200; baseFare/taxes/totalAmount/breakup all >= 0',
      searchStatus,
      `http=${search.status} available=${hit?.available} base=${hit?.price?.baseFare} taxes=${hit?.price?.taxes} total=${hit?.price?.totalAmount} neg=${searchNeg.length}`,
      { region: h.region, negatives: searchNeg.slice(0, 20), price: hit?.price || null },
    );

    const details = await hotelSvc.getDetails(body);
    const detailsNeg = [];
    walkNegatives(details.data, 'details', detailsNeg);
    const hotelRow = firstHotel(details.data);
    const rooms = roomsOf(details.data, hotelRow);
    const roomPrices = rooms.map((r, i) => roomBreakup(r, i));
    const negRooms = roomPrices.filter((r) => r.negative);
    const hotelPriceNeg = priceHasNegative(hotelRow.price);

    let detailsStatus = 'BUG';
    if (!details.ok) detailsStatus = 'BUG';
    else if (rooms.length === 0) detailsStatus = 'NOT_TESTED';
    else if (detailsNeg.length === 0 && negRooms.length === 0 && !hotelPriceNeg) detailsStatus = 'PASS';
    else detailsStatus = 'BUG';

    add(
      `${h.id}-D`,
      'NEGPRICE',
      `${h.name} [${h.region}]: details rooms have no negative baseFare / breakup`,
      `POST /v1/hotels/details entityId=${h.entityId} ${CHECKIN}`,
      'HTTP 200; hotel + rooms[].price baseFare/taxes/gst/convenienceFee/totalAmount all >= 0',
      detailsStatus,
      `http=${details.status} rooms=${rooms.length} fieldNeg=${detailsNeg.length} roomNeg=${negRooms.length} hotelPriceNeg=${hotelPriceNeg}`,
      {
        region: h.region,
        negatives: detailsNeg.slice(0, 30),
        negativeRooms: negRooms.slice(0, 10),
        roomSample: roomPrices.slice(0, 8),
      },
    );
  }

  // ---- Anchors (known regression hotels) ----
  for (const h of ANCHOR_HOTELS) {
    await checkHotelSearchDetails(h);
  }

  // ---- Per city: SRP scan + sample hotel details ----
  for (const city of CITIES) {
    const body = searchBody({ entityId: city.entityId, type: 'CITY' });
    const search = await hotelSvc.search(body, { pid: 'vgm', page: 0, perpage: PAGE_SIZE });
    const results = search.data?.results || [];
    const available = results.filter((r) => r && r.available !== false && r.price != null);
    const pageNeg = [];
    walkNegatives({ results: available }, 'citySearch', pageNeg);
    const badHits = available.filter((r) => priceHasNegative(r.price));

    // Negative-price scope: only BUG when we observed negative amounts.
    // Empty inventory / gateway timeout → NOT_TESTED (cannot evaluate prices).
    let srpStatus = 'BUG';
    if (available.length > 0 && (pageNeg.length > 0 || badHits.length > 0)) srpStatus = 'BUG';
    else if (available.length > 0 && pageNeg.length === 0 && badHits.length === 0) srpStatus = 'PASS';
    else if (!search.ok && search.status >= 500) srpStatus = 'NOT_TESTED';
    else if (!search.ok && search.status >= 400) srpStatus = 'BUG';
    else srpStatus = 'NOT_TESTED';

    const cityTag = city.key.replace(/\s+/g, '');
    add(
      `H-NP-City-${cityTag}-S`,
      'NEGPRICE',
      `${city.key} [${city.region}] CITY SRP page0: no negative prices on available hotels`,
      `POST /v1/hotels/search type=CITY entityId=${city.entityId} page=0 perpage=${PAGE_SIZE}`,
      'All available results: price.baseFare/taxes/totalAmount/gst/fee >= 0 (empty/5xx = NOT TESTED)',
      srpStatus,
      `http=${search.status} available=${available.length}/page=${results.length} fieldNeg=${pageNeg.length} badHits=${badHits.length}`,
      {
        region: city.region,
        negatives: pageNeg.slice(0, 20),
        badHitSample: badHits.slice(0, 5).map((r) => ({ id: r.id, name: r.name, price: r.price })),
      },
    );

    let samples = pickHotels(available, DETAILS_PER_CITY);
    let sampleDates = { checkin: CHECKIN, checkout: CHECKOUT };

    // Retry empty international cities once with +7 day window (inventory flap).
    if (!samples.length && city.region === 'international') {
      const altIn = plusDays(35);
      const altOut = plusDays(36);
      const altBody = {
        ...searchBody({ entityId: city.entityId, type: 'CITY' }),
        checkin: altIn,
        checkout: altOut,
      };
      const altSearch = await hotelSvc.search(altBody, { pid: 'vgm', page: 0, perpage: PAGE_SIZE });
      const altResults = altSearch.data?.results || [];
      const altAvail = altResults.filter((r) => r && r.available !== false && r.price != null);
      if (altAvail.length) {
        samples = pickHotels(altAvail, DETAILS_PER_CITY);
        sampleDates = { checkin: altIn, checkout: altOut };
        const altNeg = [];
        walkNegatives({ results: altAvail }, 'citySearchAlt', altNeg);
        const altBad = altAvail.filter((r) => priceHasNegative(r.price));
        const altStatus = altBad.length || altNeg.length ? 'BUG' : 'PASS';
        add(
          `H-NP-City-${cityTag}-S2`,
          'NEGPRICE',
          `${city.key} [${city.region}] CITY SRP retry (+7d): no negative prices`,
          `POST /v1/hotels/search type=CITY entityId=${city.entityId} ${altIn}`,
          'Available results non-negative after date retry',
          altStatus,
          `http=${altSearch.status} available=${altAvail.length} fieldNeg=${altNeg.length} badHits=${altBad.length}`,
          { region: city.region, checkin: altIn, negatives: altNeg.slice(0, 10) },
        );
      }
    }

    if (!samples.length) {
      add(
        `H-NP-City-${cityTag}-D0`,
        'NEGPRICE',
        `${city.key} [${city.region}]: sample hotel details (no inventory)`,
        `CITY search returned no priced hotels`,
        'At least 1 available hotel for details price scan',
        'NOT_TESTED',
        `available=0`,
        { region: city.region },
      );
      continue;
    }

    for (let i = 0; i < samples.length; i += 1) {
      const hit = samples[i];
      const entityId = String(hit.id || hit.entityId || '');
      if (!entityId) {
        add(
          `H-NP-City-${cityTag}-D${i + 1}`,
          'NEGPRICE',
          `${city.key} sample hotel missing id`,
          'CITY result without id',
          'result.id present',
          'BUG',
          `name=${hit.name}`,
          { region: city.region },
        );
        continue;
      }

      const dBody = {
        ...searchBody({ entityId, type: 'HOTEL' }),
        checkin: sampleDates.checkin,
        checkout: sampleDates.checkout,
      };
      const details = await hotelSvc.getDetails(dBody);
      const detailsNeg = [];
      walkNegatives(details.data, 'details', detailsNeg);
      const hotelRow = firstHotel(details.data);
      const rooms = roomsOf(details.data, hotelRow);
      const roomPrices = rooms.map((r, idx) => roomBreakup(r, idx));
      const negRooms = roomPrices.filter((r) => r.negative);
      const hotelPriceNeg = priceHasNegative(hotelRow.price);

      let detailsStatus = 'BUG';
      if (!details.ok && details.status >= 500) detailsStatus = 'NOT_TESTED';
      else if (!details.ok) detailsStatus = 'BUG';
      else if (rooms.length === 0) detailsStatus = 'NOT_TESTED';
      else if (detailsNeg.length === 0 && negRooms.length === 0 && !hotelPriceNeg) detailsStatus = 'PASS';
      else detailsStatus = 'BUG';

      const label = hit.name || entityId;
      add(
        `H-NP-City-${cityTag}-D${i + 1}`,
        'NEGPRICE',
        `${city.key} [${city.region}] ${label}: details no negative breakup`,
        `POST /v1/hotels/details entityId=${entityId} (from ${city.key} CITY SRP)`,
        'HTTP 200; rooms[].price baseFare/taxes/gst/fee/totalAmount all >= 0',
        detailsStatus,
        `http=${details.status} hotel=${shortName(label)} rooms=${rooms.length} fieldNeg=${detailsNeg.length} roomNeg=${negRooms.length} hotelPriceNeg=${hotelPriceNeg}`,
        {
          region: city.region,
          city: city.key,
          entityId,
          hotelName: label,
          negatives: detailsNeg.slice(0, 20),
          negativeRooms: negRooms.slice(0, 8),
          roomSample: roomPrices.slice(0, 5),
        },
      );
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    correlationId: process.env.CORRELATION_ID,
    note: 'Search + details only. Domestic + international cities. Fail if any price breakup field is negative. No book.',
    config: {
      detailsPerCity: DETAILS_PER_CITY,
      pageSize: PAGE_SIZE,
      domesticCities: DOMESTIC_CITIES.map((c) => c.key),
      internationalCities: INTL_CITIES.map((c) => c.key),
      anchors: ANCHOR_HOTELS.map((h) => ({ name: h.name, entityId: h.entityId })),
    },
    summary: {
      PASS: counts.PASS || 0,
      BUG: counts.BUG || 0,
      'NOT TESTED': counts.NOT_TESTED || 0,
    },
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSCORE', report.summary);
  console.log('Wrote', OUT);
  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
