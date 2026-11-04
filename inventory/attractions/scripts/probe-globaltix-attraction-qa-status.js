/**
 * Match GlobalTix CSV Attraction products (10 popular countries) to live
 * tours-and-attractions search + carousels APIs by name + country + city.
 * Adds column: working_qa_status = yes | no | not found
 *
 *   ATTR_BEARER=... node scripts/probe-globaltix-attraction-qa-status.js
 */
import fs from 'fs';

const CSV_IN = 'Final production globaltix sheet - globaltix_products_full (1).csv';
const CSV_OUT = 'Final production globaltix sheet - globaltix_products_full (1).csv';
const REPORT = 'reports/globaltix-attraction-qa-status.json';
const BASE = process.env.ATTR_BASE_URL || 'https://api.travelvip.ai';
const BEARER =
  process.env.ATTR_BEARER ||
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OGYwOGZiZmYwYWZmNi4xMjM4MjE2NiIsInRva2VuRGF0ZSI6IjIwMjYtMDktMTAgMTI6NTM6MjgifQ.NcGa1M46EQfkE_MoV6yPNg8B8jwQ8Gd64bAdYu5WzoI0V2';
const QUERY =
  'key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';
const TIMEOUT_MS = Number(process.env.ATTR_TIMEOUT_MS || 60000);

