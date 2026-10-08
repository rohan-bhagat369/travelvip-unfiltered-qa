/**
 * Flight-only monkey testing (Canary), NO BOOKING expected.
 *
 * Covers:
 *  - /v1/flights/search negative fuzz (expects 4xx validation-like errors)
 *  - /v1/flights/details + /v1/flights/pricing negative fuzz (expects 4xx never 500)
 *  - /v1/flights/fareRules negative fuzz (expects 4xx never 500)
 *  - /v1/flights/ssr negative fuzz (expects 4xx never 500)
 *  - /v1/flights/seatmap negative fuzz (expects 4xx never 500)
 *  - /api/v2/flights/booking/issue-ticket negative-only fuzz (expects 4xx never 500)
 *
 * Output: reports/monkey-flight-canary-flightonly.json
 *
 * Run:
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/monkey-flight-canary-flightonly.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

const OUT = path.join('reports', process.env.FLIGHT_MONKEY_OUT || 'monkey-flight-canary-flightonly.json');

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}
function errDetails(res) {
  const d = res?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function brief(s, n = 220) {
  try { return JSON.stringify(s).slice(0, n); } catch { return String(s).slice(0, n); }
}

function scoreValidation(res, { expectErrorCode = 'VALIDATION_ERROR' } = {}) {
  const status = res?.status ?? 0;
  const code = errCode(res);
  if (status >= 500) {
    return { status: 'BUG', actual: `HTTP ${status} >=500 (never 500), code=${code}` };
  }
  if ((res?.ok || status === 200) || status === 0) {
    return { status: 'BUG', actual: `Accepted unexpected payload: HTTP ${status}, code=${code}` };
  }
  if (status >= 400 && status < 500) {
    if (code === expectErrorCode) {
      return { status: 'PASS', actual: `HTTP ${status} ${code}` };
    }
    // Still acceptable as "validation-like" if 4xx with any error.code
    if (code) {
      return { status: 'PASS', actual: `HTTP ${status} code=${code} (not 500)` };
    }
    return { status: 'NOT_TESTED', actual: `HTTP ${status} missing error.code` };
  }
  return { status: 'NOT_TESTED', actual: `HTTP ${status} code=${code}` };
}

async function pollSearch(flight, body, { maxPolls = 6 } = {}) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    last = await flight.search(body);
    const hasOptions = Boolean(last?.data?.results?.length);
    if (last.ok && isSearchProgressComplete(last.data)) return last;
    if (!last.ok && errCode(last) === 'VALIDATION_ERROR') return last;
    if (hasOptions) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const rows = [];
  const add = ({ id, api, how, verdict, actual, http, code, details }) => {
    rows.push({ id, api, how, verdict, actual, http, code, details });
    console.log(`[${verdict}] ${id} ${api} http=${http} code=${code}`);
  };

  // 1) Baseline search (positive enough to proceed)
  const dayCandidates = [18, 20, 22, 24, 26, 28];
  const day = dayCandidates[Math.floor(Math.random() * dayCandidates.length)];

  const base = buildOneWaySearchBody(day, { origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL' });
  base.preferences.airlines = ['SG'];

  const baseSearch = await pollSearch(flight, base);
  const baseSearchOk = Boolean(baseSearch?.ok) && isSearchProgressComplete(baseSearch.data);
  const options = collectOptions(baseSearch?.data, 'ONWARD');
  const sgOpts = options.filter((o) => String(o?.segments?.[0]?.airline?.code || '').toUpperCase() === 'SG');
  const pickedOpt = (sgOpts[0] || options[0]) || null;
  // Pricing can fail for some searchIds (FLIGHT_NOT_AVAILABLE), so we keep multiple candidates.
  const candidateSearchIds = Array.from(new Set([
    ...sgOpts.map((o) => o?.searchId).filter(Boolean),
    ...options.map((o) => o?.searchId).filter(Boolean),
    baseSearch?.data?.searchId,
    pickedOpt?.searchId,
  ].filter(Boolean)));

  const searchId = pickedOpt?.searchId || candidateSearchIds[0] || null;

  add({
    id: 'BASE',
    api: 'POST /v1/flights/search',
    how: `DEL→BOM days=${day} airlines=[SG] baseline`,
    verdict: baseSearchOk && searchId ? 'PASS' : 'NOT_TESTED',
    actual: `http=${baseSearch?.status} ok=${baseSearch?.ok} searchId=${searchId || 'null'}`,
    http: baseSearch?.status,
    code: errCode(baseSearch),
    details: errDetails(baseSearch),
  });

  if (!searchId) {
    const out = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl, rows };
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(`Report: ${OUT}`);
    return;
  }

  // 2) Hop payloads (details/pricing/fareRules/ssr/seatmap)
  // Use the first candidate searchId that yields pricing with bookingContext+priceId.
  let pricing = null;
  let chosenPricingSearchId = null;
  for (const sid of candidateSearchIds.slice(0, 6)) {
    // eslint-disable-next-line no-await-in-loop
    const p = await flight.getPricing([sid], 'ONE_WAY');
    const hasPrice = Boolean(p?.ok && p?.data?.priceId && p?.data?.bookingContext);
    if (hasPrice) {
      pricing = p;
      chosenPricingSearchId = sid;
      break;
    }
  }

  const effectiveSearchId = chosenPricingSearchId || searchId;
  const priceId = pricing?.data?.priceId;
  const bookingContext = pricing?.data?.bookingContext;

  add({
    id: 'PRICING_BASE',
    api: 'POST /v1/flights/pricing',
    how: `selectedSearchIds=[${effectiveSearchId}] (first priced candidate)`,
    verdict: pricing?.ok && priceId && bookingContext ? 'PASS' : 'NOT_TESTED',
    actual: `http=${pricing?.status} priceId=${priceId ? 'yes' : 'no'} bookingContext=${bookingContext ? 'yes' : 'no'}`,
    http: pricing?.status,
    code: errCode(pricing),
    details: errDetails(pricing),
  });

  // details negative: empty selection
  const detailsEmpty = await flight.getDetails([searchId], 'ONE_WAY');
  void detailsEmpty;

  const detailCall = (body) => session.client.request({
    method: 'POST',
    path: '/v1/flights/details',
    query: FLIGHT_QUERY,
    body,
    correlation: true,
  });
  const pricingCall = (body) => session.client.request({
    method: 'POST',
    path: '/v1/flights/pricing',
    query: FLIGHT_QUERY,
    body,
    correlation: true,
  });
  const fareRulesCall = (body) => session.client.request({
    method: 'POST',
    path: '/v1/flights/fareRules',
    query: FLIGHT_QUERY,
    body,
    correlation: true,
  });
  const ssrCall = (body) => session.client.request({
    method: 'POST',
    path: '/v1/flights/ssr',
    query: { currency: 'INR', lang: 'en' },
    body,
    correlation: true,
  });
  const seatmapCall = (body) => session.client.request({
    method: 'POST',
    path: '/v1/flights/seatmap',
    query: FLIGHT_QUERY,
    body,
    correlation: true,
  });

  const detailsNeg = [
    { id: 'D-EMPTY', body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [] } } },
    { id: 'D-COMMA', body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [`${effectiveSearchId},`] } } },
    { id: 'D-JT-OMIT', body: { selection: { selectedSearchIds: [effectiveSearchId] } } },
  ];
  for (const t of detailsNeg) {
    const res = await detailCall(t.body);
    const scored = scoreValidation(res);
    add({ id: t.id, api: 'POST /v1/flights/details', how: `mutate: ${t.id}`, verdict: scored.status, actual: scored.actual, http: res?.status, code: errCode(res), details: errDetails(res) });
  }

  const pricingNeg = [
    { id: 'P-EMPTY', body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [] } } },
    { id: 'P-HTML', body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [`${effectiveSearchId}<script>`] } } },
  ];
  for (const t of pricingNeg) {
    const res = await pricingCall(t.body);
    const scored = scoreValidation(res);
    add({ id: t.id, api: 'POST /v1/flights/pricing', how: `mutate: ${t.id}`, verdict: scored.status, actual: scored.actual, http: res?.status, code: errCode(res), details: errDetails(res) });
  }

  const fareNeg = [
    { id: 'FR-EMPTY', body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [] } } },
    { id: 'FR-COMMA', body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [`${effectiveSearchId},`] } } },
  ];
  for (const t of fareNeg) {
    const res = await fareRulesCall(t.body);
    const scored = scoreValidation(res);
    add({ id: t.id, api: 'POST /v1/flights/fareRules', how: `mutate: ${t.id}`, verdict: scored.status, actual: scored.actual, http: res?.status, code: errCode(res), details: errDetails(res) });
  }

  if (priceId) {
    const ssrNeg = [
      { id: 'SSR-OMIT', body: {} },
      { id: 'SSR-COMMA', body: { priceId: `${priceId},` } },
      { id: 'SSR-HTML', body: { priceId: 'abc<script>' } },
    ];
    for (const t of ssrNeg) {
      const res = await ssrCall(t.body);
      const scored = scoreValidation(res);
      add({ id: t.id, api: 'POST /v1/flights/ssr', how: `mutate: ${t.id}`, verdict: scored.status, actual: scored.actual, http: res?.status, code: errCode(res), details: errDetails(res) });
    }
  } else {
    add({
      id: 'SSR-SKIP',
      api: 'POST /v1/flights/ssr',
      how: 'skip: missing priceId from pricing base',
      verdict: 'NOT_TESTED',
      actual: 'missing priceId',
      http: null,
      code: null,
      details: [],
    });
  }

  // seatmap: omit requestReference + comma variant (only works if bookingContext exists)
  if (bookingContext) {
    const seatNeg = [
      { id: 'SM-OMIT', body: { currency: 'INR', passengers: [{ type: 'adult', title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat' }] } },
      { id: 'SM-COMMA', body: { currency: 'INR', requestReference: `${bookingContext},`, passengers: [{ type: 'adult', title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat' }] } },
    ];
    for (const t of seatNeg) {
      const res = await seatmapCall(t.body);
      const scored = scoreValidation(res);
      add({ id: t.id, api: 'POST /v1/flights/seatmap', how: `mutate: ${t.id}`, verdict: scored.status, actual: scored.actual, http: res?.status, code: errCode(res), details: errDetails(res) });
    }
  } else {
    add({
      id: 'SEAT-SKIP',
      api: 'POST /v1/flights/seatmap',
      how: 'skip: missing bookingContext from pricing base',
      verdict: 'NOT_TESTED',
      actual: 'missing bookingContext',
      http: null,
      code: null,
      details: [],
    });
  }

  // 3) Monkey-ish search negative fuzz (small, random-ish set)
  const searchApi = 'POST /v1/flights/search';
  const searchMutations = [
    { id: 'S-FUZZ-1', mut: (b) => { b.itinerary[0].destination = 'BOM<script>'; } },
    { id: 'S-FUZZ-2', mut: (b) => { b.cabinClass = 'ECONOMY,'; } },
    { id: 'S-FUZZ-3', mut: (b) => { b.fareType = 'GARBAGE'; } },
    { id: 'S-FUZZ-4', mut: (b) => { b.travellers.adults = '1'; } },
  ];
  for (const t of searchMutations) {
    const clone = JSON.parse(JSON.stringify(base));
    t.mut(clone);
    const res = await pollSearch(flight, clone, { maxPolls: 4 });
    const scored = scoreValidation(res);
    add({ id: t.id, api: searchApi, how: `mutate: ${t.id}`, verdict: scored.status, actual: scored.actual, http: res?.status, code: errCode(res), details: errDetails(res) });
  }

  // 4) issue-ticket negative-only (no successful booking expected)
  if (bookingContext && priceId) {
    // Use a valid-shaped payload from helper, then mutate priceId and SSR data/fields.
    const baseIssue = buildIssueTicketPayload({
      bookingContext,
      priceId,
      searchIds: [effectiveSearchId],
      journeyType: 'ONE_WAY',
      passengerProfile: { firstName: 'Rohan', lastName: `Bhagat${Date.now() % 1000}`, dob: config.flight.passengerDob, gender: 'Male', title: 'Mr' },
    });

    const issueNeg = [
      {
        id: 'ISSUE-NO-PRICEID',
        mutate: (p) => { p.data.priceId = `${priceId},`; },
        expectHint: 'priceId with trailing comma',
      },
      {
        id: 'ISSUE-HTML-PRICEID',
        mutate: (p) => { p.data.priceId = 'abc<script>'; },
        expectHint: 'priceId with HTML',
      },
      {
        id: 'ISSUE-OMIT-SSR',
        mutate: (p) => {
          // Remove SSR keys entirely (payload shape wrong) but keep other required fields
          delete p.data.passengers?.[0]?.ssr;
        },
        expectHint: 'omit passenger ssr field',
      },
    ];

    for (const t of issueNeg) {
      const payload = JSON.parse(JSON.stringify(baseIssue));
      t.mutate(payload);
      const res = await session.client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...config.flight.issueTicketQuery, pid: process.env.FLIGHT_ISSUE_PID || 'vgm', ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: session.client.partnerKey,
      });

      const scored = scoreValidation(res);
      add({
        id: t.id,
        api: 'POST /api/v2/flights/booking/issue-ticket',
        how: `negative-only: ${t.expectHint}`,
        verdict: scored.status,
        actual: scored.actual,
        http: res?.status,
        code: errCode(res),
        details: errDetails(res),
      });
    }
  } else {
    add({
      id: 'ISSUE-SKIP',
      api: 'POST /api/v2/flights/booking/issue-ticket',
      how: 'skip: missing bookingContext/priceId',
      verdict: 'NOT_TESTED',
      actual: 'missing bookingContext or priceId',
      http: null,
      code: null,
      details: [],
    });
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    counts: {
      PASS: rows.filter((r) => r.verdict === 'PASS').length,
      BUG: rows.filter((r) => r.verdict === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.verdict === 'NOT_TESTED').length,
      total: rows.length,
    },
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Report: ${OUT}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

