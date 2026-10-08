/**
 * Exhaustive cab property matrix — positive + negative per request field,
 * plus response schema checks against Postman property trees.
 *
 * Covers: locations, places, search (×4 journey types), fare, finalize,
 * update-booking, status/details/tracking/history path params, cancel body,
 * and happy-path response properties per type.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-property-matrix.js
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
import { config } from '../../../shared/config/env.js';

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = 'reports/cab-property-matrix.json';
const TREES = JSON.parse(fs.readFileSync('reports/cab-response-property-trees.json', 'utf8'));
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 8000);
const CANCEL = process.env.CAB_CANCEL_AFTER !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

const rows = [];
const summary = { PASS: 0, BUG: 0, NOTE: 0, 'NOT TESTED': 0 };

function add(row) {
  rows.push(row);
  summary[row.status] = (summary[row.status] || 0) + 1;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function getPath(obj, path) {
  const parts = path.replace(/\[\]/g, '.0').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = path.split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function delPath(obj, path) {
  const parts = path.split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || cur[parts[i]] == null) return obj;
    cur = cur[parts[i]];
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  return obj;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function expectReject(res) {
  const code = res.data?.error?.code || null;
  const http = res.status;
  // Accept any 4xx with error.code; 5xx = BUG; 2xx accept = BUG for negatives
  if (http >= 500) return { ok: false, reason: `HTTP ${http} (never 500)` };
  if (http >= 400 && code) return { ok: true, reason: `HTTP ${http} ${code}` };
  if (http >= 400) return { ok: true, reason: `HTTP ${http}` };
  return { ok: false, reason: `accepted HTTP ${http} code=${code || 'none'}` };
}

function expectAccept(res) {
  if (res.ok || res.status === 200) return { ok: true, reason: `HTTP ${res.status}` };
  return {
    ok: false,
    reason: `HTTP ${res.status} ${res.data?.error?.code || ''} ${res.data?.error?.message || ''}`.trim(),
  };
}

function scoreNeg(id, rule, res, payloadSnippet) {
  const r = expectReject(res);
  add({
    id,
    section: id.split('.')[0],
    kind: 'NEG',
    rule,
    status: r.ok ? 'PASS' : 'BUG',
    actual: r.reason,
    http: res.status,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || null,
    payload: payloadSnippet,
  });
}

function scorePos(id, rule, res, extra = {}) {
  const r = expectAccept(res);
  add({
    id,
    section: id.split('.')[0],
    kind: 'POS',
    rule,
    status: r.ok ? 'PASS' : 'BUG',
    actual: r.reason,
    http: res.status,
    code: res.data?.error?.code || null,
    ...extra,
  });
}

function treePaths(epKey) {
  const entry = TREES[epKey];
  if (!entry) return [];
  const resp = Array.isArray(entry) ? entry[0]?.responses?.[0] : entry.responses?.[0];
  const tree = resp?.tree || {};
  return Object.keys(tree).filter((k) => k !== '(root)' && !k.endsWith('[]'));
}

function scoreResponseSchema(label, obj, paths, { optionalNull = true } = {}) {
  for (const raw of paths) {
    // Map cabs[].x → first cab x
    const path = raw.replace(/^cabs\[\]\./, '').replace(/^locations\[\]\./, '').replace(/^bookings\[\]\./, '');
    const root = raw.startsWith('cabs[].')
      ? obj?.cabs?.[0]
      : raw.startsWith('locations[].')
        ? obj?.locations?.[0]
        : raw.startsWith('bookings[].')
          ? obj?.bookings?.[0]
          : obj;
    if (raw === 'cabs' || raw === 'locations' || raw === 'bookings') {
      const v = obj?.[raw];
      add({
        id: `${label}.RESP.${raw}`,
        section: label,
        kind: 'RESP',
        rule: `response has ${raw}`,
        status: Array.isArray(v) ? 'PASS' : 'BUG',
        actual: typeOf(v),
      });
      continue;
    }
    if (raw.startsWith('cabs[].') || raw.startsWith('locations[].') || raw.startsWith('bookings[].')) {
      if (!root) {
        add({
          id: `${label}.RESP.${raw}`,
          section: label,
          kind: 'RESP',
          rule: `response has ${raw}`,
          status: 'NOTE',
          actual: 'no array item',
        });
        continue;
      }
    }
    const v = getPath(root, path);
    if (v === undefined) {
      // optional-ish: many nullables / pre-dispatch
      const soft =
        /makeYear|cancellationRule|imageApp|imageMobile|assignment|trip\.|otp|trackingUrl|syncedAt|address|extraKmRate|currencyConversion/.test(
          raw,
        );
      add({
        id: `${label}.RESP.${raw}`,
        section: label,
        kind: 'RESP',
        rule: `response has ${raw}`,
        status: soft ? 'NOTE' : 'BUG',
        actual: 'MISSING',
      });
    } else if (v === null && optionalNull) {
      add({
        id: `${label}.RESP.${raw}`,
        section: label,
        kind: 'RESP',
        rule: `response has ${raw}`,
        status: 'NOTE',
        actual: 'null',
      });
    } else {
      add({
        id: `${label}.RESP.${raw}`,
        section: label,
        kind: 'RESP',
        rule: `response has ${raw}`,
        status: 'PASS',
        actual: typeOf(v),
      });
    }
  }
}

function airportArrival(dt = futurePickupDatetime(30)) {
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
    pickupDatetime: dt,
  };
}

const JOURNEYS = [
  { id: 'AIRPORT_DEPARTURE', body: (d) => buildAirportSearchBody(d) },
  { id: 'AIRPORT_ARRIVAL', body: (d) => airportArrival(d) },
  { id: 'OUTSTATION', body: (d) => buildOutstationSearchBody(d) },
  { id: 'RENTAL', body: (d) => buildRentalSearchBody(d) },
];

// ---------- LOCATIONS ----------
console.log('\n=== LOCATIONS ===');
{
  const posQ = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { ...CAB_QUERY, query: 'Delhi' },
    correlation: true,
  });
  scorePos('LOC.POS.query', 'locations with query=Delhi', posQ);
  scoreResponseSchema('LOC', posQ.data, treePaths('locations'));

  const posXY = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { ...CAB_QUERY, latitude: 28.52, longitude: 77.15 },
    correlation: true,
  });
  scorePos('LOC.POS.latlong', 'locations with lat+long', posXY);

  const negs = [
    { id: 'LOC.NEG.none', q: { ...CAB_QUERY }, rule: 'omit query and lat/long' },
    { id: 'LOC.NEG.latOnly', q: { ...CAB_QUERY, latitude: 28.5 }, rule: 'latitude without longitude' },
    { id: 'LOC.NEG.longOnly', q: { ...CAB_QUERY, longitude: 77.1 }, rule: 'longitude without latitude' },
    { id: 'LOC.NEG.latStr', q: { ...CAB_QUERY, latitude: 'abc', longitude: 77.1 }, rule: 'non-numeric latitude' },
    { id: 'LOC.NEG.latRange', q: { ...CAB_QUERY, latitude: 999, longitude: 77.1 }, rule: 'latitude out of range' },
    { id: 'LOC.NEG.longRange', q: { ...CAB_QUERY, latitude: 28.5, longitude: 999 }, rule: 'longitude out of range' },
    { id: 'LOC.NEG.airportOnly', q: { ...CAB_QUERY, airportCode: 'DEL' }, rule: 'airportCode alone' },
    { id: 'LOC.NEG.queryComma', q: { ...CAB_QUERY, query: 'Delhi,' }, rule: 'query trailing comma → 4xx never 500' },
    { id: 'LOC.NEG.queryHtml', q: { ...CAB_QUERY, query: '<script>' }, rule: 'query HTML → 4xx never 500' },
  ];
  for (const n of negs) {
    const res = await client.request({
      method: 'GET',
      path: '/v1/airportServices/cabs/locations',
      query: n.q,
      correlation: true,
    });
    scoreNeg(n.id, n.rule, res, n.q);
  }
}

// ---------- PLACES ----------
console.log('\n=== PLACES ===');
{
  const pos = await client.request({
    method: 'GET',
    path: '/v1/airportServices/cabs/places/autocomplete',
    query: { ...CAB_QUERY, searchText: 'Pune' },
    correlation: true,
  });
  scorePos('PLC.POS.searchText', 'places searchText=Pune', pos);

  for (const n of [
    { id: 'PLC.NEG.omit', q: { ...CAB_QUERY }, rule: 'omit searchText' },
    { id: 'PLC.NEG.empty', q: { ...CAB_QUERY, searchText: '' }, rule: 'empty searchText' },
    { id: 'PLC.NEG.comma', q: { ...CAB_QUERY, searchText: 'Pune,' }, rule: 'searchText trailing comma' },
    { id: 'PLC.NEG.html', q: { ...CAB_QUERY, searchText: '<script>' }, rule: 'searchText HTML' },
  ]) {
    const res = await client.request({
      method: 'GET',
      path: '/v1/airportServices/cabs/places/autocomplete',
      query: n.q,
      correlation: true,
    });
    scoreNeg(n.id, n.rule, res, n.q);
  }
}

// ---------- SEARCH property matrix per type ----------
function searchFieldCases(typeId, base) {
  const cases = [];
  const strNeg = (path, label) => [
    { id: `${typeId}.SR.NEG.${path}.omit`, rule: `omit ${label}`, mutate: (b) => delPath(b, path) },
    { id: `${typeId}.SR.NEG.${path}.empty`, rule: `empty ${label}`, mutate: (b) => setPath(b, path, '') },
    { id: `${typeId}.SR.NEG.${path}.comma`, rule: `${label} trailing comma`, mutate: (b) => setPath(b, path, `${getPath(base, path)},`) },
    { id: `${typeId}.SR.NEG.${path}.html`, rule: `${label} HTML`, mutate: (b) => setPath(b, path, '<script>') },
    { id: `${typeId}.SR.NEG.${path}.punct`, rule: `${label} punctuation`, mutate: (b) => setPath(b, path, '!@#$') },
  ];
  const numNeg = (path, label) => [
    { id: `${typeId}.SR.NEG.${path}.omit`, rule: `omit ${label}`, mutate: (b) => delPath(b, path) },
    { id: `${typeId}.SR.NEG.${path}.neg`, rule: `${label} negative`, mutate: (b) => setPath(b, path, -1) },
    { id: `${typeId}.SR.NEG.${path}.str`, rule: `${label} as string`, mutate: (b) => setPath(b, path, 'abc') },
    { id: `${typeId}.SR.NEG.${path}.null`, rule: `${label} null`, mutate: (b) => setPath(b, path, null) },
  ];

  cases.push({
    id: `${typeId}.SR.POS.baseline`,
    kind: 'POS',
    rule: `${typeId} search baseline`,
    mutate: (b) => b,
  });

  cases.push(
    { id: `${typeId}.SR.NEG.journeyType.omit`, rule: 'omit journeyType', mutate: (b) => delPath(b, 'journeyType') },
    { id: `${typeId}.SR.NEG.journeyType.bad`, rule: 'journeyType=BUS', mutate: (b) => setPath(b, 'journeyType', 'BUS') },
    { id: `${typeId}.SR.NEG.journeyType.comma`, rule: 'journeyType comma', mutate: (b) => setPath(b, 'journeyType', 'AIRPORT,') },
    { id: `${typeId}.SR.NEG.journeyType.html`, rule: 'journeyType HTML', mutate: (b) => setPath(b, 'journeyType', '<script>') },
    { id: `${typeId}.SR.NEG.travelType.omit`, rule: 'omit travelType', mutate: (b) => delPath(b, 'travelType') },
    { id: `${typeId}.SR.NEG.travelType.bad`, rule: 'travelType=SIDEWAYS', mutate: (b) => setPath(b, 'travelType', 'SIDEWAYS') },
    { id: `${typeId}.SR.NEG.travelType.comma`, rule: 'travelType comma', mutate: (b) => setPath(b, 'travelType', 'DEPARTURE,') },
  );

  if (base.journeyType === 'AIRPORT') {
    cases.push(
      { id: `${typeId}.SR.NEG.airportCode.omit`, rule: 'omit airportCode', mutate: (b) => delPath(b, 'airportCode') },
      { id: `${typeId}.SR.NEG.airportCode.empty`, rule: 'empty airportCode', mutate: (b) => setPath(b, 'airportCode', '') },
      { id: `${typeId}.SR.NEG.airportCode.comma`, rule: 'airportCode comma', mutate: (b) => setPath(b, 'airportCode', 'DEL,') },
      { id: `${typeId}.SR.NEG.airportCode.html`, rule: 'airportCode HTML', mutate: (b) => setPath(b, 'airportCode', '<x>') },
    );
  } else {
    // ARRIVAL travelType on non-airport may be invalid
    cases.push({
      id: `${typeId}.SR.NEG.travelType.arrival`,
      rule: 'travelType=ARRIVAL on non-AIRPORT',
      mutate: (b) => setPath(b, 'travelType', 'ARRIVAL'),
    });
  }

  for (const side of ['pickup', 'drop']) {
    cases.push({
      id: `${typeId}.SR.NEG.${side}.omit`,
      rule: `omit ${side}`,
      mutate: (b) => delPath(b, side),
    });
    cases.push({
      id: `${typeId}.SR.NEG.${side}.null`,
      rule: `${side} null`,
      mutate: (b) => setPath(b, side, null),
    });
    cases.push({
      id: `${typeId}.SR.NEG.${side}.emptyObj`,
      rule: `${side} empty object`,
      mutate: (b) => setPath(b, side, {}),
    });
    cases.push(...strNeg(`${side}.name`, `${side}.name`));
    cases.push(...strNeg(`${side}.city`, `${side}.city`));
    cases.push(...numNeg(`${side}.latitude`, `${side}.latitude`).filter((c) => !c.id.endsWith('.neg')));
    cases.push({
      id: `${typeId}.SR.NEG.${side}.latitude.range`,
      rule: `${side}.latitude out of range`,
      mutate: (b) => setPath(b, `${side}.latitude`, 999),
    });
    cases.push(...numNeg(`${side}.longitude`, `${side}.longitude`).filter((c) => !c.id.endsWith('.neg')));
    cases.push({
      id: `${typeId}.SR.NEG.${side}.longitude.range`,
      rule: `${side}.longitude out of range`,
      mutate: (b) => setPath(b, `${side}.longitude`, 999),
    });
  }

  cases.push(...numNeg('distanceKm', 'distanceKm'));
  cases.push(...numNeg('durationMin', 'durationMin'));

  cases.push(
    { id: `${typeId}.SR.NEG.pickupDatetime.omit`, rule: 'omit pickupDatetime', mutate: (b) => delPath(b, 'pickupDatetime') },
    { id: `${typeId}.SR.NEG.pickupDatetime.empty`, rule: 'empty pickupDatetime', mutate: (b) => setPath(b, 'pickupDatetime', '') },
    { id: `${typeId}.SR.NEG.pickupDatetime.badFmt`, rule: 'pickupDatetime DD-MM-YYYY', mutate: (b) => setPath(b, 'pickupDatetime', '15-09-2026') },
    { id: `${typeId}.SR.NEG.pickupDatetime.slash`, rule: 'pickupDatetime slashes', mutate: (b) => setPath(b, 'pickupDatetime', '2026/09/15T10:00:00Z') },
    { id: `${typeId}.SR.NEG.pickupDatetime.past`, rule: 'pickupDatetime past', mutate: (b) => setPath(b, 'pickupDatetime', '2020-01-01T10:00:00Z') },
    { id: `${typeId}.SR.NEG.pickupDatetime.far`, rule: 'pickupDatetime >3 months', mutate: (b) => setPath(b, 'pickupDatetime', '2027-12-01T10:00:00Z') },
    { id: `${typeId}.SR.NEG.pickupDatetime.comma`, rule: 'pickupDatetime comma', mutate: (b) => setPath(b, 'pickupDatetime', `${base.pickupDatetime},`) },
  );

  if (base.journeyType === 'RENTAL') {
    cases.push({
      id: `${typeId}.SR.NEG.rentalDiff`,
      rule: 'RENTAL pickup≠drop',
      mutate: (b) => {
        setPath(b, 'drop.name', 'Different Place');
        setPath(b, 'drop.latitude', 18.6);
        setPath(b, 'drop.longitude', 73.95);
        return b;
      },
    });
  }

  return cases;
}

let day = 31;
for (const j of JOURNEYS) {
  console.log('\n=== SEARCH', j.id, '===');
  const base = j.body(futurePickupDatetime(day++));
  const cases = searchFieldCases(j.id, base);
  for (const c of cases) {
    const body = c.mutate(clone(base));
    const res = await cab.search(body);
    if (c.kind === 'POS' || c.id.includes('.POS.')) {
      scorePos(c.id, c.rule, res, { cabs: res.data?.cabs?.length || 0 });
      if (res.ok && (res.data?.cabs || []).length) {
        scoreResponseSchema(`${j.id}.SEARCH`, res.data, treePaths('search'));
      }
    } else {
      scoreNeg(c.id, c.rule, res, { path: c.id, journeyType: body.journeyType });
    }
  }
}

// ---------- FARE ----------
console.log('\n=== FARE ===');
{
  const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(day++)));
  const c0 = pickCab(search.data?.cabs || []);
  if (!c0?.searchId) {
    add({ id: 'FR.SETUP', rule: 'fare setup search', status: 'NOT TESTED', actual: 'no cabs' });
  } else {
    const pos = await cab.fare(c0.searchId);
    scorePos('FR.POS.searchId', 'fare with valid searchId', pos);
    if (pos.ok) scoreResponseSchema('FR', pos.data, treePaths('fare'));

    const negs = [
      { id: 'FR.NEG.omit', body: {}, rule: 'omit searchId' },
      { id: 'FR.NEG.empty', body: { searchId: '' }, rule: 'empty searchId' },
      { id: 'FR.NEG.space', body: { searchId: ' ' }, rule: 'whitespace searchId' },
      { id: 'FR.NEG.bad', body: { searchId: 'NOT_A_REAL_SEARCH_ID' }, rule: 'invalid searchId' },
      { id: 'FR.NEG.comma', body: { searchId: `${c0.searchId},` }, rule: 'searchId trailing comma' },
      { id: 'FR.NEG.html', body: { searchId: '<script>' }, rule: 'searchId HTML' },
      { id: 'FR.NEG.punct', body: { searchId: '!@#$' }, rule: 'searchId punctuation' },
      { id: 'FR.NEG.null', body: { searchId: null }, rule: 'searchId null' },
      { id: 'FR.NEG.num', body: { searchId: 12345 }, rule: 'searchId number' },
    ];
    for (const n of negs) {
      const res = await client.request({
        method: 'POST',
        path: '/v1/airportServices/cabs/fare',
        query: CAB_QUERY,
        body: n.body,
        correlation: true,
      });
      scoreNeg(n.id, n.rule, res, n.body);
    }
  }
}

// ---------- FINALIZE property matrix (one priced session) ----------
console.log('\n=== FINALIZE ===');
{
  const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(day++)));
  const c0 = pickCab(search.data?.cabs || []);
  const fare = c0 ? await cab.fare(c0.searchId) : null;
  const br = fare?.data?.bookingReference;
  const priceId = fare?.data?.priceId;
  if (!br || !priceId) {
    add({ id: 'FB.SETUP', rule: 'finalize setup', status: 'NOT TESTED', actual: 'no fare' });
  } else {
    const baseline = buildFinalizeBody({ bookingReference: br, priceId });

    // Positive: book once for response + cancel fixture
    const book = await cab.finalizeBooking(baseline);
    scorePos('FB.POS.baseline', 'finalize valid baseline', book, {
      bookingRefId: book.data?.bookingRefId,
      status: book.data?.status,
    });
    if (book.ok) scoreResponseSchema('FB', book.data, treePaths('finalize-booking'));

    const liveBr = book.data?.bookingRefId;
    let confirmed = false;
    if (liveBr) {
      let st = await cab.getBookingStatus(liveBr);
      for (let i = 0; i < 14 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
        await sleep(2000);
        st = await cab.getBookingStatus(liveBr);
      }
      confirmed = /confirm/i.test(String(st.data?.status || ''));
      add({
        id: 'FB.POS.confirmed',
        section: 'FB',
        kind: 'POS',
        rule: 'booking reaches Confirmed',
        status: confirmed ? 'PASS' : 'BUG',
        actual: st.data?.status || 'none',
        http: st.status,
      });
      if (st.ok) scoreResponseSchema('ST', st.data, treePaths('status'));

      const det = await client.request({
        method: 'GET',
        path: `/v1/airportServices/cabs/booking/${liveBr}`,
        query: CAB_QUERY,
        correlation: true,
      });
      scorePos('DT.POS.baseline', 'booking details', det);
      if (det.ok) scoreResponseSchema('DT', det.data, treePaths('booking-details'));

      const track = await client.request({
        method: 'GET',
        path: `/v1/airportServices/cabs/tracking/${liveBr}/location`,
        query: CAB_QUERY,
        correlation: true,
      });
      scorePos('TR.POS.baseline', 'tracking pre-dispatch', track);
      if (track.ok) scoreResponseSchema('TR', track.data, treePaths('tracking'));

      const hist = await client.request({
        method: 'GET',
        path: '/v1/airportServices/cabs/booking/history',
        query: { ...CAB_QUERY, page: 0, perPage: 10 },
        correlation: true,
      });
      // HI-1 known: omit userId currently 200 — score as POS if 200, but also NEG omit case below
      scorePos('HI.POS.page', 'history page/perPage', hist);
      if (hist.ok) scoreResponseSchema('HI', hist.data, treePaths('history'));
    }

    // Need a fresh fare for each finalize negative that might succeed — reuse priceId; invalid mutations shouldn't book.
    // Re-price once for remaining negatives if first book consumed fare.
    const search2 = await cab.search(buildAirportSearchBody(futurePickupDatetime(day++)));
    const c2 = pickCab(search2.data?.cabs || []);
    const fare2 = c2 ? await cab.fare(c2.searchId) : null;
    const base2 =
      fare2?.data?.bookingReference && fare2?.data?.priceId
        ? buildFinalizeBody({
            bookingReference: fare2.data.bookingReference,
            priceId: fare2.data.priceId,
          })
        : baseline;

    const fbNegs = [
      { id: 'FB.NEG.body.empty', body: {}, rule: 'empty body' },
      {
        id: 'FB.NEG.bookingReference.omit',
        mutate: (b) => delPath(b, 'bookingReference'),
        rule: 'omit bookingReference',
      },
      {
        id: 'FB.NEG.bookingReference.empty',
        mutate: (b) => setPath(b, 'bookingReference', ''),
        rule: 'empty bookingReference',
      },
      {
        id: 'FB.NEG.bookingReference.bad',
        mutate: (b) => setPath(b, 'bookingReference', 'BADREF'),
        rule: 'invalid bookingReference',
      },
      {
        id: 'FB.NEG.bookingReference.comma',
        mutate: (b) => setPath(b, 'bookingReference', `${b.bookingReference},`),
        rule: 'bookingReference comma',
      },
      {
        id: 'FB.NEG.bookingReference.html',
        mutate: (b) => setPath(b, 'bookingReference', '<script>'),
        rule: 'bookingReference HTML',
      },
      { id: 'FB.NEG.priceId.omit', mutate: (b) => delPath(b, 'priceId'), rule: 'omit priceId' },
      { id: 'FB.NEG.priceId.empty', mutate: (b) => setPath(b, 'priceId', ''), rule: 'empty priceId' },
      { id: 'FB.NEG.priceId.bad', mutate: (b) => setPath(b, 'priceId', 'BADPRICE'), rule: 'invalid priceId' },
      { id: 'FB.NEG.priceId.comma', mutate: (b) => setPath(b, 'priceId', `${b.priceId},`), rule: 'priceId comma' },
      { id: 'FB.NEG.priceId.html', mutate: (b) => setPath(b, 'priceId', '<x>'), rule: 'priceId HTML' },
      { id: 'FB.NEG.passengers.omit', mutate: (b) => delPath(b, 'passengers'), rule: 'omit passengers' },
      { id: 'FB.NEG.passengers.empty', mutate: (b) => setPath(b, 'passengers', []), rule: 'empty passengers[]' },
      {
        id: 'FB.NEG.passengers.two',
        mutate: (b) => {
          b.passengers = [
            b.passengers[0],
            {
              ...clone(b.passengers[0]),
              paxId: 2,
              isLead: false,
              profile: { ...b.passengers[0].profile, firstName: 'Second', lastName: 'Guest' },
            },
          ];
          return b;
        },
        rule: 'two passengers',
      },
      { id: 'FB.NEG.paxType.bad', mutate: (b) => setPath(b, 'passengers.0.paxType', 'DOG'), rule: 'paxType=DOG' },
      { id: 'FB.NEG.paxType.comma', mutate: (b) => setPath(b, 'passengers.0.paxType', 'ADT,'), rule: 'paxType comma' },
      { id: 'FB.NEG.title.comma', mutate: (b) => setPath(b, 'passengers.0.profile.title', 'Mr,'), rule: 'title comma' },
      {
        id: 'FB.NEG.firstName.omit',
        mutate: (b) => delPath(b, 'passengers.0.profile.firstName'),
        rule: 'omit firstName',
      },
      {
        id: 'FB.NEG.firstName.empty',
        mutate: (b) => setPath(b, 'passengers.0.profile.firstName', ''),
        rule: 'empty firstName',
      },
      {
        id: 'FB.NEG.firstName.digit',
        mutate: (b) => setPath(b, 'passengers.0.profile.firstName', 'Rohan1'),
        rule: 'firstName with digit',
      },
      {
        id: 'FB.NEG.firstName.comma',
        mutate: (b) => setPath(b, 'passengers.0.profile.firstName', 'Rohan,'),
        rule: 'firstName comma',
      },
      {
        id: 'FB.NEG.firstName.html',
        mutate: (b) => setPath(b, 'passengers.0.profile.firstName', '<script>'),
        rule: 'firstName HTML',
      },
      {
        id: 'FB.NEG.firstName.punct',
        mutate: (b) => setPath(b, 'passengers.0.profile.firstName', '!@#$'),
        rule: 'firstName punctuation',
      },
      {
        id: 'FB.NEG.lastName.omit',
        mutate: (b) => delPath(b, 'passengers.0.profile.lastName'),
        rule: 'omit lastName',
      },
      {
        id: 'FB.NEG.lastName.comma',
        mutate: (b) => setPath(b, 'passengers.0.profile.lastName', 'Bhagat,'),
        rule: 'lastName comma',
      },
      {
        id: 'FB.NEG.gender.bad',
        mutate: (b) => setPath(b, 'passengers.0.profile.gender', 'other'),
        rule: 'gender=other',
      },
      {
        id: 'FB.NEG.dob.bad',
        mutate: (b) => setPath(b, 'passengers.0.profile.dob', '15-09-1990'),
        rule: 'dob wrong format',
      },
      {
        id: 'FB.NEG.dob.comma',
        mutate: (b) => setPath(b, 'passengers.0.profile.dob', '1990-01-01,'),
        rule: 'dob comma',
      },
      {
        id: 'FB.NEG.nationality.bad',
        mutate: (b) => setPath(b, 'passengers.0.profile.nationality', 'IND'),
        rule: 'nationality not 2-letter',
      },
      {
        id: 'FB.NEG.nationality.comma',
        mutate: (b) => setPath(b, 'passengers.0.profile.nationality', 'IN,'),
        rule: 'nationality comma',
      },
      { id: 'FB.NEG.contact.omit', mutate: (b) => delPath(b, 'contact'), rule: 'omit contact' },
      { id: 'FB.NEG.email.omit', mutate: (b) => delPath(b, 'contact.email'), rule: 'omit email' },
      { id: 'FB.NEG.email.bad', mutate: (b) => setPath(b, 'contact.email', 'not-an-email'), rule: 'invalid email' },
      { id: 'FB.NEG.email.comma', mutate: (b) => setPath(b, 'contact.email', 'a@b.com,'), rule: 'email comma' },
      { id: 'FB.NEG.email.html', mutate: (b) => setPath(b, 'contact.email', '<script>@x.com'), rule: 'email HTML' },
      {
        id: 'FB.NEG.countryCode.omit',
        mutate: (b) => delPath(b, 'contact.countryCode'),
        rule: 'omit countryCode',
      },
      {
        id: 'FB.NEG.countryCode.bad',
        mutate: (b) => setPath(b, 'contact.countryCode', '999'),
        rule: 'bad countryCode',
      },
      { id: 'FB.NEG.mobile.omit', mutate: (b) => delPath(b, 'contact.mobile'), rule: 'omit mobile' },
      { id: 'FB.NEG.mobile.short', mutate: (b) => setPath(b, 'contact.mobile', '123'), rule: 'mobile too short' },
      { id: 'FB.NEG.mobile.comma', mutate: (b) => setPath(b, 'contact.mobile', '9876543210,'), rule: 'mobile comma' },
      {
        id: 'FB.NEG.otherDetails.html',
        mutate: (b) => setPath(b, 'otherDetails', '<script>alert(1)</script>'),
        rule: 'otherDetails HTML → 4xx never 500',
      },
      {
        id: 'FB.NEG.isLead.false',
        mutate: (b) => setPath(b, 'passengers.0.isLead', false),
        rule: 'single pax isLead=false',
      },
    ];

    for (const n of fbNegs) {
      const body = n.body != null ? n.body : n.mutate(clone(base2));
      const res = await cab.finalizeBooking(body);
      // If somehow accepted with BR, cancel it
      const maybeBr = res.data?.bookingRefId;
      scoreNeg(n.id, n.rule, res, { mutated: n.id });
      if (maybeBr && res.ok) {
        await sleep(SETTLE_MS);
        await client.request({
          method: 'POST',
          path: `/v1/airportServices/cabs/bookings/${maybeBr}/cancel`,
          query: CAB_QUERY,
          partnerKey: client.partnerKey,
          body: { cancelledBy: 'USER', cancellationReason: 'cleanup accidental book' },
        });
      }
    }

    // Cancel body matrix on confirmed BR
    if (liveBr && confirmed && CANCEL) {
      console.log('\n=== CANCEL body ===');
      // First: negatives that should not cancel
      for (const n of [
        {
          id: 'CA.NEG.cancelledBy.bad',
          body: { cancelledBy: 'HACKER', cancellationReason: 'test' },
          rule: 'cancelledBy invalid',
        },
        {
          id: 'CA.NEG.cancelledBy.comma',
          body: { cancelledBy: 'USER,', cancellationReason: 'test' },
          rule: 'cancelledBy comma',
        },
        {
          id: 'CA.NEG.cancelledBy.html',
          body: { cancelledBy: '<script>', cancellationReason: 'test' },
          rule: 'cancelledBy HTML',
        },
        {
          id: 'CA.NEG.reason.long',
          body: { cancelledBy: 'USER', cancellationReason: 'x'.repeat(501) },
          rule: 'cancellationReason >500',
        },
        {
          id: 'CA.NEG.reason.html',
          body: { cancelledBy: 'USER', cancellationReason: '<script>x</script>' },
          rule: 'cancellationReason HTML',
        },
      ]) {
        const res = await client.request({
          method: 'POST',
          path: `/v1/airportServices/cabs/bookings/${liveBr}/cancel`,
          query: CAB_QUERY,
          partnerKey: client.partnerKey,
          body: n.body,
        });
        scoreNeg(n.id, n.rule, res, n.body);
      }

      await sleep(SETTLE_MS);
      const cancelOk = await client.request({
        method: 'POST',
        path: `/v1/airportServices/cabs/bookings/${liveBr}/cancel`,
        query: CAB_QUERY,
        partnerKey: client.partnerKey,
        body: {
          cancelledBy: 'USER',
          cancellationReason: 'Customer flight rescheduled to next day',
        },
      });
      scorePos('CA.POS.body', 'POST cancel valid body', cancelOk);
      if (cancelOk.ok) scoreResponseSchema('CA', cancelOk.data, treePaths('cancel'));
    }

    // Path-param negatives for status/details/tracking/cancel
    console.log('\n=== PATH PARAMS ===');
    for (const [id, path, rule] of [
      ['ST.NEG.badId', '/v1/airportServices/cabs/BAD!!!/status', 'status invalid BR chars'],
      ['ST.NEG.missing', '/v1/airportServices/cabs/BR0000000000000001/status', 'status unknown BR'],
      ['DT.NEG.badId', '/v1/airportServices/cabs/booking/BAD!!!', 'details invalid BR'],
      ['DT.NEG.missing', '/v1/airportServices/cabs/booking/BR0000000000000001', 'details unknown BR'],
      ['TR.NEG.badId', '/v1/airportServices/cabs/tracking/BAD!!!/location', 'tracking invalid BR'],
      ['TR.NEG.missing', '/v1/airportServices/cabs/tracking/BR0000000000000001/location', 'tracking unknown BR'],
    ]) {
      const res = await client.request({ method: 'GET', path, query: CAB_QUERY, correlation: true });
      scoreNeg(id, rule, res, { path });
    }

    const histOmit = await client.request({
      method: 'GET',
      path: '/v1/airportServices/cabs/booking/history',
      query: { ...CAB_QUERY, page: 0, perPage: 10 },
      correlation: true,
    });
    // Doc: userId required → expect reject. Known HI-1 if accepted.
    scoreNeg('HI.NEG.userId.omit', 'history omit userId (doc required)', histOmit, {});
  }
}

// ---------- UPDATE-BOOKING ----------
console.log('\n=== UPDATE-BOOKING ===');
{
  for (const n of [
    { id: 'UB.NEG.body.empty', body: {}, rule: 'empty body' },
    { id: 'UB.NEG.bookingRefId.omit', body: { status: 'CONFIRMED' }, rule: 'omit bookingRefId' },
    {
      id: 'UB.NEG.status.bad',
      body: { bookingRefId: 'BR0000000000000001', status: 'HACKED' },
      rule: 'invalid status',
    },
    {
      id: 'UB.NEG.status.comma',
      body: { bookingRefId: 'BR0000000000000001', status: 'CONFIRMED,' },
      rule: 'status comma',
    },
    {
      id: 'UB.NEG.notFound',
      body: { bookingRefId: 'BR0000000000000001', status: 'CONFIRMED' },
      rule: 'unknown BR',
    },
  ]) {
    const res = await client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/update-booking',
      query: CAB_QUERY,
      body: n.body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    scoreNeg(n.id, n.rule, res, n.body);
  }
}

// ---------- RESPONSE schema for remaining journey types (book+cancel each) ----------
console.log('\n=== RESPONSE ALL TYPES ===');
for (const j of JOURNEYS.slice(1)) {
  // AIRPORT_DEPARTURE already covered in finalize section
  try {
    const search = await cab.search(j.body(futurePickupDatetime(day++)));
    scorePos(`${j.id}.SR.POS.e2e`, `${j.id} search for response audit`, search);
    const c0 = pickCab(search.data?.cabs || []);
    if (!c0) {
      add({ id: `${j.id}.SETUP`, rule: 'no inventory', status: 'NOT TESTED', actual: 'no cabs' });
      continue;
    }
    scoreResponseSchema(`${j.id}.SEARCH`, search.data, treePaths('search'));
    const fare = await cab.fare(c0.searchId);
    scorePos(`${j.id}.FR.POS`, `${j.id} fare`, fare);
    if (fare.ok) scoreResponseSchema(`${j.id}.FR`, fare.data, treePaths('fare'));
    const book = await cab.finalizeBooking(
      buildFinalizeBody({ bookingReference: fare.data.bookingReference, priceId: fare.data.priceId }),
    );
    scorePos(`${j.id}.FB.POS`, `${j.id} finalize`, book);
    const liveBr = book.data?.bookingRefId;
    if (!liveBr) continue;
    let st = await cab.getBookingStatus(liveBr);
    for (let i = 0; i < 14 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
      await sleep(2000);
      st = await cab.getBookingStatus(liveBr);
    }
    if (st.ok) scoreResponseSchema(`${j.id}.ST`, st.data, treePaths('status'));
    // Logic: non-AIRPORT airportCode
    if (j.id !== 'AIRPORT_ARRIVAL') {
      const ac = st.data?.details?.airportCode;
      add({
        id: `${j.id}.LOGIC.airportCode`,
        section: j.id,
        kind: 'LOGIC',
        rule: 'NON-AIRPORT airportCode null/empty',
        status: !ac ? 'PASS' : 'BUG',
        actual: String(ac),
      });
    }
    const det = await client.request({
      method: 'GET',
      path: `/v1/airportServices/cabs/booking/${liveBr}`,
      query: CAB_QUERY,
      correlation: true,
    });
    if (det.ok) scoreResponseSchema(`${j.id}.DT`, det.data, treePaths('booking-details'));
    if (CANCEL && /confirm/i.test(String(st.data?.status || ''))) {
      await sleep(SETTLE_MS);
      await client.request({
        method: 'POST',
        path: `/v1/airportServices/cabs/bookings/${liveBr}/cancel`,
        query: CAB_QUERY,
        partnerKey: client.partnerKey,
        body: { cancelledBy: 'USER', cancellationReason: 'property matrix cleanup' },
      });
    }
  } catch (e) {
    add({ id: `${j.id}.EX`, rule: 'threw', status: 'BUG', actual: String(e.message || e) });
  }
}

const bugs = rows.filter((r) => r.status === 'BUG');
const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  summary,
  bugCount: bugs.length,
  bugs: bugs.map((b) => ({ id: b.id, rule: b.rule, actual: b.actual, http: b.http, code: b.code, message: b.message })),
  bySection: {},
  rows,
};
for (const r of rows) {
  const s = r.section || 'OTHER';
  if (!report.bySection[s]) report.bySection[s] = { PASS: 0, BUG: 0, NOTE: 0, 'NOT TESTED': 0 };
  report.bySection[s][r.status] = (report.bySection[s][r.status] || 0) + 1;
}

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', summary);
console.log('BUGS', bugs.length);
bugs.slice(0, 40).forEach((b) => console.log(b.id, b.actual, b.message || ''));
if (bugs.length > 40) console.log(`... +${bugs.length - 40} more`);
console.log('Wrote', OUT);
process.exit(bugs.length ? 1 : 0);
