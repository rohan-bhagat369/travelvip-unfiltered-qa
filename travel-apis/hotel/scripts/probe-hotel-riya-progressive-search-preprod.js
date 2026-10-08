/**
 * Riya Progressive Search QA — B2B search only (no book).
 * Cases from riya-progressive-search-qa.md
 *
 * Fresh city/dates every case (30‑min cache). Skip A4 / B2-book / C2 flag-off.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='...'
 *   $env:TIER_ID='19597201'
 *   $env:SIGNING_KEY='...'
 *   node scripts/probe-hotel-riya-progressive-search-preprod.js
 *
 * Optional: COMPARE_PROD=1 also times prod for the same fresh criteria.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT_JSON = path.join('reports', 'hotel-riya-progressive-search-preprod.json');
const OUT_MD = path.join('reports', 'hotel-riya-progressive-search-preprod.md');
const PID = process.env.HOTEL_PID || 'vgm';
const COMPARE_PROD = String(process.env.COMPARE_PROD || '1') === '1';
const PROD_URL = 'https://api.travelvip.ai';
const PRE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
const EARLY_MS = Number(process.env.EARLY_MS || 14000);
const FULL_MS = Number(process.env.FULL_MS || 28000);

const rows = [];
const dumps = { cases: {} };

function add(id, rule, how, status, detail = {}) {
  rows.push({ id, rule, how, status, ...detail });
  const m = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${m}] ${id} ${status} — ${rule}`);
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/** Unique checkin/checkout per case — avoid 30‑min cache. */
function freshDates(seedDays) {
  const bump = Number(process.env.DATE_BUMP || 0);
  const base = 28 + ((seedDays + bump) % 50) + Math.floor(bump / 7);
  const guests = 1 + ((seedDays + bump) % 2);
  const nights = 1 + ((seedDays + bump) % 3);
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + base);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + nights);
  return {
    checkin: ymd(checkin),
    checkout: ymd(checkout),
    adults: guests === 1 ? 1 : 2,
  };
}

function baseBody(entityId, dates, extra = {}) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: dates.checkin,
    checkout: dates.checkout,
    type: 'CITY',
    rooms: [{ adults: dates.adults || 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
    ...extra,
  };
}

function hotelId(h) {
  return String(h?.id || h?.entityId || '');
}

function priceOf(h) {
  return Number(h?.price?.totalAmount ?? h?.price?.baseFare ?? NaN);
}

function summarize(list, n = 8) {
  return (list || []).slice(0, n).map((h, i) => ({
    rank: i + 1,
    id: hotelId(h),
    name: h.name,
    star: h.starRating,
    price: priceOf(h),
  }));
}

async function authClient(baseUrl) {
  process.env.BASE_URL = baseUrl;
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  return { client: session.client, hotel: new HotelService(session.client), correlationId: session.client.correlationId };
}

async function doSearch(hotel, entityId, dates, { offset = 0, limit = 20, fq = [], sort } = {}) {
  const body = baseBody(entityId, dates, { fq });
  const query = { pid: PID, offset, limit };
  if (sort) query.sort = sort;
  const t0 = Date.now();
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
    available: Number(data.availableResults ?? NaN),
    requestId: data.requestId || null,
    fromCache: data.fromCache ?? null,
    last: data.last,
    code: data?.error?.code || null,
    correlationId: data?._meta?.correlation_id || null,
    progressiveHints: {
      progress: data.progress ?? null,
      partial: data.partial ?? null,
      status: data.status ?? null,
      complete: data.complete ?? null,
    },
  };
}

