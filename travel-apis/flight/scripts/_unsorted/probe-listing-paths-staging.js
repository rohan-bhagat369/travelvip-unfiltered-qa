/**
 * Probe whether listing-v2 exists on api-staging vs live /v1/hotels/search.
 */
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';

const body = {
  entityId: '357389:IN',
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

const query = {
  pid: 'vgm',
  tierId: '10546901',
  subscriptionId: '123841304969662b8',
  offset: '0',
  limit: '5',
  sort: 'price_ASC',
  lang: 'en',
  currency: 'INR',
};

const paths = [
  '/api/hotels/v2/availability/listing',
  '/hotels/v2/availability/listing',
  '/api/v2/hotels/availability/listing',
  '/v2/hotels/availability/listing',
  '/v1/hotels/search',
];

clearSession();
const { client } = await authenticate(true);

for (const path of paths) {
  const res = await client.request({
    method: 'POST',
    path,
    query,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const n = Array.isArray(res.data?.results) ? res.data.results.length : 0;
  const snippet = JSON.stringify(res.data).slice(0, 180);
  console.log(JSON.stringify({
    path,
    status: res.status,
    ok: res.ok,
    n,
    total: res.data?.totalResults ?? null,
    sorts: res.data?.sorts ? true : false,
    requestId: res.data?.requestId || null,
    snippet,
  }));
}

console.log('host', config.baseUrl);
