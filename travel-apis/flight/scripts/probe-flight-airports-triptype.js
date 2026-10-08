/**
 * Positive / negative / edge for GET /v1/flights/airports?tripType=
 *
 * Product contract (2026-10):
 * - tripType=domestic → only Indian airports
 * - tripType=international OR omit → unfiltered (IN + non-IN)
 * - legacy domestic=true|false is a no-op — do not send it
 *
 * Run: node scripts/probe-flight-airports-triptype.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const OUT = path.join('reports', 'flight-airports-triptype-cases.json');

function listOf(data) {
  return Array.isArray(data?.result) ? data.result : [];
}

function isIndia(row) {
  return String(row?.country || '').trim().toLowerCase() === 'india';
}

function summarize(res) {
  const list = listOf(res.data);
  const countries = {};
  for (const row of list) {
    const country = row.country || '(blank)';
    countries[country] = (countries[country] || 0) + 1;
  }
  return {
    http: res.status,
    apiStatus: res.data?.status ?? null,
    info: res.data?.info || res.data?.error?.code || null,
    totalResults: res.data?.totalResults ?? null,
    pageCount: list.length,
    india: list.filter(isIndia).length,
    nonIndia: list.filter((row) => !isIndia(row)).length,
    codes: list.map((row) => row.airportCode),
    countries,
    nonIndiaSample: list.filter((row) => !isIndia(row)).slice(0, 5).map((row) => ({
      airportCode: row.airportCode,
      city: row.city,
      country: row.country,
    })),
  };
}

function score(expect, summary) {
  if (summary.http >= 500) {
    return { status: 'BUG', note: `HTTP ${summary.http}` };
  }
  if (expect === 'only-india') {
    if (summary.pageCount === 0) return { status: 'BUG', note: 'expected Indian airports, got none' };
    if (summary.nonIndia > 0) return { status: 'BUG', note: `non-India rows: ${JSON.stringify(summary.nonIndiaSample)}` };
    return { status: 'PASS', note: `${summary.india} India, 0 other` };
  }
  if (expect === 'only-india-or-empty') {
    if (summary.nonIndia > 0) return { status: 'BUG', note: `non-India rows: ${JSON.stringify(summary.nonIndiaSample)}` };
    if (summary.pageCount === 0) return { status: 'PASS', note: 'empty page (past last)' };
    return { status: 'PASS', note: `${summary.india} India, 0 other` };
  }
  if (expect === 'no-foreign') {
    if (summary.nonIndia > 0) return { status: 'BUG', note: `foreign airport returned: ${JSON.stringify(summary.nonIndiaSample)}` };
    if (summary.pageCount === 0 || String(summary.apiStatus) === '-1') {
      return { status: 'PASS', note: summary.info || 'no rows' };
    }
    return { status: 'PASS', note: `${summary.india} India only` };
  }
  if (expect === 'includes-foreign') {
    if (summary.nonIndia === 0) return { status: 'BUG', note: 'no international airport in the page' };
    return { status: 'PASS', note: `${summary.nonIndia} non-India on the page, total ${summary.totalResults}` };
  }
  if (expect === 'both') {
    if (summary.india === 0 || summary.nonIndia === 0) {
      return { status: 'BUG', note: `india=${summary.india} nonIndia=${summary.nonIndia}` };
    }
    return { status: 'PASS', note: `india=${summary.india} nonIndia=${summary.nonIndia} total=${summary.totalResults}` };
  }
  if (expect === 'unfiltered-or-reject') {
    // Product: only domestic filters. Unknown values may 4xx or behave like omit.
    if (summary.http >= 400 && summary.http < 500) {
      return { status: 'PASS', note: `HTTP ${summary.http} ${summary.info || ''}` };
    }
    if (summary.http === 200) {
      return { status: 'PASS', note: `HTTP 200 unfiltered/ignored rows=${summary.pageCount} nonIndia=${summary.nonIndia}` };
    }
    return { status: 'BUG', note: `HTTP ${summary.http}` };
  }
  if (expect === 'reject') {
    if (summary.http >= 400 && summary.http < 500) return { status: 'PASS', note: `HTTP ${summary.http} ${summary.info || ''}` };
    return { status: 'BUG', note: `HTTP ${summary.http} accepted, apiStatus=${summary.apiStatus} rows=${summary.pageCount}` };
  }
  if (expect === 'legacy-noop') {
    // domestic= must not filter; LHR should still return (or empty inventory, not India-only filter)
    if (summary.http >= 500) return { status: 'BUG', note: `HTTP ${summary.http}` };
    if (summary.codes.includes('LHR') || summary.nonIndia > 0) {
      return { status: 'PASS', note: 'legacy domestic ignored (foreign still present)' };
    }
    if (summary.pageCount === 0) return { status: 'PASS', note: 'no rows (inventory) — domestic not applied as filter' };
    if (summary.india > 0 && summary.nonIndia === 0 && summary.codes.length) {
      return { status: 'BUG', note: 'looks like domestic filter still active on legacy param' };
    }
    return { status: 'PASS', note: `HTTP ${summary.http} rows=${summary.pageCount}` };
  }
  if (expect === 'case-domestic') {
    // Uppercase DOMESTIC: either 4xx (strict enum) or India-filter (case-insensitive)
    if (summary.http >= 400 && summary.http < 500) {
      return { status: 'PASS', note: `strict enum HTTP ${summary.http} ${summary.info || ''}` };
    }
    if (summary.http === 200 && summary.nonIndia === 0) {
      return { status: 'PASS', note: `case-insensitive domestic (India-only / empty): rows=${summary.pageCount}` };
    }
    if (summary.http === 200 && summary.nonIndia > 0) {
      return { status: 'BUG', note: 'DOMESTIC accepted but did not filter (foreign present)' };
    }
    return { status: 'BUG', note: `HTTP ${summary.http}` };
  }
  if (expect === 'case-international') {
    if (summary.http >= 400 && summary.http < 500) {
      return { status: 'PASS', note: `strict enum HTTP ${summary.http} ${summary.info || ''}` };
    }
    if (summary.http === 200 && summary.nonIndia > 0) {
      return { status: 'PASS', note: `case-insensitive international (unfiltered): nonIndia=${summary.nonIndia}` };
    }
    if (summary.http === 200) {
      return { status: 'PASS', note: `HTTP 200 rows=${summary.pageCount} india=${summary.india}` };
    }
    return { status: 'BUG', note: `HTTP ${summary.http}` };
  }
  return { status: 'BUG', note: `unknown expect ${expect}` };
}

const cases = [
  { id: 'P1', kind: 'positive', rule: 'tripType=domestic, airport=bom → India only + BOM', query: { airport: 'bom', tripType: 'domestic' }, expect: 'only-india', mustInclude: 'BOM' },
  { id: 'P2', kind: 'positive', rule: 'tripType=domestic, airport=del → India only + DEL', query: { airport: 'del', tripType: 'domestic' }, expect: 'only-india', mustInclude: 'DEL' },
  { id: 'P3', kind: 'positive', rule: 'tripType=domestic, airport=blr → India only + BLR', query: { airport: 'blr', tripType: 'domestic' }, expect: 'only-india', mustInclude: 'BLR' },
  { id: 'P4', kind: 'positive', rule: 'tripType=international, airport=lhr → LHR', query: { airport: 'lhr', tripType: 'international' }, expect: 'includes-foreign', mustInclude: 'LHR' },
  { id: 'P5', kind: 'positive', rule: 'tripType=international, airport=dxb → DXB', query: { airport: 'dxb', tripType: 'international' }, expect: 'includes-foreign', mustInclude: 'DXB' },
  { id: 'P6', kind: 'positive', rule: 'tripType=international, airport=de → India + other', query: { airport: 'de', tripType: 'international', perpage: 20 }, expect: 'both' },
  { id: 'P7', kind: 'positive', rule: 'tripType=domestic, airport=mumbai → India only', query: { airport: 'mumbai', tripType: 'domestic' }, expect: 'only-india', mustInclude: 'BOM' },

  { id: 'N1', kind: 'negative', rule: 'tripType=domestic, airport=lhr hides LHR', query: { airport: 'lhr', tripType: 'domestic' }, expect: 'no-foreign', mustExclude: 'LHR' },
  { id: 'N2', kind: 'negative', rule: 'tripType=domestic, airport=dxb hides DXB', query: { airport: 'dxb', tripType: 'domestic' }, expect: 'no-foreign', mustExclude: 'DXB' },
  { id: 'N3', kind: 'negative', rule: 'tripType=domestic, airport=sin hides SIN', query: { airport: 'sin', tripType: 'domestic' }, expect: 'no-foreign', mustExclude: 'SIN' },
  { id: 'N4', kind: 'negative', rule: 'tripType=domestic, airport=cdg hides CDG', query: { airport: 'cdg', tripType: 'domestic' }, expect: 'no-foreign', mustExclude: 'CDG' },
  { id: 'N5', kind: 'negative', rule: 'tripType=<script> → 4xx VALIDATION_ERROR, never 500', query: { airport: 'del', tripType: '<script>' }, expect: 'reject' },
  { id: 'N6', kind: 'negative', rule: 'tripType=domestic, → 4xx, never 500', query: { airport: 'del', tripType: 'domestic,' }, expect: 'reject' },
  { id: 'N7', kind: 'negative', rule: 'tripType=!@#$ → 4xx, never 500', query: { airport: 'del', tripType: '!@#$' }, expect: 'reject' },
  { id: 'N8', kind: 'negative', rule: 'tripType empty → 4xx, never 500', query: { airport: 'del', tripType: '' }, expect: 'reject' },
  { id: 'N9', kind: 'negative', rule: 'tripType=GARBAGE → 4xx, never 500', query: { airport: 'lhr', tripType: 'GARBAGE' }, expect: 'reject' },
  { id: 'N10', kind: 'negative', rule: 'airport=<script> with tripType=domestic never 500', query: { airport: '<script>', tripType: 'domestic' }, expect: 'unfiltered-or-reject' },
  { id: 'N11', kind: 'negative', rule: 'tripType=true → 4xx', query: { airport: 'del', tripType: 'true' }, expect: 'reject' },
  { id: 'N12', kind: 'negative', rule: 'tripType=false → 4xx', query: { airport: 'lhr', tripType: 'false' }, expect: 'reject' },
  { id: 'N13', kind: 'negative', rule: 'tripType=1 → 4xx', query: { airport: 'del', tripType: '1' }, expect: 'reject' },
  { id: 'N14', kind: 'negative', rule: 'tripType=yes → 4xx', query: { airport: 'lhr', tripType: 'yes' }, expect: 'reject' },
  { id: 'N15', kind: 'negative', rule: 'tripType=domestic with trailing space → 4xx', query: { airport: 'del', tripType: 'domestic ' }, expect: 'reject' },

  { id: 'E1', kind: 'edge', rule: 'omit tripType still returns LHR (unfiltered)', query: { airport: 'lhr' }, expect: 'includes-foreign', mustInclude: 'LHR' },
  { id: 'E2', kind: 'edge', rule: 'tripType=DOMESTIC (uppercase) — accept as domestic or 4xx', query: { airport: 'lhr', tripType: 'DOMESTIC' }, expect: 'case-domestic' },
  { id: 'E3', kind: 'edge', rule: 'tripType=International (mixed case) — accept as international or 4xx', query: { airport: 'del', tripType: 'International', perpage: 20 }, expect: 'case-international' },
  { id: 'E4', kind: 'edge', rule: 'tripType=domestic airport=de page all India', query: { airport: 'de', tripType: 'domestic', perpage: 20 }, expect: 'only-india' },
  { id: 'E5', kind: 'edge', rule: 'tripType=international keeps BOM (unfiltered includes India)', query: { airport: 'bom', tripType: 'international' }, expect: 'includes-foreign-or-india', mustInclude: 'BOM' },
  { id: 'E6', kind: 'edge', rule: 'tripType=domestic page 1 airport=de India-only or empty page', query: { airport: 'de', tripType: 'domestic', page: 1, perpage: 10 }, expect: 'only-india-or-empty' },
  { id: 'E7', kind: 'edge', rule: 'blank airport with tripType=domestic → 4xx', query: { airport: '', tripType: 'domestic' }, expect: 'reject' },
  { id: 'E8', kind: 'edge', rule: 'legacy domestic=true is no-op (LHR still searchable)', query: { airport: 'lhr', domestic: 'true' }, expect: 'legacy-noop', mustInclude: 'LHR' },
  { id: 'E9', kind: 'edge', rule: 'legacy domestic=false is no-op', query: { airport: 'lhr', domestic: 'false' }, expect: 'legacy-noop', mustInclude: 'LHR' },
  { id: 'E10', kind: 'edge', rule: 'tripType=domestic airport=goa India-only', query: { airport: 'goa', tripType: 'domestic' }, expect: 'only-india' },
  { id: 'E11', kind: 'edge', rule: 'tripType=international airport=del returns India too (unfiltered)', query: { airport: 'del', tripType: 'international', perpage: 20 }, expect: 'both' },
];

function applyMust(row, summary) {
  if (row.status !== 'PASS') return row;
  if (row.mustInclude && !summary.codes.includes(row.mustInclude)) {
    return { ...row, status: 'BUG', note: `missing ${row.mustInclude}. codes=${summary.codes.slice(0, 12).join(',')}` };
  }
  if (row.mustExclude && summary.codes.includes(row.mustExclude)) {
    return { ...row, status: 'BUG', note: `${row.mustExclude} was returned` };
  }
  return row;
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const rows = [];

  for (const test of cases) {
    const query = { lang: 'en', currency: 'INR', page: 0, perpage: 10, ...test.query };
    const res = await session.client.request({
      method: 'GET',
      path: '/v1/flights/airports',
      query,
    });
    const summary = summarize(res);
    let expect = test.expect;
    if (expect === 'includes-foreign-or-india') {
      const judged = summary.codes.includes(test.mustInclude)
        ? { status: 'PASS', note: `${test.mustInclude} present, nonIndia=${summary.nonIndia}` }
        : { status: 'BUG', note: `${test.mustInclude} missing` };
      const row = applyMust({
        id: test.id,
        kind: test.kind,
        rule: test.rule,
        query,
        ...judged,
        http: summary.http,
        apiStatus: summary.apiStatus,
        info: summary.info,
        totalResults: summary.totalResults,
        pageCount: summary.pageCount,
        india: summary.india,
        nonIndia: summary.nonIndia,
        countries: summary.countries,
        mustInclude: test.mustInclude,
        mustExclude: test.mustExclude,
      }, summary);
      rows.push(row);
      console.log(`[${row.status}] ${row.id} ${row.note}`);
      continue;
    }
    if (expect === 'legacy-noop' && test.mustInclude) {
      const judged = score(expect, summary);
      let row = {
        id: test.id,
        kind: test.kind,
        rule: test.rule,
        query,
        ...judged,
        http: summary.http,
        apiStatus: summary.apiStatus,
        info: summary.info,
        totalResults: summary.totalResults,
        pageCount: summary.pageCount,
        india: summary.india,
        nonIndia: summary.nonIndia,
        countries: summary.countries,
        codes: summary.codes,
        mustInclude: test.mustInclude,
      };
      if (row.status === 'PASS' && !summary.codes.includes(test.mustInclude) && summary.pageCount > 0 && summary.nonIndia === 0) {
        row = { ...row, status: 'BUG', note: `legacy domestic still filtering; missing ${test.mustInclude}` };
      }
      if (row.status === 'PASS' && summary.codes.includes(test.mustInclude)) {
        row = { ...row, note: `${test.mustInclude} present — legacy domestic ignored` };
      }
      rows.push(row);
      console.log(`[${row.status}] ${row.id} HTTP ${summary.http} ${row.note}`);
      continue;
    }
    const judged = score(expect, summary);
    const row = applyMust({
      id: test.id,
      kind: test.kind,
      rule: test.rule,
      query,
      ...judged,
      http: summary.http,
      apiStatus: summary.apiStatus,
      info: summary.info,
      totalResults: summary.totalResults,
      pageCount: summary.pageCount,
      india: summary.india,
      nonIndia: summary.nonIndia,
      countries: summary.countries,
      codes: summary.codes,
      mustInclude: test.mustInclude,
      mustExclude: test.mustExclude,
    }, summary);
    rows.push(row);
    console.log(`[${row.status}] ${row.id} HTTP ${summary.http} ${row.note}`);
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const report = { baseUrl: config.baseUrl, at: new Date().toISOString(), counts, rows };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('COUNTS', counts);
  console.log('WROTE', OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
