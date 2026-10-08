/**
 * Preprod full pass — GET /v1/flights/airports (airport catalog search)
 * Catalog only. No flight search / book.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'airport-search-synonyms-preprod.json');
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
  console.log(`[${status}] ${section} ${n}. ${rule} — ${String(actual).slice(0, 260)}`);
}

async function main() {
  console.log('=== Airport Search full PREPROD pass (GET /v1/flights/airports, no book) ===');
  console.log('BASE', process.env.BASE_URL);
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  const client = session.client;
  client.setCorrelationId(process.env.CORRELATION_ID);

  async function call(query = {}) {
    const q = { lang: 'en', currency: 'INR', page: 0, perpage: PERPAGE, ...query };
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
      rawKeys: res.data ? Object.keys(res.data) : [],
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

  // --- BLANK / NO QUERY PARAM ---
  {
    const r = await call({ page: 0, perpage: PERPAGE });
    const pass =
      r.http < 500 &&
      ((r.http >= 400 && r.http < 500 && r.error?.code === 'MISSING_AIRPORT') || r.http === 200);
    add(
      'BLANK',
      'No airport param, page=0',
      how(r.queryUsed),
      'HTTP 400 MISSING_AIRPORT or 200 default; never 500',
      pass ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} total=${r.total} top=${r.hits.slice(0, 4).map((h) => h.airportCode).join(',') || '(none)'}`,
      { hits: r.hits.slice(0, 8), error: r.error },
    );
  }
  {
    const r = await call({ perpage: PERPAGE });
    delete r.queryUsed.page;
    const res2 = await client.request({
      method: 'GET',
      path: API,
      query: { lang: 'en', currency: 'INR', perpage: PERPAGE },
      signed: true,
      auth: true,
    });
    const hits = hitsOf(res2.data).map(brief);
    add(
      'BLANK',
      'No airport param, no page param',
      'GET /v1/flights/airports?lang=en&currency=INR&perpage=10',
      'HTTP 200 or documented 4xx; never 500',
      res2.status < 500 ? 'PASS' : 'BUG',
      `HTTP ${res2.status} n=${hits.length}`,
      { hits: hits.slice(0, 5), error: res2.data?.error },
    );
  }

  // --- EMPTY / WHITESPACE ---
  for (const airport of ['', '   ', '\t']) {
    const r = await call({ airport });
    const pass =
      r.http < 500 &&
      ((r.http >= 400 && r.http < 500) || (r.http === 200 && (r.hits.length === 0 || airport.trim() === '')));
    add(
      'EDGE',
      `Empty/whitespace airport=${JSON.stringify(airport)}`,
      how(r.queryUsed),
      'HTTP 4xx or 200 empty/safe; never 500',
      pass ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} code=${r.error?.code || '-'}`,
      { query: airport, hits: r.hits.slice(0, 5), error: r.error },
    );
  }

  // --- PID behavior ---
  {
    const withPid = await call({ airport: 'del', pid: 'vgm' });
    const noPid = await call({ airport: 'del' });
    const pidsWith = [...new Set(withPid.hits.map((h) => h.pid).filter((x) => x != null))];
    const pidsNo = [...new Set(noPid.hits.map((h) => h.pid).filter((x) => x != null))];
    const topWith = withPid.hits.slice(0, 3).map((h) => `${h.airportCode}(pid=${h.pid ?? 'null'})`).join(' | ');
    add(
      'PID',
      'pid=vgm vs omit pid on del',
      'airport=del with/without pid',
      'Both HTTP 200; inspect pid on hits if present',
      withPid.http === 200 && noPid.http === 200 ? 'PASS' : 'BUG',
      `withPid HTTP ${withPid.http} hitPids=[${pidsWith.join(',')||'none'}]; noPid HTTP ${noPid.http} hitPids=[${pidsNo.join(',')||'none'}] top=${topWith}`,
      { withPid: withPid.hits.slice(0, 5), noPid: noPid.hits.slice(0, 5) },
    );
  }
  for (const pid of ['vgm', 'smt', '']) {
    const q = { airport: 'bom', ...(pid ? { pid } : {}) };
    const r = await call(q);
    const { rank } = rankOf(r.hits, 'BOM');
    add(
      'PID',
      pid ? `pid=${pid} on BOM search` : 'Empty pid query param',
      how(r.queryUsed),
      'HTTP 200 with BOM ranked; or 4xx for bad pid; never 500',
      r.http < 500 && (r.http === 200 ? rank != null && rank <= 3 : r.http >= 400) ? 'PASS' : 'BUG',
      `HTTP ${r.http} BOM@${rank || 'MISS'} n=${r.hits.length}`,
      { hits: r.hits.slice(0, 5) },
    );
  }

  // --- PAGINATION + nearby ---
  {
    const p0 = await call({ airport: 'a', page: 0, perpage: 5 });
    const p1 = await call({ airport: 'a', page: 1, perpage: 5 });
    const codes0 = p0.hits.map((h) => h.airportCode);
    const codes1 = p1.hits.map((h) => h.airportCode);
    const overlap = codes0.filter((c) => codes1.includes(c));
    const nearbySeen = [...p0.hits, ...p1.hits].filter((h) => h.nearbyAirports != null);
    const pass = p0.http === 200 && p1.http === 200 && p0.hits.length > 0 && (p1.hits.length === 0 || overlap.length === 0);
    add(
      'PAGE',
      'page 0 vs page 1 (airport=a, perpage=5)',
      'page=0 vs page=1',
      'Different slices when page1 has results; nearbyAirports noted if present',
      pass ? 'PASS' : 'BUG',
      `p0 n=${p0.hits.length} p1 n=${p1.hits.length} overlap=${overlap.length} nearbyHits=${nearbySeen.length} total=${p0.total}`,
      { page0: p0.hits, page1: p1.hits, nearbySample: nearbySeen.slice(0, 2) },
    );
  }

  // --- PREFIX (careful) ---
  const prefixes = [
    { q: 'mum', expect: ['BOM'], city: /mumbai/i, maxRank: 2, rule: 'Prefix mum → BOM' },
    { q: 'del', expect: ['DEL'], city: /delhi/i, maxRank: 2, rule: 'Prefix del → DEL' },
    { q: 'ban', expect: ['BLR'], city: /bengaluru|bangalore/i, maxRank: 3, rule: 'Prefix ban → BLR not random Ban*' },
    { q: 'chen', expect: ['MAA'], city: /chennai/i, maxRank: 2, rule: 'Prefix chen → MAA' },
    { q: 'hyd', expect: ['HYD'], city: /hyderabad/i, maxRank: 2, rule: 'Prefix hyd → HYD' },
    { q: 'goa', expect: ['GOI', 'GOX'], city: /goa|mopa|dabolim/i, maxRank: 3, rule: 'Prefix goa → GOI/GOX' },
    { q: 'sin', expect: ['SIN'], city: /singapore/i, maxRank: 2, rule: 'Prefix sin → SIN' },
    { q: 'lon', expect: ['LHR', 'LGW', 'STN', 'LCY', 'LTN', 'LON'], city: /london/i, maxRank: 3, rule: 'Prefix lon → London' },
    { q: 'new', expect: ['DEL', 'NYC', 'JFK', 'EWR', 'LGA'], city: /delhi|new york|york/i, maxRank: 5, rule: 'Prefix new → Delhi or NYC family' },
    { q: 'amrit', expect: ['ATQ'], city: /amritsar/i, maxRank: 1, rule: 'Prefix amrit → ATQ' },
    { q: 'mumb', expect: ['BOM'], city: /mumbai/i, maxRank: 2, rule: 'Prefix mumb → BOM' },
  ];
  for (const t of prefixes) {
    const r = await call({ airport: t.q });
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

  async function runQueryCases(section, cases) {
    for (const t of cases) {
      const r = await call({ airport: t.q });
      const { rank, code } = rankOf(r.hits, t.expect);
      const top1 = r.hits[0];
      const wrongTop =
        top1 && !t.expect.map((c) => c.toUpperCase()).includes(String(top1.airportCode || '').toUpperCase());
      let status = 'PASS';
      if (r.http >= 500 || r.http !== 200) status = 'BUG';
      else if (r.hits.length === 0 || rank == null || rank > (t.maxRank || 3)) status = 'BUG';
      add(
        section,
        `${t.q}${t.note ? ` (${t.note})` : ''}`,
        how(r.queryUsed),
        `${t.expect.join('|')} in top ${t.maxRank || 3}`,
        status,
        `HTTP ${r.http} rank=${rank || 'MISS'} wrongTop=${wrongTop ? `${top1.airportCode}:${top1.city}` : 'no'} top=${r.hits.slice(0, 4).map((h) => `${h.airportCode}:${h.city}`).join(' | ') || '(empty)'}`,
        { query: t.q, expect: t.expect, hits: r.hits.slice(0, 8) },
      );
    }
  }

  // --- REGRESSION: previously working synonyms (must not break) ---
  await runQueryCases('REGRESSION', [
    { q: 'bangalore', expect: ['BLR'], maxRank: 2 },
    { q: 'bengaluru', expect: ['BLR'], maxRank: 1 },
    { q: 'bombay', expect: ['BOM'], maxRank: 1 },
    { q: 'calcutta', expect: ['CCU'], maxRank: 2 },
    { q: 'poona', expect: ['PNQ'], maxRank: 2 },
    { q: 'cochin', expect: ['COK'], maxRank: 2 },
    { q: 'trivandrum', expect: ['TRV'], maxRank: 2 },
    { q: 'benaras', expect: ['VNS'], maxRank: 2 },
    { q: 'dehli', expect: ['DEL'], maxRank: 2 },
    { q: 'hydrabad', expect: ['HYD'], maxRank: 2 },
    { q: 'new delhi', expect: ['DEL'], maxRank: 1 },
    { q: 'amdavad', expect: ['AMD'], maxRank: 2 },
    { q: 'gauhati', expect: ['GAU'], maxRank: 2 },
    { q: 'bangalor', expect: ['BLR'], maxRank: 2, note: 'was Bangor trap' },
    { q: 'mumbi', expect: ['BOM'], maxRank: 2 },
    { q: 'singapor', expect: ['SIN'], maxRank: 2 },
    { q: 'dubia', expect: ['DXB'], maxRank: 2 },
    { q: 'bangkock', expect: ['BKK', 'DMK'], maxRank: 3 },
  ]);

  // --- SYNONYM: popular legacy / alternate city names ---
  await runQueryCases('SYNONYM', [
    { q: 'banaras', expect: ['VNS'], maxRank: 2 },
    { q: 'varanasi', expect: ['VNS'], maxRank: 2 },
    { q: 'baroda', expect: ['BDQ'], maxRank: 2 },
    { q: 'vadodara', expect: ['BDQ'], maxRank: 2 },
    { q: 'mysore', expect: ['MYQ'], maxRank: 2 },
    { q: 'mysuru', expect: ['MYQ'], maxRank: 2 },
    { q: 'prayagraj', expect: ['IXD'], maxRank: 2 },
    { q: 'allahabad', expect: ['IXD'], maxRank: 2 },
    { q: 'vizag', expect: ['VTZ'], maxRank: 2 },
    { q: 'visakhapatnam', expect: ['VTZ'], maxRank: 2 },
    { q: 'bhubaneswar', expect: ['BBI'], maxRank: 2 },
    { q: 'bhubaneshwar', expect: ['BBI'], maxRank: 2 },
    { q: 'kochi', expect: ['COK'], maxRank: 2 },
    { q: 'thiruvananthapuram', expect: ['TRV'], maxRank: 2 },
    { q: 'lakhnau', expect: ['LKO'], maxRank: 2 },
    { q: 'lucknow', expect: ['LKO'], maxRank: 2 },
    { q: 'kolkata', expect: ['CCU'], maxRank: 2 },
    { q: 'mumbai', expect: ['BOM'], maxRank: 1 },
    { q: 'delhi', expect: ['DEL'], maxRank: 2 },
    { q: 'chennai', expect: ['MAA'], maxRank: 1 },
    { q: 'hyderabad', expect: ['HYD'], maxRank: 2 },
    { q: 'ahmedabad', expect: ['AMD'], maxRank: 2 },
    { q: 'jaipur', expect: ['JAI'], maxRank: 2 },
    { q: 'nagpur', expect: ['NAG'], maxRank: 2 },
    { q: 'indore', expect: ['IDR'], maxRank: 2 },
    { q: 'chandigarh', expect: ['IXC'], maxRank: 2 },
    { q: 'guwahati', expect: ['GAU'], maxRank: 2 },
    { q: 'srinagar', expect: ['SXR'], maxRank: 2 },
    { q: 'leh', expect: ['IXL'], maxRank: 2 },
    { q: 'jammu', expect: ['IXJ'], maxRank: 2 },
    { q: 'patna', expect: ['PAT'], maxRank: 2 },
    { q: 'ranchi', expect: ['IXR'], maxRank: 2 },
    { q: 'raipur', expect: ['RPR'], maxRank: 2 },
    { q: 'bhopal', expect: ['BHO'], maxRank: 2 },
    { q: 'udaipur', expect: ['UDR'], maxRank: 2 },
    { q: 'jodhpur', expect: ['JDH'], maxRank: 2 },
    { q: 'surat', expect: ['STV'], maxRank: 2 },
    { q: 'ayodhya', expect: ['AYJ'], maxRank: 2 },
    { q: 'port blair', expect: ['IXZ'], maxRank: 2 },
    { q: 'singapore', expect: ['SIN'], maxRank: 2 },
    { q: 'dubai', expect: ['DXB'], maxRank: 2 },
    { q: 'bangkok', expect: ['BKK', 'DMK'], maxRank: 3 },
    { q: 'london', expect: ['LON', 'LHR', 'LGW', 'STN', 'LCY'], maxRank: 3 },
    { q: 'paris', expect: ['PAR', 'CDG', 'ORY'], maxRank: 3 },
    { q: 'new york', expect: ['NYC', 'JFK', 'EWR', 'LGA'], maxRank: 3 },
    { q: 'tokyo', expect: ['TYO', 'HND', 'NRT'], maxRank: 3 },
    { q: 'hong kong', expect: ['HKG'], maxRank: 2 },
    { q: 'kuala lumpur', expect: ['KUL'], maxRank: 2 },
    { q: 'bali', expect: ['DPS'], maxRank: 2 },
    { q: 'phuket', expect: ['HKT'], maxRank: 2 },
    { q: 'kathmandu', expect: ['KTM'], maxRank: 2 },
    { q: 'colombo', expect: ['CMB'], maxRank: 2 },
    { q: 'istanbul', expect: ['IST', 'SAW'], maxRank: 3 },
    { q: 'doha', expect: ['DOH'], maxRank: 2 },
    { q: 'abu dhabi', expect: ['AUH'], maxRank: 2 },
    { q: 'sydney', expect: ['SYD'], maxRank: 2 },
    { q: 'melbourne', expect: ['MEL'], maxRank: 2 },
    { q: 'toronto', expect: ['YYZ'], maxRank: 2 },
    { q: 'san francisco', expect: ['SFO'], maxRank: 2 },
    { q: 'los angeles', expect: ['LAX'], maxRank: 2 },
    { q: 'chicago', expect: ['ORD'], maxRank: 3 },
    { q: 'saigon', expect: ['SGN'], maxRank: 2 },
    { q: 'beijing', expect: ['PEK', 'PKX'], maxRank: 3 },
    { q: 'guangzhou', expect: ['CAN'], maxRank: 2 },
  ]);

  // --- RENAME: new / renamed airports (search by new official name) ---
  await runQueryCases('RENAME', [
    { q: 'navi mumbai', expect: ['NMI', 'BOM'], maxRank: 3, note: 'Navi Mumbai Intl' },
    { q: 'mopa', expect: ['GOX'], maxRank: 2, note: 'Manohar Intl Goa' },
    { q: 'manohar international', expect: ['GOX'], maxRank: 2 },
    { q: 'dabolim', expect: ['GOI'], maxRank: 2, note: 'Goa legacy airport' },
    { q: 'rajkot international', expect: ['HSR'], maxRank: 2, note: 'Hirasar' },
    { q: 'hirasar', expect: ['HSR'], maxRank: 2 },
    { q: 'noida international', expect: ['DXN', 'DEL'], maxRank: 3, note: 'Jewar' },
    { q: 'jewar', expect: ['DXN', 'DEL'], maxRank: 3 },
    { q: 'shivamogga', expect: ['RQY'], maxRank: 2, note: 'new 2023' },
    { q: 'kushinagar', expect: ['KBK'], maxRank: 2 },
    { q: 'chhatrapati sambhaji nagar', expect: ['IXU'], maxRank: 2, note: 'ex-Aurangabad' },
    { q: 'aurangabad', expect: ['IXU'], maxRank: 2 },
    { q: 'pakyong', expect: ['PYG'], maxRank: 2, note: 'Sikkim' },
    { q: 'hollongi', expect: ['HGI'], maxRank: 2, note: 'Itanagar' },
    { q: 'itanagar', expect: ['HGI', 'IXA'], maxRank: 3 },
    { q: 'kempegowda', expect: ['BLR'], maxRank: 2, note: 'BLR official name' },
    { q: 'chhatrapati shivaji', expect: ['BOM'], maxRank: 2, note: 'BOM official name' },
    { q: 'indira gandhi', expect: ['DEL'], maxRank: 3, note: 'DEL official name' },
  ]);

  // --- TYPO: near-miss / truncated (known weak spots) ---
  await runQueryCases('TYPO', [
    { q: 'banglor', expect: ['BLR'], maxRank: 2 },
    { q: 'madras', expect: ['MAA'], maxRank: 2 },
    { q: 'madrass', expect: ['MAA'], maxRank: 2 },
    { q: 'calcuta', expect: ['CCU'], maxRank: 2 },
    { q: 'pone', expect: ['PNQ'], maxRank: 2 },
    { q: 'goaa', expect: ['GOI', 'GOX'], maxRank: 3 },
    { q: 'nagpr', expect: ['NAG'], maxRank: 3 },
    { q: 'bengaloor', expect: ['BLR'], maxRank: 2 },
    { q: 'bengalur', expect: ['BLR'], maxRank: 2 },
    { q: 'bangaluru', expect: ['BLR'], maxRank: 2 },
    { q: 'mumabai', expect: ['BOM'], maxRank: 2 },
    { q: 'delli', expect: ['DEL'], maxRank: 2 },
    { q: 'chenai', expect: ['MAA'], maxRank: 2 },
    { q: 'kolkat', expect: ['CCU'], maxRank: 2 },
    { q: 'kolkatta', expect: ['CCU'], maxRank: 2 },
    { q: 'punne', expect: ['PNQ'], maxRank: 2 },
    { q: 'singpore', expect: ['SIN'], maxRank: 2 },
    { q: 'duabi', expect: ['DXB'], maxRank: 2 },
    { q: 'bankok', expect: ['BKK', 'DMK'], maxRank: 3 },
    { q: 'londn', expect: ['LON', 'LHR', 'LGW', 'STN', 'LCY'], maxRank: 3 },
    { q: 'pariss', expect: ['PAR', 'CDG', 'ORY'], maxRank: 3 },
    { q: 'tokoyo', expect: ['TYO', 'HND', 'NRT'], maxRank: 3 },
    { q: 'newyrok', expect: ['NYC', 'JFK', 'EWR', 'LGA'], maxRank: 3 },
  ]);

  // --- IATA exact + case ---
  for (const code of ['BOM', 'DEL', 'BLR', 'ATQ', 'AMD', 'bom', 'MuMb']) {
    const r = await call({ airport: code });
    const want = code.toUpperCase() === 'MUMB' ? 'BOM' : code.toUpperCase();
    const rank = rankOf(r.hits, want).rank;
    add(
      'IATA',
      `airport=${code}`,
      how(r.queryUsed),
      'HTTP 200; expected IATA rank 1-2',
      r.http === 200 && rank != null && rank <= 2 ? 'PASS' : 'BUG',
      `HTTP ${r.http} rank(${want})=${rank || 'MISS'} top=${r.hits.slice(0, 3).map((h) => `${h.airportCode}:${h.city}`).join(' | ')}`,
      { hits: r.hits.slice(0, 5) },
    );
  }

  // --- EDGE special / long ---
  const edges = [
    { q: '!@#$', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: '<script>', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: ';;;;', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: 'zzzzxxx', check: (r) => r.http < 500 && ((r.http >= 400 && r.http < 500) || r.hits.length === 0) },
    { q: 'a'.repeat(200), check: (r) => r.http < 500 },
    { q: 'mumb,', check: (r) => r.http < 500 },
  ];
  for (const t of edges) {
    const r = await call({ airport: t.q });
    add(
      'EDGE',
      `Edge ${JSON.stringify(t.q.length > 40 ? `${t.q.slice(0, 20)}…(${t.q.length})` : t.q)}`,
      how(r.queryUsed),
      'never 500; 4xx or safe empty',
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
    api: `GET ${API}?airport=…&lang=en&currency=INR&page=&perpage=`,
    note: 'Preprod airport search: synonyms, renames, regression, typos. Catalog only, no book.',
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
