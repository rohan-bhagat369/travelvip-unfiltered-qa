/**
 * A5 — quick smoke that hotel/flight product APIs still work after cab schema work.
 * No live hotel/flight book.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-a5-other-services-smoke.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../../hotel/src/service.js';
import { FlightService } from '../../flight/src/service.js';
import { buildSearchBody } from '../../hotel/src/helpers.js';
import { buildOneWaySearchBody } from '../../flight/src/helpers.js';

function row(id, rule, how, status, notes = '') {
  return { id, rule, how, status, notes };
}

async function main() {
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const flight = new FlightService(client);
  const rows = [];

  // Hotel smoke
  try {
    const ac = await hotel.autocomplete('pune');
    const content = ac.data?.content || ac.data?.results || [];
    rows.push(
      row(
        'A5.H1',
        'Hotel autocomplete still works',
        'GET /v1/hotels/autocomplete?q=pune',
        ac.status >= 200 && ac.status < 300 && content.length ? 'PASS' : 'BUG',
        `http=${ac.status} hits=${content.length}`,
      ),
    );
  } catch (e) {
    rows.push(row('A5.H1', 'Hotel autocomplete', 'GET autocomplete', 'BUG', String(e.message || e)));
  }

  try {
    const search = await hotel.search(buildSearchBody({ entityId: '357389:IN' }));
    const total =
      search.data?.totalResults ??
      search.data?.availability?.totalResults ??
      search.data?.hotels?.length ??
      0;
    rows.push(
      row(
        'A5.H2',
        'Hotel search Mumbai still works',
        'POST /v1/hotels/search',
        search.status >= 200 && search.status < 300 ? 'PASS' : 'BUG',
        `http=${search.status} total≈${total}`,
      ),
    );
  } catch (e) {
    rows.push(row('A5.H2', 'Hotel search', 'POST search', 'BUG', String(e.message || e)));
  }

  // Flight smoke
  try {
    const ap = await flight.airportSearch('BOM');
    const n =
      ap.data?.content?.length ??
      ap.data?.airports?.length ??
      ap.data?.results?.length ??
      0;
    rows.push(
      row(
        'A5.F1',
        'Flight airports catalog',
        'GET /v1/flights/airports?airport=BOM',
        ap.status >= 200 && ap.status < 300 && n > 0 ? 'PASS' : 'BUG',
        `http=${ap.status} n=${n}`,
      ),
    );
  } catch (e) {
    rows.push(row('A5.F1', 'Flight airports', 'GET airports', 'BUG', String(e.message || e)));
  }

  try {
    const body = buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM' });
    const search = await flight.search(body);
    const options =
      search.data?.options?.length ??
      search.data?.results?.length ??
      search.data?.onward?.length ??
      0;
    rows.push(
      row(
        'A5.F2',
        'Flight OW search DEL→BOM',
        'POST /v1/flights/search',
        search.status >= 200 && search.status < 300 ? 'PASS' : 'BUG',
        `http=${search.status} options≈${options} (empty page OK if polling)`,
      ),
    );
  } catch (e) {
    rows.push(row('A5.F2', 'Flight search', 'POST search', 'BUG', String(e.message || e)));
  }

  // Cab still reachable (sanity)
  try {
    const cabStatus = await client.request({
      method: 'GET',
      path: '/v1/airportServices/cabs/booking/BR1787744137248898/status',
      query: { lang: 'en', currency: 'INR' },
      correlation: true,
    });
    rows.push(
      row(
        'A5.C1',
        'Cab status still readable',
        'GET cab booking status',
        cabStatus.status >= 200 && cabStatus.status < 300 ? 'PASS' : 'BUG',
        `http=${cabStatus.status} status=${cabStatus.data?.status}`,
      ),
    );
  } catch (e) {
    rows.push(row('A5.C1', 'Cab status', 'GET status', 'BUG', String(e.message || e)));
  }

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = { when: new Date().toISOString(), summary, rows };
  fs.writeFileSync('reports/cab-a5-other-services-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
