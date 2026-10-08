/**
 * Probe pending flight cancel/reschedule codes with dummy + history edge data.
 * Run: node scripts/probe-flight-pending-codes-dummy.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
} from '../src/helpers.js';

const OUT = path.join('reports', 'flight-pending-codes-dummy-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function code(r) {
  return r?.data?.error?.code || null;
}
function brief(d, n = 450) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractPnrs(detailData) {
  const found = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === 'string'
        && v.trim()
        && !v.startsWith('BR')
        && v.length >= 5
        && v.length <= 12
        && /pnr/i.test(k)
      ) {
        found.add(v.trim());
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return [...found];
}

function extractDeparture(detailData) {
  const dates = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === 'string'
        && /depart|depTime|departure|journeyDate|flightDate/i.test(k)
        && /\d{4}-\d{2}-\d{2}/.test(v)
      ) {
        dates.push({ key: k, value: v });
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return dates;
}

function isPast(isoLike) {
  const m = String(isoLike).match(/(\d{4}-\d{2}-\d{2})/);
  if (!m) return false;
  return new Date(m[1]) < new Date(new Date().toISOString().slice(0, 10));
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const rows = [];

  const add = (area, name, status, note, res = null, extra = {}) => {
    const row = {
      area,
      name,
      status,
      note,
      http: res?.status ?? null,
      actualCode: code(res),
      snippet: res ? brief(res.data) : null,
      ...extra,
      at: new Date().toISOString(),
    };
    rows.push(row);
    console.log(`[${status}] ${area} | ${name} — ${note}`);
    if (row.snippet) console.log(' ', row.snippet.slice(0, 300));
  };

  const cancelV2 = (body) => client.request({
    method: 'POST',
    path: '/api/v2/flight/cancel',
    query: FLIGHT_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // Price a fresh issue body for reschedule probes
  let basePayload = null;
  for (const days of [12, 18, 25]) {
    const searchBody = buildOneWaySearchBody(days, { origin: 'BOM', destination: 'DEL' });
    searchBody.preferences = { ...(searchBody.preferences || {}), airlines: ['SG'] };
    const search = await flight.search(searchBody);
    if (!ok(search)) continue;
    const searchId = extractFirstSearchId(search.data);
    if (!searchId) continue;
    const pricing = await flight.getPricing([searchId], 'ONE_WAY');
    if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) continue;
    basePayload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [searchId],
      journeyType: 'ONE_WAY',
    });
    console.log('priced', searchId, 'days', days);
    break;
  }
  if (!basePayload) throw new Error('could not price for reschedule probes');

  const issue = (extra) => client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: FLIGHT_QUERY,
    body: { ...basePayload, ...extra },
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // Collect bookings across statuses
  const all = [];
  for (const status of ['Confirmed', 'Cancelled', 'Inprogress', 'Failed', '']) {
    for (let page = 1; page <= 4; page += 1) {
      const hist = await client.request({
        method: 'GET',
        path: '/v1/flights/bookings/history',
        query: {
          ...FLIGHT_QUERY,
          page,
          perpage: 30,
          ...(status ? { status } : {}),
        },
        correlation: true,
      });
      const list = hist.data?.bookings || [];
      if (!Array.isArray(list) || !list.length) break;
      for (const b of list) all.push({ ...b, _histStatus: status || b.status });
    }
  }
  // dedupe
  const byId = new Map();
  for (const b of all) {
    const id = b.bookingId || b.bookingReferenceId;
    if (id) byId.set(id, b);
  }
  const bookings = [...byId.values()];
  console.log('unique bookings scanned', bookings.length);

  // Enrich sample of candidates
  const enriched = [];
  for (const b of bookings.slice(0, 80)) {
    const br = b.bookingId;
    const det = await flight.getBookingDetail(br);
    const pnrs = extractPnrs(det.data);
    const deps = extractDeparture(det.data);
    const past = deps.some((d) => isPast(d.value));
    enriched.push({
      br,
      status: b.status || det.data?.status,
      pnrs,
      deps: deps.slice(0, 3),
      past,
      detailOk: ok(det),
    });
  }

  const pastConfirmed = enriched.filter((e) => e.past && /confirm/i.test(String(e.status)) && e.pnrs[0]);
  const pastCancelled = enriched.filter((e) => e.past && /cancel/i.test(String(e.status)) && e.pnrs[0]);
  const noPnr = enriched.filter((e) => e.detailOk && e.pnrs.length === 0);
  const confirmed = enriched.filter((e) => /confirm/i.test(String(e.status)) && e.pnrs[0] && !e.past);
  const cancelled = enriched.filter((e) => /cancel/i.test(String(e.status)) && e.pnrs[0]);

  console.log({
    pastConfirmed: pastConfirmed.length,
    pastCancelled: pastCancelled.length,
    noPnr: noPnr.length,
    confirmed: confirmed.length,
    cancelled: cancelled.length,
  });

  // ---- FLIGHT_ALREADY_DEPARTED ----
  if (pastConfirmed[0]) {
    const e = pastConfirmed[0];
    const res = await cancelV2({ bookingId: e.br, action: 'CANCEL', pnr: e.pnrs[0] });
    add(
      'Cancel',
      'FLIGHT_ALREADY_DEPARTED',
      code(res) === 'FLIGHT_ALREADY_DEPARTED' ? 'PASS' : 'INFO',
      `past confirmed ${e.br} pnr=${e.pnrs[0]} dep=${e.deps[0]?.value}`,
      res,
      { br: e.br, pnr: e.pnrs[0], deps: e.deps },
    );
  } else {
    add('Cancel', 'FLIGHT_ALREADY_DEPARTED', 'NOT_TESTED', 'No past-departure Confirmed flight in history');
  }

  // ---- RESCHEDULING_FLIGHT_DEPARTED ----
  if (pastCancelled[0]) {
    const e = pastCancelled[0];
    const res = await issue({ reschedulingReferenceId: e.br, reschedulingPnr: e.pnrs[0] });
    add(
      'Reschedule',
      'RESCHEDULING_FLIGHT_DEPARTED',
      code(res) === 'RESCHEDULING_FLIGHT_DEPARTED' ? 'PASS' : 'INFO',
      `past cancelled ${e.br} pnr=${e.pnrs[0]}`,
      res,
      { br: e.br, pnr: e.pnrs[0], deps: e.deps },
    );
  } else if (pastConfirmed[0]) {
    // try anyway on past confirmed — expect NOT_ALLOWED or DEPARTED
    const e = pastConfirmed[0];
    const res = await issue({ reschedulingReferenceId: e.br, reschedulingPnr: e.pnrs[0] });
    add(
      'Reschedule',
      'RESCHEDULING_FLIGHT_DEPARTED',
      code(res) === 'RESCHEDULING_FLIGHT_DEPARTED' ? 'PASS' : 'INFO',
      `past confirmed attempt ${e.br} → ${code(res)}`,
      res,
    );
  } else {
    add('Reschedule', 'RESCHEDULING_FLIGHT_DEPARTED', 'NOT_TESTED', 'No past-departure cancelled flight');
  }

  // ---- PNR_NOT_FOUND (cancel) ----
  if (noPnr[0]) {
    const e = noPnr[0];
    const res = await cancelV2({ bookingId: e.br, action: 'CANCEL', pnr: 'ABCDEF' });
    add(
      'Cancel',
      'PNR_NOT_FOUND',
      code(res) === 'PNR_NOT_FOUND' ? 'PASS' : 'INFO',
      `booking with no PNR ${e.br} status=${e.status}`,
      res,
    );
    // also without pnr field
    const res2 = await cancelV2({ bookingId: e.br, action: 'CANCEL' });
    add(
      'Cancel',
      'PNR_NOT_FOUND (no pnr field)',
      code(res2) === 'PNR_NOT_FOUND' ? 'PASS' : 'INFO',
      `no-pnr booking cancel without pnr field`,
      res2,
    );
  } else {
    // dummy: invent — won't work; try Inprogress bookings
    add('Cancel', 'PNR_NOT_FOUND', 'NOT_TESTED', 'No booking without PNR found in scanned history');
  }

  // ---- CANCELLATION_ALREADY_IN_PROGRESS / RESCHEDULING_CANCELLATION_IN_PROGRESS ----
  // Known AI BR from earlier matrix that had Cancellation Requested
  const pendingCandidates = [
    'BR1786015616687710', // AI - Cancellation Requested in prior report
    'BR1786015490629561',
    ...enriched
      .filter((e) => /request|progress|pending/i.test(String(e.status)))
      .map((e) => e.br),
  ];
  let hitCancelInProgress = false;
  let hitReschedInProgress = false;
  for (const br of [...new Set(pendingCandidates)].slice(0, 8)) {
    const det = await flight.getBookingDetail(br);
    const pnrs = extractPnrs(det.data);
    const st = det.data?.status || det.data?.bookingResponse?.summary?.status;
    console.log('pending candidate', br, st, pnrs);
    if (!pnrs[0]) continue;
    const cRes = await cancelV2({ bookingId: br, action: 'CANCEL', pnr: pnrs[0] });
    if (code(cRes) === 'CANCELLATION_ALREADY_IN_PROGRESS') {
      add('Cancel', 'CANCELLATION_ALREADY_IN_PROGRESS', 'PASS', `BR ${br}`, cRes);
      hitCancelInProgress = true;
    } else {
      add('Cancel', 'CANCELLATION_ALREADY_IN_PROGRESS probe', 'INFO', `${br} → ${cRes.status} ${code(cRes)}`, cRes);
    }
    const iRes = await issue({ reschedulingReferenceId: br, reschedulingPnr: pnrs[0] });
    if (code(iRes) === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') {
      add('Reschedule', 'RESCHEDULING_CANCELLATION_IN_PROGRESS', 'PASS', `BR ${br}`, iRes);
      hitReschedInProgress = true;
    } else {
      add('Reschedule', 'RESCHEDULING_CANCELLATION_IN_PROGRESS probe', 'INFO', `${br} → ${iRes.status} ${code(iRes)}`, iRes);
    }
    if (hitCancelInProgress && hitReschedInProgress) break;
  }
  if (!hitCancelInProgress) {
    add('Cancel', 'CANCELLATION_ALREADY_IN_PROGRESS', 'NOT_TESTED', 'No PENDING cancel state found');
  }
  if (!hitReschedInProgress) {
    add('Reschedule', 'RESCHEDULING_CANCELLATION_IN_PROGRESS', 'NOT_TESTED', 'No pending-cancel booking for reschedule');
  }

  // ---- PNR_ALREADY_CANCELLED ----
  // Doc says unreachable; try cancel again on cancelled BR with its PNR via v2
  if (cancelled[0]) {
    const e = cancelled[0];
    const res = await cancelV2({ bookingId: e.br, action: 'CANCEL', pnr: e.pnrs[0] });
    add(
      'Cancel',
      'PNR_ALREADY_CANCELLED',
      code(res) === 'PNR_ALREADY_CANCELLED' ? 'PASS' : 'INFO',
      `expected unreachable; got ${code(res)} on ${e.br}`,
      res,
    );
  }

  // ---- RESCHEDULING_PNR_MISMATCH ----
  // Find cancelled BR that is NOT already used, pair with foreign PNR from another booking
  let mismatchHit = false;
  const foreignPnr = confirmed[0]?.pnrs[0] || cancelled.find((c) => c.br !== cancelled[0]?.br)?.pnrs[0];
  for (const e of cancelled.slice(0, 15)) {
    if (!foreignPnr || foreignPnr === e.pnrs[0]) continue;
    const res = await issue({
      reschedulingReferenceId: e.br,
      reschedulingPnr: foreignPnr,
    });
    const c = code(res);
    console.log('mismatch try', e.br, foreignPnr, res.status, c);
    if (c === 'RESCHEDULING_PNR_MISMATCH') {
      add('Reschedule', 'RESCHEDULING_PNR_MISMATCH', 'PASS', `${e.br} + foreign PNR ${foreignPnr}`, res);
      mismatchHit = true;
      break;
    }
    if (c === 'RESCHEDULING_REFERENCE_ALREADY_USED') continue;
    if (c === 'RESCHEDULING_FLIGHT_DEPARTED' || c === 'RESCHEDULING_NOT_ALLOWED') {
      add('Reschedule', 'RESCHEDULING_PNR_MISMATCH probe', 'INFO', `${e.br} blocked by ${c}`, res);
      continue;
    }
    add('Reschedule', 'RESCHEDULING_PNR_MISMATCH probe', 'INFO', `${e.br} → ${c}`, res);
  }
  if (!mismatchHit) {
    // dummy: valid cancelled BR + PNR that belongs to another known booking from docs example style
    add('Reschedule', 'RESCHEDULING_PNR_MISMATCH', 'NOT_TESTED', 'Could not find unused cancelled BR + foreign PNR combo');
  }

  // ---- Partner mismatch with dummy IDs ----
  const otherIds = [
    'BR1784272911936907',
    '1784272911936907',
    'BR9999999999999999',
    'BR0000000000000001',
  ];
  for (const br of otherIds) {
    const cRes = await cancelV2({ bookingId: br, action: 'CANCEL', pnr: 'ABCDEF' });
    add(
      'Cancel',
      'BOOKING_PARTNER_MISMATCH probe',
      code(cRes) === 'BOOKING_PARTNER_MISMATCH' ? 'PASS' : 'INFO',
      `${br} → ${cRes.status} ${code(cRes)}`,
      cRes,
    );
    const iRes = await issue({ reschedulingReferenceId: br.startsWith('BR') ? br : `BR${br}`, reschedulingPnr: 'ABCDEF' });
    add(
      'Reschedule',
      'RESCHEDULING_BOOKING_PARTNER_MISMATCH probe',
      code(iRes) === 'RESCHEDULING_BOOKING_PARTNER_MISMATCH' ? 'PASS' : 'INFO',
      `${br} → ${iRes.status} ${code(iRes)}`,
      iRes,
    );
  }

  // ---- FLIGHT_BOOKING_ITEM_NOT_FOUND 404 row missing — can't seed; try weird dummies ----
  {
    const dummies = ['BR', 'BR1', 'null', 'undefined'];
    for (const br of dummies) {
      const res = await cancelV2({ bookingId: br, action: 'CANCEL', pnr: 'ABCDEF' });
      add(
        'Cancel',
        'FLIGHT_BOOKING_ITEM_NOT_FOUND (404 row) probe',
        code(res) === 'FLIGHT_BOOKING_ITEM_NOT_FOUND' && res.status === 404 ? 'PASS' : 'INFO',
        `dummy ${br} → ${res.status} ${code(res)}`,
        res,
      );
    }
  }

  // ---- PROVIDER_BOOKING_ID_NOT_FOUND / BOOKING_CONTEXT_NOT_FOUND ----
  // Try PENALTY/CANCEL on in-progress / failed bookings
  const weird = enriched.filter((e) => /progress|fail|pending|inprogress/i.test(String(e.status)));
  for (const e of weird.slice(0, 6)) {
    const pnr = e.pnrs[0] || 'ABCDEF';
    const res = await cancelV2({ bookingId: e.br, action: 'PENALTY', pnr });
    add(
      'Cancel',
      'PROVIDER/CONTEXT gap probe',
      ['PROVIDER_BOOKING_ID_NOT_FOUND', 'BOOKING_CONTEXT_NOT_FOUND'].includes(code(res)) ? 'PASS' : 'INFO',
      `${e.br} status=${e.status} → ${res.status} ${code(res)}`,
      res,
    );
  }
  if (!weird.length) {
    add('Cancel', 'PROVIDER_BOOKING_ID_NOT_FOUND', 'NOT_TESTED', 'No in-progress/failed booking to probe');
    add('Cancel', 'BOOKING_CONTEXT_NOT_FOUND', 'NOT_TESTED', 'No in-progress/failed booking to probe');
  }

  // Summarize target codes
  const targets = [
    'FLIGHT_ALREADY_DEPARTED',
    'RESCHEDULING_FLIGHT_DEPARTED',
    'PNR_NOT_FOUND',
    'CANCELLATION_ALREADY_IN_PROGRESS',
    'RESCHEDULING_CANCELLATION_IN_PROGRESS',
    'PNR_ALREADY_CANCELLED',
    'RESCHEDULING_PNR_MISMATCH',
    'BOOKING_PARTNER_MISMATCH',
    'RESCHEDULING_BOOKING_PARTNER_MISMATCH',
    'FLIGHT_BOOKING_ITEM_NOT_FOUND',
    'PROVIDER_BOOKING_ID_NOT_FOUND',
    'BOOKING_CONTEXT_NOT_FOUND',
  ];
  const hitMap = {};
  for (const t of targets) {
    const hits = rows.filter((r) => r.actualCode === t || (r.name === t && r.status === 'PASS'));
    hitMap[t] = hits.some((h) => h.actualCode === t || h.status === 'PASS')
      ? 'HIT'
      : 'MISS';
  }

  const summary = {
    hitMap,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      INFO: rows.filter((r) => r.status === 'INFO').length,
      NOT_TESTED: rows.filter((r) => r.status === 'NOT_TESTED').length,
    },
    enrichedSample: enriched.slice(0, 20),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\nHIT MAP', JSON.stringify(hitMap, null, 2));
  console.log('PASS rows:', rows.filter((r) => r.status === 'PASS').map((r) => r.name));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
