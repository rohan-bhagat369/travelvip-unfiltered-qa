/**
 * Bad airport / null segment validation on canary (staging partner creds).
 * Cases from release note:
 *  - Destination ZZZ → 400 "Unknown airport code"
 *  - Destination BKV → 400 "Airport country is not configured"
 *  - v2 Segment:[null] → 400 "Segment cannot be null"
 *  - PNQ → DEL → flights returned
 *
 * Paths under test: /api/flights/search/{pid}, /api/flights/v2/search
 * Fallback (if Mag 404): /v1/flights/search
 *
 * Run:
 *   set BASE_URL=https://canary-api.travelvip.ai
 *   node travel-apis/flight/scripts/probe-flight-search-bad-airport-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const BASE = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
const PID = process.env.PARTNER_ID || 'vgm';
const OUT = path.join(
  'travel-apis',
  'flight',
  'reports',
  process.env.OUT || 'flight-search-bad-airport-canary.json',
);

function baseBody({ origin = 'PNQ', destination = 'DEL', date } = {}) {
  return {
    itinerary: [{ origin, destination, date: date || futureDate(21) }],
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
}

function optionCount(data) {
  return (data?.results || []).reduce((n, r) => n + (r.options || []).length, 0)
    || (data?.options || []).length
    || 0;
}

function errMsg(res) {
  return res?.data?.error?.message || res?.data?.message || '';
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

function includesAny(hay, needles) {
  const t = String(hay || '').toLowerCase();
  return needles.some((n) => t.includes(String(n).toLowerCase()));
}

async function main() {
  process.env.BASE_URL = BASE;
  console.log('BASE_URL', BASE, 'pid', PID);

  const session = await authenticate(true);
  const client = session.client;
  client.baseUrl = BASE;
  const date = futureDate(21);
  const rows = [];

  const post = (p, body, query = {}) => client.request({
    method: 'POST',
    path: p,
    query: {
      lang: 'en',
      currency: 'INR',
      page: 0,
      perpage: 20,
      sortby: 'fare,asc',
      pid: PID,
      ...query,
    },
    body,
    correlation: true,
  });

  const add = (row) => {
    rows.push(row);
    console.log(
      `[${row.verdict}] ${row.id} HTTP ${row.status} code=${row.code || '-'} msg=${(row.msg || '').slice(0, 120)}`,
    );
  };

  // --- Path discovery ---
  const magV1 = `/api/flights/search/${PID}`;
  const magV2 = '/api/flights/v2/search';
  const v1 = '/v1/flights/search';
  const pathProbeBody = baseBody({ date });

  for (const p of [magV1, magV2, v1]) {
    const res = await post(p, pathProbeBody);
    const is404 = res.status === 404;
    add({
      id: `PATH-${p}`,
      path: p,
      expect: 'route reachable (not Page not found)',
      verdict: is404 ? 'NOT TESTED' : (res.status < 500 ? 'PASS' : 'BUG'),
      status: res.status,
      code: errCode(res),
      msg: errMsg(res) || res?.data?.info || '',
      snippet: JSON.stringify(res.data).slice(0, 400),
    });
  }

  const magV1Live = rows.find((r) => r.path === magV1 && r.verdict === 'PASS');
  const magV2Live = rows.find((r) => r.path === magV2 && r.verdict === 'PASS');
  const activeV1 = magV1Live ? magV1 : v1;
  const activeV2 = magV2Live ? magV2 : v1;

  function scoreReject(id, pathUsed, expectLabel, needles, res, extra = {}) {
    const status = res.status;
    const msg = errMsg(res);
    const code = errCode(res);
    const text = `${msg} ${JSON.stringify(res.data || {})}`;
    const generic = /flight search failed/i.test(text);
    const msgOk = includesAny(text, needles);
    let verdict = 'BUG';
    if (status === 400 && msgOk && !generic) verdict = 'PASS';
    else if (status === 400 && generic) verdict = 'BUG';
    else if (status >= 500) verdict = 'BUG';
    else if (status >= 200 && status < 300) verdict = 'BUG';
    add({
      id,
      path: pathUsed,
      expect: expectLabel,
      verdict,
      status,
      code,
      msg,
      genericFail: generic,
      snippet: JSON.stringify(res.data || {}).slice(0, 700),
      ...extra,
    });
  }

  // --- ZZZ on both logical endpoints ---
  for (const [label, p] of [['v1-or-mag', activeV1], ['v2-or-fallback', activeV2]]) {
    const body = baseBody({ destination: 'ZZZ', date });
    const res = await post(p, body);
    scoreReject(
      `ZZZ-${label}`,
      p,
      'HTTP 400 + "Unknown airport code"',
      ['Unknown airport code'],
      res,
      { dest: 'ZZZ', body },
    );
  }

  // --- BKV ---
  for (const [label, p] of [['v1-or-mag', activeV1], ['v2-or-fallback', activeV2]]) {
    const body = baseBody({ destination: 'BKV', date });
    const res = await post(p, body);
    scoreReject(
      `BKV-${label}`,
      p,
      'HTTP 400 + "Airport country is not configured"',
      ['Airport country is not configured', 'country is not configured'],
      res,
      { dest: 'BKV', body },
    );
  }

  // --- null segment (requested on v2; also try on active path) ---
  const nullVariants = [
    {
      id: 'NULL-itinerary',
      mutate: (b) => {
        b.itinerary = [null];
        return b;
      },
    },
    {
      id: 'NULL-segments',
      mutate: (b) => {
        delete b.itinerary;
        b.segments = [null];
        return b;
      },
    },
    {
      id: 'NULL-Segment',
      mutate: (b) => {
        delete b.itinerary;
        b.Segment = [null];
        return b;
      },
    },
  ];

  for (const v of nullVariants) {
    const body = v.mutate(baseBody({ date }));
    const res = await post(activeV2, body);
    scoreReject(
      `${v.id}-${magV2Live ? 'v2' : 'v1-fallback'}`,
      activeV2,
      'HTTP 400 + "Segment cannot be null"',
      ['Segment cannot be null', 'cannot be null', 'must not be null'],
      res,
      { variant: v.id, body },
    );
  }

  // --- Happy PNQ → DEL ---
  for (const [label, p] of [['v1-or-mag', activeV1], ['v2-or-fallback', activeV2]]) {
    const body = baseBody({ origin: 'PNQ', destination: 'DEL', date });
    let res = await post(p, body);
    for (let i = 0; i < 12; i += 1) {
      const opts = optionCount(res.data);
      const done = opts > 0
        || res?.data?.progress?.state === 'COMPLETE'
        || !res.ok
        || res.status >= 400;
      if (done) break;
      const wait = Math.max(2000, Number(res?.data?.progress?.pollAfterMs) || 3000);
      await new Promise((r) => setTimeout(r, wait));
      res = await post(p, body);
    }
    const opts = optionCount(res.data);
    const total = res?.data?.totalResults ?? null;
    let verdict = 'BUG';
    if (res.ok && (opts > 0 || total > 0)) verdict = 'PASS';
    else if (res.ok) verdict = 'NOT TESTED';
    add({
      id: `PNQ-DEL-${label}`,
      path: p,
      expect: 'HTTP 200 with flight options',
      verdict,
      status: res.status,
      code: errCode(res),
      msg: errMsg(res),
      optionCount: opts,
      totalResults: total,
      progress: res?.data?.progress || null,
      snippet: JSON.stringify({
        progress: res?.data?.progress,
        totalResults: total,
        optionCount: opts,
        journeyType: res?.data?.journeyType,
      }).slice(0, 500),
      body,
    });
  }

  const summary = {
    PASS: rows.filter((r) => r.verdict === 'PASS').length,
    BUG: rows.filter((r) => r.verdict === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.verdict === 'NOT TESTED').length,
  };

  const report = {
    at: new Date().toISOString(),
    baseUrl: BASE,
    partner: PID,
    date,
    note: 'Mag paths /api/flights/search/{pid} and /api/flights/v2/search are checked first; cases fall back to /v1/flights/search when Mag returns 404.',
    summary,
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('SUMMARY', summary);
  console.log('Wrote', OUT);
  if (summary.BUG > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
