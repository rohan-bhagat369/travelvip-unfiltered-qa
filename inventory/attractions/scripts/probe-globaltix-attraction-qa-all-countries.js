/**
 * Full GlobalTix Attraction QA: ALL countries + cities from CSV vs live APIs.
 * Updates working_qa_status = yes | no | not found
 *
 *   ATTR_BEARER=... node scripts/probe-globaltix-attraction-qa-all-countries.js
 */
import fs from 'fs';

const CSV_PATH = 'Final production globaltix sheet - globaltix_products_full (1).csv';
const REPORT = 'reports/globaltix-attraction-qa-all-countries.json';
const PROGRESS = 'reports/globaltix-attraction-qa-progress.json';
const BASE = process.env.ATTR_BASE_URL || 'https://api.travelvip.ai';
const BEARER =
  process.env.ATTR_BEARER ||
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OGYwOGZiZmYwYWZmNi4xMjM4MjE2NiIsInRva2VuRGF0ZSI6IjIwMjYtMDktMTAgMTI6NTM6MjgifQ.NcGa1M46EQfkE_MoV6yPNg8B8jwQ8Gd64bAdYu5WzoI0V2';
const QUERY =
  'key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';
const TIMEOUT_MS = Number(process.env.ATTR_TIMEOUT_MS || 90000);

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

function namesLooselyEqual(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function cityMatch(csvCity, apiCity, filterCity) {
  const c = norm(csvCity);
  if (!c) return true;
  const candidates = [norm(apiCity), norm(filterCity)].filter(Boolean);
  return candidates.some(
    (x) => x === c || (c.length >= 4 && x.includes(c)) || (x.length >= 4 && c.includes(x)),
  );
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
      data = { raw: text.slice(0, 400) };
    }
    return { ok: res.ok, status: res.status, data, timedOut: false };
  } catch (e) {
    const timedOut = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e));
    return { ok: false, status: 0, data: { error: String(e?.message || e) }, timedOut };
  } finally {
    clearTimeout(t);
  }
}

