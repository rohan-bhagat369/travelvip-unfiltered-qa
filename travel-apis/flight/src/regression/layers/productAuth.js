import { row, errCode, brief } from '../../../hotel/regression/report.js';
import { noteCall } from '../session.js';

function scoredProduct(res, { allowOk = false } = {}) {
  if ((res.status || 0) >= 500) return 'BUG';
  if (allowOk && (res.ok || res.status < 500)) return 'PASS';
  if (res.ok || res.status === 200) return 'BUG';
  if (res.status >= 400 && res.status < 500) return 'PASS';
  return 'BUG';
}

/**
 * Product APIs must 4xx (not 500) when Bearer or X-Partner-Key is missing/junk.
 */
export async function runProductAuth(ctx) {
  const rows = [];
  const { client } = ctx;
  const searchBody = {
    itinerary: [{ origin: 'DEL', destination: 'BOM', date: '2026-10-20' }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };

  const noBearer = await client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 5 },
    body: searchBody,
    auth: false,
    correlation: true,
  });
  noteCall(ctx, 'auth-search-no-bearer', '/v1/flights/search', noBearer);
  rows.push(row(
    'AUTH', 'product', 1, 'POST /v1/flights/search — omit Authorization Bearer',
    'Same valid search body, no Bearer header, keep X-Partner-Key.',
    'HTTP 4xx error.code (never 500)',
    `HTTP ${noBearer.status} code=${errCode(noBearer)} ${brief(noBearer.data, 140)}`,
    scoredProduct(noBearer),
  ));

  const junkBearer = await client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 5 },
    body: searchBody,
    auth: false,
    extraHeaders: { Authorization: 'Bearer gmr_at_invalid<>' },
    correlation: true,
  });
  noteCall(ctx, 'auth-search-junk-bearer', '/v1/flights/search', junkBearer);
  rows.push(row(
    'AUTH', 'product', 2, 'POST /v1/flights/search — garbage Bearer token',
    'Authorization: Bearer gmr_at_invalid<> on OW search.',
    'HTTP 4xx (never 500)',
    `HTTP ${junkBearer.status} code=${errCode(junkBearer)}`,
    scoredProduct(junkBearer),
  ));

  const noPk = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { lang: 'en', currency: 'INR' },
    body: { type: 'ticket', searchIds: ['srch_dummy'], journeyType: 'ONE_WAY', data: { priceId: 'x' } },
    omitPartnerKey: true,
    correlation: true,
    partnerKey: null,
  });
  noteCall(ctx, 'auth-issue-no-partner-key', '/api/v2/flights/booking/issue-ticket', noPk);
  rows.push(row(
    'AUTH', 'product', 3, 'POST /api/v2/flights/booking/issue-ticket — omit X-Partner-Key',
    'Bearer present, omit X-Partner-Key, stub issue-ticket body.',
    'HTTP 4xx (never 500)',
    `HTTP ${noPk.status} code=${errCode(noPk)} ${brief(noPk.data, 140)}`,
    scoredProduct(noPk),
  ));

  const junkPk = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { lang: 'en', currency: 'INR' },
    body: { type: 'ticket', searchIds: ['srch_dummy'], journeyType: 'ONE_WAY', data: { priceId: 'x' } },
    omitPartnerKey: true,
    extraHeaders: { 'X-Partner-Key': 'gmr_at_invalid,' },
    correlation: true,
  });
  noteCall(ctx, 'auth-issue-junk-partner-key', '/api/v2/flights/booking/issue-ticket', junkPk);
  rows.push(row(
    'AUTH', 'product', 4, 'POST /api/v2/flights/booking/issue-ticket — X-Partner-Key with comma',
    'X-Partner-Key=gmr_at_invalid, on stub issue-ticket.',
    'HTTP 4xx (never 500)',
    `HTTP ${junkPk.status} code=${errCode(junkPk)}`,
    scoredProduct(junkPk),
  ));

  const cancelNoPk = await client.request({
    method: 'POST',
    path: '/api/v2/flight/cancel',
    query: { lang: 'en', currency: 'INR' },
    body: { bookingId: 'BR0000000000000001', action: 'CANCEL', pnr: 'ABCDEF', cancelledBy: 'USER' },
    omitPartnerKey: true,
    correlation: true,
  });
  noteCall(ctx, 'auth-cancel-no-partner-key', '/api/v2/flight/cancel', cancelNoPk);
  rows.push(row(
    'AUTH', 'product', 5, 'POST /api/v2/flight/cancel — omit X-Partner-Key',
    'Bearer present, omit X-Partner-Key, dummy bookingId.',
    'HTTP 4xx (never 500)',
    `HTTP ${cancelNoPk.status} code=${errCode(cancelNoPk)}`,
    scoredProduct(cancelNoPk),
  ));

  return rows;
}
