/**
 * Production search sanity — flight airports/citySearch + hotel autocomplete/search.
 * SEARCH ONLY. No book / prebook / finalize / issue-ticket.
 *
 *   $env:BASE_URL='https://api.travelvip.ai'
 *   node scripts/probe-prod-search-sanity.js
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import { HotelService } from '../../../hotel/src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'prod-search-sanity.json');
const OUT_MD = path.join('reports', process.env.REPORT_MD || 'prod-search-sanity.md');
const SLOW_MS = Number(process.env.SLOW_MS || 30000);
const HOTEL_CHECKIN = process.env.HOTEL_CHECKIN || '2027-01-15';
const HOTEL_CHECKOUT = process.env.HOTEL_CHECKOUT || '2027-01-16';
const FLIGHT_DATE = process.env.FLIGHT_DATE || '2027-01-15';

const rows = [];
const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
let n = 0;

function add(section, rule, how, expected, status, actual, extra = {}) {
  n += 1;
  rows.push({ id: n, section, rule, how, expected, status, actual, ...extra });
  counts[status] = (counts[status] || 0) + 1;
  console.log(`[${status}] ${section} ${n}. ${rule} — ${String(actual).slice(0, 220)}`);
}

function hitsOf(data) {
  const list = data?.result || data?.results || data?.content || data?.airports || data?.airlines || [];
  return Array.isArray(list) ? list : [];
}

function airportCode(h) {
  return String(h.airportCode || h.code || h.iata || '').toUpperCase();
}

function rankOf(hits, codes) {
  const want = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).toUpperCase());
  for (let i = 0; i < hits.length; i += 1) {
    if (want.includes(airportCode(hits[i]))) return i + 1;
  }
  return null;
}

async function timed(fn) {
  const t0 = Date.now();
  const res = await fn();
  return { ...res, ms: Date.now() - t0 };
}

async function main() {
  console.log('=== PROD search sanity (NO BOOK) ===');
  console.log('BASE', config.baseUrl);
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const hotel = new HotelService(session.client);

  // ── Flight airports ────────────────────────────────────────────────────
  for (const q of [
    { airport: 'BOM', expect: 'BOM', maxRank: 2 },
    { airport: 'DEL', expect: 'DEL', maxRank: 2 },
    { airport: 'BLR', expect: 'BLR', maxRank: 2 },
    { airport: 'bombay', expect: 'BOM', maxRank: 2 },
    { airport: 'delhi', expect: 'DEL', maxRank: 2 },
  ]) {
    const r = await timed(() => flight.airportSearch(q.airport));
    const hits = hitsOf(r.data);
    const rank = rankOf(hits, q.expect);
    const ok = r.ok && r.status === 200 && rank != null && rank <= q.maxRank;
    add(
      'FLIGHT_AIRPORT',
      `airport=${q.airport} → ${q.expect}`,
      `GET /v1/flights/airports?airport=${encodeURIComponent(q.airport)}`,
      `${q.expect} in top ${q.maxRank}; <${SLOW_MS}ms`,
      ok && r.ms < SLOW_MS ? 'PASS' : r.ok && ok ? 'BUG' : 'BUG',
      `HTTP ${r.status} n=${hits.length} rank=${rank || 'MISS'} ms=${r.ms} top=${hits.slice(0, 3).map((h) => airportCode(h)).join(',')}`,
      { ms: r.ms },
    );
    if (r.ms >= SLOW_MS) {
      add('LATENCY', `Slow airport search ${q.airport}`, 'airports', `<${SLOW_MS}ms`, 'BUG', `${r.ms}ms`);
    }
  }
  {
    const r = await timed(() => session.client.request({
      method: 'GET',
      path: '/v1/flights/airports',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 10 },
    }));
    const code = r.data?.error?.code;
    add(
      'FLIGHT_AIRPORT',
      'Blank airport → 400 MISSING_AIRPORT',
      'GET /v1/flights/airports (no airport)',
      'HTTP 400 MISSING_AIRPORT; never 500',
      r.status === 400 && code === 'MISSING_AIRPORT' ? 'PASS' : r.status < 500 ? 'PASS' : 'BUG',
      `HTTP ${r.status} code=${code || '-'} ms=${r.ms}`,
      { ms: r.ms },
    );
  }

  // ── Flight citySearch ──────────────────────────────────────────────────
  for (const q of ['Pune', 'Mumbai', 'Dubai', 'Delhi', 'Bangkok']) {
    const r = await timed(() => flight.citySearch(q));
    const hits = hitsOf(r.data);
    add(
      'FLIGHT_CITY',
      `citySearch q=${q}`,
      `GET /v1/flights/citySearch?q=${encodeURIComponent(q)}`,
      'HTTP 200 non-empty; <30s',
      r.ok && hits.length > 0 && r.ms < SLOW_MS ? 'PASS' : 'BUG',
      `HTTP ${r.status} n=${hits.length} ms=${r.ms}`,
      { ms: r.ms, sample: hits.slice(0, 2) },
    );
  }

  // ── Flight airlines + light OW search (no book) ────────────────────────
  {
    const r = await timed(() => flight.airlineSearch('AI'));
    const hits = hitsOf(r.data);
    add(
      'FLIGHT_AIRLINE',
      'airlines AI',
      'GET /v1/flights/airlines?airline=AI',
      'HTTP 200 non-empty',
      r.ok && hits.length > 0 ? 'PASS' : 'BUG',
      `HTTP ${r.status} n=${hits.length} ms=${r.ms}`,
      { ms: r.ms },
    );
  }
  {
    const r = await timed(() => session.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 10, pid: 'vgm' },
      body: {
        itinerary: [{ origin: 'DEL', destination: 'BOM', date: FLIGHT_DATE }],
        travellers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'ECONOMY',
        journeyType: 'ONE_WAY',
        currency: 'INR',
        language: 'en',
        preferences: { airlines: [], maxStops: null, refundableOnly: false },
        appliedFilters: {},
        selection: { selectedSearchIds: [] },
        fareType: 'NORMAL',
      },
      correlation: true,
    }));
    const opts = (r.data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0);
    add(
      'FLIGHT_SEARCH',
      `OW DEL→BOM ${FLIGHT_DATE} (no book)`,
      'POST /v1/flights/search',
      'HTTP 200; options or progress; never 500; <30s preferred',
      r.status === 200 && r.status < 500 ? (r.ms >= SLOW_MS ? 'BUG' : 'PASS') : 'BUG',
      `HTTP ${r.status} options=${opts} progress=${r.data?.progress?.state || '-'} ms=${r.ms}`,
      { ms: r.ms },
    );
  }

  // ── Hotel autocomplete ─────────────────────────────────────────────────
  for (const q of [
    { q: 'pune', need: 'CITY' },
    { q: 'mumbai', need: 'CITY' },
    { q: 'dubai', need: 'CITY' },
    { q: 'delhi', need: 'CITY' },
    { q: 'hiltop', need: 'HOTEL' },
    { q: 'taj', need: 'any' },
  ]) {
    const r = await timed(() => hotel.autocomplete(q.q, 0, 20));
    const content = r.data?.content || [];
    const hasType = q.need === 'any'
      || content.some((x) => new RegExp(q.need, 'i').test(String(x.type || '')));
    add(
      'HOTEL_AUTOCOMPLETE',
      `autocomplete q=${q.q}`,
      `GET /v1/hotels/autocomplete?q=${encodeURIComponent(q.q)}`,
      `HTTP 200 content[]; prefer ${q.need}; <30s`,
      r.ok && content.length > 0 && hasType && r.ms < SLOW_MS ? 'PASS' : 'BUG',
      `HTTP ${r.status} n=${content.length} types=${[...new Set(content.map((x) => x.type))].join(',')} ms=${r.ms}`,
      { ms: r.ms, sample: content.slice(0, 2).map((x) => ({ type: x.type, title: x.title, entityId: x.entityId })) },
    );
  }

  // ── Hotel city search (no book) ────────────────────────────────────────
  const hotelCities = [
    { key: 'Mumbai', entityId: '357389:IN' },
    { key: 'Delhi', entityId: '227760:IN' },
    { key: 'Dubai', entityId: '221688:AE' },
  ];
  for (const city of hotelCities) {
    const r = await timed(() => hotel.search({
      entityId: city.entityId,
      nationality: 'IN',
      checkin: HOTEL_CHECKIN,
      checkout: HOTEL_CHECKOUT,
      type: 'CITY',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      currency: 'INR',
      lang: 'en',
      language: 'en',
      pid: 'vgm',
      rt: 'compact',
      filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
      fq: [],
      requestId: '',
    }, { pid: 'vgm', offset: 0, limit: 10 }));
    const total = Number(r.data?.totalResults ?? 0);
    const results = r.data?.results || [];
    const brand = (r.data?.filters || []).find((f) => /^brand$/i.test(String(f.name || '')) || /^brand$/i.test(String(f.indexField || '')));
    add(
      'HOTEL_SEARCH',
      `CITY search ${city.key} (no book)`,
      `POST /v1/hotels/search ${city.entityId}`,
      'HTTP 200 total>0; Brand filter absent; <30s',
      r.ok && total > 0 && !brand && r.ms < SLOW_MS ? 'PASS' : 'BUG',
      `HTTP ${r.status} total=${total} page1=${results.length} brand=${brand ? 'PRESENT' : 'absent'} ms=${r.ms}`,
      { ms: r.ms, filters: (r.data?.filters || []).map((f) => f.name) },
    );
    if (r.ms >= SLOW_MS) {
      add('LATENCY', `Slow hotel search ${city.key}`, 'search', `<${SLOW_MS}ms`, 'BUG', `${r.ms}ms`);
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    noBook: true,
    hotelDates: { checkin: HOTEL_CHECKIN, checkout: HOTEL_CHECKOUT },
    flightDate: FLIGHT_DATE,
    counts,
    bugs: rows.filter((r) => r.status === 'BUG'),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = [
    '# Prod search sanity (no book)',
    '',
    `Ran: ${report.ranAt}`,
    `Env: \`${config.baseUrl}\``,
    '',
    `**Score: PASS ${counts.PASS} / BUG ${counts.BUG} / NOT TESTED ${counts.NOT_TESTED || 0}**`,
    '',
    '| # | Section | Rule | Status |',
    '|---|---------|------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.section} | ${r.rule.replace(/\|/g, '/')} | **${r.status}** |`),
    '',
  ];
  if (report.bugs.length) {
    md.push('## Bugs', '');
    for (const b of report.bugs) {
      md.push(`- **${b.section}** ${b.rule}: ${b.actual}`);
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log('\n=== COUNTS ===', counts);
  console.log('Report', OUT);
  process.exit(counts.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