async function loadCityCatalog(country, city) {
  const q = city || country;
  const searchUrl = `${BASE}/api/airportServices/tours-and-attractions/search?${QUERY}&q=${encodeURIComponent(q)}&page=0&size=100`;
  const carouselBase = `${BASE}/api/airportServices/carousels?${QUERY}&type=tab&slug=tours-experiences-list`;

  const search = await fetchJson(searchUrl);
  if (search.timedOut) return { timedOut: true, where: 'search', products: [], search, carousel: null };
  if (search.status === 401) return { authFailed: true, where: 'search', products: [], search, carousel: null };

  let carousel = await fetchJson(`${carouselBase}&size=50`, {
    method: 'POST',
    body: { appliedFilters: { city: city || country, country } },
  });
  if (carousel.timedOut) return { timedOut: true, where: 'carousels', products: [], search, carousel };
  if (carousel.status === 401) return { authFailed: true, where: 'carousels', products: [], search, carousel };

  const probe = (carousel.data?.results || []).find(
    (b) => /attraction/i.test(String(b.type || '')) || b.contentType === 'PRODUCTS',
  );
  const total = Number(probe?.totalCount || 0);
  if (total > 50) {
    const fullSize = Math.min(Math.max(total, 50), 1000);
    const full = await fetchJson(`${carouselBase}&size=${fullSize}`, {
      method: 'POST',
      body: { appliedFilters: { city: city || country, country } },
    });
    if (full.timedOut) return { timedOut: true, where: 'carousels-full', products: [], search, carousel: full };
    if (full.status === 401) return { authFailed: true, where: 'carousels-full', products: [], search, carousel: full };
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
  for (const block of carousel.data?.results || []) {
    if (!/attraction/i.test(String(block.type || '')) && block.contentType !== 'PRODUCTS') continue;
    for (const p of block.data || []) {
      products.push({
        source: 'carousel',
        id: p.productId,
        title: p.title,
        city: city || p.city || '',
        country,
        category: p.category,
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
    authFailed: false,
    searchHttp: search.status,
    carouselHttp: carousel.status,
    carouselTotalCount: total,
    productCount: byTitle.size,
    products: [...byTitle.values()],
  };
}

function saveProgress(obj) {
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(PROGRESS, JSON.stringify(obj, null, 2));
}

console.log('Loading CSV…');
const table = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const header = table[0];
const col = Object.fromEntries(header.map((n, i) => [n, i]));
const STATUS_COL = 'working_qa_status';
let statusIdx = header.indexOf(STATUS_COL);
if (statusIdx < 0) {
  header.push(STATUS_COL);
  statusIdx = header.length - 1;
}
for (let i = 1; i < table.length; i++) {
  while (table[i].length < header.length) table[i].push('');
}

// Build country -> cities from Attraction rows
const countryCities = new Map();
for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 5) continue;
  if (!/attraction/i.test(row[col.category] || '')) continue;
  const country = (row[col.country] || '').trim();
  if (!country) continue;
  if (!countryCities.has(country)) countryCities.set(country, new Set());
  const city = (row[col.city] || '').trim();
  if (city) countryCities.get(country).add(city);
  else countryCities.get(country).add(''); // country-level fallback
}

const jobs = [];
for (const [country, cities] of [...countryCities.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const list = [...cities].filter(Boolean);
  if (list.length === 0) jobs.push({ country, city: country, searchQ: country });
  else {
    for (const city of list.sort()) jobs.push({ country, city, searchQ: city });
  }
}

console.log(`Countries: ${countryCities.size} | city jobs: ${jobs.length}`);

const apiByCountry = new Map(); // country -> merged products[]
const jobResults = [];
let authFailed = null;
const timeouts = [];

for (let j = 0; j < jobs.length; j++) {
  const job = jobs[j];
  const label = `${job.country} / ${job.city}`;
  process.stdout.write(`[${j + 1}/${jobs.length}] ${label} … `);
  const cat = await loadCityCatalog(job.country, job.city);
  if (cat.authFailed) {
    console.log('AUTH FAIL');
    authFailed = { job, where: cat.where, http: cat.search?.status || cat.carousel?.status };
    saveProgress({ stopped: 'AUTH', at: label, done: j, total: jobs.length, timeouts, authFailed });
    break;
  }
  if (cat.timedOut) {
    console.log('TIMEOUT');
    timeouts.push({ ...job, where: cat.where });
    jobResults.push({ ...job, timedOut: true, productCount: 0 });
    saveProgress({ running: true, at: label, done: j + 1, total: jobs.length, timeouts, authFailed: null });
    continue;
  }
  console.log(`ok products=${cat.productCount} total=${cat.carouselTotalCount || 0}`);
  jobResults.push({
    country: job.country,
    city: job.city,
    productCount: cat.productCount,
    carouselTotalCount: cat.carouselTotalCount,
    searchHttp: cat.searchHttp,
    carouselHttp: cat.carouselHttp,
  });

  if (!apiByCountry.has(job.country)) apiByCountry.set(job.country, new Map());
  const map = apiByCountry.get(job.country);
  for (const p of cat.products) {
    const k = norm(p.title);
    if (!map.has(k)) map.set(k, { ...p, matchedCities: new Set([norm(job.city)]) });
    else map.get(k).matchedCities.add(norm(job.city));
  }

  if ((j + 1) % 5 === 0 || j === jobs.length - 1) {
    saveProgress({
      running: j < jobs.length - 1,
      at: label,
      done: j + 1,
      total: jobs.length,
      timeouts,
      authFailed: null,
    });
  }
}

if (authFailed) {
  const report = {
    ranAt: new Date().toISOString(),
    stopped: 'AUTH_FAILED',
    authFailed,
    timeouts,
    jobsDone: jobResults.length,
    jobsTotal: jobs.length,
    message: 'Bearer expired/invalid. Share a new curl/Bearer and re-run.',
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log('\nNEED NEW BEARER — stopped before CSV rewrite of remaining countries.');
  console.log('Partial API cache countries:', apiByCountry.size);
  // still write statuses for what we have
}

// Score rows
const summary = { yes: 0, no: 0, 'not found': 0, blank: 0, byCountry: {} };
for (const country of countryCities.keys()) {
  summary.byCountry[country] = { yes: 0, no: 0, 'not found': 0 };
}

for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 5) continue;
  while (row.length < header.length) row.push('');

  const country = (row[col.country] || '').trim();
  const isAttraction = /attraction/i.test(row[col.category] || '');
  if (!isAttraction || !countryCities.has(country)) {
    if (!row[statusIdx]) {
      row[statusIdx] = '';
      summary.blank++;
    }
    continue;
  }

  const apiMap = apiByCountry.get(country);
  if (!apiMap || apiMap.size === 0) {
    // country never fetched or all timed out / stopped before
    row[statusIdx] = authFailed ? 'no' : timeouts.some((t) => t.country === country) ? 'no' : 'no';
    summary.no++;
    summary.byCountry[country].no++;
    continue;
  }

  const csvName = row[col.product_name];
  const csvCity = row[col.city];
  let hit = null;
  for (const p of apiMap.values()) {
    if (!namesLooselyEqual(csvName, p.title)) continue;
    if (!cityMatch(csvCity, p.city, [...(p.matchedCities || [])][0])) continue;
    if (p.country && norm(p.country) !== norm(country) && !namesLooselyEqual(p.country, country)) continue;
    hit = p;
    break;
  }
  // if city filter too strict but same country title exact match, accept
  if (!hit) {
    for (const p of apiMap.values()) {
      if (namesLooselyEqual(csvName, p.title)) {
        hit = p;
        break;
      }
    }
  }

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
fs.writeFileSync(CSV_PATH, table.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n', 'utf8');

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  countries: countryCities.size,
  cityJobs: jobs.length,
  jobsCompleted: jobResults.length,
  authFailed,
  timeouts,
  summary,
  jobResults,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
saveProgress({ running: false, done: jobResults.length, total: jobs.length, timeouts, authFailed });

console.log('\n=== SUMMARY ===', JSON.stringify(summary, null, 2));
console.log('Wrote', CSV_PATH);
console.log('Wrote', REPORT);

if (authFailed) process.exit(2);
if (timeouts.length) process.exit(3);
process.exit(0);