/** Popular market countries + primary city for carousel filter */
const COUNTRIES = [
  { country: 'Singapore', city: 'Singapore', searchQ: 'singapore' },
  { country: 'Thailand', city: 'Bangkok', searchQ: 'bangkok' },
  { country: 'United Arab Emirates', city: 'Dubai', searchQ: 'dubai' },
  { country: 'Malaysia', city: 'Kuala Lumpur', searchQ: 'kuala lumpur' },
  { country: 'Indonesia', city: 'Bali', searchQ: 'bali' },
  { country: 'Japan', city: 'Tokyo', searchQ: 'tokyo' },
  { country: 'France', city: 'Paris', searchQ: 'paris' },
  { country: 'United Kingdom', city: 'London', searchQ: 'london' },
  { country: 'Hong Kong', city: 'Hong Kong', searchQ: 'hong kong' },
  { country: 'Vietnam', city: 'Da Nang', searchQ: 'da nang' },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || (c === '\r' && n === '\n')) {
      if (c === '\r') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cityAliases(city) {
  const n = norm(city);
  const map = {
    'hong kong': ['hong kong', 'hongkong'],
    'kuala lumpur': ['kuala lumpur', 'kl'],
    'da nang': ['da nang', 'danang'],
    'hoi an': ['hoi an', 'hoian'],
    'abu dhabi': ['abu dhabi', 'abudhabi'],
  };
  return map[n] || [n];
}

function namesLooselyEqual(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // contain either way if long enough
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function cityMatch(csvCity, apiCity, countryFilterCity) {
  const c = norm(csvCity);
  if (!c) return true; // CSV city blank → country-level match only
  const candidates = [
    ...cityAliases(apiCity),
    ...cityAliases(countryFilterCity),
    norm(apiCity),
  ].filter(Boolean);
  if (candidates.some((x) => x === c || (c.length >= 4 && x.includes(c)) || (x.length >= 4 && c.includes(x)))) {
    return true;
  }
  // same country listing often tags city as country capital; allow country-wide if api city empty
  if (!norm(apiCity)) return true;
  return false;
}

async function fetchJson(url, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${BEARER}`,
        Accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, data, timedOut: false };
  } catch (e) {
    const timedOut = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e));
    return {
      ok: false,
      status: 0,
      data: { error: String(e?.message || e) },
      timedOut,
    };
  } finally {
    clearTimeout(t);
  }
}

async function loadCountryApiCatalog(cfg) {
  const searchUrl = `${BASE}/api/airportServices/tours-and-attractions/search?${QUERY}&q=${encodeURIComponent(cfg.searchQ)}&page=0&size=100`;
  const carouselBase = `${BASE}/api/airportServices/carousels?${QUERY}&type=tab&slug=tours-experiences-list`;

  const search = await fetchJson(searchUrl);
  if (search.timedOut) {
    return { timedOut: true, where: 'search', search, carousel: null, products: [] };
  }

  // probe totalCount then fetch full page
  let carousel = await fetchJson(`${carouselBase}&size=50`, {
    method: 'POST',
    body: { appliedFilters: { city: cfg.city, country: cfg.country } },
  });
  if (carousel.timedOut) {
    return { timedOut: true, where: 'carousels', search, carousel, products: [] };
  }

  const probeBlock = (carousel.data?.results || []).find(
    (b) => /attraction/i.test(String(b.type || '')) || b.contentType === 'PRODUCTS',
  );
  const total = Number(probeBlock?.totalCount || 0);
  if (total > 50) {
    const fullSize = Math.min(Math.max(total, 50), 1000);
    const full = await fetchJson(`${carouselBase}&size=${fullSize}`, {
      method: 'POST',
      body: { appliedFilters: { city: cfg.city, country: cfg.country } },
    });
    if (full.timedOut) {
      return { timedOut: true, where: 'carousels-full', search, carousel: full, products: [] };
    }
    carousel = full;
  }

  const products = [];

  for (const r of search.data?.results || []) {
    if (String(r.entityType).toUpperCase() !== 'PRODUCT') continue;
    products.push({
      source: 'search',
      id: r.entityId,
      title: r.title,
      city: r.city,
      country: r.country,
    });
  }

  const blocks = carousel.data?.results || [];
  for (const block of blocks) {
    if (!/attraction/i.test(String(block.type || '')) && block.contentType !== 'PRODUCTS') continue;
    for (const p of block.data || []) {
      products.push({
        source: 'carousel',
        id: p.productId,
        title: p.title,
        city: cfg.city,
        country: cfg.country,
        category: p.category,
        totalAmount: p.startingPrice?.totalAmount,
      });
    }
  }

  const byTitle = new Map();
  for (const p of products) {
    const k = norm(p.title);
    if (!k) continue;
    if (!byTitle.has(k)) byTitle.set(k, p);
  }

  return {
    timedOut: false,
    searchHttp: search.status,
    carouselHttp: carousel.status,
    searchOk: search.ok,
    carouselOk: carousel.ok,
    carouselTotalCount: total,
    searchError: search.data?.error || search.data?.message || null,
    carouselError: carousel.data?.error || carousel.data?.message || null,
    productCount: byTitle.size,
    products: [...byTitle.values()],
    search,
    carousel,
  };
}

console.log('Loading CSV…');
const raw = fs.readFileSync(CSV_IN, 'utf8');
const table = parseCsv(raw);
const header = table[0];
const col = Object.fromEntries(header.map((n, i) => [n, i]));

const STATUS_COL = 'working_qa_status';
let statusIdx = header.indexOf(STATUS_COL);
if (statusIdx < 0) {
  header.push(STATUS_COL);
  statusIdx = header.length - 1;
  for (let i = 1; i < table.length; i++) {
    while (table[i].length < header.length) table[i].push('');
  }
} else {
  for (let i = 1; i < table.length; i++) {
    while (table[i].length < header.length) table[i].push('');
  }
}

const targetCountries = new Set(COUNTRIES.map((c) => c.country));
const countryApi = {};
const timeouts = [];

for (const cfg of COUNTRIES) {
  console.log(`\n=== ${cfg.country} / ${cfg.city} ===`);
  const cat = await loadCountryApiCatalog(cfg);
  countryApi[cfg.country] = cat;
  if (cat.timedOut) {
    timeouts.push({ country: cfg.country, where: cat.where });
    console.log('TIMEOUT', cfg.country, cat.where);
    continue;
  }
  console.log(
    `search=${cat.searchHttp} carousel=${cat.carouselHttp} apiProducts=${cat.productCount} totalCount=${cat.carouselTotalCount || '-'}`,
  );
  if (cat.searchHttp === 401 || cat.carouselHttp === 401) {
    console.log('AUTH FAILED — need new Bearer');
  }
}

if (timeouts.length) {
  console.log('\nTIMEOUTS:', timeouts);
}

const authFailed = COUNTRIES.some((c) => {
  const a = countryApi[c.country];
  return a && (a.searchHttp === 401 || a.carouselHttp === 401);
});

const summary = {
  yes: 0,
  no: 0,
  'not found': 0,
  blank: 0,
  byCountry: {},
};

for (const c of COUNTRIES) {
  summary.byCountry[c.country] = { yes: 0, no: 0, 'not found': 0, skippedAuthOrTimeout: 0 };
}

for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 5) continue;
  while (row.length < header.length) row.push('');

  const country = (row[col.country] || '').trim();
  const cat = (row[col.category] || '').trim();
  const isAttraction = /attraction/i.test(cat);
  const inScope = targetCountries.has(country) && isAttraction;

  if (!inScope) {
    // leave existing blank for out-of-scope rows
    if (!row[statusIdx]) {
      row[statusIdx] = '';
      summary.blank++;
    }
    continue;
  }

  const api = countryApi[country];
  if (!api || api.timedOut) {
    row[statusIdx] = 'no';
    summary.no++;
    summary.byCountry[country].no++;
    summary.byCountry[country].skippedAuthOrTimeout++;
    continue;
  }
  if (api.searchHttp === 401 || api.carouselHttp === 401) {
    row[statusIdx] = 'no';
    summary.no++;
    summary.byCountry[country].no++;
    continue;
  }
  if (!api.searchOk && !api.carouselOk) {
    row[statusIdx] = 'no';
    summary.no++;
    summary.byCountry[country].no++;
    continue;
  }
  if (api.productCount === 0) {
    row[statusIdx] = 'not found';
    summary['not found']++;
    summary.byCountry[country]['not found']++;
    continue;
  }

  const csvName = row[col.product_name];
  const csvCity = row[col.city];
  const cfg = COUNTRIES.find((x) => x.country === country);
  const hit = api.products.find(
    (p) =>
      namesLooselyEqual(csvName, p.title) &&
      cityMatch(csvCity, p.city, cfg.city) &&
      (!p.country || norm(p.country) === norm(country) || namesLooselyEqual(p.country, country)),
  );

  if (hit) {
    row[statusIdx] = 'yes';
    summary.yes++;
    summary.byCountry[country].yes++;
  } else {
    row[statusIdx] = 'not found';
    summary['not found']++;
    summary.byCountry[country]['not found']++;
  }
}

console.log('\nWriting CSV…');
const outLines = table.map((r) => r.map(csvEscape).join(','));
fs.writeFileSync(CSV_OUT, outLines.join('\n') + '\n', 'utf8');

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  timeouts,
  authFailed,
  summary,
  countries: Object.fromEntries(
    COUNTRIES.map((c) => {
      const a = countryApi[c.country] || {};
      return [
        c.country,
        {
          city: c.city,
          timedOut: !!a.timedOut,
          searchHttp: a.searchHttp,
          carouselHttp: a.carouselHttp,
          apiProductCount: a.productCount || 0,
          sampleTitles: (a.products || []).slice(0, 8).map((p) => p.title),
        },
      ];
    }),
  ),
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', summary);
console.log('Wrote', CSV_OUT);
console.log('Wrote', REPORT);

if (authFailed) {
  console.log('\nNEED NEW BEARER: API returned 401');
  process.exit(2);
}
if (timeouts.length) {
  console.log('\nNEED NEW CURLS / RETRY: timeouts on', timeouts.map((t) => t.country).join(', '));
  process.exit(3);
}
process.exit(0);
