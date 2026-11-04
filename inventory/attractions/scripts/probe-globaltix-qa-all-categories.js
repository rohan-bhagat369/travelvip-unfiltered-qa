/**
 * GlobalTix QA for ALL categories vs tours-and-attractions search + carousels.
 * - Paginates carousel (page=0..N) until all products collected
 * - Updates working_qa_status = yes | no | not found
 * - Adds price_mismatch = yes | no | blank (blank when CSV price is 0 / empty / not matched)
 *
 *   ATTR_BEARER=... node scripts/probe-globaltix-qa-all-categories.js
 */
import fs from 'fs';

const CSV_PATH = 'Final production globaltix sheet - globaltix_products_full (1).csv';
const REPORT = 'reports/globaltix-qa-all-categories.json';
const PROGRESS = 'reports/globaltix-qa-all-categories-progress.json';
const BASE = process.env.ATTR_BASE_URL || 'https://api.travelvip.ai';
const BEARER =
  process.env.ATTR_BEARER ||
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OGYwOGZiZmYwYWZmNi4xMjM4MjE2NiIsInRva2VuRGF0ZSI6IjIwMjYtMDktMTAgMTI6NTM6MjgifQ.NcGa1M46EQfkE_MoV6yPNg8B8jwQ8Gd64bAdYu5WzoI0V2';
// API in INR (shop default). CSV prices are USD → convert at fixed rate.
const QUERY =
  'key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';
const TIMEOUT_MS = Number(process.env.ATTR_TIMEOUT_MS || 90000);
const PAGE_SIZE = Number(process.env.ATTR_PAGE_SIZE || 100);
const USD_TO_INR = Number(process.env.ATTR_USD_INR || 96); // 1 USD = 96 INR
const PRICE_TOLERANCE_INR = Number(process.env.ATTR_PRICE_TOL || USD_TO_INR); // ±1 USD equiv
const MAX_PAGES = Number(process.env.ATTR_MAX_PAGES || 200);

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

function isAllCities(city) {
  const c = norm(city);
  return !c || c === 'all cities' || c === 'all city' || c === 'nationwide';
}

/** CSV "All Cities" is not a real API city — use country name as filter. */
function apiFilterCity(csvCity, country) {
  if (isAllCities(csvCity)) return country;
  return String(csvCity || '').trim() || country;
}

