/**
 * TravelVIP prod city listing snapshot (search only — no book).
 * Cities: Mumbai, Chennai, Delhi, Ahmedabad, Bangalore.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', 'hotel-tvip-prod-5cities.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-15';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-16';

const CITIES = [
  { name: 'Mumbai', entityId: '357389:IN' },
  { name: 'Delhi', entityId: '227760:IN' },
  { name: 'Chennai', entityId: '228269:IN' },
  { name: 'Bangalore', entityId: '341153:IN' },
  { name: 'Ahmedabad', entityId: null },
];

function pickList(data) {
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

async function resolveCity(hotel, q) {
  const auto = await hotel.autocomplete(q);
  const list = pickList(auto.data);
  const hit = list.find((x) => {
    const label = `${x.name || ''} ${x.city || ''}`;
    const type = String(x.type || x.entityType || '');
    return new RegExp(q, 'i').test(label) && /CITY|TBOCITY/i.test(type);
  }) || list.find((x) => new RegExp(q, 'i').test(`${x.name || ''}`));
  return hit ? { entityId: String(hit.entityId || hit.id), name: hit.name, type: hit.type } : null;
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  for (const c of CITIES) {
    if (c.entityId) continue;
    const resolved = await resolveCity(hotel, c.name);
    if (resolved) {
      c.entityId = resolved.entityId;
      c.resolvedFrom = resolved;
    }
  }

  const out = {
    baseUrl: process.env.BASE_URL,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    ranAt: new Date().toISOString(),
    note: 'TravelVIP B2B POST /v1/hotels/search only — no book. MMT side not included (no MMT API in repo).',
    cities: [],
  };

  for (const c of CITIES) {
    if (!c.entityId) {
      out.cities.push({ city: c.name, error: 'entityId not resolved' });
      console.log('SKIP', c.name);
      continue;
    }
    const body = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      entityId: c.entityId,
      nationality: 'IN',
      type: 'CITY',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      currency: 'INR',
      lang: 'en',
      language: 'en',
      pid: 'vgm',
      rt: 'compact',
      filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
      fq: [],
      sort: 'price_ASC',
    };
    const res = await hotel.search(body);
    const results = res.data?.results || [];
    const filters = Array.isArray(res.data?.filters) ? res.data.filters : [];
    const starF = filters.find((f) => /star/i.test(`${f.indexField || ''} ${f.name || ''}`));
    const sample = results.slice(0, 20).map((h) => ({
      name: h.name,
      star: h.starRating,
      baseFare: h.price?.baseFare ?? null,
      totalAmount: h.price?.totalAmount ?? null,
      id: h.id || h.entityId || null,
    }));
    const row = {
      city: c.name,
      entityId: c.entityId,
      resolvedFrom: c.resolvedFrom || null,
      http: res.status,
      ok: res.ok,
      totalResults: res.data?.totalResults ?? null,
      pageSize: results.length,
      starFacets: (starF?.facets || []).map((x) => ({
        name: x.name,
        count: x.count,
        key: x.facetKey,
      })),
      cheapestSample: sample.slice(0, 10),
    };
    out.cities.push(row);
    console.log(
      JSON.stringify({
        city: c.name,
        entityId: c.entityId,
        http: res.status,
        total: row.totalResults,
        stars: row.starFacets,
      }),
    );
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
