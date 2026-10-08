/**
 * Replay search → details → prebook for Hilltop Mumbai (same stay as BR1786711327778765).
 * Does not finalize.
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { buildSearchBody, extractRequestId, isPrebookSuccess } from '../src/helpers.js';

const OUT = path.join('reports', 'prebook-BR1786711327778765.json');
const ENTITY = '39627872';
const CHECKIN = '2026-09-11';
const CHECKOUT = '2026-09-12';

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const searchBody = buildSearchBody({
    entityId: ENTITY,
    checkinDays: 28,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.checkin = CHECKIN;
  searchBody.checkout = CHECKOUT;
  searchBody.type = 'HOTEL';

  const search = await hotel.search(searchBody);
  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const rooms = (details.data?.results?.[0]?.rooms || []).filter((r) => r.bookingCode);
  const room = rooms[0];
  if (!requestId || !room) {
    throw new Error(`No room/requestId search=${search.status} details=${details.status}`);
  }

  const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  const report = {
    note: 'Original prebook for BR1786711327778765 was not persisted. This is a live replay of the same hotel/dates/occupancy on canary (new requestId/bookingCode).',
    originalBr: 'BR1786711327778765',
    baseUrl: process.env.BASE_URL,
    at: new Date().toISOString(),
    searchHttp: search.status,
    detailsHttp: details.status,
    requestId,
    bookingCode: room.bookingCode,
    hotelName: details.data?.results?.[0]?.name,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    prebookSuccess: isPrebookSuccess(pre),
    prebookHttp: pre.status,
    prebook: pre.data,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
