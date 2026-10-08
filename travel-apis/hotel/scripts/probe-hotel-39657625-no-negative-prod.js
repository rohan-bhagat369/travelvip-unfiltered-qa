/**
 * Prod — hotel 39657625 (Towers Rotana): search + details only.
 * Fail if any price field is negative. NO prebook / finalize / book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const ENTITY = process.env.HOTEL_ENTITY_ID || '39657625';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-39657625-no-negative-prod.json');

const PRICE_KEYS = /^(baseFare|totalAmount|taxes|tax|gstAmount|amount|price|total|net|gross|selling|markup|discount|convenienceFee)$/i;

function walkNegatives(node, trail, out) {
  if (node == null) return;
  if (typeof node === 'number') {
    if (node < 0 && PRICE_KEYS.test(trail.split('.').pop() || '')) {
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
      if (typeof v === 'number' && v < 0 && (/price|fare|tax|gst|amount|total|fee|net|gross|discount|markup/i.test(k) || PRICE_KEYS.test(k))) {
        out.push({ path: trail ? `${trail}.${k}` : k, value: v });
      } else {
        walkNegatives(v, trail ? `${trail}.${k}` : k, out);
      }
    }
  }
}

function roomPrice(r, i) {
  const price = r.price || r.pricing || {};
  const total = Number(price.totalAmount ?? price.total ?? r.totalAmount ?? r.total ?? NaN);
  const base = Number(price.baseFare ?? price.base ?? r.baseFare ?? NaN);
  const taxes = Number(price.taxes ?? price.tax ?? r.taxes ?? NaN);
  const gstAmount = Number(price.gstAmount ?? r.gstAmount ?? NaN);
  const vals = [total, base, taxes, gstAmount].filter((n) => Number.isFinite(n));
  const negative = vals.some((n) => n < 0);
  return {
    i,
    title: r.title || r.name || r.roomName || '',
    mealType: r.mealType || r.meal || null,
    total: Number.isFinite(total) ? total : null,
    base: Number.isFinite(base) ? base : null,
    taxes: Number.isFinite(taxes) ? taxes : null,
    gstAmount: Number.isFinite(gstAmount) ? gstAmount : null,
    negative,
  };
}

async function main() {
  console.log('=== Hotel', ENTITY, 'negative-price PROD (search+details, NO book) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const body = {
    entityId: ENTITY,
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'HOTEL',
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

  const search = await hotel.search(body, { pid: 'vgm', page: 0, perpage: 20 });
  const searchNeg = [];
  walkNegatives(search.data, 'search', searchNeg);
  const hit = (search.data?.results || [])[0] || search.data?.hotel || search.data || {};
  const searchPrice = hit.price || {};
  console.log(
    'search',
    search.status,
    hit.name || hit.title || '',
    'base',
    searchPrice.baseFare,
    'total',
    searchPrice.totalAmount,
    'neg',
    searchNeg.length,
  );

  const details = await hotel.getDetails(body);
  const detailsNeg = [];
  walkNegatives(details.data, 'details', detailsNeg);
  const hotelRow = (details.data?.results || [])[0] || details.data?.hotel || details.data || {};
  const rooms =
    hotelRow.rooms ||
    details.data?.rooms ||
    details.data?.hotel?.rooms ||
    details.data?.content?.rooms ||
    [];
  const roomPrices = rooms.map((r, i) => roomPrice(r, i));
  const negativeRooms = roomPrices.filter((r) => r.negative);
  const totals = roomPrices.map((r) => r.total).filter((n) => n != null && Number.isFinite(n));
  const hotelPriceNeg =
    [hotelRow.price?.baseFare, hotelRow.price?.taxes, hotelRow.price?.totalAmount, hotelRow.price?.gstAmount, hotelRow.price?.convenienceFee]
      .filter((n) => typeof n === 'number')
      .some((n) => n < 0);

  console.log(
    'details',
    details.status,
    'rooms',
    rooms.length,
    'negFields',
    detailsNeg.length,
    'negRooms',
    negativeRooms.length,
    'hotelPriceNeg',
    hotelPriceNeg,
  );

  const searchPass = search.ok && searchNeg.length === 0;
  const detailsPass =
    details.ok &&
    detailsNeg.length === 0 &&
    negativeRooms.length === 0 &&
    !hotelPriceNeg &&
    rooms.length > 0;

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: ENTITY,
    note: 'Search + details only. Expect no negative prices. No book/prebook/finalize.',
    search: {
      http: search.status,
      hotelName: hit.name || hit.title || null,
      starRating: hit.starRating ?? null,
      isGSTClaimable: hit.isGSTClaimable ?? null,
      price: searchPrice,
      negativeCount: searchNeg.length,
      negatives: searchNeg.slice(0, 50),
      status: searchPass ? 'PASS' : 'BUG',
    },
    details: {
      http: details.status,
      hotelName: hotelRow.name || hit.name || null,
      hotelPrice: hotelRow.price || null,
      roomCount: rooms.length,
      negativeFieldCount: detailsNeg.length,
      negatives: detailsNeg.slice(0, 50),
      negativeRooms: negativeRooms.length,
      hotelPriceNegative: hotelPriceNeg,
      roomPriceSummary: {
        minTotal: totals.length ? Math.min(...totals) : null,
        maxTotal: totals.length ? Math.max(...totals) : null,
        negativeRooms: negativeRooms.length,
      },
      roomPricesSample: roomPrices.slice(0, 20),
      negativeRoomSample: negativeRooms.slice(0, 20),
      status: detailsPass ? 'PASS' : rooms.length === 0 && details.ok ? 'NOT_TESTED' : 'BUG',
    },
    verdict: searchPass && detailsPass ? 'PASS' : 'BUG',
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('verdict', report.verdict);
  console.log('Wrote', OUT);
  if (report.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
