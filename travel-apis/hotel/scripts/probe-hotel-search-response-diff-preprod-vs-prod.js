/**
 * Exact hotel search response diff — preprod vs prod (large cities).
 * Search only, no book. Fresh dates per city/env.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const PRE = 'https://preprod-api.travelvip.ai';
const PROD = 'https://api.travelvip.ai';
const PID = 'vgm';
const OUT_JSON = path.join('reports', 'hotel-search-response-diff-preprod-vs-prod.json');
const OUT_MD = path.join('reports', 'hotel-search-response-diff-preprod-vs-prod.md');

process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const CITIES = [
  { key: 'Paris', entityId: '2734:FR' },
  { key: 'Dubai', entityId: '221688:AE' },
  { key: 'Bangkok', entityId: '328619:TH' },
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function datesFor(cityIndex, envIndex) {
  // Same stay window per city across envs so inventory is comparable;
  // adults differ slightly to reduce accidental shared partner cache if any.
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + 60 + cityIndex * 4);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + 2);
  return {
    checkin: ymd(checkin),
    checkout: ymd(checkout),
    adults: envIndex === 0 ? 1 : 2,
  };
}

function searchBody(entityId, dates) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: dates.checkin,
    checkout: dates.checkout,
    type: 'CITY',
    rooms: [{ adults: dates.adults, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
}

async function auth(baseUrl) {
  process.env.BASE_URL = baseUrl;
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  return {
    hotel: new HotelService(session.client),
    correlationId: session.client.correlationId,
    baseUrl,
  };
}

function stripVolatile(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const skip = new Set([
    'requestId', 'cacheTimeStamp', '_meta', 'correlation_id',
    'timestamp', 'request_id',
  ]);
  if (Array.isArray(obj)) return obj.map(stripVolatile);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    out[k] = stripVolatile(v);
  }
  return out;
}

function topKeys(data) {
  return Object.keys(data || {}).sort();
}

function filterNames(data) {
  return (data?.filters || []).map((f) => ({
    name: f.name || null,
    indexField: f.indexField || null,
    facetCount: Array.isArray(f.facets) ? f.facets.length : 0,
  }));
}

function sortNames(data) {
  return (data?.sorts || []).map((s) => s.code || s.name || s.value || JSON.stringify(s));
}

function hotelLite(h) {
  return {
    id: String(h?.id || h?.entityId || ''),
    name: h?.name || null,
    star: h?.starRating ?? null,
    available: h?.available ?? null,
    baseFare: h?.price?.baseFare ?? null,
    totalAmount: h?.price?.totalAmount ?? null,
    currency: h?.price?.currency || h?.currency || null,
    distance: h?.distance ?? null,
    mealType: h?.mealType ?? h?.boardBasis ?? null,
    propertyType: h?.propertyType ?? null,
    brand: h?.brand ?? null,
    chain: h?.chain ?? null,
    keys: Object.keys(h || {}).sort(),
  };
}

function resultKeysUnion(results) {
  const set = new Set();
  for (const h of results || []) {
    for (const k of Object.keys(h || {})) set.add(k);
  }
  return [...set].sort();
}

function priceStats(results) {
  const prices = (results || [])
    .map((h) => Number(h?.price?.totalAmount ?? h?.price?.baseFare))
    .filter((n) => Number.isFinite(n));
  if (!prices.length) return null;
  return {
    count: prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    negatives: prices.filter((p) => p < 0).length,
  };
}

async function doSearch(hotel, entityId, dates) {
  const t0 = Date.now();
  const res = await hotel.search(searchBody(entityId, dates), {
    pid: PID,
    offset: 0,
    limit: 20,
  });
  const ms = Date.now() - t0;
  const data = res.data || {};
  return {
    ms,
    http: res.status,
    ok: Boolean(res.ok),
    code: data?.error?.code || null,
    data,
    results: Array.isArray(data.results) ? data.results : [],
  };
}

/** Poll until total stabilizes or max polls — capture early + final. */
async function searchWithGrowth(hotel, entityId, dates, { polls = 6, gapMs = 4000 } = {}) {
  const series = [];
  for (let i = 0; i < polls; i += 1) {
    const r = await doSearch(hotel, entityId, dates);
    series.push({
      i,
      ms: r.ms,
      total: r.data.totalResults,
      available: r.data.availableResults,
      n: r.results.length,
      fromCache: r.data.fromCache,
      last: r.data.last,
      page: r.data.page,
      size: r.data.size,
      offset: r.data.offset,
      totalPages: r.data.totalPages,
    });
    if (i < polls - 1) await sleep(gapMs);
  }
  const first = await doSearch(hotel, entityId, dates); // one more for structure snapshot (cached final-ish)
  // Use first cold + last poll for growth; structure from last full response
  const cold = series[0];
  const lastMeta = series[series.length - 1];
  // Re-fetch once more to get full payload at final total
  const finalRes = await doSearch(hotel, entityId, dates);
  return {
    dates,
    series,
    cold,
    finalMeta: {
      ms: finalRes.ms,
      total: finalRes.data.totalResults,
      available: finalRes.data.availableResults,
      fromCache: finalRes.data.fromCache,
      n: finalRes.results.length,
    },
    response: {
      topLevelKeys: topKeys(finalRes.data),
      envelope: {
        page: finalRes.data.page,
        size: finalRes.data.size,
        offset: finalRes.data.offset,
        totalResults: finalRes.data.totalResults,
        totalPages: finalRes.data.totalPages,
        availableResults: finalRes.data.availableResults,
        last: finalRes.data.last,
        currency: finalRes.data.currency,
        fromCache: finalRes.data.fromCache,
        hasProgress: finalRes.data.progress != null,
        hasPartial: finalRes.data.partial != null,
        priceRangeFilter: finalRes.data.priceRangeFilter ?? null,
      },
      filterNames: filterNames(finalRes.data),
      sortNames: sortNames(finalRes.data),
      resultFieldKeys: resultKeysUnion(finalRes.results),
      priceStats: priceStats(finalRes.results),
      top20: finalRes.results.map(hotelLite),
      sampleHotelKeys: Object.keys(finalRes.results[0] || {}).sort(),
      sampleHotel: hotelLite(finalRes.results[0] || {}),
    },
    coldResponse: null,
  };
}

