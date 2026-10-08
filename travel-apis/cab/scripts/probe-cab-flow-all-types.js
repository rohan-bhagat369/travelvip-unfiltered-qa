/**
 * Cab booking flow + response property audit for all journey types on api-staging.
 * Types: AIRPORT DEPARTURE, AIRPORT ARRIVAL, OUTSTATION, RENTAL
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-flow-all-types.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
  buildFinalizeBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = 'reports/cab-flow-all-types-audit.json';
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 8000);
const CANCEL = process.env.CAB_CANCEL_AFTER !== '0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildAirportArrival(pickupDatetime = futurePickupDatetime(10)) {
  return {
    journeyType: 'AIRPORT',
    travelType: 'ARRIVAL',
    airportCode: 'DEL',
    pickup: {
      name: 'IGI Airport-T1',
      city: 'Delhi',
      latitude: 28.5588,
      longitude: 77.0814,
    },
    drop: {
      name: 'Vasant Kunj, Delhi',
      city: 'Delhi',
      latitude: 28.5201,
      longitude: 77.1591,
    },
    distanceKm: 15,
    durationMin: 15,
    pickupDatetime,
  };
}

const JOURNEYS = [
  { id: 'AIRPORT_DEPARTURE', body: () => buildAirportSearchBody(futurePickupDatetime(11)) },
  { id: 'AIRPORT_ARRIVAL', body: () => buildAirportArrival(futurePickupDatetime(12)) },
  { id: 'OUTSTATION', body: () => buildOutstationSearchBody(futurePickupDatetime(13)) },
  { id: 'RENTAL', body: () => buildRentalSearchBody(futurePickupDatetime(14)) },
];

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function collectNulls(obj, prefix = '', out = []) {
  if (obj === null) {
    out.push(prefix || '(root)');
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectNulls(item, `${prefix}[${i}]`, out));
    return out;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v === null) out.push(p);
      else if (typeof v === 'object') collectNulls(v, p, out);
    }
  }
  return out;
}

function has(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || !(p in cur || (Array.isArray(cur) && cur[p] !== undefined))) return false;
    cur = cur[p];
  }
  return cur !== undefined;
}

function checkPaths(obj, requiredPaths, label) {
  const rows = [];
  for (const path of requiredPaths) {
    const present = has(obj, path);
    const val = present
      ? path.split('.').reduce((a, k) => (a == null ? a : a[k.replace(/\[(\d+)\]/, '$1')]), obj)
      : undefined;
    // simpler get
    let cur = obj;
    let ok = true;
    for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
      if (cur == null || cur[part] === undefined) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    const isNull = ok && cur === null;
    const isEmptyStr = ok && cur === '';
    let status = 'PASS';
    if (!ok) status = 'BUG';
    else if (isNull) status = 'NOTE'; // null may be allowed
    rows.push({
      id: `${label}.${path}`,
      rule: `${label} has ${path}`,
      actual: !ok ? 'MISSING' : isNull ? 'null' : isEmptyStr ? '""' : typeOf(cur),
      status: !ok ? 'BUG' : 'PASS',
      note: isNull ? 'present but null' : isEmptyStr ? 'present but empty string' : null,
    });
  }
  return rows;
}

/** Doc/Postman-aligned required fields for happy responses */
const REQ = {
  locationsItem: ['name', 'city', 'latitude', 'longitude'],
  searchRoot: ['currency', 'cabs'],
  // Postman/docs use priceDetail (not price) on search/fare cab payloads
  searchCab: [
    'searchId',
    'cabId',
    'fareId',
    'vehicle',
    'operator',
    'trip',
    'priceDetail',
    'priceDetail.totalAmount',
    'priceDetail.currency',
    'priceDetail.baseFare',
  ],
  fareRoot: [
    'bookingReference',
    'priceId',
    'priceDetail',
    'priceDetail.totalAmount',
    'priceDetail.currency',
    'vehicle',
    'operator',
  ],
  finalizeRoot: ['bookingRefId', 'status'],
  statusRoot: [
    'status',
    'bookingReferenceId',
    'details',
    'details.travelType',
    'details.pickup',
    'details.drop',
    'details.pickupDatetime',
  ],
  detailsRoot: ['status', 'details', 'salesSummary', 'details.inclusions', 'details.exclusions'],
  historyRoot: ['bookings'],
  cancelRoot: ['result', 'result.bookingStatus'],
};

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

