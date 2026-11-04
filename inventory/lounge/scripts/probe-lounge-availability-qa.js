/**
 * Lounge availability QA vs prod airport-services + lounge-pass-list carousels.
 * CSV: Airport Name + Vendor Terminal + Lounge Name
 * Adds working_qa_status = yes | not found | no
 *
 *   LOUNGE_BEARER=... node scripts/probe-lounge-availability-qa.js
 */
import fs from 'fs';

const CSV_PATH =
  process.env.LOUNGE_CSV ||
  'Copy of Claude Lounge Sheet - dragonpass_lounge_locations.csv';
const REPORT = 'reports/lounge-availability-qa.json';
const PROGRESS = 'reports/lounge-availability-qa-progress.json';
const BASE = process.env.LOUNGE_BASE_URL || 'https://api.travelvip.ai';
const BEARER =
  process.env.LOUNGE_BEARER ||
  process.env.ATTR_BEARER ||
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OGYwOGZiZmYwYWZmNi4xMjM4MjE2NiIsInRva2VuRGF0ZSI6IjIwMjYtMDktMTAgMTI6NTM6MjgifQ.NcGa1M46EQfkE_MoV6yPNg8B8jwQ8Gd64bAdYu5WzoI0V2';
const QUERY =
  'key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';
const TIMEOUT_MS = Number(process.env.LOUNGE_TIMEOUT_MS || 90000);
const PAGE_SIZE = Number(process.env.LOUNGE_PAGE_SIZE || 20);
const MAX_PAGES = Number(process.env.LOUNGE_MAX_PAGES || 50);
const DELAY_MS = Number(process.env.LOUNGE_DELAY_MS || 120);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function terminalsMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const compact = (x) => x.replace(/\s+/g, '');
  return compact(na) === compact(nb);
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
        Origin: 'https://shop.travelvip.ai',
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

function pickAirport(results, airportName, iata) {
  const list = results || [];
  const wantIata = norm(iata);
  const wantName = norm(airportName);
  if (wantIata) {
    const byCode = list.find((r) => norm(r.airportCode) === wantIata);
    if (byCode) return byCode;
  }
  const exact = list.find((r) => norm(r.title) === wantName);
  if (exact) return exact;
  return list.find((r) => namesLooselyEqual(r.title, airportName)) || null;
}

async function searchAirport(airportName, iata) {
  // IATA first — name search often returns unrelated airports in the first 20.
  const queries = [...new Set([iata, airportName].filter(Boolean))];
  let last = null;
  for (const q of queries) {
    const url = `${BASE}/api/airportServices/airport-services?${QUERY}&q=${encodeURIComponent(q)}&page=0&size=20&type=lounge`;
    const res = await fetchJson(url);
    last = res;
    if (res.timedOut) return { timedOut: true, where: 'airport-services' };
    if (res.status === 401) return { authFailed: true, where: 'airport-services' };
    const airport = pickAirport(res.data?.results, airportName, iata);
    if (airport) {
      return {
        http: res.status,
        airport,
        availableCount: airport?.availableCount ?? null,
        terminals: airport?.terminals || [],
        terminalInfo: airport?.terminalInfo || [],
      };
    }
  }
  return {
    http: last?.status,
    airport: null,
    availableCount: null,
    terminals: [],
    terminalInfo: [],
  };
}

function pickLoungeBlock(carouselData) {
  const blocks = carouselData?.results || [];
  return (
    blocks.find((b) => b.contentType === 'PRODUCTS' || b.type === 'lounge-product') || null
  );
}

