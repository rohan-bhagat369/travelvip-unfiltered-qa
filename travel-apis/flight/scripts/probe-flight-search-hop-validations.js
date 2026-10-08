/**
 * Flight search + details/pricing/fareRules/SSR/seatmap payload validations.
 * Extra commas / special chars must be 4xx, never HTTP 500.
 *
 * Run: node scripts/probe-flight-search-hop-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', process.env.FLIGHT_SEARCH_HOP_VAL_OUT || 'flight-search-hop-validations.json');

function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function detailsArr(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function scoreReject(res) {
  if ((res.status || 0) >= 500) {
    return { status: 'BUG', actual: `HTTP ${res.status} Internal Server Error — expected 4xx VALIDATION_ERROR, never 500` };
  }
  if (res.ok || res.status === 200) {
    return { status: 'BUG', actual: `Accepted invalid payload HTTP ${res.status} code=${errCode(res)}` };
  }
  if (res.status === 400 && errCode(res) === 'VALIDATION_ERROR') {
    return { status: 'PASS', actual: `HTTP 400 VALIDATION_ERROR details=${detailsArr(res).join('; ').slice(0, 160)}` };
  }
  if (res.status >= 400 && res.status < 500) {
    return { status: 'PASS', actual: `HTTP ${res.status} code=${errCode(res)} (4xx, not 500)` };
  }
  return { status: 'BUG', actual: `HTTP ${res.status} code=${errCode(res)}` };
}

function scoreNo500(res, { allow200 = false } = {}) {
  if ((res.status || 0) >= 500) {
    return { status: 'BUG', actual: `HTTP ${res.status} Internal Server Error after special chars — expected 4xx, never 500` };
  }
  if (allow200 && (res.ok || res.status === 200)) {
    return { status: 'PASS', actual: `HTTP ${res.status} (accepted; not 500)` };
  }
  if (res.ok || res.status === 200) {
    return { status: 'BUG', actual: 'Accepted payload with extra comma / special chars' };
  }
  if (res.status >= 400 && res.status < 500) {
    return { status: 'PASS', actual: `HTTP ${res.status} code=${errCode(res)} (valid client error, not 500)` };
  }
  return { status: 'BUG', actual: `HTTP ${res.status} code=${errCode(res)}` };
}

async function pollSearch(flight, body, max = 6) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const n = (last.data?.results || []).reduce((c, b) => c + (b.options?.length || 0), 0);
    if (!last.ok || errCode(last) === 'VALIDATION_ERROR' || n > 0 || isSearchProgressComplete(last.data)) {
      return last;
    }
    await sleep(2000);
  }
  return last;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const rows = [];

  const add = (id, api, rule, how, expected, scored, res) => {
    rows.push({
      id,
      api,
      rule: `${api} — ${rule}`,
      how,
      expected,
      actual: scored.actual,
      status: scored.status,
      note: scored.actual,
      http: res?.status ?? null,
      code: errCode(res),
      snippet: res ? brief(res.data, 320) : null,
      responseSnippet: res ? brief(res.data, 320) : null,
    });
    console.log(`[${scored.status}] ${id} ${api} — ${rule}`);
  };

  const searchApi = 'POST /v1/flights/search';
  const base = buildOneWaySearchBody(40, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });

  const searchOk = await pollSearch(flight, base);
  const searchOkHttp = searchOk.ok || searchOk.status === 200;
  add(
    'S0',
    searchApi,
    'valid OW DEL→BOM ECONOMY 1ADT baseline',
    `${searchApi} with itinerary DEL-BOM, travellers 1ADT, cabinClass=ECONOMY, fareType=NORMAL.`,
    'HTTP 200 (inventory or in-progress), not VALIDATION_ERROR, not 500',
    searchOkHttp && errCode(searchOk) !== 'VALIDATION_ERROR' && (searchOk.status || 0) < 500
      ? { status: 'PASS', actual: `HTTP ${searchOk.status} code=${errCode(searchOk)} options=${(searchOk.data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0)}` }
      : { status: 'BUG', actual: `HTTP ${searchOk.status} code=${errCode(searchOk)}` },
    searchOk,
  );

  const searchCases = [
    ['S1', 'omit itinerary', (b) => { delete b.itinerary; }, false],
    ['S2', 'origin with trailing comma (DEL,)', (b) => { b.itinerary[0].origin = 'DEL,'; }, false],
    ['S3', 'destination with HTML/script chars', (b) => { b.itinerary[0].destination = 'BOM<script>'; }, false],
    ['S4', 'cabinClass with trailing comma (ECONOMY,)', (b) => { b.cabinClass = 'ECONOMY,'; }, false],
    ['S5', 'cabinClass invalid enum CABIN_X', (b) => { b.cabinClass = 'CABIN_X'; }, false],
    ['S6', 'travellers.adults as string "1"', (b) => { b.travellers.adults = '1'; }, false],
    ['S7', 'infants > adults', (b) => { b.travellers = { adults: 1, children: 0, infants: 2 }; }, false],
    ['S8', 'fareType invalid GARBAGE', (b) => { b.fareType = 'GARBAGE'; }, false],
    ['S9', 'journeyType ONEWAY (missing underscore)', (b) => { b.journeyType = 'ONEWAY'; }, false],
    ['S10', 'omit travellers', (b) => { delete b.travellers; }, false],
  ];
  for (const [id, rule, mut] of searchCases) {
    const body = clone(base);
    mut(body);
    const res = await flight.search(body);
    add(id, searchApi, rule, `Clone valid OW search, change only this: ${rule}, then ${searchApi}.`, 'HTTP 4xx VALIDATION_ERROR (never HTTP 500)', scoreReject(res), res);
  }

  const searchId = extractFirstSearchId(searchOk.data);
  const hopOk = Boolean(searchId);
  const sel = { journeyType: 'ONE_WAY', selection: { selectedSearchIds: searchId ? [searchId] : [] } };

  if (!hopOk) {
    add('H0', 'POST /v1/flights/details', 'priced searchId for hop validations', searchApi, 'searchId from S0', { status: 'NOT TESTED', actual: 'no searchId from baseline search' }, searchOk);
  } else {
    const details = await flight.getDetails([searchId], 'ONE_WAY');
    add('H0', 'POST /v1/flights/details', 'valid searchIds baseline', `POST /v1/flights/details { selectedSearchIds: [${searchId}] }`, 'HTTP 200 or documented vendor error, not 500', scoreNo500(details, { allow200: true }), details);

    const call = (pathName, body) => session.client.request({
      method: 'POST',
      path: pathName,
      query: FLIGHT_QUERY,
      body,
      correlation: true,
    });

    const hopCases = [
      ['D1', 'POST /v1/flights/details', 'empty selectedSearchIds', { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [] } }, false],
      ['D2', 'POST /v1/flights/details', 'searchId with trailing comma', { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [`${searchId},`] } }, false],
      ['D3', 'POST /v1/flights/details', 'omit journeyType', { selection: { selectedSearchIds: [searchId] } }, false],
      ['P1', 'POST /v1/flights/pricing', 'empty selectedSearchIds', { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [] } }, false],
      ['P2', 'POST /v1/flights/pricing', 'searchId with HTML chars', { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [`${searchId}<script>`] } }, false],
      ['FR1', 'POST /v1/flights/fareRules', 'empty selectedSearchIds', { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [] } }, false],
      ['FR2', 'POST /v1/flights/fareRules', 'searchId with trailing comma', { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [`${searchId},`] } }, false],
    ];
    for (const [id, api, rule, body] of hopCases) {
      const res = await call(api.replace('POST ', ''), body);
      add(id, api, rule, `Clone valid ${api} body, mutate: ${rule}.`, 'HTTP 4xx (never 500)', scoreReject(res), res);
    }

    const pricing = await flight.getPricing([searchId], 'ONE_WAY');
    add('P0', 'POST /v1/flights/pricing', 'valid searchIds baseline', `POST /v1/flights/pricing selectedSearchIds=[${searchId}]`, 'HTTP 200 with priceId, not 500', scoreNo500(pricing, { allow200: true }), pricing);
    const priceId = pricing.data?.priceId;
    const ctxRef = pricing.data?.bookingContext;

    const ssrMissing = await flight.getSsr(undefined);
    add('SSR1', 'POST /v1/flights/ssr', 'omit priceId', 'POST /v1/flights/ssr body {}', 'HTTP 4xx (never 500)', scoreReject(ssrMissing), ssrMissing);
    const ssrComma = await flight.getSsr(priceId ? `${priceId},` : 'price,');
    add('SSR2', 'POST /v1/flights/ssr', 'priceId with trailing comma', 'POST /v1/flights/ssr { priceId: "<id>," }', 'HTTP 4xx (never 500)', scoreReject(ssrComma), ssrComma);
    const ssrJunk = await flight.getSsr('abc<script>');
    add('SSR3', 'POST /v1/flights/ssr', 'priceId with HTML/script chars', 'POST /v1/flights/ssr { priceId: "abc<script>" }', 'HTTP 4xx (never 500)', scoreReject(ssrJunk), ssrJunk);

    const seatMissing = await session.client.request({
      method: 'POST', path: '/v1/flights/seatmap', query: FLIGHT_QUERY,
      body: { currency: 'INR', passengers: [{ type: 'adult', title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat' }] },
      correlation: true,
    });
    add('SM1', 'POST /v1/flights/seatmap', 'omit requestReference', 'POST /v1/flights/seatmap without requestReference', 'HTTP 4xx (never 500)', scoreReject(seatMissing), seatMissing);
    const seatComma = await session.client.request({
      method: 'POST', path: '/v1/flights/seatmap', query: FLIGHT_QUERY,
      body: { currency: 'INR', requestReference: `${ctxRef || 'ctx'},`, passengers: [{ type: 'adult', title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat' }] },
      correlation: true,
    });
    add('SM2', 'POST /v1/flights/seatmap', 'requestReference with trailing comma', 'POST /v1/flights/seatmap requestReference="<ctx>,"', 'HTTP 4xx (never 500)', scoreReject(seatComma), seatComma);

    void sel;
  }

  const summary = {
    baseUrl: config.baseUrl,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      BUG: rows.filter((r) => r.status === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
      total: rows.length,
    },
    bugs: rows.filter((r) => r.status === 'BUG'),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SEARCH/HOP SUMMARY ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log('Report:', OUT);
  if (summary.counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