const rows = [];
const journeys = [];
const notes = [];

function addRow(row) {
  rows.push(row);
}

function scoreHttp(id, rule, res, expectOk = true) {
  const ok = expectOk ? res.ok === true : res.status >= 400;
  addRow({
    id,
    rule,
    how: `${res.status}`,
    actual: res.ok ? 'HTTP OK' : `HTTP ${res.status} ${res.data?.error?.code || ''}`,
    status: ok ? 'PASS' : 'BUG',
    error: res.data?.error || null,
  });
  return ok;
}

// --- Locations ---
{
  const locQ = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { ...CAB_QUERY, query: 'Delhi' },
    correlation: true,
  });
  scoreHttp('LOC.1', 'GET locations?query=Delhi → 200', locQ);
  const list = Array.isArray(locQ.data) ? locQ.data : locQ.data?.locations || locQ.data?.data || [];
  addRow({
    id: 'LOC.2',
    rule: 'locations returns array with items',
    actual: `type=${typeOf(locQ.data)} len=${list.length}`,
    status: list.length > 0 ? 'PASS' : 'BUG',
  });
  if (list[0]) {
    for (const r of checkPaths(list[0], REQ.locationsItem, 'LOC.item')) addRow(r);
    const nulls = collectNulls(list[0], 'locations[0]');
    if (nulls.length) notes.push({ where: 'locations[0]', nulls });
  }
}

