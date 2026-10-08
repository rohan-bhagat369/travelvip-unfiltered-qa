/**
 * Positive / negative / edge / validation for GET /v1/hotels/autocomplete?tripType=
 * Run: node scripts/probe-hotel-autocomplete-triptype.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const OUT = path.join('reports', 'hotel-autocomplete-triptype-staging.json');

function rowsOf(data) {
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

function countryOf(row) {
  return String(row?.country || row?.countryCode || row?.indexedCountry || '').trim();
}

function isIndia(row) {
  const country = countryOf(row).toLowerCase();
  const id = String(row?.entityId || row?.id || '');
  return country === 'india' || id.endsWith(':IN');
}

function summarize(res) {
  const list = rowsOf(res.data);
  const countries = {};
  for (const row of list) {
    const c = countryOf(row) || '(blank)';
    countries[c] = (countries[c] || 0) + 1;
  }
  const nonIndia = list.filter((row) => !isIndia(row)).map((row) => ({
    type: row.type,
    title: row.title,
    entityId: row.entityId || row.id,
    city: row.city,
    country: countryOf(row),
  }));
  return {
    http: res.status,
    code: res.data?.error?.code || null,
    details: res.data?.error?.details || null,
    message: res.data?.error?.message || res.data?.info || null,
    total: res.data?.totalElements ?? list.length,
    pageCount: list.length,
    india: list.filter(isIndia).length,
    nonIndia: nonIndia.length,
    countries,
    sample: list.slice(0, 6).map((row) => ({
      type: row.type,
      title: row.title,
      entityId: row.entityId || row.id,
      country: countryOf(row),
    })),
    nonIndiaSample: nonIndia.slice(0, 6),
  };
}

function hasTitle(summary, re) {
  return summary.sample.some((row) => re.test(String(row.title || '')))
    || summary.nonIndiaSample.some((row) => re.test(String(row.title || '')));
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const rows = [];

  async function call(query) {
    return client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, ...query },
    });
  }

  async function callRaw(search) {
    return client.request({
      method: 'GET',
      path: `/v1/hotels/autocomplete?${search}`,
      query: {},
    });
  }

  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} ${row.note}`);
  }

  const cases = [
    // Positive
    {
      id: 'P1', kind: 'positive',
      rule: 'tripType=domestic, q=pune returns only India',
      query: { q: 'pune', tripType: 'domestic' },
      expect: 'only-india', mustHave: /pune/i,
    },
    {
      id: 'P2', kind: 'positive',
      rule: 'tripType=domestic, q=mumbai returns only India and includes Mumbai city',
      query: { q: 'mumbai', tripType: 'domestic' },
      expect: 'only-india', mustHave: /mumbai/i,
    },
    {
      id: 'P3', kind: 'positive',
      rule: 'tripType=domestic, q=delhi returns only India',
      query: { q: 'delhi', tripType: 'domestic' },
      expect: 'only-india', mustHave: /delhi/i,
    },
    {
      id: 'P4', kind: 'positive',
      rule: 'tripType=domestic, q=goa returns only India',
      query: { q: 'goa', tripType: 'domestic' },
      expect: 'only-india',
    },
    {
      id: 'P5', kind: 'positive',
      rule: 'tripType=international, q=dubai returns UAE and can include other countries',
      query: { q: 'dubai', tripType: 'international' },
      expect: 'has-foreign', mustHave: /dubai/i,
    },
    {
      id: 'P6', kind: 'positive',
      rule: 'tripType=international, q=paris returns foreign cities/hotels',
      query: { q: 'paris', tripType: 'international' },
      expect: 'has-foreign',
    },
    {
      id: 'P7', kind: 'positive',
      rule: 'tripType=international, q=london returns foreign cities',
      query: { q: 'london', tripType: 'international' },
      expect: 'has-foreign',
    },
    {
      id: 'P8', kind: 'positive',
      rule: 'tripType=international, q=pune still includes India and can include Peru',
      query: { q: 'pune', tripType: 'international' },
      expect: 'india-and-foreign',
    },
    {
      id: 'P9', kind: 'positive',
      rule: 'tripType=international, q=singapore returns foreign results',
      query: { q: 'singapore', tripType: 'international' },
      expect: 'has-foreign',
    },
    {
      id: 'P10', kind: 'positive',
      rule: 'tripType=domestic, q=hiltop / hilltop hotel stays in India',
      query: { q: 'hiltop', tripType: 'domestic' },
      expect: 'only-india-or-empty',
    },

    // Negative: domestic must hide foreign
    {
      id: 'N1', kind: 'negative',
      rule: 'tripType=domestic, q=dubai returns no foreign rows',
      query: { q: 'dubai', tripType: 'domestic' },
      expect: 'no-foreign',
    },
    {
      id: 'N2', kind: 'negative',
      rule: 'tripType=domestic, q=paris returns no foreign rows',
      query: { q: 'paris', tripType: 'domestic' },
      expect: 'no-foreign',
    },
    {
      id: 'N3', kind: 'negative',
      rule: 'tripType=domestic, q=london returns no foreign rows',
      query: { q: 'london', tripType: 'domestic' },
      expect: 'no-foreign',
    },
    {
      id: 'N4', kind: 'negative',
      rule: 'tripType=domestic, q=singapore returns no foreign rows',
      query: { q: 'singapore', tripType: 'domestic' },
      expect: 'no-foreign',
    },
    {
      id: 'N5', kind: 'negative',
      rule: 'tripType=domestic, q=bangkok returns no foreign rows',
      query: { q: 'bangkok', tripType: 'domestic' },
      expect: 'no-foreign',
    },
    {
      id: 'N6', kind: 'negative',
      rule: 'tripType=domestic removes Peru hotel from pune results',
      query: { q: 'pune', tripType: 'domestic' },
      expect: 'only-india',
    },

    // Validation: invalid tripType
    {
      id: 'V1', kind: 'validation',
      rule: 'tripType empty is 4xx VALIDATION_ERROR',
      query: { q: 'pune', tripType: '' },
      expect: 'reject',
    },
    {
      id: 'V2', kind: 'validation',
      rule: 'tripType=GARBAGE is 4xx VALIDATION_ERROR',
      query: { q: 'pune', tripType: 'GARBAGE' },
      expect: 'reject',
    },
    {
      id: 'V3', kind: 'validation',
      rule: 'tripType=true is 4xx VALIDATION_ERROR',
      query: { q: 'pune', tripType: 'true' },
      expect: 'reject',
    },
    {
      id: 'V4', kind: 'validation',
      rule: 'tripType=1 is 4xx VALIDATION_ERROR',
      query: { q: 'pune', tripType: '1' },
      expect: 'reject',
    },
    {
      id: 'V5', kind: 'validation',
      rule: 'tripType=<script> is 4xx, never 500',
      query: { q: 'pune', tripType: '<script>' },
      expect: 'reject',
    },
    {
      id: 'V6', kind: 'validation',
      rule: 'tripType=domestic, is 4xx, never 500',
      query: { q: 'pune', tripType: 'domestic,' },
      expect: 'reject',
    },
    {
      id: 'V7', kind: 'validation',
      rule: 'tripType=!@#$ is 4xx, never 500',
      query: { q: 'pune', tripType: '!@#$' },
      expect: 'reject',
    },
    {
      id: 'V8', kind: 'validation',
      rule: 'tripType=yes is 4xx VALIDATION_ERROR',
      query: { q: 'dubai', tripType: 'yes' },
      expect: 'reject',
    },
    {
      id: 'V9', kind: 'validation',
      rule: 'tripType=DOMESTIC case accepted or rejected consistently',
      query: { q: 'dubai', tripType: 'DOMESTIC' },
      expect: 'case-domestic',
    },
    {
      id: 'V10', kind: 'validation',
      rule: 'tripType=International case accepted or rejected consistently',
      query: { q: 'dubai', tripType: 'International' },
      expect: 'case-international',
    },
    {
      id: 'V11', kind: 'validation',
      rule: 'blank q with tripType=domestic is 4xx',
      query: { q: '', tripType: 'domestic' },
      expect: 'reject',
    },
    {
      id: 'V12', kind: 'validation',
      rule: 'omit q with tripType=domestic is 4xx',
      query: { tripType: 'domestic' },
      expect: 'reject',
    },

    // Edge
    {
      id: 'E1', kind: 'edge',
      rule: 'omitted tripType still returns results for q=pune',
      query: { q: 'pune' },
      expect: 'any-results',
    },
    {
      id: 'E2', kind: 'edge',
      rule: 'omitted tripType for dubai can include foreign',
      query: { q: 'dubai' },
      expect: 'has-foreign',
    },
    {
      id: 'E3', kind: 'edge',
      rule: 'tripType=domestic with trailing space is rejected',
      query: { q: 'dubai', tripType: 'domestic ' },
      expect: 'reject',
    },
    {
      id: 'E4', kind: 'edge',
      rule: 'tripType with leading space is rejected',
      query: { q: 'dubai', tripType: ' domestic' },
      expect: 'reject',
    },
    {
      id: 'E5', kind: 'edge',
      rule: 'tripType=domestic page 1 does not introduce foreign rows',
      query: { q: 'a', tripType: 'domestic', page: 1, perpage: 20 },
      expect: 'only-india-or-empty',
    },
    {
      id: 'E6', kind: 'edge',
      rule: 'tripType=domestic broad q=a is India-only',
      query: { q: 'a', tripType: 'domestic', perpage: 20 },
      expect: 'only-india',
    },
    {
      id: 'E7', kind: 'edge',
      rule: 'tripType=international broad q=a can include foreign',
      query: { q: 'a', tripType: 'international', perpage: 20 },
      expect: 'has-foreign',
    },
    {
      id: 'E8', kind: 'edge',
      rule: 'hotel name search with domestic stays India',
      query: { q: 'taj', tripType: 'domestic' },
      expect: 'only-india',
    },
    {
      id: 'E9', kind: 'edge',
      rule: 'hotel name search with international can include foreign',
      query: { q: 'marriott', tripType: 'international' },
      expect: 'any-results',
    },
    {
      id: 'E10', kind: 'edge',
      rule: 'q=<script> with tripType=domestic is 4xx or empty, never 500',
      query: { q: '<script>', tripType: 'domestic' },
      expect: 'reject-or-empty-never-500',
    },
  ];

  for (const test of cases) {
    const res = await call(test.query);
    const summary = summarize(res);
    let status = 'PASS';
    let note = '';

    const rejected = summary.http >= 400 && summary.http < 500;
    const serverError = summary.http >= 500;

    if (serverError) {
      status = 'BUG';
      note = `HTTP ${summary.http}`;
    } else if (test.expect === 'only-india') {
      if (summary.pageCount === 0) { status = 'BUG'; note = 'expected India rows, got none'; }
      else if (summary.nonIndia > 0) { status = 'BUG'; note = `foreign rows: ${JSON.stringify(summary.nonIndiaSample)}`; }
      else if (test.mustHave && !hasTitle(summary, test.mustHave)) { status = 'BUG'; note = 'required title missing'; }
      else note = `${summary.india} India, 0 foreign`;
    } else if (test.expect === 'only-india-or-empty') {
      if (summary.nonIndia > 0) { status = 'BUG'; note = `foreign rows: ${JSON.stringify(summary.nonIndiaSample)}`; }
      else note = summary.pageCount ? `${summary.india} India` : 'empty';
    } else if (test.expect === 'no-foreign') {
      if (summary.nonIndia > 0) { status = 'BUG'; note = `foreign rows: ${JSON.stringify(summary.nonIndiaSample)}`; }
      else note = summary.pageCount ? `${summary.india} India only` : 'empty / no foreign';
    } else if (test.expect === 'has-foreign') {
      if (summary.nonIndia === 0) { status = 'BUG'; note = `no foreign rows. countries=${JSON.stringify(summary.countries)}`; }
      else if (test.mustHave && !hasTitle(summary, test.mustHave) && !summary.nonIndiaSample.some((r) => test.mustHave.test(String(r.title || '')))) {
        status = 'BUG'; note = 'required title missing among foreign/all';
      } else note = `${summary.nonIndia} foreign, india=${summary.india}`;
    } else if (test.expect === 'india-and-foreign') {
      if (summary.india === 0 || summary.nonIndia === 0) {
        status = 'BUG';
        note = `india=${summary.india} nonIndia=${summary.nonIndia}`;
      } else note = `india=${summary.india} foreign=${summary.nonIndia}`;
    } else if (test.expect === 'any-results') {
      if (summary.pageCount === 0) { status = 'BUG'; note = 'expected results, got empty'; }
      else note = `${summary.pageCount} rows, india=${summary.india} foreign=${summary.nonIndia}`;
    } else if (test.expect === 'reject') {
      if (!rejected) { status = 'BUG'; note = `HTTP ${summary.http} accepted, rows=${summary.pageCount} code=${summary.code}`; }
      else note = `HTTP ${summary.http} ${summary.code || ''} ${(summary.details || []).join('; ')}`;
    } else if (test.expect === 'reject-or-empty-never-500') {
      if (serverError) { status = 'BUG'; note = `HTTP ${summary.http}`; }
      else if (rejected || summary.pageCount === 0) note = rejected ? `HTTP ${summary.http} ${summary.code}` : 'empty';
      else { status = 'BUG'; note = `accepted with ${summary.pageCount} rows`; }
    } else if (test.expect === 'case-domestic') {
      if (rejected) note = `rejected HTTP ${summary.http} ${summary.code}`;
      else if (summary.nonIndia > 0) { status = 'BUG'; note = 'accepted as domestic but returned foreign'; }
      else note = `accepted as domestic: ${summary.india} India`;
    } else if (test.expect === 'case-international') {
      if (rejected) note = `rejected HTTP ${summary.http} ${summary.code}`;
      else if (summary.nonIndia === 0) { status = 'BUG'; note = 'accepted as international but no foreign rows'; }
      else note = `accepted as international: foreign=${summary.nonIndia}`;
    }

    add({
      id: test.id,
      kind: test.kind,
      rule: test.rule,
      query: test.query,
      status,
      note,
      http: summary.http,
      code: summary.code,
      details: summary.details,
      total: summary.total,
      india: summary.india,
      nonIndia: summary.nonIndia,
      countries: summary.countries,
      sample: summary.sample,
      nonIndiaSample: summary.nonIndiaSample,
    });
  }

  // Raw whitespace / null / duplicate tripType
  const rawCases = [
    { id: 'R1', kind: 'edge', rule: 'tripType=domestic%20 trailing space rejected', search: 'lang=en&currency=INR&page=0&perpage=10&q=dubai&tripType=domestic%20', expect: 'reject' },
    { id: 'R2', kind: 'edge', rule: 'tripType=%20domestic leading space rejected', search: 'lang=en&currency=INR&page=0&perpage=10&q=dubai&tripType=%20domestic', expect: 'reject' },
    { id: 'R3', kind: 'edge', rule: 'tripType=domestic%00 null byte rejected', search: 'lang=en&currency=INR&page=0&perpage=10&q=dubai&tripType=domestic%00', expect: 'reject' },
    { id: 'R4', kind: 'edge', rule: 'tripType=domestic%09 tab rejected', search: 'lang=en&currency=INR&page=0&perpage=10&q=dubai&tripType=domestic%09', expect: 'reject' },
    { id: 'R5', kind: 'edge', rule: 'last tripType wins when duplicated: domestic then international', search: 'lang=en&currency=INR&page=0&perpage=10&q=dubai&tripType=domestic&tripType=international', expect: 'has-foreign' },
    { id: 'R6', kind: 'edge', rule: 'last tripType wins when duplicated: international then domestic', search: 'lang=en&currency=INR&page=0&perpage=10&q=dubai&tripType=international&tripType=domestic', expect: 'no-foreign' },
  ];

  for (const test of rawCases) {
    const res = await callRaw(test.search);
    const summary = summarize(res);
    let status = 'PASS';
    let note = '';
    const rejected = summary.http >= 400 && summary.http < 500;
    if (summary.http >= 500) {
      status = 'BUG';
      note = `HTTP ${summary.http}`;
    } else if (test.expect === 'reject') {
      if (!rejected) {
        status = 'BUG';
        note = `HTTP ${summary.http} accepted, foreign=${summary.nonIndia} rows=${summary.pageCount}`;
      } else note = `HTTP ${summary.http} ${summary.code || ''} ${(summary.details || []).join('; ')}`;
    } else if (test.expect === 'has-foreign') {
      if (summary.nonIndia === 0) { status = 'BUG'; note = 'expected foreign after last=international'; }
      else note = `foreign=${summary.nonIndia}`;
    } else if (test.expect === 'no-foreign') {
      if (summary.nonIndia > 0) { status = 'BUG'; note = `foreign leaked after last=domestic: ${JSON.stringify(summary.nonIndiaSample)}`; }
      else note = summary.pageCount ? `${summary.india} India` : 'empty / no foreign';
    }
    add({
      id: test.id,
      kind: test.kind,
      rule: test.rule,
      search: test.search,
      status,
      note,
      http: summary.http,
      code: summary.code,
      details: summary.details,
      total: summary.total,
      india: summary.india,
      nonIndia: summary.nonIndia,
      countries: summary.countries,
      sample: summary.sample,
      nonIndiaSample: summary.nonIndiaSample,
    });
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const report = {
    baseUrl: config.baseUrl,
    path: '/v1/hotels/autocomplete',
    at: new Date().toISOString(),
    counts,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('COUNTS', counts);
  console.log('WROTE', OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
