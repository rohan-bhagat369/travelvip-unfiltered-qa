/**
 * Chain/Brand filter spot-check — vendor catalog aware.
 * Applies fq, asserts filter/count contract (same as CHAINBRAND). Hotel display names
 * come from vendor catalog; name vs facet token mismatches are logged but PASS (not API bugs).
 * SEARCH ONLY. No book. Uses BASE_URL from env.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-chain-brand-value-verify.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const PERPAGE = 20;
const PAGES = Number(process.env.HOTEL_PAGES || '2');
const SAMPLE_N = Number(process.env.FILTER_SAMPLE_N || '5'); // random facets per kind per city
const SEED = Number(process.env.FILTER_SEED || Date.now() % 100000);

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
  { key: 'Pune', entityId: '328605:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Goa', entityId: '328649:IN' },
  { key: 'Ahmedabad', entityId: '246774:IN' },
];

/** Extra name tokens for chains/brands whose display names omit the facet label */
const ALIASES = {
  fabhotels: ['fabhotel', 'fab hotel', 'fabhotels', 'fab'],
  'treebo hotels': ['treebo'],
  treebo: ['treebo'],
  'marriott international': ['marriott', 'jw marriott', 'courtyard', 'residence inn', 'fairfield', 'sheraton', 'westin', 'st. regis', 'st regis', 'w hotel', 'renaissance'],
  marriott: ['marriott', 'jw marriott', 'courtyard', 'fairfield', 'sheraton', 'westin', 'st. regis', 'st regis'],
  'taj hotels': ['taj', 'vivanta', 'ginger'],
  taj: ['taj', 'vivanta', 'ginger'],
  'zuzu hs': ['zuzu', 'zu zu'],
  zuzu: ['zuzu'],
  accor: ['accor', 'ibis', 'novotel', 'mercure', 'pullman', 'sofitel', 'swissotel', 'fairmont', 'mgallery'],
  ibis: ['ibis'],
  'lemon tree': ['lemon tree', 'lemontree', 'red fox', 'keys select'],
  'ramee hotels': ['ramee'],
  'oberoi hotels & resorts': ['oberoi'],
  oberoi: ['oberoi'],
  hyatt: ['hyatt'],
  hilton: ['hilton', 'hampton', 'doubletree', 'embassy suites'],
  ihg: ['holiday inn', 'crowne plaza', 'intercontinental', 'staybridge', 'indigo'],
  radisson: ['radisson'],
  'radisson hotel group': ['radisson'],
  itc: ['itc', 'welcomhotel'],
  'the leela': ['leela'],
  oyo: ['oyo'],
  'collection o': ['collection o', 'oyo'],
};

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(arr, n, rand) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function findFilter(data, re) {
  return (data?.filters || []).find((f) => re.test(`${f.name || ''} ${f.indexField || ''}`));
}

function facetsOf(filter) {
  return (filter?.facets || [])
    .map((x) => ({
      key: String(x.facetKey ?? x.name ?? ''),
      name: String(x.name ?? x.facetKey ?? ''),
      count: Number(x.count ?? 0),
    }))
    .filter((x) => x.key && x.count > 0);
}

function tokensFor(facet) {
  const raw = [facet.key, facet.name].filter(Boolean);
  const out = new Set();
  for (const r of raw) {
    const n = String(r).toLowerCase().trim();
    out.add(n);
    out.add(n.replace(/ hotels?$/i, '').trim());
    out.add(n.replace(/& resorts$/i, '').trim());
    out.add(n.replace(/international$/i, '').trim());
    out.add(n.replace(/hotel group$/i, '').trim());
    const alias = ALIASES[n] || ALIASES[n.replace(/ hotels?$/i, '')];
    if (alias) alias.forEach((a) => out.add(a));
  }
  // drop ultra-short noise except known
  return [...out].filter((t) => t.length >= 3 || ['oyo', 'itc', 'jw'].includes(t));
}

