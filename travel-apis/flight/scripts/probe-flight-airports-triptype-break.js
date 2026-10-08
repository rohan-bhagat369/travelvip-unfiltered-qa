/**
 * Adversarial checks for GET /v1/flights/airports?tripType=
 * Legacy domestic= is asserted as a no-op.
 * Run: node scripts/probe-flight-airports-triptype-break.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const OUT = path.join('reports', 'flight-airports-triptype-break.json');
const INDIAN = ['DEL', 'BOM', 'BLR', 'MAA', 'CCU', 'HYD', 'COK', 'GOI', 'IXL', 'SXR', 'AMD', 'PNQ', 'JAI', 'GAU', 'PAT', 'BBI', 'LKO', 'IDR', 'ATQ', 'TRV', 'NAG', 'VNS', 'IXC', 'IXB', 'IMF', 'DED', 'BDQ', 'JDH', 'UDR', 'RPR', 'VTZ', 'CJB', 'IXE', 'IXR', 'IXJ', 'DIB', 'TEZ', 'GAY', 'STV', 'RAJ', 'BHO', 'MYQ'];
const FOREIGN = ['LHR', 'DXB', 'SIN', 'CDG', 'JFK', 'LAX', 'BKK', 'KUL', 'DOH', 'AUH', 'NRT', 'SYD', 'FRA', 'AMS', 'IST', 'CMB', 'KTM', 'DAC', 'MLE', 'HKG', 'ICN', 'SFO', 'IND', 'NKW'];

function rowsOf(data) {
  return Array.isArray(data?.result) ? data.result : [];
}

function isIndia(row) {
  return String(row?.country || '').trim().toLowerCase() === 'india';
}

function pack(res) {
  const list = rowsOf(res.data);
  const foreign = list.filter((row) => !isIndia(row)).map((row) => ({
    airportCode: row.airportCode,
    city: row.city,
    country: row.country,
    airportName: row.airportName,
  }));
  return {
    http: res.status,
    apiStatus: res.data?.status ?? null,
    info: res.data?.info || res.data?.error?.code || null,
    details: res.data?.error?.details || null,
    totalResults: res.data?.totalResults ?? null,
    pageCount: list.length,
    india: list.filter(isIndia).length,
    foreign,
    codes: list.map((row) => row.airportCode),
  };
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const findings = [];

  async function call(query) {
    return client.request({
      method: 'GET',
      path: '/v1/flights/airports',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, ...query },
    });
  }

  function add(row) {
    findings.push(row);
    console.log(`[${row.status}] ${row.id} ${row.note}`);
  }

  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const letter of letters) {
    const res = await call({ airport: letter, tripType: 'domestic', perpage: 30 });
    const summary = pack(res);
    if (summary.http >= 500) {
      add({ id: `SCAN-${letter}`, status: 'BUG', note: `HTTP ${summary.http}`, summary });
    } else if (summary.foreign.length) {
      add({
        id: `SCAN-${letter}`,
        status: 'BUG',
        note: `tripType=domestic airport=${letter} returned non-India`,
        summary,
      });
    } else {
      add({
        id: `SCAN-${letter}`,
        status: 'PASS',
        note: `HTTP ${summary.http} india=${summary.india} total=${summary.totalResults ?? 0}`,
      });
    }
  }

  const missingIndia = [];
  for (const code of INDIAN) {
    const res = await call({ airport: code, tripType: 'domestic', perpage: 10 });
    const summary = pack(res);
    const present = summary.codes.includes(code);
    if (summary.http >= 500 || summary.foreign.length || !present) {
      missingIndia.push({ code, http: summary.http, present, foreign: summary.foreign, info: summary.info, codes: summary.codes });
    }
  }
  add({
    id: 'IN-CODES',
    status: missingIndia.length ? 'BUG' : 'PASS',
    note: missingIndia.length ? `${missingIndia.length} Indian codes missing or leaked` : `${INDIAN.length} Indian codes present and India-only`,
    missingIndia,
  });

  const leakedForeign = [];
  for (const code of FOREIGN) {
    const open = pack(await call({ airport: code, tripType: 'international', perpage: 10 }));
    const closed = pack(await call({ airport: code, tripType: 'domestic', perpage: 10 }));
    const existsWhenOpen = open.codes.includes(code);
    const leaked = closed.codes.includes(code) || closed.foreign.length > 0;
    if (closed.http >= 500 || (existsWhenOpen && leaked)) {
      leakedForeign.push({
        code,
        openHttp: open.http,
        closedHttp: closed.http,
        existsWhenOpen,
        closedCodes: closed.codes,
        foreign: closed.foreign,
        info: closed.info,
      });
    }
  }
  add({
    id: 'FOREIGN-CODES',
    status: leakedForeign.length ? 'BUG' : 'PASS',
    note: leakedForeign.length ? `${leakedForeign.length} foreign codes leaked` : `${FOREIGN.length} foreign codes stayed out`,
    leakedForeign,
  });

  // Legacy domestic= must NOT filter (LHR still returned).
  const legacyTrue = pack(await call({ airport: 'LHR', domestic: 'true', perpage: 10 }));
  add({
    id: 'LEGACY-domestic-true',
    status: legacyTrue.http >= 500
      ? 'BUG'
      : legacyTrue.codes.includes('LHR') || legacyTrue.foreign.length
        ? 'PASS'
        : 'BUG',
    note: legacyTrue.codes.includes('LHR')
      ? 'legacy domestic=true ignored — LHR present'
      : `legacy may still filter: codes=${legacyTrue.codes.join(',')}`,
    summary: legacyTrue,
  });

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    counts: findings.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {}),
    findings,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('COUNTS', report.counts);
  console.log('WROTE', OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
