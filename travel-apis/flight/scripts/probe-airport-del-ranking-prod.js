/**
 * Prod — DEL airport search ranking spot-check.
 * GET /v1/flights/airports · catalog only, no book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'airport-del-ranking-prod.json');
const API = '/v1/flights/airports';
const PERPAGE = Number(process.env.AIRPORT_PERPAGE || '10');

const rows = [];
const counts = { PASS: 0, BUG: 0 };
let n = 0;

function hitsOf(data) {
  const list = data?.result || data?.results || data?.content || data?.airports || [];
  return Array.isArray(list) ? list : [];
}

function brief(h) {
  return {
    airportCode: h.airportCode || h.code || h.iata || null,
    airportName: h.airportName || h.name || null,
    city: h.city || h.cityName || null,
    country: h.country || h.countryName || null,
  };
}

function rankOf(hits, codes) {
  const want = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).toUpperCase());
  for (let i = 0; i < hits.length; i += 1) {
    const code = String(hits[i].airportCode || hits[i].code || '').toUpperCase();
    if (want.includes(code)) return { rank: i + 1, code };
  }
  return { rank: null, code: null };
}

function topStr(hits, k = 6) {
  return hits.slice(0, k).map((h) => `${h.airportCode}:${h.city}`).join(' | ') || '(none)';
}

function add(rule, expected, status, actual, extra = {}) {
  n += 1;
  rows.push({ id: n, rule, expected, status, actual, ...extra });
  counts[status] += 1;
  console.log(`[${status}] ${n}. ${rule}`);
  console.log(`       ${actual}`);
}

async function main() {
  console.log('=== DEL ranking prod ===');
  console.log('BASE', process.env.BASE_URL);
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  const client = session.client;
  client.setCorrelationId(process.env.CORRELATION_ID);

  async function call(airport, extra = {}) {
    const q = { lang: 'en', currency: 'INR', perpage: PERPAGE, page: 0, airport, ...extra };
    const res = await client.request({
      method: 'GET',
      path: API,
      query: q,
      signed: true,
      auth: true,
    });
    return { http: res.status, hits: hitsOf(res.data).map(brief), query: q };
  }

  const cases = [
    { q: 'DEL', expect: ['DEL'], maxRank: 1, label: 'IATA DEL (uppercase)' },
    { q: 'del', expect: ['DEL'], maxRank: 1, label: 'IATA del (lowercase)' },
    { q: 'de', expect: ['DEL'], maxRank: 3, label: 'Prefix de → DEL area' },
    { q: 'delh', expect: ['DEL'], maxRank: 2, label: 'Prefix delh → DEL' },
    { q: 'delhi', expect: ['DEL'], maxRank: 1, label: 'delhi → DEL' },
    { q: 'new delhi', expect: ['DEL'], maxRank: 1, label: 'new delhi → DEL' },
    { q: 'dehli', expect: ['DEL'], maxRank: 2, label: 'Typo dehli → DEL' },
    { q: 'delli', expect: ['DEL'], maxRank: 2, label: 'Typo delli → DEL' },
    { q: 'indira gandhi', expect: ['DEL'], maxRank: 3, label: 'Official name indira gandhi → DEL' },
    { q: 'new', expect: ['DEL', 'NYC', 'JFK', 'EWR', 'LGA'], maxRank: 5, label: 'Prefix new → Delhi or NYC' },
    { q: 'dub', expect: ['DXB'], maxRank: 3, label: 'Prefix dub → DXB (regression)' },
    { q: 'DXN', expect: ['DXN'], maxRank: 2, label: 'IATA DXN (NCR sibling)' },
    { q: 'noida international', expect: ['DXN', 'DEL'], maxRank: 3, label: 'noida international → DXN/DEL' },
    { q: 'jewar', expect: ['DXN', 'DEL'], maxRank: 3, label: 'jewar → DXN/DEL' },
  ];

  for (const t of cases) {
    const r = await call(t.q);
    const { rank, code } = rankOf(r.hits, t.expect);
    let status = 'PASS';
    if (r.http !== 200 || rank == null || rank > t.maxRank) status = 'BUG';
    add(
      t.label,
      `${t.expect.join('|')} in top ${t.maxRank}`,
      status,
      `HTTP ${r.http} DEL-family@${rank || 'MISS'}(${code || '-'}) top=${topStr(r.hits)}`,
      { query: t.q, hits: r.hits.slice(0, 8), rank, code },
    );
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    counts,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