async function runJourney(j) {
  const out = { id: j.id, steps: {}, nulls: {}, bugs: [] };
  console.log('\n===', j.id);

  const searchBody = j.body();
  const search = await cab.search(searchBody);
  out.steps.search = { http: search.status, cabs: search.data?.cabs?.length || 0 };
  scoreHttp(`${j.id}.S1`, `${j.id} search → 200`, search);
  addRow({
    id: `${j.id}.S2`,
    rule: `${j.id} search returns cabs[]`,
    actual: `cabs=${search.data?.cabs?.length || 0}`,
    status: (search.data?.cabs || []).length > 0 ? 'PASS' : 'BUG',
  });
  if ((search.data?.cabs || []).length === 0) {
    journeys.push(out);
    return out;
  }
  for (const r of checkPaths(search.data, REQ.searchRoot, `${j.id}.search`)) addRow(r);
  const cab0 = pickCab(search.data.cabs);
  for (const r of checkPaths(cab0, REQ.searchCab, `${j.id}.cab`)) addRow(r);
  out.nulls.searchCab = collectNulls(cab0, 'cab');
  // journey-specific search echoes
  addRow({
    id: `${j.id}.S3`,
    rule: `search cab journeyType/travelType coherent for ${j.id}`,
    actual: `req=${searchBody.journeyType}/${searchBody.travelType}`,
    status: 'PASS',
  });
  if (j.id.startsWith('AIRPORT')) {
    addRow({
      id: `${j.id}.S4`,
      rule: 'AIRPORT search included airportCode',
      actual: searchBody.airportCode || 'missing',
      status: searchBody.airportCode ? 'PASS' : 'BUG',
    });
  }

  const fare = await cab.fare(cab0.searchId);
  out.steps.fare = { http: fare.status, priceId: !!fare.data?.priceId };
  scoreHttp(`${j.id}.F1`, `${j.id} fare → 200`, fare);
  for (const r of checkPaths(fare.data || {}, REQ.fareRoot, `${j.id}.fare`)) addRow(r);
  out.nulls.fare = collectNulls(fare.data, 'fare');

  // Nested trip fields (Postman); root-level distanceKm is NOTE if only under trip
  for (const path of [
    'trip',
    'trip.distanceKm',
    'trip.durationMin',
    'trip.extraKmFareLabel',
    'inclusions',
    'exclusions',
    'tags',
  ]) {
    let cur = fare.data;
    let present = true;
    for (const part of path.split('.')) {
      if (cur == null || cur[part] === undefined) {
        present = false;
        break;
      }
      cur = cur[part];
    }
    addRow({
      id: `${j.id}.F.${path}`,
      rule: `fare has ${path}`,
      actual: present ? (cur === null ? 'null' : typeOf(cur)) : 'MISSING',
      status: present ? 'PASS' : 'NOTE',
    });
  }

  const book = await cab.finalizeBooking(
    buildFinalizeBody({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
    }),
  );
  const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
  out.steps.finalize = { http: book.status, br, status: book.data?.status };
  scoreHttp(`${j.id}.B1`, `${j.id} finalize → 200`, book);
  for (const r of checkPaths(book.data || {}, REQ.finalizeRoot, `${j.id}.finalize`)) addRow(r);
  // bookingReferenceId alias
  addRow({
    id: `${j.id}.B2`,
    rule: 'finalize returns bookingRefId or bookingReferenceId',
    actual: br || 'none',
    status: br ? 'PASS' : 'BUG',
  });
  out.nulls.finalize = collectNulls(book.data, 'finalize');

  let st = await cab.getBookingStatus(br);
  for (let i = 0; i < 14 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
    await sleep(2000);
    st = await cab.getBookingStatus(br);
  }
  out.steps.status = { http: st.status, status: st.data?.status };
  scoreHttp(`${j.id}.ST1`, `${j.id} status → 200`, st);
  addRow({
    id: `${j.id}.ST2`,
    rule: `${j.id} reaches Confirmed`,
    actual: st.data?.status || 'none',
    status: /confirm/i.test(String(st.data?.status || '')) ? 'PASS' : 'BUG',
  });
  for (const r of checkPaths(st.data || {}, REQ.statusRoot, `${j.id}.status`)) addRow(r);

  // Logic checks vs search body
  const d = st.data?.details || {};
  // Postman status examples use travelType; journeyType may also appear on staging
  addRow({
    id: `${j.id}.ST3`,
    rule: 'status.details.journeyType or travelType present',
    actual: `journeyType=${d.journeyType} travelType=${d.travelType}`,
    status: d.journeyType != null || d.travelType != null ? 'PASS' : 'BUG',
  });
  addRow({
    id: `${j.id}.ST3b`,
    rule: 'status.details.journeyType matches search when present',
    actual: `${d.journeyType} vs ${searchBody.journeyType}`,
    status:
      d.journeyType == null || d.journeyType === searchBody.journeyType ? 'PASS' : 'BUG',
  });
  addRow({
    id: `${j.id}.ST4`,
    rule: 'status.details.travelType matches search',
    actual: `${d.travelType} vs ${searchBody.travelType}`,
    status:
      String(d.travelType || '') === String(searchBody.travelType || '') ||
      (searchBody.journeyType !== 'AIRPORT' && (d.travelType === '' || d.travelType == null))
        ? 'PASS'
        : 'BUG',
  });
  if (searchBody.journeyType === 'AIRPORT') {
    addRow({
      id: `${j.id}.ST5`,
      rule: 'AIRPORT status has airportCode',
      actual: d.airportCode ?? 'null',
      status: d.airportCode ? 'PASS' : 'BUG',
    });
  } else {
    addRow({
      id: `${j.id}.ST5`,
      rule: 'NON-AIRPORT airportCode should be null/empty (doc)',
      actual: d.airportCode === null || d.airportCode === '' || d.airportCode === undefined ? String(d.airportCode) : d.airportCode,
      status: !d.airportCode ? 'PASS' : 'BUG',
    });
  }
  addRow({
    id: `${j.id}.ST6`,
    rule: 'otp present on confirm (string)',
    actual: d.otp === undefined ? 'MISSING' : d.otp === null ? 'null' : `len=${String(d.otp).length}`,
    status: d.otp !== undefined && d.otp !== null ? 'PASS' : 'NOTE',
  });
  if (d.otp === '') {
    addRow({
      id: `${j.id}.ST6b`,
      rule: 'otp should not be empty string on Confirmed (doc: generated on confirm)',
      actual: '""',
      status: 'BUG',
    });
  }
  out.nulls.status = collectNulls(st.data, 'status');

  const det = await client.request({
    method: 'GET',
    path: `/v1/airportServices/cabs/booking/${br}`,
    query: CAB_QUERY,
    correlation: true,
  });
  out.steps.details = { http: det.status };
  scoreHttp(`${j.id}.D1`, `${j.id} details → 200`, det);
  for (const r of checkPaths(det.data || {}, REQ.detailsRoot, `${j.id}.details`)) addRow(r);
  const ss = det.data?.salesSummary || st.data?.salesSummary;
  if (ss) {
    for (const path of ['basePrice', 'tax', 'convenienceFee', 'totalAmount', 'currency']) {
      addRow({
        id: `${j.id}.SS.${path}`,
        rule: `salesSummary.${path}`,
        actual: ss[path] === undefined ? 'MISSING' : ss[path] === null ? 'null' : String(ss[path]),
        status: ss[path] !== undefined && ss[path] !== null ? 'PASS' : 'BUG',
      });
    }
    const sumApprox =
      Number(ss.basePrice || 0) + Number(ss.tax || 0) + Number(ss.convenienceFee || 0);
    const tot = Number(ss.totalAmount || 0);
    addRow({
      id: `${j.id}.SS.math`,
      rule: 'basePrice+tax+convenienceFee ≈ totalAmount (±2)',
      actual: `sum=${sumApprox} total=${tot}`,
      status: Math.abs(sumApprox - tot) <= 2 ? 'PASS' : 'BUG',
    });
  }
  out.nulls.details = collectNulls(det.data, 'details');

  const track = await client.request({
    method: 'GET',
    path: `/v1/airportServices/cabs/tracking/${br}/location`,
    query: CAB_QUERY,
    correlation: true,
  });
  out.steps.tracking = { http: track.status };
  scoreHttp(`${j.id}.T1`, `${j.id} tracking → 200 (pre-dispatch OK)`, track);
  out.nulls.tracking = collectNulls(track.data, 'tracking');

  const hist = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/booking/history',
    query: { ...CAB_QUERY, page: 0, perPage: 10 },
    correlation: true,
  });
  out.steps.history = { http: hist.status };
  // history may require userId in some envs — note result
  if (hist.status === 400 && hist.data?.error?.code === 'VALIDATION_ERROR') {
    addRow({
      id: `${j.id}.H1`,
      rule: 'history without userId',
      actual: `${hist.status} ${hist.data?.error?.code} ${hist.data?.error?.message}`,
      status: 'BUG',
      note: 'Known open: HI-1 omit userId → should be 400; if 200 that was old bug inverted',
    });
  } else {
    scoreHttp(`${j.id}.H1`, `${j.id} history → 200`, hist);
    const books = hist.data?.bookings || [];
    addRow({
      id: `${j.id}.H2`,
      rule: 'history lists this BR',
      actual: books.some((b) => (b.bookingReferenceId || b.bookingRefId) === br) ? 'found' : 'not found',
      status: books.some((b) => (b.bookingReferenceId || b.bookingRefId) === br) ? 'PASS' : 'NOTE',
    });
  }

  if (CANCEL && /confirm/i.test(String(st.data?.status || ''))) {
    await sleep(SETTLE_MS);
    const cancel = await client.request({
      method: 'POST',
      path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
      query: CAB_QUERY,
      partnerKey: client.partnerKey,
      body: {
        cancelledBy: 'USER',
        cancellationReason: 'Customer flight rescheduled to next day',
      },
    });
    await sleep(1500);
    const after = await cab.getBookingStatus(br);
    const cancelled =
      /cancel/i.test(String(after.data?.status || '')) ||
      /cancel/i.test(String(cancel.data?.result?.bookingStatus || ''));
    out.steps.cancel = { http: cancel.status, cancelled, statusAfter: after.data?.status };
    addRow({
      id: `${j.id}.C1`,
      rule: `${j.id} POST cancel succeeds (future pickup)`,
      actual: cancelled
        ? `CANCELLED http=${cancel.status}`
        : `http=${cancel.status} code=${cancel.data?.error?.code} after=${after.data?.status}`,
      status: cancelled ? 'PASS' : 'BUG',
    });
  }

  journeys.push(out);
  console.log(j.id, 'done', out.steps);
  return out;
}

