/**
 * Staging-only, no booking.
 * Reproduces the Postman collection INVALID_SIGNATURE on Flight Details,
 * then verifies the fixed signing (HMAC of resolved body + timestamp).
 */
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { config } from '../../../../shared/config/env.js';
import { createRequestId, createSignature, createTimestamp } from '../../../../shared/lib/signature.js';

const SEARCH_BODY = {
  itinerary: [{ origin: 'DEL', destination: 'BOM', date: '2026-11-12' }],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ONE_WAY',
  currency: 'INR',
  language: 'en',
  preferences: { airlines: [], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
  fareType: 'NORMAL',
};

function postmanDetailsRaw(searchIdOrPlaceholder) {
  return `${JSON.stringify({
    journeyType: 'ONE_WAY',
    selection: { selectedSearchIds: [searchIdOrPlaceholder] },
  }, null, 2)}\n`;
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

async function detailsWithSignature(client, { sentBody, signedBody }) {
  const timestamp = createTimestamp();
  const signature = createSignature(signedBody, timestamp, config.signingKey);
  return client.request({
    method: 'POST',
    path: '/v1/flights/details',
    query: { lang: 'en', currency: 'INR' },
    rawBody: sentBody,
    signed: false,
    extraHeaders: {
      'X-Request-Id': createRequestId(),
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    },
  });
}

async function main() {
  console.log('Host:', config.baseUrl);
  console.log('No booking — auth, search, details, fareRules, pricing only');

  const { client } = await authenticate();
  const flight = new FlightService(client);

  const token = await client.request({
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: config.partnerId, partner_secret: config.partnerSecret },
    signed: false,
    auth: false,
  });
  console.log('1 AUTH partner token', token.status, token.ok ? 'PASS' : errCode(token));

  const { response: search, searchId } = await flight.searchUntilComplete(SEARCH_BODY);
  console.log(
    '2 SEARCH',
    search.status,
    'progress=',
    search.data?.progress?.state,
    'searchId=',
    searchId || '(none)',
  );
  if (!searchId) {
    console.log('STOP: no searchId (inventory/progress). Details not tested.');
    process.exit(1);
  }

  const templateBody = postmanDetailsRaw('{{flight_search_id}}');
  const resolvedBody = postmanDetailsRaw(searchId);

  const broken = await detailsWithSignature(client, {
    sentBody: resolvedBody,
    signedBody: templateBody,
  });
  console.log(
    '3 DETAILS (old Postman: sign {{flight_search_id}}, send srch_...)',
    broken.status,
    errCode(broken) || 'OK',
  );

  const fixed = await detailsWithSignature(client, {
    sentBody: resolvedBody,
    signedBody: resolvedBody,
  });
  console.log(
    '4 DETAILS (fixed: sign resolved body)',
    fixed.status,
    errCode(fixed) || 'OK',
    'options=',
    (fixed.data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0),
  );

  const rules = await flight.getFareRules([searchId], 'ONE_WAY');
  console.log('5 FARE RULES', rules.status, errCode(rules) || 'OK');

  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  console.log('6 PRICING', pricing.status, errCode(pricing) || 'OK', 'priceId=', pricing.data?.priceId || pricing.data?.data?.priceId || null);

  const oldBug = errCode(broken) === 'INVALID_SIGNATURE';
  const detailsOk = fixed.ok && !errCode(fixed);
  if (!oldBug || !detailsOk) {
    console.log('RESULT FAIL — expected old=INVALID_SIGNATURE and fixed=200');
    process.exit(1);
  }
  console.log('RESULT PASS — staging Details works with resolved-body HMAC; no booking made');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