function cityMatch(csvCity, apiCity, filterCity) {
  const c = norm(csvCity);
  if (!c || isAllCities(csvCity)) return true; // All Cities / blank matches any API city
  const candidates = [norm(apiCity), norm(filterCity)].filter(Boolean);
  return candidates.some(
    (x) => x === c || (c.length >= 4 && x.includes(c)) || (x.length >= 4 && c.includes(x)),
  );
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function csvUsdPrice(row, col) {
  // Only compare when CSV currency is USD (or blank treated as USD per sheet).
  const cur = String(row[col.currency] ?? '')
    .trim()
    .toUpperCase();
  if (cur && cur !== 'USD') return null;
  // Prefer recommended_selling_price, then original_price, then nett_price
  for (const key of ['recommended_selling_price', 'original_price', 'nett_price', 'min_selling_price']) {
    if (col[key] == null) continue;
    const n = toNum(row[col[key]]);
    if (n != null) return n;
  }
  return null;
}

function apiAmountInr(p) {
  const sp = p?.startingPrice;
  if (sp == null) return null;
  if (typeof sp === 'number') return sp;
  const n = toNum(sp.totalAmount ?? sp.baseFare ?? sp.amount);
  return n;
}

/** CSV USD → INR at fixed rate, compare to API INR starting price. */
function pricesMatchUsdCsvToInrApi(csvUsd, apiInr) {
  if (csvUsd == null || apiInr == null) return null;
  const csvInr = csvUsd * USD_TO_INR;
  return Math.abs(csvInr - apiInr) <= PRICE_TOLERANCE_INR;
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

function pickProductsBlock(carouselData) {
  const blocks = carouselData?.results || [];
  return (
    blocks.find((b) => b.contentType === 'PRODUCTS') ||
    blocks.find((b) => /attraction|product/i.test(String(b.type || ''))) ||
    null
  );
}

async function loadCityCatalog(country, city) {
  // city here is already the API filter city (country name when CSV was All Cities)
  const filterCity = apiFilterCity(city, country);
  const q = filterCity || country;
  const searchUrl = `${BASE}/api/airportServices/tours-and-attractions/search?${QUERY}&q=${encodeURIComponent(q)}&page=0&size=100`;
  const carouselBase = `${BASE}/api/airportServices/carousels?${QUERY}&type=tab&slug=tours-experiences-list`;
  const filterBody = { appliedFilters: { city: filterCity, country } };

  const search = await fetchJson(searchUrl);
  if (search.timedOut) return { timedOut: true, where: 'search', products: [] };
  if (search.status === 401) return { authFailed: true, where: 'search', products: [], search };

  const byId = new Map();
  const byTitle = new Map();

  const pushProduct = (p) => {
    if (!p?.title && !p?.productId && !p?.entityId) return;
    const title = p.title || '';
    const id = p.productId || p.entityId || '';
    const item = {
      title,
      city: p.city || filterCity || '',
      country: p.country || country,
      id,
      category: p.category,
      startingPrice: p.startingPrice ?? p.price ?? null,
      amount: apiAmountInr(p),
      source: p._source || 'carousel',
    };
    if (id && !byId.has(id)) byId.set(id, item);
    const k = norm(title);
    if (k && !byTitle.has(k)) byTitle.set(k, item);
    else if (k && byTitle.has(k) && item.amount != null && byTitle.get(k).amount == null) {
      byTitle.set(k, item);
    }
  };

  for (const r of search.data?.results || []) {
    if (String(r.entityType).toUpperCase() !== 'PRODUCT') continue;
    pushProduct({
      title: r.title,
      city: r.city,
      country: r.country,
      productId: r.entityId,
      startingPrice: r.startingPrice || r.price || null,
      _source: 'search',
    });
  }

  let total = 0;
  let pagesFetched = 0;
  let lastHttp = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const carousel = await fetchJson(`${carouselBase}&page=${page}&size=${PAGE_SIZE}`, {
      method: 'POST',
      body: filterBody,
    });
    lastHttp = carousel.status;
    if (carousel.timedOut) {
      return {
        timedOut: true,
        where: `carousels-page-${page}`,
        products: [...byTitle.values()],
        carouselTotalCount: total,
        pagesFetched,
      };
    }
    if (carousel.status === 401) {
      return { authFailed: true, where: `carousels-page-${page}`, products: [], carousel };
    }

    const block = pickProductsBlock(carousel.data);
    total = Number(block?.totalCount || total || 0);
    const chunk = block?.data || [];
    pagesFetched++;
    for (const p of chunk) pushProduct({ ...p, _source: 'carousel' });

    if (!chunk.length) break;
    if (total > 0 && byId.size >= total) break;
    if (chunk.length < PAGE_SIZE && (total === 0 || byId.size >= total || page * PAGE_SIZE + chunk.length >= total)) {
      break;
    }
  }

  return {
    timedOut: false,
    authFailed: false,
    searchHttp: search.status,
    carouselHttp: lastHttp,
    carouselTotalCount: total,
    pagesFetched,
    productCount: byTitle.size,
    products: [...byTitle.values()],
  };
}

function saveProgress(obj) {
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(PROGRESS, JSON.stringify(obj, null, 2));
}

function ensureCol(header, table, name) {
  let idx = header.indexOf(name);
  if (idx < 0) {
    header.push(name);
    idx = header.length - 1;
    for (let i = 1; i < table.length; i++) {
      while (table[i].length < header.length) table[i].push('');
    }
  }
  return idx;
}

console.log('Loading CSV…');
const table = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const header = table[0];
const col = Object.fromEntries(header.map((n, i) => [n, i]));
const statusIdx = ensureCol(header, table, 'working_qa_status');
const priceMismatchIdx = ensureCol(header, table, 'price_mismatch');
// refresh col map after ensures
for (let i = 0; i < header.length; i++) col[header[i]] = i;

for (let i = 1; i < table.length; i++) while (table[i].length < header.length) table[i].push('');

const countryCities = new Map();
const categoryCounts = {};
for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 5) continue;
  const country = (row[col.country] || '').trim();
  if (!country) continue;
  const cat = (row[col.category] || '').trim() || '(none)';
  categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  if (!countryCities.has(country)) countryCities.set(country, new Set());
  const city = (row[col.city] || '').trim();
  if (city) countryCities.get(country).add(city);
  else countryCities.get(country).add('');
}

