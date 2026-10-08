/**
 * Preprod full pass — GET /api/v2/search/airport-search
 * Catalog only. No flight search / book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'v2-airport-search-preprod.json');
const API = '/api/v2/search/airport-search';
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
    pid: h.pid ?? null,
    nearbyAirports: h.nearbyAirports || h.nearby || null,
    tag: h.tag ?? null,
  };
}

function rankOf(hits, codes) {
  const want = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).toUpperCase());
  for (let i = 0; i < hits.length; i += 1) {
    const code = String(hits[i].airportCode || hits[i].code || hits[i].iata || '').toUpperCase();
    if (want.includes(code)) return { rank: i + 1, code };
  }
  return { rank: null, code: null };
}

function includesCity(hits, re, limit = 5) {
  return hits.slice(0, limit).some((h) => re.test(`${h.city || ''} ${h.airportName || ''} ${h.airportCode || ''}`));
}

function add(section, rule, how, expected, status, actual, extra = {}) {
  n += 1;
  rows.push({ id: n, section, rule, how, expected, status, actual, ...extra });
  counts[status] += 1;
  console.log(`[${status}] ${section} ${n}. ${rule} — ${String(actual).slice(0, 240)}`);
}

async function main() {
  console.log('=== v2 Airport Search PREPROD full pass (no book) ===');
  console.log('BASE', process.env.BASE_URL);
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  const client = session.client;
  client.setCorrelationId(process.env.CORRELATION_ID);

  async function call(query = {}, opts = {}) {
    const q = { page: 0, perpage: PERPAGE, ...query };
    if (opts.omitPage) delete q.page;
    if (opts.omitQuery) {
      delete q.q;
      delete q.airport;
      delete q.query;
    }
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
      ok: res.ok,
      data: res.data,
      hits,
      total: res.data?.totalResults ?? hits.length,
      error: res.data?.error || null,
      meta: res.data?._meta || null,
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

  // --- Discover query param name ---
  const bomQ = await call({ q: 'bom', pid: 'vgm' });
  const bomAirport = await call({ airport: 'bom', pid: 'vgm' });
  const useAirportParam = bomAirport.hits.some((h) => h.airportCode === 'BOM') && !bomQ.hits.some((h) => h.airportCode === 'BOM');
  const queryKey = useAirportParam ? 'airport' : 'q';
  add(
    'SETUP',
    'Query param discovery',
    'q=bom vs airport=bom',
    'Identify working search param for v2',
    'PASS',
    `using param "${queryKey}" (q n=${bomQ.hits.length} airport n=${bomAirport.hits.length})`,
    { queryKey, bomQTop: bomQ.hits.slice(0, 3), bomAirportTop: bomAirport.hits.slice(0, 3) },
  );

  const Q = (val, extra = {}) => call({ [queryKey]: val, pid: 'vgm', ...extra });

  // --- BLANK / NO QUERY ---
  {
    const r = await call({ pid: 'vgm' });
    const pass = r.http === 200 && r.hits.length > 0;
    add(
      'BLANK',
      'No query param, page=0',
      how(r.queryUsed),
      'HTTP 200 with default/popular airports (not error)',
      pass ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} total=${r.total} top=${r.hits.slice(0, 3).map((h) => h.airportCode).join(',')}`,
      { hits: r.hits.slice(0, 8), error: r.error },
    );
  }
  {
    const r = await call({ pid: 'vgm' }, { omitPage: true });
    add(
      'BLANK',
      'No query param, no page param',
      how(r.queryUsed),
      'HTTP 200 or documented 4xx; never 500',
      r.http < 500 ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length}`,
      { hits: r.hits.slice(0, 5), error: r.error },
    );
  }
  for (const q of ['', '   ', '\t']) {
    const r = await Q(q);
    const pass =
      r.http < 500 &&
      ((r.http >= 400 && r.http < 500) || (r.http === 200 && (r.hits.length === 0 || q.trim() === '')));
    add(
      'EDGE',
      `Empty/whitespace query ${JSON.stringify(q)}`,
      how(r.queryUsed),
      'HTTP 4xx or 200 empty/safe; never 500',
      pass ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} code=${r.error?.code || '-'}`,
      { query: q, hits: r.hits.slice(0, 5), error: r.error },
    );
  }

  // --- PID behavior ---
  {
    const withPid = await Q('del', { pid: 'vgm' });
    const noPid = await call({ [queryKey]: 'del' });
    const pidsWith = [...new Set(withPid.hits.map((h) => h.pid).filter((x) => x != null))];
    const pidsNo = [...new Set(noPid.hits.map((h) => h.pid).filter((x) => x != null))];
    add(
      'PID',
      'pid=vgm vs omit pid',
      'del with/without pid',
      'Both HTTP 200; pid field present or consistently omitted on hits',
      withPid.http === 200 && noPid.http === 200 ? 'PASS' : 'BUG',
      `withPid HTTP ${withPid.http} pidsOnHits=${pidsWith.join('|') || '(none)'}; noPid HTTP ${noPid.http} pidsOnHits=${pidsNo.join('|') || '(none)'} top=${withPid.hits.slice(0, 3).map((h) => `${h.airportCode}:${h.pid ?? 'null'}`).join(' | ')}`,
      { withPid: withPid.hits.slice(0, 5), noPid: noPid.hits.slice(0, 5) },
    );
  }
  for (const pid of ['vgm', '']) {
    const r = await call({ [queryKey]: 'bom', ...(pid ? { pid } : {}) });
    add(
      'PID',
      pid ? `pid=${pid} on BOM search` : 'Empty pid param',
      how(r.queryUsed),
      'HTTP 200 with BOM in results (or 4xx for invalid pid); never 500',
      r.http < 500 && (r.http === 200 ? rankOf(r.hits, 'BOM').rank != null : r.http >= 400) ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} BOM@${rankOf(r.hits, 'BOM').rank || 'MISS'}`,
      { hits: r.hits.slice(0, 5) },
    );
  }

  // --- PAGINATION ---
  {
    const p0 = await call({ [queryKey]: 'a', pid: 'vgm', page: 0, perpage: 5 });
    const p1 = await call({ [queryKey]: 'a', pid: 'vgm', page: 1, perpage: 5 });
    const codes0 = p0.hits.map((h) => h.airportCode);
    const codes1 = p1.hits.map((h) => h.airportCode);
    const overlap = codes0.filter((c) => codes1.includes(c));
    const hasNearby = [...p0.hits, ...p1.hits].some((h) => h.nearbyAirports != null);
    const pass = p0.http === 200 && p1.http === 200 && p0.hits.length > 0 && (p1.hits.length === 0 || overlap.length === 0);
    add(
      'PAGE',
      'page 0 vs page 1 (prefix a)',
      'page=0 perpage=5 vs page=1',
      'Different slices; no duplicate airports across pages when page1 has results',
      pass ? 'PASS' : 'BUG',
      `p0 n=${p0.hits.length} p1 n=${p1.hits.length} overlap=${overlap.length} nearbyFieldSeen=${hasNearby}`,
      { page0: p0.hits, page1: p1.hits, total: p0.total },
    );
  }

  // --- PREFIX searches (careful) ---
  const prefixes = [
    { q: 'mum', expect: ['BOM'], city: /mumbai/i, maxRank: 2, rule: 'Prefix mum → BOM Mumbai' },
    { q: 'del', expect: ['DEL'], city: /delhi/i, maxRank: 2, rule: 'Prefix del → DEL' },
    { q: 'ban', expect: ['BLR'], city: /bengaluru|bangalore/i, maxRank: 3, rule: 'Prefix ban → BLR (not random Ban*)' },
    { q: 'chen', expect: ['MAA'], city: /chennai/i, maxRank: 2, rule: 'Prefix chen → MAA' },
    { q: 'hyd', expect: ['HYD'], city: /hyderabad/i, maxRank: 2, rule: 'Prefix hyd → HYD' },
    { q: 'goa', expect: ['GOI', 'GOX'], city: /goa|mopa|dabolim/i, maxRank: 3, rule: 'Prefix goa → GOI/GOX' },
    { q: 'sin', expect: ['SIN'], city: /singapore/i, maxRank: 2, rule: 'Prefix sin → SIN' },
    { q: 'lon', expect: ['LHR', 'LGW', 'STN', 'LCY', 'LTN'], city: /london/i, maxRank: 3, rule: 'Prefix lon → London airports' },
    { q: 'new', expect: ['DEL', 'NYC', 'JFK', 'EWR', 'LGA'], city: /delhi|new york|york/i, maxRank: 5, rule: 'Prefix new → Delhi or NYC family (rank check)' },
    { q: 'cha', expect: ['IXC', 'CCU'], city: /chandigarh|kolkata|chennai|charlotte/i, maxRank: 5, rule: 'Prefix cha → major INTL city not noise' },
  ];
  for (const t of prefixes) {
    const r = await Q(t.q);
    const { rank, code } = rankOf(r.hits, t.expect);
    const cityOk = !t.city || includesCity(r.hits, t.city, t.maxRank || 3);
    let status = 'PASS';
    if (r.http >= 500 || r.http !== 200 || r.hits.length === 0) status = 'BUG';
    else if (rank == null || rank > (t.maxRank || 3)) status = 'BUG';
    else if (!cityOk) status = 'BUG';
    add(
      'PREFIX',
      t.rule,
      how(r.queryUsed),
      `HTTP 200; expected in top ${t.maxRank || 3}`,
      status,
      `HTTP ${r.http} n=${r.hits.length} expect@${rank || 'MISS'}(${code || '-'}) top=${r.hits.slice(0, 5).map((h) => `${h.airportCode}:${h.city}`).join(' | ')}`,
      { query: t.q, hits: r.hits.slice(0, 8) },
    );
  }

  // --- TYPOS / ALTERNATE NAMES ---
  const typos = [
    { q: 'bangalor', expect: ['BLR'], city: /bengaluru|bangalore/i, maxRank: 2, note: 'known bangalor trap' },
    { q: 'bombay', expect: ['BOM'], city: /mumbai|bombay/i, maxRank: 1 },
    { q: 'madras', expect: ['MAA'], city: /chennai|madras/i, maxRank: 2 },
    { q: 'calcutta', expect: ['CCU'], city: /kolkata|calcutta/i, maxRank: 2 },
    { q: 'poona', expect: ['PNQ'], city: /pune|poona/i, maxRank: 2 },
    { q: 'cochin', expect: ['COK'], city: /kochi|cochin/i, maxRank: 2 },
    { q: 'trivandrum', expect: ['TRV'], city: /trivandrum|thiruvananthapuram/i, maxRank: 2 },
    { q: 'benaras', expect: ['VNS'], city: /varanasi|benaras|banaras/i, maxRank: 2 },
    { q: 'dehli', expect: ['DEL'], city: /delhi/i, maxRank: 2 },
    { q: 'mumbi', expect: ['BOM'], city: /mumbai/i, maxRank: 2 },
    { q: 'hydrabad', expect: ['HYD'], city: /hyderabad/i, maxRank: 2 },
    { q: 'singapor', expect: ['SIN'], city: /singapore/i, maxRank: 2 },
    { q: 'dubia', expect: ['DXB'], city: /dubai/i, maxRank: 2 },
    { q: 'bangkock', expect: ['BKK', 'DMK'], city: /bangkok/i, maxRank: 3 },
    { q: 'new delhi', expect: ['DEL'], city: /delhi/i, maxRank: 1 },
    { q: 'bengaluru', expect: ['BLR'], city: /bengaluru|bangalore/i, maxRank: 1 },
    { q: 'amdavad', expect: ['AMD'], city: /ahmedabad|amdavad/i, maxRank: 2 },
    { q: 'gauhati', expect: ['GAU'], city: /guwahati|gauhati/i, maxRank: 2 },
  ];
  for (const t of typos) {
    const r = await Q(t.q);
    const { rank, code } = rankOf(r.hits, t.expect);
    const top1 = r.hits[0];
    const wrongTop =
      top1 && !t.expect.map((c) => c.toUpperCase()).includes(String(top1.airportCode || '').toUpperCase());
    let status = 'PASS';
    if (r.http >= 500 || r.http !== 200 || r.hits.length === 0) status = 'BUG';
    else if (rank == null || rank > (t.maxRank || 3)) status = 'BUG';
    add(
      'TYPO',
      `Typo/alternate: ${t.q}${t.note ? ` (${t.note})` : ''}`,
      how(r.queryUsed),
      `HTTP 200; ${t.expect.join('|')} in top ${t.maxRank || 3}`,
      status,
      `HTTP ${r.http} rank=${rank || 'MISS'} wrongTop=${wrongTop ? `${top1.airportCode}:${top1.city}` : 'no'} top=${r.hits.slice(0, 4).map((h) => `${h.airportCode}:${h.city}`).join(' | ')}`,
      { query: t.q, expect: t.expect, hits: r.hits.slice(0, 8) },
    );
  }

  // --- IATA exact ---
  for (const code of ['BOM', 'DEL', 'BLR', 'ATQ', 'AMD', 'bom']) {
    const r = await Q(code);
    const rank = rankOf(r.hits, code.toUpperCase()).rank;
    add(
      'IATA',
      `IATA ${code}`,
      how(r.queryUsed),
      'HTTP 200; exact code rank 1',
      r.http === 200 && rank === 1 ? 'PASS' : 'BUG',
      `HTTP ${r.http} rank=${rank || 'MISS'} top=${r.hits.slice(0, 3).map((h) => `${h.airportCode}:${h.city}`).join(' | ')}`,
      { hits: r.hits.slice(0, 5) },
    );
  }

  // --- EDGE special chars / long ---
  const edges = [
    { q: '!@#$', expect: '4xx or 200 empty', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: '<script>', expect: '4xx or 200 empty', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: ';;;;', expect: '4xx or 200 empty', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: 'zzzzxxx', expect: '200 empty or 4xx', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: 'a'.repeat(200), expect: 'never 500', check: (r) => r.http < 500 },
    { q: 'mumb,', expect: 'never 500', check: (r) => r.http < 500 },
  ];
  for (const t of edges) {
    const r = await Q(t.q);
    add(
      'EDGE',
      `Edge: ${JSON.stringify(t.q.length > 40 ? `${t.q.slice(0, 20)}…(${t.q.length})` : t.q)}`,
      how(r.queryUsed),
      t.expect,
      t.check(r) ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} top=${r.hits.slice(0, 3).map((h) => h.airportCode).join(',') || '(none)'}`,
      { hits: r.hits.slice(0, 5), error: r.error },
    );
  }

  const bugs = rows.filter((r) => r.status === 'BUG');
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    api: `GET ${API}`,
    queryParam: queryKey,
    note: 'v2 airport-search full preprod pass. Catalog only, no book.',
    counts,
    bugCount: bugs.length,
    bugs: bugs.map((b) => ({ id: b.id, section: b.section, rule: b.rule, actual: b.actual, query: b.query, hits: b.hits })),
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('BUGS', bugs.length);
  for (const b of bugs) console.log(`  BUG ${b.section} #${b.id}: ${b.rule} — ${b.actual}`);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
