/**
 * Cab cancel validation matrix on api-staging.
 * Rule: USER cannot cancel ONLY when pickupDatetime has passed AND driver reached pickup.
 *
 *   BASE_URL=https://api-staging.travelvip.ai
 *   CAB_VENDOR_USER=gyanesh CAB_VENDOR_PASS=...
 *   node scripts/probe-cab-cancel-validation-matrix.js
 *
 * Optional: SKIP_PAST=1 to skip ~2h wait for past-pickup cases.
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
  CAB_QUERY,
} from '../src/helpers.js';

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const DEV_URL = 'https://travelvip-dev.bookairportcab.com';
const username = process.env.CAB_VENDOR_USER || 'gyanesh';
const password = process.env.CAB_VENDOR_PASS || '';
const SKIP_PAST = process.env.SKIP_PAST === '1';
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 8000);
const OUT = 'reports/cab-cancel-validation-matrix.json';

if (!password) {
  console.error('Set CAB_VENDOR_PASS');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => String(Date.now());

function fmtPickup(minsFromNow) {
  const d = new Date(Date.now() + minsFromNow * 60_000);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function brief(d, n = 400) {
  return JSON.stringify(d)?.slice(0, n);
}

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

async function vendorLogin() {
  const res = await fetch(`${DEV_URL}/auth/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data?.token) throw new Error(`vendor login failed: ${brief(data)}`);
  return `Bearer ${data.token}`;
}

async function vendorFetch(auth, id) {
  const res = await fetch(
    `${DEV_URL}/api/v1/booking/bookingDetailsOps?bookingId=${encodeURIComponent(id)}`,
    { headers: { Authorization: auth, correlationId: crypto.randomUUID() } },
  );
  const data = await res.json();
  return data?.data?.[0] || null;
}

async function vendorPost(auth, path, body) {
  const res = await fetch(`${DEV_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { http: res.status, ok: res.ok, data };
}

async function bookAirport(pickupDatetime, label) {
  // AIRPORT needs ~2h notice; retry with +5m if too soon / empty inventory
  let last = null;
  const candidates = [pickupDatetime];
  if (pickupDatetime) {
    // also try +10m if first fails empty
    const t = new Date(pickupDatetime);
    if (!Number.isNaN(t.getTime())) {
      candidates.push(new Date(t.getTime() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
      candidates.push(new Date(t.getTime() + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    }
  }
  for (const dt of candidates) {
    const search = await cab.search(buildAirportSearchBody(dt));
    const selected = pickCab(search.data?.cabs);
    if (!selected) {
      last = {
        ok: false,
        stage: 'search',
        label,
        pickupDatetime: dt,
        http: search.status,
        err: search.data?.error || search.data,
      };
      continue;
    }
    const fare = await cab.fare(selected.searchId);
    const book = await cab.finalizeBooking(
      buildFinalizeBody({
        bookingReference: fare.data.bookingReference,
        priceId: fare.data.priceId,
      }),
    );
    const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
    let st = await cab.getBookingStatus(br);
    for (let i = 0; i < 16 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
      await sleep(2000);
      st = await cab.getBookingStatus(br);
    }
    const ok = /confirm/i.test(String(st.data?.status || ''));
    const row = {
      ok,
      stage: 'booked',
      label,
      pickupDatetime: dt,
      br,
      status: st.data?.status,
      providerBookingId: st.data?.providerBookingId || null,
      pickupFromApi: st.data?.details?.pickupDatetime,
      progress: st.data?.details?.progress,
    };
    if (ok) {
      // settle so provider cancel is ready
      await sleep(SETTLE_MS);
      return row;
    }
    last = row;
  }
  return last;
}

async function statusSnap(br) {
  const st = await cab.getBookingStatus(br);
  const pickupDatetime = st.data?.details?.pickupDatetime || null;
  const pickupTs = pickupDatetime ? new Date(pickupDatetime).getTime() : null;
  return {
    br,
    status: st.data?.status,
    pickupDatetime,
    progress: st.data?.details?.progress || null,
    now: new Date().toISOString(),
    pickupPassed: pickupTs == null ? null : pickupTs < Date.now(),
  };
}

async function advanceTo(auth, vendorId, target) {
  // target: none | assign | left | arrived
  if (!target || target === 'none') return { skipped: true };
  const bd = await vendorFetch(auth, vendorId);
  if (!bd) throw new Error(`vendor booking not found ${vendorId}`);
  const booking_id = bd.bookingId || vendorId;
  const partner = bd.cabPartner;
  const out = { booking_id, partner, steps: [] };

  if (['assign', 'left', 'arrived'].includes(target)) {
    const chauffeurId = Math.floor(Math.random() * 900000 + 100000);
    const assign = await vendorPost(auth, '/api/v1/tracking/driverDetails', {
      booking_id,
      chauffeur_id: String(chauffeurId),
      chauffeur_name: `Driver${chauffeurId}`,
      chauffeur_mobile_number: `98765${String(Math.floor(100000 + Math.random() * 899999)).slice(0, 5)}`,
      chauffeur_image: String(chauffeurId),
      vehicle_id: String(Math.floor(100000 + Math.random() * 899999)),
      vehicle_name: 'SWIFT',
      vehicle_color: 'white',
      vehicle_registration_number: `DL${Math.floor(Math.random() * 90 + 10)}A${Math.floor(
        Math.random() * 9000 + 1000,
      )}`,
      vehicle_type: 'SWIFT',
      partner,
      is_reassigned: 0,
    });
    out.steps.push({ label: 'assign', http: assign.http, ok: assign.ok });
    await sleep(2000);
  }

  if (['left', 'arrived'].includes(target)) {
    const left = await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
      event: 'Left For pickup',
      order_referance_no: booking_id,
      latitude: '28.4951645',
      longitude: '77.0866388',
      timestamp: nowMs(),
      device_id: 'webapp1',
      total_travelled_fare: '0',
      partner,
    });
    out.steps.push({ label: 'left', http: left.http, ok: left.ok });
    await sleep(2000);
  }

  if (target === 'arrived') {
    const arrived = await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
      event: 'arrived',
      order_referance_no: booking_id,
      latitude: String(bd.sourceLatitude || 28.5201),
      longitude: String(bd.sourceLongitude || 77.1591),
      timestamp: nowMs(),
      device_id: 'webapp1',
      total_travelled_fare: '0',
      partner,
    });
    out.steps.push({ label: 'arrived', http: arrived.http, ok: arrived.ok });
    await sleep(2500);
  }
  return out;
}

async function cancelUser(br) {
  const res = await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    signed: true,
    body: {
      cancelledBy: 'USER',
      cancellationReason: 'Customer flight rescheduled to next day',
    },
  });
  await sleep(1500);
  const st = await cab.getBookingStatus(br);
  const result = res.data?.result || res.data?.error?.result || null;
  const cancelled =
    /cancel/i.test(String(st.data?.status || '')) ||
    /cancel/i.test(String(result?.bookingStatus || ''));
  return {
    http: res.status,
    ok: res.ok,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || res.data?.message || null,
    result,
    statusAfter: st.data?.status,
    cancelled,
    data: res.data,
  };
}

function score({ id, rule, expectAllow, cancelRes, snap, extra }) {
  const allowed = !!cancelRes?.cancelled;
  const blocked = !allowed && cancelRes && cancelRes.http >= 400;
  let status = 'BUG';
  if (expectAllow && allowed) status = 'PASS';
  if (!expectAllow && blocked) status = 'PASS';
  // If expect block but got provider CANCELLATION_FAILED without clear guard code — still PASS if blocked,
  // but note if message doesn't mention pickup/arrived.
  const note = [];
  if (!expectAllow && blocked) {
    const msg = `${cancelRes.code || ''} ${cancelRes.message || ''}`.toLowerCase();
    if (!/pickup|arriv|cancellable|not.*cancel|driver/.test(msg) && cancelRes.code === 'CANCELLATION_FAILED') {
      note.push('Blocked, but error is generic CANCELLATION_FAILED (not a clear guard message)');
    }
  }
  return {
    id,
    rule,
    expect: expectAllow ? 'CANCEL ALLOWED' : 'CANCEL BLOCKED',
    actual: allowed
      ? `ALLOWED http=${cancelRes.http} statusAfter=${cancelRes.statusAfter}`
      : `BLOCKED http=${cancelRes.http} code=${cancelRes.code} msg=${cancelRes.message} statusAfter=${cancelRes.statusAfter}`,
    pickupPassed: snap?.pickupPassed,
    progress: snap?.progress,
    status,
    br: snap?.br,
    cancel: cancelRes,
    snap,
    notes: note,
    ...extra,
  };
}

const rows = [];
const auth = await vendorLogin();
console.log('vendor login ok; settleMs=', SETTLE_MS);

async function runCase({ id, rule, expectAllow, pickupDatetime, simTarget, bookLabel }) {
  console.log(`\n=== ${id} ${rule}`);
  const booked = await bookAirport(pickupDatetime, bookLabel || id);
  console.log('booked', booked.br, booked.status, booked.providerBookingId, booked.pickupDatetime);
  if (!booked?.ok || !booked.br) {
    rows.push({ id, rule, status: 'NOT TESTED', detail: booked });
    return;
  }
  let vendor = null;
  if (simTarget && simTarget !== 'none') {
    if (!booked.providerBookingId) {
      rows.push({ id, rule, status: 'NOT TESTED', detail: 'missing providerBookingId', booked });
      return;
    }
    vendor = await advanceTo(auth, booked.providerBookingId, simTarget);
  }
  const snap = await statusSnap(booked.br);
  // sanity: if we need past pickup, wait a bit more if barely not passed
  if (expectAllow === false || /past/i.test(rule)) {
    // no-op here; waiter handled outside
  }
  const cancelRes = await cancelUser(booked.br);
  const row = score({ id, rule, expectAllow, cancelRes, snap, extra: { vendor, booked } });
  rows.push(row);
  console.log(id, row.status, row.actual, 'pickupPassed=', snap.pickupPassed, 'reached=', snap.progress?.cabReachedSource);
}

// -------- POSITIVE: future pickup (should ALLOW) --------
const futureDt = fmtPickup(3 * 24 * 60); // ~3 days out (inventory usually OK)

await runCase({
  id: 'P1',
  rule: 'POSITIVE: future pickup + confirmed only (no driver) → allow',
  expectAllow: true,
  pickupDatetime: futureDt,
  simTarget: 'none',
});

await runCase({
  id: 'P2',
  rule: 'POSITIVE: future pickup + driver assigned → allow',
  expectAllow: true,
  pickupDatetime: fmtPickup(3 * 24 * 60 + 60),
  simTarget: 'assign',
});

await runCase({
  id: 'P3',
  rule: 'POSITIVE: future pickup + left for pickup (not arrived) → allow',
  expectAllow: true,
  pickupDatetime: fmtPickup(3 * 24 * 60 + 120),
  simTarget: 'left',
});

await runCase({
  id: 'P4',
  rule: 'POSITIVE: future pickup + driver ARRIVED → allow (pickup not passed)',
  expectAllow: true,
  pickupDatetime: fmtPickup(3 * 24 * 60 + 180),
  simTarget: 'arrived',
});

function writeReport(partial = false) {
  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    partial,
    baseUrl: BASE,
    rule: 'Users cannot cancel only if pickup time has passed AND driver has reached pickup location',
    method: 'POST /v1/airportServices/cabs/bookings/{BR}/cancel',
    body: { cancelledBy: 'USER', cancellationReason: 'Customer flight rescheduled to next day' },
    settleMsAfterConfirm: SETTLE_MS,
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  return summary;
}

console.log('\n=== Interim (future pickup cases) ===', JSON.stringify(writeReport(true)));

// -------- PAST pickup cases (need ~2h lead book then wait) --------
if (SKIP_PAST) {
  rows.push({
    id: 'P5',
    rule: 'POSITIVE: past pickup + not arrived → allow',
    status: 'NOT TESTED',
    detail: 'SKIP_PAST=1',
  });
  rows.push({
    id: 'N1',
    rule: 'NEGATIVE: past pickup + driver arrived → block',
    status: 'NOT TESTED',
    detail: 'SKIP_PAST=1',
  });
} else {
  // Book two earliest (~2h05 and 2h10) up front, wait until passed, then sim + cancel
  console.log('\n=== Booking past-pickup fixtures (earliest allowed ~2h) ===');
  let earliestMsg = null;
  // Probe earliest from API error if needed
  const tooSoon = await cab.search(buildAirportSearchBody(fmtPickup(30)));
  const m = String(tooSoon.data?.error?.message || '');
  const em = m.match(/earliest is ([0-9T:\-Z]+)/i);
  if (em) earliestMsg = em[1];
  console.log('earliest hint', earliestMsg || '(none)', 'tooSoon=', brief(tooSoon.data?.error || tooSoon.data, 200));

  const baseEarliest = earliestMsg
    ? new Date(earliestMsg).getTime()
    : Date.now() + 125 * 60_000;

  const pastAllowDt = new Date(baseEarliest + 2 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const pastBlockDt = new Date(baseEarliest + 8 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const bookAllow = await bookAirport(pastAllowDt, 'past-allow');
  const bookBlock = await bookAirport(pastBlockDt, 'past-block');
  console.log('past fixtures', bookAllow.br, bookAllow.pickupDatetime, bookBlock.br, bookBlock.pickupDatetime);

  if (!bookAllow?.ok || !bookBlock?.ok) {
    rows.push({
      id: 'P5',
      rule: 'POSITIVE: past pickup + not arrived → allow',
      status: 'NOT TESTED',
      detail: { bookAllow, bookBlock },
    });
    rows.push({
      id: 'N1',
      rule: 'NEGATIVE: past pickup + driver arrived → block',
      status: 'NOT TESTED',
      detail: { bookAllow, bookBlock },
    });
  } else {
    const waitUntil = Math.max(
      new Date(bookAllow.pickupFromApi || bookAllow.pickupDatetime).getTime(),
      new Date(bookBlock.pickupFromApi || bookBlock.pickupDatetime).getTime(),
    ) + 45_000;
    const waitMs = Math.max(0, waitUntil - Date.now());
    console.log(`Waiting ${Math.round(waitMs / 1000)}s for pickups to pass...`);
    // chunked wait with heartbeat
    const start = Date.now();
    while (Date.now() < waitUntil) {
      const left = waitUntil - Date.now();
      console.log(`  ... ${Math.round(left / 1000)}s left`);
      await sleep(Math.min(60_000, left));
    }
    console.log(`Wait done in ${Math.round((Date.now() - start) / 1000)}s`);

    // P5: past + left (not arrived) → allow
    {
      const id = 'P5';
      const rule = 'POSITIVE: past pickup + left (not arrived) → allow';
      console.log(`\n=== ${id} ${rule}`);
      const vendor = await advanceTo(auth, bookAllow.providerBookingId, 'left');
      const snap = await statusSnap(bookAllow.br);
      const cancelRes = await cancelUser(bookAllow.br);
      const row = score({ id, rule, expectAllow: true, cancelRes, snap, extra: { vendor, booked: bookAllow } });
      rows.push(row);
      console.log(id, row.status, row.actual, 'pickupPassed=', snap.pickupPassed);
    }

    // N1: past + arrived → block
    {
      const id = 'N1';
      const rule = 'NEGATIVE: past pickup + driver ARRIVED → block';
      console.log(`\n=== ${id} ${rule}`);
      const vendor = await advanceTo(auth, bookBlock.providerBookingId, 'arrived');
      const snap = await statusSnap(bookBlock.br);
      const cancelRes = await cancelUser(bookBlock.br);
      const row = score({ id, rule, expectAllow: false, cancelRes, snap, extra: { vendor, booked: bookBlock } });
      rows.push(row);
      console.log(id, row.status, row.actual, 'pickupPassed=', snap.pickupPassed, 'reached=', snap.progress?.cabReachedSource);
    }

    // Extra edge: past + confirmed only (no sim) if we still have a third? use leftover — book one more if time: skip to keep runtime bounded
    // P6: if N1 incorrectly allowed, we already scored BUG. Optional past+assign-only:
    // Book quickly not possible past. Skip.
  }
}

const summary = writeReport(false);
console.log('\n=== SUMMARY ===', JSON.stringify(summary));
for (const r of rows) {
  console.log(`${r.id} ${r.status} | ${r.rule} | ${r.actual || brief(r.detail)}`);
}
console.log('Wrote', OUT);
