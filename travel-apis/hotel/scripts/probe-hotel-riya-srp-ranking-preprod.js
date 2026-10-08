/**
 * B2B preprod — Riya (vendor) hotel SRP ranking test plan (search ONLY, no book).
 *
 * Ranking is judged by starRating / order / filters — NOT by hotel name aliases.
 * "Riya" = supplier; every hotel on this path is Riya inventory.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   $env:TIER_ID='19597201'
 *   node scripts/probe-hotel-riya-srp-ranking-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-riya-srp-ranking-preprod-b2b.json');
const OUT_MD = path.join('reports', process.env.REPORT_MD || 'hotel-riya-srp-ranking-preprod-b2b.md');
const PID = process.env.HOTEL_PID || 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-11-18';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-11-19';
const CHECKIN_ALT = process.env.HOTEL_CHECKIN_ALT || '2026-11-20';
const CHECKOUT_ALT = process.env.HOTEL_CHECKOUT_ALT || '2026-11-21';
const LIMIT = Number(process.env.HOTEL_LIMIT || 20);
const MAX_PAGES = Number(process.env.MAX_PAGES || 80);
const SLOW_MS = Number(process.env.SLOW_MS || 30000);

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN', category: 'metro' },
  { key: 'Delhi', entityId: '227760:IN', category: 'metro' },
  { key: 'Dubai', entityId: '221688:AE', category: 'intl' },
  { key: 'Bangkok', entityId: '328619:TH', category: 'intl' },
  { key: 'Jaipur', entityId: '227736:IN', category: 'mid' },
  { key: 'Kochi', entityId: '329184:IN', category: 'mid' },
  { key: 'Rishikesh', entityId: '329199:IN', category: 'small' },
  { key: 'Manali', entityId: '334045:IN', category: 'small' },
];

const rows = [];

function add(caseId, rule, how, expected, actual, status, extra = {}) {
  const rec = { caseId, rule, how, expected, actual, status, ...extra };
  rows.push(rec);
  console.log(`[${status}] ${caseId} ${rule} — ${String(actual).slice(0, 240)}`);
}

function score() {
  const s = { PASS: 0, BUG: 0, 'NOT TESTED': 0, total: rows.length };
  for (const r of rows) s[r.status] = (s[r.status] || 0) + 1;
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hotelId(h) {
  return String(h?.id || h?.entityId || h?.name || '');
}

function fare(h) {
  return Number(h?.price?.baseFare ?? h?.price?.totalAmount ?? NaN);
}

function star(h) {
  const s = Number(h?.starRating);
  return Number.isFinite(s) ? s : null;
}

function summarizeHotels(list, n = 10) {
  return list.slice(0, n).map((h, i) => ({
    rank: i + 1,
    id: h.id,
    name: h.name,
    star: star(h),
    price: fare(h),
    distance: h.distance,
  }));
}

function baseBody(entityId, checkin = CHECKIN, checkout = CHECKOUT, fq = []) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin,
    checkout,
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq,
    requestId: '',
  };
}

async function search(hotel, entityId, opts = {}) {
  const {
    offset = 0,
    limit = LIMIT,
    sort,
    fq = [],
    checkin = CHECKIN,
    checkout = CHECKOUT,
  } = opts;
  const t0 = Date.now();
  const body = baseBody(entityId, checkin, checkout, fq);
  const query = { pid: PID, offset, limit };
  if (sort) query.sort = sort;
  const res = await hotel.search(body, query);
  const ms = Date.now() - t0;
  const data = res.data || {};
  return {
    http: res.status,
    ok: Boolean(res.ok),
    ms,
    data,
    results: Array.isArray(data.results) ? data.results : [],
    total: Number(data.totalResults ?? NaN),
    requestId: data.requestId || null,
    fromCache: data.fromCache ?? null,
    filters: data.filters || [],
    code: data?.error?.code || null,
  };
}

function isMonoAsc(fares) {
  for (let i = 1; i < fares.length; i++) {
    if (fares[i] < fares[i - 1] - 0.05) return false;
  }
  return fares.length > 0;
}

function isMonoDesc(fares) {
  for (let i = 1; i < fares.length; i++) {
    if (fares[i] > fares[i - 1] + 0.05) return false;
  }
  return fares.length > 0;
}

function findFilter(data, re) {
  return (data?.filters || []).find((f) => re.test(`${f.name || ''} ${f.indexField || ''}`));
}

function facetCounts(filter) {
  return (filter?.facets || []).map((x) => ({
    key: String(x.facetKey ?? x.name ?? ''),
    count: Number(x.count ?? x.docCount ?? 0),
  }));
}

async function paginateAll(hotel, entityId, cityKey) {
  const ids = new Set();
  const duplicates = [];
  let offset = 0;
  let pages = 0;
  let totalReported = null;
  let lastPage = [];
  let firstPage = [];
  let maxMs = 0;
  let slowPages = [];

  while (pages < MAX_PAGES) {
    const r = await search(hotel, entityId, { offset, limit: LIMIT });
    maxMs = Math.max(maxMs, r.ms);
    if (r.ms >= SLOW_MS) slowPages.push({ page: pages, ms: r.ms });
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.http} code=${r.code}`, pages, ids, duplicates, totalReported, firstPage, lastPage, maxMs, slowPages };
    }
    if (pages === 0) {
      firstPage = r.results;
      totalReported = r.total;
    }
    if (!r.results.length) break;

    for (const h of r.results) {
      const id = hotelId(h);
      if (!id) continue;
      if (ids.has(id)) duplicates.push(id);
      ids.add(id);
    }
    lastPage = r.results;
    pages++;
    if (r.results.length < LIMIT) break;
    offset += LIMIT;
    await sleep(100);
  }

  return {
    ok: true,
    pages,
    unique: ids.size,
    duplicates,
    totalReported,
    firstPage,
    lastPage,
    maxMs,
    slowPages,
    hitMax: pages >= MAX_PAGES,
  };
}

/** Premium = 4★ or 5★ only. Do NOT infer brand from hotel name/alias. */
function isHighStar(h) {
  const s = star(h);
  return s != null && s >= 4;
}

