/**
 * Dump hotel search/details payload + headers (canary debugging).
 *   $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/dump-hotel-details-shape-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { HOTEL_QUERY, buildSearchBody } from '../src/helpers.js';

const OUT = path.join('reports', 'hotel-details-shape-canary.json');

function headerPairs(h) {
  try {
    if (!h) return {};
    if (typeof h.entries === 'function') return Object.fromEntries(h.entries());
    return { ...h };
  } catch {
    return { note: String(h) };
  }
}

function slim(data) {
  try {
    const s = JSON.stringify(data);
    return { bytes: s.length, json: s.length > 2500 ? `${s.slice(0, 2500)}…` : data };
  } catch {
    return { type: typeof data, preview: String(data).slice(0, 400) };
  }
}

async function main() {
  console.log('Base:', config.baseUrl);
  clearSession();
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays: 28,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.type = 'HOTEL';
  searchBody.nationality = 'IN';

  const auto = await hotel.autocomplete('hilltop mumbai', 1, 5);
  const search = await hotel.search(searchBody);
  const details = await hotel.getDetails(searchBody);

  const citySearch = await hotel.search({
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    latitude: 19.076,
    longitude: 72.8777,
    type: 'AREA',
    nationality: 'IN',
    rooms: searchBody.rooms,
  });

  const previousBr = 'BR1786788719398621';
  const status = await hotel.getBookingStatus(previousBr);
  const detail = await hotel.getBookingDetail(previousBr);

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    query: HOTEL_QUERY,
    searchBody,
    autocomplete: { http: auto.status, keys: Object.keys(auto.data || {}), slim: slim(auto.data) },
    search: {
      http: search.status,
      headers: headerPairs(search.headers),
      keys: Object.keys(search.data || {}),
      slim: slim(search.data),
    },
    details: {
      http: details.status,
      headers: headerPairs(details.headers),
      keys: Object.keys(details.data || {}),
      slim: slim(details.data),
    },
    cityAreaSearch: {
      http: citySearch.status,
      keys: Object.keys(citySearch.data || {}),
      resultsLen: citySearch.data?.results?.length ?? null,
      slim: slim(citySearch.data),
    },
    previousBooking: {
      br: previousBr,
      statusHttp: status.status,
      statusKeys: Object.keys(status.data || {}),
      statusSlim: slim(status.data),
      detailHttp: detail.status,
      detailKeys: Object.keys(detail.data || {}),
      detailSlim: slim(detail.data),
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    auto: report.autocomplete,
    search: report.search,
    details: report.details,
    city: report.cityAreaSearch,
    prev: report.previousBooking,
  }, null, 2));
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
