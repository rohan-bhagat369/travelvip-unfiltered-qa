/**
 * Cab cancel-guard probe (api-staging).
 * Rule: USER cannot cancel ONLY when pickup time has passed AND driver reached pickup.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'
 *   $env:CAB_VENDOR_USER='gyanesh'; $env:CAB_VENDOR_PASS='...'
 *   node scripts/probe-cab-cancel-guard.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const DEV_URL = 'https://travelvip-dev.bookairportcab.com';
const username = process.env.CAB_VENDOR_USER || 'gyanesh';
const password = process.env.CAB_VENDOR_PASS || '';
const OUT = 'reports/cab-cancel-guard-probe.json';

if (!password) {
  console.error('Set CAB_VENDOR_PASS');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => String(Date.now());
const brief = (d, n = 400) => JSON.stringify(d)?.slice(0, n);

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

async function bookAirport(pickupDatetime) {
  const searchBody = buildAirportSearchBody(pickupDatetime);
  const search = await cab.search(searchBody);
  const selected = pickCab(search.data?.cabs);
  if (!selected) {
    return {
      ok: false,
      stage: 'search',
      pickupDatetime,
      http: search.status,
      err: search.data?.error || search.data,
      cabs: search.data?.cabs?.length || 0,
    };
  }
  const fare = await cab.fare(selected.searchId);
  if (!fare.data?.bookingReference || !fare.data?.priceId) {
    return { ok: false, stage: 'fare', pickupDatetime, fare: fare.data };
  }
  const book = await cab.finalizeBooking(
    buildFinalizeBody({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
    }),
  );
  const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
  let st = await cab.getBookingStatus(br);
  for (let i = 0; i < 14 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
    await sleep(2500);
    st = await cab.getBookingStatus(br);
    console.log('  poll', st.data?.status);
  }
  const det = await client.request({
    method: 'GET',
    path: `/v1/airportServices/cabs/booking/${br}`,
    query: CAB_QUERY,
    correlation: true,
  });
  const providerBookingId =
    st.data?.providerBookingId ||
    det.data?.providerBookingId ||
    det.data?.data?.providerBookingId ||
    null;
  return {
    ok: /confirm/i.test(String(st.data?.status || '')),
    stage: 'booked',
    pickupDatetime,
    br,
    status: st.data?.status,
    providerBookingId,
    otp: st.data?.details?.otp,
    pickupFromApi: st.data?.details?.pickupDatetime || det.data?.details?.pickupDatetime,
    progress: st.data?.details?.progress,
  };
}

async function cancelUser(br) {
  const res = await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    body: {
      cancelledBy: 'USER',
      cancellationReason: 'Cancel guard probe — automation',
    },
  });
  return {
    http: res.status,
    ok: res.ok,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || res.data?.message || null,
    status: res.data?.status || null,
    data: res.data,
  };
}

async function cancelGet(br) {
  const res = await cab.cancelBooking(br);
  return {
    http: res.status,
    ok: res.ok,
    code: res.data?.error?.code || null,
    message: res.data?.error?.message || res.data?.message || null,
    status: res.data?.status || null,
    data: res.data,
  };
}

async function statusSnap(br) {
  const st = await cab.getBookingStatus(br);
  const pickupDatetime = st.data?.details?.pickupDatetime || null;
  return {
    br,
    status: st.data?.status,
    pickupDatetime,
    progress: st.data?.details?.progress,
    now: new Date().toISOString(),
    pickupPassed: pickupDatetime ? new Date(pickupDatetime).getTime() < Date.now() : null,
  };
}

async function advanceTo(auth, vendorId, target) {
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
      vehicle_registration_number: `DL${Math.floor(Math.random() * 90 + 10)}A${Math.floor(Math.random() * 9000 + 1000)}`,
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
    out.steps.push({ label: 'arrived', http: arrived.http, ok: arrived.ok, data: arrived.data });
    await sleep(2500);
  }
  return out;
}

function score({ id, rule, expectAllow, cancelRes, snap, extra }) {
  const allowed =
    cancelRes.ok === true ||
    /cancel/i.test(String(cancelRes.status || '')) ||
    cancelRes.http === 200;
  const blocked = !allowed && cancelRes.http >= 400;
  let status = 'BUG';
  if (expectAllow && allowed) status = 'PASS';
  if (!expectAllow && blocked) status = 'PASS';
  return {
    id,
    rule,
    expect: expectAllow ? 'CANCEL ALLOWED' : 'CANCEL BLOCKED',
    actual: allowed
      ? `ALLOWED http=${cancelRes.http} status=${cancelRes.status}`
      : `BLOCKED http=${cancelRes.http} code=${cancelRes.code} msg=${cancelRes.message}`,
    pickupPassed: snap?.pickupPassed,
    progress: snap?.progress,
    status,
    br: snap?.br,
    cancel: cancelRes,
    snap,
    ...extra,
  };
}

const rows = [];
const notes = [];
const auth = await vendorLogin();
console.log('vendor login ok');

// Lead-time constraint from API: AIRPORT/OUTSTATION/RENTAL need ~2h notice.
// Near-term inventory often empty; past-pickup cases need a booking whose pickup already passed.
notes.push(
  'Search enforces ~2h lead time; cannot book past pickup. Past-pickup cases need an existing Confirmed BR with pickup < now, or wait after earliest book.',
);

// A: future pickup, not arrived → ALLOW
{
  console.log('\n=== A future pickup, confirmed only');
  const booked = await bookAirport(futurePickupDatetime(10));
  console.log('A', booked.br, booked.status, booked.providerBookingId);
  if (!booked.ok) {
    rows.push({ id: 'A', rule: 'Future pickup + not arrived → allow', status: 'NOT TESTED', detail: booked });
  } else {
    const snap = await statusSnap(booked.br);
    const cancelRes = await cancelUser(booked.br);
    rows.push(
      score({
        id: 'A',
        rule: 'Future pickup + not arrived → USER cancel allowed',
        expectAllow: true,
        cancelRes,
        snap,
      }),
    );
    console.log('A cancel', cancelRes.http, cancelRes.code || cancelRes.status);
  }
}

// B: future pickup + arrived → ALLOW
{
  console.log('\n=== B future pickup + driver arrived');
  const booked = await bookAirport(futurePickupDatetime(11));
  console.log('B', booked.br, booked.status, booked.providerBookingId);
  if (!booked.ok || !booked.providerBookingId) {
    rows.push({ id: 'B', rule: 'Future pickup + arrived → allow', status: 'NOT TESTED', detail: booked });
  } else {
    const vendor = await advanceTo(auth, booked.providerBookingId, 'arrived');
    const snap = await statusSnap(booked.br);
    const cancelRes = await cancelUser(booked.br);
    rows.push(
      score({
        id: 'B',
        rule: 'Future pickup + driver arrived → USER cancel allowed',
        expectAllow: true,
        cancelRes,
        snap,
        extra: { vendor },
      }),
    );
    console.log(
      'B cancel',
      cancelRes.http,
      cancelRes.code || cancelRes.status,
      'reached=',
      snap.progress?.cabReachedSource,
    );
  }
}

// C/D: try to use an env-provided past-pickup BR, else attempt earliest book + note wait
const pastBr = process.env.CAB_PAST_PICKUP_BR;
const pastVendor = process.env.CAB_PAST_PICKUP_VENDOR;

if (pastBr && pastVendor) {
  console.log('\n=== C/D using provided past-pickup BR', pastBr);
  // C: if not arrived yet, left only then cancel — but we don't know state. For D arrive then cancel.
  const snap0 = await statusSnap(pastBr);
  console.log('past snap', snap0);
  if (!snap0.pickupPassed) {
    rows.push({
      id: 'C',
      rule: 'Past pickup + not arrived → allow',
      status: 'NOT TESTED',
      detail: 'Provided BR pickup not yet passed',
      snap: snap0,
    });
    rows.push({
      id: 'D',
      rule: 'Past pickup + arrived → block',
      status: 'NOT TESTED',
      detail: 'Provided BR pickup not yet passed',
      snap: snap0,
    });
  } else {
    // If already arrived, only D. Else left then C on one BR is destructive.
    const reached = !!snap0.progress?.cabReachedSource;
    if (!reached) {
      // advance to left only, cancel = C
      await advanceTo(auth, pastVendor, 'left');
      const snapC = await statusSnap(pastBr);
      const cancelC = await cancelUser(pastBr);
      rows.push(
        score({
          id: 'C',
          rule: 'Past pickup + not arrived (left only) → USER cancel allowed',
          expectAllow: true,
          cancelRes: cancelC,
          snap: snapC,
        }),
      );
      rows.push({
        id: 'D',
        rule: 'Past pickup + arrived → block',
        status: 'NOT TESTED',
        detail: 'Used same BR for C cancel; provide second past-pickup BR for D',
      });
    } else {
      rows.push({
        id: 'C',
        rule: 'Past pickup + not arrived → allow',
        status: 'NOT TESTED',
        detail: 'BR already arrived',
      });
      const cancelD = await cancelUser(pastBr);
      const cancelDGet = await cancelGet(pastBr);
      const row = score({
        id: 'D',
        rule: 'Past pickup + driver arrived → USER cancel blocked',
        expectAllow: false,
        cancelRes: cancelD,
        snap: snap0,
        extra: { getCancel: cancelDGet },
      });
      rows.push(row);
    }
  }
} else {
  // Book one for D path that we can leave running: earliest ~2h15m, advance to arrived AFTER wait — too long for interactive.
  // Instead: book future, advance to arrived, then try to see if cancel is wrongly blocked (B already covers allow).
  // For C/D mark NOT TESTED with clear instruction.
  rows.push({
    id: 'C',
    rule: 'Past pickup + not arrived → USER cancel allowed',
    status: 'NOT TESTED',
    detail:
      'Cannot create past pickup via search (2h lead). Re-run with CAB_PAST_PICKUP_BR + CAB_PAST_PICKUP_VENDOR after pickup time passes, before Arrived.',
  });
  rows.push({
    id: 'D',
    rule: 'Past pickup + driver arrived → USER cancel blocked',
    status: 'NOT TESTED',
    detail:
      'Cannot create past pickup via search (2h lead). Re-run with CAB_PAST_PICKUP_BR + CAB_PAST_PICKUP_VENDOR after pickup passed + Arrived on sim page.',
  });

  // Bonus E: future pickup + left (not arrived) → ALLOW
  console.log('\n=== E future pickup + left only');
  const bookedE = await bookAirport(futurePickupDatetime(12));
  console.log('E', bookedE.br, bookedE.status, bookedE.providerBookingId);
  if (bookedE.ok && bookedE.providerBookingId) {
    const vendor = await advanceTo(auth, bookedE.providerBookingId, 'left');
    const snap = await statusSnap(bookedE.br);
    const cancelRes = await cancelUser(bookedE.br);
    rows.push(
      score({
        id: 'E',
        rule: 'Future pickup + left for pickup (not arrived) → USER cancel allowed',
        expectAllow: true,
        cancelRes,
        snap,
        extra: { vendor },
      }),
    );
    console.log('E cancel', cancelRes.http, cancelRes.code || cancelRes.status);
  } else {
    rows.push({ id: 'E', rule: 'Future + left → allow', status: 'NOT TESTED', detail: bookedE });
  }
}

const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
};

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  rule: 'Users cannot cancel only if pickup time has passed AND driver has reached pickup location',
  notes,
  summary,
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', JSON.stringify(summary));
for (const r of rows) {
  console.log(`${r.id} ${r.status} | ${r.rule} | ${r.actual || brief(r.detail)}`);
}
console.log('Wrote', OUT);
