/**
 * Preprod hotel search latency + full pagination count report.
 * Cities from Hotel search sheet (Suggested Cities).
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = path.resolve('d:/Travel VIP API Automation');
const OUT_XLSX = path.join(ROOT, 'reports/hotel/preprod-city-hotel-search-latency-report-FULL.xlsx');
const OUT_JSON = path.join(ROOT, 'reports/hotel/preprod-city-hotel-search-latency-report-FULL.json');

const TOKEN =
  process.env.ZENITH_BEARER ||
  'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OTZiODJkYTlmNmY3Ny44MjgxNzQ0MSIsInRva2VuRGF0ZSI6IjIwMjYtMDgtMDYgMTE6MDI6MDkifQ.3ty9OViSNAr7pj9kqvtD3yDmef4iVahPalyRymhWjXs0V2';

const BASE = 'https://preprod-api.travelvip.ai';
const KEY = '34e5ror32qferaw';
const PID = 'raw';
const CHECKIN = process.env.CHECKIN || '2026-08-20';
const CHECKOUT = process.env.CHECKOUT || '2026-08-22';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 30000);
const SLOW_FIRST_PAGE_MS = Number(process.env.SLOW_FIRST_PAGE_MS || 3000);
const SLOW_PAGE_MS = Number(process.env.SLOW_PAGE_MS || 5000);
const MAX_PAGES = Number(process.env.MAX_PAGES || 600);
// Stop only when a page returns 0 hotels (UI scroll end). Do NOT trust early totalPages/last.

// Target: 60 unique cities across sheet categories + additional destinations
const CITIES = [
  // Major International (12)
  { category: 'Major International', city: 'Dubai' },
  { category: 'Major International', city: 'Bangkok' },
  { category: 'Major International', city: 'Singapore' },
  { category: 'Major International', city: 'London' },
  { category: 'Major International', city: 'Paris' },
  { category: 'Major International', city: 'New York' },
  { category: 'Major International', city: 'Tokyo' },
  { category: 'Major International', city: 'Sydney' },
  { category: 'Major International', city: 'Istanbul' },
  { category: 'Major International', city: 'Kuala Lumpur' },
  { category: 'Major International', city: 'Hong Kong' },
  { category: 'Major International', city: 'Doha' },

  // Indian Metros (12)
  { category: 'Indian Metros', city: 'Mumbai' },
  { category: 'Indian Metros', city: 'Delhi' },
  { category: 'Indian Metros', city: 'Bengaluru' },
  { category: 'Indian Metros', city: 'Goa' },
  { category: 'Indian Metros', city: 'Chennai' },
  { category: 'Indian Metros', city: 'Hyderabad' },
  { category: 'Indian Metros', city: 'Kolkata' },
  { category: 'Indian Metros', city: 'Pune' },
  { category: 'Indian Metros', city: 'Ahmedabad' },
  { category: 'Indian Metros', city: 'Chandigarh' },
  { category: 'Indian Metros', city: 'Lucknow' },
  { category: 'Indian Metros', city: 'Indore' },

  // Mid-size / Tier-2 (14)
  { category: 'Mid-size / Tier-2', city: 'Jaipur' },
  { category: 'Mid-size / Tier-2', city: 'Kochi' },
  { category: 'Mid-size / Tier-2', city: 'Chiang Mai' },
  { category: 'Mid-size / Tier-2', city: 'Da Nang' },
  { category: 'Mid-size / Tier-2', city: 'Udaipur' },
  { category: 'Mid-size / Tier-2', city: 'Mysore' },
  { category: 'Mid-size / Tier-2', city: 'Surat' },
  { category: 'Mid-size / Tier-2', city: 'Nagpur' },
  { category: 'Mid-size / Tier-2', city: 'Visakhapatnam' },
  { category: 'Mid-size / Tier-2', city: 'Amritsar' },
  { category: 'Mid-size / Tier-2', city: 'Pattaya' },
  { category: 'Mid-size / Tier-2', city: 'Penang' },
  { category: 'Mid-size / Tier-2', city: 'Bhubaneswar' },
  { category: 'Mid-size / Tier-2', city: 'Guwahati' },

  // Small Towns / Offbeat (14)
  { category: 'Small Towns / Offbeat', city: 'Coorg', altQueries: ['Madikeri', 'Kodagu'] },
  { category: 'Small Towns / Offbeat', city: 'Alleppey', altQueries: ['Alappuzha'] },
  { category: 'Small Towns / Offbeat', city: 'Rishikesh' },
  { category: 'Small Towns / Offbeat', city: 'Pokhara' },
  { category: 'Small Towns / Offbeat', city: 'Manali' },
  { category: 'Small Towns / Offbeat', city: 'Shimla' },
  { category: 'Small Towns / Offbeat', city: 'Ooty' },
  { category: 'Small Towns / Offbeat', city: 'Munnar' },
  { category: 'Small Towns / Offbeat', city: 'Lonavala' },
  { category: 'Small Towns / Offbeat', city: 'Darjeeling' },
  { category: 'Small Towns / Offbeat', city: 'Varkala' },
  { category: 'Small Towns / Offbeat', city: 'Hampi' },
  { category: 'Small Towns / Offbeat', city: 'Pondicherry' },
  { category: 'Small Towns / Offbeat', city: 'McLeod Ganj', altQueries: ['Dharamshala'] },

  // Mandatory + Other destinations (8) => total 60
  { category: 'Mandatory', city: 'Phuket' },
  { category: 'Other Destinations', city: 'Bali' },
  { category: 'Other Destinations', city: 'Kathmandu' },
  { category: 'Other Destinations', city: 'Colombo' },
  { category: 'Other Destinations', city: 'Male' },
  { category: 'Other Destinations', city: 'Abu Dhabi' },
  { category: 'Other Destinations', city: 'Sharjah' },
  { category: 'Other Destinations', city: 'Krabi' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    const ms = Date.now() - t0;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, ms, error: `non-json: ${text.slice(0, 180)}`, data: null };
    }
    return { ok: res.ok, status: res.status, ms, error: res.ok ? '' : text.slice(0, 180), data };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: String(e.message || e), data: null };
  } finally {
    clearTimeout(timer);
  }
}

function pickCityEntity(content, cityName) {
  const list = Array.isArray(content) ? content : [];
  const q = cityName.toLowerCase().trim();
  const cities = list.filter((x) => {
    const t = String(x.type || '').toUpperCase();
    return t === 'TBOCITY' || t === 'CITY' || t === 'REGION';
  });

  const exact = cities.find((x) => String(x.title || '').toLowerCase().trim() === q);
  if (exact) return { entity: exact, candidates: cities };

  const starts = cities.find((x) => String(x.title || '').toLowerCase().startsWith(q));
  if (starts) return { entity: starts, candidates: cities };

  const includes = cities.find((x) => String(x.title || '').toLowerCase().includes(q));
  if (includes) return { entity: includes, candidates: cities };

  return { entity: null, candidates: cities };
}

async function resolveCity(cityName, altQueries = []) {
  const queries = [cityName, ...(altQueries || [])];
  let lastError = '';
  let lastMs = 0;
  let lastCandidates = [];

  for (const q of queries) {
    const url = `${BASE}/api/hotelbooking/search?key=${KEY}&pid=${PID}&platform=web&client=web&lang=en&currency=INR&q=${encodeURIComponent(q)}&page=0`;
    const res = await fetchJson(url, {
      method: 'GET',
      headers: {
        Authorization: TOKEN,
        Accept: 'application/json',
      },
    });
    lastMs = res.ms;
    if (!res.ok) {
      lastError = `autocomplete HTTP ${res.status}: ${res.error}`;
      if (res.status === 401 || res.status === 403) {
        return { ok: false, autocompleteMs: res.ms, error: lastError, entity: null, candidates: [], authFailed: true };
      }
      continue;
    }
    const { entity, candidates } = pickCityEntity(res.data?.content, q);
    lastCandidates = candidates;
    if (entity) {
      return {
        ok: true,
        autocompleteMs: res.ms,
        error: '',
        entity,
        candidates,
        resolvedQuery: q,
      };
    }
    lastError = `No TBOCITY/CITY/REGION match for query "${q}"`;
  }

  return {
    ok: false,
    autocompleteMs: lastMs,
    error: lastError || 'No TBOCITY/CITY/REGION match in autocomplete',
    entity: null,
    candidates: lastCandidates,
  };
}

async function paginateHotelResults({ cityName, entity }) {
  const issues = [];
  const pageTimes = [];
  const hotelIds = new Set();
  const hotelTitles = [];
  let requestId = '';
  let firstReportedTotal = null;
  let latestReportedTotal = null;
  let availableResults = null;
  let totalPages = null;
  let pageSize = 5;
  let pagesFetched = 0;
  let pagesWithHotels = 0;
  let firstPageMs = null;
  let maxPageMs = 0;
  let stoppedReason = '';

  const wallStart = Date.now();

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * pageSize;
    const body = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      type: entity.type || 'TBOCITY',
      entityId: String(entity.entityId),
      nationality: 'IN',
      nationalityLabel: 'Indian',
      entityLabel: `${entity.title || cityName} , ${entity.country || 'India'}`,
      requestId: requestId || '',
      pid: 'smt',
      rt: 'compact',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      fq: { df_long_star_rating: [] },
    };

    const url = `${BASE}/api/hotelbooking/getHotelResults?key=${KEY}&pid=${PID}&platform=web&client=web&lang=en&currency=INR&q=${encodeURIComponent(cityName)}&page=${page}&offset=${offset}`;
    const res = await fetchJson(url, {
      method: 'POST',
      headers: {
        Authorization: TOKEN,
        Accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    pageTimes.push(res.ms);
    maxPageMs = Math.max(maxPageMs, res.ms);
    if (page === 0) firstPageMs = res.ms;

    if (!res.ok) {
      issues.push(`Page ${page} failed HTTP ${res.status}: ${res.error}`);
      stoppedReason = `http_${res.status}`;
      break;
    }

    const d = res.data || {};
    const content = Array.isArray(d.content) ? d.content : [];
    pagesFetched++;

    // totals can grow as search continues — always refresh from latest page
    latestReportedTotal = d.totalElements ?? d.availableResults ?? d.totalSearchResults ?? latestReportedTotal;
    availableResults = d.availableResults ?? availableResults;
    totalPages = d.totalPages ?? totalPages;
    pageSize = d.size || d.pageable?.pageSize || pageSize || 5;
    if (d.requestId || d.request?.requestId) {
      requestId = d.requestId || d.request.requestId;
    }

    if (page === 0) {
      firstReportedTotal = latestReportedTotal;
      if (firstPageMs >= SLOW_FIRST_PAGE_MS) {
        issues.push(`Slow first page: ${firstPageMs} ms (>= ${SLOW_FIRST_PAGE_MS})`);
      }
      if (!content.length) issues.push('First page returned 0 hotels');
    }

    if (res.ms >= SLOW_PAGE_MS) {
      issues.push(`Slow page ${page}: ${res.ms} ms`);
    }

    // UI scroll end = empty page content (do not trust last/totalPages; they can be premature)
    if (content.length === 0) {
      stoppedReason = 'empty_page';
      console.log(`  stop @ page ${page}: empty content (unique so far=${hotelIds.size}, latestReported=${latestReportedTotal})`);
      break;
    }

    pagesWithHotels++;
    let newOnPage = 0;
    for (const h of content) {
      const id = String(h.entityId || h.id || h.title || '');
      if (!id) continue;
      if (!hotelIds.has(id)) {
        hotelIds.add(id);
        newOnPage++;
        if (hotelTitles.length < 5) hotelTitles.push(h.title || id);
      }
    }

    if (page === 0 || page % 25 === 0 || newOnPage === 0) {
      console.log(
        `  page ${page}: +${newOnPage} new, unique=${hotelIds.size}, reported=${latestReportedTotal}, last=${d.last}, ${res.ms}ms`,
      );
    }

    await sleep(30);
  }

  if (!stoppedReason && pagesFetched >= MAX_PAGES) {
    stoppedReason = 'max_pages';
    issues.push(`Hit MAX_PAGES=${MAX_PAGES} safety stop`);
  }

  const totalWallMs = Date.now() - wallStart;
  const avgPageMs = pageTimes.length
    ? Math.round(pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length)
    : 0;

  if (
    firstReportedTotal != null &&
    hotelIds.size > firstReportedTotal &&
    firstReportedTotal > 0
  ) {
    issues.push(
      `Early total understated: firstPage total=${firstReportedTotal}, final collected=${hotelIds.size}`,
    );
  }
  if (
    latestReportedTotal != null &&
    hotelIds.size !== latestReportedTotal
  ) {
    issues.push(
      `Final API total (${latestReportedTotal}) != collected unique (${hotelIds.size})`,
    );
  }

  return {
    reportedTotal: latestReportedTotal ?? hotelIds.size,
    firstReportedTotal,
    collectedUniqueHotels: hotelIds.size,
    availableResults,
    totalPagesReported: totalPages,
    pagesFetched,
    pagesWithHotels,
    pageSize,
    firstPageMs,
    avgPageMs,
    maxPageMs,
    totalWallMs,
    requestId,
    sampleHotels: hotelTitles.join(' | '),
    stoppedReason,
    issues,
    pageTimes,
  };
}

async function runCity(item) {
  const row = {
    Category: item.category,
    City: item.city,
    'Entity Title': '',
    'Entity Type': '',
    EntityId: '',
    'Hotel Count (Final Collected)': '',
    'Hotel Count (First Page Reported)': '',
    'Hotel Count (Latest API Total)': '',
    'Pages With Hotels': '',
    'Pages Fetched': '',
    'Page Size': '',
    'Stopped Reason': '',
    'Autocomplete Time (ms)': '',
    'First Page Time (ms)': '',
    'Avg Page Time (ms)': '',
    'Max Page Time (ms)': '',
    'Total Pagination Time (ms)': '',
    'Total Pagination Time (sec)': '',
    Status: '',
    Issues: '',
    'Sample Hotels': '',
    RequestId: '',
  };

  console.log(`\n=== ${item.city} (${item.category}) ===`);
  const resolved = await resolveCity(item.city, item.altQueries || []);
  row['Autocomplete Time (ms)'] = resolved.autocompleteMs;

  if (resolved.authFailed) {
    row.Status = 'FAIL';
    row.Issues = resolved.error;
    console.log('AUTH FAIL:', resolved.error);
    return { row, authFailed: true };
  }

  if (!resolved.ok) {
    row.Status = 'FAIL';
    row.Issues = resolved.error;
    console.log('FAIL resolve:', resolved.error);
    return { row, authFailed: false };
  }

  const entity = resolved.entity;
  row['Entity Title'] = entity.title || '';
  row['Entity Type'] = entity.type || '';
  row.EntityId = entity.entityId || '';

  const candTitles = (resolved.candidates || [])
    .slice(0, 6)
    .map((c) => c.title)
    .filter(Boolean);
  const extraIssues = [];
  if (resolved.resolvedQuery && resolved.resolvedQuery !== item.city) {
    extraIssues.push(`Resolved via alternate query "${resolved.resolvedQuery}"`);
  }
  if (candTitles.length > 1) {
    extraIssues.push(`Multiple city matches: ${candTitles.join(', ')}`);
  }
  if (String(entity.title || '').toLowerCase() !== item.city.toLowerCase() &&
      String(entity.title || '').toLowerCase() !== String(resolved.resolvedQuery || '').toLowerCase()) {
    extraIssues.push(`Used entity "${entity.title}" for query "${resolved.resolvedQuery || item.city}"`);
  }

  console.log(`Entity: ${entity.title} (${entity.type}) id=${entity.entityId}`);
  const result = await paginateHotelResults({ cityName: resolved.resolvedQuery || item.city, entity });

  row['Hotel Count (Final Collected)'] = result.collectedUniqueHotels;
  row['Hotel Count (First Page Reported)'] = result.firstReportedTotal;
  row['Hotel Count (Latest API Total)'] = result.reportedTotal;
  row['Pages With Hotels'] = result.pagesWithHotels;
  row['Pages Fetched'] = result.pagesFetched;
  row['Page Size'] = result.pageSize;
  row['Stopped Reason'] = result.stoppedReason;
  row['First Page Time (ms)'] = result.firstPageMs;
  row['Avg Page Time (ms)'] = result.avgPageMs;
  row['Max Page Time (ms)'] = result.maxPageMs;
  row['Total Pagination Time (ms)'] = result.totalWallMs;
  row['Total Pagination Time (sec)'] = Number((result.totalWallMs / 1000).toFixed(1));
  row['Sample Hotels'] = result.sampleHotels;
  row.RequestId = result.requestId || '';

  const allIssues = [...extraIssues, ...result.issues];
  row.Issues = allIssues.join('; ');
  row.Status = allIssues.some((i) => /failed|0 hotels|timeout|abort/i.test(i))
    ? 'ISSUE'
    : allIssues.length
      ? 'WARN'
      : 'OK';

  console.log(
    `FINAL count=${result.collectedUniqueHotels} (firstReported=${result.firstReportedTotal}, latestApi=${result.reportedTotal}) pages=${result.pagesWithHotels} first=${result.firstPageMs}ms total=${result.totalWallMs}ms stop=${result.stoppedReason} status=${row.Status}`,
  );
  if (allIssues.length) console.log('Issues:', row.Issues);

  return { row, authFailed: false };
}

function writeReport(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'City Hotel Search');

  const withLatency = rows.filter((r) => typeof r['First Page Time (ms)'] === 'number');
  const firstTimes = withLatency.map((r) => r['First Page Time (ms)']);
  const avg = firstTimes.length
    ? Math.round(firstTimes.reduce((a, b) => a + b, 0) / firstTimes.length)
    : '';

  const summary = [
    { Metric: 'Cities tested', Value: rows.length },
    { Metric: 'OK', Value: rows.filter((r) => r.Status === 'OK').length },
    { Metric: 'WARN', Value: rows.filter((r) => r.Status === 'WARN').length },
    { Metric: 'ISSUE/FAIL', Value: rows.filter((r) => r.Status === 'ISSUE' || r.Status === 'FAIL').length },
    { Metric: 'Search latency avg (ms)', Value: avg },
    { Metric: 'Search latency min (ms)', Value: firstTimes.length ? Math.min(...firstTimes) : '' },
    { Metric: 'Search latency max (ms)', Value: firstTimes.length ? Math.max(...firstTimes) : '' },
    { Metric: 'Checkin/Checkout', Value: `${CHECKIN} / ${CHECKOUT}` },
    { Metric: 'Env', Value: 'preprod-api.travelvip.ai' },
    { Metric: 'Generated At', Value: new Date().toISOString() },
  ];
  const ws2 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  XLSX.writeFile(wb, OUT_XLSX);
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
}

async function main() {
  if (CITIES.length !== 60) {
    throw new Error(`Expected 60 cities, found ${CITIES.length}`);
  }
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true });

  const reuse = process.env.REUSE_CACHE !== '0';
  const cachedByCity = new Map();
  if (reuse && fs.existsSync(OUT_JSON)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
      for (const row of prev.rows || []) {
        if (row?.City && row.Status && row.Status !== 'FAIL') {
          cachedByCity.set(String(row.City).toLowerCase(), row);
        }
      }
      console.log(`Reusing ${cachedByCity.size} cached city results (set REUSE_CACHE=0 to force full rerun)`);
    } catch {
      // ignore
    }
  }

  const rows = [];
  for (const city of CITIES) {
    const key = city.city.toLowerCase();
    if (cachedByCity.has(key)) {
      const cached = { ...cachedByCity.get(key), Category: city.category, City: city.city };
      rows.push(cached);
      console.log(`\n=== ${city.city} (${city.category}) ===\nREUSED cache: count=${cached['Hotel Count (Final Collected)']} first=${cached['First Page Time (ms)']}ms status=${cached.Status}`);
      continue;
    }

    try {
      const result = await runCity(city);
      rows.push(result.row);
      if (result.authFailed) {
        writeReport(rows);
        console.error('\nAUTH/TOKEN FAILURE — stop and provide a fresh curl.');
        console.error(result.row.Issues);
        process.exit(2);
      }
    } catch (e) {
      const msg = String(e.message || e);
      rows.push({
        Category: city.category,
        City: city.city,
        Status: 'FAIL',
        Issues: msg,
      });
      if (/401|403|Auth failed|aborted|timeout/i.test(msg)) {
        writeReport(rows);
        console.error('\nAPI FAILURE/TIMEOUT — stop and provide a fresh curl.');
        console.error(msg);
        process.exit(2);
      }
    }

    writeReport(rows); // incremental save after each new city
    await sleep(200);
  }

  writeReport(rows);
  console.log(`\nDone. Cities=${rows.length}`);
  console.log(`Excel: ${OUT_XLSX}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