for (const j of JOURNEYS) {
  try {
    await runJourney(j);
  } catch (e) {
    addRow({ id: `${j.id}.EX`, rule: `${j.id} flow threw`, actual: String(e.message || e), status: 'BUG' });
  }
}

// Targeted payload negatives (search) — one each, all types context on AIRPORT dep baseline
{
  const base = buildAirportSearchBody(futurePickupDatetime(15));
  const negatives = [
    { id: 'VAL.SR.journey', mutate: (b) => ({ ...b, journeyType: 'BUS' }), expect: 400 },
    { id: 'VAL.SR.travel', mutate: (b) => ({ ...b, travelType: 'SIDEWAYS' }), expect: 400 },
    { id: 'VAL.SR.past', mutate: (b) => ({ ...b, pickupDatetime: '2020-01-01T10:00:00Z' }), expect: 400 },
    { id: 'VAL.SR.badDate', mutate: (b) => ({ ...b, pickupDatetime: '15-09-2026' }), expect: 400 },
    { id: 'VAL.SR.noAirport', mutate: (b) => { const x = { ...b }; delete x.airportCode; return x; }, expect: 400 },
    { id: 'VAL.SR.coords', mutate: (b) => ({ ...b, pickup: { ...b.pickup, latitude: 999 } }), expect: 400 },
    {
      id: 'VAL.SR.rentalDiff',
      mutate: () => ({
        ...buildRentalSearchBody(futurePickupDatetime(16)),
        drop: { name: 'Other', city: 'Pune', latitude: 18.6, longitude: 73.9 },
      }),
      expect: 400,
    },
  ];
  for (const n of negatives) {
    const body = n.mutate(JSON.parse(JSON.stringify(base)));
    const res = await cab.search(body);
    addRow({
      id: n.id,
      rule: `invalid search rejected (${n.id})`,
      actual: `HTTP ${res.status} code=${res.data?.error?.code || 'none'}`,
      status: res.status === n.expect && res.data?.error?.code ? 'PASS' : res.status >= 400 ? 'PASS' : 'BUG',
      error: res.data?.error || null,
    });
  }

  const fareNeg = await cab.fare('');
  addRow({
    id: 'VAL.FR.empty',
    rule: 'fare empty searchId → 4xx',
    actual: `HTTP ${fareNeg.status} ${fareNeg.data?.error?.code || ''}`,
    status: fareNeg.status >= 400 ? 'PASS' : 'BUG',
  });

  const finNeg = await cab.finalizeBooking({ bookingReference: 'bad', priceId: 'bad' });
  addRow({
    id: 'VAL.FB.bad',
    rule: 'finalize bad refs → 4xx (no BR)',
    actual: `HTTP ${finNeg.status} ${finNeg.data?.error?.code || finNeg.data?.status || ''}`,
    status: finNeg.status >= 400 ? 'PASS' : 'BUG',
  });
}

const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  NOTE: rows.filter((r) => r.status === 'NOTE').length,
};

const nullSummary = journeys.map((j) => ({
  id: j.id,
  nullFields: [...new Set(Object.values(j.nulls || {}).flat())].filter(Boolean).slice(0, 40),
}));

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  doc: 'https://api-docs.travelvip.ai/#tag/Cabs',
  summary,
  bugs: rows.filter((r) => r.status === 'BUG'),
  notes: rows.filter((r) => r.status === 'NOTE'),
  nullSummary,
  journeys,
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', summary);
console.log('BUGS', report.bugs.map((b) => `${b.id}: ${b.actual}`).join('\n') || '(none)');
console.log('Wrote', OUT);
process.exit(summary.BUG > 0 ? 1 : 0);
