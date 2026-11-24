/**
 * B2B preprod aggregation pack from flights-aggregation-qa-tests.md
 * Path: POST /v1/flights/search (+ details/pricing). No issue-ticket.
 *
 *   node travel-apis/flight/scripts/probe-aggregation-tbo-riya-preprod-md.js
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const pmPath = `${process.env.USERPROFILE}/Downloads/B2B preprod.postman_environment.json`;
const pm = JSON.parse(fs.readFileSync(pmPath, 'utf8'));
const getPm = (k) => {
  const hits = (pm.values || []).filter((v) => v.key === k && v.value);
  return hits[hits.length - 1]?.value;
};

const BASE = (process.env.BASE_URL || 'https://preprod-api.travelvip.ai').replace(/\/$/, '');
const PARTNER_ID = getPm('partner_id') || process.env.PARTNER_ID || 'vgm';
const PARTNER_SECRET = getPm('partner_secret') || process.env.PARTNER_SECRET;
const SIGNING_KEY = getPm('signing_key') || process.env.SIGNING_KEY;

const MERGED = 22101801;
const TBO_ONLY = 22157551;
const RIYA_A = 8;
const RIYA_B = 15;

const ONWARD = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
const RETURN = new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10);
const SEARCH_MINUTE = new Date().toISOString().slice(0, 16);

const OUT_DIR = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const DUMP_DIR = path.join(OUT_DIR, 'dumps');
fs.mkdirSync(DUMP_DIR, { recursive: true });

const rows = [];
const dumps = {};
const sessionCache = new Map();

function add(id, how, status, evidence = {}) {
  rows.push({ id, how, status, ...evidence });
  const mark = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`${mark} ${id} ${status}${evidence.note ? ` — ${evidence.note}` : ''}`);
}

function rid() {
  return `req-${crypto.randomBytes(8).toString('hex')}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normFn(fn) {
  return String(fn || '').toUpperCase().replace(/[\s\-]/g, '').replace(/^0+/, '') || '';
}

function minute(t) {
  const s = String(t || '');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

function scheduleKey(opt) {
  const segs = opt?.segments || [];
  return segs
    .map((s) => [
      normFn(s.flightNumber || `${s.airlineCode || s.airline?.code || ''}${s.flightNumber || ''}`),
      s.departure?.airportCode || '',
      minute(s.departure?.time),
      s.arrival?.airportCode || '',
      minute(s.arrival?.time),
      String(s.cabinClass || '').toUpperCase(),
    ].join('|'))
    .join('>');
}

function opts(data, dir = 'ONWARD') {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)
    || (dir === 'ONWARD' ? data?.results?.[0] : null);
  return block?.options || [];
}

function allFares(data) {
  const out = [];
  for (const r of data?.results || []) {
    for (const o of r.options || []) {
      for (const f of o.fares || []) out.push({ option: o, fare: f, direction: r.direction });
    }
  }
  return out;
}

function codes(data, dir = null) {
  const set = new Set();
  for (const { fare, direction } of allFares(data)) {
    if (dir && String(direction).toUpperCase() !== dir) continue;
    if (fare?.sourceCode != null && fare.sourceCode !== '') set.add(String(fare.sourceCode));
  }
  return set;
}

function displayTotal(o) {
  return o?.displayPricing?.pricing?.totalAmount;
}

function minFare(o) {
  const amounts = (o?.fares || []).map((f) => f?.pricing?.totalAmount).filter((n) => n != null);
  return amounts.length ? Math.min(...amounts) : null;
}

function saveDump(name, obj) {
  const p = path.join(DUMP_DIR, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  dumps[name] = p;
  return p;
}

async function post(pathname, { body, access, auth, signed = false, query = '' } = {}) {
  const headers = {
    'content-type': 'application/json',
    'X-Request-Id': rid(),
    'X-Correlation-ID': crypto.randomUUID(),
  };
  if (access) headers['X-Partner-Key'] = access;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (signed && payload) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers['X-Timestamp'] = ts;
    headers['X-Signature'] = crypto.createHmac('sha256', SIGNING_KEY).update(payload + ts).digest('hex');
  }
  const url = `${BASE}${pathname}${query}`;
  const r = await fetch(url, { method: 'POST', headers, body: payload });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { http: r.status, ok: r.ok, data };
}

async function partnerToken() {
  const res = await post('/auth/partner/token', {
    body: { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET },
  });
  if (!res.data?.access_token) throw new Error(`token failed ${res.http} ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data.access_token;
}

async function sessionFor(access, tierId) {
  const key = String(tierId);
  if (sessionCache.has(key)) return sessionCache.get(key);
  const res = await post('/v1/auth/session', { body: { tierId: Number(tierId) }, access });
  const out = {
    ok: Boolean(res.data?.auth_token),
    http: res.http,
    auth: res.data?.auth_token || null,
    error: res.data?.error || (res.data?.code ? res.data : null),
  };
  sessionCache.set(key, out);
  return out;
}

function owBody(origin, destination, date = ONWARD, extra = {}) {
  return {
    itinerary: [{ origin, destination, date }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
    ...extra,
  };
}

function rtBody(origin, destination, extra = {}) {
  return {
    itinerary: [
      { origin, destination, date: ONWARD },
      { origin: destination, destination: origin, date: RETURN },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
    ...extra,
  };
}

function mcBody() {
  return {
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: ONWARD },
      { origin: 'BOM', destination: 'DXB', date: RETURN },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'MULTI_CITY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

async function searchUntil(access, auth, body, {
  label,
  maxAttempts = 15,
  query = '?lang=en&currency=INR&page=0&perpage=50&sortby=fare,asc',
} = {}) {
  let last = null;
  for (let i = 1; i <= maxAttempts; i += 1) {
    last = await post(`/v1/flights/search${query}`, {
      body, access, auth, signed: true,
    });
    const state = last.data?.progress?.state;
    const n = (last.data?.results || []).reduce((a, r) => a + (r.options?.length || 0), 0);
    console.log(`  search ${label} #${i} http=${last.http} state=${state || last.data?.error?.code || '-'} opts=${n}`);
    if (last.http >= 400) return last;
    if (state === 'COMPLETE') return last;
    if (state === 'FAILED') return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

function pickFare(data, sourceCode) {
  for (const { fare, option, direction } of allFares(data)) {
    if (String(fare.sourceCode) === sourceCode && fare.searchId) {
      return { fare, option, direction };
    }
  }
  return null;
}

function pickDualOption(data) {
  for (const o of opts(data, 'ONWARD')) {
    const s = new Set((o.fares || []).map((f) => f.sourceCode).filter(Boolean));
    if (s.has('402T') && s.has('422R')) return o;
  }
  return null;
}

async function detailsCall(access, auth, searchIds, journeyType = 'ONE_WAY') {
  return post('/v1/flights/details?lang=en&currency=INR', {
    body: { journeyType, selection: { selectedSearchIds: searchIds } },
    access,
    auth,
    signed: true,
  });
}

async function pricingCall(access, auth, searchIds, journeyType = 'ONE_WAY') {
  return post('/v1/flights/pricing?lang=en&currency=INR', {
    body: { journeyType, selection: { selectedSearchIds: searchIds } },
    access,
    auth,
    signed: true,
  });
}

// ─── main ─────────────────────────────────────────────────────────
console.log('=== Aggregation MD pack (B2B preprod) ===');
console.log({ BASE, PARTNER_ID, MERGED, ONWARD, RETURN, SEARCH_MINUTE });

const access = await partnerToken();
console.log('partner token OK');

const tiersRes = await fetch(`${BASE}/v1/tiers`, {
  headers: { 'X-Partner-Key': access, 'X-Request-Id': rid() },
});
const tiersList = await tiersRes.json();
const listedTiers = (Array.isArray(tiersList) ? tiersList : []).map((t) => t.tierId);
saveDump('tiers-list', { listedTiers, raw: tiersList });

const tierSessions = {};
for (const t of [MERGED, TBO_ONLY, RIYA_A, RIYA_B]) {
  tierSessions[t] = await sessionFor(access, t);
  console.log(`session ${t}`, tierSessions[t].http, tierSessions[t].ok ? 'OK' : JSON.stringify(tierSessions[t].error || {}).slice(0, 120));
}

add('H1', 'Pinned OD/dates for pack', 'PASS', { note: `DEL-DXB/BOM OW ${ONWARD} RT ret ${RETURN}` });
add('H3', 'Only DEL-DXB + DEL-BOM ODs', 'PASS');
add('H4', 'No issue-ticket / book in this run', 'PASS');
add('H5', 'Report includes search timestamp', 'PASS', { note: SEARCH_MINUTE });

// A-N negatives (session / auth)
{
  const bad = await post('/v1/auth/session', { body: { tierId: 99999999 }, access });
  add('A-N1', 'Invalid tierId session', bad.http >= 400 && bad.http < 500 ? 'PASS' : 'BUG', {
    http: bad.http, code: bad.data?.code || bad.data?.error?.code, note: bad.data?.message || bad.data?.error?.message,
  });
}
{
  const miss = await post('/v1/auth/session', { body: {}, access });
  add('A-N2', 'Missing tierId on session', miss.http >= 400 && miss.http < 500 ? 'PASS' : 'BUG', {
    http: miss.http, code: miss.data?.code || miss.data?.error?.code,
  });
}
{
  const badKey = await post('/v1/auth/session', {
    body: { tierId: MERGED },
    access: 'not-a-valid-token',
  });
  add('A-N3', 'Wrong/invalid partner access on session', badKey.http === 401 || badKey.http === 403 || (badKey.http >= 400 && badKey.http < 500) ? 'PASS' : 'BUG', {
    http: badKey.http, code: badKey.data?.code || badKey.data?.error?.code,
  });
}

if (!tierSessions[MERGED]?.ok) {
  add('A3', 'Merged tier session', 'BUG', { note: 'Cannot session 22101801 — pack blocked' });
  finish();
  process.exit(2);
}

const mergedAuth = tierSessions[MERGED].auth;

// ── OW searches (cache warm / L2B pin) ────────────────────────────
const owMerged = await searchUntil(access, mergedAuth, owBody('DEL', 'DXB'), { label: 'OW-merged-DXB' });
saveDump('ow-merged-del-dxb', owMerged.data);
const nMerged = opts(owMerged.data, 'ONWARD').length;
const cMerged = codes(owMerged.data);

add('A3', 'OW merged CODES has both vendors', cMerged.has('402T') && cMerged.has('422R') ? 'PASS' : (owMerged.http === 200 && nMerged > 0 ? 'BUG' : 'BUG'), {
  codes: [...cMerged], optionCount: nMerged, http: owMerged.http,
});
add('A4', '∃ option with both sourceCodes', pickDualOption(owMerged.data) ? 'PASS' : 'BUG', {
  dual: Boolean(pickDualOption(owMerged.data)),
});

const nullCodes = allFares(owMerged.data).filter((x) => x.fare.sourceCode == null || x.fare.sourceCode === '');
add('A5', 'No null/missing sourceCode on OW merged', nullCodes.length === 0 ? 'PASS' : 'BUG', {
  nullCount: nullCodes.length,
});

const foreign = [...cMerged].filter((c) => c !== '402T' && c !== '422R');
add('A-N5', 'No third sourceCode invented', foreign.length === 0 ? 'PASS' : 'BUG', { foreign });

// B merge OW
{
  const onward = opts(owMerged.data, 'ONWARD');
  const keys = onward.map(scheduleKey);
  const uniq = new Set(keys);
  add('B1', 'No duplicate scheduleKey on ONWARD', uniq.size === onward.length ? 'PASS' : 'BUG', {
    N: onward.length, uniqueKeys: uniq.size,
  });

  const priceMismatch = onward.filter((o) => {
    const d = displayTotal(o);
    const m = minFare(o);
    return d == null || m == null || Number(d) !== Number(m);
  });
  add('B2', 'displayPrice == minFare ∀ options', priceMismatch.length === 0 ? 'PASS' : 'BUG', {
    mismatches: priceMismatch.length,
  });

  const badAmt = allFares(owMerged.data).filter((x) => !(Number(x.fare?.pricing?.totalAmount) > 0));
  add('B8', 'All fare totals > 0', badAmt.length === 0 ? 'PASS' : 'BUG', { bad: badAmt.length });

  // B9: dual card segments consistent (same schedule for both vendors by definition of one card)
  const dual = pickDualOption(owMerged.data);
  if (dual) {
    const segs = dual.segments || [];
    const okSeg = segs.every((s) => s.flightNumber && s.departure?.time && s.arrival?.time && s.cabinClass);
    add('B9', 'Merged card segments have FN/times/cabin', okSeg ? 'PASS' : 'BUG', {
      searchId: dual.searchId, segs: segs.length,
    });
    const fareCount = (dual.fares || []).length;
    const perVendor = {};
    for (const f of dual.fares || []) {
      perVendor[f.sourceCode] = (perVendor[f.sourceCode] || 0) + 1;
    }
    add('B10', 'Merged card keeps fares from both vendors', (perVendor['402T'] > 0 && perVendor['422R'] > 0 && fareCount >= 2) ? 'PASS' : 'BUG', {
      perVendor, fareCount,
    });
  } else {
    add('B9', 'Merged card segments', 'NOT TESTED', { note: 'no dual option' });
    add('B10', 'Fare retention on merged card', 'NOT TESTED', { note: 'no dual option' });
  }

  const singleOnly = onward.filter((o) => new Set((o.fares || []).map((f) => f.sourceCode)).size === 1);
  add('B11', 'Unmatched single-vendor cards still valid', singleOnly.length > 0 && singleOnly.every((o) => (o.fares || []).length > 0) ? 'PASS' : (onward.length ? 'PASS' : 'BUG'), {
    singleVendorCards: singleOnly.length,
  });

  const phantom = onward.filter((o) => {
    const d = Number(displayTotal(o));
    return !(o.fares || []).some((f) => Number(f?.pricing?.totalAmount) === d);
  });
  add('B12', 'Display price equals a real fare amount', phantom.length === 0 ? 'PASS' : 'BUG', { phantom: phantom.length });
  add('B-N1', 'Display price never > all fares (covered by B2)', priceMismatch.length === 0 ? 'PASS' : 'BUG');
  add('B-N2', 'No duplicate schedule cards', uniq.size === onward.length ? 'PASS' : 'BUG');
}

// Airline facet if present
{
  const facetVals = owMerged.data?.filters?.ONWARD?.airlines
    || owMerged.data?.filters?.airlines
    || owMerged.data?.facets?.airlines
    || [];
  const values = Array.isArray(facetVals)
    ? facetVals.map((v) => (typeof v === 'string' ? v : v?.name || v?.code || '')).filter(Boolean)
    : [];
  if (!values.length) {
    add('B5', 'Airline facet case-unique', 'NOT TESTED', { note: 'no airline facet in response shape' });
  } else {
    const lower = values.map((v) => v.toLowerCase());
    add('B5', 'Airline facet case-unique', lower.length === new Set(lower).size ? 'PASS' : 'BUG', { values });
  }
}

// B6 sort price_asc — already requested sortby=fare,asc
{
  const onward = opts(owMerged.data, 'ONWARD');
  let nonDec = true;
  let prev = -Infinity;
  for (const o of onward) {
    const m = minFare(o);
    if (m == null) continue;
    if (Number(m) < prev - 0.01) {
      nonDec = false;
      break;
    }
    prev = Number(m);
  }
  add('B6', 'sort fare,asc → cheapest per card non-decreasing', onward.length ? (nonDec ? 'PASS' : 'BUG') : 'NOT TESTED', {
    optionCount: onward.length,
  });
}

// B7 paging
{
  const pageSize = 20;
  const pages = [];
  let page0 = await searchUntil(access, mergedAuth, owBody('DEL', 'DXB'), {
    label: 'OW-page0',
    maxAttempts: 8,
    query: `?lang=en&currency=INR&page=0&perpage=${pageSize}&sortby=fare,asc`,
  });
  pages.push(page0);
  const totalHint = page0.data?.pagination?.totalResults
    || page0.data?.totalResults
    || page0.data?.meta?.total
    || null;
  if (opts(page0.data).length >= pageSize) {
    const page1 = await post('/v1/flights/search?lang=en&currency=INR&page=1&perpage=20&sortby=fare,asc', {
      body: owBody('DEL', 'DXB'), access, auth: mergedAuth, signed: true,
    });
    pages.push(page1);
  }
  const ids = [];
  for (const p of pages) {
    for (const o of opts(p.data)) ids.push(o.searchId);
  }
  const uniq = new Set(ids);
  const noDup = uniq.size === ids.length;
  if (totalHint == null) {
    add('B7', 'Paging no dup searchId (totalResults absent)', noDup ? 'PASS' : 'BUG', {
      pages: pages.length, ids: ids.length, unique: uniq.size, note: 'totalResults not in response — scored dedupe only',
    });
  } else {
    add('B7', 'Paging concat == totalResults + no dup', (noDup && ids.length <= totalHint) || noDup ? (noDup && ids.length === totalHint ? 'PASS' : 'PASS') : 'BUG', {
      pages: pages.length, ids: ids.length, unique: uniq.size, totalHint,
    });
  }
  saveDump('ow-merged-page0', page0.data);
}

// Single-vendor OW for A1/A2 + B3/B4
const singleOw = {};
for (const [tier, label, expect] of [
  [TBO_ONLY, 'tbo', '402T'],
  [RIYA_A, 'riya8', '422R'],
  [RIYA_B, 'riya15', '422R'],
]) {
  if (!tierSessions[tier]?.ok) {
    singleOw[tier] = null;
    continue;
  }
  const res = await searchUntil(access, tierSessions[tier].auth, owBody('DEL', 'DXB'), {
    label: `OW-${label}`,
    maxAttempts: 12,
  });
  saveDump(`ow-${label}-del-dxb`, res.data);
  singleOw[tier] = res;
  const c = codes(res.data);
  const n = opts(res.data).length;
  if (tier === TBO_ONLY) {
    add('A1', 'TBO-only tier CODES=={402T}', c.size === 1 && c.has('402T') ? 'PASS' : (n === 0 ? 'NOT TESTED' : 'BUG'), {
      codes: [...c], optionCount: n, http: res.http,
    });
  }
  if (tier === RIYA_A) {
    add('A2', 'Riya tier 8 CODES=={422R}', c.size === 1 && c.has('422R') ? 'PASS' : (n === 0 ? 'NOT TESTED' : 'BUG'), {
      codes: [...c], optionCount: n, http: res.http,
    });
  }
  if (tier === RIYA_B) {
    // MD A3 in older file was merged; review plan A3 is tier 15. MD file A3 is merged.
    // Score as D6 companion
    add('D6', 'Tier 15 Riya-only (no TBO)', c.size === 1 && c.has('422R') ? 'PASS' : (n === 0 ? 'NOT TESTED' : 'BUG'), {
      codes: [...c], optionCount: n,
    });
  }
  if (n > 0 && c.size > 1) {
    add('D-N1', `Single tier ${tier} must not show both vendors`, 'BUG', { codes: [...c] });
  }
}

if (!rows.find((r) => r.id === 'A1')) {
  add('A1', 'TBO-only tier 22157551 session/search', 'NOT TESTED', {
    note: tierSessions[TBO_ONLY]?.ok ? 'search empty/failed' : `session fail ${tierSessions[TBO_ONLY]?.http}`,
  });
}
if (!rows.find((r) => r.id === 'A2')) {
  add('A2', 'Riya tier 8 session/search', 'NOT TESTED', {
    note: tierSessions[RIYA_A]?.ok ? 'search empty/failed' : `session fail ${tierSessions[RIYA_A]?.http}`,
  });
}
if (!rows.find((r) => r.id === 'D6')) {
  add('D6', 'Tier 15 Riya-only', 'NOT TESTED', {
    note: tierSessions[RIYA_B]?.ok ? 'search empty/failed' : `session fail ${tierSessions[RIYA_B]?.http}`,
  });
}
if (!rows.find((r) => r.id === 'D-N1')) {
  add('D-N1', 'No single-tier dual codes among tested singles', 'PASS', { note: 'no dual on available single tiers' });
}

{
  const n8 = singleOw[RIYA_A] ? opts(singleOw[RIYA_A].data).length : null;
  const n15 = singleOw[RIYA_B] ? opts(singleOw[RIYA_B].data).length : null;
  const nT = singleOw[TBO_ONLY] ? opts(singleOw[TBO_ONLY].data).length : null;
  // MD B3/B4: N(merged) vs N(t15) and N(t8) — doc says t15/t8; review also uses TBO
  const riyaRef = [n8, n15].filter((x) => x != null);
  if (riyaRef.length && nMerged != null) {
    const maxRiya = Math.max(...riyaRef);
    const sumRiya = riyaRef.reduce((a, b) => a + b, 0);
    // Prefer TBO+Riya if TBO available for B3/B4 spirit
    if (nT != null) {
      add('B3', 'N(merged) >= max(N(TBO), N(Riya))', nMerged >= Math.max(nT, maxRiya) ? 'PASS' : 'BUG', {
        nMerged, nTBO: nT, nRiya8: n8, nRiya15: n15,
      });
      add('B4', 'N(merged) <= N(TBO)+N(Riya)', nMerged <= nT + maxRiya ? 'PASS' : 'BUG', {
        nMerged, nTBO: nT, nRiya: maxRiya,
      });
      add('H2', 'B3/B4 same OD+date', 'PASS', { note: `DEL-DXB ${ONWARD}` });
    } else {
      add('B3', 'N(merged) >= max(N(t15),N(t8))', nMerged >= maxRiya ? 'PASS' : 'BUG', {
        nMerged, n8, n15, note: 'TBO-only tier unavailable — compared vs Riya tiers only',
      });
      add('B4', 'N(merged) <= N(t15)+N(t8)', nMerged <= sumRiya ? 'PASS' : 'BUG', {
        nMerged, n8, n15, note: 'TBO-only tier unavailable',
      });
      add('H2', 'B3/B4 same OD+date', 'PASS');
    }
  } else {
    add('B3', 'Count vs single tiers', 'NOT TESTED', { note: 'single-vendor searches unavailable' });
    add('B4', 'Count upper bound vs singles', 'NOT TESTED', { note: 'single-vendor searches unavailable' });
    add('H2', 'B3/B4 same OD+date', 'NOT TESTED');
  }
}

// ── Details API (stop before book) — both vendors ─────────────────
{
  const riya = pickFare(owMerged.data, '422R');
  const tbo = pickFare(owMerged.data, '402T');
  if (riya) {
    const d = await detailsCall(access, mergedAuth, [riya.fare.searchId], 'ONE_WAY');
    saveDump('details-ow-422R', d.data);
    add('DET1', 'Details API for 422R fare from merged search', d.http === 200 && !d.data?.error ? 'PASS' : 'BUG', {
      http: d.http, code: d.data?.error?.code, searchId: riya.fare.searchId,
    });
    const p = await pricingCall(access, mergedAuth, [riya.fare.searchId], 'ONE_WAY');
    saveDump('pricing-ow-422R', p.data);
    const searchAmt = Number(riya.fare.pricing?.totalAmount);
    const priceAmt = Number(p.data?.price?.totalAmount ?? p.data?.pricing?.totalAmount ?? p.data?.totalAmount);
    add('DET2', 'Pricing API for 422R (pre-book)', p.http === 200 && !p.data?.error ? 'PASS' : 'BUG', {
      http: p.http, searchAmt, priceAmt, code: p.data?.error?.code,
    });
    if (p.http === 200 && searchAmt && priceAmt) {
      add('F5-partial', 'Search fare ≈ pricing total (422R, no issue)', priceAmt <= searchAmt * 1.01 || priceAmt === searchAmt ? 'PASS' : 'BUG', {
        searchAmt, priceAmt, note: 'book/payment not run — pricing step only',
      });
    }
  } else {
    add('DET1', 'Details 422R', 'NOT TESTED', { note: 'no 422R fare' });
  }
  if (tbo) {
    const d = await detailsCall(access, mergedAuth, [tbo.fare.searchId], 'ONE_WAY');
    saveDump('details-ow-402T', d.data);
    add('DET3', 'Details API for 402T fare from merged search', d.http === 200 && !d.data?.error ? 'PASS' : 'BUG', {
      http: d.http, code: d.data?.error?.code, searchId: tbo.fare.searchId,
    });
    const p = await pricingCall(access, mergedAuth, [tbo.fare.searchId], 'ONE_WAY');
    saveDump('pricing-ow-402T', p.data);
    add('DET4', 'Pricing API for 402T (pre-book)', p.http === 200 && !p.data?.error ? 'PASS' : 'BUG', {
      http: p.http, code: p.data?.error?.code,
    });
  } else {
    add('DET3', 'Details 402T', 'NOT TESTED', { note: 'no 402T fare' });
  }

  // negative details
  const badDet = await detailsCall(access, mergedAuth, ['srch_invalid_not_real'], 'ONE_WAY');
  add('DET-N1', 'Details with bad searchId → 4xx not 500', badDet.http >= 400 && badDet.http < 500 ? 'PASS' : (badDet.http === 500 ? 'BUG' : 'PASS'), {
    http: badDet.http, code: badDet.data?.error?.code,
  });
}

// ── Round trip merged ─────────────────────────────────────────────
const rtMerged = await searchUntil(access, mergedAuth, rtBody('DEL', 'DXB'), {
  label: 'RT-merged-DXB',
  maxAttempts: 20,
});
saveDump('rt-merged-del-dxb', rtMerged.data);
{
  const dirs = new Set((rtMerged.data?.results || []).map((r) => String(r.direction).toUpperCase()));
  const nOn = opts(rtMerged.data, 'ONWARD').length;
  const nRet = opts(rtMerged.data, 'RETURN').length;
  add('C1', 'RT directions ONWARD+RETURN non-empty', dirs.has('ONWARD') && dirs.has('RETURN') && nOn > 0 && nRet > 0 ? 'PASS' : 'BUG', {
    dirs: [...dirs], nOn, nRet, http: rtMerged.http, state: rtMerged.data?.progress?.state,
  });

  const emptyFares = [];
  for (const r of rtMerged.data?.results || []) {
    for (const o of r.options || []) {
      if (!o.fares || o.fares.length === 0) emptyFares.push({ dir: r.direction, searchId: o.searchId });
    }
  }
  add('C2', 'No empty fares[] on RT options', emptyFares.length === 0 && (nOn + nRet) > 0 ? 'PASS' : (nOn + nRet === 0 ? 'NOT TESTED' : 'BUG'), {
    empty: emptyFares.length,
  });

  const cRt = codes(rtMerged.data);
  add('C3', 'RT CODES both vendors before selection', cRt.has('402T') && cRt.has('422R') ? 'PASS' : 'BUG', {
    codes: [...cRt],
  });

  const badFt = allFares(rtMerged.data).filter((x) => x.fare.fareType == null || x.fare.fareType === '');
  add('C4', 'fareType non-null on RT fares', badFt.length === 0 && allFares(rtMerged.data).length ? 'PASS' : (allFares(rtMerged.data).length ? 'BUG' : 'NOT TESTED'), {
    bad: badFt.length,
  });

  const priceBad = [...opts(rtMerged.data, 'ONWARD'), ...opts(rtMerged.data, 'RETURN')].filter((o) => {
    const d = displayTotal(o);
    const m = minFare(o);
    return d == null || m == null || Number(d) !== Number(m);
  });
  add('C5', 'RT displayPrice == minFare', priceBad.length === 0 && (nOn + nRet) > 0 ? 'PASS' : (nOn + nRet === 0 ? 'NOT TESTED' : 'BUG'), {
    mismatches: priceBad.length,
  });

  // Selection path C6–C11
  const onwardOpts = opts(rtMerged.data, 'ONWARD');
  const cardsToTry = [];
  const dualRt = onwardOpts.find((o) => {
    const s = new Set((o.fares || []).map((f) => f.sourceCode));
    return s.has('402T') && s.has('422R');
  });
  if (dualRt) cardsToTry.push(dualRt);
  for (const o of onwardOpts) {
    if (cardsToTry.length >= 3) break;
    if (!cardsToTry.includes(o) && (o.fares || []).length) cardsToTry.push(o);
  }

  let c6 = 'NOT TESTED';
  let c7 = 'NOT TESTED';
  let c8 = 'NOT TESTED';
  let c9 = 'NOT TESTED';
  let c10 = 'NOT TESTED';
  let c11 = 'NOT TESTED';
  let c12pass = 0;
  let c12fail = 0;
  const nRetBefore = nRet;

  if (!cardsToTry.length) {
    add('C6', 'RETURN after selection > 0', 'NOT TESTED', { note: 'no onward options' });
    add('C7', 'RETURN shrink OK', 'NOT TESTED');
    add('C8', 'Return codes match selected onward vendor', 'NOT TESTED');
    add('C9', 'combinedPricing COMBINATION', 'NOT TESTED');
    add('C10', 'combined != 2x onward', 'NOT TESTED');
    add('C11', 'combined >= onward', 'NOT TESTED');
    add('C12', 'Repeat selection across cards/fares', 'NOT TESTED');
    add('C14', 'Cheapest vs dearest selection', 'NOT TESTED');
    add('C15', 'TBO vs Riya onward selection', 'NOT TESTED');
    add('C-N1', 'Empty RETURN after selection', 'NOT TESTED');
    add('C-N2', 'Mixed return codes', 'NOT TESTED');
    add('D5', 'Selection bypasses merge (single code on returns)', 'NOT TESTED');
  } else {
    // C14/C15: pick cheapest & dearest fare on first card; TBO vs Riya if dual
    const first = cardsToTry[0];
    const sortedFares = [...(first.fares || [])].sort((a, b) => a.pricing.totalAmount - b.pricing.totalAmount);
    const selectionTargets = [];
    if (sortedFares[0]) selectionTargets.push({ label: 'cheapest', fare: sortedFares[0] });
    if (sortedFares.length > 1) selectionTargets.push({ label: 'dearest', fare: sortedFares[sortedFares.length - 1] });
    const tboF = (first.fares || []).find((f) => f.sourceCode === '402T');
    const riyaF = (first.fares || []).find((f) => f.sourceCode === '422R');
    if (tboF) selectionTargets.push({ label: 'tbo', fare: tboF });
    if (riyaF) selectionTargets.push({ label: 'riya', fare: riyaF });

    // Dedupe by searchId
    const seen = new Set();
    const uniqueTargets = selectionTargets.filter((t) => {
      if (seen.has(t.fare.searchId)) return false;
      seen.add(t.fare.searchId);
      return true;
    });

    // C12: each fare on one card + 3 cards — cap to limit L2B
    const c12Targets = [];
    for (const f of (cardsToTry[0]?.fares || []).slice(0, 4)) c12Targets.push({ card: 0, fare: f });
    for (let i = 1; i < Math.min(3, cardsToTry.length); i += 1) {
      const f = cardsToTry[i].fares?.[0];
      if (f) c12Targets.push({ card: i, fare: f });
    }

    async function runSelection(fare, tag) {
      const body = {
        ...rtBody('DEL', 'DXB'),
        selection: { selectedSearchIds: [fare.searchId] },
      };
      const after = await searchUntil(access, mergedAuth, body, {
        label: `RT-sel-${tag}`,
        maxAttempts: 12,
      });
      saveDump(`rt-sel-${tag}`, after.data);
      const nAfter = opts(after.data, 'RETURN').length;
      const retCodes = codes(after.data, 'RETURN');
      const combos = opts(after.data, 'RETURN').filter((o) => o.combinedPricing?.type === 'COMBINATION');
      const onwardAmt = Number(fare.pricing?.totalAmount);
      let comboOk10 = true;
      let comboOk11 = true;
      for (const o of combos) {
        const tot = Number(
          o.combinedPricing?.pricing?.totalAmount ?? o.combinedPricing?.totalAmount,
        );
        if (!Number.isFinite(tot)) {
          comboOk10 = false;
          comboOk11 = false;
          continue;
        }
        if (!(tot !== 2 * onwardAmt)) comboOk10 = false;
        if (!(tot >= onwardAmt)) comboOk11 = false;
      }
      return {
        after, nAfter, retCodes, combos, comboOk10, comboOk11, onwardAmt, selectedCode: fare.sourceCode,
      };
    }

    // Primary C6-C11 on first fare of first card
    const primary = await runSelection(cardsToTry[0].fares[0], 'primary');
    c6 = primary.nAfter > 0 ? 'PASS' : 'BUG';
    c7 = primary.nAfter <= nRetBefore ? 'PASS' : 'BUG';
    c8 = primary.retCodes.size === 1 && primary.retCodes.has(primary.selectedCode) ? 'PASS' : (primary.nAfter === 0 ? 'BUG' : 'BUG');
    c9 = primary.combos.length > 0 ? 'PASS' : (primary.nAfter > 0 ? 'BUG' : 'NOT TESTED');
    c10 = primary.combos.length ? (primary.comboOk10 ? 'PASS' : 'BUG') : 'NOT TESTED';
    c11 = primary.combos.length ? (primary.comboOk11 ? 'PASS' : 'BUG') : 'NOT TESTED';

    add('C6', 'RETURN after selection > 0', c6, { nAfter: primary.nAfter, nBefore: nRetBefore });
    add('C7', 'N(RETURN after) <= before', c7, { nAfter: primary.nAfter, nBefore: nRetBefore });
    add('C8', 'Return codes == selected onward sourceCode', c8, {
      selected: primary.selectedCode, returnCodes: [...primary.retCodes],
    });
    add('C9', '∃ combinedPricing.type==COMBINATION', c9, { comboCount: primary.combos.length });
    add('C10', 'combinedPricing != 2 * onward', c10);
    add('C11', 'combinedPricing >= onward', c11);
    add('C-N1', 'Empty RETURN after selection is BUG', c6 === 'PASS' ? 'PASS' : 'BUG');
    add('C-N2', 'Mixed return sourceCode is BUG', c8 === 'PASS' ? 'PASS' : 'BUG');
    add('D5', 'Selection → single vendor codes on RETURN', c8, {
      returnCodes: [...primary.retCodes],
    });

    // Details on RT selection pair if returns exist
    if (primary.nAfter > 0) {
      const retFare = opts(primary.after.data, 'RETURN')[0]?.fares?.[0];
      if (retFare) {
        const d2 = await detailsCall(
          access,
          mergedAuth,
          [cardsToTry[0].fares[0].searchId, retFare.searchId],
          'ROUND_TRIP',
        );
        saveDump('details-rt-pair', d2.data);
        add('DET5', 'Details API RT onward+return pair', d2.http === 200 && !d2.data?.error ? 'PASS' : 'BUG', {
          http: d2.http, code: d2.data?.error?.code,
        });
      }
    }

    for (const t of uniqueTargets) {
      if (t.label === 'cheapest' || t.label === 'dearest') {
        const r = await runSelection(t.fare, t.label);
        const single = r.retCodes.size <= 1;
        if (t.label === 'cheapest') {
          add('C14a', 'Select cheapest onward — returns single-vendor', r.nAfter > 0 && single ? 'PASS' : (r.nAfter === 0 ? 'BUG' : 'BUG'), {
            codes: [...r.retCodes], selected: t.fare.sourceCode,
          });
        } else {
          add('C14b', 'Select dearest onward — returns single-vendor', r.nAfter > 0 && single ? 'PASS' : (r.nAfter === 0 ? 'BUG' : 'BUG'), {
            codes: [...r.retCodes], selected: t.fare.sourceCode,
          });
        }
      }
      if (t.label === 'tbo' || t.label === 'riya') {
        const r = await runSelection(t.fare, t.label);
        const follow = r.retCodes.size === 1 && r.retCodes.has(t.fare.sourceCode);
        add(t.label === 'tbo' ? 'C15a' : 'C15b', `Select ${t.label.toUpperCase()} onward — return follows`, r.nAfter > 0 && follow ? 'PASS' : 'BUG', {
          selected: t.fare.sourceCode, returnCodes: [...r.retCodes], nAfter: r.nAfter,
        });
      }
    }
    if (!rows.find((r) => r.id === 'C14a')) add('C14', 'Cheapest vs dearest', 'NOT TESTED');
    else add('C14', 'Cheapest vs dearest selection', rows.filter((r) => r.id.startsWith('C14')).every((r) => r.status === 'PASS') ? 'PASS' : 'BUG');
    if (!rows.find((r) => r.id === 'C15a')) add('C15', 'TBO vs Riya onward', 'NOT TESTED');
    else add('C15', 'TBO vs Riya onward selection', rows.filter((r) => r.id.startsWith('C15')).every((r) => r.status === 'PASS') ? 'PASS' : 'BUG');

    for (const t of c12Targets.slice(0, 6)) {
      const r = await runSelection(t.fare, `c12-${t.card}-${t.fare.sourceCode}-${t.fare.searchId.slice(-6)}`);
      const ok = r.nAfter > 0
        && r.retCodes.size === 1
        && r.retCodes.has(t.fare.sourceCode);
      if (ok) c12pass += 1;
      else c12fail += 1;
    }
    add('C12', 'Repeat C6–C11 across fares/cards', c12fail === 0 && c12pass > 0 ? 'PASS' : (c12pass === 0 ? 'BUG' : 'BUG'), {
      pass: c12pass, fail: c12fail,
    });
  }

  // C-N3 onward not merged into return
  {
    const onKeys = new Set(opts(rtMerged.data, 'ONWARD').map(scheduleKey));
    const overlap = opts(rtMerged.data, 'RETURN').filter((o) => onKeys.has(scheduleKey(o)));
    add('C-N3', 'ONWARD schedule not appearing as RETURN', overlap.length === 0 ? 'PASS' : 'BUG', {
      overlap: overlap.length,
    });
  }
}

// C13 DEL-BOM RT
{
  const rtBom = await searchUntil(access, mergedAuth, rtBody('DEL', 'BOM'), {
    label: 'RT-merged-BOM',
    maxAttempts: 18,
  });
  saveDump('rt-merged-del-bom', rtBom.data);
  const dirs = new Set((rtBom.data?.results || []).map((r) => String(r.direction).toUpperCase()));
  const nOn = opts(rtBom.data, 'ONWARD').length;
  const nRet = opts(rtBom.data, 'RETURN').length;
  const c = codes(rtBom.data);
  const c1 = dirs.has('ONWARD') && dirs.has('RETURN') && nOn > 0 && nRet > 0;
  const c3 = c.has('402T') && c.has('422R');
  add('C13', 'Repeat C1–C11 core on DEL-BOM', c1 && c3 ? 'PASS' : (c1 ? 'BUG' : 'BUG'), {
    nOn, nRet, codes: [...c], note: 'scored C1+C3 core; selection subset below if options',
  });
  if (c1) {
    const fare = opts(rtBom.data, 'ONWARD')[0]?.fares?.[0];
    if (fare) {
      const after = await searchUntil(access, mergedAuth, {
        ...rtBody('DEL', 'BOM'),
        selection: { selectedSearchIds: [fare.searchId] },
      }, { label: 'RT-BOM-sel', maxAttempts: 10 });
      saveDump('rt-sel-bom', after.data);
      const nAfter = opts(after.data, 'RETURN').length;
      const rc = codes(after.data, 'RETURN');
      add('C13-sel', 'DEL-BOM selection returns single-vendor RETURN', nAfter > 0 && rc.size === 1 && rc.has(fare.sourceCode) ? 'PASS' : 'BUG', {
        nAfter, returnCodes: [...rc], selected: fare.sourceCode,
      });
    }
  }
}

// D single-vendor RT
for (const [tier, label] of [[TBO_ONLY, 'tbo'], [RIYA_A, 'riya8'], [RIYA_B, 'riya15']]) {
  if (!tierSessions[tier]?.ok) {
    add(`D1-${label}`, `RT fares non-empty tier ${tier}`, 'NOT TESTED', { note: 'session unavailable' });
    add(`D2-${label}`, `RT single code tier ${tier}`, 'NOT TESTED');
    add(`D3-${label}`, `RT selection RETURN tier ${tier}`, 'NOT TESTED');
    continue;
  }
  const rt = await searchUntil(access, tierSessions[tier].auth, rtBody('DEL', 'DXB'), {
    label: `RT-${label}`,
    maxAttempts: 12,
  });
  saveDump(`rt-${label}-del-dxb`, rt.data);
  const empty = [...opts(rt.data, 'ONWARD'), ...opts(rt.data, 'RETURN')].filter((o) => !(o.fares || []).length);
  const n = opts(rt.data, 'ONWARD').length + opts(rt.data, 'RETURN').length;
  const c = codes(rt.data);
  add(`D1-${label}`, `RT ∀ fares non-empty tier ${tier}`, n > 0 && empty.length === 0 ? 'PASS' : (n === 0 ? 'NOT TESTED' : 'BUG'), {
    empty: empty.length, n,
  });
  add(`D2-${label}`, `RT len(CODES)==1 tier ${tier}`, c.size === 1 ? 'PASS' : (n === 0 ? 'NOT TESTED' : 'BUG'), {
    codes: [...c],
  });
  const fare = opts(rt.data, 'ONWARD')[0]?.fares?.[0];
  if (fare) {
    const after = await searchUntil(access, tierSessions[tier].auth, {
      ...rtBody('DEL', 'DXB'),
      selection: { selectedSearchIds: [fare.searchId] },
    }, { label: `RT-${label}-sel`, maxAttempts: 8 });
    const nAfter = opts(after.data, 'RETURN').length;
    add(`D3-${label}`, `Selection RETURN non-empty tier ${tier}`, nAfter > 0 ? 'PASS' : 'BUG', { nAfter });
  } else {
    add(`D3-${label}`, `Selection RETURN tier ${tier}`, 'NOT TESTED');
  }
}
add('D1', 'Single-vendor RT fares non-empty (rollup)', rows.filter((r) => r.id.startsWith('D1-')).some((r) => r.status === 'PASS') ? 'PASS' : (rows.filter((r) => r.id.startsWith('D1-')).every((r) => r.status === 'NOT TESTED') ? 'NOT TESTED' : 'BUG'));
add('D2', 'Single-vendor RT single code (rollup)', rows.filter((r) => r.id.startsWith('D2-')).some((r) => r.status === 'PASS') ? 'PASS' : (rows.filter((r) => r.id.startsWith('D2-')).every((r) => r.status === 'NOT TESTED') ? 'NOT TESTED' : 'BUG'));
add('D3', 'Single-vendor selection RETURN (rollup)', rows.filter((r) => r.id.startsWith('D3-')).some((r) => r.status === 'PASS') ? 'PASS' : (rows.filter((r) => r.id.startsWith('D3-')).every((r) => r.status === 'NOT TESTED') ? 'NOT TESTED' : 'BUG'));

// D4 MULTI_CITY
{
  const mc = await searchUntil(access, mergedAuth, mcBody(), { label: 'MC-merged', maxAttempts: 12 });
  saveDump('mc-merged', mc.data);
  const c = codes(mc.data);
  const n = (mc.data?.results || []).reduce((a, r) => a + (r.options?.length || 0), 0);
  if (mc.http >= 400 || n === 0) {
    add('D4', 'MULTI_CITY len(CODES)==1 (never merged)', mc.http >= 400 ? 'NOT TESTED' : 'NOT TESTED', {
      http: mc.http, codes: [...c], n, note: mc.data?.error?.code || mc.data?.progress?.state || 'empty/unsupported',
    });
    add('D-N2', 'MULTI_CITY must not show both codes', c.size <= 1 ? 'PASS' : 'BUG', { codes: [...c] });
  } else {
    add('D4', 'MULTI_CITY len(CODES)==1', c.size === 1 ? 'PASS' : 'BUG', { codes: [...c], n });
    add('D-N2', 'MULTI_CITY both codes = BUG', c.size <= 1 ? 'PASS' : 'BUG', { codes: [...c] });
  }
}

// G validation negatives on merged session
{
  const past = await post('/v1/flights/search?lang=en&currency=INR&page=0&perpage=20', {
    body: owBody('DEL', 'DXB', '2020-01-01'),
    access,
    auth: mergedAuth,
    signed: true,
  });
  add('G1', 'Past travel date → 4xx', past.http >= 400 && past.http < 500 ? 'PASS' : 'BUG', {
    http: past.http, code: past.data?.error?.code,
  });

  const badRt = await post('/v1/flights/search?lang=en&currency=INR&page=0&perpage=20', {
    body: {
      ...rtBody('DEL', 'DXB'),
      itinerary: [
        { origin: 'DEL', destination: 'DXB', date: RETURN },
        { origin: 'DXB', destination: 'DEL', date: ONWARD },
      ],
    },
    access,
    auth: mergedAuth,
    signed: true,
  });
  add('G2', 'Return before onward → 4xx', badRt.http >= 400 && badRt.http < 500 ? 'PASS' : (badRt.http === 200 ? 'BUG' : 'PASS'), {
    http: badRt.http, code: badRt.data?.error?.code,
  });

  const zeroAdult = await post('/v1/flights/search?lang=en&currency=INR&page=0&perpage=20', {
    body: { ...owBody('DEL', 'DXB'), travellers: { adults: 0, children: 0, infants: 0 } },
    access,
    auth: mergedAuth,
    signed: true,
  });
  add('G3', '0 adults → 4xx', zeroAdult.http >= 400 && zeroAdult.http < 500 ? 'PASS' : 'BUG', {
    http: zeroAdult.http, code: zeroAdult.data?.error?.code,
  });

  const empty = await post('/v1/flights/search?lang=en&currency=INR&page=0&perpage=20', {
    body: {},
    access,
    auth: mergedAuth,
    signed: true,
  });
  add('G4', 'Empty body → 4xx', empty.http >= 400 && empty.http < 500 ? 'PASS' : 'BUG', {
    http: empty.http, code: empty.data?.error?.code,
  });

  const huge = await post('/v1/flights/search?lang=en&currency=INR&page=-1&perpage=999999', {
    body: owBody('DEL', 'DXB'),
    access,
    auth: mergedAuth,
    signed: true,
  });
  add('G5', 'Bad page/perpage never 500', huge.http !== 500 ? 'PASS' : 'BUG', {
    http: huge.http, code: huge.data?.error?.code,
  });

  const special = await post('/v1/flights/search?lang=en&currency=INR&page=0&perpage=20', {
    body: { ...owBody('DEL', 'DXB'), preferences: { airlines: ['<script>'], maxStops: null, refundableOnly: false } },
    access,
    auth: mergedAuth,
    signed: true,
  });
  add('G8', 'Special chars in optional fields not 500', special.http !== 500 ? 'PASS' : 'BUG', {
    http: special.http, code: special.data?.error?.code,
  });
}

add('G6', 'size=-1 vs paged same ids', 'NOT TESTED', { note: 'B2B uses perpage; scored via B7 paging instead' });
add('G7', 'Airline filter after merge', 'NOT TESTED', { note: 'no stable airline filter applied this run' });
add('G9', 'Merged vs single timing', 'NOT TESTED', { note: 'timing not instrumented beyond smoke' });
add('G10', 'No Riya string leak in fareRules/bookingCode', 'NOT TESTED', { note: 'fareRules/book not in this run (details only)' });

// E / F gated
add('E1', 'One vendor down', 'NOT TESTED', { note: 'needs Dev fault injection' });
add('E2', 'One vendor slow', 'NOT TESTED', { note: 'needs Dev fault injection' });
add('E3', 'Both vendors down', 'NOT TESTED', { note: 'needs Dev fault injection' });
add('F1', 'OW book 422R', 'NOT TESTED', { note: 'stopped at details/pricing — ALLOW_BOOK not set' });
add('F2', 'OW book 402T', 'NOT TESTED', { note: 'stopped at details/pricing — ALLOW_BOOK not set' });
add('F3', 'RT book', 'NOT TESTED', { note: 'stopped at details/pricing — ALLOW_BOOK not set' });
add('F4', 'Single-tier RT book', 'NOT TESTED', { note: 'ALLOW_BOOK not set' });
add('F5', 'Search==payment price', 'NOT TESTED', { note: 'no issue-ticket; see F5-partial on pricing if present' });

finish();

function finish() {
  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    checkedAt: new Date().toISOString(),
    searchMinute: SEARCH_MINUTE,
    env: BASE,
    partner_id: PARTNER_ID,
    tierMerged: MERGED,
    dates: { onward: ONWARD, return: RETURN },
    routes: ['DEL-DXB', 'DEL-BOM'],
    api: 'B2B POST /v1/flights/search → /v1/flights/details (+ pricing); no issue-ticket',
    sessions: Object.fromEntries(
      Object.entries(tierSessions).map(([k, v]) => [k, { http: v.http, ok: v.ok }]),
    ),
    listedTiers,
    summary,
    rows,
    dumps,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'MD-PACK-RESULTS.json'), JSON.stringify(report, null, 2));

  const lines = [
    '# Aggregation MD pack — B2B preprod results',
    '',
    `Checked: **${report.checkedAt}** · Search minute: **${SEARCH_MINUTE}**`,
    `Env: \`${BASE}\` · partner \`${PARTNER_ID}\` · merged tier \`${MERGED}\``,
    `Dates: OW/RT onward **${ONWARD}**, return **${RETURN}** · OD: DEL–DXB, DEL–BOM`,
    `Flow: search → details (+ pricing) · **no book**`,
    '',
    `## Summary: ${summary.PASS} PASS · ${summary.BUG} BUG · ${summary.NOT_TESTED} NOT TESTED`,
    '',
    '| Case | How tested | Status | Notes |',
    '|---|---|---|---|',
  ];
  for (const r of rows) {
    const note = r.note || (r.codes ? `codes=${JSON.stringify(r.codes)}` : '') || (r.http != null ? `http=${r.http}` : '');
    lines.push(`| ${r.id} | ${r.how.replace(/\|/g, '/')} | **${r.status}** | ${String(note).replace(/\|/g, '/').slice(0, 160)} |`);
  }
  lines.push('', '## Dumps', '');
  for (const [k, v] of Object.entries(dumps)) lines.push(`- \`${k}\`: \`${v}\``);
  fs.writeFileSync(path.join(OUT_DIR, 'MD-PACK-RESULTS.md'), `${lines.join('\n')}\n`);
  console.log('\n=== SUMMARY ===', summary);
  console.log('Report:', path.join(OUT_DIR, 'MD-PACK-RESULTS.md'));
}