async function loadTerminalLounges(airportId, terminal) {
  const carouselBase = `${BASE}/api/airportServices/carousels?${QUERY}&type=tab&slug=lounge-pass-list`;
  const byTitle = new Map();
  let total = 0;
  let pagesFetched = 0;
  let lastHttp = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const carousel = await fetchJson(`${carouselBase}&page=${page}&size=${PAGE_SIZE}`, {
      method: 'POST',
      body: { appliedFilters: { airportId: String(airportId), terminal } },
    });
    lastHttp = carousel.status;
    if (carousel.timedOut) {
      return {
        timedOut: true,
        where: `carousels-page-${page}`,
        lounges: [...byTitle.values()],
        total,
        pagesFetched,
      };
    }
    if (carousel.status === 401) {
      return { authFailed: true, where: `carousels-page-${page}` };
    }

    const block = pickLoungeBlock(carousel.data);
    total = Number(block?.totalCount || total || 0);
    const chunk = block?.data || [];
    pagesFetched++;
    for (const p of chunk) {
      const title = p.title || '';
      const k = `${norm(title)}|${p.selectedOption?.optionId || p.productId || ''}`;
      if (!byTitle.has(k)) {
        byTitle.set(k, {
          title,
          productId: p.productId,
          terminal: p.selectedOption?.terminal || p.availableOptions?.[0]?.terminal || terminal,
          optionId: p.selectedOption?.optionId,
          optionIds: (p.availableOptions || []).map((o) => o.optionId).filter(Boolean),
          highlight: (p.highlights || []).map((h) => h.title || '').join(' '),
        });
      }
    }
    if (!chunk.length) break;
    if (total > 0 && byTitle.size >= total) break;
    if (chunk.length < PAGE_SIZE) break;
  }

  return {
    timedOut: false,
    authFailed: false,
    http: lastHttp,
    total,
    pagesFetched,
    lounges: [...byTitle.values()],
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

function titleCandidates(fields) {
  const raw = [
    fields.optionSubTitle,
    fields.optionTitle,
    fields.normName,
    fields.loungeName,
  ].filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    const parts = [c, ...String(c).split(/\s+[–—-]\s+/)];
    for (const p of parts) {
      const t = String(p || '').trim();
      const k = norm(t);
      if (!t || k.length < 4 || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

function loungeHit(fields, apiLounges) {
  const candidates = titleCandidates(fields);

  for (const c of candidates) {
    const exact = apiLounges.find((p) => norm(p.title) === norm(c));
    if (exact) return { hit: exact, via: 'exact-title' };
  }
  for (const c of candidates) {
    const loose = apiLounges.find((p) => namesLooselyEqual(p.title, c));
    if (loose) return { hit: loose, via: 'loose-title' };
  }
  if (fields.location) {
    const loc = apiLounges.find(
      (p) => p.highlight && namesLooselyEqual(p.highlight, fields.location),
    );
    if (loc) return { hit: loc, via: 'location-highlight' };
  }
  return { hit: null, via: null };
}

function rowLoungeFields(row, col) {
  return {
    optionSubTitle: (row[col['Option SubTitle']] || '').trim(),
    optionTitle: (row[col['Option Title']] || '').trim(),
    normName: (row[col['Normalized Lounge Name']] || '').trim(),
    loungeName: (row[col['Lounge Name']] || '').trim(),
    location: (row[col.Location] || '').trim(),
  };
}

console.log('Loading CSV…');
const table = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const header = table[0];
const col = Object.fromEntries(header.map((n, i) => [n, i]));
const statusIdx = ensureCol(header, table, 'working_qa_status');
for (let i = 0; i < header.length; i++) col[header[i]] = i;
for (let i = 1; i < table.length; i++) while (table[i].length < header.length) table[i].push('');

const RETRY_NF = process.env.LOUNGE_RETRY_NF === '1';

async function loadAllTerminalLounges(airport) {
  const terminals = [...new Set((airport.terminals || []).filter(Boolean))];
  const byTitle = new Map();
  const termStats = [];
  for (const terminal of terminals) {
    const carousel = await loadTerminalLounges(airport.entityId, terminal);
    if (carousel.authFailed) return { authFailed: true, where: carousel.where };
    if (carousel.timedOut) {
      termStats.push({ terminal, error: 'timeout', lounges: (carousel.lounges || []).length });
    } else {
      termStats.push({ terminal, lounges: carousel.lounges.length, total: carousel.total });
    }
    for (const p of carousel.lounges || []) {
      const k = `${norm(p.title)}|${p.optionId || p.productId || ''}|${norm(p.terminal || terminal)}`;
      if (!byTitle.has(k)) byTitle.set(k, p);
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  }
  return { lounges: [...byTitle.values()], terminals, termStats };
}

if (RETRY_NF) {
  const nfRows = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    if ((row[statusIdx] || '').trim() !== 'not found') continue;
    nfRows.push(i);
  }
  const airportJobs = [];
  const seenIata = new Set();
  for (const i of nfRows) {
    const row = table[i];
    const iata = (row[col.IATA] || '').trim();
    const airport = (row[col['Airport Name']] || '').trim();
    const key = iata || norm(airport);
    if (!key || seenIata.has(key)) continue;
    seenIata.add(key);
    airportJobs.push({ iata, airport });
  }
  console.log(
    `RETRY_NF: ${nfRows.length} not-found rows | ${airportJobs.length} airports | fetching all terminals`,
  );
  const loungesByIata = new Map();
  let retryAuth = null;
  for (let j = 0; j < airportJobs.length; j++) {
    const job = airportJobs[j];
    process.stdout.write(`[${j + 1}/${airportJobs.length}] ${job.iata || '-'} ${job.airport} … `);
    const search = await searchAirport(job.airport, job.iata);
    if (search.authFailed) {
      console.log('AUTH FAIL — NEED NEW BEARER');
      retryAuth = search;
      break;
    }
    if (search.timedOut || !search.airport) {
      console.log(search.timedOut ? 'TIMEOUT' : 'airport not found');
      loungesByIata.set(job.iata, []);
      continue;
    }
    const all = await loadAllTerminalLounges(search.airport);
    if (all.authFailed) {
      console.log('AUTH FAIL — NEED NEW BEARER');
      retryAuth = all;
      break;
    }
    console.log(
      `ok airportId=${search.airport.entityId} terminals=${all.terminals.length} lounges=${all.lounges.length}`,
    );
    loungesByIata.set(job.iata, all.lounges);
    saveProgress({
      retryNf: true,
      done: j + 1,
      total: airportJobs.length,
      at: `${job.iata} ${job.airport}`,
    });
  }

  const summary = { yes: 0, 'not found': 0, no: 0, blank: 0, recovered: 0 };
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const st = (row[statusIdx] || '').trim();
    if (st === 'yes') {
      summary.yes++;
      continue;
    }
    if (st && st !== 'not found') {
      summary[st] = (summary[st] || 0) + 1;
      continue;
    }
    if (!nfRows.includes(i)) {
      if (!st) summary.blank++;
      else summary['not found']++;
      continue;
    }
    const iata = (row[col.IATA] || '').trim();
    const { hit, via } = loungeHit(rowLoungeFields(row, col), loungesByIata.get(iata) || []);
    if (hit) {
      row[statusIdx] = 'yes';
      summary.yes++;
      summary.recovered++;
      row._via = via;
    } else {
      row[statusIdx] = 'not found';
      summary['not found']++;
    }
  }
  console.log(`Recovered ${summary.recovered} previously not-found rows`);

  console.log('\nWriting CSV…');
  const csvBody = table.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  let csvWritten = null;
  const fallback = 'reports/lounge-availability-qa-updated.csv';
  for (const out of [CSV_PATH, fallback]) {
    try {
      fs.writeFileSync(out, csvBody, 'utf8');
      csvWritten = out;
      console.log('Wrote', out);
      break;
    } catch (e) {
      console.error(`CSV write failed (${out}):`, e.code || e.message);
    }
  }
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    mode: 'RETRY_NF',
    airports: airportJobs.length,
    authFailed: retryAuth,
    summary,
    csvWritten,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===', JSON.stringify({ totals: summary, csvWritten }, null, 2));
  console.log('Wrote', REPORT);
  if (retryAuth) process.exit(2);
  if (!csvWritten) process.exit(4);
  process.exit(0);
}

const jobs = [];
const seen = new Set();
for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 4) continue;
  const airport = (row[col['Airport Name']] || '').trim();
  const terminal =
    (row[col['Vendor Terminal']] || '').trim() || (row[col.Terminal] || '').trim();
  const iata = (row[col.IATA] || '').trim();
  if (!airport) continue;
  const key = `${norm(airport)}|${norm(terminal)}|${norm(iata)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  jobs.push({ airport, terminal, iata, key });
}

console.log(`CSV rows: ${table.length - 1} | unique airport+terminal jobs: ${jobs.length}`);
console.log(`Pagination: pageSize=${PAGE_SIZE}`);

const catalogByJob = new Map();
let authFailed = null;
const timeouts = [];
const jobResults = [];

for (let j = 0; j < jobs.length; j++) {
  const job = jobs[j];
  const label = `${job.iata || '-'} ${job.airport} / ${job.terminal || '(no terminal)'}`;
  process.stdout.write(`[${j + 1}/${jobs.length}] ${label} … `);

  const search = await searchAirport(job.airport, job.iata);
  if (search.authFailed) {
    console.log('AUTH FAIL — NEED NEW BEARER');
    authFailed = { job, where: search.where };
    saveProgress({ stopped: 'AUTH', at: label, done: j, total: jobs.length });
    break;
  }
  if (search.timedOut) {
    console.log('TIMEOUT (search)');
    timeouts.push({ ...job, where: 'search' });
    catalogByJob.set(job.key, { lounges: [], error: 'timeout-search' });
    continue;
  }
  if (!search.airport) {
    console.log('airport not found');
    catalogByJob.set(job.key, { lounges: [], error: 'airport-not-found' });
    jobResults.push({ ...job, productCount: 0, note: 'airport-not-found' });
    continue;
  }

  let terminal = job.terminal;
  if (terminal) {
    const apiTerms = search.airport.terminals || [];
    const matched = apiTerms.find((t) => terminalsMatch(t, terminal));
    if (matched) terminal = matched;
  } else if ((search.airport.terminals || []).length === 1) {
    terminal = search.airport.terminals[0];
  }

  if (!terminal) {
    console.log(`airport ok id=${search.airport.entityId} no terminal`);
    catalogByJob.set(job.key, {
      airport: search.airport,
      lounges: [],
      error: 'missing-vendor-terminal',
    });
    jobResults.push({ ...job, productCount: 0, note: 'missing-vendor-terminal' });
    continue;
  }

  const carousel = await loadTerminalLounges(search.airport.entityId, terminal);
  if (carousel.authFailed) {
    console.log('AUTH FAIL — NEED NEW BEARER');
    authFailed = { job, where: carousel.where };
    saveProgress({ stopped: 'AUTH', at: label, done: j, total: jobs.length });
    break;
  }
  if (carousel.timedOut) {
    console.log(`TIMEOUT (${carousel.where})`);
    timeouts.push({ ...job, where: carousel.where });
    catalogByJob.set(job.key, {
      airport: search.airport,
      lounges: carousel.lounges || [],
      error: 'timeout-carousel',
    });
    continue;
  }

  console.log(
    `ok airportId=${search.airport.entityId} lounges=${carousel.lounges.length} total=${carousel.total} pages=${carousel.pagesFetched}`,
  );
  catalogByJob.set(job.key, {
    airport: search.airport,
    terminal,
    lounges: carousel.lounges,
    total: carousel.total,
    pagesFetched: carousel.pagesFetched,
  });
  jobResults.push({
    ...job,
    airportId: search.airport.entityId,
    productCount: carousel.lounges.length,
    total: carousel.total,
    pagesFetched: carousel.pagesFetched,
  });

  if ((j + 1) % 10 === 0 || j === jobs.length - 1) {
    saveProgress({ running: j < jobs.length - 1, at: label, done: j + 1, total: jobs.length, timeouts });
  }
  if (DELAY_MS) await sleep(DELAY_MS);
}

const summary = { yes: 0, 'not found': 0, no: 0, blank: 0 };

for (let i = 1; i < table.length; i++) {
  const row = table[i];
  if (!row || row.length < 4) continue;
  while (row.length < header.length) row.push('');
  const airport = (row[col['Airport Name']] || '').trim();
  const vendorTerminal = (row[col['Vendor Terminal']] || '').trim();
  const terminalCol = (row[col.Terminal] || '').trim();
  const terminal = vendorTerminal || terminalCol;
  const iata = (row[col.IATA] || '').trim();
  if (!airport) {
    row[statusIdx] = '';
    summary.blank++;
    continue;
  }
  const key = `${norm(airport)}|${norm(terminal)}|${norm(iata)}`;
  const cat = catalogByJob.get(key);
  if (authFailed && !cat) {
    if (!row[statusIdx]) row[statusIdx] = '';
    summary.blank++;
    continue;
  }
  if (!cat || cat.error === 'timeout-search' || cat.error === 'airport-not-found') {
    row[statusIdx] = 'not found';
    summary['not found']++;
    continue;
  }
  if (!cat.lounges || cat.lounges.length === 0) {
    row[statusIdx] = 'not found';
    summary['not found']++;
    continue;
  }
  const { hit } = loungeHit(rowLoungeFields(row, col), cat.lounges);
  if (hit) {
    row[statusIdx] = 'yes';
    summary.yes++;
  } else {
    row[statusIdx] = 'not found';
    summary['not found']++;
  }
}

console.log('\nWriting CSV…');
const csvBody = table.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
let csvWritten = null;
const fallback = 'reports/lounge-availability-qa-updated.csv';
for (const out of [CSV_PATH, fallback]) {
  try {
    fs.writeFileSync(out, csvBody, 'utf8');
    csvWritten = out;
    console.log('Wrote', out);
    break;
  } catch (e) {
    console.error(`CSV write failed (${out}):`, e.code || e.message);
  }
}

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  pageSize: PAGE_SIZE,
  jobs: jobs.length,
  jobsCompleted: jobResults.length,
  authFailed,
  timeouts,
  summary,
  csvWritten,
  jobResults,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
saveProgress({ running: false, done: jobResults.length, total: jobs.length, timeouts, authFailed, csvWritten });

console.log('\n=== SUMMARY ===', JSON.stringify({ totals: summary, csvWritten }, null, 2));
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
