/**
 * Continue cancel-validation past-pickup cases once near inventory exists.
 * Books at soonest inventory slot, waits until pickup passed, then P5 + N1.
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
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 8000);
const MATRIX = 'reports/cab-cancel-validation-matrix.json';
const OUT = 'reports/cab-cancel-validation-matrix.json';

if (!password) {
  console.error('Set CAB_VENDOR_PASS');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => String(Date.now());
const fmt = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

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
  if (!data?.token) throw new Error('vendor login failed');
  return `Bearer ${data.token}`;
}
async function vendorFetch(auth, id) {
  const res = await fetch(
    `${DEV_URL}/api/v1/booking/bookingDetailsOps?bookingId=${encodeURIComponent(id)}`,
    { headers: { Authorization: auth } },
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
  return { http: res.status, ok: res.ok, data: await res.json().catch(() => null) };
}

async function findSoonestDt() {
  const probe = await cab.search(buildAirportSearchBody(fmt(Date.now() + 30 * 60e3)));
  const m = String(probe.data?.error?.message || '');
  const em = m.match(/earliest is ([0-9T:\-Z]+)/i);
  const earliest = em ? new Date(em[1]).getTime() : Date.now() + 125 * 60e3;
  for (const addH of [0, 0.5, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48]) {
    const dt = fmt(earliest + addH * 3600e3 + 5 * 60e3);
    const s = await cab.search(buildAirportSearchBody(dt));
    if ((s.data?.cabs || []).length > 0) return dt;
  }
  throw new Error('No inventory found within 48h of earliest');
}

async function book(dt, label) {
  const search = await cab.search(buildAirportSearchBody(dt));
  const selected = pickCab(search.data?.cabs);
  if (!selected) return { ok: false, label, dt, err: search.data };
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
  await sleep(SETTLE_MS);
  return {
    ok: /confirm/i.test(String(st.data?.status || '')),
    label,
    dt,
    br,
    status: st.data?.status,
    providerBookingId: st.data?.providerBookingId,
    pickupFromApi: st.data?.details?.pickupDatetime,
  };
}

async function advance(auth, vendorId, target) {
  const bd = await vendorFetch(auth, vendorId);
  const booking_id = bd.bookingId || vendorId;
  const partner = bd.cabPartner;
  const chauffeurId = Math.floor(Math.random() * 900000 + 100000);
  await vendorPost(auth, '/api/v1/tracking/driverDetails', {
    booking_id,
    chauffeur_id: String(chauffeurId),
    chauffeur_name: `Driver${chauffeurId}`,
    chauffeur_mobile_number: '9876512345',
    chauffeur_image: String(chauffeurId),
    vehicle_id: '123456',
    vehicle_name: 'SWIFT',
    vehicle_color: 'white',
    vehicle_registration_number: 'DL10A9999',
    vehicle_type: 'SWIFT',
    partner,
    is_reassigned: 0,
  });
  await sleep(2000);
  await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
    event: 'Left For pickup',
    order_referance_no: booking_id,
    latitude: '28.4951645',
    longitude: '77.0866388',
    timestamp: nowMs(),
    device_id: 'webapp1',
    total_travelled_fare: '0',
    partner,
  });
  await sleep(2000);
  if (target === 'arrived') {
    await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
      event: 'arrived',
      order_referance_no: booking_id,
      latitude: String(bd.sourceLatitude || 28.5201),
      longitude: String(bd.sourceLongitude || 77.1591),
      timestamp: nowMs(),
      device_id: 'webapp1',
      total_travelled_fare: '0',
      partner,
    });
    await sleep(2500);
  }
}

async function cancelUser(br) {
  const res = await client.request({
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
  const st = await cab.getBookingStatus(br);
  const result = res.data?.result || res.data?.error?.result || null;
  const cancelled =
    /cancel/i.test(String(st.data?.status || '')) ||
    /cancel/i.test(String(result?.bookingStatus || ''));
  return {
    http: res.status,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || null,
    result,
    statusAfter: st.data?.status,
    cancelled,
    data: res.data,
  };
}

async function snap(br) {
  const st = await cab.getBookingStatus(br);
  const pickupDatetime = st.data?.details?.pickupDatetime;
  return {
    br,
    status: st.data?.status,
    pickupDatetime,
    progress: st.data?.details?.progress,
    now: new Date().toISOString(),
    pickupPassed: pickupDatetime ? new Date(pickupDatetime).getTime() < Date.now() : null,
  };
}

function score(id, rule, expectAllow, cancelRes, snap) {
  const allowed = !!cancelRes.cancelled;
  const blocked = !allowed && cancelRes.http >= 400;
  let status = 'BUG';
  if (expectAllow && allowed) status = 'PASS';
  if (!expectAllow && blocked) status = 'PASS';
  return {
    id,
    rule,
    expect: expectAllow ? 'CANCEL ALLOWED' : 'CANCEL BLOCKED',
    actual: allowed
      ? `ALLOWED http=${cancelRes.http} statusAfter=${cancelRes.statusAfter}`
      : `BLOCKED http=${cancelRes.http} code=${cancelRes.code} msg=${cancelRes.message}`,
    pickupPassed: snap.pickupPassed,
    progress: snap.progress,
    status,
    br: snap.br,
    cancel: cancelRes,
    snap,
  };
}

const soonest = await findSoonestDt();
const allowDt = soonest;
const blockDt = fmt(new Date(soonest).getTime() + 10 * 60e3);
console.log('Booking past fixtures at', allowDt, blockDt);

const bookAllow = await book(allowDt, 'P5');
const bookBlock = await book(blockDt, 'N1');
console.log('fixtures', bookAllow, bookBlock);
if (!bookAllow.ok || !bookBlock.ok) {
  console.error('Could not book past fixtures');
  process.exit(2);
}

const waitUntil =
  Math.max(
    new Date(bookAllow.pickupFromApi || bookAllow.dt).getTime(),
    new Date(bookBlock.pickupFromApi || bookBlock.dt).getTime(),
  ) + 60_000;
console.log('Waiting until', new Date(waitUntil).toISOString());
while (Date.now() < waitUntil) {
  const left = waitUntil - Date.now();
  console.log(`... ${Math.round(left / 1000)}s left`);
  await sleep(Math.min(5 * 60_000, left));
}

const auth = await vendorLogin();

await advance(auth, bookAllow.providerBookingId, 'left');
const snap5 = await snap(bookAllow.br);
const cancel5 = await cancelUser(bookAllow.br);
const row5 = score(
  'P5',
  'POSITIVE: past pickup + left (not arrived) → allow',
  true,
  cancel5,
  snap5,
);
console.log('P5', row5.status, row5.actual);

await advance(auth, bookBlock.providerBookingId, 'arrived');
const snapN = await snap(bookBlock.br);
const cancelN = await cancelUser(bookBlock.br);
const rowN = score(
  'N1',
  'NEGATIVE: past pickup + driver ARRIVED → block',
  false,
  cancelN,
  snapN,
);
console.log('N1', rowN.status, rowN.actual, 'pickupPassed=', snapN.pickupPassed, 'reached=', snapN.progress?.cabReachedSource);

let base = { rows: [] };
try {
  base = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
} catch {
  base = { rows: [] };
}
const rows = (base.rows || []).filter((r) => r.id !== 'P5' && r.id !== 'N1');
rows.push(row5, rowN);
const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
};
const report = {
  ...base,
  ranAt: new Date().toISOString(),
  partial: false,
  pastPickupCompletedAt: new Date().toISOString(),
  summary,
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('=== FINAL SUMMARY ===', JSON.stringify(summary));
for (const r of rows) console.log(`${r.id} ${r.status} | ${r.rule}`);
console.log('Wrote', OUT);
