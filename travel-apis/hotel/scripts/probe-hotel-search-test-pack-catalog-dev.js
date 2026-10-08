/**
 * Catalog listing pack + extra edge cases.
 * Default host: https://catalog-dev.travelvip.ai/api  (x-api-key)
 * Staging partner: CATALOG_USE_PARTNER=1 BASE_URL=https://api-staging.travelvip.ai
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const USE_PARTNER = process.env.CATALOG_USE_PARTNER === '1';
const BASE = (process.env.CATALOG_BASE || (USE_PARTNER ? config.baseUrl : 'https://catalog-dev.travelvip.ai/api')).replace(/\/$/, '');
const PATH = process.env.CATALOG_LISTING_PATH || (USE_PARTNER ? '/v1/hotels/search' : '/hotels/v2/availability/listing');
const KEY = process.env.CATALOG_API_KEY;
const PID = process.env.CATALOG_PID || 'vgm';
const TIER = process.env.CATALOG_TIER_ID || '10546901';
const SUB = process.env.CATALOG_SUBSCRIPTION_ID || '123841304969662b8';
const OUT = path.join('reports', process.env.CATALOG_OUT || 'hotel-search-test-pack-catalog-dev.json');
const TIMEOUT_MS = 240000;
const FAIL_FAST = process.env.CATALOG_FAIL_FAST === '1';
const BOOK_PATHS = /prebook|finalize|issue-ticket|book/i;
if (BOOK_PATHS.test(PATH)) {
  console.error('Refusing to run: listing pack PATH looks like a booking endpoint:', PATH);
  process.exit(2);
}

if (!USE_PARTNER && !KEY) {
  console.error('Set CATALOG_API_KEY (or CATALOG_USE_PARTNER=1 for gateway)');
  process.exit(2);
}

let partnerClient = null;
async function partner() {
  if (!partnerClient) {
    clearSession();
    const s = await authenticate(true);
    partnerClient = s.client;
  }
  return partnerClient;
}

const SEARCHES = [
  {
    name: 'user-curl CITY 357389:IN INR',
    querySub: SUB,
    body: {
      entityId: '357389:IN',
      nationality: 'IN',
      checkin: '2026-09-10',
      checkout: '2026-09-12',
      type: 'CITY',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      currency: 'INR',
      lang: 'en',
      language: 'en',
      pid: PID,
      rt: 'compact',
      filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
      fq: [],
      requestId: '',
    },
  },
  {
    name: 'pack TBOCITY 328605:IN USD Pune',
    querySub: '15045625496a6327',
    body: {
      entityId: '328605:IN',
      nationality: 'IN',
      checkin: '2026-09-06',
      checkout: '2026-09-07',
      type: 'TBOCITY',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      currency: 'USD',
      language: 'en',
      pid: PID,
      rt: 'compact',
      filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
      fq: [],
      requestId: '',
    },
  },
];

const rows = [];

let reportMeta = { search: null };

function writeReport(extra = {}) {
  const report = {
    host: BASE,
    path: PATH,
    at: new Date().toISOString(),
    noBook: true,
    failFast: FAIL_FAST,
    search: reportMeta.search,
    score: tally(),
    rows,
    ...extra,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  return report;
}

function add(section, id, rule, how, expected, actual, status, extra = {}) {
  const rec = { section, id, rule, how, expected, actual, status, ...extra };
  rows.push(rec);
  console.log(`[${status}] ${section}.${id} ${rule} — ${actual}`);
  if (FAIL_FAST && status === 'BUG') {
    writeReport({ stoppedOn: `${section}.${id}` });
    console.error(`\nFAIL FAST: stopped at ${section}.${id} (no retries). Report: ${OUT}`);
    process.exit(1);
  }
  return rec;
}

function tally() {
  return {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
    total: rows.length,
  };
}

function fares(list) {
  return (list || []).map((h) => Number(h?.price?.baseFare)).filter((n) => Number.isFinite(n));
}

function ids(list) {
  return (list || []).map((h) => String(h.id || h.hotelId || '')).filter(Boolean);
}

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

function isMonoAsc(nums) {
  for (let i = 1; i < nums.length; i += 1) if (nums[i] < nums[i - 1] - 1e-6) return false;
  return nums.length > 0;
}

function isMonoDesc(nums) {
  for (let i = 1; i < nums.length; i += 1) if (nums[i] > nums[i - 1] + 1e-6) return false;
  return nums.length > 0;
}

function starFilter(filters) {
  return (filters || []).find((f) => /star/i.test(String(f.indexField || '')) || /star/i.test(String(f.name || '')));
}

function policyFilter(filters) {
  return (filters || []).find((f) => /policy|cancel|refund/i.test(`${f.indexField || ''} ${f.name || ''}`));
}

function facetCount(filter, key) {
  const f = (filter?.facets || []).find((x) => String(x.facetKey) === String(key) || String(x.name).startsWith(String(key)));
  return f?.count ?? null;
}

async function listing({ offset = 0, limit = 5, sort, subscriptionId = SUB, body, extraQuery = {} }) {
  const query = {
    pid: PID,
    tierId: TIER,
    subscriptionId: String(subscriptionId),
    offset: String(offset),
    lang: 'en',
    currency: body?.currency || 'INR',
    ...extraQuery,
  };
  if (limit !== undefined && limit !== null && extraQuery.limit === undefined) query.limit = String(limit);
  if (sort) query.sort = sort;

  const t0 = Date.now();
  if (USE_PARTNER) {
    const client = await partner();
    const res = await client.request({
      method: 'POST',
      path: PATH,
      query,
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const data = res.data;
    const results = Array.isArray(data?.results) ? data.results : [];
    return {
      status: res.status,
      ok: res.ok,
      ms: Date.now() - t0,
      data,
      results,
      fares: fares(results),
      ids: ids(results),
      requestId: data?.requestId || null,
      url: PATH,
    };
  }

  const q = new URLSearchParams(query);
  const url = `${BASE}${PATH}?${q.toString()}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  let text = '';
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'X-Correlation-ID': randomUUID(),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    status: res.status,
    ok: res.ok,
    ms: Date.now() - t0,
    data,
    results,
    fares: fares(results),
    ids: ids(results),
    requestId: data?.requestId || null,
    url: url.replace(KEY || '', 'REDACTED'),
  };
}

async function pickSearch() {
  const list = FAIL_FAST ? SEARCHES.slice(0, 1) : SEARCHES;
  for (const s of list) {
    console.log('Warm', s.name);
    const r = await listing({
      offset: 0,
      limit: 5,
      sort: 'price_ASC',
      subscriptionId: s.querySub,
      body: s.body,
    });
    console.log(' ', r.status, 'n=', r.results.length, 'total=', r.data?.totalResults, 'ms=', r.ms, brief(r.data?.error || r.data, 160));
    if (r.ok && r.results.length) {
      return { ...s, warm: r };
    }
    if (FAIL_FAST) {
      add(
        'Setup',
        '0',
        'Working listing search (auth + inventory)',
        `POST ${PATH} ${s.name}`,
        'HTTP 200 results>0',
        `HTTP ${r.status} n=${r.results.length} ${brief(r.data?.error || r.data, 180)}`,
        'BUG',
      );
    }
  }
  return null;
}

async function main() {
  console.log('Base:', BASE, 'Path:', PATH);
  const picked = await pickSearch();
  if (!picked) {
    add('Setup', '0', 'Catalog listing authenticates and returns hotels', 'POST listing with provided x-api-key', 'HTTP 200 + results', 'No working search config', 'BUG');
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), host: BASE, score: tally(), rows }, null, 2));
    process.exit(1);
  }

  const body0 = { ...picked.body };
  const sub = picked.querySub;
  const call = (opts = {}) => {
    const { body: bodyExtra, extraQuery, ...rest } = opts;
    return listing({
      subscriptionId: sub,
      body: { ...body0, ...(bodyExtra || {}) },
      extraQuery,
      ...rest,
    });
  };

  const warm = picked.warm;
  const total = Number(warm.data.totalResults);
  const filters = warm.data.filters || [];
  const star = starFilter(filters);
  const policy = policyFilter(filters);
  const unfilteredTotal = total;
  const star5 = (star?.facets || []).find((x) => String(x.facetKey) === '5' || /^5/.test(String(x.name)));
  const star4 = (star?.facets || []).find((x) => String(x.facetKey) === '4' || /^4/.test(String(x.name)));
  const requestId = warm.requestId;
  reportMeta.search = { name: picked.name, entityId: body0.entityId, type: body0.type, checkin: body0.checkin, checkout: body0.checkout, currency: body0.currency, subscriptionId: sub, totalResults: unfilteredTotal, requestId };
  console.log('Using', picked.name, 'total', total, 'requestId', requestId, 'starFacets', (star?.facets || []).map((x) => `${x.name}:${x.count}:${x.facetKey}`));

  add(
    'Setup',
    '0',
    'Working listing search (auth + inventory)',
    `POST ${PATH} ${picked.name}`,
    'HTTP 200 results>0',
    `HTTP ${warm.status} n=${warm.results.length} total=${total} requestId=${requestId} ms=${warm.ms}`,
    warm.ok && warm.results.length ? 'PASS' : 'BUG',
    { requestId },
  );

  // ----- pack sorting -----
  const s1 = await call({ offset: 0, limit: 5, sort: undefined });
  const sortKeys = (s1.data?.sorts || []).map((s) => s.key);
  add('Sort', 'S1', 'Sort options are advertised', 'offset=0 limit=5 no sort', "exactly ['price_ASC','price_DESC']; no star sort", `keys=${JSON.stringify(sortKeys)}`, JSON.stringify(sortKeys) === JSON.stringify(['price_ASC', 'price_DESC']) ? 'PASS' : 'BUG', { requestId: s1.requestId });

  const s2 = await call({ offset: 0, limit: 5, sort: 'price_ASC' });
  add('Sort', 'S2', 'Price ascending across whole result set', 'sort=price_ASC limit=5', 'non-decreasing price.baseFare', `fares=${JSON.stringify(s2.fares)}`, s2.ok && isMonoAsc(s2.fares) ? 'PASS' : 'BUG', { requestId: s2.requestId });

  const s3 = await call({ offset: 0, limit: 5, sort: 'price_DESC' });
  const s3diff = overlapEmpty(s2.ids, s3.ids) === false;
  add('Sort', 'S3', 'Price descending, different set from S2', 'sort=price_DESC limit=5', 'non-increasing fares and different hotels than S2', `fares=${JSON.stringify(s3.fares)} overlapIds=${overlap(s2.ids, s3.ids).length}`, s3.ok && isMonoDesc(s3.fares) && s2.ids.join() !== s3.ids.join() ? 'PASS' : 'BUG', { requestId: s3.requestId, differentSet: s3diff });

  const s4 = await call({ offset: 0, limit: 5, sort: 'rating_DESC' });
  const nosort = await call({ offset: 0, limit: 5 });
  add('Sort', 'S4', 'Unknown sort key ignored, not rejected', 'sort=rating_DESC', 'HTTP 200, order matches unsorted', `http=${s4.status} fares=${JSON.stringify(s4.fares)} unsorted=${JSON.stringify(nosort.fares)}`, s4.status === 200 && s4.results.length > 0 ? 'PASS' : 'BUG', { requestId: s4.requestId });

  async function edgeSort() {
    const r = await call({ offset: 0, limit: 5, sort: 'price_AS' });
    add('Sort', 'S-E1', 'Truncated key price_AS ignored', 'sort=price_AS', 'HTTP 200 with results', `http=${r.status} n=${r.results.length} fares=${JSON.stringify(r.fares)}`, r.status === 200 && r.results.length ? 'PASS' : 'BUG', { requestId: r.requestId });

    const r2 = await call({ offset: 0, limit: 5, sort: 'PRICE_ASC' });
    add('Sort', 'S-E2', 'Sort key is case-sensitive / PRICE_ASC', 'sort=PRICE_ASC', 'Either treated as price_ASC (monotonic) or ignored (200)', `http=${r2.status} fares=${JSON.stringify(r2.fares)} monoAsc=${isMonoAsc(r2.fares)}`, r2.status === 200 && r2.results.length ? 'PASS' : 'BUG', { requestId: r2.requestId });

    const r3 = await call({ offset: 0, limit: 5, sort: 'price_ASC,price_DESC' });
    add('Sort', 'S-E3', 'Combined sort=price_ASC,price_DESC', 'comma-separated sort', 'HTTP 200 (ignored or first key)', `http=${r3.status} n=${r3.results.length} fares=${JSON.stringify(r3.fares)}`, r3.status === 200 ? 'PASS' : 'BUG', { requestId: r3.requestId });

    const byTotal = s2.results.map((h) => Number(h.price?.totalAmount));
    const byBase = s2.fares;
    const sameOrder = JSON.stringify(byTotal) === JSON.stringify([...byTotal].sort((a, b) => a - b)) && JSON.stringify(byBase) === JSON.stringify([...byBase].sort((a, b) => a - b));
    add('Sort', 'S-E4', 'S2 orders by baseFare not totalAmount', 'compare S2 baseFare vs totalAmount sequences', 'baseFare monotonic; if totalAmount differs, that difference is allowed', `base=${JSON.stringify(byBase)} total=${JSON.stringify(byTotal)}`, isMonoAsc(byBase) ? 'PASS' : 'BUG');
  }
  await edgeSort();

  // ----- pack filters -----
  const f1 = await call({ offset: 0, limit: 5 });
  const starF = starFilter(f1.data?.filters);
  const facetMeta = (starF?.facets || []).map((x) => ({ name: x.name, count: x.count, facetKey: x.facetKey }));
  const namesOk = facetMeta.length > 0 && facetMeta.every((x) => x.facetKey != null && x.facetKey !== '');
  const noLow = !(starF?.facets || []).some((x) => /^[12]\b/.test(String(x.name)));
  add('Filter', 'F1', 'Star-rating facet present and self-describing', 'unfiltered listing filters[]', 'Star Rating indexField df_long_star_rating; 5/4/3 with facetKey; no 1-2 star', `indexField=${starF?.indexField} facets=${JSON.stringify(facetMeta)}`, starF && /star_rating/i.test(String(starF.indexField)) && namesOk && noLow ? 'PASS' : 'BUG', { requestId: f1.requestId });

  if (!star5) {
    add('Filter', 'F2', 'One value narrows the set', 'fq df_long_star_rating:5', 'totalResults = 5★ count; all starRating 5', 'No 5★ facet on this search', 'NOT TESTED');
    add('Filter', 'F3', 'Multi-select uses a semicolon', 'fq 4;5', 'total = 4★+5★ counts', 'No 4/5 facets', 'NOT TESTED');
    add('Filter', 'F4', 'Facet counts survive a selection', 'fq :5', 'filtered totalResults; all ratings still listed', 'No 5★ facet', 'NOT TESTED');
  } else {
    const f2 = await call({ offset: 0, limit: 5, sort: 'price_ASC', body: { fq: [`${starF.indexField}:${star5.facetKey}`] } });
    const stars = f2.results.map((h) => Number(h.starRating));
    const all5 = stars.length > 0 && stars.every((s) => s === 5);
    add('Filter', 'F2', 'One value narrows the set', `fq ${starF.indexField}:${star5.facetKey}`, `totalResults=${star5.count}; every starRating 5`, `total=${f2.data?.totalResults} stars=${JSON.stringify(stars)} facetCount=${star5.count}`, f2.ok && Number(f2.data?.totalResults) === Number(star5.count) && all5 ? 'PASS' : 'BUG', { requestId: f2.requestId });

    if (star4) {
      const f3 = await call({ offset: 0, limit: 5, sort: 'price_ASC', body: { fq: [`${starF.indexField}:${star4.facetKey};${star5.facetKey}`] } });
      const set = [...new Set(f3.results.map((h) => Number(h.starRating)))].sort((a, b) => a - b);
      const expected = Number(star4.count) + Number(star5.count);
      add('Filter', 'F3', 'Multi-select uses a semicolon', `fq ${starF.indexField}:${star4.facetKey};${star5.facetKey}`, `totalResults=${expected}; only 4 and 5`, `total=${f3.data?.totalResults} ratings=${JSON.stringify(set)} expected=${expected}`, f3.ok && Number(f3.data?.totalResults) === expected && set.every((s) => s === 4 || s === 5) ? 'PASS' : 'BUG', { requestId: f3.requestId });
    } else {
      add('Filter', 'F3', 'Multi-select uses a semicolon', 'fq 4;5', '4+5 totals', 'No 4★ facet', 'NOT TESTED');
    }

    const f4 = await call({ offset: 0, limit: 5, body: { fq: [`${starF.indexField}:${star5.facetKey}`] } });
    const still = starFilter(f4.data?.filters);
    const stillCounts = (still?.facets || []).map((x) => `${x.name}:${x.count}`);
    const origCounts = (starF.facets || []).map((x) => `${x.name}:${x.count}`);
    add('Filter', 'F4', 'Facet counts survive a selection', 'fq 5-star only', 'totalResults filtered; facet counts remain full', `total=${f4.data?.totalResults} facetsNow=${JSON.stringify(stillCounts)} orig=${JSON.stringify(origCounts)}`, Number(f4.data?.totalResults) === Number(star5.count) && still?.facets?.length >= 3 ? 'PASS' : 'BUG', { requestId: f4.requestId });
  }

  if (!policy) {
    add('Filter', 'F5', 'Filter and sort compose', 'fq reservation policy + price_ASC', 'total below unfiltered; fares ascending', 'No reservation-policy facet', 'NOT TESTED');
  } else {
    const fac = policy.facets?.[0];
    const fq = fac?.facetKey != null && fac.facetKey !== ''
      ? `${policy.indexField}:${fac.facetKey}`
      : `${policy.indexField}:${fac?.name || 'Free cancellation'}`;
    const f5 = await call({ offset: 0, limit: 5, sort: 'price_ASC', body: { fq: [fq] } });
    add('Filter', 'F5', 'Filter and sort compose', `fq ${fq} + sort=price_ASC`, 'totalResults < unfiltered; fares ascending', `total=${f5.data?.totalResults} unfiltered=${unfilteredTotal} fares=${JSON.stringify(f5.fares)}`, f5.ok && Number(f5.data?.totalResults) < unfilteredTotal && isMonoAsc(f5.fares) ? 'PASS' : 'BUG', { requestId: f5.requestId });
  }

  const f6 = await call({ offset: 0, limit: 5, body: { fq: [`${starF?.indexField || 'df_long_star_rating'}:`] } });
  add('Filter', 'F6', 'Valueless filter is ignored, not fatal', 'fq star_rating empty value', 'HTTP 200 and full unfiltered totalResults', `http=${f6.status} total=${f6.data?.totalResults} unfiltered=${unfilteredTotal}`, f6.status === 200 && Number(f6.data?.totalResults) === unfilteredTotal ? 'PASS' : 'BUG', { requestId: f6.requestId });

  if (star4 && star5 && starF) {
    const comma = await call({ offset: 0, limit: 5, sort: 'price_ASC', body: { fq: [`${starF.indexField}:${star4.facetKey},${star5.facetKey}`] } });
    add('Filter', 'F-E1', 'Comma instead of semicolon does not multi-select', `fq ${starF.indexField}:${star4.facetKey},${star5.facetKey}`, 'Must NOT equal 4★+5★ combined total (semicolon is required)', `total=${comma.data?.totalResults} combined=${Number(star4.count) + Number(star5.count)} http=${comma.status}`, comma.status === 200 && Number(comma.data?.totalResults) !== Number(star4.count) + Number(star5.count) ? 'PASS' : (comma.status === 200 ? 'BUG' : 'BUG'), { requestId: comma.requestId });

    const dup = await call({ offset: 0, limit: 5, body: { fq: [`${starF.indexField}:${star4.facetKey}`, `${starF.indexField}:${star5.facetKey}`] } });
    add('Filter', 'F-E2', 'Two fq entries for same field vs semicolon', 'fq array with two star filters', 'Documented contract is one field with semicolon. Record actual total.', `http=${dup.status} total=${dup.data?.totalResults} semiExpected=${Number(star4.count)+Number(star5.count)}`, dup.status === 200 ? 'PASS' : 'BUG', { requestId: dup.requestId, note: 'informational if totals differ from semicolon form' });

    const unk = await call({ offset: 0, limit: 5, body: { fq: [`${starF.indexField}:99`] } });
    add('Filter', 'F-E3', 'Unknown star facetKey', 'fq star_rating:99', 'HTTP 200, typically 0 results not 500', `http=${unk.status} n=${unk.results.length} total=${unk.data?.totalResults}`, unk.status === 200 ? 'PASS' : 'BUG', { requestId: unk.requestId });
  } else {
    add('Filter', 'F-E1', 'Comma instead of semicolon', 'need 4 and 5 facets', 'n/a', 'No 4/5 facets', 'NOT TESTED');
    add('Filter', 'F-E2', 'Two fq entries same field', 'need 4 and 5 facets', 'n/a', 'No 4/5 facets', 'NOT TESTED');
    add('Filter', 'F-E3', 'Unknown facetKey', 'need star filter', 'n/a', 'No star filter', 'NOT TESTED');
  }

  const low = await call({ offset: 0, limit: 5, sort: 'price_ASC', body: { fq: ['df_long_star_rating:1;2'] } });
  add('Filter', 'F-E4', '1★/2★ filter (excluded by design)', 'fq df_long_star_rating:1;2', 'HTTP 200; typically 0 results', `http=${low.status} total=${low.data?.totalResults} n=${low.results.length}`, low.status === 200 ? 'PASS' : 'BUG', { requestId: low.requestId });

  const fqStr = await call({ offset: 0, limit: 5, body: { fq: 'df_long_star_rating:5' } });
  add('Filter', 'F-E5', 'fq as string instead of array', 'body.fq is a string', 'HTTP 400 or ignored (200). Not 500.', `http=${fqStr.status} ${brief(fqStr.data, 180)}`, fqStr.status === 400 || fqStr.status === 200 ? 'PASS' : 'BUG', { requestId: fqStr.requestId });

  // ----- pack paging -----
  const pA = await call({ offset: 0, limit: 5, sort: 'price_ASC' });
  const pB = await call({ offset: 5, limit: 5, sort: 'price_ASC' });
  const pC = await call({ offset: 10, limit: 5, sort: 'price_ASC' });
  const chainOk = pA.fares.length && pB.fares.length && pC.fares.length
    && pA.fares[pA.fares.length - 1] <= pB.fares[0] + 1e-6
    && pB.fares[pB.fares.length - 1] <= pC.fares[0] + 1e-6;
  const repeats = overlap(overlap(pA.ids, pB.ids), pC.ids).concat(overlap(pA.ids, pB.ids), overlap(pB.ids, pC.ids));
  add('Paging', 'P1', 'Pages chain without gaps or repeats', 'offset 0,5,10 limit=5 price_ASC', 'last fare of page N <= first of N+1; no id repeats', `fares0=${JSON.stringify(pA.fares)} fares5=${JSON.stringify(pB.fares)} fares10=${JSON.stringify(pC.fares)} overlap=${JSON.stringify([...new Set(repeats)])}`, chainOk && overlap(pA.ids, pB.ids).length === 0 && overlap(pB.ids, pC.ids).length === 0 ? 'PASS' : 'BUG', { requestId: pA.requestId });

  const p2 = await call({ offset: 7, limit: 5, sort: 'price_ASC' });
  add('Paging', 'P2', 'Offset is echoed back', 'offset=7 limit=5', 'offset:7 exactly; page advisory', `page=${p2.data?.page} offset=${p2.data?.offset} size=${p2.data?.size}`, Number(p2.data?.offset) === 7 ? 'PASS' : 'BUG', { requestId: p2.requestId });

  const expectP3 = pB.fares.slice(2).concat(pC.fares.slice(0, 2));
  add('Paging', 'P3', 'Non-multiple offset slices where it says', 'offset=7 is tail of page offset=5 + head of offset=10', `fares ≈ ${JSON.stringify(expectP3)}`, `fares=${JSON.stringify(p2.fares)}`, JSON.stringify(p2.fares) === JSON.stringify(expectP3) || (p2.fares.length === 5 && p2.fares[0] === pB.fares[2]) ? 'PASS' : 'BUG', { requestId: p2.requestId });

  const p4 = await call({ offset: 0, limit: 20, sort: 'price_ASC' });
  const expectedPages = Math.ceil(Number(p4.data?.totalResults || 0) / 20);
  add('Paging', 'P4', 'Page size changes recompute page count', 'limit=20', '20 results; totalPages==ceil(total/20)', `size=${p4.data?.size} n=${p4.results.length} totalPages=${p4.data?.totalPages} expected=${expectedPages}`, p4.results.length === 20 && Number(p4.data?.totalPages) === expectedPages ? 'PASS' : 'BUG', { requestId: p4.requestId });

  const lastOff = Math.max(0, unfilteredTotal - 4);
  const p5 = await call({ offset: lastOff, limit: 5, sort: 'price_ASC' });
  add('Paging', 'P5', 'Final page reports itself', `offset=${lastOff} (total-4) limit=5`, 'fewer than limit results and last:true', `n=${p5.results.length} last=${p5.data?.last} offset=${p5.data?.offset}`, p5.ok && p5.results.length < 5 && p5.data?.last === true ? 'PASS' : 'BUG', { requestId: p5.requestId });

  const p6 = await call({ offset: 9999, limit: 5, sort: 'price_ASC' });
  add('Paging', 'P6', 'Past the end is an empty page, not an error', 'offset=9999 limit=5', 'HTTP 200, 0 results, last true, offset echoed, total unchanged', `http=${p6.status} n=${p6.results.length} last=${p6.data?.last} offset=${p6.data?.offset} total=${p6.data?.totalResults}`, p6.status === 200 && p6.results.length === 0 && p6.data?.last === true && Number(p6.data?.offset) === 9999 && Number(p6.data?.totalResults) === unfilteredTotal ? 'PASS' : 'BUG', { requestId: p6.requestId });

  const pE1 = await call({ offset: 0, limit: 1, sort: 'price_ASC' });
  add('Paging', 'P-E1', 'limit=1 returns a single hotel', 'limit=1', 'n=1 size=1', `n=${pE1.results.length} size=${pE1.data?.size}`, pE1.ok && pE1.results.length === 1 ? 'PASS' : 'BUG', { requestId: pE1.requestId });

  const pE2 = await listing({ offset: 0, sort: 'price_ASC', subscriptionId: sub, body: body0, extraQuery: { omitLimit: '1' } });
  // listing always sets limit unless we skip - dedicated call:
  const pE2b = await listingOmitLimit(body0, sub);
  add('Paging', 'P-E2', 'Omitting limit still pages', 'no limit query param', 'HTTP 200 with a default size > 0', `http=${pE2b.status} n=${pE2b.results.length} size=${pE2b.data?.size}`, pE2b.status === 200 && pE2b.results.length > 0 ? 'PASS' : 'BUG', { requestId: pE2b.requestId });

  const pE3 = await call({ offset: unfilteredTotal, limit: 5, sort: 'price_ASC' });
  add('Paging', 'P-E3', 'offset == totalResults is empty last page', `offset=${unfilteredTotal}`, 'HTTP 200 n=0 last true', `http=${pE3.status} n=${pE3.results.length} last=${pE3.data?.last} offset=${pE3.data?.offset}`, pE3.status === 200 && pE3.results.length === 0 ? 'PASS' : 'BUG', { requestId: pE3.requestId });

  const pE4 = await call({ offset: 5, limit: 5, sort: 'price_ASC', body: { requestId: pA.requestId || '' } });
  add('Paging', 'P-E4', 'Follow-up page echoes / accepts requestId', 'same search + requestId on page 2', 'HTTP 200; page continues ASC', `http=${pE4.status} n=${pE4.results.length} rid=${pE4.requestId} fares=${JSON.stringify(pE4.fares)}`, pE4.status === 200 && pE4.results.length > 0 ? 'PASS' : 'BUG');

  // ----- pack validation -----
  const v1 = await call({ offset: -1, limit: 5 });
  const v1msg = v1.data?.error?.message || v1.data?.message || v1.data?.detail || brief(v1.data, 200);
  const v1code = v1.data?.error?.code || v1.data?.code;
  add('Validation', 'V1', 'Negative offset is rejected', 'offset=-1 limit=5', 'HTTP 400 VALIDATION_ERROR offset must be 0 or greater…', `http=${v1.status} code=${v1code} msg=${v1msg}`, v1.status === 400 ? 'PASS' : 'BUG', { requestId: v1.requestId || v1.data?.request_id });

  const v2 = await call({ offset: 0, limit: 0 });
  add('Validation', 'V2', 'Zero limit is rejected', 'limit=0', 'HTTP 400 VALIDATION_ERROR', `http=${v2.status} code=${v2.data?.error?.code || v2.data?.code} msg=${v2.data?.error?.message || v2.data?.message || brief(v2.data, 160)}`, v2.status === 400 ? 'PASS' : 'BUG');

  const v3 = await listingRaw({ offset: 'abc', limit: '5', body: body0, sub });
  add('Validation', 'V3', 'Non-numeric offset is rejected', 'offset=abc', 'HTTP 400 (framework body, may not be VALIDATION_ERROR)', `http=${v3.status} ${brief(v3.data, 180)}`, v3.status === 400 ? 'PASS' : 'BUG');

  const vE1 = await listingRaw({ offset: '0', limit: '-1', body: body0, sub });
  add('Validation', 'V-E1', 'Negative limit is rejected', 'limit=-1', 'HTTP 400 VALIDATION_ERROR', `http=${vE1.status} ${brief(vE1.data, 180)}`, vE1.status === 400 ? 'PASS' : 'BUG');

  const vE2 = await listingRaw({ offset: '1.5', limit: '5', body: body0, sub });
  add('Validation', 'V-E2', 'Float offset is rejected or not silently clamped to 0', 'offset=1.5', 'HTTP 400 preferred; 200 with offset 1.5 or 1 also acceptable if documented. 200 of first page is BUG.', `http=${vE2.status} offset=${vE2.data?.offset} n=${vE2.results?.length} ${brief(vE2.data, 140)}`, vE2.status === 400 || (vE2.status === 200 && Number(vE2.data?.offset) !== 0) ? 'PASS' : 'BUG');

  const vE3 = await listingRaw({ offset: '0', limit: 'abc', body: body0, sub });
  add('Validation', 'V-E3', 'Non-numeric limit is rejected', 'limit=abc', 'HTTP 400', `http=${vE3.status} ${brief(vE3.data, 180)}`, vE3.status === 400 ? 'PASS' : 'BUG');

  const vE4 = await listingRaw({ offset: String(2 ** 31), limit: '5', body: body0, sub });
  add('Validation', 'V-E4', 'Huge offset Integer.MAX+ does not 500', `offset=${2 ** 31}`, 'HTTP 200 empty last page or 400 — not 500', `http=${vE4.status} n=${vE4.results?.length}`, vE4.status !== 500 && vE4.status !== 0 ? 'PASS' : 'BUG');

  const vE5 = await listingRaw({ offset: '', limit: '5', body: body0, sub });
  add('Validation', 'V-E5', 'Empty offset query', 'offset=', 'HTTP 400 or default 0 with 200', `http=${vE5.status} offset=${vE5.data?.offset} n=${vE5.results?.length}`, vE5.status === 400 || vE5.status === 200 ? 'PASS' : 'BUG');

  const missingDates = await listing({
    offset: 0, limit: 5, sort: 'price_ASC', subscriptionId: sub,
    body: { ...body0, checkin: undefined, checkout: undefined },
  });
  add('Edge', 'E-E1', 'Missing checkin/checkout', 'omit stay dates', 'HTTP 400 VALIDATION_ERROR not 500', `http=${missingDates.status} ${brief(missingDates.data, 180)}`, missingDates.status === 400 || missingDates.status === 200 ? (missingDates.status === 400 ? 'PASS' : 'BUG') : 'BUG');

  const badType = await listing({
    offset: 0, limit: 5, subscriptionId: sub,
    body: { ...body0, type: 'TBOCITY' },
  });
  add('Edge', 'E-E2', 'type TBOCITY vs CITY on this entity', `entity ${body0.entityId} type=TBOCITY`, 'HTTP 200 results or 4xx — not 500', `http=${badType.status} n=${badType.results.length} total=${badType.data?.totalResults}`, badType.status !== 500 ? 'PASS' : 'BUG', { requestId: badType.requestId });

  const noRooms = await listing({
    offset: 0, limit: 5, subscriptionId: sub,
    body: { ...body0, rooms: [] },
  });
  add('Edge', 'E-E3', 'Empty rooms array', 'rooms:[]', 'HTTP 400 not 500', `http=${noRooms.status} ${brief(noRooms.data, 180)}`, noRooms.status === 400 ? 'PASS' : (noRooms.status === 500 ? 'BUG' : 'BUG'));

  const report = writeReport();
  console.log('\n========== LISTING PACK ==========');
  console.log(JSON.stringify({ search: report.search, score: report.score }, null, 2));
  console.log('Report:', OUT);
  if (report.score.BUG) process.exit(1);
}

function overlap(a, b) {
  const s = new Set(a);
  return b.filter((x) => s.has(x));
}
function overlapEmpty(a, b) {
  return overlap(a, b).length === 0;
}

async function listingRaw({ offset, limit, body, sub }) {
  return listing({ offset, limit, subscriptionId: sub, body, extraQuery: {} });
}

async function listingOmitLimit(body, sub) {
  return listing({ offset: 0, limit: null, sort: 'price_ASC', subscriptionId: sub, body });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
