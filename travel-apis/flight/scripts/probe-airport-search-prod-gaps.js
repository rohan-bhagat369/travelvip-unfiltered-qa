/**
 * Prod gap pass — new airports + rename queries missing from checklist probe.
 * GET /v1/flights/airports · catalog only, no book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'airport-search-prod-gaps.json');
const API = '/v1/flights/airports';
const PERPAGE = Number(process.env.AIRPORT_PERPAGE || '10');

const rows = [];
const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
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

function topStr(hits, k = 4) {
  return hits.slice(0, k).map((h) => `${h.airportCode}:${h.city}`).join(' | ') || '(none)';
}

function add(section, rule, how, expected, status, actual, extra = {}) {
  n += 1;
  rows.push({ id: n, section, rule, how, expected, status, actual, ...extra });
  counts[status] += 1;
  console.log(`[${status}] ${section} ${n}. ${rule} — ${String(actual).slice(0, 280)}`);
}

async function main() {
  console.log('=== Airport Search PROD gaps (no book) ===');
  console.log('BASE', process.env.BASE_URL);
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  const client = session.client;
  client.setCorrelationId(process.env.CORRELATION_ID);

  async function call(query = {}) {
    const q = { lang: 'en', currency: 'INR', perpage: PERPAGE, page: 0, ...query };
    const res = await client.request({
      method: 'GET',
      path: API,
      query: q,
      signed: true,
      auth: true,
    });
    const hits = hitsOf(res.data).map(brief);
    return {
      http: res.status,
      hits,
      error: res.data?.error || null,
      queryUsed: q,
    };
  }

  function how(q) {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
    return `GET ${API}?${params}`;
  }

  const iataCases = [
    { code: 'DXN', maxRank: 2 },
    { code: 'HSR', maxRank: 2 },
    { code: 'RQY', maxRank: 2 },
    { code: 'KBK', maxRank: 2 },
    { code: 'PYG', maxRank: 2 },
    { code: 'HGI', maxRank: 2 },
  ];

  for (const t of iataCases) {
    const r = await call({ airport: t.code });
    const { rank } = rankOf(r.hits, t.code);
    add(
      'IATA',
      `Exact airport=${t.code}`,
      how(r.queryUsed),
      `${t.code} rank 1-${t.maxRank}`,
      r.http === 200 && rank != null && rank <= t.maxRank ? 'PASS' : 'BUG',
      `HTTP ${r.http} rank(${t.code})=${rank || 'MISS'} top=${topStr(r.hits)}`,
      { hits: r.hits.slice(0, 6) },
    );
  }

  const renameCases = [
    { q: 'navi mumbai', expect: ['NMI', 'BOM'], maxRank: 3 },
    { q: 'mopa', expect: ['GOX'], maxRank: 2 },
    { q: 'manohar international', expect: ['GOX'], maxRank: 2 },
    { q: 'dabolim', expect: ['GOI'], maxRank: 2 },
    { q: 'rajkot international', expect: ['HSR'], maxRank: 2 },
    { q: 'hirasar', expect: ['HSR'], maxRank: 2 },
    { q: 'noida international', expect: ['DXN', 'DEL'], maxRank: 3 },
    { q: 'jewar', expect: ['DXN', 'DEL'], maxRank: 3 },
    { q: 'shivamogga', expect: ['RQY'], maxRank: 2 },
    { q: 'kushinagar', expect: ['KBK'], maxRank: 2 },
    { q: 'chhatrapati sambhaji nagar', expect: ['IXU'], maxRank: 2 },
    { q: 'aurangabad', expect: ['IXU'], maxRank: 2 },
    { q: 'pakyong', expect: ['PYG'], maxRank: 2 },
    { q: 'hollongi', expect: ['HGI'], maxRank: 2 },
    { q: 'itanagar', expect: ['HGI', 'IXA'], maxRank: 3 },
    { q: 'kempegowda', expect: ['BLR'], maxRank: 2 },
    { q: 'chhatrapati shivaji', expect: ['BOM'], maxRank: 2 },
    { q: 'indira gandhi', expect: ['DEL'], maxRank: 3 },
  ];

  for (const t of renameCases) {
    const r = await call({ airport: t.q });
    const { rank, code } = rankOf(r.hits, t.expect);
    let status = 'PASS';
    if (r.http >= 500 || r.http !== 200) status = 'BUG';
    else if (r.hits.length === 0 || rank == null || rank > t.maxRank) status = 'BUG';
    add(
      'RENAME',
      `${t.q} → ${t.expect.join('|')}`,
      how(r.queryUsed),
      `${t.expect.join('|')} in top ${t.maxRank}`,
      status,
      `HTTP ${r.http} rank=${rank || 'MISS'}(${code || '-'}) top=${topStr(r.hits)}`,
      { query: t.q, hits: r.hits.slice(0, 6) },
    );
  }

  const bugs = rows.filter((r) => r.status === 'BUG');
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    api: `GET ${API}`,
    note: 'Prod gap pass: new IATA codes + rename/official name queries. No book.',
    counts,
    bugCount: bugs.length,
    bugs: bugs.map((b) => ({ id: b.id, section: b.section, rule: b.rule, actual: b.actual })),
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('BUGS', bugs.length);
  for (const b of bugs) console.log(`  BUG ${b.section} #${b.id}: ${b.rule}`);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