const jobs = [];
for (const [country, cities] of [...countryCities.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const list = [...cities].filter(Boolean);
  const seenFilter = new Set();
  // Always fetch country-level catalog (API often tags lounges/eSIMs as city=country)
  const countryJob = { country, city: country, csvCity: country, kind: 'country' };
  jobs.push(countryJob);
  seenFilter.add(norm(country));

  if (!list.length) continue;
  for (const city of list.sort()) {
    const filterCity = apiFilterCity(city, country);
    const key = norm(filterCity);
    if (seenFilter.has(key)) continue; // skip duplicate All Cities → country
    seenFilter.add(key);
    jobs.push({ country, city: filterCity, csvCity: city, kind: isAllCities(city) ? 'all-cities' : 'city' });
  }
}

console.log('Categories in sheet:', categoryCounts);
console.log(`Countries: ${countryCities.size} | city jobs: ${jobs.length}`);
console.log(
  `Pagination: pageSize=${PAGE_SIZE} apiCurrency=INR csvUsd→INR rate=${USD_TO_INR} priceTol=±${PRICE_TOLERANCE_INR} INR`,
);

const apiByCountry = new Map();
const jobResults = [];
let authFailed = null;
const timeouts = [];

for (let j = 0; j < jobs.length; j++) {
  const job = jobs[j];
  const label = `${job.country} / ${job.csvCity || job.city}${job.kind === 'country' ? ' [country]' : ''}`;
  process.stdout.write(`[${j + 1}/${jobs.length}] ${label} … `);
  const cat = await loadCityCatalog(job.country, job.city);
  if (cat.authFailed) {
    console.log('AUTH FAIL — NEED NEW BEARER');
    authFailed = { job, where: cat.where };
    saveProgress({ stopped: 'AUTH', at: label, done: j, total: jobs.length, timeouts, authFailed });
    break;
  }
  if (cat.timedOut) {
    console.log(`TIMEOUT (${cat.where})`);
    timeouts.push({ ...job, where: cat.where });
    jobResults.push({ ...job, timedOut: true, productCount: 0, pagesFetched: cat.pagesFetched || 0 });
    saveProgress({ running: true, at: label, done: j + 1, total: jobs.length, timeouts, lastTimeout: timeouts[timeouts.length - 1] });
    continue;
  }
  console.log(
    `ok products=${cat.productCount} total=${cat.carouselTotalCount || 0} pages=${cat.pagesFetched || 0}`,
  );
  jobResults.push({
    country: job.country,
    city: job.city,
    productCount: cat.productCount,
    carouselTotalCount: cat.carouselTotalCount,
    pagesFetched: cat.pagesFetched,
  });

  if (!apiByCountry.has(job.country)) apiByCountry.set(job.country, new Map());
  const map = apiByCountry.get(job.country);
  for (const p of cat.products) {
    const k = norm(p.title);
    if (!k) continue;
    if (!map.has(k)) map.set(k, p);
    else if (p.amount != null && map.get(k).amount == null) map.set(k, p);
  }

  if ((j + 1) % 5 === 0 || j === jobs.length - 1) {
    saveProgress({ running: j < jobs.length - 1, at: label, done: j + 1, total: jobs.length, timeouts });
  }
}

const summary = {
  yes: 0,
  no: 0,
  'not found': 0,
  blank: 0,
  priceMismatchYes: 0,
  priceMismatchNo: 0,
  priceMismatchBlank: 0,
  byCategory: {},
  byCountry: {},
};
for (const c of Object.keys(categoryCounts)) {
  summary.byCategory[c] = { yes: 0, no: 0, 'not found': 0, price_mismatch_yes: 0, price_mismatch_no: 0, price_mismatch_blank: 0 };
}
for (const country of countryCities.keys()) {
  summary.byCountry[country] = { yes: 0, no: 0, 'not found': 0, price_mismatch_yes: 0, price_mismatch_no: 0, price_mismatch_blank: 0 };
}

for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 5) continue;
  while (row.length < header.length) row.push('');

  const country = (row[col.country] || '').trim();
  const catName = (row[col.category] || '').trim() || '(none)';
  if (!summary.byCategory[catName]) {
    summary.byCategory[catName] = {
      yes: 0,
      no: 0,
      'not found': 0,
      price_mismatch_yes: 0,
      price_mismatch_no: 0,
      price_mismatch_blank: 0,
    };
  }
  if (!country || !countryCities.has(country)) {
    row[statusIdx] = '';
    row[priceMismatchIdx] = '';
    summary.blank++;
    summary.priceMismatchBlank++;
    continue;
  }

  const apiMap = apiByCountry.get(country);
  if (!apiMap || apiMap.size === 0) {
    row[statusIdx] = 'no';
    row[priceMismatchIdx] = '';
    summary.no++;
    summary.priceMismatchBlank++;
    summary.byCategory[catName].no++;
    summary.byCategory[catName].price_mismatch_blank++;
    summary.byCountry[country].no++;
    summary.byCountry[country].price_mismatch_blank++;
    continue;
  }

  const csvName = row[col.product_name];
  const csvCity = row[col.city];
  let hit = null;
  for (const p of apiMap.values()) {
    if (!namesLooselyEqual(csvName, p.title)) continue;
    if (!cityMatch(csvCity, p.city, '')) continue;
    hit = p;
    break;
  }
  if (!hit) {
    for (const p of apiMap.values()) {
      if (namesLooselyEqual(csvName, p.title)) {
        hit = p;
        break;
      }
    }
  }

  const csvUsd = csvUsdPrice(row, col);
  const zeroOrMissing = csvUsd == null || csvUsd === 0;

  if (hit) {
    row[statusIdx] = 'yes';
    summary.yes++;
    summary.byCategory[catName].yes++;
    summary.byCountry[country].yes++;

    if (zeroOrMissing) {
      row[priceMismatchIdx] = '';
      summary.priceMismatchBlank++;
      summary.byCategory[catName].price_mismatch_blank++;
      summary.byCountry[country].price_mismatch_blank++;
    } else {
      const match = pricesMatchUsdCsvToInrApi(csvUsd, hit.amount);
      if (match === true) {
        row[priceMismatchIdx] = 'no'; // no mismatch
        summary.priceMismatchNo++;
        summary.byCategory[catName].price_mismatch_no++;
        summary.byCountry[country].price_mismatch_no++;
      } else if (match === false) {
        row[priceMismatchIdx] = 'yes'; // mismatch
        summary.priceMismatchYes++;
        summary.byCategory[catName].price_mismatch_yes++;
        summary.byCountry[country].price_mismatch_yes++;
      } else {
        row[priceMismatchIdx] = '';
        summary.priceMismatchBlank++;
        summary.byCategory[catName].price_mismatch_blank++;
        summary.byCountry[country].price_mismatch_blank++;
      }
    }
  } else {
    row[statusIdx] = 'not found';
    row[priceMismatchIdx] = '';
    summary['not found']++;
    summary.priceMismatchBlank++;
    summary.byCategory[catName]['not found']++;
    summary.byCategory[catName].price_mismatch_blank++;
    summary.byCountry[country]['not found']++;
    summary.byCountry[country].price_mismatch_blank++;
  }
}

