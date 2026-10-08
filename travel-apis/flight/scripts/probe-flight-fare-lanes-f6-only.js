/** One TEZ→HJR search on production. No book. */
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { buildOneWaySearchBody, isSearchProgressComplete } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const days = Number(process.env.FARE_LANES_DAYS || '35');

clearSession();
const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const body = buildOneWaySearchBody(days, { origin: 'TEZ', destination: 'HJR', maxStops: null, fareType: 'NORMAL' });
let res = null;
for (let i = 0; i < 4; i += 1) {
  res = await session.client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 5, sortby: 'fare,asc' },
    body,
    correlation: true,
  });
  if (!res.ok || isSearchProgressComplete(res.data)) break;
  await sleep(res.data?.progress?.pollAfterMs || 2000);
}
const code = res.data?.error?.code || null;
console.log(JSON.stringify({
  http: res.status,
  code,
  message: res.data?.error?.message || null,
  state: res.data?.progress?.state || null,
  options: res.data?.results?.[0]?.options?.length ?? null,
}, null, 2));
process.exit(code === 'NO_FLIGHTS_FOUND' ? 0 : 1);