function arrDiff(a = [], b = []) {
  const as = new Set(a.map(String));
  const bs = new Set(b.map(String));
  return {
    onlyPre: [...as].filter((x) => !bs.has(x)).sort(),
    onlyProd: [...bs].filter((x) => !as.has(x)).sort(),
    shared: [...as].filter((x) => bs.has(x)).sort(),
  };
}

function compareCity(pre, prod) {
  const top = arrDiff(pre.response.topLevelKeys, prod.response.topLevelKeys);
  const resultFields = arrDiff(pre.response.resultFieldKeys, prod.response.resultFieldKeys);
  const sampleKeys = arrDiff(pre.response.sampleHotelKeys, prod.response.sampleHotelKeys);
  const preFilters = pre.response.filterNames.map((f) => f.indexField || f.name);
  const prodFilters = prod.response.filterNames.map((f) => f.indexField || f.name);
  const filters = arrDiff(preFilters, prodFilters);
  const sorts = arrDiff(pre.response.sortNames.map(String), prod.response.sortNames.map(String));

  const preIds = new Set(pre.response.top20.map((h) => h.id));
  const prodIds = new Set(prod.response.top20.map((h) => h.id));
  const idOverlap = [...preIds].filter((id) => prodIds.has(id));

  const orderPre = pre.response.top20.map((h) => h.id).join(',');
  const orderProd = prod.response.top20.map((h) => h.id).join(',');

  const diffs = [];
  if (top.onlyPre.length || top.onlyProd.length) {
    diffs.push({ field: 'topLevelKeys', onlyPre: top.onlyPre, onlyProd: top.onlyProd });
  }
  if (resultFields.onlyPre.length || resultFields.onlyProd.length) {
    diffs.push({ field: 'hotel result keys', onlyPre: resultFields.onlyPre, onlyProd: resultFields.onlyProd });
  }
  if (filters.onlyPre.length || filters.onlyProd.length) {
    diffs.push({ field: 'filters', onlyPre: filters.onlyPre, onlyProd: filters.onlyProd });
  }
  if (sorts.onlyPre.length || sorts.onlyProd.length) {
    diffs.push({ field: 'sorts', onlyPre: sorts.onlyPre, onlyProd: sorts.onlyProd });
  }

  const envPre = pre.response.envelope;
  const envProd = prod.response.envelope;
  const envelopeDiffs = [];
  for (const k of new Set([...Object.keys(envPre), ...Object.keys(envProd)])) {
    if (['fromCache'].includes(k)) continue;
    const a = envPre[k];
    const b = envProd[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      envelopeDiffs.push({ key: k, preprod: a, prod: b });
    }
  }

  return {
    progressive: {
      pre: { coldMs: pre.cold.ms, coldTotal: pre.cold.total, finalTotal: pre.finalMeta.total, grew: pre.finalMeta.total > (pre.cold.total || 0) * 2 },
      prod: { coldMs: prod.cold.ms, coldTotal: prod.cold.total, finalTotal: prod.finalMeta.total, grew: prod.finalMeta.total > (prod.cold.total || 0) * 2 },
    },
    structure: {
      topLevelKeys: top,
      resultFieldKeys: resultFields,
      sampleHotelKeys: sampleKeys,
      filters,
      sorts,
    },
    envelopeDiffs,
    inventory: {
      preTotal: pre.finalMeta.total,
      prodTotal: prod.finalMeta.total,
      totalDelta: (pre.finalMeta.total || 0) - (prod.finalMeta.total || 0),
      top20Overlap: idOverlap.length,
      top20OrderSame: orderPre === orderProd,
      onlyInPreTop20: [...preIds].filter((id) => !prodIds.has(id)),
      onlyInProdTop20: [...prodIds].filter((id) => !preIds.has(id)),
    },
    diffs,
    identicalStructure: diffs.length === 0 && envelopeDiffs.filter((e) => !['totalResults', 'availableResults', 'totalPages'].includes(e.key)).length === 0,
  };
}

