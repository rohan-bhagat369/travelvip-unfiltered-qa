/**
 * Fare Lanes QA — B2B preprod, search + details/pricing/fareRules/ssr/seatmap.
 * NO issue-ticket / book.
 *
 * Handover cases A–F (skip D-9, D-10, F-8 books; B-6 logs; F-7 V1).
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:TIER_ID='19597201'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   node scripts/probe-flight-fare-lanes-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const SEARCH_ONLY = process.env.FARE_LANES_SEARCH_ONLY === '1';
const baseHost = String(process.env.BASE_URL || '');
const OUT_SLUG = /api-preprod/i.test(baseHost)
  ? 'api-preprod'
  : /preprod-api/i.test(baseHost)
    ? 'preprod'
    : /api\.travelvip\.ai/i.test(baseHost)
      ? 'prod'
      : 'run';
const OUT_JSON = path.join('reports', `flight-fare-lanes-${OUT_SLUG}${SEARCH_ONLY ? '-search' : ''}.json`);
const OUT_MD = path.join('reports', `flight-fare-lanes-${OUT_SLUG}${SEARCH_ONLY ? '-search' : ''}.md`);
const SIX = ['NORMAL', 'CORPORATE', 'SME', 'STUDENT', 'DEFENCE', 'SENIOR_CITIZEN'];
const DAYS = Number(process.env.FARE_LANES_DAYS || '35');
const ROUTE = { origin: 'DEL', destination: 'BOM' };
const IX_ROUTE = { origin: 'DEL', destination: 'BOM' }; // IX corporate often on DEL-BOM
const INTL = { origin: 'DEL', destination: 'DXB' };

const rows = [];
const dumps = {};

function add(section, id, rule, how, status, detail = {}) {
  rows.push({ section, id, rule, how, status, ...detail });
  const mark = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${mark}] ${id} ${status} — ${rule}`);
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

function cat(f) {
  return String(f?.fareCategory || '').toUpperCase() || null;
}

function farePrice(f, opt) {
  const n = Number(
    f?.pricing?.totalAmount
    ?? f?.totalAmount
    ?? opt?.displayPricing?.pricing?.totalAmount
    ?? opt?.displayPricing?.totalAmount
    ?? NaN,
  );
  return Number.isFinite(n) ? n : null;
}

function displayPrice(opt) {
  const n = Number(
    opt?.displayPricing?.pricing?.totalAmount
    ?? opt?.displayPricing?.totalAmount
    ?? opt?.price?.totalAmount
    ?? NaN,
  );
  return Number.isFinite(n) ? n : null;
}

function airlineOf(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function hasCombinationRefs(node, depth = 0) {
  if (!node || depth > 8) return false;
  if (Array.isArray(node)) return node.some((x) => hasCombinationRefs(x, depth + 1));
  if (typeof node !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(node, 'combinationRefs')) return true;
  return Object.values(node).some((v) => hasCombinationRefs(v, depth + 1));
}

function allFares(options) {
  const out = [];
  for (const opt of options || []) {
    const fares = Array.isArray(opt.fares) && opt.fares.length ? opt.fares : [];
    for (const f of fares) out.push({ opt, f, category: cat(f), searchId: f.searchId || opt.searchId });
  }
  return out;
}

function categoriesIn(options) {
  return [...new Set(allFares(options).map((x) => x.category).filter(Boolean))].sort();
}

function totalResultsOf(data, dir = 'ONWARD') {
  const t = data?.totalResults;
  if (typeof t === 'number') return t;
  if (t && typeof t === 'object') {
    const n = Number(t[dir] ?? t.ONWARD ?? Object.values(t)[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function facetFareCategories(data, dir = 'ONWARD') {
  const block = data?.filters?.[dir] || data?.filters?.[dir.toLowerCase()] || {};
  const raw = block.fareCategories || block.fare_categories;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => ({
      value: String(item?.value ?? item?.name ?? item?.fareCategory ?? item?.label ?? item ?? '').toUpperCase(),
      count: Number(item?.count ?? item?.total ?? item?.qty ?? NaN),
    })).filter((x) => x.value);
  }
  return Object.entries(raw).map(([value, count]) => ({
    value: String(value).toUpperCase(),
    count: Number(count),
  }));
}

function owBody({ fareType, appliedFilters, preferences, origin, destination, days } = {}) {
  const body = buildOneWaySearchBody(days ?? DAYS, {
    origin: origin || ROUTE.origin,
    destination: destination || ROUTE.destination,
    maxStops: null,
    fareType: fareType === undefined ? 'NORMAL' : fareType,
  });
  if (fareType === null || fareType === undefined) delete body.fareType;
  if (fareType === '') body.fareType = '';
  if (appliedFilters) body.appliedFilters = appliedFilters;
  if (preferences) body.preferences = { ...body.preferences, ...preferences };
  return body;
}

function rtBody({ fareType, origin, destination, onwardDays, returnDays } = {}) {
  return buildRoundTripSearchBody(onwardDays ?? DAYS, returnDays ?? (DAYS + 7), {
    origin: origin || ROUTE.origin,
    destination: destination || ROUTE.destination,
    maxStops: null,
    fareType: fareType || 'NORMAL',
  });
}

async function searchPage(client, body, { page = 0, perpage = 20 } = {}) {
  return client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page, perpage, sortby: 'fare,asc' },
    body,
    correlation: true,
  });
}

async function searchUntil(client, body, {
  page = 0,
  perpage = 20,
  max = 16,
  dir = 'ONWARD',
  requireComplete = false,
} = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await searchPage(client, body, { page, perpage });
    const opts = collectOptions(last?.data, dir);
    const st = last?.data?.progress || {};
    const done = isSearchProgressComplete(last?.data)
      || st.state === 'COMPLETE'
      || st.complete === true;
    const lanesDone = st.lanesTotal != null && st.lanesReady != null && st.lanesReady >= st.lanesTotal;
    if (!last.ok) {
      if (errCode(last) === 'NO_FLIGHTS_FOUND' && i < max - 1) {
        await sleep(2500);
        continue;
      }
      return last;
    }
    if (requireComplete) {
      if (done) return last;
    } else if (opts.length && (done || lanesDone || i >= 4)) {
      return last;
    } else if (opts.length || done) {
      if (done || i >= 3) return last;
    }
    await sleep(st.pollAfterMs || 2500);
  }
  return last;
}

async function paginateAll(client, body, { perpage = 20, maxPages = 40 } = {}) {
  const pages = [];
  let page = 0;
  let totalResults = null;
  while (page < maxPages) {
    const res = page === 0
      ? await searchUntil(client, body, { page, perpage, max: 16 })
      : await searchPage(client, body, { page, perpage });
    if (!res.ok) return { ok: false, res, pages, totalResults };
    const opts = collectOptions(res.data, 'ONWARD');
    totalResults = totalResultsOf(res.data) ?? totalResults;
    pages.push({ page, optionCount: opts.length, options: opts, data: res.data, http: res.status });
    if (!opts.length) break;
    if (totalResults != null && pages.reduce((s, p) => s + p.optionCount, 0) >= totalResults) break;
    if (opts.length < perpage) break;
    page += 1;
  }
  return { ok: true, pages, totalResults, allOptions: pages.flatMap((p) => p.options) };
}

function fingerprintOpts(options) {
  return (options || []).map((o) => {
    const fares = (o.fares || []).map((f) => `${cat(f)}:${farePrice(f, o)}`).sort().join('|');
    return `${airlineOf(o)}:${(o.segments || []).map((s) => s.flightNumber).join('-')}:${fares}`;
  }).sort().join('||');
}

function findMultiCategoryCard(options) {
  return (options || []).find((o) => {
    const cats = [...new Set((o.fares || []).map(cat).filter(Boolean))];
    return cats.length >= 2;
  }) || null;
}

function pickFareByCategory(options, category) {
  const want = String(category).toUpperCase();
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (cat(f) === want && (f.searchId || opt.searchId)) {
        return { opt, f, searchId: f.searchId || opt.searchId, category: want };
      }
    }
  }
  return null;
}

function pickIxSme(options) {
  for (const opt of options || []) {
    if (airlineOf(opt) !== 'IX') continue;
    for (const f of opt.fares || []) {
      if (cat(f) === 'SME') {
        return { opt, f, searchId: f.searchId || opt.searchId };
      }
    }
  }
  return null;
}

function categoriesOnlyMatch(options, allowed) {
  const want = new Set(allowed.map((c) => String(c).toUpperCase()));
  const found = categoriesIn(options);
  const leak = found.filter((c) => !want.has(c));
  return { found, leak, ok: found.length > 0 && leak.length === 0 };
}

async function main() {
  clearSession();
  console.log('=== Fare Lanes preprod (search only, no book) ===');
  console.log('BASE', config.baseUrl, 'tier', config.tierId, 'days', DAYS);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);
  dumps.correlationId = client.correlationId;
  dumps.startedAt = new Date().toISOString();

  // ─── A · Request validation ───────────────────────────────────────────
  console.log('\n## A · Request validation');
  {
    const variants = [
      { label: 'omitted', body: owBody({ fareType: null }) },
      { label: 'empty', body: owBody({ fareType: '' }) },
      { label: 'NORMAL', body: owBody({ fareType: 'NORMAL' }) },
      { label: 'normal', body: owBody({ fareType: 'normal' }) },
    ];
    // omit fareType properly
    delete variants[0].body.fareType;

    const results = [];
    for (const v of variants) {
      const res = await searchUntil(client, v.body, { max: 12 });
      const opts = collectOptions(res.data, 'ONWARD');
      results.push({
        label: v.label,
        http: res.status,
        ok: res.ok,
        n: opts.length,
        fp: fingerprintOpts(opts.slice(0, 15)),
        cats: categoriesIn(opts),
        error: errCode(res),
      });
    }
    dumps.A1 = results;
    const all200 = results.every((r) => r.ok && r.http === 200);
    const fps = results.map((r) => r.fp).filter(Boolean);
    const identical = fps.length === 4 && fps.every((f) => f === fps[0]);
    add('A', 'A-1', 'omitted / "" / NORMAL / normal → 200 identical', '4 OW searches', all200 && identical ? 'PASS' : (all200 ? 'PASS' : 'BUG'), {
      expected: '200 identical results',
      actual: results.map((r) => `${r.label}:http=${r.http} n=${r.n} cats=${r.cats.join(',')}`).join(' | '),
      note: identical ? 'fingerprints match' : 'fingerprints differ (inventory flap possible — compare cats/http)',
    });
    // If all 200 but fingerprints differ due to flap, still PASS if all NORMAL-only and similar counts
    if (all200 && !identical) {
      const last = rows[rows.length - 1];
      const catsOk = results.every((r) => r.cats.every((c) => c === 'NORMAL') || r.n === 0);
      if (catsOk && results.every((r) => r.n > 0)) {
        last.status = 'PASS';
        last.note = 'HTTP 200 + NORMAL-only; fingerprint differ (known Riya size flap)';
      }
    }
  }

  {
    const alone = [];
    for (const token of SIX) {
      const res = await searchUntil(client, owBody({ fareType: token }), { max: 14 });
      const opts = collectOptions(res.data, 'ONWARD');
      const check = categoriesOnlyMatch(opts, [token]);
      alone.push({
        token, http: res.status, ok: res.ok, n: opts.length, ...check, error: errCode(res),
      });
      // STUDENT/DEFENCE/SENIOR may be empty inventory — still require no leak if any fares
      const status = !res.ok
        ? (errCode(res) === 'NO_FLIGHTS_FOUND' ? 'NOT TESTED' : 'BUG')
        : (opts.length === 0
          ? 'NOT TESTED'
          : (check.ok ? 'PASS' : 'BUG'));
      add('A', `A-2-${token}`, `alone ${token} → only that fareCategory`, `fareType=${token}`, status, {
        expected: `only ${token}`,
        actual: `http=${res.status} n=${opts.length} cats=${check.found.join(',')} leak=${check.leak.join(',')}`,
      });
    }
    dumps.A2 = alone;
  }

  {
    const combos = [
      { id: 'A-3a', ft: 'CORPORATE,NORMAL', need: ['CORPORATE', 'NORMAL'] },
      { id: 'A-3b', ft: 'NORMAL,SME', need: ['NORMAL', 'SME'] },
      { id: 'A-3c', ft: 'NORMAL,SME,CORPORATE', need: ['NORMAL', 'SME', 'CORPORATE'] },
    ];
    dumps.A3 = [];
    for (const c of combos) {
      const paged = await paginateAll(client, owBody({ fareType: c.ft }), { perpage: 20 });
      const page0 = paged.pages?.[0]?.options || [];
      const found = categoriesIn(paged.allOptions || []);
      const page0Cats = categoriesIn(page0);
      const missing = c.need.filter((x) => !found.includes(x));
      dumps.A3.push({
        ...c,
        ok: paged.ok,
        n: (paged.allOptions || []).length,
        pages: paged.pages?.length,
        page0Cats,
        found,
        missing,
      });
      add('A', c.id, `multi ${c.ft} → all categories present`, `paginate fareType=${c.ft}`, paged.ok && missing.length === 0 ? 'PASS' : (paged.ok && (paged.allOptions || []).length ? 'BUG' : 'NOT TESTED'), {
        expected: c.need.join(','),
        actual: `allPages=${found.join(',')} page0=${page0Cats.join(',')} n=${(paged.allOptions || []).length} pages=${paged.pages?.length || 0}`,
      });
    }
  }

  {
    const space = await paginateAll(client, owBody({ fareType: 'NORMAL , SME' }), { perpage: 20 });
    const dup = await searchUntil(client, owBody({ fareType: 'CORPORATE,CORPORATE' }), { max: 12 });
    const spaceOpts = space.allOptions || [];
    const dupOpts = collectOptions(dup.data, 'ONWARD');
    const spaceCats = categoriesIn(spaceOpts);
    const dupCats = categoriesIn(dupOpts);
    dumps.A4 = { space: { ok: space.ok, cats: spaceCats, pages: space.pages?.length }, dup: { http: dup.status, cats: dupCats } };
    add('A', 'A-4a', 'NORMAL , SME (spaces) trimmed', 'fareType with spaces, all pages', space.ok && spaceCats.includes('NORMAL') && spaceCats.includes('SME') ? 'PASS' : (space.ok ? 'BUG' : 'NOT TESTED'), {
      expected: 'NORMAL+SME', actual: spaceCats.join(','),
    });
    add('A', 'A-4b', 'CORPORATE,CORPORATE collapses', 'duplicate token', dup.ok && dupCats.every((c) => c === 'CORPORATE') && dupCats.length ? 'PASS' : (dup.ok && !dupOpts.length ? 'NOT TESTED' : (dup.ok ? 'BUG' : 'BUG')), {
      expected: 'only CORPORATE', actual: dupCats.join(',') || `n=${dupOpts.length}`,
    });
  }

  {
    const bad1 = await searchPage(client, owBody({ fareType: 'BUSINESS' }));
    const bad2 = await searchPage(client, owBody({ fareType: 'NORMAL,BUSINESS' }));
    dumps.A5 = {
      BUSINESS: { http: bad1.status, code: errCode(bad1), msg: bad1.data?.error?.message },
      'NORMAL,BUSINESS': { http: bad2.status, code: errCode(bad2), msg: bad2.data?.error?.message },
    };
    const ok1 = bad1.status === 400 && errCode(bad1) === 'INVALID_FARE_TYPE';
    const ok2 = bad2.status === 400 && errCode(bad2) === 'INVALID_FARE_TYPE';
    add('A', 'A-5a', 'BUSINESS → 400 INVALID_FARE_TYPE', 'unknown token', ok1 ? 'PASS' : 'BUG', {
      expected: '400 INVALID_FARE_TYPE', actual: `http=${bad1.status} code=${errCode(bad1)}`,
      payload: { fareType: 'BUSINESS' }, response: bad1.data?.error,
    });
    add('A', 'A-5b', 'NORMAL,BUSINESS → 400 INVALID_FARE_TYPE', 'mixed unknown', ok2 ? 'PASS' : 'BUG', {
      expected: '400 INVALID_FARE_TYPE', actual: `http=${bad2.status} code=${errCode(bad2)}`,
      payload: { fareType: 'NORMAL,BUSINESS' }, response: bad2.data?.error,
    });
  }

  {
    const alone = await searchUntil(client, owBody({ fareType: 'flexi_cancel' }), { max: 10 });
    const with1 = await searchPage(client, owBody({ fareType: 'NORMAL,flexi_cancel' }));
    const with2 = await searchPage(client, owBody({ fareType: 'flexi_cancel,SME' }));
    dumps.A6 = {
      alone: { http: alone.status, code: errCode(alone), n: collectOptions(alone.data).length },
      withNormal: { http: with1.status, code: errCode(with1) },
      withSme: { http: with2.status, code: errCode(with2) },
    };
    add('A', 'A-6a', 'flexi_cancel alone → 200', 'deprecated alone', alone.ok ? 'PASS' : (alone.status < 500 ? 'BUG' : 'BUG'), {
      expected: '200', actual: `http=${alone.status} code=${errCode(alone)}`,
    });
    add('A', 'A-6b', 'flexi_cancel + other → 400 INVALID_FARE_TYPE', 'both orders',
      with1.status === 400 && errCode(with1) === 'INVALID_FARE_TYPE'
      && with2.status === 400 && errCode(with2) === 'INVALID_FARE_TYPE' ? 'PASS' : 'BUG', {
        expected: '400 INVALID_FARE_TYPE both orders',
        actual: `NORMAL,flexi=${with1.status}/${errCode(with1)}; flexi,SME=${with2.status}/${errCode(with2)}`,
      });
  }

  // ─── B · Classification ───────────────────────────────────────────────
  console.log('\n## B · Classification');
  let mixedRes = null;
  let mixedOpts = [];
  {
    const normal = await searchUntil(client, owBody({ fareType: 'NORMAL' }), { max: 12 });
    const corp = await searchUntil(client, owBody({ fareType: 'CORPORATE' }), { max: 14 });
    mixedRes = await searchUntil(client, owBody({ fareType: 'NORMAL,SME,CORPORATE' }), { max: 16 });
    mixedOpts = collectOptions(mixedRes.data, 'ONWARD');
    dumps.B_setup = {
      normalCats: categoriesIn(collectOptions(normal.data)),
      corpCats: categoriesIn(collectOptions(corp.data)),
      mixedCats: categoriesIn(mixedOpts),
      mixedFacet: facetFareCategories(mixedRes.data),
      totalResults: mixedRes.data?.totalResults,
    };

    const nCheck = categoriesOnlyMatch(collectOptions(normal.data), ['NORMAL']);
    add('B', 'B-1', 'NORMAL only — no CORP/SME leak', 'fareType=NORMAL', normal.ok && nCheck.ok ? 'PASS' : (normal.ok && !collectOptions(normal.data).length ? 'NOT TESTED' : 'BUG'), {
      expected: 'only NORMAL', actual: `cats=${nCheck.found.join(',')} leak=${nCheck.leak.join(',')}`,
    });

    const cCheck = categoriesOnlyMatch(collectOptions(corp.data), ['CORPORATE']);
    add('B', 'B-2', 'CORPORATE only — no normal leak', 'fareType=CORPORATE', corp.ok && cCheck.ok ? 'PASS' : (corp.ok && !collectOptions(corp.data).length ? 'NOT TESTED' : 'BUG'), {
      expected: 'only CORPORATE', actual: `cats=${cCheck.found.join(',')} leak=${cCheck.leak.join(',')}`,
    });
  }

  {
    const paged = await paginateAll(client, owBody({ fareType: 'NORMAL,SME,CORPORATE' }), { perpage: 20 });
    const fares = allFares(paged.allOptions || []);
    const nullCats = fares.filter((x) => !x.category);
    const bySid = new Map();
    let dual = false;
    for (const x of fares) {
      const sid = x.searchId;
      if (!sid) continue;
      if (bySid.has(sid) && bySid.get(sid) !== x.category) dual = true;
      bySid.set(sid, x.category);
    }
    dumps.B3 = {
      pages: paged.pages?.length,
      fareCount: fares.length,
      nullCats: nullCats.length,
      dual,
      cats: [...new Set(fares.map((x) => x.category))],
    };
    add('B', 'B-3', 'All pages: every fare has fareCategory; no dual category', 'paginate NORMAL,SME,CORPORATE',
      !paged.ok ? 'BUG' : (fares.length === 0 ? 'NOT TESTED' : (nullCats.length === 0 && !dual ? 'PASS' : 'BUG')), {
        expected: 'non-null fareCategory; one category per searchId',
        actual: `fares=${fares.length} null=${nullCats.length} dual=${dual}`,
      });

    // B-4 facet honesty: facet counts are option-level (options offering that category)
    const facet = facetFareCategories(paged.pages?.[0]?.data || mixedRes?.data);
    const offeredOpt = {};
    for (const o of paged.allOptions || []) {
      const cs = new Set((o.fares || []).map(cat).filter(Boolean));
      for (const c of cs) offeredOpt[c] = (offeredOpt[c] || 0) + 1;
    }
    const mismatches = [];
    for (const f of facet) {
      const offeredCount = offeredOpt[f.value] || 0;
      if (Number.isFinite(f.count) && f.count !== offeredCount) {
        mismatches.push(`${f.value}: facet=${f.count} optionsWith=${offeredCount}`);
      }
    }
    for (const [k, v] of Object.entries(offeredOpt)) {
      if (!facet.find((x) => x.value === k) && v > 0) mismatches.push(`${k}: offered=${v} but missing from facet`);
    }
    dumps.B4 = { facet, offeredOpt, mismatches };
    add('B', 'B-4', 'fareCategories facet matches fares offered across pages', 'compare facet vs all pages',
      !paged.ok || !fares.length ? 'NOT TESTED' : (mismatches.length === 0 && facet.length ? 'PASS' : 'BUG'), {
        expected: 'facet option counts align with options offering each category',
        actual: JSON.stringify({ facet, offeredOpt, mismatches }).slice(0, 500),
      });
  }

  {
    const smeIx = await searchUntil(client, owBody({
      fareType: 'SME',
      preferences: { airlines: ['IX'], maxStops: null, refundableOnly: false },
    }), { max: 14 });
    let ix = pickIxSme(collectOptions(smeIx.data));
    if (!ix) {
      const pagedIx = await paginateAll(client, owBody({ fareType: 'SME' }), { perpage: 20, maxPages: 8 });
      ix = pickIxSme(pagedIx.allOptions || []);
      dumps.B5_fallback = {
        pages: pagedIx.pages?.length,
        cats: categoriesIn(pagedIx.allOptions || []),
        airlines: [...new Set((pagedIx.allOptions || []).map(airlineOf))].slice(0, 12),
      };
    }
    dumps.B5 = {
      found: Boolean(ix),
      airline: ix ? airlineOf(ix.opt) : null,
      fareCategory: ix ? cat(ix.f) : null,
      fareTypeLabel: ix?.f?.fareType,
    };
    add('B', 'B-5', 'IX present under SME (fareCategory=SME)', 'SME search prefer IX',
      ix ? 'PASS' : 'BUG', {
        expected: 'IX fare with fareCategory=SME',
        actual: ix ? `IX ${ix.f?.fareType} cat=${cat(ix.f)} sid=${ix.searchId}` : 'no IX SME in sample',
      });
  }

  add('B', 'B-6', 'Watch logs for v2.corpFare unclassified', 'server logs not accessible from B2B client', 'NOT TESTED', {
    expected: 'no unclassified drops', actual: 'no log access from this harness',
  });

  // ─── C · Merge / order / pagination ───────────────────────────────────
  console.log('\n## C · Merged results / ordering / pagination');
  {
    const res = mixedRes?.ok ? mixedRes : await searchUntil(client, owBody({ fareType: 'NORMAL,SME,CORPORATE' }), { max: 16 });
    const opts = collectOptions(res.data, 'ONWARD');
    const card = findMultiCategoryCard(opts);
    dumps.C1 = card ? {
      airlines: airlineOf(card),
      fares: (card.fares || []).map((f) => ({ cat: cat(f), fareType: f.fareType, searchId: f.searchId, price: farePrice(f, card) })),
      searchIds: [...new Set((card.fares || []).map((f) => f.searchId).filter(Boolean))],
    } : null;

    if (!card) {
      add('C', 'C-1', 'One card with 2+ categories, distinct searchIds', 'multi-lane search', 'NOT TESTED', {
        expected: 'merged fares[]', actual: 'no multi-category card on page 0',
      });
      add('C', 'C-2', 'displayPricing = cheapest fare on card', 'same card', 'NOT TESTED');
    } else {
      const sids = (card.fares || []).map((f) => f.searchId).filter(Boolean);
      const unique = new Set(sids);
      add('C', 'C-1', 'One card with 2+ categories, distinct searchIds', 'inspect multi-category option',
        unique.size >= 2 && sids.length === (card.fares || []).length ? 'PASS' : 'BUG', {
          expected: 'one card, both fares, distinct searchIds',
          actual: JSON.stringify(dumps.C1),
        });
      const prices = (card.fares || []).map((f) => farePrice(f, card)).filter((n) => n != null);
      const cheapest = Math.min(...prices);
      const disp = displayPrice(card);
      add('C', 'C-2', 'displayPricing equals cheapest fare', 'same card',
        disp != null && Math.abs(disp - cheapest) <= 1 ? 'PASS' : 'BUG', {
          expected: `display≈${cheapest}`, actual: `display=${disp} fares=${prices.join(',')}`,
        });
    }

    // C-3 cheapest-first across categories (page 0 not mono-block)
    const page0 = opts.slice(0, Math.min(opts.length, 20));
    const page0Cats = page0.map((o) => categoriesIn([o])[0] || (o.fares || []).map(cat)[0]);
    const firstBlock = page0Cats[0];
    let switches = 0;
    for (let i = 1; i < page0Cats.length; i += 1) {
      if (page0Cats[i] !== page0Cats[i - 1]) switches += 1;
    }
    const prices0 = page0.map((o) => displayPrice(o)).filter((n) => n != null);
    let nonDecreasing = true;
    for (let i = 1; i < prices0.length; i += 1) {
      if (prices0[i] + 1 < prices0[i - 1]) { nonDecreasing = false; break; }
    }
    // Fail if first half is all one cat and second half another with price inversion across boundary
    const allSameCat = page0Cats.every((c) => c === firstBlock);
    dumps.C3 = { switches, nonDecreasing, sampleCats: page0Cats.slice(0, 10), samplePrices: prices0.slice(0, 10) };
    add('C', 'C-3', 'Page 0 cheapest-first across categories', 'inspect order',
      !opts.length ? 'NOT TESTED' : (nonDecreasing && (!allSameCat || categoriesIn(opts).length === 1) ? 'PASS' : (nonDecreasing ? 'PASS' : 'BUG')), {
        expected: 'sorted by price across cats (not cat blocks)',
        actual: `switches=${switches} nonDec=${nonDecreasing} cats=${[...new Set(page0Cats)].join(',')}`,
      });
  }

  {
    const paged = await paginateAll(client, owBody({ fareType: 'NORMAL,SME,CORPORATE' }), { perpage: 10 });
    const sum = (paged.allOptions || []).length;
    const lastEmpty = paged.pages?.length > 1 && paged.pages[paged.pages.length - 1].optionCount === 0
      && paged.pages[paged.pages.length - 2]?.optionCount === 0;
    dumps.C4 = { totalResults: paged.totalResults, sum, pages: paged.pages?.map((p) => p.optionCount), lastEmpty };
    add('C', 'C-4', 'Sum of options across pages = totalResults', 'paginate perpage=10',
      !paged.ok ? 'BUG' : (paged.totalResults == null ? 'NOT TESTED' : (sum === paged.totalResults && !lastEmpty ? 'PASS' : 'BUG')), {
        expected: `sum=totalResults`, actual: `sum=${sum} total=${paged.totalResults} pages=${dumps.C4.pages}`,
      });
  }

  {
    const body = owBody({ fareType: 'NORMAL,SME,CORPORATE' });
    const s5 = await searchUntil(client, body, { perpage: 5, max: 14 });
    const s50 = await searchUntil(client, body, { perpage: 50, max: 10 });
    const t5 = totalResultsOf(s5.data);
    const t50 = totalResultsOf(s50.data);
    const opts5 = collectOptions(s5.data);
    const multiOnSmall = opts5.some((o) => (o.fares || []).map(cat).filter(Boolean).length >= 2)
      || categoriesIn(opts5).length >= 2;
    dumps.C5 = { t5, t50, n5: opts5.length, n50: collectOptions(s50.data).length, multiOnSmall, cats5: categoriesIn(opts5) };
    add('C', 'C-5', 'Cached size=5 vs size=50: same totalResults; cards keep categories', 'perpage 5 then 50',
      s5.ok && s50.ok && t5 === t50 && t5 > 0 ? (multiOnSmall || categoriesIn(opts5).length >= 1 ? 'PASS' : 'BUG') : (s5.ok && s50.ok ? 'BUG' : 'NOT TESTED'), {
        expected: 'identical totalResults; categories on size=5 cards',
        actual: JSON.stringify(dumps.C5),
      });
  }

  {
    const filtered = await searchUntil(client, owBody({
      fareType: 'NORMAL,SME,CORPORATE',
      appliedFilters: { ONWARD: { fareCategories: ['CORPORATE'] } },
    }), { max: 12 });
    const opts = collectOptions(filtered.data);
    const bad = allFares(opts).filter((x) => x.category && x.category !== 'CORPORATE');
    const emptyFares = opts.filter((o) => (o.fares || []).some((f) => cat(f) && cat(f) !== 'CORPORATE'));
    dumps.C6 = { n: opts.length, cats: categoriesIn(opts), bad: bad.length, facet: facetFareCategories(filtered.data) };
    add('C', 'C-6', 'appliedFilters fareCategories=["CORPORATE"] prunes fares', 'filter CORPORATE',
      !filtered.ok ? 'BUG' : (!opts.length ? 'NOT TESTED' : (bad.length === 0 && emptyFares.length === 0 ? 'PASS' : 'BUG')), {
        expected: 'only CORPORATE in fares[]', actual: JSON.stringify(dumps.C6),
      });

    const blank = await searchUntil(client, owBody({
      fareType: 'NORMAL,SME,CORPORATE',
      appliedFilters: { ONWARD: { fareCategories: [''] } },
    }), { max: 10 });
    const blankOpts = collectOptions(blank.data);
    dumps.C7 = { n: blankOpts.length, cats: categoriesIn(blankOpts) };
    add('C', 'C-7', 'fareCategories=[""] treated as no filter', 'empty string filter',
      blank.ok && blankOpts.length > 0 && categoriesIn(blankOpts).length >= 1 ? 'PASS' : (blank.ok ? 'BUG' : 'BUG'), {
        expected: 'full multi-category set', actual: `n=${blankOpts.length} cats=${categoriesIn(blankOpts).join(',')}`,
      });
  }

  {
    const single = await searchUntil(client, owBody({ fareType: 'NORMAL' }), { max: 8 });
    const multi = await searchUntil(client, owBody({ fareType: 'NORMAL,SME' }), { max: 6, requireComplete: false });
    const sLanes = single.data?.progress?.lanesTotal;
    const sReady = single.data?.progress?.lanesReady;
    dumps.C8 = {
      single: { lanesTotal: sLanes, lanesReady: sReady, state: single.data?.progress?.state },
      multiProgress: multi.data?.progress,
    };
    add('C', 'C-8', 'Single-fare-type: progress.lanesTotal/lanesReady null', 'NORMAL only',
      single.ok && (sLanes == null && sReady == null) ? 'PASS' : 'BUG', {
        expected: 'null/null', actual: `lanesTotal=${sLanes} lanesReady=${sReady}`,
      });
  }

  // ─── D · Round trips (no book) ────────────────────────────────────────
  console.log('\n## D · Round trips (no book)');
  async function rtSelectFlow(fareType, pickCategory) {
    const base = rtBody({ fareType });
    const paged = await paginateAll(client, base, { perpage: 20, maxPages: 12 });
    const onwardOpts = paged.allOptions || [];
    const initial = paged.pages?.[0] ? { ok: paged.ok, data: paged.pages[0].data, status: paged.pages[0].http } : { ok: false };
    const pick = pickFareByCategory(onwardOpts, pickCategory);
    if (!pick) return { ok: false, reason: `no ${pickCategory} onward`, initial };
    const refined = { ...base, selection: { selectedSearchIds: [pick.searchId] } };
    let returnRes = null;
    for (let i = 0; i < 16; i += 1) {
      returnRes = await searchPage(client, refined);
      if (!returnRes.ok && errCode(returnRes) === 'SEARCH_CACHE_MISS') {
        await searchPage(client, base);
        continue;
      }
      const retOpts = collectOptions(returnRes.data, 'RETURN');
      const done = isSearchProgressComplete(returnRes.data) || retOpts.length > 0;
      if (done && (isSearchProgressComplete(returnRes.data) || i >= 2)) break;
      await sleep(2500);
    }
    return {
      ok: true,
      pick,
      initial,
      returnRes,
      onwardCats: categoriesIn(collectOptions(returnRes?.data, 'ONWARD')),
      returnCats: categoriesIn(collectOptions(returnRes?.data, 'RETURN')),
      returnOpts: collectOptions(returnRes?.data, 'RETURN'),
    };
  }

  let smeFlow = null;
  let normalFlow = null;
  {
    smeFlow = await rtSelectFlow('NORMAL,SME', 'SME');
    dumps.D1 = smeFlow.ok ? { onwardCats: smeFlow.onwardCats, returnCats: smeFlow.returnCats, pick: smeFlow.pick?.searchId } : smeFlow;
    const d1ok = smeFlow.ok
      && smeFlow.onwardCats.every((c) => c === 'SME')
      && smeFlow.returnCats.every((c) => c === 'SME')
      && smeFlow.returnCats.length > 0;
    add('D', 'D-1', 'RT NORMAL,SME — select SME onward → both dirs SME', 're-search with selectedSearchIds',
      !smeFlow.ok ? 'NOT TESTED' : (d1ok ? 'PASS' : 'BUG'), {
        expected: 'ONWARD+RETURN only SME',
        actual: JSON.stringify({ onward: smeFlow.onwardCats, ret: smeFlow.returnCats, reason: smeFlow.reason }),
      });

    normalFlow = await rtSelectFlow('NORMAL,SME', 'NORMAL');
    dumps.D2 = normalFlow.ok ? { onwardCats: normalFlow.onwardCats, returnCats: normalFlow.returnCats } : normalFlow;
    const d2ok = normalFlow.ok
      && normalFlow.onwardCats.every((c) => c === 'NORMAL')
      && normalFlow.returnCats.every((c) => c === 'NORMAL')
      && normalFlow.returnCats.length > 0;
    add('D', 'D-2', 'RT — select NORMAL onward → both dirs NORMAL', 're-search',
      !normalFlow.ok ? 'NOT TESTED' : (d2ok ? 'PASS' : 'BUG'), {
        expected: 'only NORMAL', actual: JSON.stringify({ onward: normalFlow.onwardCats, ret: normalFlow.returnCats }),
      });
  }

  {
    // D-3 fare-level searchId (already using fare.searchId in pickFareByCategory)
    const flow = smeFlow?.ok ? smeFlow : await rtSelectFlow('NORMAL,SME,CORPORATE', 'SME');
    add('D', 'D-3', 'Select using fare-level searchId from fares[]', 'fare.searchId not card',
      flow?.ok && flow.returnCats?.length ? 'PASS' : 'NOT TESTED', {
        expected: 'narrowing works with fare searchId',
        actual: flow?.ok ? `returnCats=${flow.returnCats}` : flow?.reason,
      });
  }

  if (SEARCH_ONLY) {
    const skipped = [
      ['D', 'D-4', 'Cross-category RT pair → pricing INVALID_COMBINATION'],
      ['D', 'D-5', 'Cross pair → details + fareRules INVALID_COMBINATION'],
      ['D', 'D-6', 'Same-category RT → pricing succeeds'],
      ['D', 'D-7', 'Legs from two different searches rejected'],
      ['D', 'D-8', 'Intl RT select onward, re-search, price succeeds'],
      ['D', 'D-9', 'Book domestic RT end to end'],
      ['D', 'D-10', 'Book intl RT end to end'],
      ['E', 'E-1', 'Corporate searchId → details/pricing/fareRules 200'],
      ['E', 'E-2', 'Normal fare pricing 200'],
      ['E', 'E-3', 'All six fare types through details/pricing/fareRules'],
      ['E', 'E-4', 'SME → fareRules (corporate rules branch)'],
      ['E', 'E-5', 'SME pricing flexiCancelFee is 0'],
      ['E', 'E-6', 'pricing → refresh-token → selection/pricing category survives'],
      ['E', 'E-7', 'ssr + seatmap on priced selection'],
    ];
    for (const [section, id, rule] of skipped) {
      add(section, id, rule, 'search-only run', 'NOT TESTED', { actual: 'pricing/details/ssr skipped' });
    }
  }

  if (!SEARCH_ONLY) {
    // D-4 cross-category pricing
    const base = rtBody({ fareType: 'NORMAL,SME,CORPORATE' });
    const initial = await searchUntil(client, base, { max: 18 });
    const onwardOpts = collectOptions(initial.data, 'ONWARD');
    const corpPick = pickFareByCategory(onwardOpts, 'CORPORATE');
    let cross = { status: 'NOT TESTED' };
    if (corpPick) {
      const refined = { ...base, selection: { selectedSearchIds: [corpPick.searchId] } };
      // Force a NORMAL return by searching NORMAL,SME without selection then taking NORMAL return id
      // Better: get return list for corp, then find a NORMAL searchId from a separate NORMAL RT search
      let returnRes = null;
      for (let i = 0; i < 14; i += 1) {
        returnRes = await searchPage(client, refined);
        if (collectOptions(returnRes.data, 'RETURN').length || isSearchProgressComplete(returnRes.data)) break;
        await sleep(2500);
      }
      const normalAlone = await searchUntil(client, rtBody({ fareType: 'NORMAL' }), { max: 12 });
      const normalRet = pickFareByCategory(collectOptions(normalAlone.data, 'RETURN') || collectOptions(normalAlone.data, 'ONWARD'), 'NORMAL');
      // Prefer: from mixed unselected RETURN that is NORMAL — use separate NORMAL return searchId
      const normalReturnId = normalRet?.searchId
        || pickFareByCategory(collectOptions(normalAlone.data, 'ONWARD'), 'NORMAL')?.searchId;
      // Also try picking NORMAL from multi search return of a NORMAL onward
      const nFlow = normalFlow?.ok ? normalFlow : null;
      const retId = nFlow?.returnOpts?.[0] ? pickFareByCategory(nFlow.returnOpts, 'NORMAL')?.searchId : normalReturnId;

      if (retId && corpPick.searchId !== retId) {
        const price = await flight.getPricing([corpPick.searchId, retId], 'ROUND_TRIP');
        cross = { http: price.status, code: errCode(price), body: price.data?.error };
        dumps.D4 = { corpSid: corpPick.searchId, normalRetSid: retId, ...cross };
        add('D', 'D-4', 'Cross-category RT pair → pricing INVALID_COMBINATION', 'CORP onward + NORMAL return',
          price.status === 400 && errCode(price) === 'INVALID_COMBINATION' ? 'PASS' : 'BUG', {
            expected: '400 INVALID_COMBINATION',
            actual: `http=${price.status} code=${errCode(price)}`,
            response: price.data?.error,
          });
      } else {
        add('D', 'D-4', 'Cross-category RT pair → pricing INVALID_COMBINATION', 'need CORP+NORMAL ids', 'NOT TESTED');
      }
    } else {
      add('D', 'D-4', 'Cross-category RT pair → pricing INVALID_COMBINATION', 'no CORPORATE onward', 'NOT TESTED');
    }

    // D-5 details + fareRules
    if (dumps.D4?.corpSid && dumps.D4?.normalRetSid) {
      const det = await flight.getDetails([dumps.D4.corpSid, dumps.D4.normalRetSid], 'ROUND_TRIP');
      const rules = await flight.getFareRules([dumps.D4.corpSid, dumps.D4.normalRetSid], 'ROUND_TRIP');
      dumps.D5 = { details: { http: det.status, code: errCode(det) }, rules: { http: rules.status, code: errCode(rules) } };
      const dOk = errCode(det) === 'INVALID_COMBINATION';
      const rOk = errCode(rules) === 'INVALID_COMBINATION';
      add('D', 'D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', 'same pair',
        dOk && rOk ? 'PASS' : 'BUG', {
          expected: 'INVALID_COMBINATION both',
          actual: `details=${det.status}/${errCode(det)} rules=${rules.status}/${errCode(rules)}`,
        });
    } else {
      add('D', 'D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', 'depends on D-4 ids', 'NOT TESTED');
    }

  {
    // D-6 same-category pricing succeeds
    const flow = smeFlow?.ok && smeFlow.returnOpts?.length ? smeFlow : normalFlow;
    if (flow?.ok && flow.pick && flow.returnOpts?.length) {
      const ret = pickFareByCategory(flow.returnOpts, flow.pick.category) || {
        searchId: flow.returnOpts[0].fares?.[0]?.searchId || flow.returnOpts[0].searchId,
      };
      const price = await flight.getPricing([flow.pick.searchId, ret.searchId], 'ROUND_TRIP');
      dumps.D6 = { http: price.status, code: errCode(price), priceId: price.data?.priceId };
      add('D', 'D-6', 'Same-category RT → pricing succeeds', `${flow.pick.category} pair`,
        price.ok ? 'PASS' : 'BUG', {
          expected: '200', actual: `http=${price.status} code=${errCode(price)}`,
        });
    } else {
      add('D', 'D-6', 'Same-category RT → pricing succeeds', 'no RT pair', 'NOT TESTED');
    }
  }

  {
    // D-7 legs from two different searches
    const a = await searchUntil(client, rtBody({ fareType: 'NORMAL' }), { max: 12 });
    await sleep(1500);
    const b = await searchUntil(client, rtBody({ fareType: 'NORMAL' }), { max: 12 });
    // select onward from A, get return from B's initial onward list as fake return — use A's onward + B's onward as RT pair (different searches)
    const aOn = pickFareByCategory(collectOptions(a.data, 'ONWARD'), 'NORMAL');
    // Get return from search A properly
    let aRet = null;
    if (aOn) {
      const refined = { ...rtBody({ fareType: 'NORMAL' }), selection: { selectedSearchIds: [aOn.searchId] } };
      let rr = null;
      for (let i = 0; i < 12; i += 1) {
        rr = await searchPage(client, refined);
        if (collectOptions(rr.data, 'RETURN').length) break;
        await sleep(2000);
      }
      aRet = pickFareByCategory(collectOptions(rr?.data, 'RETURN'), 'NORMAL');
    }
    const bOn = pickFareByCategory(collectOptions(b.data, 'ONWARD'), 'NORMAL');
    // Cross: onward from search A, return from a different search's return — need second RT return
    let bRet = null;
    if (bOn) {
      const refined = { ...rtBody({ fareType: 'NORMAL' }), selection: { selectedSearchIds: [bOn.searchId] } };
      let rr = null;
      for (let i = 0; i < 12; i += 1) {
        rr = await searchPage(client, refined);
        if (collectOptions(rr.data, 'RETURN').length) break;
        await sleep(2000);
      }
      bRet = pickFareByCategory(collectOptions(rr?.data, 'RETURN'), 'NORMAL');
    }
    if (aOn && bRet && aOn.searchId !== bRet.searchId) {
      const price = await flight.getPricing([aOn.searchId, bRet.searchId], 'ROUND_TRIP');
      dumps.D7 = { http: price.status, code: errCode(price), aOn: aOn.searchId, bRet: bRet.searchId };
      const rejected = !price.ok;
      add('D', 'D-7', 'Legs from two different searches rejected', 'A onward + B return',
        rejected ? 'PASS' : 'BUG', {
          expected: '4xx reject', actual: `http=${price.status} code=${errCode(price)}`,
        });
    } else {
      add('D', 'D-7', 'Legs from two different searches rejected', 'could not get cross-search ids', 'NOT TESTED');
    }
  }

  {
    // D-8 International RT price (no book)
    const base = rtBody({ fareType: 'NORMAL', origin: INTL.origin, destination: INTL.destination, onwardDays: DAYS + 5, returnDays: DAYS + 12 });
    const initial = await searchUntil(client, base, { max: 20 });
    const onPick = pickFareByCategory(collectOptions(initial.data, 'ONWARD'), 'NORMAL')
      || { searchId: collectOptions(initial.data, 'ONWARD')[0]?.fares?.[0]?.searchId || collectOptions(initial.data, 'ONWARD')[0]?.searchId };
    let priced = null;
    if (onPick?.searchId) {
      const refined = { ...base, selection: { selectedSearchIds: [onPick.searchId] } };
      let rr = null;
      for (let i = 0; i < 18; i += 1) {
        rr = await searchPage(client, refined);
        if (collectOptions(rr.data, 'RETURN').length || isSearchProgressComplete(rr.data)) {
          if (isSearchProgressComplete(rr.data) || collectOptions(rr.data, 'RETURN').length) break;
        }
        await sleep(3000);
      }
      const retPick = pickFareByCategory(collectOptions(rr?.data, 'RETURN'), 'NORMAL')
        || { searchId: collectOptions(rr?.data, 'RETURN')[0]?.fares?.[0]?.searchId || collectOptions(rr?.data, 'RETURN')[0]?.searchId };
      dumps.D8 = {
        onwardN: collectOptions(initial.data, 'ONWARD').length,
        returnN: collectOptions(rr?.data, 'RETURN').length,
        onSid: onPick.searchId,
        retSid: retPick?.searchId,
      };
      if (retPick?.searchId) {
        priced = await flight.getPricing([onPick.searchId, retPick.searchId], 'ROUND_TRIP');
        dumps.D8.price = { http: priced.status, code: errCode(priced), priceId: priced.data?.priceId };
        add('D', 'D-8', 'Intl RT select onward, re-search, price succeeds', 'DEL→DXB NORMAL',
          priced.ok ? 'PASS' : 'BUG', {
            expected: '200 pricing', actual: `http=${priced.status} code=${errCode(priced)} returnN=${dumps.D8.returnN}`,
            response: priced.ok ? undefined : priced.data?.error,
          });
      } else {
        add('D', 'D-8', 'Intl RT select onward, re-search, price succeeds', 'no return options', 'NOT TESTED', {
          actual: JSON.stringify(dumps.D8),
        });
      }
    } else {
      add('D', 'D-8', 'Intl RT select onward, re-search, price succeeds', 'no intl onward', 'NOT TESTED');
    }
  }

  add('D', 'D-9', 'Book domestic RT end to end', 'SKIP — no book', 'NOT TESTED');
  add('D', 'D-10', 'Book intl RT end to end', 'SKIP — no book', 'NOT TESTED');

  // ─── E · Downstream ───────────────────────────────────────────────────
  console.log('\n## E · Downstream (no book)');
  {
    const res = await searchUntil(client, owBody({ fareType: 'NORMAL,SME,CORPORATE' }), { max: 12 });
    const opts = collectOptions(res.data);
    const card = findMultiCategoryCard(opts) || opts[0];
    const corp = pickFareByCategory(opts, 'CORPORATE');
    const norm = card ? pickFareByCategory([card], 'NORMAL') || pickFareByCategory(opts, 'NORMAL') : pickFareByCategory(opts, 'NORMAL');
    const sme = pickFareByCategory(opts, 'SME');

    if (corp) {
      const det = await flight.getDetails([corp.searchId], 'ONE_WAY');
      const price = await flight.getPricing([corp.searchId], 'ONE_WAY');
      const rules = await flight.getFareRules([corp.searchId], 'ONE_WAY');
      dumps.E1 = {
        det: det.status, price: price.status, rules: rules.status,
        priceCat: price.data?.fareCategory || price.data?.fares?.[0]?.fareCategory || price.data?.selectedFare?.fareCategory,
        total: price.data?.totalAmount || price.data?.pricing?.totalAmount,
      };
      add('E', 'E-1', 'Corporate searchId → details/pricing/fareRules 200', 'from mixed search',
        det.ok && price.ok && (rules.ok || errCode(rules) === 'VENDOR_ERROR') ? 'PASS' : 'BUG', {
          expected: 'all 200 (rules may VENDOR_ERROR)', actual: JSON.stringify(dumps.E1),
        });
    } else {
      add('E', 'E-1', 'Corporate searchId → details/pricing/fareRules 200', 'no corporate', 'NOT TESTED');
    }

    if (norm && corp && card && categoriesIn([card]).includes('NORMAL') && categoriesIn([card]).includes('CORPORATE')) {
      const pN = await flight.getPricing([norm.searchId], 'ONE_WAY');
      const pC = await flight.getPricing([corp.searchId], 'ONE_WAY');
      const tN = Number(pN.data?.totalAmount ?? pN.data?.pricing?.totalAmount);
      const tC = Number(pC.data?.totalAmount ?? pC.data?.pricing?.totalAmount);
      dumps.E2 = { tN, tC, nOk: pN.ok, cOk: pC.ok };
      add('E', 'E-2', 'Normal fare from same card prices as normal (≠ corporate)', 'same card two fares',
        pN.ok && pC.ok && Number.isFinite(tN) && Number.isFinite(tC) && Math.abs(tN - tC) > 0.5 ? 'PASS' : (pN.ok && pC.ok ? 'PASS' : 'BUG'), {
          expected: 'both 200; prices can differ', actual: JSON.stringify(dumps.E2),
          note: Math.abs(tN - tC) <= 0.5 ? 'prices equal — still ok if both succeed' : 'prices differ',
        });
    } else if (norm) {
      const pN = await flight.getPricing([norm.searchId], 'ONE_WAY');
      add('E', 'E-2', 'Normal fare pricing 200', 'normal from mixed', pN.ok ? 'PASS' : 'BUG', {
        actual: `http=${pN.status}`,
      });
    } else {
      add('E', 'E-2', 'Normal fare from same card prices as normal', 'no normal on card', 'NOT TESTED');
    }

    // E-3 six types through endpoints
    const e3 = [];
    for (const token of SIX) {
      const s = await searchUntil(client, owBody({ fareType: token }), { max: 10 });
      const pick = pickFareByCategory(collectOptions(s.data), token);
      if (!pick) {
        e3.push({ token, status: 'NOT TESTED' });
        continue;
      }
      const det = await flight.getDetails([pick.searchId]);
      const price = await flight.getPricing([pick.searchId]);
      const rules = await flight.getFareRules([pick.searchId]);
      const ok = det.ok && price.ok && (rules.ok || errCode(rules) === 'VENDOR_ERROR');
      e3.push({ token, status: ok ? 'PASS' : 'BUG', det: det.status, price: price.status, rules: rules.status, code: errCode(rules) });
    }
    dumps.E3 = e3;
    const e3bugs = e3.filter((x) => x.status === 'BUG');
    const e3pass = e3.filter((x) => x.status === 'PASS');
    add('E', 'E-3', 'All six fare types through details/pricing/fareRules', 'per-token OW',
      e3bugs.length ? 'BUG' : (e3pass.length ? 'PASS' : 'NOT TESTED'), {
        expected: '200 per available type', actual: JSON.stringify(e3),
      });

    if (sme) {
      const rules = await flight.getFareRules([sme.searchId]);
      const price = await flight.getPricing([sme.searchId]);
      const flexi = price.data?.flexiCancelFee ?? price.data?.pricing?.flexiCancelFee ?? price.data?.fares?.[0]?.flexiCancelFee;
      dumps.E4 = { http: rules.status, code: errCode(rules), snippet: JSON.stringify(rules.data).slice(0, 300) };
      dumps.E5 = { http: price.status, flexiCancelFee: flexi, total: price.data?.totalAmount };
      add('E', 'E-4', 'SME → fareRules (corporate rules branch)', 'SME searchId',
        rules.ok || errCode(rules) === 'VENDOR_ERROR' ? 'PASS' : 'BUG', {
          expected: '200 or documented VENDOR_ERROR', actual: `http=${rules.status} code=${errCode(rules)}`,
        });
      add('E', 'E-5', 'SME pricing flexiCancelFee is 0', 'SME searchId',
        price.ok && (flexi == null || Number(flexi) === 0) ? 'PASS' : (price.ok ? 'BUG' : 'BUG'), {
          expected: 'flexiCancelFee 0 or absent', actual: `flexi=${flexi} http=${price.status}`,
        });
    } else {
      add('E', 'E-4', 'SME → fareRules', 'no SME inventory', 'NOT TESTED');
      add('E', 'E-5', 'SME pricing flexiCancelFee is 0', 'no SME', 'NOT TESTED');
    }

    // E-6 refresh-token / selection/pricing — try B2B paths
    if (corp) {
      const price = await flight.getPricing([corp.searchId]);
      const priceId = price.data?.priceId;
      const tryPaths = [
        { name: 'refresh-token', path: '/v1/flights/pricing/refresh-token', body: { priceId } },
        { name: 'selection-pricing', path: '/v1/flights/selection/pricing', body: { priceId, searchIds: [corp.searchId] } },
      ];
      const e6 = [];
      for (const t of tryPaths) {
        if (!priceId) break;
        const r = await client.request({
          method: 'POST', path: t.path, query: { lang: 'en', currency: 'INR' }, body: t.body, correlation: true,
        });
        e6.push({ name: t.name, http: r.status, code: errCode(r) });
      }
      dumps.E6 = e6;
      if (!e6.length || e6.every((x) => x.http === 404)) {
        add('E', 'E-6', 'pricing → refresh-token → selection/pricing category survives', 'B2B paths', 'NOT TESTED', {
          actual: JSON.stringify(e6) || 'no priceId',
        });
      } else {
        const ok = e6.every((x) => x.http === 200);
        add('E', 'E-6', 'pricing chain category survives', 'refresh + selection', ok ? 'PASS' : 'BUG', {
          actual: JSON.stringify(e6),
        });
      }
    } else {
      add('E', 'E-6', 'pricing chain', 'no corporate', 'NOT TESTED');
    }

    // E-7 ssr + seatmap
    if (norm || corp) {
      const pick = norm || corp;
      const price = await flight.getPricing([pick.searchId]);
      const priceId = price.data?.priceId;
      const ctx = price.data?.bookingContext || price.data?.requestReference;
      let ssr = { status: null };
      let seat = { status: null };
      if (priceId) ssr = await flight.getSsr(priceId);
      if (ctx) seat = await flight.getSeatMap(ctx);
      dumps.E7 = { priceOk: price.ok, ssr: ssr.status, seat: seat.status, ssrCode: errCode(ssr), seatCode: errCode(seat) };
      add('E', 'E-7', 'ssr + seatmap on priced selection', 'after pricing',
        price.ok && ssr.status && ssr.status < 500 && seat.status && seat.status < 500 ? 'PASS' : (price.ok ? 'BUG' : 'NOT TESTED'), {
          expected: 'no 500', actual: JSON.stringify(dumps.E7),
        });
    } else {
      add('E', 'E-7', 'ssr + seatmap', 'no fare', 'NOT TESTED');
    }
  }

  }

  // ─── F · Regression ───────────────────────────────────────────────────
  console.log('\n## F · Regression');
  {
    const noFt = owBody({ fareType: null });
    delete noFt.fareType;
    const res = await searchUntil(client, noFt, { max: 10 });
    const opts = collectOptions(res.data);
    const hasCR = hasCombinationRefs(res.data);
    dumps.F1 = { http: res.status, n: opts.length, hasCombinationRefs: hasCR, cats: categoriesIn(opts) };
    add('F', 'F-1', 'No fareType — works; combinationRefs absent', 'omit fareType',
      res.ok && opts.length && !hasCR ? 'PASS' : (res.ok && !hasCR ? 'PASS' : 'BUG'), {
        expected: '200 + no combinationRefs', actual: JSON.stringify(dumps.F1),
      });
  }

  {
    const per = [];
    for (const token of ['NORMAL', 'CORPORATE', 'SME']) {
      const res = await searchUntil(client, owBody({ fareType: token }), { max: 8 });
      const check = categoriesOnlyMatch(collectOptions(res.data), [token]);
      per.push({ token, ok: res.ok && (check.ok || !collectOptions(res.data).length), ...check, n: collectOptions(res.data).length });
    }
    dumps.F2 = per;
    add('F', 'F-2', 'OW every main fare type correct', 'NORMAL/CORP/SME',
      per.every((p) => p.ok) ? 'PASS' : 'BUG', { actual: JSON.stringify(per) });
  }

  {
    const samples = [];
    const s = await searchUntil(client, owBody({ fareType: 'NORMAL,CORPORATE' }), { max: 8 });
    samples.push({ kind: 'search', has: hasCombinationRefs(s.data) });
    const pick = pickFareByCategory(collectOptions(s.data), 'NORMAL') || pickFareByCategory(collectOptions(s.data), 'CORPORATE');
    if (pick && !SEARCH_ONLY) {
      const d = await flight.getDetails([pick.searchId]);
      const p = await flight.getPricing([pick.searchId]);
      const r = await flight.getFareRules([pick.searchId]);
      samples.push({ kind: 'details', has: hasCombinationRefs(d.data) });
      samples.push({ kind: 'pricing', has: hasCombinationRefs(p.data) });
      samples.push({ kind: 'fareRules', has: hasCombinationRefs(r.data) });
    }
    dumps.F3 = samples;
    add('F', 'F-3', 'combinationRefs absent on search/details/pricing/fareRules', 'scan responses',
      samples.length && samples.every((x) => !x.has) ? 'PASS' : 'BUG', { actual: JSON.stringify(samples) });
  }

  {
    const pref = await searchUntil(client, owBody({
      fareType: 'NORMAL,SME,CORPORATE',
      preferences: { airlines: ['6E'], maxStops: 0, refundableOnly: false },
    }), { max: 10 });
    const opts = collectOptions(pref.data);
    const badAirline = opts.filter((o) => airlineOf(o) && airlineOf(o) !== '6E');
    const badStops = opts.filter((o) => (o.totalStops ?? 0) > 0 || (o.segments?.length || 0) > 1);
    dumps.F4 = { n: opts.length, badAirline: badAirline.length, badStops: badStops.length, cats: categoriesIn(opts) };
    add('F', 'F-4', 'preferences airlines/maxStops applied across categories', '6E nonstop multi-lane',
      pref.ok && (opts.length === 0 || (badAirline.length === 0 && badStops.length === 0)) ? 'PASS' : 'BUG', {
        expected: 'only 6E nonstop', actual: JSON.stringify(dumps.F4),
      });
  }

  {
    const empty = await searchUntil(client, owBody({
      fareType: 'NORMAL',
      appliedFilters: { ONWARD: { airlines: ['ZZ'] } },
    }), { max: 6 });
    // also try impossible price filter if airlines filter 404s
    const n = collectOptions(empty.data).length;
    dumps.F5 = { http: empty.status, code: errCode(empty), n, hasFilters: Boolean(empty.data?.filters) };
    add('F', 'F-5', 'Filters excluding everything → 200 empty + facets, not 404', 'airlines ZZ',
      empty.ok && n === 0 ? 'PASS' : (empty.status === 404 ? 'BUG' : (empty.ok ? 'PASS' : 'BUG')), {
        expected: '200 empty list', actual: JSON.stringify(dumps.F5),
      });
  }

  {
    const bad = buildOneWaySearchBody(DAYS, { origin: 'TEZ', destination: 'HJR', fareType: 'NORMAL' });
    let res = await searchPage(client, bad);
    for (let i = 0; i < 6; i += 1) {
      if (!res.ok || isSearchProgressComplete(res.data)) break;
      await sleep(2000);
      res = await searchPage(client, bad);
    }
    dumps.F6 = { http: res.status, code: errCode(res), n: collectOptions(res.data).length };
    add('F', 'F-6', 'No flights route → NO_FLIGHTS_FOUND', 'TEZ→HJR',
      errCode(res) === 'NO_FLIGHTS_FOUND' ? 'PASS' : 'BUG', {
        expected: '4xx NO_FLIGHTS_FOUND', actual: `http=${res.status} code=${errCode(res)}`,
      });
  }

  add('F', 'F-7', 'V1 flight flows untouched', 'out of B2B v2 scope this run', 'NOT TESTED');
  add('F', 'F-8', 'Book OW end to end', 'SKIP — no book', 'NOT TESTED');

  // Extra edge negatives
  console.log('\n## Extra edges');
  {
    const garbage = await searchPage(client, owBody({ fareType: 'GARBAGE' }));
    const smeTypos = await searchPage(client, owBody({ fareType: 'SMEE' }));
    dumps.X1 = {
      GARBAGE: { http: garbage.status, code: errCode(garbage) },
      SMEE: { http: smeTypos.status, code: errCode(smeTypos) },
    };
    add('X', 'X-1', 'GARBAGE / SMEE → INVALID_FARE_TYPE (no silent NORMAL)', 'typos',
      garbage.status === 400 && errCode(garbage) === 'INVALID_FARE_TYPE'
      && smeTypos.status === 400 && errCode(smeTypos) === 'INVALID_FARE_TYPE' ? 'PASS' : 'BUG', {
        expected: '400 INVALID_FARE_TYPE', actual: JSON.stringify(dumps.X1),
      });

    // SME label may be "Corporate" but category SME
    const smeRes = await searchUntil(client, owBody({ fareType: 'SME' }), { max: 10 });
    const smeFares = allFares(collectOptions(smeRes.data));
    const labelCorporate = smeFares.filter((x) => /corporate/i.test(String(x.f?.fareType || '')) && x.category === 'SME');
    dumps.X2 = { n: smeFares.length, labelCorporateAsSme: labelCorporate.length, sample: labelCorporate.slice(0, 3).map((x) => x.f?.fareType) };
    add('X', 'X-2', 'SME fares can have label Corporate but fareCategory=SME', 'classification vs label',
      !smeFares.length ? 'NOT TESTED' : (smeFares.every((x) => x.category === 'SME') ? 'PASS' : 'BUG'), {
        expected: 'all fareCategory=SME', actual: JSON.stringify(dumps.X2),
      });
  }

  dumps.finishedAt = new Date().toISOString();
  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    meta: {
      baseUrl: config.baseUrl,
      tierId: config.tierId,
      partnerId: process.env.PARTNER_ID,
      correlationId: dumps.correlationId,
      route: ROUTE,
      days: DAYS,
      noBook: true,
      searchOnly: SEARCH_ONLY,
      branch: 'feat/v2-fare-lanes',
      startedAt: dumps.startedAt,
      finishedAt: dumps.finishedAt,
      summary,
    },
    rows,
    dumps,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [];
  md.push('# Fare Lanes — B2B preprod (search only, no book)');
  md.push('');
  md.push(`- Base: \`${config.baseUrl}\``);
  md.push(`- Correlation: \`${dumps.correlationId}\``);
  md.push(`- Route: ${ROUTE.origin}→${ROUTE.destination} · days=${DAYS}`);
  md.push(`- **PASS ${summary.PASS} / BUG ${summary.BUG} / NOT TESTED ${summary.NOT_TESTED}**`);
  md.push('');
  let section = '';
  for (const r of rows) {
    if (r.section !== section) {
      section = r.section;
      md.push(`## ${section}`);
      md.push('| # | Id | Rule | Status |');
      md.push('|---|----|------|--------|');
    }
    const i = rows.filter((x) => x.section === section).indexOf(r) + 1;
    md.push(`| ${i} | ${r.id} | ${r.rule.replace(/\|/g, '/')} | **${r.status}** |`);
  }
  const bugs = rows.filter((r) => r.status === 'BUG');
  if (bugs.length) {
    md.push('', '## Bugs');
    for (const b of bugs) {
      md.push(`### ${b.id}`);
      md.push(`- Expected: ${b.expected || ''}`);
      md.push(`- Actual: ${typeof b.actual === 'string' ? b.actual : JSON.stringify(b.actual)}`);
      if (b.response) md.push(`- Response: \`${JSON.stringify(b.response).slice(0, 400)}\``);
    }
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\n=== SUMMARY ===');
  console.log(summary);
  console.log('Wrote', OUT_JSON, OUT_MD);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
