import { CITY_MUMBAI, HILLTOP } from '../fixtures.js';
import { row, errCode, brief } from '../report.js';
import { noteCall } from '../session.js';

export async function runSmoke(ctx) {
  const rows = [];
  const { hotel } = ctx;

  const city = await hotel.autocomplete('pune', 0, 20);
  noteCall(ctx, 'autocomplete-city', '/v1/hotels/autocomplete', city);
  const cityHits = (city.data?.content || []).length;
  rows.push(row(
    'SMOKE', 'catalog', 1, 'Autocomplete city q=pune',
    'GET /v1/hotels/autocomplete?q=pune',
    'HTTP 200, content[]',
    `HTTP ${city.status} content=${cityHits}`,
    city.ok && cityHits > 0 ? 'PASS' : 'BUG',
    { responseSnippet: brief(city.data, 200) },
  ));

  const hotelAc = await hotel.autocomplete('hiltop', 0, 20);
  noteCall(ctx, 'autocomplete-hotel', '/v1/hotels/autocomplete', hotelAc);
  const hotels = (hotelAc.data?.content || []).filter((x) => /HOTEL/i.test(String(x.type || '')));
  const picked = hotels.find((h) => /hiltop/i.test(h.title || '') && /mumbai/i.test(h.city || h.title || ''))
    || hotels.find((h) => String(h.entityId) === HILLTOP.entityId);
  rows.push(row(
    'SMOKE', 'catalog', 2, 'Autocomplete hotel name q=hiltop',
    'GET /v1/hotels/autocomplete?q=hiltop',
    'HTTP 200, HOTEL hit with entityId',
    `HTTP ${hotelAc.status} hits=${hotels.length} entityId=${picked?.entityId || null}`,
    hotelAc.ok && picked?.entityId ? 'PASS' : 'BUG',
  ));

  const mumbai = await hotel.autocomplete('mumbai', 0, 20);
  noteCall(ctx, 'autocomplete-mumbai', '/v1/hotels/autocomplete', mumbai);

  const searchBody = {
    entityId: CITY_MUMBAI.entityId,
    nationality: 'IN',
    checkin: '2026-09-10',
    checkout: '2026-09-12',
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
  const search = await hotel.search(searchBody, { pid: 'vgm', offset: 0, limit: 5 });
  noteCall(ctx, 'search-pid', '/v1/hotels/search', search);
  const total = search.data?.totalResults ?? search.data?.availableResults ?? 0;
  rows.push(row(
    'SMOKE', 'catalog', 3, 'Search with pid=vgm',
    'POST /v1/hotels/search pid=vgm CITY 357389:IN',
    'HTTP 200 availability',
    `HTTP ${search.status} total=${total} error=${errCode(search)}`,
    search.ok && total > 0 ? 'PASS' : 'BUG',
  ));

  const spec = await ctx.client.request({
    method: 'POST',
    path: '/api/hotels/v2/availability/listing',
    query: { pid: 'vgm', offset: 0, limit: 5 },
    body: searchBody,
    correlation: true,
  });
  noteCall(ctx, 'listing-spec', '/api/hotels/v2/availability/listing', spec);
  const specOk = spec.status === 200 || spec.status === 404;
  rows.push(row(
    'SMOKE', 'listing', 4, 'Spec listing URL still optional/404',
    'POST /api/hotels/v2/availability/listing',
    'HTTP 200 or documented 404 (not 500)',
    `HTTP ${spec.status} ${brief(spec.data, 120)}`,
    specOk ? 'PASS' : 'BUG',
    { note: 'Partner contract is POST /v1/hotels/search until spec path is deployed' },
  ));

  return rows;
}
