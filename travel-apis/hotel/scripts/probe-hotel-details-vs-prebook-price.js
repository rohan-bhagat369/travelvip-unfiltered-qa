/**
 * Compare hotel details room price vs prebook price for Hiltop (entity 39627872).
 * Same bookingCode path: details → prebook.
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-hotel-details-vs-prebook-price.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractRequestId,
  extractBookingCodes,
  extractBookingContext,
} from '../src/helpers.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-details-vs-prebook-price-canary.json');
const ENTITY_ID = '39627872'; // Hiltop Mumbai (same as BR1786711327778765)
const TOLERANCE = 0.05; // INR

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function priceBlock(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    baseFare: money(p.baseFare),
    taxes: money(p.taxes ?? p.tax),
    convenienceFee: money(p.convenienceFee),
    totalAmount: money(p.totalAmount),
    currency: p.currency || null,
    gstAmount: money(p.gstAmount),
  };
}

function eq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= TOLERANCE;
}

async function main() {
  clearSession();
  console.log('Details vs prebook price on', config.baseUrl);
  console.log('Hotel entityId', ENTITY_ID);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  // Prefer same stay window as BR (± days) then fall back
  const dayCandidates = [28, 21, 14, 35, 45, 60];
  let stay = null;
  let lastErr = null;

  for (const days of dayCandidates) {
    const searchBody = buildSearchBody({
      entityId: ENTITY_ID,
      checkinDays: days,
      nights: 1,
      nationality: 'IN',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    console.log(`\n=== search checkin ${searchBody.checkin} → ${searchBody.checkout}`);

    const search = await hotel.search(searchBody);
    if (!search.ok) {
      lastErr = `search HTTP ${search.status}`;
      console.log('  search fail', lastErr);
      continue;
    }

    const details = await hotel.getDetails(searchBody);
    if (!details.ok) {
      lastErr = `details HTTP ${details.status}`;
      console.log('  details fail', lastErr);
      continue;
    }

    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    const hotelBlock = details.data?.results?.[0];
    const rooms = (hotelBlock?.rooms || []).filter((r) => r.bookingCode && r.available !== false);
    if (!rooms.length) {
      lastErr = 'no bookable rooms';
      console.log('  no rooms');
      continue;
    }

    // Prefer cancellable/PAN-true room similar to original; else cheapest
    rooms.sort((a, b) => (money(a.price?.totalAmount) ?? 1e12) - (money(b.price?.totalAmount) ?? 1e12));
    const preferred = rooms.find((r) => r.isPANMandatory === true) || rooms[0];

    console.log('  details rooms', rooms.length, 'pick', preferred.title || preferred.name, preferred.price?.totalAmount);

    const prebook = await hotel.prebook({ bookingCode: preferred.bookingCode, requestId });
    if (!prebook.ok || !extractBookingContext(prebook.data)) {
      lastErr = `prebook fail HTTP ${prebook.status}`;
      console.log('  prebook fail', JSON.stringify(prebook.data).slice(0, 200));
      continue;
    }

    const preHotel = prebook.data?.results?.[0];
    const preRoom = (preHotel?.rooms || []).find((r) => r.bookingCode === preferred.bookingCode)
      || preHotel?.rooms?.[0]
      || null;

    stay = {
      searchBody,
      requestId,
      detailsHotelPrice: priceBlock(hotelBlock?.price),
      detailsRoom: {
        bookingCode: preferred.bookingCode,
        title: preferred.title || preferred.name?.[0] || preferred.name,
        mealType: preferred.mealType,
        isPANMandatory: preferred.isPANMandatory,
        isGSTClaimable: preferred.isGSTClaimable,
        price: priceBlock(preferred.price),
      },
      prebookHotelPrice: priceBlock(preHotel?.price),
      prebookRoom: preRoom ? {
        bookingCode: preRoom.bookingCode,
        title: preRoom.title || preRoom.name?.[0] || preRoom.name,
        mealType: preRoom.mealType,
        isPANMandatory: preRoom.isPANMandatory,
        isGSTClaimable: preRoom.isGSTClaimable,
        price: priceBlock(preRoom.price),
      } : null,
      prebookHttp: prebook.status,
      detailsHttp: details.status,
    };
    break;
  }

  if (!stay) throw new Error(`Could not details+prebook Hiltop: ${lastErr}`);

  const d = stay.detailsRoom.price;
  const p = stay.prebookRoom?.price;
  const comparisons = [
    { field: 'baseFare', details: d?.baseFare, prebook: p?.baseFare },
    { field: 'taxes', details: d?.taxes, prebook: p?.taxes },
    { field: 'convenienceFee', details: d?.convenienceFee, prebook: p?.convenienceFee },
    { field: 'totalAmount', details: d?.totalAmount, prebook: p?.totalAmount },
    { field: 'gstAmount', details: d?.gstAmount, prebook: p?.gstAmount },
    { field: 'currency', details: d?.currency, prebook: p?.currency },
  ].map((c) => {
    const match = c.field === 'currency'
      ? String(c.details) === String(c.prebook)
      : eq(c.details, c.prebook);
    return {
      ...c,
      delta: (typeof c.details === 'number' && typeof c.prebook === 'number')
        ? Number((c.prebook - c.details).toFixed(4))
        : null,
      match,
      status: match ? 'PASS' : 'BUG',
    };
  });

  const hotelLevel = {
    details: stay.detailsHotelPrice,
    prebook: stay.prebookHotelPrice,
    totalMatch: eq(stay.detailsHotelPrice?.totalAmount, stay.prebookHotelPrice?.totalAmount),
  };

  const allMatch = comparisons.every((c) => c.match);
  const rows = comparisons.map((c, i) => ({
    id: `P${i + 1}`,
    rule: `Room price.${c.field} details == prebook`,
    how: 'Same bookingCode from details → prebook',
    expected: `details.${c.field} === prebook.${c.field} (±${TOLERANCE})`,
    actual: `details=${c.details} prebook=${c.prebook} delta=${c.delta}`,
    status: c.status,
  }));

  rows.unshift({
    id: 'P0',
    rule: 'Hotel-level totalAmount details == prebook',
    how: 'results[0].price.totalAmount',
    expected: 'Match ±0.05',
    actual: `details=${hotelLevel.details?.totalAmount} prebook=${hotelLevel.prebook?.totalAmount}`,
    status: hotelLevel.totalMatch ? 'PASS' : 'BUG',
  });

  const counts = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: 0,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    entityId: ENTITY_ID,
    hotel: 'Hiltop Hotel / Hilltop Hotel Mumbai',
    relatedBr: 'BR1786711327778765',
    checkin: stay.searchBody.checkin,
    checkout: stay.searchBody.checkout,
    requestId: stay.requestId,
    bookingCode: stay.detailsRoom.bookingCode,
    detailsRoom: stay.detailsRoom,
    prebookRoom: stay.prebookRoom,
    hotelLevel,
    allRoomPricesMatch: allMatch,
    counts,
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== DETAILS room price', JSON.stringify(d, null, 2));
  console.log('=== PREBOOK room price', JSON.stringify(p, null, 2));
  console.log('\nScore', counts, 'allRoomPricesMatch=', allMatch);
  console.log('Report', OUT);
  if (counts.BUG) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