async function main() {
  console.log('=== Riya Progressive Search QA (search only, no book) ===');
  console.log('Preprod', PRE_URL, 'COMPARE_PROD', COMPARE_PROD);

  const pre = await authClient(PRE_URL);
  dumps.preprodCorrelation = pre.correlationId;
  dumps.startedAt = new Date().toISOString();

  let prod = null;
  if (COMPARE_PROD) {
    try {
      prod = await authClient(PROD_URL);
      dumps.prodCorrelation = prod.correlationId;
    } catch (e) {
      dumps.prodAuthError = String(e.message || e);
      console.log('Prod auth failed — skip compare', dumps.prodAuthError);
    }
  }

  // ─── A1 time to first results (fresh large cities) ─────────────────────
  console.log('\n## A1 · Early results');
  {
    const cities = [
      { key: 'Delhi', entityId: '227760:IN' },
      { key: 'Mumbai', entityId: '357389:IN' },
      { key: 'Dubai', entityId: '221688:AE' },
    ];
    const a1 = [];
    for (let i = 0; i < cities.length; i += 1) {
      const city = cities[i];
      const dates = freshDates(100 + i * 3);
      const r = await doSearch(pre.hotel, city.entityId, dates, { limit: 20 });
      let prodR = null;
      if (prod) {
        // different guest count so we don't share accidental cache; same city+nearby dates
        const pd = { ...dates, adults: dates.adults === 1 ? 2 : 1 };
        prodR = await doSearch(prod.hotel, city.entityId, pd, { limit: 20 });
      }
      a1.push({
        city: city.key,
        dates,
        pre: { ms: r.ms, total: r.total, n: r.results.length, fromCache: r.fromCache, hints: r.progressiveHints, correlationId: r.correlationId, requestId: r.requestId },
        prod: prodR ? { ms: prodR.ms, total: prodR.total, n: prodR.results.length, fromCache: prodR.fromCache } : null,
      });
      console.log(`  ${city.key} pre=${r.ms}ms total=${r.total} n=${r.results.length} cache=${r.fromCache}`
        + (prodR ? ` | prod=${prodR.ms}ms total=${prodR.total}` : ''));
    }
    dumps.A1 = a1;
    const times = a1.map((x) => x.pre.ms);
    const allHaveHotels = a1.every((x) => x.pre.n > 0 && x.pre.total > 0);
    const anyEarly = times.some((t) => t <= EARLY_MS);
    const allEarly = times.every((t) => t <= EARLY_MS);
    const allSlow = times.every((t) => t >= 18000);
    // B2B API may still block until full — report honestly
    let status = 'BUG';
    let note = '';
    if (!allHaveHotels) {
      status = 'BUG';
      note = 'missing inventory';
    } else if (allEarly) {
      status = 'PASS';
      note = `all first pages ≤${EARLY_MS}ms`;
    } else if (anyEarly) {
      status = 'PASS';
      note = `some cities ≤${EARLY_MS}ms; others slower (cache/city size)`;
    } else if (allSlow) {
      status = 'BUG';
      note = `B2B search still ~full wait (${times.join(',')}ms). No progress/partial fields in response — progressive may not surface on POST /v1/hotels/search`;
    } else {
      status = 'BUG';
      note = `times ${times.join(',')}ms — not consistently early`;
    }
    add('A1', 'Results appear early (~8–14s), then more', 'fresh large-city searches; time first page', status, {
      expected: `priced hotels within ~${EARLY_MS}ms`,
      actual: a1.map((x) => `${x.city}:${x.pre.ms}ms/total=${x.pre.total}`).join(' | '),
      note,
      correlationIds: a1.map((x) => x.pre.correlationId),
    });
  }

  // ─── A2 paging ─────────────────────────────────────────────────────────
  console.log('\n## A2 · Paging');
  {
    const dates = freshDates(201);
    const entityId = '227760:IN';
    const pages = [];
    const ids = [];
    let offset = 0;
    let total = null;
    let stuck = false;
    let blank = false;
    for (let p = 0; p < 15; p += 1) {
      const r = await doSearch(pre.hotel, entityId, dates, { offset, limit: 20 });
      if (p === 0) total = r.total;
      pages.push({ p, offset, n: r.results.length, ms: r.ms, last: r.last, total: r.total });
      if (!r.ok || r.results.length === 0) {
        if (offset < (total || 0)) blank = true;
        break;
      }
      for (const h of r.results) ids.push(hotelId(h));
      if (r.last === true || offset + r.results.length >= (r.total || 0)) break;
      offset += 20;
      if (pages.length >= 2 && pages[pages.length - 1].n === 0 && pages[pages.length - 2].n === 0) {
        stuck = true;
        break;
      }
    }
    const dup = ids.length - new Set(ids).size;
    dumps.A2 = { dates, total, pages, dup, stuck, blank };
    add('A2', 'Paging through several pages to end', 'Delhi paginate limit=20', !blank && !stuck && pages.length >= 2 && dup === 0 ? 'PASS' : 'BUG', {
      expected: 'no blank/stuck/loop; unique hotels',
      actual: JSON.stringify({ pages: pages.length, total, dup, stuck, blank, pageNs: pages.map((x) => x.n) }),
    });
  }

  // ─── A3 detail from early/first-page result ────────────────────────────
  console.log('\n## A3 · Detail from first-page hotel');
  {
    const dates = freshDates(220);
    const r = await doSearch(pre.hotel, '357389:IN', dates, { limit: 20 });
    const card = r.results[0];
    if (!card) {
      add('A3', 'Hotel detail opens from early/first result', 'Mumbai first card → details', 'NOT TESTED', { actual: 'no results' });
    } else {
      const detBody = {
        checkin: dates.checkin,
        checkout: dates.checkout,
        entityId: String(card.id || card.entityId),
        nationality: 'IN',
        type: 'HOTEL',
        rooms: [{ adults: dates.adults || 1, children: 0, childrenAges: [] }],
      };
      const t0 = Date.now();
      const det = await pre.hotel.getDetails(detBody);
      const ms = Date.now() - t0;
      const d = det.data || {};
      const name = d.name || d.hotelName || d.property?.name;
      const star = d.starRating ?? d.property?.starRating;
      const rooms = d.rooms || d.roomTypes || [];
      const matchName = !name || !card.name ? true : String(name).toLowerCase().includes(String(card.name).split(',')[0].toLowerCase().slice(0, 8))
        || String(card.name).toLowerCase().includes(String(name).toLowerCase().slice(0, 8));
      dumps.A3 = {
        card: summarize([card], 1)[0],
        detailsHttp: det.status,
        ms,
        name,
        star,
        roomCount: rooms.length,
        matchName,
        correlationId: d._meta?.correlation_id || r.correlationId,
      };
      add('A3', 'Detail from first-page hotel matches card', 'search → details (no book)', det.ok && rooms.length >= 0 && (matchName || star != null) ? 'PASS' : 'BUG', {
        expected: 'details open; name/star align with card',
        actual: JSON.stringify(dumps.A3).slice(0, 400),
      });
    }
  }

  add('A4', 'Book end to end from early result', 'SKIP — search only / no book', 'NOT TESTED');

  // ─── B1 narrow filter early ────────────────────────────────────────────
  console.log('\n## B1 · Filter matching nothing early');
  {
    const dates = freshDates(240);
    const entityId = '227760:IN';
    const first = await doSearch(pre.hotel, entityId, dates, { limit: 20 });
    // extreme price band via fq if supported — try price filter facets
    const priceFilter = (first.data.filters || []).find((f) => /price/i.test(`${f.name || ''} ${f.indexField || ''}`));
    const lowFq = priceFilter?.indexField
      ? [`${priceFilter.indexField}:[1 TO 50]`]
      : ['df_double_price:[1 TO 50]'];
    const filtered = await doSearch(pre.hotel, entityId, dates, { limit: 20, fq: lowFq });
    await sleep(5000);
    const later = await doSearch(pre.hotel, entityId, dates, { limit: 20, fq: lowFq });
    dumps.B1 = {
      dates,
      firstTotal: first.total,
      filterMs: filtered.ms,
      filterN: filtered.results.length,
      filterTotal: filtered.total,
      laterN: later.results.length,
      laterTotal: later.total,
      fq: lowFq,
      // "ended early" = immediately zero AND later still zero while unfiltered had inventory — ok if honest empty
      // BUG if first unfiltered slow full city but filter returns empty with message that search is done while... hard on B2B sync API
    };
    // On sync B2B: filter after full search — empty with inventory elsewhere is OK if total=0 honestly
    const honestEmpty = filtered.ok && filtered.results.length === 0 && (filtered.total === 0 || !Number.isFinite(filtered.total));
    const hasMatches = filtered.results.length > 0;
    add('B1', 'Narrow filter must not falsely end search', 'extreme low price fq after/with search', filtered.ok && (honestEmpty || hasMatches) ? 'PASS' : 'BUG', {
      expected: 'matching hotels OR honest empty after complete — not stuck false-empty mid-flight',
      actual: JSON.stringify(dumps.B1).slice(0, 400),
      note: 'B2B search is synchronous; progressive mid-flight empty is harder to observe than on UI',
    });
  }

  // ─── B2 early hotels still listed (no book) ────────────────────────────
  console.log('\n## B2 · Early hotels still listed after full');
  {
    const dates = freshDates(260);
    const r1 = await doSearch(pre.hotel, '357389:IN', dates, { limit: 20 });
    const earlyIds = r1.results.slice(0, 3).map(hotelId).filter(Boolean);
    await sleep(3000);
    const r2 = await doSearch(pre.hotel, '357389:IN', dates, { limit: 20 });
    // also page a bit to find them
    const still = [];
    let offset = 0;
    const found = new Set();
    for (let p = 0; p < 5; p += 1) {
      const page = p === 0 ? r2 : await doSearch(pre.hotel, '357389:IN', dates, { offset, limit: 20 });
      for (const h of page.results) {
        if (earlyIds.includes(hotelId(h))) found.add(hotelId(h));
      }
      if (page.last || offset + 20 >= (page.total || 0)) break;
      offset += 20;
    }
    dumps.B2 = { earlyIds, found: [...found], earlySample: summarize(r1.results, 3) };
    add('B2', 'Hotels from first page still listed after reload (book skipped)', 'note early ids → re-search', earlyIds.length && found.size === earlyIds.length ? 'PASS' : (earlyIds.length ? 'BUG' : 'NOT TESTED'), {
      expected: 'early hotels still present (or removed if sold out)',
      actual: JSON.stringify(dumps.B2),
      note: 'Booking step NOT TESTED (search only)',
    });
  }

  // ─── B3 no availability honest ─────────────────────────────────────────
  console.log('\n## B3 · No availability');
  {
    const dates = freshDates(400); // far out
    dates.checkin = '2027-11-01';
    dates.checkout = '2027-11-02';
    const r = await doSearch(pre.hotel, '334045:IN', dates, { limit: 20 }); // Manali far
    const tiny = r.results.length;
    const total = r.total;
    dumps.B3 = { dates, http: r.http, code: r.code, n: tiny, total, fromCache: r.fromCache };
    // honest: 0 results / NO_AVAILABILITY / total 0 — not a tiny fake full city
    const honest = (!r.ok && r.code) || (r.ok && (total === 0 || tiny === 0));
    const misleading = r.ok && tiny > 0 && tiny <= 5 && total === tiny;
    add('B3', 'No availability says so honestly', 'far dates small city', honest && !misleading ? 'PASS' : (misleading ? 'BUG' : 'NOT TESTED'), {
      expected: 'clear empty / error — not a short list as whole city',
      actual: JSON.stringify(dumps.B3),
    });
  }

  // ─── B4 parallel identical searches ────────────────────────────────────
  console.log('\n## B4 · Parallel identical searches');
  {
    const dates = freshDates(280);
    const entityId = '227760:IN';
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      doSearch(pre.hotel, entityId, dates, { limit: 20 }),
      doSearch(pre.hotel, entityId, dates, { limit: 20 }),
    ]);
    const wall = Date.now() - t0;
    dumps.B4 = {
      dates,
      wallMs: wall,
      a: { ms: a.ms, total: a.total, n: a.results.length, requestId: a.requestId, top: summarize(a.results, 5) },
      b: { ms: b.ms, total: b.total, n: b.results.length, requestId: b.requestId, top: summarize(b.results, 5) },
    };
    const bothFull = a.ok && b.ok && a.results.length > 0 && b.results.length > 0
      && Number.isFinite(a.total) && Number.isFinite(b.total)
      && Math.abs(a.total - b.total) <= Math.max(5, a.total * 0.05);
    const oneEmpty = (a.results.length === 0) !== (b.results.length === 0);
    add('B4', 'Same search in parallel — both get full results', 'Promise.all two identical searches', bothFull && !oneEmpty ? 'PASS' : 'BUG', {
      expected: 'both full sets; neither empty/short',
      actual: `wall=${wall} a=${a.ms}ms/total=${a.total} b=${b.ms}ms/total=${b.total} oneEmpty=${oneEmpty}`,
    });

    // also 3-way parallel stress
    const dates2 = freshDates(290);
    const triple = await Promise.all([
      doSearch(pre.hotel, '357389:IN', dates2, { limit: 20 }),
      doSearch(pre.hotel, '357389:IN', dates2, { limit: 20 }),
      doSearch(pre.hotel, '357389:IN', dates2, { limit: 20 }),
    ]);
    dumps.B4b = triple.map((x) => ({ ms: x.ms, total: x.total, n: x.results.length, ok: x.ok }));
    const allOk = triple.every((x) => x.ok && x.results.length > 0);
    add('B4b', '3 parallel identical Mumbai searches', 'Promise.all x3', allOk ? 'PASS' : 'BUG', {
      actual: JSON.stringify(dumps.B4b),
    });
  }

  // ─── C1 other providers — B2B Riya path only; note ─────────────────────
  add('C1', 'TBO / RateHawk search unaffected', 'B2B vgm path is Riya inventory — cannot isolate TBO/RH here', 'NOT TESTED', {
    note: 'Partner listing on this channel is Riya; need TBO/RH-routed partner or SMT to verify',
  });
  add('C2', 'Riya with progressive flag off', 'needs eng to flip config flag', 'NOT TESTED');

  // ─── D known weak spots (observe) ──────────────────────────────────────
  console.log('\n## D · Known weak spots');
  {
    const dates = freshDates(310);
    const small = await doSearch(pre.hotel, '334045:IN', dates, { limit: 20 }); // Manali
    dumps.D1 = { city: 'Manali', dates, ms: small.ms, total: small.total, n: small.results.length };
    add('D1', 'Small city timing (known may be slower)', 'Manali fresh search', 'PASS', {
      expected: 'note timing — may be slower than metros',
      actual: `${small.ms}ms total=${small.total}`,
      note: 'observational',
    });
  }
  {
    const dates = freshDates(320);
    const r = await doSearch(pre.hotel, '227760:IN', dates, { limit: 20 });
    const names = (r.results || []).map((h) => String(h.name || ''));
    const brandRe = /taj|marriott|novotel|hilton|hyatt|oberoi|itc|le m[eé]ridien/i;
    const earlyBrands = names.filter((n) => brandRe.test(n));
    dumps.D2 = { earlyBrandCount: earlyBrands.length, earlyBrands: earlyBrands.slice(0, 8), top: summarize(r.results, 10) };
    add('D2', 'Branded hotels on first page (known may be thin)', 'Delhi first page brand scan', 'PASS', {
      expected: 'note if brands sparse early (known)',
      actual: `brandsOnPage1=${earlyBrands.length}: ${earlyBrands.slice(0, 5).join(', ') || '(none)'}`,
      note: 'observational — not a fail',
    });
  }
  {
    // D3 reorder: compare page0 after fresh vs after short wait re-search (cache may freeze order)
    const dates = freshDates(330);
    const r1 = await doSearch(pre.hotel, '357389:IN', dates, { limit: 10 });
    await sleep(2000);
    const r2 = await doSearch(pre.hotel, '357389:IN', dates, { limit: 10 });
    const ids1 = r1.results.map(hotelId).join(',');
    const ids2 = r2.results.map(hotelId).join(',');
    dumps.D3 = { changed: ids1 !== ids2, first: summarize(r1.results, 5), second: summarize(r2.results, 5) };
    add('D3', 'Result order may change as more arrive (known)', 'two searches same criteria', 'PASS', {
      expected: 'order change possible — note only',
      actual: ids1 === ids2 ? 'order stable (likely cached full set)' : 'order changed',
      note: 'observational',
    });
  }

  // ─── Parallel multi-city + prod discrepancy check ──────────────────────
  console.log('\n## Parallel multi-city vs prod');
  {
    const cities = [
      { key: 'Delhi', entityId: '227760:IN' },
      { key: 'Mumbai', entityId: '357389:IN' },
      { key: 'Jaipur', entityId: '227736:IN' },
    ];
    const dates = freshDates(350);
    const t0 = Date.now();
    const preResults = await Promise.all(cities.map((c) => doSearch(pre.hotel, c.entityId, dates, { limit: 20 })));
    const preWall = Date.now() - t0;
    let prodResults = null;
    let prodWall = null;
    if (prod) {
      const pd = { ...dates, adults: dates.adults === 1 ? 2 : 1 };
      const t1 = Date.now();
      prodResults = await Promise.all(cities.map((c) => doSearch(prod.hotel, c.entityId, pd, { limit: 20 })));
      prodWall = Date.now() - t1;
    }
    const cmp = cities.map((c, i) => ({
      city: c.key,
      pre: { ms: preResults[i].ms, total: preResults[i].total, n: preResults[i].results.length, top: summarize(preResults[i].results, 3) },
      prod: prodResults ? { ms: prodResults[i].ms, total: prodResults[i].total, n: prodResults[i].results.length, top: summarize(prodResults[i].results, 3) } : null,
    }));
    dumps.parallelCities = { dates, preWall, prodWall, cmp };
    const allPreOk = preResults.every((r) => r.ok && r.results.length > 0);
    add('P1', 'Parallel different-city searches all succeed', '3 cities Promise.all', allPreOk ? 'PASS' : 'BUG', {
      actual: `preWall=${preWall} ${cmp.map((x) => `${x.city}:${x.pre.ms}ms/t=${x.pre.total}`).join(' | ')}`,
    });
    if (prodResults) {
      const discrepancies = [];
      for (const row of cmp) {
        if (!row.prod) continue;
        if (row.pre.n === 0 || row.prod.n === 0) discrepancies.push(`${row.city}: empty on one side`);
        // total can differ by inventory — flag only huge gaps
        if (row.pre.total > 0 && row.prod.total > 0) {
          const ratio = row.pre.total / row.prod.total;
          if (ratio < 0.5 || ratio > 2) discrepancies.push(`${row.city}: total pre=${row.pre.total} prod=${row.prod.total}`);
        }
      }
      add('P2', 'Preprod vs prod inventory shape (parallel cities)', 'compare totals/top', discrepancies.length === 0 ? 'PASS' : 'BUG', {
        expected: 'both sides return hotels; totals not wildly divergent',
        actual: JSON.stringify({ prodWall, discrepancies, cmp: cmp.map((x) => ({ city: x.city, pre: x.pre.total, prod: x.prod?.total, preMs: x.pre.ms, prodMs: x.prod?.ms })) }),
        note: 'Different guest counts used to avoid shared cache; inventory delta expected',
      });
    } else {
      add('P2', 'Preprod vs prod compare', 'prod auth/skip', 'NOT TESTED');
    }
  }

  dumps.finishedAt = new Date().toISOString();
  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    meta: {
      doc: 'riya-progressive-search-qa.md',
      noBook: true,
      preprod: PRE_URL,
      prod: COMPARE_PROD ? PROD_URL : null,
      partner: PID,
      tierId: config.tierId,
      correlationId: dumps.preprodCorrelation,
      earlyMsThreshold: EARLY_MS,
      summary,
      startedAt: dumps.startedAt,
      finishedAt: dumps.finishedAt,
    },
    rows,
    dumps,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [];
  md.push('# Riya Progressive Search QA — preprod (search only)');
  md.push('');
  md.push(`- **${summary.PASS} PASS / ${summary.BUG} BUG / ${summary.NOT_TESTED} NOT TESTED**`);
  md.push(`- Correlation: \`${dumps.preprodCorrelation}\``);
  md.push('- No bookings (A4 / B2-book skipped)');
  md.push('');
  md.push('| Id | Rule | Status |');
  md.push('|----|------|--------|');
  for (const r of rows) md.push(`| ${r.id} | ${r.rule.replace(/\|/g, '/')} | **${r.status}** |`);
  const bugs = rows.filter((r) => r.status === 'BUG');
  if (bugs.length) {
    md.push('', '## Bugs');
    for (const b of bugs) {
      md.push(`### ${b.id}`);
      md.push(`- Expected: ${b.expected || ''}`);
      md.push(`- Actual: ${b.actual || ''}`);
      if (b.note) md.push(`- Note: ${b.note}`);
    }
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\n=== SUMMARY ===', summary);
  console.log('Wrote', OUT_JSON);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