console.log('\nWriting CSV…');
const csvOutPrimary = CSV_PATH;
const csvOutFallback = 'reports/globaltix-products-with-qa-status.csv';
const csvBody = table.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
let csvWritten = null;
for (const out of [csvOutPrimary, csvOutFallback]) {
  try {
    fs.writeFileSync(out, csvBody, 'utf8');
    csvWritten = out;
    console.log('Wrote', out);
    break;
  } catch (e) {
    console.error(`CSV write failed (${out}):`, e.code || e.message);
  }
}
if (!csvWritten) {
  console.error('Could not write CSV — close the file if open in Excel/IDE and re-run.');
}

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  apiCurrency: 'INR',
  csvCurrency: 'USD',
  usdToInr: USD_TO_INR,
  pageSize: PAGE_SIZE,
  priceToleranceInr: PRICE_TOLERANCE_INR,
  countries: countryCities.size,
  cityJobs: jobs.length,
  jobsCompleted: jobResults.length,
  authFailed,
  timeouts,
  categoryCounts,
  summary,
  csvWritten,
  jobResults,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
saveProgress({ running: false, done: jobResults.length, total: jobs.length, timeouts, authFailed, csvWritten });

console.log(
  '\n=== SUMMARY ===',
  JSON.stringify(
    {
      totals: {
        yes: summary.yes,
        no: summary.no,
        notFound: summary['not found'],
        blank: summary.blank,
        price_mismatch_yes: summary.priceMismatchYes,
        price_mismatch_no: summary.priceMismatchNo,
        price_mismatch_blank: summary.priceMismatchBlank,
      },
      byCategory: summary.byCategory,
      csvWritten,
    },
    null,
    2,
  ),
);
console.log('Wrote', REPORT);
if (authFailed) {
  console.log('\nNEED NEW BEARER');
  process.exit(2);
}
if (!csvWritten) process.exit(4);
if (timeouts.length) {
  console.log(`\nTIMEOUTS: ${timeouts.length}`);
  process.exit(3);
}
process.exit(0);
