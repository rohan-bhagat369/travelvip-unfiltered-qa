/**
 * Preprod airport search checklist — user-requested areas only.
 * GET /v1/flights/airports · catalog only, no book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'airport-search-checklist-preprod.json');
const API = '/v1/flights/airports';
const PERPAGE = Number(process.env.AIRPORT_PERPAGE || '10');
const PIDS = (process.env.AIRPORT_PIDS || 'vgm,smt,').split(',').map((s) => s.trim());

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
    pid: h.pid ?? null,
    nearbyAirports: h.nearbyAirports ?? h.nearby ?? null,
    tag: h.tag ?? null,
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
  console.log('=== Airport Search checklist PREPROD (no book) ===');
  console.log('BASE', process.env.BASE_URL);
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  const client = session.client;
  client.setCorrelationId(process.env.CORRELATION_ID);

  async function call(query = {}, { omitPage = false } = {}) {
    const q = { lang: 'en', currency: 'INR', perpage: PERPAGE, ...query };
    if (!omitPage && q.page === undefined) q.page = 0;
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
      total: res.data?.totalResults ?? hits.length,
      error: res.data?.error || null,
      queryUsed: q,
      raw: res.data,
    };
  }

  function how(q) {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.set(k, String(v));
    });
    return `GET ${API}?${params}`;
  }

  // ── 1. BLANK query behavior ─────────────────────────────────────────────
  {
    const r = await call({ page: 0 }, { omitPage: false });
    delete r.queryUsed.airport;
    const pass = r.http < 500 && ((r.http === 400 && r.error?.code === 'MISSING_AIRPORT') || r.http === 200);
    add(
      'BLANK',
      'No airport param + page=0',
      how({ lang: 'en', currency: 'INR', page: 0, perpage: PERPAGE }),
      'HTTP 400 MISSING_AIRPORT or 200 default list; never 500',
      pass ? 'PASS' : 'BUG',
      `HTTP ${r.http} code=${r.error?.code || '-'} n=${r.hits.length}`,
      { hits: r.hits.slice(0, 5), error: r.error },
    );
  }
  {
    const res = await client.request({
      method: 'GET',
      path: API,
      query: { lang: 'en', currency: 'INR', perpage: PERPAGE },
      signed: true,
      auth: true,
    });
    const hits = hitsOf(res.data).map(brief);
    add(
      'BLANK',
      'No airport param, no page param',
      `GET ${API}?lang=en&currency=INR&perpage=${PERPAGE}`,
      'HTTP 400 MISSING_AIRPORT or 200; never 500',
      res.status < 500 ? 'PASS' : 'BUG',
      `HTTP ${res.status} code=${res.data?.error?.code || '-'} n=${hits.length}`,
      { hits: hits.slice(0, 5), error: res.data?.error },
    );
  }
  {
    const r = await call({ airport: undefined, page: 1 });
    add(
      'BLANK',
      'No airport param + page=1',
      how({ lang: 'en', currency: 'INR', page: 1, perpage: PERPAGE }),
      'Same as no-airport: 400 or empty; never 500',
      r.http < 500 ? 'PASS' : 'BUG',
      `HTTP ${r.http} code=${r.error?.code || '-'} n=${r.hits.length}`,
      { error: r.error },
    );
  }

  // ── 2. EDGE: empty / whitespace / special / long ────────────────────────
  const edges = [
    { q: '', label: 'empty string', expect: (r) => r.http < 500 && (r.http === 400 || (r.http === 200 && r.hits.length === 0)) },
    { q: '   ', label: 'spaces only', expect: (r) => r.http < 500 && ((r.http >= 400) || (r.http === 200 && r.hits.length === 0)) },
    { q: '\t', label: 'tab only', expect: (r) => r.http < 500 && ((r.http >= 400) || (r.http === 200 && r.hits.length === 0)) },
    { q: '!@#$', label: 'special !@#$', expect: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: '<script>', label: 'HTML <script>', expect: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: ';;;;', label: 'semicolons', expect: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: 'mumb,', label: 'trailing comma', expect: (r) => r.http < 500 },
    { q: 'zzzzxxx', label: 'nonsense', expect: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: 'a'.repeat(200), label: '200-char string', expect: (r) => r.http < 500 },
    { q: 'a'.repeat(500), label: '500-char string', expect: (r) => r.http < 500 },
  ];
  for (const t of edges) {
    const r = await call({ airport: t.q });
    add(
      'EDGE',
      t.label,
      how(r.queryUsed),
      'never 500; 4xx or safe empty for garbage',
      t.expect(r) ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} top=${topStr(r.hits, 3)}`,
      { query: t.q, hits: r.hits.slice(0, 5), error: r.error },
    );
  }

  // ── 3. PID param + response pid field ───────────────────────────────────
  const pidQueries = ['bom', 'del', 'blr'];
  for (const airport of pidQueries) {
    const noPid = await call({ airport });
    const withVgm = await call({ airport, pid: 'vgm' });
    const withSmt = await call({ airport, pid: 'smt' });
    const hitPids = (hits) => [...new Set(hits.map((h) => h.pid).filter((x) => x != null))];
    const codesMatch = (a, b) => a.map((h) => h.airportCode).join() === b.map((h) => h.airportCode).join();
    const sameOrder = codesMatch(noPid.hits.slice(0, 5), withVgm.hits.slice(0, 5)) &&
      codesMatch(noPid.hits.slice(0, 5), withSmt.hits.slice(0, 5));
    add(
      'PID',
      `Response pid field: airport=${airport} (omit vs vgm vs smt)`,
      `airport=${airport} with pid=vgm|smt|omit`,
      'HTTP 200 all; note pid on hits + whether order changes',
      noPid.http === 200 && withVgm.http === 200 && withSmt.http === 200 ? 'PASS' : 'BUG',
      `omit pids=[${hitPids(noPid.hits).join(',') || 'all null'}] vgm=[${hitPids(withVgm.hits).join(',') || 'all null'}] smt=[${hitPids(withSmt.hits).join(',') || 'all null'}] topSame=${sameOrder} top=${topStr(noPid.hits)}`,
      { noPid: noPid.hits.slice(0, 5), withVgm: withVgm.hits.slice(0, 5), withSmt: withSmt.hits.slice(0, 5) },
    );
  }
  for (const pid of PIDS) {
    const label = pid || '(empty string)';
    const q = { airport: 'sin', ...(pid ? { pid } : { pid: '' }) };
    const r = await call(q);
    const { rank } = rankOf(r.hits, 'SIN');
    add(
      'PID',
      `Query pid=${label} on airport=sin`,
      how(r.queryUsed),
      'HTTP 200 SIN ranked; or 4xx bad pid; never 500',
      r.http < 500 && (r.http === 200 ? rank != null && rank <= 3 : r.http >= 400) ? 'PASS' : 'BUG',
      `HTTP ${r.http} SIN@${rank || 'MISS'} hitPids=[${[...new Set(r.hits.map((h) => h.pid))].join(',')}]`,
      { hits: r.hits.slice(0, 5) },
    );
  }
  {
    const r = await call({ airport: 'bom', pid: 'INVALID_PID_XYZ' });
    add(
      'PID',
      'Invalid pid=INVALID_PID_XYZ',
      how(r.queryUsed),
      'HTTP 200 (ignore bad pid) or 4xx; never 500',
      r.http < 500 ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} top=${topStr(r.hits, 2)}`,
      { hits: r.hits.slice(0, 3), error: r.error },
    );
  }

  // ── 4. PAGINATION + nearbyAirports ────────────────────────────────────
  for (const airport of ['a', 'del', 'mumb', 'lon']) {
    const pages = [];
    for (const page of [0, 1, 2]) {
      pages.push(await call({ airport, page, perpage: 5 }));
    }
    const codes = pages.map((p) => p.hits.map((h) => h.airportCode));
    const allCodes = codes.flat();
    const uniq = new Set(allCodes);
    const overlap01 = codes[0].filter((c) => codes[1].includes(c));
    const overlap12 = codes[1].filter((c) => codes[2].includes(c));
    const nearbyAll = pages.flatMap((p) => p.hits).filter((h) => h.nearbyAirports != null && h.nearbyAirports !== null);
    const pass =
      pages.every((p) => p.http === 200) &&
      pages[0].hits.length > 0 &&
      overlap01.length === 0 &&
      (codes[2].length === 0 || overlap12.length === 0);
    add(
      'PAGE',
      `Pages 0/1/2 airport=${airport} perpage=5`,
      `airport=${airport} page=0,1,2`,
      'HTTP 200; no overlap between consecutive pages; nearbyAirports noted',
      pass ? 'PASS' : 'BUG',
      `p0=${codes[0].length} p1=${codes[1].length} p2=${codes[2].length} overlap01=${overlap01.length} overlap12=${overlap12.length} total=${pages[0].total} nearbyWithData=${nearbyAll.length}`,
      {
        page0: pages[0].hits,
        page1: pages[1].hits,
        page2: pages[2].hits,
        nearbySample: nearbyAll.slice(0, 2),
      },
    );
  }
  // Scan top Indian metros for nearbyAirports anywhere in first page
  {
    const scan = ['BOM', 'DEL', 'BLR', 'MAA', 'HYD', 'GOI', 'GOX', 'NMI'];
    const nearbyFound = [];
    for (const code of scan) {
      const r = await call({ airport: code });
      const withNearby = r.hits.filter((h) => h.nearbyAirports != null);
      if (withNearby.length) nearbyFound.push({ code, sample: withNearby[0] });
    }
    add(
      'PAGE',
      'nearbyAirports scan on IATA BOM/DEL/BLR/MAA/HYD/GOI/GOX/NMI',
      'first page per IATA code',
      'Document whether nearbyAirports populated (NOT_TESTED if never present)',
      'PASS',
      nearbyFound.length
        ? `nearby present on ${nearbyFound.map((x) => x.code).join(', ')}`
        : 'nearbyAirports always null on all 8 codes scanned',
      { nearbyFound },
    );
  }

  // ── 5. PREFIX searches (live verify, do not assume) ─────────────────────
  const prefixes = [
    { q: 'm', expect: [], maxRank: 99, rule: 'Single char m → HTTP 200 has results' },
    { q: 'mu', expect: ['BOM'], maxRank: 3, rule: 'Prefix mu → BOM area' },
    { q: 'mum', expect: ['BOM'], maxRank: 2, rule: 'Prefix mum → BOM' },
    { q: 'mumb', expect: ['BOM'], maxRank: 2, rule: 'Prefix mumb → BOM' },
    { q: 'mumbai', expect: ['BOM'], maxRank: 2, rule: 'Prefix mumbai → BOM' },
    { q: 'de', expect: ['DEL'], maxRank: 3, rule: 'Prefix de → DEL area' },
    { q: 'del', expect: ['DEL'], maxRank: 2, rule: 'Prefix del → DEL' },
    { q: 'delh', expect: ['DEL'], maxRank: 2, rule: 'Prefix delh → DEL' },
    { q: 'ban', expect: ['BLR'], maxRank: 3, rule: 'Prefix ban → BLR' },
    { q: 'bang', expect: ['BLR'], maxRank: 3, rule: 'Prefix bang → BLR' },
    { q: 'chen', expect: ['MAA'], maxRank: 2, rule: 'Prefix chen → MAA' },
    { q: 'che', expect: ['MAA'], maxRank: 3, rule: 'Prefix che → MAA area' },
    { q: 'hyd', expect: ['HYD'], maxRank: 2, rule: 'Prefix hyd → HYD' },
    { q: 'goa', expect: ['GOI', 'GOX'], maxRank: 3, rule: 'Prefix goa → GOI/GOX' },
    { q: 'go', expect: ['GOI', 'GOX'], maxRank: 5, rule: 'Prefix go → Goa area' },
    { q: 'kol', expect: ['CCU'], maxRank: 3, rule: 'Prefix kol → CCU' },
    { q: 'pun', expect: ['PNQ'], maxRank: 3, rule: 'Prefix pun → PNQ' },
    { q: 'amr', expect: ['ATQ'], maxRank: 2, rule: 'Prefix amr → ATQ' },
    { q: 'amrit', expect: ['ATQ'], maxRank: 1, rule: 'Prefix amrit → ATQ' },
    { q: 'sin', expect: ['SIN'], maxRank: 2, rule: 'Prefix sin → SIN' },
    { q: 'lon', expect: ['LON', 'LHR', 'LGW'], maxRank: 3, rule: 'Prefix lon → London' },
    { q: 'new', expect: ['DEL', 'NYC', 'JFK'], maxRank: 5, rule: 'Prefix new → Delhi or NYC' },
    { q: 'dub', expect: ['DXB'], maxRank: 3, rule: 'Prefix dub → DXB' },
    { q: 'bkk', expect: ['BKK', 'DMK'], maxRank: 2, rule: 'Prefix bkk → Bangkok' },
  ];
  for (const t of prefixes) {
    const r = await call({ airport: t.q });
    let status = 'PASS';
    if (r.http >= 500 || r.http !== 200) status = 'BUG';
    else if (t.expect.length === 0) {
      if (r.hits.length === 0) status = 'BUG';
    } else {
      const { rank } = rankOf(r.hits, t.expect);
      if (rank == null || rank > t.maxRank) status = 'BUG';
    }
    const { rank, code } = rankOf(r.hits, t.expect);
    add(
      'PREFIX',
      t.rule,
      how(r.queryUsed),
      t.expect.length ? `${t.expect.join('|')} in top ${t.maxRank}` : 'HTTP 200 non-empty',
      status,
      `HTTP ${r.http} n=${r.hits.length} expect@${rank || 'MISS'}(${code || '-'}) top=${topStr(r.hits, 5)}`,
      { query: t.q, hits: r.hits.slice(0, 8) },
    );
  }

  // ── 6. Typos + old/alternate city names ────────────────────────────────
  const typos = [
    { q: 'bombay', expect: ['BOM'], maxRank: 1, tag: 'alt' },
    { q: 'madras', expect: ['MAA'], maxRank: 2, tag: 'alt' },
    { q: 'calcutta', expect: ['CCU'], maxRank: 2, tag: 'alt' },
    { q: 'poona', expect: ['PNQ'], maxRank: 2, tag: 'alt' },
    { q: 'cochin', expect: ['COK'], maxRank: 2, tag: 'alt' },
    { q: 'trivandrum', expect: ['TRV'], maxRank: 2, tag: 'alt' },
    { q: 'benaras', expect: ['VNS'], maxRank: 2, tag: 'alt' },
    { q: 'banaras', expect: ['VNS'], maxRank: 2, tag: 'alt' },
    { q: 'baroda', expect: ['BDQ'], maxRank: 2, tag: 'alt' },
    { q: 'mysore', expect: ['MYQ'], maxRank: 2, tag: 'alt' },
    { q: 'allahabad', expect: ['IXD'], maxRank: 2, tag: 'alt' },
    { q: 'bangalore', expect: ['BLR'], maxRank: 2, tag: 'alt' },
    { q: 'bengaluru', expect: ['BLR'], maxRank: 1, tag: 'alt' },
    { q: 'dehli', expect: ['DEL'], maxRank: 2, tag: 'typo' },
    { q: 'hydrabad', expect: ['HYD'], maxRank: 2, tag: 'typo' },
    { q: 'bangalor', expect: ['BLR'], maxRank: 2, tag: 'typo' },
    { q: 'banglor', expect: ['BLR'], maxRank: 2, tag: 'typo' },
    { q: 'mumbi', expect: ['BOM'], maxRank: 2, tag: 'typo' },
    { q: 'madrass', expect: ['MAA'], maxRank: 2, tag: 'typo' },
    { q: 'calcuta', expect: ['CCU'], maxRank: 2, tag: 'typo' },
    { q: 'pone', expect: ['PNQ'], maxRank: 2, tag: 'typo' },
    { q: 'goaa', expect: ['GOI', 'GOX'], maxRank: 3, tag: 'typo' },
    { q: 'nagpr', expect: ['NAG'], maxRank: 3, tag: 'typo' },
    { q: 'singapor', expect: ['SIN'], maxRank: 2, tag: 'typo' },
    { q: 'dubia', expect: ['DXB'], maxRank: 2, tag: 'typo' },
    { q: 'bangkock', expect: ['BKK', 'DMK'], maxRank: 3, tag: 'typo' },
    { q: 'chenai', expect: ['MAA'], maxRank: 2, tag: 'typo' },
    { q: 'kolkatta', expect: ['CCU'], maxRank: 2, tag: 'typo' },
    { q: 'punne', expect: ['PNQ'], maxRank: 2, tag: 'typo' },
  ];
  for (const t of typos) {
    const r = await call({ airport: t.q });
    const { rank, code } = rankOf(r.hits, t.expect);
    const top1 = r.hits[0];
    let status = 'PASS';
    if (r.http >= 500 || r.http !== 200) status = 'BUG';
    else if (r.hits.length === 0 || rank == null || rank > t.maxRank) status = 'BUG';
    add(
      t.tag === 'alt' ? 'SYNONYM' : 'TYPO',
      `${t.q} → ${t.expect.join('|')}`,
      how(r.queryUsed),
      `${t.expect.join('|')} in top ${t.maxRank}`,
      status,
      `HTTP ${r.http} rank=${rank || 'MISS'} top=${topStr(r.hits, 4)}`,
      { query: t.q, expect: t.expect, hits: r.hits.slice(0, 6) },
    );
  }

  // ── 7. IATA exact (regression spot-check) ─────────────────────────────
  for (const code of ['BOM', 'DEL', 'BLR', 'NMI', 'GOX']) {
    const r = await call({ airport: code });
    const want = code.toUpperCase();
    const { rank } = rankOf(r.hits, want);
    add(
      'IATA',
      `Exact airport=${code}`,
      how(r.queryUsed),
      `${want} rank 1-2`,
      r.http === 200 && rank != null && rank <= 2 ? 'PASS' : 'BUG',
      `HTTP ${r.http} rank(${want})=${rank || 'MISS'} top=${topStr(r.hits, 3)}`,
      { hits: r.hits.slice(0, 5) },
    );
  }

  const bugs = rows.filter((r) => r.status === 'BUG');
  const bySection = {};
  for (const row of rows) {
    bySection[row.section] = bySection[row.section] || { PASS: 0, BUG: 0 };
    bySection[row.section][row.status] += 1;
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    api: `GET ${API}`,
    note: 'Checklist pass: blank, edge, pid, page, prefix, typo/synonym. No book.',
    counts,
    bySection,
    bugCount: bugs.length,
    bugs: bugs.map((b) => ({ id: b.id, section: b.section, rule: b.rule, actual: b.actual })),
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('BY SECTION', bySection);
  console.log('BUGS', bugs.length);
  for (const b of bugs) console.log(`  BUG ${b.section} #${b.id}: ${b.rule}`);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
