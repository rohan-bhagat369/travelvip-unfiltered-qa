/**
 * Sample TVIP 4★ / 5★ hotels per city (prod search only — no book).
 * Output used for MMT star-rating comparison.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', 'hotel-tvip-star-samples-for-mmt.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-15';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-16';
const PER_STAR = Number(process.env.SAMPLE_PER_STAR || '10');

const CITIES = [
  { name: 'Mumbai', entityId: '357389:IN' },
  { name: 'Delhi', entityId: '227760:IN' },
  { name: 'Chennai', entityId: '228269:IN' },
  { name: 'Bangalore', entityId: '341153:IN' },
  { name: 'Ahmedabad', entityId: '246774:IN' },
];

function mapHotels(results = []) {
  return results.map((h) => ({
    name: h.name || h.hotelName || '',
    star: Number(h.starRating ?? h.star ?? NaN),
    entityId: String(h.id || h.entityId || ''),
    baseFare: h.price?.baseFare ?? null,
    totalAmount: h.price?.totalAmount ?? null,
  })).filter((h) => h.name);
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  const out = {
    baseUrl: process.env.BASE_URL,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    ranAt: new Date().toISOString(),
    perStarSample: PER_STAR,
    cities: [],
  };

  for (const c of CITIES) {
    const cityRow = { city: c.name, entityId: c.entityId, samples: { '4': [], '5': [] } };
    for (const star of [4, 5]) {
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
        fq: { df_long_star_rating: [String(star)] },
        sort: 'price_ASC',
      };
      const res = await hotel.search(body, { perpage: Math.max(20, PER_STAR) });
      const hotels = mapHotels(res.data?.results || []);
      const allStar = hotels.every((h) => h.star === star);
      cityRow.samples[String(star)] = {
        http: res.status,
        totalResults: res.data?.totalResults ?? null,
        allMatchFilter: allStar,
        hotels: hotels.slice(0, PER_STAR),
      };
      console.log(
        c.name,
        `${star}★`,
        'http',
        res.status,
        'total',
        res.data?.totalResults,
        'sample',
        hotels.slice(0, PER_STAR).length,
        'allMatch',
        allStar,
      );
    }
    out.cities.push(cityRow);
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
