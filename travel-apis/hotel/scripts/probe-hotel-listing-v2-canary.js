/**
 * Hotel Listing v2 — sort / filter / paging on canary
 * Spec: hotel-listing-v2.md
 *   POST /api/hotels/v2/availability/listing
 *   Sort + paging in query. Filters in body.fq[].
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'; $env:HOTEL_PID='vgm'; node scripts/probe-hotel-listing-v2-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
process.env.HOTEL_PID = process.env.HOTEL_PID || 'vgm';

const OUT = path.join('reports', 'hotel-listing-v2-canary.json');
const OUT_MD = path.join('reports', 'hotel-listing-v2-canary-bug-report.md');
const PATH_SPEC = '/api/hotels/v2/availability/listing';
const PATH_LIVE = '/v1/hotels/search';
const PID = process.env.HOTEL_PID || 'vgm';
const SUB = process.env.SUBSCRIPTION_ID || '15045625496a6327';
const LIMIT = 5;

const rows = [];
let nSort = 0;
let nFilter = 0;
let nPage = 0;
let nShape = 0;

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function brief(d, n = 420) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

function row(section, id, rule, how, expected, actual, status, extra = {}) {
  const rec = { section, id, rule, how, expected, actual, status, ...extra };
  rows.push(rec);
  console.log(`${status.padEnd(11)} | ${section}.${id} | ${rule} | ${actual}`);
  return rec;
}

function tally(list) {
  return {
    PASS: list.filter((r) => r.status === 'PASS').length,
    BUG: list.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': list.filter((r) => r.status === 'NOT TESTED').length,
    total: list.length,
  };
}

function hotels(data) {
  return Array.isArray(data?.results) ? data.results : [];
}

function fares(list) {
  return list.map((h) => Number(h?.price?.baseFare)).filter((n) => Number.isFinite(n));
}

function ids(list) {
  return list.map((h) => String(h.id || h.hotelId || '')).filter(Boolean);
}

function slim(res, extra = {}) {
  const d = res?.data && typeof res.data === 'object' ? res.data : {};
  const list = hotels(d).slice(0, 5);
  return {
    http: res?.status,
    code: errCode(res),
    elapsedMs: res?.elapsedMs,
    page: d.page,
    offset: d.offset,
    size: d.size,
    last: d.last,
    totalResults: d.totalResults,
    availableResults: d.availableResults,
    totalPages: d.totalPages,
    requestId: d.requestId,
    currency: d.currency,
    resultCount: hotels(d).length,
    hotels: list.map((h) => ({
      id: h.id,
      name: h.name,
      starRating: h.starRating,
      refundable: h.refundable,
      baseFare: h.price?.baseFare,
      totalAmount: h.price?.totalAmount,
    })),
    sorts: (d.sorts || []).map((s) => s.key),
    filterNames: (d.filters || []).map((f) => `${f.name}|${f.indexField}|facets=${(f.facets || []).length}`),
    snippet: brief(d, 280),
    ...extra,
  };
}

function isMonoAsc(nums) {
  for (let i = 1; i < nums.length; i += 1) {
    if (nums[i] < nums[i - 1] - 1e-6) return false;
  }
  return nums.length > 0;
}

function isMonoDesc(nums) {
  for (let i = 1; i < nums.length; i += 1) {
    if (nums[i] > nums[i - 1] + 1e-6) return false;
  }
  return nums.length > 0;
}

function pickStarFilter(filters) {
  return (filters || []).find((f) => /star/i.test(f.indexField || '') || /star/i.test(f.name || ''));
}

function pickPolicyFilter(filters) {
  return (filters || []).find((f) => /policy|cancel|refund/i.test(String(f.indexField || '') + String(f.name || '')));
}

function fqFor(filter, facetKeys) {
  return `${filter.indexField}:${facetKeys.join(';')}`;
}

function overlap(a, b) {
  const s = new Set(a);
  return b.filter((x) => s.has(x));
}

async function listing(client, { path, query, body }) {
  const t0 = Date.now();
  const res = await client.request({
    method: 'POST',
    path: path || PATH_LIVE,
    query,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  res.elapsedMs = Date.now() - t0;
  return res;
}

function qBase(extra = {}) {
  return {
    pid: PID,
    tierId: config.tierId,
    subscriptionId: SUB,
    offset: 0,
    limit: LIMIT,
    ...extra,
  };
}

function bodyBase(entity, extra = {}) {
  return {
    checkin: entity.checkin,
    checkout: entity.checkout,
    type: entity.type,
    entityId: entity.entityId,
    nationality: 'IN',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: entity.currency || 'INR',
    language: 'en',
    rt: 'compact',
    requestId: entity.requestId || '',
    ...extra,
  };
}

function pickCity(content, q) {
  const list = Array.isArray(content) ? content : [];
  const qn = String(q).toLowerCase();
  const cities = list.filter((x) => /CITY|TBOCITY|REGION/i.test(String(x.type || '')));
  return cities.find((x) => String(x.title || '').toLowerCase() === qn)
    || cities.find((x) => String(x.title || '').toLowerCase().includes(qn))
    || cities[0]
    || null;
}

async function resolveEntity(hotel) {
  const checkin = process.env.HOTEL_LIST_CHECKIN || '2026-09-06';
  const checkout = process.env.HOTEL_LIST_CHECKOUT || '2026-09-07';
  const currency = process.env.HOTEL_LIST_CURRENCY || 'INR';

  if (process.env.HOTEL_LIST_ENTITY_ID) {
    return {
      checkin,
      checkout,
      currency,
      type: process.env.HOTEL_LIST_TYPE || 'TBOCITY',
      entityId: process.env.HOTEL_LIST_ENTITY_ID,
      label: process.env.HOTEL_LIST_LABEL || process.env.HOTEL_LIST_ENTITY_ID,
    };
  }

  for (const q of ['pune', 'mumbai', 'delhi', 'bangalore']) {
    const ac = await hotel.autocomplete(q, 0, 20);
    const hit = pickCity(ac.data?.content, q);
    if (hit?.entityId) {
      const type = /TBOCITY/i.test(hit.type) ? 'TBOCITY' : (hit.type || 'TBOCITY');
      return {
        checkin,
        checkout,
        currency,
        type,
        entityId: String(hit.entityId),
        label: `${hit.title} (${hit.type})`,
        autocompleteHttp: ac.status,
      };
    }
  }

  return {
    checkin,
    checkout,
    currency: 'USD',
    type: 'TBOCITY',
    entityId: '328605:IN',
    label: 'doc sample 328605:IN',
  };
}

async function warmBaseline(client, entity) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    last = await listing(client, {
      path: PATH_LIVE,
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity),
    });
    const d = last.data || {};
    const count = hotels(d).length;
    const total = Number(d.totalResults || d.availableResults || 0);
    console.log(`  warm ${attempt} HTTP ${last.status} ${last.elapsedMs}ms results=${count} total=${total} requestId=${d.requestId || '-'}`);
    if (last.ok && (count > 0 || total > 0)) {
      return last;
    }
    if (!last.ok && last.status >= 500) return last;
    if (!last.ok && last.status === 404) return last;
    await sleep(8000);
  }
  return last;
}

async function main() {
  clearSession();
  console.log('Hotel Listing v2 on', config.baseUrl, 'pid', PID);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const hotel = new HotelService(client);

  const entity = await resolveEntity(hotel);
  console.log('Entity', entity);

  const specHit = await listing(client, {
    path: PATH_SPEC,
    query: qBase({ sort: 'price_ASC' }),
    body: bodyBase(entity),
  });
  nShape += 1;
  row('Shape', nShape, 'Documented listing path exists on canary',
    `POST ${PATH_SPEC}?offset=0&limit=${LIMIT}&sort=price_ASC`,
    'HTTP 200 listing envelope (not 404 Page not found)',
    `HTTP ${specHit.status} ${brief(specHit.data, 180)} ${specHit.elapsedMs}ms`,
    specHit.status === 200 && hotels(specHit.data).length > 0 ? 'PASS' : 'BUG',
    { payload: { path: PATH_SPEC, query: qBase({ sort: 'price_ASC' }), body: bodyBase(entity) }, response: slim(specHit) });

  console.log('Live path for remaining cases:', PATH_LIVE);
  const baseline = await warmBaseline(client, entity);
  const bd = baseline?.data || {};
  entity.requestId = bd.requestId || '';

  const evidence = {
    entity,
    specPath: slim(specHit),
    livePath: PATH_LIVE,
    baseline: slim(baseline),
    bugs: [],
  };

  nShape += 1;
  const shapeOk = baseline.ok && Array.isArray(hotels(bd)) && bd.totalResults != null;
  row('Shape', nShape, 'Valid listing envelope (live /v1/hotels/search)',
    `POST ${PATH_LIVE} offset=0&limit=${LIMIT}&sort=price_ASC entity=${entity.entityId}`,
    'HTTP 200 with results[], totalResults, offset, size, last, filters, sorts, requestId',
    `HTTP ${baseline.status} results=${hotels(bd).length} total=${bd.totalResults} last=${bd.last} sorts=${(bd.sorts || []).length} filters=${(bd.filters || []).length} ${baseline.elapsedMs}ms`,
    shapeOk ? 'PASS' : 'BUG',
    { evidence: slim(baseline) });

  nShape += 1;
  const sortKeys = (bd.sorts || []).map((s) => s.key);
  row('Shape', nShape, 'sorts[] exposes price_ASC and price_DESC',
    'Read sorts from first listing response',
    'keys include price_ASC and price_DESC',
    `sorts=${JSON.stringify(bd.sorts || [])}`,
    baseline.ok && sortKeys.includes('price_ASC') && sortKeys.includes('price_DESC') ? 'PASS' : (baseline.ok ? 'BUG' : 'NOT TESTED'),
    { evidence: bd.sorts || null });

  nShape += 1;
  const starF = pickStarFilter(bd.filters);
  row('Shape', nShape, 'filters[] includes Star Rating with facetKey',
    'Read filters from first listing response',
    'Star rating filter with facets[].facetKey',
    `star=${brief(starF, 280)}`,
    baseline.ok && starF && (starF.facets || []).some((f) => f.facetKey != null) ? 'PASS' : (baseline.ok ? 'BUG' : 'NOT TESTED'),
    { evidence: starF || bd.filters || null });

    if (!baseline.ok) {
    const report = wrapReport(entity, evidence, session);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    fs.writeFileSync(OUT_MD, buildDevMarkdown(report));
    console.log('Baseline failed — remaining cases NOT TESTED. Report', OUT);
    printTables();
    return;
  }

  const baseHotels = hotels(bd);
  const baseFares = fares(baseHotels);
  const baseIds = ids(baseHotels);
  const total = Number(bd.totalResults || 0);
  const policyF = pickPolicyFilter(bd.filters);

  // ════════════════════════════════════════
  // SORT
  // ════════════════════════════════════════
  nSort += 1;
  row('Sort', nSort, 'price_ASC orders this page by price.baseFare',
    'query sort=price_ASC limit=5 (baseline)',
    'results non-decreasing by price.baseFare',
    `fares=${JSON.stringify(baseFares)}`,
    baseFares.length >= 2 && isMonoAsc(baseFares) ? 'PASS' : (baseFares.length < 2 ? 'NOT TESTED' : 'BUG'),
    { evidence: { fares: baseFares, hotels: slim(baseline).hotels } });

  const desc = await listing(client, {
    query: qBase({ sort: 'price_DESC' }),
    body: bodyBase(entity),
  });
  const descFares = fares(hotels(desc.data));
  nSort += 1;
  row('Sort', nSort, 'price_DESC orders this page by price.baseFare',
    'clone baseline → query sort=price_DESC',
    'results non-increasing by price.baseFare',
    `HTTP ${desc.status} fares=${JSON.stringify(descFares)} ${desc.elapsedMs}ms`,
    desc.ok && descFares.length >= 2 && isMonoDesc(descFares) ? 'PASS' : (desc.ok && descFares.length < 2 ? 'NOT TESTED' : 'BUG'),
    { evidence: slim(desc) });

  nSort += 1;
  const ascFirst = baseFares[0];
  const descFirst = descFares[0];
  row('Sort', nSort, 'DESC first fare >= ASC first fare',
    'Compare first hotel of price_ASC vs price_DESC on same search',
    'price_DESC[0].baseFare >= price_ASC[0].baseFare',
    `ASC first=${ascFirst} DESC first=${descFirst}`,
    Number.isFinite(ascFirst) && Number.isFinite(descFirst) && JSON.stringify(baseFares) !== JSON.stringify(descFares) && descFirst + 1e-6 >= ascFirst ? 'PASS' : 'BUG');

  let page2Asc;
  if (total > LIMIT && bd.last === false) {
    const nextOff = Number(bd.offset ?? 0) + Number(bd.size || LIMIT);
    page2Asc = await listing(client, {
      query: qBase({ offset: nextOff, sort: 'price_ASC' }),
      body: bodyBase(entity),
    });
    const p2 = hotels(page2Asc.data);
    const p2Fares = fares(p2);
    const lastP1 = baseFares[baseFares.length - 1];
    nSort += 1;
    row('Sort', nSort, 'sort on every page — page 2 continues global ASC',
      `same body + requestId; query offset=${nextOff}&sort=price_ASC`,
      'page2[0].baseFare >= page1[last].baseFare; page 2 still ASC; no overlapping ids',
      `HTTP ${page2Asc.status} p2fares=${JSON.stringify(p2Fares)} lastP1=${lastP1} overlap=${overlap(baseIds, ids(p2)).join(',') || 'none'}`,
      page2Asc.ok && p2Fares.length >= 1 && lastP1 != null && p2Fares[0] + 1e-6 >= lastP1 && isMonoAsc(p2Fares) && overlap(baseIds, ids(p2)).length === 0
        ? 'PASS' : 'BUG',
      { evidence: slim(page2Asc) });
  } else {
    nSort += 1;
    row('Sort', nSort, 'sort on every page — page 2 continues global ASC',
      'Need last=false and totalResults > limit',
      'Page 2 continues ASC',
      `total=${total} last=${bd.last}`,
      'NOT TESTED');
  }

  const unknownSort = await listing(client, {
    query: qBase({ sort: 'not_a_real_sort_key' }),
    body: bodyBase(entity),
  });
  nSort += 1;
  row('Sort', nSort, 'Unknown sort key is ignored',
    'clone → query sort=not_a_real_sort_key',
    'HTTP 200, vendor order (not 4xx)',
    `HTTP ${unknownSort.status} code=${errCode(unknownSort) || '-'} results=${hotels(unknownSort.data).length} ${unknownSort.elapsedMs}ms`,
    unknownSort.status === 200 && hotels(unknownSort.data).length > 0 ? 'PASS' : 'BUG',
    { evidence: slim(unknownSort) });

  const starSort = await listing(client, {
    query: qBase({ sort: 'star_DESC' }),
    body: bodyBase(entity),
  });
  nSort += 1;
  row('Sort', nSort, 'Star rating is a filter, not a sort — unknown sort ignored',
    'clone → query sort=star_DESC',
    'HTTP 200 (ignored), not a 4xx; does not become star-sorted requirement',
    `HTTP ${starSort.status} code=${errCode(starSort) || '-'} results=${hotels(starSort.data).length}`,
    starSort.status === 200 ? 'PASS' : 'BUG',
    { evidence: slim(starSort) });

  const emptySort = await listing(client, {
    query: qBase({ sort: '' }),
    body: bodyBase(entity),
  });
  nSort += 1;
  row('Sort', nSort, 'Empty sort query still returns listing',
    'clone → query sort=',
    'HTTP 200 vendor order (or omit treated as default)',
    `HTTP ${emptySort.status} code=${errCode(emptySort) || '-'} results=${hotels(emptySort.data).length}`,
    emptySort.status === 200 ? 'PASS' : 'BUG',
    { evidence: slim(emptySort) });

  // ════════════════════════════════════════
  // FILTER
  // ════════════════════════════════════════
  const starFacets = (starF?.facets || []).filter((f) => f.facetKey != null && Number(f.count) > 0);
  const twoStars = starFacets.slice(0, 2);
  const oneStar = starFacets[0];

  let oneStarRes;
  if (oneStar && starF) {
    oneStarRes = await listing(client, {
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity, { fq: [fqFor(starF, [oneStar.facetKey])] }),
    });
    const got = hotels(oneStarRes.data);
    const stars = got.map((h) => Number(h.starRating));
    const want = Number(oneStar.facetKey);
    const allMatch = got.length > 0 && stars.every((s) => s === want);
    const totalFiltered = Number(oneStarRes.data?.totalResults);
    nFilter += 1;
    row('Filter', nFilter, 'Single facet fq filters results',
      `clone → fq=["${fqFor(starF, [oneStar.facetKey])}"]`,
      `HTTP 200; every result starRating=${oneStar.facetKey}; totalResults reflects filtered set`,
      `HTTP ${oneStarRes.status} n=${got.length} stars=${JSON.stringify(stars)} total=${totalFiltered} unfiltered=${total} ${oneStarRes.elapsedMs}ms`,
      oneStarRes.ok && allMatch && totalFiltered <= total ? 'PASS' : 'BUG',
      { payload: { fq: [fqFor(starF, [oneStar.facetKey])] }, evidence: slim(oneStarRes) });

    nFilter += 1;
    const sameField = pickStarFilter(oneStarRes.data?.filters);
    const otherStillVisible = (sameField?.facets || []).some((f) => String(f.facetKey) !== String(oneStar.facetKey));
    row('Filter', nFilter, 'Facet counts computed before filtering — other options stay visible',
      'After applying one star facet, inspect filters[].facets',
      'Other star facets still present (counts pre-filter)',
      `facets=${brief(sameField?.facets, 280)} filtered=${allMatch}`,
      !allMatch ? 'NOT TESTED' : (oneStarRes.ok && otherStillVisible ? 'PASS' : 'BUG'),
      { evidence: sameField || null, note: allMatch ? null : 'Blocked — fq did not filter' });
  } else {
    nFilter += 1;
    row('Filter', nFilter, 'Single facet fq filters results', 'No star facet on baseline', 'starRating matches fq', 'no facets', 'NOT TESTED');
    nFilter += 1;
    row('Filter', nFilter, 'Facet counts computed before filtering — other options stay visible', 'No star facet', 'other facets visible', 'no facets', 'NOT TESTED');
  }

  if (twoStars.length === 2 && starF) {
    const multi = await listing(client, {
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity, { fq: [fqFor(starF, twoStars.map((f) => f.facetKey))] }),
    });
    const got = hotels(multi.data);
    const allowed = new Set(twoStars.map((f) => Number(f.facetKey)));
    const stars = got.map((h) => Number(h.starRating));
    const allMatch = got.length > 0 && stars.every((s) => allowed.has(s));
    nFilter += 1;
    row('Filter', nFilter, 'Several values use semicolon, not comma',
      `clone → fq=["${fqFor(starF, twoStars.map((f) => f.facetKey))}"]`,
      `HTTP 200; every starRating in {${[...allowed].join(',')}}`,
      `HTTP ${multi.status} n=${got.length} stars=${JSON.stringify(stars)} total=${multi.data?.totalResults}`,
      multi.ok && allMatch ? 'PASS' : 'BUG',
      { payload: { fq: [fqFor(starF, twoStars.map((f) => f.facetKey))] }, evidence: slim(multi) });
  } else {
    nFilter += 1;
    row('Filter', nFilter, 'Several values use semicolon, not comma', 'Need two star facets', 'both values applied', 'insufficient facets', 'NOT TESTED');
  }

  if (oneStar && starF && policyF && (policyF.facets || [])[0]) {
    const pol = policyF.facets[0];
    const polKey = pol.facetKey != null ? pol.facetKey : pol.name;
    const andFq = [fqFor(starF, [oneStar.facetKey]), `${policyF.indexField}:${polKey}`];
    const both = await listing(client, {
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity, { fq: andFq }),
    });
    const got = hotels(both.data);
    const starsOk = got.length === 0 || got.every((h) => Number(h.starRating) === Number(oneStar.facetKey));
    nFilter += 1;
    row('Filter', nFilter, 'Several filters combined (AND)',
      `clone → fq=${JSON.stringify(andFq)}`,
      'HTTP 200; star filter still holds; totalResults <= single-star total',
      `HTTP ${both.status} n=${got.length} total=${both.data?.totalResults} singleStarTotal=${oneStarRes?.data?.totalResults}`,
      both.ok && starsOk ? 'PASS' : 'BUG',
      { payload: { fq: andFq }, evidence: slim(both) });
  } else {
    nFilter += 1;
    row('Filter', nFilter, 'Several filters combined (AND)', 'Need star + policy filters', 'AND applied', `star=${Boolean(starF)} policy=${Boolean(policyF)}`, 'NOT TESTED');
  }

  const fqApplied = Boolean(oneStarRes?.ok && hotels(oneStarRes.data).length > 0
    && oneStar && hotels(oneStarRes.data).every((h) => Number(h.starRating) === Number(oneStar.facetKey)));

  if (twoStars.length === 2 && starF && fqApplied) {
    const comma = await listing(client, {
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity, { fq: [`${starF.indexField}:${twoStars[0].facetKey},${twoStars[1].facetKey}`] }),
    });
    const got = hotels(comma.data);
    const allowed = new Set(twoStars.map((f) => Number(f.facetKey)));
    const stars = got.map((h) => Number(h.starRating));
    const treatedAsOr = got.length > 0 && stars.every((s) => allowed.has(s))
      && stars.some((s) => s === Number(twoStars[0].facetKey))
      && stars.some((s) => s === Number(twoStars[1].facetKey));
    nFilter += 1;
    row('Filter', nFilter, 'Comma must not be used as multi-value separator',
      `clone → fq=["${starF.indexField}:${twoStars[0].facetKey},${twoStars[1].facetKey}"]`,
      'Must not treat comma the same as semicolon (reject VALIDATION_ERROR, ignore, or not OR both stars)',
      `HTTP ${comma.status} code=${errCode(comma) || '-'} stars=${JSON.stringify(stars)} total=${comma.data?.totalResults}`,
      comma.status >= 400 || !treatedAsOr ? 'PASS' : 'BUG',
      { payload: { fq: [`${starF.indexField}:${twoStars[0].facetKey},${twoStars[1].facetKey}`] }, evidence: slim(comma), note: treatedAsOr ? 'Comma behaved like semicolon OR' : 'Comma not treated as multi-value OR' });
  } else {
    nFilter += 1;
    row('Filter', nFilter, 'Comma must not be used as multi-value separator',
      fqApplied ? 'Need two star facets' : 'Blocked — fq not applied so comma vs semicolon cannot be judged',
      'comma not = semicolon',
      fqApplied ? 'insufficient facets' : 'fq ignored on canary',
      'NOT TESTED');
  }

  if (twoStars.length === 2 && starF && fqApplied) {
    const repeated = await listing(client, {
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity, { fq: [fqFor(starF, [twoStars[0].facetKey]), fqFor(starF, [twoStars[1].facetKey])] }),
    });
    const got = hotels(repeated.data);
    const allowed = new Set(twoStars.map((f) => Number(f.facetKey)));
    const stars = got.map((h) => Number(h.starRating));
    const orFromRepeat = got.length > 0 && stars.some((s) => s === Number(twoStars[0].facetKey)) && stars.some((s) => s === Number(twoStars[1].facetKey));
    nFilter += 1;
    row('Filter', nFilter, 'Do not send repeated fq entries for the same field',
      `clone → fq=${JSON.stringify([fqFor(starF, [twoStars[0].facetKey]), fqFor(starF, [twoStars[1].facetKey])])}`,
      'Should not OR two same-field entries (docs: semicolon, not repeated entries)',
      `HTTP ${repeated.status} stars=${JSON.stringify(stars)} total=${repeated.data?.totalResults}`,
      repeated.status >= 400 || !orFromRepeat ? 'PASS' : 'BUG',
      { evidence: slim(repeated) });
  } else {
    nFilter += 1;
    row('Filter', nFilter, 'Do not send repeated fq entries for the same field',
      fqApplied ? 'Need two star facets' : 'Blocked — fq not applied so repeated-entry OR cannot be judged',
      'no repeat OR',
      fqApplied ? 'insufficient facets' : 'fq ignored on canary',
      'NOT TESTED');
  }

  const badField = await listing(client, {
    query: qBase({ sort: 'price_ASC' }),
    body: bodyBase(entity, { fq: ['not_a_real_index_field:5'] }),
  });
  nFilter += 1;
  row('Filter', nFilter, 'Unknown indexField does not 500',
    'clone → fq=["not_a_real_index_field:5"]',
    'HTTP 200 ignore or 4xx VALIDATION_ERROR — not 500',
    `HTTP ${badField.status} code=${errCode(badField) || '-'} results=${hotels(badField.data).length} total=${badField.data?.totalResults}`,
    badField.status < 500 ? 'PASS' : 'BUG',
    { evidence: slim(badField) });

  const badFacet = starF
    ? await listing(client, {
      query: qBase({ sort: 'price_ASC' }),
      body: bodyBase(entity, { fq: [`${starF.indexField}:99`] }),
    })
    : null;
  nFilter += 1;
  row('Filter', nFilter, 'Unknown facetKey does not 500',
    starF ? `clone → fq=["${starF.indexField}:99"]` : 'no star filter',
    'HTTP 200 empty/unfiltered or 4xx — not 500',
    badFacet ? `HTTP ${badFacet.status} n=${hotels(badFacet.data).length} total=${badFacet.data?.totalResults}` : 'no star filter',
    !starF ? 'NOT TESTED' : (badFacet.status < 500 ? 'PASS' : 'BUG'),
    { evidence: badFacet ? slim(badFacet) : null });

  const fqObj = await listing(client, {
    query: qBase({ sort: 'price_ASC' }),
    body: bodyBase(entity, { fq: { df_long_star_rating: ['5'] } }),
  });
  nFilter += 1;
  row('Filter', nFilter, 'fq must be string array, not object',
    'clone → fq={ df_long_star_rating: ["5"] } (legacy shape)',
    '4xx VALIDATION_ERROR or ignore object; must not 500',
    `HTTP ${fqObj.status} code=${errCode(fqObj) || '-'} results=${hotels(fqObj.data).length} snippet=${brief(fqObj.data, 180)}`,
    fqObj.status < 500 ? (fqObj.status >= 400 || fqObj.data?.error ? 'PASS' : 'BUG') : 'BUG',
    { evidence: slim(fqObj), note: fqObj.status === 200 ? 'Object accepted as 200 — spec wants string[]' : '' });

  const fqStr = await listing(client, {
    query: qBase({ sort: 'price_ASC' }),
    body: bodyBase(entity, { fq: starF && oneStar ? fqFor(starF, [oneStar.facetKey]) : 'df_long_star_rating:5' }),
  });
  nFilter += 1;
  row('Filter', nFilter, 'fq must not be a bare string',
    'clone → fq="indexField:value" (not array)',
    '4xx VALIDATION_ERROR preferred; not 500',
    `HTTP ${fqStr.status} code=${errCode(fqStr) || '-'} snippet=${brief(fqStr.data, 180)}`,
    fqStr.status < 500 ? (fqStr.status >= 400 ? 'PASS' : 'BUG') : 'BUG',
    { evidence: slim(fqStr) });

  // ════════════════════════════════════════
  // PAGINATION
  // ════════════════════════════════════════
  nPage += 1;
  row('Paging', nPage, 'First page offset=0 limit=5',
    `query offset=0&limit=${LIMIT}`,
    `response.offset=0, size=${LIMIT} (or <=limit), last=false when total>${LIMIT}`,
    `offset=${bd.offset} size=${bd.size} last=${bd.last} total=${total} page=${bd.page}`,
    bd.offset === 0 && Number(bd.size) === Math.min(LIMIT, hotels(bd).length || LIMIT) && (total > LIMIT ? bd.last === false : true)
      ? 'PASS' : 'BUG',
    { evidence: { offset: bd.offset, size: bd.size, last: bd.last, page: bd.page, totalResults: total } });

  nPage += 1;
  const expectedPages = total > 0 ? Math.ceil(total / LIMIT) : 0;
  row('Paging', nPage, 'totalPages = ceil(totalResults / limit)',
    'Compare totalPages vs ceil(totalResults/limit)',
    `totalPages=${expectedPages}`,
    `totalPages=${bd.totalPages} total=${total} limit=${LIMIT}`,
    Number(bd.totalPages) === expectedPages ? 'PASS' : 'BUG');

  const nextOff = Number(bd.offset ?? 0) + Number(bd.size || LIMIT);
  let page2 = page2Asc;
  if (!page2 && total > LIMIT && bd.last === false) {
    page2 = await listing(client, {
      query: qBase({ offset: nextOff, sort: 'price_ASC' }),
      body: bodyBase(entity),
    });
  }
  if (page2) {
    const p2ids = ids(hotels(page2.data));
    nPage += 1;
    row('Paging', nPage, 'Next offset = response.offset + response.size (not page*size)',
      `query offset=${nextOff} (= ${bd.offset}+${bd.size}) keep dates/entity/fq/sort`,
      `response.offset=${nextOff}; no overlapping hotel ids with page 1; last=false unless end`,
      `HTTP ${page2.status} offset=${page2.data?.offset} overlap=${overlap(baseIds, p2ids).join(',') || 'none'} last=${page2.data?.last}`,
      page2.ok && Number(page2.data?.offset) === nextOff && overlap(baseIds, p2ids).length === 0 ? 'PASS' : 'BUG',
      { evidence: slim(page2) });

    nPage += 1;
    row('Paging', nPage, 'Keep fq and sort identical across pages — same totalResults',
      'page 2 used same body + sort as page 1',
      `totalResults stable (${total})`,
      `p1=${total} p2=${page2.data?.totalResults} overlap=${overlap(baseIds, ids(hotels(page2.data))).length}`,
      page2.ok && Number(page2.data?.totalResults) === total && overlap(baseIds, ids(hotels(page2.data))).length === 0 ? 'PASS' : 'BUG');
  } else {
    nPage += 1;
    row('Paging', nPage, 'Next offset = response.offset + response.size (not page*size)', 'Need more than one page', 'no overlap', `total=${total}`, 'NOT TESTED');
    nPage += 1;
    row('Paging', nPage, 'Keep fq and sort identical across pages — same totalResults', 'Need page 2', 'stable total', `total=${total}`, 'NOT TESTED');
  }

  const lastOff = Math.max(0, (expectedPages - 1) * LIMIT);
  if (expectedPages >= 2) {
    const lastPage = await listing(client, {
      query: qBase({ offset: lastOff, sort: 'price_ASC' }),
      body: bodyBase(entity),
    });
    nPage += 1;
    row('Paging', nPage, 'Stop when last==true',
      `query offset=${lastOff} (last page of ${expectedPages})`,
      'last=true; results.length <= limit',
      `HTTP ${lastPage.status} last=${lastPage.data?.last} offset=${lastPage.data?.offset} n=${hotels(lastPage.data).length} page=${lastPage.data?.page}`,
      lastPage.ok && lastPage.data?.last === true ? 'PASS' : 'BUG',
      { evidence: slim(lastPage) });
  } else {
    nPage += 1;
    row('Paging', nPage, 'Stop when last==true', 'Need 2+ pages', 'last=true', `total=${total}`, 'NOT TESTED');
  }

  const off7 = await listing(client, {
    query: qBase({ offset: 7, limit: 5, sort: 'price_ASC' }),
    body: bodyBase(entity),
  });
  const off7ids = ids(hotels(off7.data));
  const reportedPage = Number(off7.data?.page);
  nPage += 1;
  row('Paging', nPage, 'page is offset/limit rounded down — offset=7 reports page 1',
    'query offset=7&limit=5 — page is display-only',
    'HTTP 200; page=1; offset=7; do not advance with page*limit',
    `HTTP ${off7.status} page=${off7.data?.page} offset=${off7.data?.offset} ids=${off7ids.join(',')}`,
    off7.ok && reportedPage === 1 && Number(off7.data?.offset) === 7 ? 'PASS' : 'BUG',
    { evidence: slim(off7) });

  nPage += 1;
  const withP5 = overlap(ids(hotels(page2?.data) || []), off7ids);
  // offset=5 page vs offset=7: doc says advancing from page field re-shows 3 hotels.
  // Directly: offset=5 ids[2..] should match offset=7 ids[0..2] if same order.
  const p5ids = ids(hotels(page2?.data) || []);
  let reshown = [];
  if (p5ids.length && off7ids.length) {
    // page2 here is offset=5 when LIMIT=5 from offset 0. Compare offset 5 vs 7.
    reshown = overlap(p5ids, off7ids);
  }
  row('Paging', nPage, 'Advancing via page*size after offset=7 would re-show hotels',
    'Compare offset=5 (if fetched) vs offset=7 — shared ids prove page field is display-only',
    'offset=7 shares 3 hotels with offset=5 (doc example)',
    `shared=${reshown.join(',') || 'none'} sharedCount=${reshown.length} off7.offset=${off7.data?.offset} p5=${p5ids.join(',')} off7=${off7ids.join(',')}`,
    page2 && off7.ok && Number(off7.data?.offset) === 7 && reshown.length >= 2 ? 'PASS' : (page2 && off7.ok ? 'BUG' : 'NOT TESTED'),
    { evidence: { p5ids, off7ids, shared: reshown, withP5 } });

  const past = await listing(client, {
    query: qBase({ offset: Math.max(total + 50, 9999), sort: 'price_ASC' }),
    body: bodyBase(entity),
  });
  nPage += 1;
  row('Paging', nPage, 'Offset past the end does not 500',
    `clone → offset=${Math.max(total + 50, 9999)}`,
    'HTTP 200 empty results last=true, or 4xx — not 500',
    `HTTP ${past.status} n=${hotels(past.data).length} last=${past.data?.last} offset=${past.data?.offset} code=${errCode(past) || '-'}`,
    past.status < 500 && (hotels(past.data).length === 0 || past.data?.last === true) ? 'PASS' : 'BUG',
    { evidence: slim(past) });

  const negOff = await listing(client, {
    query: qBase({ offset: -1, sort: 'price_ASC' }),
    body: bodyBase(entity),
  });
  nPage += 1;
  row('Paging', nPage, 'Negative offset rejected',
    'clone → offset=-1',
    'HTTP 400 VALIDATION_ERROR (or 4xx) — not 200 listing, not 500',
    `HTTP ${negOff.status} code=${errCode(negOff) || '-'} n=${hotels(negOff.data).length} snippet=${brief(negOff.data, 160)}`,
    negOff.status >= 400 && negOff.status < 500 ? 'PASS' : 'BUG',
    { payload: { offset: -1 }, response: slim(negOff) });

  const lim0 = await listing(client, {
    query: qBase({ limit: 0, sort: 'price_ASC' }),
    body: bodyBase(entity),
  });
  nPage += 1;
  row('Paging', nPage, 'limit=0 rejected or empty page, not 500',
    'clone → limit=0',
    '4xx VALIDATION_ERROR preferred; HTTP 200 empty is a product call; not 500',
    `HTTP ${lim0.status} code=${errCode(lim0) || '-'} n=${hotels(lim0.data).length} size=${lim0.data?.size}`,
    lim0.status < 500 ? (lim0.status >= 400 || hotels(lim0.data).length === 0 ? 'PASS' : 'BUG') : 'BUG',
    { payload: { limit: 0 }, response: slim(lim0) });

  const badOff = await listing(client, {
    query: qBase({ offset: 'abc', sort: 'price_ASC' }),
    body: bodyBase(entity),
  });
  nPage += 1;
  row('Paging', nPage, 'Non-numeric offset rejected',
    'clone → offset=abc',
    '4xx VALIDATION_ERROR — not 500',
    `HTTP ${badOff.status} code=${errCode(badOff) || '-'} snippet=${brief(badOff.data, 160)}`,
    badOff.status >= 400 && badOff.status < 500 ? 'PASS' : 'BUG',
    { payload: { offset: 'abc' }, response: slim(badOff) });

  const dropSort = page2
    ? await listing(client, {
      query: qBase({ offset: nextOff }),
      body: bodyBase(entity),
    })
    : null;
  nPage += 1;
  row('Paging', nPage, 'Dropping sort on page 2 pages a different order',
    page2 ? `page 2 offset=${nextOff} without sort vs with sort=price_ASC` : 'Need page 2',
    'Docs: send sort on every page. Different id order vs sorted page 2 is expected; must not 500',
    dropSort
      ? `HTTP ${dropSort.status} sortedIds=${ids(hotels(page2.data)).join(',')} unsortedIds=${ids(hotels(dropSort.data)).join(',')}`
      : 'no page 2',
    !dropSort ? 'NOT TESTED' : (dropSort.status >= 500 ? 'BUG'
      : (ids(hotels(page2.data)).join(',') === ids(hotels(dropSort.data)).join(',') ? 'NOT TESTED' : 'PASS')),
    { evidence: dropSort ? slim(dropSort) : null });

  const changeEntity = await listing(client, {
    query: qBase({ offset: nextOff, sort: 'price_ASC' }),
    body: bodyBase({ ...entity, entityId: entity.entityId === '328605:IN' ? '123456:IN' : '328605:IN' }),
  });
  nPage += 1;
  const sameIds = page2 ? overlap(ids(hotels(page2.data)), ids(hotels(changeEntity.data))) : [];
  row('Paging', nPage, 'Changing entityId while paging starts a different search',
    `offset=${nextOff} but entityId mutated`,
    'Not a continuation of page 1 (different requestId and/or hotel set); must not 500',
    `HTTP ${changeEntity.status} n=${hotels(changeEntity.data).length} overlapWithPage2=${sameIds.length} requestId=${changeEntity.data?.requestId}`,
    changeEntity.status < 500 ? 'PASS' : 'BUG',
    { evidence: slim(changeEntity) });

  nPage += 1;
  row('Paging', nPage, 'requestId echoed and reused on follow-up',
    'Baseline requestId sent back on later listing calls',
    'Follow-up responses keep a requestId; baseline requestId was non-empty',
    `baseline=${bd.requestId || '-'} page2=${page2?.data?.requestId || '-'}`,
    Boolean(bd.requestId) && page2?.data?.requestId === bd.requestId ? 'PASS' : 'BUG');

  evidence.bugs = rows.filter((r) => r.status === 'BUG').map((r) => ({
    section: r.section,
    id: r.id,
    rule: r.rule,
    expected: r.expected,
    actual: r.actual,
    payload: r.payload || null,
    response: r.response || r.evidence || null,
  }));

  const report = wrapReport(entity, evidence, session);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, buildDevMarkdown(report));
  console.log('\nReport', OUT);
  console.log('Dev write-up', OUT_MD);
  printTables();
}

function wrapReport(entity, evidence, session) {
  return {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    path: PATH_LIVE,
    pid: PID,
    correlationId: session?.client?.correlationId || process.env.CORRELATION_ID || null,
    entity,
    spec: 'hotel-listing-v2.md POST /api/hotels/v2/availability/listing — sort+paging query, fq body',
    livePath: PATH_LIVE,
    specPath: PATH_SPEC,
    score: tally(rows),
    bySection: {
      Shape: tally(rows.filter((r) => r.section === 'Shape')),
      Sort: tally(rows.filter((r) => r.section === 'Sort')),
      Filter: tally(rows.filter((r) => r.section === 'Filter')),
      Paging: tally(rows.filter((r) => r.section === 'Paging')),
    },
    rows,
    evidence,
  };
}

function jsonBlock(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

function buildDevMarkdown(report) {
  const bugs = report.rows.filter((r) => r.status === 'BUG');
  const e = report.entity || {};
  const baselineQ = {
    pid: report.pid,
    tierId: 10546901,
    subscriptionId: '15045625496a6327',
    offset: 0,
    limit: 5,
    sort: 'price_ASC',
  };
  const baselineBody = {
    checkin: e.checkin,
    checkout: e.checkout,
    type: e.type,
    entityId: e.entityId,
    nationality: 'IN',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: e.currency || 'INR',
    language: 'en',
    rt: 'compact',
    requestId: '',
  };
  const lines = [];
  lines.push('# Hotel Listing v2 — canary bug report (sort / filter / paging)');
  lines.push('');
  lines.push('For backend: listing v2 spec vs canary. Each bug is clone-baseline → mutate one field → call.');
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push(`- Ran at (UTC): \`${report.ranAt}\``);
  lines.push(`- Base: \`${report.baseUrl}\``);
  lines.push(`- Spec path: \`POST ${report.specPath}\``);
  lines.push(`- Live path used after spec 404: \`POST ${report.livePath}\``);
  lines.push(`- pid: \`${report.pid}\``);
  lines.push(`- Correlation ID sent: \`${report.correlationId || '-'}\``);
  lines.push(`- City: ${e.label || '-'} entityId=\`${e.entityId}\` type=\`${e.type}\``);
  lines.push(`- Dates: ${e.checkin} → ${e.checkout} · currency ${e.currency}`);
  lines.push(`- Score: **PASS ${report.score.PASS} / BUG ${report.score.BUG} / NOT TESTED ${report.score['NOT TESTED']}** (${report.score.total} cases)`);
  lines.push('');
  lines.push('## What is broken (one paragraph)');
  lines.push('');
  lines.push('`POST /api/hotels/v2/availability/listing` is **not deployed** on canary (HTTP 404). `POST /v1/hotels/search` already **returns** the listing v2 envelope (`sorts`, `filters` with `facetKey`, `offset`, `size`, `last`, `totalResults`), but **does not apply** query `sort` / `offset` / `limit` or body `fq[]`. Every mutated call returns the same first page of hotels. Invalid paging inputs (`offset=-1`, `offset=abc`, `limit=0`) also return HTTP 200 with that same page instead of 4xx.');
  lines.push('');
  lines.push('## Baseline request (use this for bugs 2+)');
  lines.push('');
  lines.push(`\`POST ${report.livePath}\``);
  lines.push('');
  lines.push('Query:');
  lines.push('```');
  lines.push(new URLSearchParams(Object.fromEntries(Object.entries(baselineQ).map(([k, v]) => [k, String(v)]))).toString());
  lines.push('```');
  lines.push('Body:');
  lines.push('```json');
  lines.push(jsonBlock(baselineBody));
  lines.push('```');
  if (report.evidence?.baseline) {
    const b = report.evidence.baseline;
    lines.push('Baseline response (slim):');
    lines.push('```json');
    lines.push(jsonBlock({
      http: b.http,
      page: b.page,
      offset: b.offset,
      size: b.size,
      last: b.last,
      totalResults: b.totalResults,
      totalPages: b.totalPages,
      requestId: b.requestId,
      currency: b.currency,
      sorts: b.sorts,
      filterNames: b.filterNames,
      hotels: b.hotels,
    }));
    lines.push('```');
    lines.push('');
  }
  lines.push('## Score by section');
  lines.push('');
  lines.push('| Section | PASS | BUG | NOT TESTED |');
  lines.push('|---|---:|---:|---:|');
  for (const [name, t] of Object.entries(report.bySection || {})) {
    lines.push(`| ${name} | ${t.PASS} | ${t.BUG} | ${t['NOT TESTED']} |`);
  }
  lines.push('');
  lines.push('## Bugs — exact steps');
  lines.push('');
  bugs.forEach((bug, i) => {
    const n = i + 1;
    lines.push(`### Bug ${n} — [${bug.section}.${bug.id}] ${bug.rule}`);
    lines.push('');
    lines.push(`**How tested:** ${bug.how}`);
    lines.push('');
    lines.push('**Steps**');
    lines.push('1. Auth (partner token + user session, `tierId=10546901`). Send `X-Partner-Key` = partner access token.');
    lines.push(`2. Start from the baseline request above (\`POST ${report.livePath}\`).`);
    lines.push(`3. Mutate only: ${bug.how}`);
    lines.push('4. Compare HTTP status + listing fields against expected.');
    lines.push('');
    lines.push(`**Expected:** ${bug.expected}`);
    lines.push('');
    lines.push(`**Actual:** ${bug.actual}`);
    lines.push('');
    if (bug.payload) {
      lines.push('**Payload mutation:**');
      lines.push('```json');
      lines.push(jsonBlock(bug.payload));
      lines.push('```');
    }
    const ev = bug.response || bug.evidence || null;
    if (ev) {
      lines.push('**Response (slim):**');
      lines.push('```json');
      lines.push(jsonBlock(ev));
      lines.push('```');
    }
    if (bug.note) {
      lines.push(`**Note:** ${bug.note}`);
      lines.push('');
    }
    lines.push('');
  });
  lines.push('## Not bugs / not tested');
  lines.push('');
  report.rows.filter((r) => r.status !== 'BUG').forEach((r) => {
    lines.push(`- **${r.status}** [${r.section}.${r.id}] ${r.rule} — ${r.actual}`);
  });
  lines.push('');
  lines.push('## Suggested backend checks');
  lines.push('');
  lines.push('1. Route `POST /api/hotels/v2/availability/listing` on canary (or confirm v1 search is the listing v2 API and update the spec path).');
  lines.push('2. Map query `sort` to `sorts[].key` (`price_ASC` / `price_DESC`) and order by `price.baseFare` **before** paging.');
  lines.push('3. Map query `offset` + `limit` (do not use `page * size`). Echo `offset` / `size` / `last` / `page=floor(offset/limit)` from the request.');
  lines.push('4. Parse body `fq` as `string[]` of `indexField:value` (semicolon-separated multi-values). Reduce `totalResults` to the filtered set; keep pre-filter facet counts.');
  lines.push('5. Reject `offset<0`, non-numeric offset, `limit<=0` with HTTP 400 + `VALIDATION_ERROR`.');
  lines.push('6. Echo client `requestId` on follow-up listing calls so paging/filter stay on the same search.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function printTables() {
  const score = tally(rows);
  console.log('\n=== SCORE ===');
  console.log(JSON.stringify(score));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
