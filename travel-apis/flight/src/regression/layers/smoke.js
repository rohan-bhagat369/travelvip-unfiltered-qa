import { row, errCode, brief } from '../../../hotel/regression/report.js';
import { noteCall } from '../session.js';
import { FLIGHT_QUERY } from '../../helpers.js';

export async function runSmoke(ctx) {
  const rows = [];
  const { flight, client } = ctx;

  const airports = await flight.airportSearch('BOM');
  noteCall(ctx, 'airports', '/v1/flights/airports', airports);
  const airportHits = airports.data?.content?.length
    || airports.data?.airports?.length
    || airports.data?.results?.length
    || 0;
  rows.push(row(
    'SMOKE', 'catalog', 1, 'Airports catalog with pid',
    'GET /v1/flights/airports?airport=BOM',
    'HTTP 200 list',
    `HTTP ${airports.status} hits=${airportHits} code=${errCode(airports)}`,
    airports.ok && airportHits > 0 ? 'PASS' : 'BUG',
  ));

  const airlines = await flight.airlineSearch('AI');
  noteCall(ctx, 'airlines', '/v1/flights/airlines', airlines);
  const airlineHits = airlines.data?.content?.length
    || airlines.data?.airlines?.length
    || airlines.data?.results?.length
    || 0;
  rows.push(row(
    'SMOKE', 'catalog', 2, 'Airlines catalog',
    'GET /v1/flights/airlines?airline=AI',
    'HTTP 200 list',
    `HTTP ${airlines.status} hits=${airlineHits}`,
    airlines.ok && airlineHits > 0 ? 'PASS' : 'BUG',
  ));

  const cities = await flight.citySearch('Pune');
  noteCall(ctx, 'citySearch', '/v1/flights/citySearch', cities);
  const cityHits = cities.data?.content?.length || cities.data?.results?.length || 0;
  rows.push(row(
    'SMOKE', 'catalog', 3, 'citySearch with pid',
    'GET /v1/flights/citySearch?q=Pune',
    'HTTP 200',
    `HTTP ${cities.status} hits=${cityHits}`,
    cities.ok && cityHits > 0 ? 'PASS' : 'BUG',
  ));

  const pid = await client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { ...FLIGHT_QUERY, page: 0, perpage: 10, pid: 'vgm' },
    body: {
      itinerary: [{ origin: 'DEL', destination: 'BOM', date: '2026-10-08' }],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      journeyType: 'ONE_WAY',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: null, refundableOnly: false },
      appliedFilters: {},
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    },
    correlation: true,
  });
  noteCall(ctx, 'search-pid', '/v1/flights/search', pid);
  const opts = (pid.data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0);
  rows.push(row(
    'SMOKE', 'catalog', 4, 'OW search pid=vgm',
    'POST /v1/flights/search DEL→BOM',
    'HTTP 200 (inventory or in-progress search)',
    `HTTP ${pid.status} options=${opts} progress=${pid.data?.progress?.state || null} code=${errCode(pid)}`,
    pid.ok || pid.status === 200 ? 'PASS' : 'BUG',
  ));

  return rows;
}
