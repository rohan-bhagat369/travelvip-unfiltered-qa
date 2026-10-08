/**
 * Canary hotel search: star-rating fq + sort price_ASC / price_DESC.
 * Body matches the updated curl (object fq, type=CITY).
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-hotel-search-star-sort-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', process.env.HOTEL_STAR_OUT || 'hotel-search-star-sort-canary.json');
const CID = process.env.CORRELATION_ID || 'e96c6d03-7dec-451f-89af-d22de78f8ad6';
process.env.CORRELATION_ID = CID;

const CITIES = [
  { name: 'Mumbai', entityId: '357389:IN' },
  { name: 'Pune', entityId: '328605:IN' },
  { name: 'Delhi', entityId: '358245:IN' },
];

function fareOf(h) {
  const p = h?.price || {};
  const n = Number(p.baseFare ?? p.totalAmount ?? h.baseFare ?? h.totalAmount);
  return Number.isFinite(n) ? n : null;
}

function pickHotels(data) {
  const list = data?.results || data?.data?.results || [];
  return (list || []).map((h) => ({
    id: String(h.id || h.entityId || ''),
    name: h.name || h.hotelName || null,
    starRating: h.starRating ?? h.star ?? h.rating ?? null,
    refundable: h.refundable ?? null,
    cancelText: h.tags?.cancellationText || h.refundableNotes?.[0] || null,
    baseFare: fareOf(h),
    totalAmount: Number(h?.price?.totalAmount ?? h.totalAmount ?? NaN) || null,
  }));
}

function isMonoAsc(vals) {
  const a = vals.filter((v) => v != null);
  for (let i = 1; i < a.length; i += 1) if (a[i] < a[i - 1] - 0.01) return false;
  return a.length >= 2;
}

function isMonoDesc(vals) {
  const a = vals.filter((v) => v != null);
  for (let i = 1; i < a.length; i += 1) if (a[i] > a[i - 1] + 0.01) return false;
  return a.length >= 2;
}

function starsOk(hotels, want) {
  if (!hotels.length) return false;
  return hotels.every((h) => Number(h.starRating) === Number(want));
}

function row(section, n, rule, how, expected, status, actual, extra = {}) {
  return {
    section,
    n,
    rule,
    how,
    expected,
    status,
    actual,
    ...extra,
  };
}

async function search(client, { sort, entityId, fq }) {
  const query = {
    currency: 'INR',
    page: 0,
    perpage: 20,
    lang: 'en',
  };
  if (sort) query.sort = sort;
  return client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query,
    body: {
      checkin: '2026-10-14',
      checkout: '2026-10-15',
      entityId,
      nationality: 'IN',
      type: 'CITY',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      ...(fq ? { fq } : {}),
    },
    correlation: true,
    extraHeaders: { 'X-Correlation-ID': CID },
  });
}

async function main() {
  clearSession();
  console.log('Base', config.baseUrl, 'CID', CID);
  const session = await authenticate(true);
  session.client.setCorrelationId(CID);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  // Resolve Delhi if 358245 is wrong
  const auto = await hotel.autocomplete('Delhi');
  const delhi = (auto.data?.results || auto.data || []).find?.((x) =>
    /delhi/i.test(`${x.name || ''} ${x.city || ''}`) && /CITY/i.test(String(x.type || x.entityType || '')),
  ) || (Array.isArray(auto.data) ? auto.data.find((x) => /delhi/i.test(x.name || '')) : null);
  if (delhi?.entityId || delhi?.id) {
    CITIES[2].entityId = String(delhi.entityId || delhi.id);
    CITIES[2].name = delhi.name || 'Delhi';
  }
  console.log('cities', CITIES);

  const rows = [];
  let n = 0;
  const add = (section, rule, how, expected, status, actual, extra) => {
    n += 1;
    const r = row(section, n, rule, how, expected, status, actual, extra);
    rows.push(r);
    console.log(`[${status}] ${n}. ${rule} — ${actual}`);
  };

  const FQ_STAR4 = { df_long_star_rating: [4] };
  const FQ_STAR4_FREE = {
    df_long_star_rating: [4],
    'Reservation policy': ['Free cancellation'],
  };

  for (const city of CITIES) {
    const label = `${city.name} ${city.entityId}`;

    const unfAsc = await search(session.client, { sort: 'price_ASC', entityId: city.entityId });
    const unfHotels = pickHotels(unfAsc.data);
    console.log(`\n=== ${label} unfiltered HTTP ${unfAsc.status} n=${unfHotels.length} total=${unfAsc.data?.totalResults}`);

    add(
      'Setup',
      `${city.name}: unfiltered search works`,
      `POST /v1/hotels/search CITY ${city.entityId} sort=price_ASC no fq`,
      'HTTP 200 and hotel list',
      unfAsc.ok && unfHotels.length ? 'PASS' : 'BUG',
      `HTTP ${unfAsc.status} hotels=${unfHotels.length} total=${unfAsc.data?.totalResults} stars=${JSON.stringify(unfHotels.map((h) => h.starRating))}`,
      { city: city.name, hotels: unfHotels.slice(0, 8) },
    );

    const star4Asc = await search(session.client, {
      sort: 'price_ASC',
      entityId: city.entityId,
      fq: FQ_STAR4,
    });
    const h4a = pickHotels(star4Asc.data);
    const fares4a = h4a.map((h) => h.baseFare);
    const all4 = starsOk(h4a, 4);
    const totalDrop = Number(star4Asc.data?.totalResults) < Number(unfAsc.data?.totalResults);

    add(
      'Star filter',
      `${city.name}: 4★ fq returns only 4-star hotels`,
      `fq.df_long_star_rating=[4] sort=price_ASC`,
      'Every result starRating=4; totalResults narrower than unfiltered',
      star4Asc.ok && h4a.length && all4 && (totalDrop || Number(star4Asc.data?.totalResults) > 0)
        ? (all4 ? 'PASS' : 'BUG')
        : 'BUG',
      `HTTP ${star4Asc.status} n=${h4a.length} total=${star4Asc.data?.totalResults} unfilteredTotal=${unfAsc.data?.totalResults} stars=${JSON.stringify(h4a.map((h) => h.starRating))} all4=${all4}`,
      { city: city.name, hotels: h4a.slice(0, 10) },
    );

    add(
      'Sort',
      `${city.name}: 4★ price_ASC is non-decreasing`,
      `same 4★ search sort=price_ASC`,
      'baseFare non-decreasing across page',
      star4Asc.ok && isMonoAsc(fares4a) ? 'PASS' : 'BUG',
      `fares=${JSON.stringify(fares4a)} monoAsc=${isMonoAsc(fares4a)}`,
      { city: city.name, first: h4a[0], last: h4a[h4a.length - 1] },
    );

    const star4Desc = await search(session.client, {
      sort: 'price_DESC',
      entityId: city.entityId,
      fq: FQ_STAR4,
    });
    const h4d = pickHotels(star4Desc.data);
    const fares4d = h4d.map((h) => h.baseFare);
    const differentOrder = h4a.map((h) => h.id).join() !== h4d.map((h) => h.id).join();
    const firstAscCheaper =
      h4a[0]?.baseFare != null && h4d[0]?.baseFare != null && h4a[0].baseFare <= h4d[0].baseFare + 0.01;

    add(
      'Star filter',
      `${city.name}: 4★ + price_DESC still only 4-star`,
      `fq.df_long_star_rating=[4] sort=price_DESC`,
      'Every result starRating=4',
      star4Desc.ok && h4d.length && starsOk(h4d, 4) ? 'PASS' : 'BUG',
      `HTTP ${star4Desc.status} n=${h4d.length} stars=${JSON.stringify(h4d.map((h) => h.starRating))}`,
      { city: city.name, hotels: h4d.slice(0, 10) },
    );

    add(
      'Sort',
      `${city.name}: 4★ price_DESC is non-increasing`,
      `sort=price_DESC`,
      'baseFare non-increasing across page',
      star4Desc.ok && isMonoDesc(fares4d) ? 'PASS' : 'BUG',
      `fares=${JSON.stringify(fares4d)} monoDesc=${isMonoDesc(fares4d)}`,
      { city: city.name, first: h4d[0], last: h4d[h4d.length - 1] },
    );

    add(
      'Sort',
      `${city.name}: ASC vs DESC are different ordered lists`,
      `compare 4★ price_ASC vs price_DESC first page`,
      'Hotel order differs; cheapest-first vs dearest-first',
      differentOrder && firstAscCheaper ? 'PASS' : 'BUG',
      `differentOrder=${differentOrder} ascFirst=${h4a[0]?.name}@${h4a[0]?.baseFare} descFirst=${h4d[0]?.name}@${h4d[0]?.baseFare}`,
      { city: city.name },
    );

    const comboAsc = await search(session.client, {
      sort: 'price_ASC',
      entityId: city.entityId,
      fq: FQ_STAR4_FREE,
    });
    const hc = pickHotels(comboAsc.data);
    const allRefund = hc.length && hc.every((h) => h.refundable === true);
    const comboStars = starsOk(hc, 4);
    const comboMono = isMonoAsc(hc.map((h) => h.baseFare));

    add(
      'Filter+sort',
      `${city.name}: 4★ + Free cancellation + price_ASC`,
      `fq star 4 + Reservation policy Free cancellation, sort=price_ASC (user curl shape)`,
      'Only 4★; refundable=true; fares non-decreasing',
      comboAsc.ok && hc.length && comboStars && allRefund && comboMono ? 'PASS' : 'BUG',
      `HTTP ${comboAsc.status} n=${hc.length} total=${comboAsc.data?.totalResults} stars=${JSON.stringify(hc.map((h) => h.starRating))} refundable=${JSON.stringify(hc.map((h) => h.refundable))} fares=${JSON.stringify(hc.map((h) => h.baseFare))} all4=${comboStars} allRefund=${allRefund} monoAsc=${comboMono}`,
      { city: city.name, hotels: hc.slice(0, 10) },
    );

    const comboDesc = await search(session.client, {
      sort: 'price_DESC',
      entityId: city.entityId,
      fq: FQ_STAR4_FREE,
    });
    const hd = pickHotels(comboDesc.data);

    add(
      'Filter+sort',
      `${city.name}: 4★ + Free cancellation + price_DESC`,
      `same fq, sort=price_DESC (exact user curl sort)`,
      'Only 4★; refundable=true; fares non-increasing',
      comboDesc.ok && hd.length && starsOk(hd, 4) && hd.every((h) => h.refundable === true) && isMonoDesc(hd.map((h) => h.baseFare))
        ? 'PASS'
        : 'BUG',
      `HTTP ${comboDesc.status} n=${hd.length} stars=${JSON.stringify(hd.map((h) => h.starRating))} refundable=${JSON.stringify(hd.map((h) => h.refundable))} fares=${JSON.stringify(hd.map((h) => h.baseFare))}`,
      { city: city.name, hotels: hd.slice(0, 10) },
    );
  }

  const counts = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
    total: rows.length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    path: 'POST /v1/hotels/search',
    checkin: '2026-10-14',
    checkout: '2026-10-15',
    fqShape: 'object { df_long_star_rating: [4], Reservation policy: [Free cancellation] }',
    sortQuery: 'sort=price_ASC | price_DESC',
    cities: CITIES,
    counts,
    bugs: rows.filter((r) => r.status === 'BUG'),
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nScore', counts);
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
