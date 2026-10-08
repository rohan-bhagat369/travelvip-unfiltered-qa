/**
 * Prod impact check: one airport search, then one flight search. No book, no pricing.
 */
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, isSearchProgressComplete } from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const days = Number(process.env.FARE_LANES_DAYS || '35');

clearSession();
const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const flight = new FlightService(session.client);

const airport = await flight.airportSearch('BOM');
const hits = airport.data?.result || airport.data?.results || airport.data?.content || airport.data?.airports || [];
const list = Array.isArray(hits) ? hits : [];
const top = list.slice(0, 3).map((h) => ({
  code: h.airportCode || h.code || h.iata || null,
  name: h.airportName || h.name || null,
  city: h.city || h.cityName || null,
}));
const bom = list.some((h) => String(h.airportCode || h.code || h.iata || '').toUpperCase() === 'BOM');

const body = buildOneWaySearchBody(days, { origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL' });
let search = null;
for (let i = 0; i < 4; i += 1) {
  search = await session.client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 5, sortby: 'fare,asc' },
    body,
    correlation: true,
  });
  const n = collectOptions(search.data).length;
  if (!search.ok || isSearchProgressComplete(search.data) || n > 0) break;
  await sleep(search.data?.progress?.pollAfterMs || 2000);
}
const options = collectOptions(search.data);
const cats = [...new Set(options.flatMap((o) => (o.fares || []).map((f) => String(f.fareCategory || '').toUpperCase()).filter(Boolean)))];

console.log(JSON.stringify({
  airport: {
    http: airport.status,
    n: list.length,
    bom,
    top,
    code: airport.data?.error?.code || null,
  },
  flight: {
    http: search.status,
    state: search.data?.progress?.state || null,
    options: options.length,
    cats,
    code: search.data?.error?.code || null,
    cheapest: options[0]?.displayPricing?.pricing?.totalAmount
      ?? options[0]?.displayPricing?.totalAmount
      ?? options[0]?.fares?.[0]?.pricing?.totalAmount
      ?? null,
  },
}, null, 2));