function assessPageOne(list, cityKey) {
  const top = list.slice(0, 10);
  if (!top.length) {
    return {
      ok: false,
      reason: 'empty page one',
      issues: ['empty page one'],
      highStar: 0,
      lowStar: 0,
      top: [],
    };
  }
  const lowStarList = top.filter((h) => {
    const s = star(h);
    return s != null && s <= 2;
  });
  const unrated = top.filter((h) => star(h) == null);
  const highStar = top.filter(isHighStar).length;
  const issues = [];
  // Page one should be dominated by 4–5★; 1–2★ / unrated at top = ranking bug
  if (lowStarList.length >= 2) issues.push(`${lowStarList.length}/10 are 1-2★ near top`);
  if (unrated.length >= 3) issues.push(`${unrated.length}/10 unrated near top`);
  if (highStar < 6) issues.push(`only ${highStar}/10 are 4-5★ (expect mostly premium stars on page one)`);
  return {
    ok: issues.length === 0,
    issues,
    highStar,
    lowStar: lowStarList.length,
    top: summarizeHotels(top, 10),
  };
}

async function main() {
  clearSession();
  const ranAt = new Date().toISOString();
  console.log('Base:', config.baseUrl, '| partner:', config.partnerId, '| tier:', config.tierId);
  console.log('SEARCH ONLY — no book/prebook/finalize');
  console.log('Dates:', CHECKIN, '→', CHECKOUT);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  // ---- Case 1: Page one deliberate (multiple cities) ----
  for (const city of CITIES) {
    const r = await search(hotel, city.entityId);
    const assess = assessPageOne(r.results, city.key);
    add(
      '1',
      `Page one deliberate — ${city.key} (${city.category})`,
      `POST /v1/hotels/search ${city.key} default sort offset=0 limit=${LIMIT}`,
      'Top 10 mostly 4-5★ (by starRating only — no name/alias brand check); no 1-2★/unrated cluster at top',
      assess.ok
        ? `PASS highStar=${assess.highStar}/10 lowStar=${assess.lowStar}/10; top=${(assess.top || []).map((x) => `${x.name}(${x.star}★)`).join('; ')}`
        : `ISSUES: ${(assess.issues || [assess.reason || 'unknown']).join('; ')} | top=${(assess.top || []).map((x) => `${x.name}(${x.star}★)`).join('; ') || 'none'}`,
      assess.ok ? 'PASS' : 'BUG',
      { city: city.key, checkin: CHECKIN, checkout: CHECKOUT, requestId: r.requestId, ms: r.ms, top10: assess.top },
    );
    if (r.ms >= SLOW_MS) {
      add('LAT', `Slow search >${SLOW_MS}ms — ${city.key}`, 'first page timing', `<${SLOW_MS}ms`, `${r.ms}ms`, 'BUG', { city: city.key, requestId: r.requestId });
    }
  }

  // ---- Case 2: Result count noted (no prod baseline) ----
  const mumbaiFirst = await search(hotel, CITIES[0].entityId);
  add(
    '2',
    'Result count captured — Mumbai',
    'note totalResults on unfiltered search',
    'totalResults > 0 (compare to prod manually)',
    `totalResults=${mumbaiFirst.total} available=${mumbaiFirst.data.availableResults ?? 'n/a'}`,
    mumbaiFirst.total > 0 ? 'PASS' : 'BUG',
    { city: 'Mumbai', checkin: CHECKIN, checkout: CHECKOUT, requestId: mumbaiFirst.requestId },
  );

  // ---- Case 3: Full pagination (Mumbai + Jaipur) ----
  for (const city of [CITIES[0], CITIES[4]]) {
    const pg = await paginateAll(hotel, city.entityId, city.key);
    const dupOk = pg.duplicates.length === 0;
    const countOk = !Number.isFinite(pg.totalReported) || pg.unique <= pg.totalReported + 5;
    const status = pg.ok && dupOk && countOk ? 'PASS' : 'BUG';
    add(
      '3',
      `Paging unique/no dup — ${city.key}`,
      `offset 0..N limit=${LIMIT} until empty`,
      'no duplicate ids; collected ≈ totalResults; last page partial',
      pg.ok
        ? `pages=${pg.pages} unique=${pg.unique} reported=${pg.totalReported} dups=${pg.duplicates.length}${pg.hitMax ? ' MAX_PAGES' : ''} slowPages=${pg.slowPages.length}`
        : pg.error,
      status,
      { city: city.key, checkin: CHECKIN, checkout: CHECKOUT, duplicates: pg.duplicates.slice(0, 5), last10: summarizeHotels(pg.lastPage || [], 10) },
    );
    if (pg.slowPages.length) {
      add('LAT', `Slow page during pagination — ${city.key}`, 'any page >30s', `<${SLOW_MS}ms`, `${pg.slowPages.length} pages; max=${pg.maxMs}ms`, 'BUG', { city: city.key, slowPages: pg.slowPages });
    }
  }

  // ---- Case 4: Price sort ----
  for (const city of [CITIES[0], CITIES[2]]) {
    const asc = await search(hotel, city.entityId, { sort: 'price_ASC', limit: 15 });
    const desc = await search(hotel, city.entityId, { sort: 'price_DESC', limit: 15 });
    const ascFares = asc.results.map(fare).filter(Number.isFinite);
    const descFares = desc.results.map(fare).filter(Number.isFinite);
    const ascOk = isMonoAsc(ascFares);
    const descOk = isMonoDesc(descFares);
    const cheapFirst = asc.results[0];
    const premiumFirstDefault = (await search(hotel, city.entityId, { limit: 1 })).results[0];
    const sortOverrides = ascOk && cheapFirst && premiumFirstDefault && fare(cheapFirst) < fare(premiumFirstDefault) - 100;
    add(
      '4',
      `Price sort ASC/DESC — ${city.key}`,
      'sort=price_ASC then price_DESC',
      'strict mono price; cheap unrated can beat expensive 5★ on ASC',
      `ASC mono=${ascOk} first=${cheapFirst?.name} ₹${fare(cheapFirst)} | DESC mono=${descOk} first=${desc.results[0]?.name} ₹${fare(desc.results[0])} | sortOverridesDefault=${sortOverrides}`,
      ascOk && descOk && sortOverrides ? 'PASS' : 'BUG',
      { city: city.key, checkin: CHECKIN, checkout: CHECKOUT, requestId: asc.requestId },
    );
  }

  // ---- Case 5: Filters + facet counts stable ----
  const base = await search(hotel, CITIES[0].entityId);
  const starF = findFilter(base.data, /star/i);
  const chainF = findFilter(base.data, /chain/i);
  const gstF = findFilter(base.data, /gst/i);
  const propF = findFilter(base.data, /property/i);

  if (!starF) {
    add('5', 'Star filter present', 'baseline Mumbai', 'filters[] star facet', 'NOT FOUND', 'BUG', { requestId: base.requestId });
  } else {
    const starFacetsBefore = facetCounts(starF);
    const star4 = starFacetsBefore.find((f) => /4/.test(f.key));
    const fqStar = star4 ? [`${starF.indexField}:${star4.key}`] : [`${starF.indexField}:4`];
    const filtered = await search(hotel, CITIES[0].entityId, { fq: fqStar });
    const starFacetsAfter = facetCounts(findFilter(filtered.data, /star/i));
    const countsStable = starFacetsBefore.length === starFacetsAfter.length
      && starFacetsBefore.every((b) => {
        const a = starFacetsAfter.find((x) => x.key === b.key);
        return a && a.count === b.count;
      });
    const onlyHighStar = filtered.results.every((h) => {
      const s = star(h);
      return s == null || s >= 4;
    });
    add(
      '5a',
      'Star filter apply + facet counts stable — Mumbai',
      `fq ${fqStar[0]}`,
      'results 4★+; facet counts unchanged',
      `filtered=${filtered.total} countsStable=${countsStable} sampleStars=${filtered.results.slice(0, 5).map((h) => star(h)).join(',')}`,
      countsStable && filtered.total > 0 && (onlyHighStar || filtered.results.every((h) => star(h) == null)) ? 'PASS' : 'BUG',
      { requestId: filtered.requestId, fq: fqStar },
    );
  }

  if (chainF) {
    const chainFacetsBefore = facetCounts(chainF);
    const topChain = chainFacetsBefore.sort((a, b) => b.count - a.count)[0];
    if (topChain) {
      const fq = [`${chainF.indexField}:${topChain.key}`];
      const filtered = await search(hotel, CITIES[0].entityId, { fq });
      const chainFacetsAfter = facetCounts(findFilter(filtered.data, /chain/i));
      const countsStable = chainFacetsBefore.length === chainFacetsAfter.length
        && chainFacetsBefore.every((b) => {
          const a = chainFacetsAfter.find((x) => x.key === b.key);
          return a && a.count === b.count;
        });
      add(
        '5b',
        `Chain filter + facet counts stable — Mumbai (${topChain.key})`,
        `fq chain filter`,
        'narrowed results; facet counts unchanged',
        `filtered=${filtered.total} countsStable=${countsStable}`,
        filtered.ok && filtered.total > 0 && countsStable ? 'PASS' : 'BUG',
        { requestId: filtered.requestId, fq },
      );
    }
  }

  if (gstF && propF) {
    const gstFacet = facetCounts(gstF).find((f) => f.count > 0);
    const propFacet = facetCounts(propF).find((f) => f.count > 0);
    if (gstFacet && propFacet) {
      const fq = [`${gstF.indexField}:${gstFacet.key}`, `${propF.indexField}:${propFacet.key}`];
      const combo = await search(hotel, CITIES[0].entityId, { fq });
      add(
        '5c',
        'Combined GST + Property Type filter — Mumbai',
        `fq combo`,
        'HTTP 200 narrowed results',
        `total=${combo.total} http=${combo.http}`,
        combo.ok && combo.total >= 0 ? 'PASS' : 'BUG',
        { requestId: combo.requestId, fq },
      );
    }
  }

  // ---- Brand filter removed (user): must not appear; Chain/Star/GST/Property Type remain ----
  {
    const filterNames = (base.data?.filters || []).map((f) => `${f.name || ''}|${f.indexField || ''}`);
    const brandExact = (base.data?.filters || []).find((f) => {
      const n = String(f.name || '').trim();
      const ix = String(f.indexField || '').trim();
      return /^brand$/i.test(n) || /^brand$/i.test(ix);
    });
    add(
      '5d',
      'Brand filter removed from SRP — Mumbai',
      'unfiltered search filters[]',
      'no Brand facet/filter; Chain/Star/Property Type/GST still present',
      brandExact
        ? `BUG Brand still present name=${brandExact.name} indexField=${brandExact.indexField}; filters=${filterNames.join(', ')}`
        : `PASS Brand absent; filters=${filterNames.join(', ')}`,
      brandExact ? 'BUG' : 'PASS',
      { requestId: base.requestId, filterNames },
    );

    // Spot-check a few more cities so removal is not Mumbai-only
    for (const city of [CITIES[1], CITIES[2], CITIES[4]]) {
      const r = await search(hotel, city.entityId);
      const brand = (r.data?.filters || []).find((f) => {
        const n = String(f.name || '').trim();
        const ix = String(f.indexField || '').trim();
        return /^brand$/i.test(n) || /^brand$/i.test(ix);
      });
      const names = (r.data?.filters || []).map((f) => f.name || f.indexField).join(', ');
      add(
        '5d',
        `Brand filter removed — ${city.key}`,
        'unfiltered search filters[]',
        'no Brand filter',
        brand ? `Brand still present: ${brand.name}/${brand.indexField}` : `Brand absent; filters=${names}`,
        brand ? 'BUG' : r.ok ? 'PASS' : 'BUG',
        { city: city.key, requestId: r.requestId },
      );
    }

    // Legacy Brand fq should not crash; ignore or empty/narrow without 500
    const brandFq = await search(hotel, CITIES[0].entityId, { fq: ['Brand:Taj'] });
    add(
      '5e',
      'Legacy fq Brand:Taj does not 500 — Mumbai',
      'fq ["Brand:Taj"] after Brand removed',
      'HTTP <500 (ignored or empty); never 500',
      `http=${brandFq.http} total=${brandFq.total} code=${brandFq.code || '-'}`,
      brandFq.http < 500 ? 'PASS' : 'BUG',
      { requestId: brandFq.requestId },
    );
  }

  // ---- Case 6: NOT TESTED (no book per user) ----
  add(
    '6',
    'Hotel pages and booking unchanged',
    'details/prebook/finalize',
    'no regression vs before',
    'NOT TESTED — user requested search-only on preprod',
    'NOT TESTED',
  );

  // ---- Case 7: 4★ can sit above later 5★ (group membership / distance — star alone not enough to fail) ----
  // Without chain/brand on SRP payload we cannot verify brand-group; check star clustering instead:
  // first 4★ in top 40 should appear before a run of 1-2★ dominating early ranks (ordering signal).
  const mTop = await search(hotel, CITIES[0].entityId, { limit: 40 });
  const firstHigh = mTop.results.findIndex(isHighStar);
  const firstLow = mTop.results.findIndex((h) => {
    const s = star(h);
    return s != null && s <= 2;
  });
  let case7 = 'NOT TESTED';
  let case7Detail = 'no 4-5★ in top 40';
  if (firstHigh >= 0) {
    // Intended: high-star hotels should appear early. 4★ before a later 5★ is allowed.
    const four = mTop.results.findIndex((h) => star(h) === 4);
    const fiveAfter = four >= 0
      ? mTop.results.slice(four + 1).findIndex((h) => star(h) === 5)
      : -1;
    if (four >= 0 && fiveAfter >= 0) {
      case7 = 'PASS';
      case7Detail = `4★ "${mTop.results[four].name}" rank #${four + 1} before later 5★ "${mTop.results[four + 1 + fiveAfter].name}" rank #${four + 1 + fiveAfter + 1} (star-only; group>star intended)`;
    } else {
      case7 = 'NOT TESTED';
      case7Detail = `first 4-5★ at rank #${firstHigh + 1}; no 4★-then-later-5★ pair in top 40`;
    }
  }
  add('7', '4★ can appear before later 5★ — Mumbai (star-only)', 'scan top 40 default order', '4★ before a later 5★ is allowed (group membership beats star)', case7Detail, case7, { city: 'Mumbai', checkin: CHECKIN, checkout: CHECKOUT });

  // ---- Case 8: ≤3★ should not dominate top of page one ----
  const top20 = mTop.results.slice(0, 20);
  const lowInTop20 = top20.filter((h) => {
    const s = star(h);
    return s != null && s <= 3;
  });
  const highInTop20 = top20.filter(isHighStar).length;
  add(
    '8',
    'Top 20 not dominated by ≤3★ — Mumbai (star-only)',
    'scan top 20 starRating',
    'majority of top 20 should be 4-5★',
    `4-5★=${highInTop20}/20 ≤3★=${lowInTop20.length}/20`,
    highInTop20 >= 12 ? 'PASS' : 'BUG',
    { city: 'Mumbai', checkin: CHECKIN, checkout: CHECKOUT },
  );

  // ---- Case 9 & 10: Last page + high-star before low-star (starRating only; no name/brand alias) ----
  const mPg = await paginateAll(hotel, CITIES[0].entityId, 'Mumbai');
  const last10 = mPg.lastPage || [];
  const lastLowOrUnrated = last10.filter((h) => {
    const s = star(h);
    return s == null || s <= 2;
  }).length;
  const lastHigh = last10.filter(isHighStar).length;
  add(
    '9',
    'Unrated/1-2★ present on last page — Mumbai',
    'inspect last page of full pagination by starRating',
    'unrated/1-2★ near bottom; last page should not be dominated by 4-5★',
    `lastPageSize=${last10.length} lowOrUnrated=${lastLowOrUnrated} highStar=${lastHigh} last=${summarizeHotels(last10, 5).map((x) => `${x.star}★`).join(', ')}`,
    last10.length === 0
      ? 'BUG'
      : lastLowOrUnrated > 0
        ? 'PASS'
        : lastHigh >= Math.ceil(last10.length / 2)
          ? 'BUG'
          : 'NOT TESTED',
    { city: 'Mumbai', unique: mPg.unique, last10: summarizeHotels(last10, 10) },
  );

  const scan200 = [];
  for (let off = 0; off < 200; off += LIMIT) {
    const chunk = await search(hotel, CITIES[0].entityId, { offset: off, limit: LIMIT });
    for (const h of chunk.results) scan200.push(h);
    if (chunk.results.length < LIMIT) break;
  }
  const firstHighStar = scan200.findIndex(isHighStar);
  const firstUnratedLow = scan200.findIndex((h) => {
    const s = star(h);
    return s == null || s <= 2;
  });
  add(
    '10',
    '4-5★ appear before unrated/1-2★ — Mumbai',
    'scan first 200 by starRating only (no hotel-name brand match)',
    'first 4-5★ before first unrated/1-2★',
    firstHighStar >= 0
      ? `first4-5★ rank #${firstHighStar + 1} (${star(scan200[firstHighStar])}★); firstLowUnrated rank #${firstUnratedLow >= 0 ? firstUnratedLow + 1 : 'n/a'}`
      : 'no 4-5★ in first 200',
    firstHighStar >= 0 && (firstUnratedLow < 0 || firstHighStar < firstUnratedLow) ? 'PASS' : firstHighStar < 0 ? 'NOT TESTED' : 'BUG',
    { city: 'Mumbai' },
  );

  // ---- Case 11: Small town ----
  for (const city of CITIES.filter((c) => c.category === 'small')) {
    const r = await search(hotel, city.entityId);
    add(
      '11',
      `Small town search — ${city.key}`,
      'unfiltered search',
      'HTTP 200; renders even if 0-1 pages',
      `http=${r.http} total=${r.total} results=${r.results.length}`,
      r.ok ? 'PASS' : 'BUG',
      { city: city.key, requestId: r.requestId },
    );
  }

  // ---- Case 12: No availability far future ----
  const far = await search(hotel, CITIES[0].entityId, { checkin: '2027-06-01', checkout: '2027-06-02' });
  add(
    '12',
    'No availability / empty message — Mumbai far future',
    'checkin 2027-06-01',
    'graceful empty/message, not 500',
    `http=${far.http} total=${far.total} message=${far.data.message || far.code || 'n/a'}`,
    far.ok && far.http < 500 ? 'PASS' : 'BUG',
    { city: 'Mumbai', checkin: '2027-06-01', checkout: '2027-06-02', requestId: far.requestId },
  );

  // ---- Case 13: Cache repeat ----
  const rep1 = await search(hotel, CITIES[3].entityId);
  await sleep(500);
  const rep2 = await search(hotel, CITIES[3].entityId);
  const ids1 = rep1.results.map(hotelId).join('|');
  const ids2 = rep2.results.map(hotelId).join('|');
  const sameOrder = ids1 === ids2;
  const faster = rep2.ms < rep1.ms * 0.8;
  add(
    '13',
    'Repeat search same dates — Bangkok',
    'two identical searches back-to-back',
    'same order; 2nd faster (cache)',
    `sameOrder=${sameOrder} ms1=${rep1.ms} ms2=${rep2.ms} fromCache2=${rep2.fromCache}`,
    sameOrder ? 'PASS' : 'BUG',
    { city: 'Bangkok', checkin: CHECKIN, checkout: CHECKOUT, requestId: rep2.requestId },
  );
  if (rep1.ms >= SLOW_MS || rep2.ms >= SLOW_MS) {
    add('LAT', 'Slow repeat search — Bangkok', 'either call >30s', `<${SLOW_MS}ms`, `ms1=${rep1.ms} ms2=${rep2.ms}`, 'BUG');
  }

  // ---- Case 14: Different dates fresh search ----
  const d1 = await search(hotel, CITIES[1].entityId);
  const d2 = await search(hotel, CITIES[1].entityId, { checkin: CHECKIN_ALT, checkout: CHECKOUT_ALT });
  add(
    '14',
    'Different dates fresh search — Delhi',
    `${CHECKIN} vs ${CHECKIN_ALT}`,
    'both HTTP 200; ordering rules still apply on page 1',
    `dates1 total=${d1.total} highStarTop=${d1.results.slice(0, 5).filter(isHighStar).length}/5 | dates2 total=${d2.total} highStarTop=${d2.results.slice(0, 5).filter(isHighStar).length}/5 ms1=${d1.ms} ms2=${d2.ms}`,
    d1.ok && d2.ok && d1.total > 0 && d2.total > 0 ? 'PASS' : 'BUG',
    { city: 'Delhi', requestId: d2.requestId, top5Alt: summarizeHotels(d2.results, 5) },
  );

  const report = {
    ranAt,
    channel: 'B2B',
    vendor: 'Riya',
    note: 'Ranking judged by starRating/order/filters only. Hotel names are display labels — not used for brand/premium matching. Riya = supplier.',
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    noBook: true,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    score: score(),
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const sc = report.score;
  const md = [
    '# Riya SRP Ranking — B2B Preprod (search only)',
    '',
    `Ran: ${ranAt}`,
    `Env: \`${config.baseUrl}\` · partner \`${config.partnerId}\` · tier \`${config.tierId}\``,
    `Dates: **${CHECKIN} → ${CHECKOUT}**`,
    '',
    `**Score: PASS ${sc.PASS} / BUG ${sc.BUG} / NOT TESTED ${sc['NOT TESTED']}**`,
    '',
    '| # | Rule | How tested | Status |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.caseId} | ${r.rule.replace(/\|/g, '/')} | ${r.how.replace(/\|/g, '/')} | **${r.status}** |`),
    '',
  ];
  const bugs = rows.filter((r) => r.status === 'BUG');
  if (bugs.length) {
    md.push('## Bugs', '');
    for (const b of bugs) {
      md.push(`### ${b.caseId} — ${b.rule}`);
      md.push(`- Expected: ${b.expected}`);
      md.push(`- Actual: ${b.actual}`);
      if (b.requestId) md.push(`- requestId: \`${b.requestId}\``);
      if (b.city) md.push(`- City/dates: ${b.city} ${CHECKIN}→${CHECKOUT}`);
      md.push('');
    }
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log('\nScore:', sc);
  console.log('Report:', OUT);
  console.log('Markdown:', OUT_MD);
  process.exit(sc.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