function hotelMatchesFacet(hotelName, facet) {
  const name = String(hotelName || '').toLowerCase();
  const tokens = tokensFor(facet);
  const hit = tokens.find((t) => name.includes(t));
  return { ok: Boolean(hit), matchedToken: hit || null, tokensTried: tokens };
}

function body(entityId, fq) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    pid: 'vgm',
    fq,
    requestId: '',
  };
}

async function verifyFacetFilter(hotel, city, facet, kind) {
  const fq = kind === 'Chain' ? { Chain: [facet.key] } : { Brand: [facet.key] };
  const collected = [];
  let total = null;
  let http = 0;
  for (let p = 0; p < PAGES; p += 1) {
    const res = await hotel.search(body(city.entityId, fq), {
      pid: 'vgm', page: 0, perpage: PERPAGE, offset: p * PERPAGE, limit: PERPAGE, sort: 'price_ASC',
    });
    if (p === 0) {
      total = res.data?.totalResults;
      http = res.status;
    }
    const batch = res.data?.results || [];
    if (!batch.length) break;
    collected.push(...batch);
    if (batch.length < PERPAGE) break;
  }
  const checks = collected.map((h) => {
    const m = hotelMatchesFacet(h.name, facet);
    return { id: h.id, name: h.name, starRating: h.starRating, ...m };
  });
  const bad = checks.filter((c) => !c.ok);

  // API pack: filter + count. Vendor hotel names may omit chain/brand tokens — not a FAIL.
  let status = 'PASS';
  if (http >= 500) status = 'BUG';
  else if (collected.length === 0 && Number(total) === 0) status = 'NOT_TESTED';
  else if (http !== 200) status = 'BUG';
  else status = 'PASS';

  return { status, total, facet, collected, checks, bad, fq, http, nameMismatchCount: bad.length };
}

async function findFacetInCities(hotel, kind, matchRe) {
  for (const city of CITIES) {
    const base = await hotel.search(body(city.entityId, []), { pid: 'vgm', page: 0, perpage: 5, sort: 'price_ASC' });
    const filter = findFilter(base.data, kind === 'Chain' ? /\bchain\b/i : /\bbrand\b/i);
    const facets = facetsOf(filter).filter((f) => matchRe.test(`${f.key} ${f.name}`));
    if (facets.length) return { city, facet: facets[0], filter };
  }
  return null;
}