async function main() {
  console.log('=== Exact search response diff: preprod vs prod ===');
  const preAuth = await auth(PRE);
  const prodAuth = await auth(PROD);

  const cities = [];
  for (let i = 0; i < CITIES.length; i += 1) {
    const city = CITIES[i];
    // Same checkin/checkout string for both envs for fair inventory compare
    const sharedDates = datesFor(i, 0);
    const preDates = { ...sharedDates, adults: 1 };
    const prodDates = { ...sharedDates, adults: 1 }; // exact same occupancy too

    console.log(`\n## ${city.key} ${sharedDates.checkin}→${sharedDates.checkout}`);
    console.log('  preprod cold+poll...');
    const pre = await searchWithGrowth(preAuth.hotel, city.entityId, preDates);
    console.log(`  pre cold ${pre.cold.ms}ms t=${pre.cold.total} → final ${pre.finalMeta.total}`);
    console.log('  prod cold+poll...');
    const prod = await searchWithGrowth(prodAuth.hotel, city.entityId, prodDates);
    console.log(`  prod cold ${prod.cold.ms}ms t=${prod.cold.total} → final ${prod.finalMeta.total}`);

    const comparison = compareCity(pre, prod);
    cities.push({
      city: city.key,
      entityId: city.entityId,
      dates: sharedDates,
      preprod: {
        baseUrl: PRE,
        cold: pre.cold,
        finalMeta: pre.finalMeta,
        series: pre.series,
        response: pre.response,
      },
      prod: {
        baseUrl: PROD,
        cold: prod.cold,
        finalMeta: prod.finalMeta,
        series: prod.series,
        response: prod.response,
      },
      comparison,
    });
  }

  const report = {
    meta: {
      at: new Date().toISOString(),
      noBook: true,
      preprod: PRE,
      prod: PROD,
      preCorrelation: preAuth.correlationId,
      prodCorrelation: prodAuth.correlationId,
      note: 'Same city/dates/adults=1 on both envs. Poll series shows progressive growth. Structure + top20 compared after final totals.',
    },
    cities,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [];
  md.push('# Hotel search response — Preprod vs Prod (exact diff)');
  md.push('');
  md.push(`- Preprod: \`${PRE}\``);
  md.push(`- Prod: \`${PROD}\``);
  md.push(`- Same dates & 1ADT per city; search only`);
  md.push('');

  for (const c of cities) {
    md.push(`## ${c.city} (${c.dates.checkin} → ${c.dates.checkout})`);
    md.push('');
    md.push('| | Preprod | Prod |');
    md.push('|-|---------|------|');
    md.push(`| Cold first | ${c.preprod.cold.ms}ms · total=${c.preprod.cold.total} | ${c.prod.cold.ms}ms · total=${c.prod.cold.total} |`);
    md.push(`| Final total | ${c.preprod.finalMeta.total} | ${c.prod.finalMeta.total} |`);
    md.push(`| Grew early→full | ${c.comparison.progressive.pre.grew} | ${c.comparison.progressive.prod.grew} |`);
    md.push(`| Top20 overlap | ${c.comparison.inventory.top20Overlap}/20 | order same: ${c.comparison.inventory.top20OrderSame} |`);
    md.push('');

    md.push('### Progressive poll series');
    md.push('| Poll | Preprod ms / total | Prod ms / total |');
    md.push('|------|--------------------|-----------------|');
    const maxP = Math.max(c.preprod.series.length, c.prod.series.length);
    for (let i = 0; i < maxP; i += 1) {
      const a = c.preprod.series[i];
      const b = c.prod.series[i];
      md.push(`| ${i} | ${a ? `${a.ms}/${a.total}` : '-'} | ${b ? `${b.ms}/${b.total}` : '-'} |`);
    }
    md.push('');

    md.push('### Envelope');
    md.push('```');
    md.push(`pre:  ${JSON.stringify(c.preprod.response.envelope)}`);
    md.push(`prod: ${JSON.stringify(c.prod.response.envelope)}`);
    md.push('```');
    if (c.comparison.envelopeDiffs.length) {
      md.push('Envelope field diffs:');
      for (const d of c.comparison.envelopeDiffs) {
        md.push(`- **${d.key}**: preprod=\`${JSON.stringify(d.preprod)}\` · prod=\`${JSON.stringify(d.prod)}\``);
      }
    } else {
      md.push('_No envelope field diffs (excluding cache)._');
    }
    md.push('');

    md.push('### Schema / keys');
    md.push(`- Top-level keys only on preprod: ${c.comparison.structure.topLevelKeys.onlyPre.join(', ') || '(none)'}`);
    md.push(`- Top-level keys only on prod: ${c.comparison.structure.topLevelKeys.onlyProd.join(', ') || '(none)'}`);
    md.push(`- Hotel fields only on preprod: ${c.comparison.structure.resultFieldKeys.onlyPre.join(', ') || '(none)'}`);
    md.push(`- Hotel fields only on prod: ${c.comparison.structure.resultFieldKeys.onlyProd.join(', ') || '(none)'}`);
    md.push(`- Filters only on preprod: ${c.comparison.structure.filters.onlyPre.join(', ') || '(none)'}`);
    md.push(`- Filters only on prod: ${c.comparison.structure.filters.onlyProd.join(', ') || '(none)'}`);
    md.push(`- Sorts only on preprod: ${c.comparison.structure.sorts.onlyPre.join(', ') || '(none)'}`);
    md.push(`- Sorts only on prod: ${c.comparison.structure.sorts.onlyProd.join(', ') || '(none)'}`);
    md.push('');

    md.push('### Top 20 hotels');
    md.push('| # | Preprod | Prod |');
    md.push('|-|---------|------|');
    for (let i = 0; i < 20; i += 1) {
      const a = c.preprod.response.top20[i];
      const b = c.prod.response.top20[i];
      const al = a ? `${a.name} (${a.id}) ★${a.star} ₹${a.totalAmount}` : '-';
      const bl = b ? `${b.name} (${b.id}) ★${b.star} ₹${b.totalAmount}` : '-';
      md.push(`| ${i + 1} | ${al} | ${bl} |`);
    }
    md.push('');
    if (c.comparison.inventory.onlyInPreTop20.length) {
      md.push(`Only in preprod top20 ids: ${c.comparison.inventory.onlyInPreTop20.join(', ')}`);
    }
    if (c.comparison.inventory.onlyInProdTop20.length) {
      md.push(`Only in prod top20 ids: ${c.comparison.inventory.onlyInProdTop20.join(', ')}`);
    }
    md.push('');
  }

  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\nWrote', OUT_JSON, OUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
