/**
 * ak-api: Flight Issue Ticket field validations
 * POST /api/v2/flights/booking/issue-ticket
 *
 * Fields → VALIDATION_ERROR when empty / null / "0" / invalid:
 *   bookingReference
 *   ssr.meals[].priceReference
 *   ssr.baggage[].priceReference
 *   ssr.seats[].priceReference
 *
 * Run:
 *   BASE_URL=https://ak-api.travelvip.ai node travel-apis/flight/scripts/probe-ak-issue-ticket-field-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
} from '../src/helpers.js';

const OUT = path.join(
  'reports',
  process.env.AK_ISSUE_VAL_OUT || 'ak-flight-issue-field-validations.json',
);
const ISSUE_PATH = '/api/v2/flights/booking/issue-ticket';

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 500) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d);
  }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function detailsArr(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function scoreReject(id, rule, field, mutation, res, hintRe) {
  const http = res?.status ?? 0;
  const code = errCode(res);
  const details = detailsArr(res);
  const text = `${details.join(' | ')} | ${res?.data?.error?.message || ''}`;
  let status = 'BUG';
  let note = '';
  if (http >= 500) {
    status = 'BUG';
    note = `HTTP ${http} — must be 4xx VALIDATION_ERROR`;
  } else if (http >= 400 && http < 500 && code === 'VALIDATION_ERROR') {
    status = 'PASS';
    note = hintRe && !hintRe.test(text)
      ? `VALIDATION_ERROR (detail hint soft-miss: ${text.slice(0, 120)})`
      : `VALIDATION_ERROR ${text.slice(0, 160)}`;
  } else if (http >= 400 && http < 500 && code) {
    status = 'PASS';
    note = `Rejected HTTP ${http} code=${code} (prefer VALIDATION_ERROR)`;
  } else if (http >= 200 && http < 300 && !code) {
    status = 'BUG';
    note = `Accepted invalid ${field}`;
  } else {
    status = 'BUG';
    note = `Unexpected HTTP ${http} code=${code}`;
  }
  const row = {
    id,
    kind: 'negative',
    field,
    rule,
    mutation,
    status,
    note,
    http,
    code,
    details,
    snippet: brief(res?.data, 350),
  };
  console.log(`[${status}] ${id} ${rule} → HTTP ${http} ${code || ''}`);
  return row;
}

function scorePositive(id, rule, res) {
  const http = res?.status ?? 0;
  const code = errCode(res);
  // Positive = not VALIDATION_ERROR on the field under test.
  // Book may succeed (2xx) or fail later business (wallet/offer) — both OK if not field validation.
  let status = 'PASS';
  let note = `HTTP ${http} code=${code || 'none'}`;
  if (http >= 500) {
    status = 'BUG';
    note = `HTTP ${http}`;
  } else if (http === 400 && code === 'VALIDATION_ERROR') {
    status = 'BUG';
    note = `Unexpected VALIDATION_ERROR on valid baseline: ${detailsArr(res).join(' | ').slice(0, 160)}`;
  }
  const row = {
    id,
    kind: 'positive',
    field: 'baseline',
    rule,
    status,
    note,
    http,
    code,
    details: detailsArr(res),
    snippet: brief(res?.data, 350),
    bookingReference: res?.data?.bookingReference || null,
  };
  console.log(`[${status}] ${id} ${rule} → HTTP ${http} ${code || ''}`);
  return row;
}

function ensureSsrSlot(pax, kind) {
  if (!pax.ssr) pax.ssr = { baggage: [], meals: [], seats: [] };
  if (!Array.isArray(pax.ssr[kind])) pax.ssr[kind] = [];
  if (pax.ssr[kind].length === 0) {
    pax.ssr[kind].push({
      priceReference: 'PLACEHOLDER',
      quantity: 1,
      segmentId: 'SEG1',
    });
  }
  return pax.ssr[kind][0];
}

async function main() {
  console.log('BASE', config.baseUrl);
  console.log('Issue', ISSUE_PATH);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  let base = null;
  let searchMeta = null;
  // ak-api: CORPORATE often returns NO_FLIGHTS_FOUND; Postman/dev inventory is NORMAL
  const routes = [
    { origin: 'DEL', destination: 'BOM' },
    { origin: 'BOM', destination: 'DEL' },
    { origin: 'DEL', destination: 'BLR' },
    { origin: 'BOM', destination: 'GOI' },
  ];
  outer: for (const route of routes) {
    for (const days of [31, 28, 35, 21, 42]) {
      const body = buildOneWaySearchBody(days, { ...route, fareType: 'NORMAL', maxStops: 0 });
      if (days === 31) body.itinerary[0].date = '2026-11-12'; // known-good Postman date on ak-api
      const search = await flight.search(body);
      if (!ok(search)) {
        console.log('search fail', route.origin, route.destination, days, search?.status, errCode(search));
        continue;
      }
      const searchId = extractFirstSearchId(search.data);
      if (!searchId) continue;
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) {
        console.log('pricing fail', route.origin, route.destination, days, pricing?.status, errCode(pricing));
        continue;
      }
      base = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
      });
      base.type = 'ticket';
      base.data.passportType = 'NONE';
      base.data.includeGst = false;
      base.data.gstDetails = null;
      searchMeta = {
        route: `${route.origin}-${route.destination}`,
        days,
        searchId,
        priceId: pricing.data.priceId,
        bookingContextLen: String(pricing.data.bookingContext).length,
        departDate: body.itinerary[0].date,
      };
      console.log('Priced OK', searchMeta);
      break outer;
    }
  }
  if (!base) throw new Error('Could not price a flight on this BASE_URL for validation baseline');

  const issue = (payload) =>
    client.request({
      method: 'POST',
      path: ISSUE_PATH,
      query: FLIGHT_QUERY,
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });

  const rows = [];

  // Positive: valid bookingReference, empty SSR arrays (no bad priceReference)
  {
    const res = await issue(clone(base));
    rows.push(scorePositive('P1', 'valid bookingReference + empty ssr arrays (no bad priceReference)', res));
  }

  const badValues = [
    { key: 'empty', value: '', hint: /bookingReference|empty|blank|required|invalid/i },
    { key: 'null', value: null, hint: /bookingReference|null|required|invalid/i },
    { key: 'zero-string', value: '0', hint: /bookingReference|invalid|0/i },
    { key: 'invalid', value: 'NOT_A_REAL_BOOKING_REF', hint: /bookingReference|invalid|not.?found|required/i },
  ];

  for (const bv of badValues) {
    const p = clone(base);
    p.bookingReference = bv.value;
    const res = await issue(p);
    rows.push(
      scoreReject(
        `BR-${bv.key}`,
        `bookingReference=${JSON.stringify(bv.value)} → validation error`,
        'bookingReference',
        bv.key,
        res,
        bv.hint,
      ),
    );
  }

  // omit bookingReference
  {
    const p = clone(base);
    delete p.bookingReference;
    const res = await issue(p);
    rows.push(
      scoreReject(
        'BR-omit',
        'bookingReference omitted → validation error',
        'bookingReference',
        'omit',
        res,
        /bookingReference|required/i,
      ),
    );
  }

  const ssrKinds = [
    { kind: 'meals', field: 'ssr.meals.priceReference', prefix: 'MEAL' },
    { kind: 'baggage', field: 'ssr.baggage.priceReference', prefix: 'BAG' },
    { kind: 'seats', field: 'ssr.seats.priceReference', prefix: 'SEAT' },
  ];
  const ssrBads = [
    { key: 'empty', value: '' },
    { key: 'null', value: null },
    { key: 'zero-string', value: '0' },
    { key: 'invalid', value: 'INVALID_PRICE_REF_XYZ' },
  ];

  for (const sk of ssrKinds) {
    for (const bv of ssrBads) {
      const p = clone(base);
      const pax = p.data.passengers[0];
      const item = ensureSsrSlot(pax, sk.kind);
      item.priceReference = bv.value;
      const res = await issue(p);
      rows.push(
        scoreReject(
          `${sk.prefix}-${bv.key}`,
          `${sk.field}=${JSON.stringify(bv.value)} → validation error`,
          sk.field,
          bv.key,
          res,
          /priceReference|ssr|meal|baggage|seat|invalid|required|empty/i,
        ),
      );
    }
  }

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    issuePath: ISSUE_PATH,
    searchMeta,
    counts,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // Prefer domain reports folder when cwd is repo root
  const domainOut = path.join('travel-apis', 'flight', OUT);
  fs.mkdirSync(path.dirname(domainOut), { recursive: true });
  fs.writeFileSync(domainOut, JSON.stringify(summary, null, 2));
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('COUNTS', counts);
  console.log('WROTE', domainOut);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
