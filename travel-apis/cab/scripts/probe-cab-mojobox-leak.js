/**
 * Scan cab search/fare responses for vendor leak: mojobox / mojoboxx
 * across AIRPORT, RENTAL, OUTSTATION (no book unless found only later).
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-mojobox-leak.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
  pickCab,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

const PATTERNS = [/mojoboxx?/i, /mojo[\s_-]?box/i];

function findHits(value, path = '$', out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    for (const re of PATTERNS) {
      if (re.test(value)) out.push({ path, value: value.slice(0, 200) });
    }
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findHits(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PATTERNS.some((re) => re.test(k))) out.push({ path: `${path}.${k}`, value: '(key name)' });
      findHits(v, `${path}.${k}`, out);
    }
  }
  return out;
}

function summarizeOperators(cabs = []) {
  const names = new Set();
  for (const c of cabs) {
    const n = c?.operator?.name;
    if (n) names.add(n);
  }
  return [...names];
}

const session = await authenticate(true);
const cab = new CabService(session.client);

const journeys = [
  { type: 'AIRPORT', body: buildAirportSearchBody() },
  { type: 'RENTAL', body: buildRentalSearchBody() },
  { type: 'OUTSTATION', body: buildOutstationSearchBody() },
];

const rows = [];
const report = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl, rows: [], hits: [] };

for (const j of journeys) {
  const search = await cab.search(j.body);
  const cabs = search.data?.cabs || [];
  const searchHits = findHits(search.data);
  const picked = pickCab(cabs);

  let fareHits = [];
  let fareStatus = null;
  if (picked?.searchId) {
    const fare = await cab.fare(picked.searchId);
    fareStatus = fare.status;
    fareHits = findHits(fare.data);
  }

  const row = {
    journeyType: j.type,
    searchHttp: search.status,
    cabCount: cabs.length,
    operatorNames: summarizeOperators(cabs),
    searchMojoboxHits: searchHits.length,
    searchHitSamples: searchHits.slice(0, 8),
    fareHttp: fareStatus,
    fareMojoboxHits: fareHits.length,
    fareHitSamples: fareHits.slice(0, 8),
    status: searchHits.length || fareHits.length ? 'BUG' : 'PASS',
  };
  rows.push(row);
  report.rows.push(row);
  report.hits.push(...searchHits.map((h) => ({ journeyType: j.type, api: 'search', ...h })));
  report.hits.push(...fareHits.map((h) => ({ journeyType: j.type, api: 'fare', ...h })));

  console.log(
    `${j.type}: search=${search.status} cabs=${cabs.length} mojoboxHits=${searchHits.length} fareHits=${fareHits.length} → ${row.status}`,
  );
  if (searchHits[0]) console.log('  sample:', searchHits[0]);
}

const outPath = 'reports/cab-mojobox-leak-scan.json';
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('\nSaved', outPath);
console.log('SUMMARY', {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  totalHits: report.hits.length,
});
