/**
 * Prod Entertainer getAirportList — remaining countries sheet.
 * Flags non-operational POIs that should not appear:
 *   - sheet inactive codes
 *   - railway / bus / station POIs
 *   - closed / abandoned / disused airports by name
 *
 * Env: TV_TOKEN, optional CONCURRENCY (default 6), SHEET_SUMMARY
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SUMMARY =
  process.env.SHEET_SUMMARY || path.join(ROOT, 'reports/_sheet_summary.json');
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
const token = process.env.TV_TOKEN;
if (!token) {
  console.error('Missing TV_TOKEN');
  process.exit(1);
}

const sheet = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'));
const countries = sheet.countries;
const inactive = sheet.inactive;
const sheetRailBus = sheet.sheet_rail_bus || [];

const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/json',
  'content-type': 'application/json',
};

const BUS =
  /\b(bus|buses|coach)\s*(stop|station|terminal|stand|depot)s?\b|\bbusbahnhof\b|\brodovi[aá]ria\b|\bhalte\b/i;
const RAIL =
  /\b(railway|railroad)\b|\b(rail|train)\s+station\b|\bhauptbahnhof\b|\bbahnhof\b|\btgv\b|\bgare\b|\bintermodal\s+station\b|\bT Station\b/i;
const STATION_NAME = /\bstation\b/i;
const AIR_FACILITY =
  /airport|airfield|air base|air station|airstrip|aerodrome|heliport|seaplane|naval air|raf |usaf |afb\b|coast guard|sea\s*plane/i;
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
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
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

async function findByCode(code) {
  const hits = [];
  for (let page = 0; page < 3; page += 1) {
    const { http, body } = await fetchPage(code, page);
    if (http !== 200) break;
    const list = Array.isArray(body.result) ? body.result : [];
    if (!list.length || body.status === '-1' || body.info === 'Data not found') break;
    for (const row of list) {
      if (String(row.airportCode || '').toUpperCase() === String(code).toUpperCase()) {
        hits.push({
          code: row.airportCode,
          name: row.airportName,
          city: row.city,
          country: row.country,
          entityType: row.entityType,
        });
      }
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    const k = [h.code, h.name, h.country].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(h);
  }
  return { code, stillPresent: uniq.length > 0, hits: uniq };
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
      return { query, pages: page, rows: rows.length, busHits, railHits, closedHits, status: 'ERROR', error: 'HTTP ' + http };
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

const reportPath = path.join(ROOT, 'reports/entertainer-remaining-countries-prod.json');
const mdPath = path.join(ROOT, 'reports/entertainer-remaining-countries-prod.md');

const out = {
  at: new Date().toISOString(),
  env: 'https://api.travelvip.ai',
  path: '/api/airportServices/getAirportList?pid=ent',
  concurrency: CONCURRENCY,
  sheetCountries: countries.length,
  inactiveStillPresent: [],
  inactiveGone: 0,
  activeRailStillInSheet: [],
  keywordScans: [],
  countryResults: [],
  nonOperationalTable: [],
};

function savePartial() {
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
}

function hitKey(h) {
  return [h.code, h.country, h.name].join('|');
}

function buildTable() {
  const map = new Map();
  const add = (kind, h, note = '') => {
    const k = hitKey(h) + '|' + kind;
    if (map.has(k)) return;
    map.set(k, {
      kind,
      code: h.code,
      country: h.country,
      name: h.name,
      city: h.city,
      note,
    });
  };
  for (const item of out.inactiveStillPresent) {
    for (const h of item.hits) add('INACTIVE_LEAK', h, 'sheet inactive');
  }
  for (const item of out.activeRailStillInSheet) {
    if (item.stillPresent) for (const h of item.hits) add('SHEET_ACTIVE_STATION', h, 'still active in sheet');
  }
  for (const r of [...out.keywordScans, ...out.countryResults]) {
    for (const h of r.railHits || []) add('RAIL_STATION', h);
    for (const h of r.busHits || []) add('BUS_STAND', h);
    for (const h of r.closedHits || []) add('CLOSED_AIRPORT', h);
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
    inactiveStillPresent: out.inactiveStillPresent.length,
    nonOperationalUnique: out.nonOperationalTable.length,
    railBus: out.nonOperationalTable.filter((r) => r.kind === 'RAIL_STATION' || r.kind === 'BUS_STAND').length,
    closed: out.nonOperationalTable.filter((r) => r.kind === 'CLOSED_AIRPORT').length,
  };
  out.summary = summary;

  const md = [];
  md.push('# Entertainer remaining countries — prod getAirportList');
  md.push('');
  md.push(`At: ${out.at}`);
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push('| Metric | Value |');
  md.push('|--------|------:|');
  md.push(`| Countries scanned | ${summary.countriesScanned} |`);
  md.push(`| Country PASS | ${summary.countryPass} |`);
  md.push(`| Country BUG | ${summary.countryBug} |`);
  md.push(`| Inactive gone | ${summary.inactiveGone} |`);
  md.push(`| Inactive still present | ${summary.inactiveStillPresent} |`);
  md.push(`| Non-operational hits | ${summary.nonOperationalUnique} |`);
  md.push(`| Rail/bus among hits | ${summary.railBus} |`);
  md.push(`| Closed-by-name among hits | ${summary.closed} |`);
  md.push('');
  md.push('## Non-operational / rail / bus / closed (Code | Country | Station name)');
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
      `- **${r.query}** rail=${r.railHits.length} bus=${r.busHits.length} closed=${r.closedHits.length}`,
    );
  }
  fs.writeFileSync(mdPath, md.join('\n'));
}

console.log('Auth smoke…');
{
  const smoke = await fetchPage('SIN', 0);
  if (smoke.http !== 200) {
    console.error('Auth/smoke failed', smoke.http, JSON.stringify(smoke.body).slice(0, 300));
    process.exit(2);
  }
  console.log('smoke OK');
}

console.log(`\n=== Inactive codes (${inactive.length}) concurrency=${CONCURRENCY}`);
{
  let done = 0;
  await mapPool(inactive, CONCURRENCY, async (item) => {
    const r = await findByCode(item.code);
    done += 1;
    if (r.stillPresent) {
      out.inactiveStillPresent.push({
        code: item.code,
        sheetCountry: item.country,
        sheetTitle: item.title,
        hits: r.hits,
      });
      console.log('STILL', item.code, item.country, item.title);
    } else {
      out.inactiveGone += 1;
    }
    if (done % 40 === 0) console.log('  inactive', done, '/', inactive.length);
  });
  savePartial();
}

console.log(`\n=== Sheet-active rail/bus (${sheetRailBus.filter((x) => String(x.active).toLowerCase() === 'active').length})`);
{
  const activeRail = sheetRailBus.filter((x) => String(x.active).toLowerCase() === 'active');
  for (const item of activeRail) {
    const r = await findByCode(item.code);
    out.activeRailStillInSheet.push({
      code: item.code,
      sheetCountry: item.country,
      sheetTitle: item.title,
      stillPresent: r.stillPresent,
      hits: r.hits,
    });
    console.log(r.stillPresent ? 'PRESENT' : 'GONE', item.code, item.country, item.title);
  }
  savePartial();
}

const keywordQueries = [
  'Railway Station',
  'Rail Station',
  'Bus Station',
  'Bus Stand',
  'Hauptbahnhof',
  'Bahnhof',
  'Gare',
  'Closed Airport',
  'Abandoned Airport',
  'Disused Airport',
];
console.log(`\n=== Keyword scans (${keywordQueries.length})`);
{
  await mapPool(keywordQueries, Math.min(4, CONCURRENCY), async (q) => {
    const r = await scanQuery(q, 100);
    out.keywordScans.push(r);
    console.log(
      r.status,
      q,
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
  });
  savePartial();
}

console.log(`\n=== Country scans (${countries.length})`);
{
  let done = 0;
  await mapPool(countries, CONCURRENCY, async (c) => {
    const r = await scanQuery(c, 200);
    out.countryResults.push(r);
    done += 1;
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
    if (done % 20 === 0) {
      console.log('  country progress', done, '/', countries.length);
      buildTable();
      writeMd();
      savePartial();
    }
  });
}

buildTable();
writeMd();
savePartial();
console.log('\nWROTE', reportPath);
console.log('WROTE', mdPath);
console.log(JSON.stringify(out.summary, null, 2));
