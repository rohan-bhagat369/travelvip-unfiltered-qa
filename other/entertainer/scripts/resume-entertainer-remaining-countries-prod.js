/**
 * Resume remaining-country prod scan from partial report.
 * Env: TV_TOKEN, CONCURRENCY (default 8)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'reports/entertainer-remaining-countries-prod.json');
const MD = path.join(ROOT, 'reports/entertainer-remaining-countries-prod.md');
const REMAINING = path.join(ROOT, 'reports/_remaining_countries.json');
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 8));
const token = process.env.TV_TOKEN;
if (!token) {
  console.error('Missing TV_TOKEN');
  process.exit(1);
}

const out = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const remaining = JSON.parse(fs.readFileSync(REMAINING, 'utf8'));
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/json',
  'content-type': 'application/json',
};

const BUS =
  /\b(bus|buses|coach)\s*(stop|station|terminal|stand|depot)s?\b|\bbusbahnhof\b|\brodovi[aá]ria\b|\bhalte\b/i;
const RAIL =
  /\b(railway|railroad)\b|\b(rail|train)\s+station\b|\bhauptbahnhof\b|\bbahnhof\b|\btgv\b|\bgare\b|\bintermodal\s+station\b/i;
const STATION_NAME = /\bstation\b/i;
const AIR_FACILITY =
  /airport|airfield|air base|air force station|air station|airstrip|aerodrome|heliport|seaplane|sea\s*plane|naval (air )?station|naval station|coast guard|raf |usaf |afb\b|chambers field|easterwood/i;
const CLOSED =
  /\b(closed|abandoned|disused|defunct|decommissioned|not\s+operational|former\s+airport|no\s+longer\s+operational)\b/i;

function classify(row) {
  const text = [row.airportName, row.city, row.tag].filter(Boolean).join(' ');
  const bus = BUS.test(text);
  const rail = RAIL.test(text) || (STATION_NAME.test(text) && !AIR_FACILITY.test(text));
  const closed = CLOSED.test(text);
  return { bus, rail, closed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapPool(items, limit, fn) {
  const outArr = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      outArr[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return outArr;
}

async function fetchPage(airport, page) {
  const u =
    'https://api.travelvip.ai/api/airportServices/getAirportList?key=hdbchdgvdffdh&pid=ent&platform=web&client=web&lang=en&currency=GBP&airport=' +
    encodeURIComponent(airport) +
    '&page=' +
    page +
    '&perpage=20';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const r = await fetch(u, { headers });
      if (r.status === 429 || r.status >= 500) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return { http: r.status, body: await r.json() };
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return { http: 0, body: {} };
}

async function scanQuery(query, maxPages = 200) {
  const seen = new Set();
  const rows = [];
  const busHits = [];
  const railHits = [];
  const closedHits = [];
  let page = 0;
  while (page < maxPages) {
    const { http, body } = await fetchPage(query, page);
    if (http !== 200) {
      return {
        query,
        pages: page,
        rows: rows.length,
        busHits,
        railHits,
        closedHits,
        status: 'ERROR',
        error: 'HTTP ' + http,
      };
    }
    const list = Array.isArray(body.result) ? body.result : [];
    if (!list.length || body.status === '-1' || body.info === 'Data not found') break;
    for (const row of list) {
      const key = [row.airportCode, row.airportName, row.city, row.country].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      const { bus, rail, closed } = classify(row);
      const hit = {
        code: row.airportCode,
        name: row.airportName,
        city: row.city,
        country: row.country,
        entityType: row.entityType,
        page,
      };
      if (bus) busHits.push(hit);
      if (rail) railHits.push(hit);
      if (closed) closedHits.push(hit);
    }
    page += 1;
  }
  const bad = busHits.length || railHits.length || closedHits.length;
  return {
    query,
    pages: page,
    rows: rows.length,
    busHits,
    railHits,
    closedHits,
    status: bad ? 'BUG' : 'PASS',
  };
}

function rebuildTable() {
  // reclassify keyword + country rail hits with tighter AIR_FACILITY
  for (const r of [...(out.keywordScans || []), ...(out.countryResults || [])]) {
    const rail = [];
    const bus = [];
    const closed = [];
    for (const h of [...(r.railHits || []), ...(r.busHits || []), ...(r.closedHits || [])]) {
      const { bus: b, rail: rr, closed: c } = classify({
        airportName: h.name,
        city: h.city,
        tag: null,
      });
      if (b) bus.push(h);
      if (rr) rail.push(h);
      if (c) closed.push(h);
    }
    // keep original lists for audit but also store filtered for table via fresh classify on merge
    r._filteredRail = rail;
    r._filteredBus = bus;
    r._filteredClosed = closed;
    r.status =
      rail.length || bus.length || closed.length
        ? 'BUG'
        : r.status === 'ERROR'
          ? 'ERROR'
          : 'PASS';
  }

  const map = new Map();
  const add = (kind, h, note = '') => {
    const k = [kind, h.code, h.country, h.name].join('|');
    if (map.has(k)) return;
    map.set(k, { kind, code: h.code, country: h.country, name: h.name, city: h.city, note });
  };
  for (const item of out.inactiveStillPresent || []) {
    for (const h of item.hits || []) add('INACTIVE_LEAK', h, 'sheet inactive');
  }
  for (const item of out.activeRailStillInSheet || []) {
    if (!item.stillPresent) continue;
    for (const h of item.hits || []) {
      const { rail, bus } = classify({ airportName: h.name || item.sheetTitle, city: h.city, tag: null });
      if (rail || bus) add('SHEET_ACTIVE_STATION', h, 'still active in sheet');
      else add('SHEET_ACTIVE_OTHER', h, 'sheet active; not rail/bus POI');
    }
  }
  for (const r of [...(out.keywordScans || []), ...(out.countryResults || [])]) {
    for (const h of r._filteredRail || []) add('RAIL_STATION', h);
    for (const h of r._filteredBus || []) add('BUS_STAND', h);
    for (const h of r._filteredClosed || []) add('CLOSED_AIRPORT', h);
  }
  out.nonOperationalTable = [...map.values()].sort(
    (a, b) =>
      String(a.kind).localeCompare(String(b.kind)) ||
      String(a.country).localeCompare(String(b.country)) ||
      String(a.code).localeCompare(String(b.code)),
  );
}

function writeMd() {
  const summary = {
    countriesScanned: out.countryResults.length,
    countryPass: out.countryResults.filter((r) => r.status === 'PASS').length,
    countryBug: out.countryResults.filter((r) => r.status === 'BUG').length,
    countryError: out.countryResults.filter((r) => r.status === 'ERROR').length,
    inactiveGone: out.inactiveGone,
    inactiveStillPresent: (out.inactiveStillPresent || []).length,
    nonOperationalUnique: out.nonOperationalTable.length,
    railBus: out.nonOperationalTable.filter((r) => r.kind === 'RAIL_STATION' || r.kind === 'BUS_STAND').length,
    closed: out.nonOperationalTable.filter((r) => r.kind === 'CLOSED_AIRPORT').length,
  };
  out.summary = summary;
  out.resumedAt = new Date().toISOString();

  const md = [];
  md.push('# Entertainer remaining countries — prod getAirportList');
  md.push('');
  md.push(`At: ${out.at}`);
  md.push(`Resumed: ${out.resumedAt}`);
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push('| Metric | Value |');
  md.push('|--------|------:|');
  md.push(`| Countries scanned | ${summary.countriesScanned} |`);
  md.push(`| Country PASS | ${summary.countryPass} |`);
  md.push(`| Country BUG | ${summary.countryBug} |`);
  md.push(`| Country ERROR | ${summary.countryError} |`);
  md.push(`| Inactive gone | ${summary.inactiveGone} |`);
  md.push(`| Inactive still present | ${summary.inactiveStillPresent} |`);
  md.push(`| Non-operational hits | ${summary.nonOperationalUnique} |`);
  md.push(`| Rail/bus among hits | ${summary.railBus} |`);
  md.push(`| Closed-by-name among hits | ${summary.closed} |`);
  md.push('');
  md.push('## Code | Country | Station name');
  md.push('');
  md.push('| Code | Country | Station name | Kind |');
  md.push('|------|---------|--------------|------|');
  for (const row of out.nonOperationalTable) {
    md.push(`| ${row.code} | ${row.country} | ${row.name} | ${row.kind} |`);
  }
  md.push('');
  md.push('## Country BUG list');
  md.push('');
  for (const r of out.countryResults.filter((x) => x.status === 'BUG')) {
    md.push(
      `- **${r.query}** rail=${(r._filteredRail || r.railHits || []).length} bus=${(r._filteredBus || r.busHits || []).length} closed=${(r._filteredClosed || r.closedHits || []).length}`,
    );
  }
  fs.writeFileSync(MD, md.join('\n'));
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
}

console.log('Auth smoke…');
{
  const smoke = await fetchPage('SIN', 0);
  if (smoke.http !== 200) {
    console.error('Auth failed', smoke.http);
    process.exit(2);
  }
  console.log('smoke OK — remaining countries', remaining.length);
}

const done = new Set((out.countryResults || []).map((r) => r.query));
const toScan = remaining.filter((c) => !done.has(c));
// also re-scan ones that were ERROR previously among remaining names
const errors = (out.countryResults || []).filter((r) => r.status === 'ERROR').map((r) => r.query);
const queue = [...new Set([...toScan, ...errors.filter((c) => remaining.includes(c) || true)])];
// Prefer: all remaining list + any ERROR in full report for countries in sheet remaining set
const sheetRemaining = new Set(remaining);
const errorRetry = (out.countryResults || [])
  .filter((r) => r.status === 'ERROR' && sheetRemaining.has(r.query))
  .map((r) => r.query);
const finalQueue = [...new Set([...remaining, ...errorRetry])];

console.log('Scanning', finalQueue.length, 'countries…');
let n = 0;
await mapPool(finalQueue, CONCURRENCY, async (c) => {
  const r = await scanQuery(c, 200);
  // replace prior result for same country if present
  out.countryResults = (out.countryResults || []).filter((x) => x.query !== c);
  out.countryResults.push(r);
  n += 1;
  console.log(
    r.status,
    c,
    'pages',
    r.pages,
    'rows',
    r.rows,
    'rail',
    r.railHits.length,
    'bus',
    r.busHits.length,
    'closed',
    r.closedHits.length,
  );
  for (const h of r.railHits) console.log('  RAIL', h.code, h.country, h.name);
  for (const h of r.busHits) console.log('  BUS', h.code, h.country, h.name);
  for (const h of r.closedHits) console.log('  CLOSED', h.code, h.country, h.name);
  if (n % 15 === 0) {
    rebuildTable();
    writeMd();
    console.log('  progress', n, '/', finalQueue.length);
  }
});

rebuildTable();
writeMd();
console.log('\nWROTE', REPORT);
console.log('WROTE', MD);
console.log(JSON.stringify(out.summary, null, 2));
