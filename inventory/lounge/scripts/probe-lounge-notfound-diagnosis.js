/**
 * Diagnose not-found lounges: airport missing vs terminal missing vs lounge name missing.
 *   LOUNGE_BEARER=... node scripts/probe-lounge-notfound-diagnosis.js
 */
import fs from 'fs';
import XLSX from 'xlsx';

const BASE = process.env.LOUNGE_BASE_URL || 'https://api.travelvip.ai';
const QUERY =
  'key=palsgcvgscvvs&pid=smt&platform=web&client=web&lang=en&currency=INR';
const BEARER = process.env.LOUNGE_BEARER || process.env.ATTR_BEARER || '';
const CSV =
  process.env.LOUNGE_CSV || 'reports/final-new-lounges-2nd-import.csv';
const OUT = 'reports/lounge-notfound-diagnosis.json';
const PAGE_SIZE = 20;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesLooselyEqual(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function terminalsMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ra = na.replace(/terminal|term/g, ' ').replace(/\s+/g, ' ').trim();
  const rb = nb.replace(/terminal|term/g, ' ').replace(/\s+/g, ' ').trim();
  return ra && rb && (ra === rb || na.includes(nb) || nb.includes(na));
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${BEARER}`,
      Accept: 'application/json',
      'content-type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

async function searchAirport(airportName, iata) {
  for (const q of [...new Set([iata, airportName].filter(Boolean))]) {
    const url = `${BASE}/api/airportServices/airport-services?${QUERY}&q=${encodeURIComponent(q)}&page=0&size=20&type=lounge`;
    const res = await fetchJson(url);
    if (res.status === 401) return { authFailed: true };
    const list = res.data?.results || [];
    const wantIata = norm(iata);
    const wantName = norm(airportName);
    const airport =
      list.find((r) => norm(r.airportCode) === wantIata) ||
      list.find((r) => norm(r.title) === wantName) ||
      list.find((r) => namesLooselyEqual(r.title, airportName));
    if (airport) return { airport, apiTerminals: airport.terminals || [] };
  }
  return { airport: null, apiTerminals: [] };
}

async function loadTerminal(airportId, terminal) {
  const titles = [];
  let total = 0;
  for (let page = 0; page < 20; page++) {
    const url = `${BASE}/api/airportServices/carousels?${QUERY}&type=tab&slug=lounge-pass-list&page=${page}&size=${PAGE_SIZE}`;
    const res = await fetchJson(url, {
      method: 'POST',
      body: { appliedFilters: { airportId: String(airportId), terminal } },
    });
    if (res.status === 401) return { authFailed: true, titles: [], total: 0 };
    const block = (res.data?.results || []).find(
      (b) => b.contentType === 'PRODUCTS' || b.type === 'lounge-product',
    );
    total = Number(block?.totalCount || total || 0);
    const chunk = block?.data || [];
    for (const p of chunk) titles.push(p.title);
    if (!chunk.length || (total && titles.length >= total) || chunk.length < PAGE_SIZE) break;
  }
  return { titles, total };
}

function loungeMatch(want, titles) {
  if (titles.some((t) => norm(t) === norm(want))) return true;
  if (titles.some((t) => namesLooselyEqual(t, want))) return true;
  return false;
}

if (!BEARER) {
  console.error('Set LOUNGE_BEARER');
  process.exit(2);
}

const wb = XLSX.readFile(CSV);
const rows = XLSX.utils
  .sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  .filter((r) => String(r.working_qa_status || '').trim() === 'not found');

console.log(`Diagnosing ${rows.length} not-found rows…`);
const out = [];

for (const r of rows) {
  const iata = r.IATA;
  const airportName = r['Airport Name'];
  const sheetTerm = r.Terminal || r['Vendor Terminal'];
  const lounge = r['Normalized Lounge Name'] || r['Lounge Name'];
  process.stdout.write(`[${iata}] ${lounge} … `);

  const s = await searchAirport(airportName, iata);
  if (s.authFailed) {
    console.log('TOKEN EXPIRED');
    out.push({ iata, lounge, verdict: 'TOKEN_EXPIRED' });
    break;
  }
  if (!s.airport) {
    console.log('AIRPORT_MISSING');
    out.push({
      iata,
      airport: airportName,
      sheetTerm,
      lounge,
      verdict: 'AIRPORT_MISSING',
      apiTerminals: [],
      sheetTermInApi: false,
      loungesOnSheetTerm: [],
      foundOnOtherTerminal: null,
    });
    continue;
  }

  const apiTerms = s.apiTerminals;
  const matchedTerm = apiTerms.find((t) => terminalsMatch(t, sheetTerm)) || null;
  const sheetTermInApi = !!matchedTerm;
  const termToUse = matchedTerm || sheetTerm;
  const onSheet = await loadTerminal(s.airport.entityId, termToUse);
  if (onSheet.authFailed) {
    console.log('TOKEN EXPIRED');
    out.push({ iata, lounge, verdict: 'TOKEN_EXPIRED' });
    break;
  }

  const hitOnSheet = loungeMatch(lounge, onSheet.titles);
  let foundOnOther = null;
  const perTerm = [];
  for (const t of apiTerms) {
    const L = await loadTerminal(s.airport.entityId, t);
    if (L.authFailed) {
      console.log('TOKEN EXPIRED');
      out.push({ iata, lounge, verdict: 'TOKEN_EXPIRED' });
      foundOnOther = 'AUTH';
      break;
    }
    perTerm.push({ terminal: t, count: L.titles.length, titles: L.titles });
    if (!foundOnOther && loungeMatch(lounge, L.titles) && norm(t) !== norm(termToUse)) {
      foundOnOther = t;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  if (foundOnOther === 'AUTH') break;

  let verdict;
  if (hitOnSheet) verdict = 'LOUNGE_PRESENT_ON_SHEET_TERMINAL';
  else if (foundOnOther) verdict = 'LOUNGE_ON_OTHER_TERMINAL';
  else if (!sheetTermInApi) verdict = 'TERMINAL_NOT_IN_AIRPORT_CATALOG';
  else if (onSheet.titles.length === 0) verdict = 'TERMINAL_OK_BUT_NO_LOUNGES';
  else verdict = 'TERMINAL_HAS_LOUNGES_BUT_THIS_NAME_MISSING';

  console.log(verdict);
  out.push({
    iata,
    airport: airportName,
    airportId: s.airport.entityId,
    sheetTerm,
    matchedApiTerm: matchedTerm,
    lounge,
    verdict,
    apiTerminals: apiTerms,
    sheetTermInApi,
    loungesOnSheetTerm: onSheet.titles,
    foundOnOtherTerminal: foundOnOther,
    otherTerminalLounges: perTerm.filter((p) => p.count > 0),
  });
}

const by = {};
for (const o of out) by[o.verdict] = (by[o.verdict] || 0) + 1;
fs.mkdirSync('reports', { recursive: true });
const report = { ranAt: new Date().toISOString(), byVerdict: by, rows: out };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== byVerdict ===', JSON.stringify(by, null, 2));
console.log('Wrote', OUT);
if (out.some((o) => o.verdict === 'TOKEN_EXPIRED')) process.exit(2);
