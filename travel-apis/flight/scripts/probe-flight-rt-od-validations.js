/**
 * Round-trip search — origin/destination validation matrix on staging.
 * Run: node scripts/probe-flight-rt-od-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', process.env.FLIGHT_RT_OD_OUT || 'flight-rt-od-validations-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function brief(d, n = 450) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function details(r) {
  const d = r?.data?.error?.details ?? r?.data?.details ?? r?.data?.message ?? r?.data?.error?.message;
  if (Array.isArray(d)) return d;
  if (d == null) return [];
  return [String(d)];
}

function baseRt(itinerary) {
  return {
    itinerary,
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const rows = [];

  const add = (id, title, status, note, res, extra = {}) => {
    const row = {
      id,
      title,
      status,
      note,
      http: res?.status ?? null,
      code: errCode(res),
      details: details(res),
      snippet: res ? brief(res.data) : null,
      ...extra,
      at: new Date().toISOString(),
    };
    rows.push(row);
    console.log(`[${status}] ${id} ${title}`);
    console.log(' HTTP', row.http, row.code || '', (row.details[0] || '').toString().slice(0, 140));
  };

  const search = (body) => flight.search(body);

  // Expect validation reject
  async function expectReject(id, title, body, hint) {
    const res = await search(body);
    const text = JSON.stringify(res.data || {}).toLowerCase();
    const hintOk = hint instanceof RegExp ? hint.test(text) : text.includes(String(hint).toLowerCase());
    const rejected = !ok(res) || errCode(res) === 'VALIDATION_ERROR' || res.status === 400
      || res.data?.status === 400;
    if (rejected && (errCode(res) === 'VALIDATION_ERROR' || hintOk || res.status === 400)) {
      add(id, title, 'PASS', 'rejected as expected', res, { itinerary: body.itinerary });
      return;
    }
    if (ok(res)) {
      add(id, title, 'BUG', 'Accepted invalid OD combo (search returned OK)', res, { itinerary: body.itinerary });
      return;
    }
    add(id, title, 'FAIL', `Unexpected reject shape HTTP ${res.status} code=${errCode(res)}`, res, {
      itinerary: body.itinerary,
    });
  }

  async function expectAccept(id, title, body) {
    const res = await search(body);
    if (ok(res) && errCode(res) !== 'VALIDATION_ERROR') {
      add(id, title, 'PASS', 'accepted valid RT OD', res, { itinerary: body.itinerary });
      return;
    }
    add(id, title, 'FAIL', `Valid RT rejected HTTP ${res.status} code=${errCode(res)}`, res, {
      itinerary: body.itinerary,
    });
  }

  const d1 = futureDate(20);
  const d2 = futureDate(27);

  // ===== Valid different OD (classic RT) =====
  await expectAccept('V1', 'Valid RT different cities DEL-BOM / BOM-DEL', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: 'DEL', date: d2 },
  ]));

  await expectAccept('V2', 'Valid RT different cities BOM-BLR / BLR-BOM', baseRt([
    { origin: 'BOM', destination: 'BLR', date: d1 },
    { origin: 'BLR', destination: 'BOM', date: d2 },
  ]));

  // ===== Same origin = destination on a journey =====
  await expectReject('S1', 'Same OD on onward (DEL-DEL / BOM-DEL)', baseRt([
    { origin: 'DEL', destination: 'DEL', date: d1 },
    { origin: 'BOM', destination: 'DEL', date: d2 },
  ]), /origin|destination|same|identical|must not|different/);

  await expectReject('S2', 'Same OD on return (DEL-BOM / BOM-BOM)', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: 'BOM', date: d2 },
  ]), /origin|destination|same|identical|must not|different/);

  await expectReject('S3', 'Same OD on both journeys (DEL-DEL / DEL-DEL)', baseRt([
    { origin: 'DEL', destination: 'DEL', date: d1 },
    { origin: 'DEL', destination: 'DEL', date: d2 },
  ]), /origin|destination|same|identical|must not|different/);

  await expectReject('S4', 'Same OD both journeys BOM-BOM / BOM-BOM', baseRt([
    { origin: 'BOM', destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: 'BOM', date: d2 },
  ]), /origin|destination|same|identical/);

  // ===== Same direction both journeys (not swapped return) =====
  await expectReject('D1', 'Both journeys same direction DEL-BOM / DEL-BOM', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'DEL', destination: 'BOM', date: d2 },
  ]), /return|round|origin|destination|match|swap|must/);

  await expectReject('D2', 'Return not reverse (DEL-BOM / HYD-DEL)', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'HYD', destination: 'DEL', date: d2 },
  ]), /return|round|origin|destination|match/);

  await expectReject('D3', 'Open jaw different cities DEL-BOM / HYD-MAA', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'HYD', destination: 'MAA', date: d2 },
  ]), /return|round|origin|destination|match/);

  await expectReject('D4', 'Return origin != onward destination (DEL-BOM / DEL-DEL)', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'DEL', destination: 'DEL', date: d2 },
  ]), /origin|destination|same|return|match/);

  // ===== Missing / blank / invalid =====
  await expectReject('M1', 'Missing onward origin', baseRt([
    { destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: 'DEL', date: d2 },
  ]), /origin/);

  await expectReject('M2', 'Missing onward destination', baseRt([
    { origin: 'DEL', date: d1 },
    { origin: 'BOM', destination: 'DEL', date: d2 },
  ]), /destination/);

  await expectReject('M3', 'Blank origin onward', baseRt([
    { origin: '', destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: 'DEL', date: d2 },
  ]), /origin/);

  await expectReject('M4', 'Blank destination return', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: '', date: d2 },
  ]), /destination/);

  await expectReject('M5', 'Invalid airport codes XXX-YYY / YYY-XXX', baseRt([
    { origin: 'XXX', destination: 'YYY', date: d1 },
    { origin: 'YYY', destination: 'XXX', date: d2 },
  ]), /origin|destination|airport|invalid|not found|code/);

  // ===== Only one itinerary with ROUND_TRIP =====
  await expectReject('R1', 'ROUND_TRIP with single itinerary leg', {
    ...baseRt([{ origin: 'DEL', destination: 'BOM', date: d1 }]),
  }, /itinerary|round|2|two|return/);

  // ===== THREE legs with ROUND_TRIP =====
  await expectReject('R2', 'ROUND_TRIP with 3 itinerary legs', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'BOM', destination: 'DEL', date: d2 },
    { origin: 'DEL', destination: 'HYD', date: futureDate(30) },
  ]), /itinerary|round|2|two/);

  // ===== Same origin AND destination across journeys meaning identical cities wrongly =====
  // User asked: "add same origin and destination in both journey"
  await expectReject('U1', 'Same origin in both journeys + same dest in both (DEL-BOM / DEL-BOM)', baseRt([
    { origin: 'DEL', destination: 'BOM', date: d1 },
    { origin: 'DEL', destination: 'BOM', date: d2 },
  ]), /origin|destination|return|round|same/);

  // Different: proper swap already in V1/V2
  // Also try case sensitivity / lowercase
  await expectAccept('V3', 'Valid RT lowercase del-bom / bom-del', baseRt([
    { origin: 'del', destination: 'bom', date: d1 },
    { origin: 'bom', destination: 'del', date: d2 },
  ]));

  const summary = {
    baseUrl: config.baseUrl,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      BUG: rows.filter((r) => r.status === 'BUG').length,
      FAIL: rows.filter((r) => r.status === 'FAIL').length,
      total: rows.length,
    },
    bugs: rows.filter((r) => r.status === 'BUG'),
    fails: rows.filter((r) => r.status === 'FAIL'),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log('BUGS:', summary.bugs.map((b) => `${b.id} ${b.title}`));
  console.log('FAILS:', summary.fails.map((b) => `${b.id} ${b.title} — ${b.note}`));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