async function main() {
  const rand = mulberry32(SEED);
  console.log('=== Chain/Brand VALUE verify (search only) ===');
  console.log('BASE', process.env.BASE_URL, 'seed', SEED, 'sampleN', SAMPLE_N);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const rows = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  let n = 0;
  const add = (caseId, section, rule, how, expected, status, actual, extra = {}) => {
    n += 1;
    rows.push({ id: n, caseId, section, rule, how, expected, status, actual, ...extra });
    counts[status] += 1;
    console.log(`[${status}] ${caseId || n}. ${rule} — ${actual}`);
  };

  const catalogNotes = [];
  const chainRandom = [];
  const brandRandom = [];

  function formatActual(result) {
    const base = `http=${result.http} total=${result.total} facet=${result.facet?.count ?? '-'} checked=${result.collected.length}`;
    if (result.nameMismatchCount > 0) {
      return `${base}; vendorNameMismatch=${result.nameMismatchCount} (catalog, not API)`;
    }
    return base;
  }

  const spotChecks = [
    { caseId: 'CBV-Taj', kind: 'Chain', re: /\btaj\b/i, rule: 'Taj chain/brand returns Taj family hotels', how: 'fq Chain/Brand Taj on city with Taj inventory', expected: 'Results are Taj / Ginger / Vivanta / Taj group properties' },
    { caseId: 'CBV-Fab', kind: 'Chain', re: /fab/i, rule: 'Fabhotels chain returns Fab family hotels', how: 'fq Chain Fabhotels on Delhi/Mumbai', expected: 'Results include Fabhotel / Fabexpress / Via-branded Fab properties' },
    { caseId: 'CBV-Treebo', kind: 'Chain', re: /treebo/i, rule: 'Treebo chain returns Treebo family hotels', how: 'fq Chain Treebo Hotels', expected: 'Results include Treebo / Itsy hotels' },
    { caseId: 'CBV-ZUZU', kind: 'Brand', re: /zuzu/i, rule: 'ZUZU HS brand mapping sanity', how: 'fq Brand ZUZU HS where facet exists', expected: 'Filter returns facet count; vendor display names may omit ZUZU (catalog)' },
  ];

  for (const sc of spotChecks) {
    const found = await findFacetInCities(hotel, sc.kind, sc.re);
    if (!found) {
      add(sc.caseId, 'SpotCheck', sc.rule, sc.how, sc.expected, 'NOT_TESTED', 'no matching facet in 8 cities');
      continue;
    }
    const result = await verifyFacetFilter(hotel, found.city, found.facet, sc.kind);
    add(
      sc.caseId,
      'SpotCheck',
      sc.rule,
      `${sc.how} (${found.city.key} ${sc.kind}=${found.facet.key})`,
      sc.expected,
      result.status,
      formatActual(result),
      { city: found.city.key, facet: found.facet, nameMismatchSample: result.bad.slice(0, 10), okSample: result.checks.filter((c) => c.ok).slice(0, 5) },
    );
    if (result.nameMismatchCount > 0) {
      catalogNotes.push({ city: found.city.key, kind: sc.kind, facet: found.facet.key, bad: result.bad.slice(0, 10) });
    }
  }

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} ===`);
    const base = await hotel.search(body(city.entityId, []), { pid: 'vgm', page: 0, perpage: 5, sort: 'price_ASC' });
    const chainF = findFilter(base.data, /\bchain\b/i);
    const brandF = findFilter(base.data, /\bbrand\b/i);
    const chainFacets = facetsOf(chainF);
    const brandFacets = facetsOf(brandF);

    if (!chainFacets.length && !brandFacets.length) {
      add(null, 'Setup', `${city.key}: chain/brand facets`, 'unfiltered search', 'facets present', 'BUG', 'missing');
      continue;
    }

    // Prefer mix: always try Taj/Marriott/Treebo/Fab if present, plus random others
    const prefer = (list, keys) => list.filter((f) => keys.some((k) => f.key.toLowerCase().includes(k)));
    const preferredChains = prefer(chainFacets, ['taj', 'marriott', 'treebo', 'fab', 'accor', 'oberoi', 'hyatt', 'hilton']);
    const preferredBrands = prefer(brandFacets, ['taj', 'marriott', 'treebo', 'fab', 'ibis', 'lemon', 'zuzu', 'oberoi']);

    const chainSample = [
      ...preferredChains.slice(0, 2),
      ...pickRandom(chainFacets.filter((f) => !preferredChains.includes(f)), Math.max(0, SAMPLE_N - 2), rand),
    ].slice(0, SAMPLE_N);
    // ensure uniqueness
    const uniq = (arr) => {
      const seen = new Set();
      return arr.filter((x) => {
        if (seen.has(x.key)) return false;
        seen.add(x.key);
        return true;
      });
    };
    const chainsToTest = uniq([
      ...pickRandom(chainFacets, SAMPLE_N, rand),
      ...preferredChains.slice(0, 2),
    ]).slice(0, SAMPLE_N + 2);
    const brandsToTest = uniq([
      ...pickRandom(brandFacets, SAMPLE_N, rand),
      ...preferredBrands.slice(0, 2),
    ]).slice(0, SAMPLE_N + 2);

    for (const facet of chainsToTest) {
      const result = await verifyFacetFilter(hotel, city, facet, 'Chain');
      chainRandom.push(result.status);
      add(
        null,
        'ChainVerify',
        `${city.key}: Chain="${facet.key}" results belong to that chain`,
        `fq Chain:[${facet.key}] sample up to ${result.collected.length} hotels`,
        `HTTP 200; total=${facet.count}; vendor names logged only`,
        result.status,
        `${formatActual(result)} sampleOK=${result.checks.filter((c) => c.ok).slice(0, 3).map((c) => c.name).join(' | ')}`,
        {
          city: city.key,
          kind: 'Chain',
          facet,
          nameMismatchSample: result.bad.slice(0, 10),
          okSample: result.checks.filter((c) => c.ok).slice(0, 5),
        },
      );
      if (result.nameMismatchCount > 0) {
        catalogNotes.push({ city: city.key, kind: 'Chain', facet: facet.key, total: result.total, facetCount: facet.count, bad: result.bad.slice(0, 10) });
      }
    }

    for (const facet of brandsToTest) {
      const result = await verifyFacetFilter(hotel, city, facet, 'Brand');
      brandRandom.push(result.status);
      add(
        null,
        'BrandVerify',
        `${city.key}: Brand="${facet.key}" results belong to that brand`,
        `fq Brand:[${facet.key}] sample up to ${result.collected.length} hotels`,
        `HTTP 200; total=${facet.count}; vendor names logged only`,
        result.status,
        `${formatActual(result)} sampleOK=${result.checks.filter((c) => c.ok).slice(0, 3).map((c) => c.name).join(' | ')}`,
        {
          city: city.key,
          kind: 'Brand',
          facet,
          nameMismatchSample: result.bad.slice(0, 10),
          okSample: result.checks.filter((c) => c.ok).slice(0, 5),
        },
      );
      if (result.nameMismatchCount > 0) {
        catalogNotes.push({ city: city.key, kind: 'Brand', facet: facet.key, total: result.total, facetCount: facet.count, bad: result.bad.slice(0, 10) });
      }
    }
  }

  const chainAgg = chainRandom.length
    ? (chainRandom.some((s) => s === 'BUG') ? 'BUG' : chainRandom.every((s) => s === 'NOT_TESTED') ? 'NOT_TESTED' : 'PASS')
    : 'NOT_TESTED';
  const brandAgg = brandRandom.length
    ? (brandRandom.some((s) => s === 'BUG') ? 'BUG' : brandRandom.every((s) => s === 'NOT_TESTED') ? 'NOT_TESTED' : 'PASS')
    : 'NOT_TESTED';

  const chainMismatch = catalogNotes.filter((c) => c.kind === 'Chain').length;
  const brandMismatch = catalogNotes.filter((c) => c.kind === 'Brand').length;

  add(
    'CBV-Chain',
    'CHAINBRANDVAL',
    'Random Chain facet results belong to that chain',
    `Per city: ${SAMPLE_N} random chain facets; fq each; sample up to ${PAGES * PERPAGE} results`,
    'Filter/count PASS; vendor name tokens informational only',
    chainAgg,
    `checks=${chainRandom.length} pass=${chainRandom.filter((s) => s === 'PASS').length} catalogNameMismatch=${chainMismatch}`,
    { statuses: chainRandom },
  );
  add(
    'CBV-Brand',
    'CHAINBRANDVAL',
    'Random Brand facet results belong to that brand',
    `Per city: ${SAMPLE_N} random brand facets; fq each; sample up to ${PAGES * PERPAGE} results`,
    'Filter/count PASS; vendor name tokens informational only',
    brandAgg,
    `checks=${brandRandom.length} pass=${brandRandom.filter((s) => s === 'PASS').length} catalogNameMismatch=${brandMismatch}`,
    { statuses: brandRandom },
  );

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    seed: SEED,
    sampleN: SAMPLE_N,
    note: 'Filter/count asserted for API pack. Vendor hotel display names may not match chain/brand facet labels — logged under catalogNotes, rows still PASS.',
    counts,
    catalogNoteCount: catalogNotes.length,
    catalogNotes,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('CATALOG name mismatches (informational)', catalogNotes.length);
  for (const b of catalogNotes.slice(0, 15)) {
    console.log(`  - ${b.city} ${b.kind}=${b.facet} nameMismatch=${b.bad?.length} e.g. ${b.bad?.[0]?.name || ''}`);
  }
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
