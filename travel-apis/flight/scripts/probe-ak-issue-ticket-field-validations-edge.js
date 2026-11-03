/**
 * ak-api gap suite: issue-ticket field edges
 * - Full SSR item, only priceReference bad / omitted
 * - Wrong types (0, true, {}, [])
 * - Whitespace-only
 * - Special / HTML chars
 *
 * Single baseline: DEL–BOM 2026-11-12 NORMAL (no date loop).
 *
 *   BASE_URL=https://ak-api.travelvip.ai node travel-apis/flight/scripts/probe-ak-issue-ticket-field-validations-edge.js
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

const OUT = path.join('travel-apis', 'flight', 'reports', 'ak-flight-issue-field-validations-edge.json');
const ISSUE_PATH = '/api/v2/flights/booking/issue-ticket';

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 400) {
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
    note = `HTTP ${http} — must be 4xx + error.code`;
  } else if (http >= 400 && http < 500 && code === 'VALIDATION_ERROR') {
    status = 'PASS';
    note =
      hintRe && !hintRe.test(text)
        ? `VALIDATION_ERROR (detail soft-miss: ${text.slice(0, 140)})`
        : `VALIDATION_ERROR ${text.slice(0, 160)}`;
  } else if (http >= 400 && http < 500 && code) {
    status = 'PASS';
    note = `Rejected HTTP ${http} code=${code}`;
  } else if (http >= 200 && http < 300 && !code) {
    status = 'BUG';
    note = `Accepted invalid ${field}`;
  } else {
    status = 'BUG';
    note = `Unexpected HTTP ${http} code=${code}`;
  }
  console.log(`[${status}] ${id} → HTTP ${http} ${code || ''}`);
  return { id, kind: 'negative', field, rule, mutation, status, note, http, code, details, snippet: brief(res?.data) };
}

function fullMeal(priceReference) {
  return {
    mealId: 'MEAL_EDGE_1',
    ssrId: 'MEAL_EDGE_1',
    code: 'VGML',
    title: 'Veg Meal',
    description: 'Vegetarian meal',
    segmentId: 'SEG_1',
    direction: 'ONWARD',
    paxType: 'ADT',
    quantity: 1,
    priceReference,
    amount: 350,
    origin: 'DEL',
    destination: 'BOM',
  };
}
function fullBag(priceReference) {
  return {
    baggageId: 'BAG_EDGE_1',
    ssrId: 'BAG_EDGE_1',
    code: 'XBAG',
    title: 'Extra Bag 5kg',
    description: 'Extra baggage 5kg',
    segmentId: 'SEG_1',
    direction: 'ONWARD',
    paxType: 'ADT',
    quantity: 1,
    priceReference,
    amount: 1200,
    weight: 5,
    origin: 'DEL',
    destination: 'BOM',
  };
}
function fullSeat(priceReference) {
  return {
    segmentId: 'SEG_1',
    seatName: '12A',
    seatNumber: '12A',
    seatId: 'SEAT_EDGE_1',
    seatAvailability: 'Open',
    code: '12A',
    amount: 499,
    price: 499,
    priceReference,
    seatKey: 'SEAT_EDGE_1',
    seatRef: 'SEAT_EDGE_1',
    seatType: 'WINDOW',
    direction: 'ONWARD',
    paxType: 'ADT',
    description: 'Seat 12A',
    origin: 'DEL',
    destination: 'BOM',
  };
}

function applySsr(payload, kind, item) {
  const pax = payload.data.passengers[0];
  if (!pax.ssr) pax.ssr = { baggage: [], meals: [], seats: [] };
  pax.ssr.baggage = [];
  pax.ssr.meals = [];
  pax.ssr.seats = [];
  pax.ssr[kind] = [item];
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const body = buildOneWaySearchBody(31, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.itinerary[0].date = '2026-11-12';
  const search = await flight.search(body);
  if (!ok(search)) throw new Error(`search failed ${search?.status} ${errCode(search)}`);
  const searchId = extractFirstSearchId(search.data);
  if (!searchId) throw new Error('no searchId');
  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) {
    throw new Error(`pricing failed ${pricing?.status} ${errCode(pricing)}`);
  }
  const base = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
  });
  base.type = 'ticket';
  base.data.passportType = 'NONE';
  base.data.includeGst = false;
  base.data.gstDetails = null;
  console.log('Priced OK', { searchId, priceId: pricing.data.priceId, brLen: String(base.bookingReference || '').length });

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
  const brHint = /bookingReference|invalid|required|empty|blank|type|format/i;
  const prHint = /priceReference|ssr|meal|baggage|seat|invalid|required|empty|blank|type|format/i;

  // --- bookingReference edges ---
  const brEdges = [
    { key: 'whitespace', value: '   ' },
    { key: 'html', value: '<script>alert(1)</script>' },
    { key: 'num-zero', value: 0 },
    { key: 'bool-true', value: true },
    { key: 'obj', value: {} },
    { key: 'arr', value: [] },
  ];
  for (const bv of brEdges) {
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
        brHint,
      ),
    );
  }

  const ssrKinds = [
    { kind: 'meals', prefix: 'MEAL', field: 'ssr.meals.priceReference', build: fullMeal },
    { kind: 'baggage', prefix: 'BAG', field: 'ssr.baggage.priceReference', build: fullBag },
    { kind: 'seats', prefix: 'SEAT', field: 'ssr.seats.priceReference', build: fullSeat },
  ];

  const prMutations = [
    { key: 'full-empty', value: '', mode: 'set' },
    { key: 'full-null', value: null, mode: 'set' },
    { key: 'full-zero-string', value: '0', mode: 'set' },
    { key: 'full-invalid', value: 'INVALID_PRICE_REF_XYZ', mode: 'set' },
    { key: 'full-omit', value: undefined, mode: 'omit' },
    { key: 'full-whitespace', value: '   ', mode: 'set' },
    { key: 'full-html', value: '<img src=x onerror=alert(1)>', mode: 'set' },
    { key: 'full-num-zero', value: 0, mode: 'set' },
    { key: 'full-bool', value: true, mode: 'set' },
    { key: 'full-obj', value: {}, mode: 'set' },
    { key: 'full-arr', value: [], mode: 'set' },
  ];

  for (const sk of ssrKinds) {
    for (const m of prMutations) {
      const p = clone(base);
      const item = sk.build(m.mode === 'omit' ? 'PLACEHOLDER' : m.value);
      if (m.mode === 'omit') delete item.priceReference;
      else item.priceReference = m.value;
      applySsr(p, sk.kind, item);
      const res = await issue(p);
      rows.push(
        scoreReject(
          `${sk.prefix}-${m.key}`,
          `full ${sk.kind} item; priceReference ${m.mode === 'omit' ? 'omitted' : `=${JSON.stringify(m.value)}`} → validation error`,
          sk.field,
          m.key,
          res,
          prHint,
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
    suite: 'edge-gap',
    searchMeta: {
      route: 'DEL-BOM',
      departDate: '2026-11-12',
      searchId,
      priceId: pricing.data.priceId,
    },
    counts,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('COUNTS', counts);
  console.log('WROTE', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
