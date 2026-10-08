/**
 * Cab lifecycle sim on api-staging + capture status snapshots for webhook compare.
 *   BASE_URL=https://api-staging.travelvip.ai
 *   CAB_BOOKING_REF=BR...
 *   CAB_VENDOR_BOOKING_ID=TVIPWE...
 *   CAB_VENDOR_USER=gyanesh CAB_VENDOR_PASS=...
 *   node scripts/cab-webhook-e2e-simulate.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';

const DEV_URL = 'https://travelvip-dev.bookairportcab.com';
const br = process.env.CAB_BOOKING_REF || 'BR1788765729128745';
const vendorBookingId = process.env.CAB_VENDOR_BOOKING_ID || 'TVIPWE070926125209LO34';
const username = process.env.CAB_VENDOR_USER || 'gyanesh';
const password = process.env.CAB_VENDOR_PASS || '';
const OUT = 'reports/cab-webhook-e2e-simulate.json';

if (!password) {
  console.error('Set CAB_VENDOR_PASS');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => String(Date.now());

async function vendorLogin() {
  const res = await fetch(`${DEV_URL}/auth/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data?.token) throw new Error(`vendor login failed: ${JSON.stringify(data)}`);
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

clearSession();
process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const { client } = await authenticate(true);
const cab = new CabService(client);
const auth = await vendorLogin();
const bd = await vendorFetch(auth, vendorBookingId);
if (!bd) {
  console.error('Vendor booking not found', vendorBookingId);
  process.exit(2);
}

const booking_id = bd.bookingId || vendorBookingId;
const partner = bd.cabPartner;
const steps = [];

async function snap(label) {
  await sleep(2000);
  const st = await cab.getBookingStatus(br);
  const row = {
    label,
    tvHttp: st.status,
    status: st.data?.status,
    progress: st.data?.details?.progress,
    assignment: st.data?.details?.assignment,
    trip: st.data?.details?.trip,
    otp: st.data?.details?.otp,
    providerBookingId: st.data?.providerBookingId || null,
  };
  steps.push(row);
  console.log(`[${label}] status=${row.status} assigned=${row.progress?.cabAssigned} left=${row.progress?.cabLeftForPickup} arrived=${row.progress?.cabReachedSource} started=${row.progress?.cabTripStarted} end=${row.progress?.cabTripEnd}`);
  return row;
}

await snap('before');

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
  vehicle_registration_number: `DL${Math.floor(Math.random() * 90 + 10)}AB${Math.floor(Math.random() * 9000 + 1000)}`,
  vehicle_type: 'SWIFT',
  partner,
  is_reassigned: 0,
});
steps.push({ label: 'vendor_assign', ...assign });
await snap('after_assign');

const left = await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
  event: 'Left For pickup',
  order_referance_no: booking_id,
  latitude: '28.4951645',
  longitude: '77.0866388',
  timestamp: now(),
  device_id: 'webapp1',
  total_travelled_fare: '0',
  partner,
});
steps.push({ label: 'vendor_left', ...left });
await snap('after_left');

// pre-trip GPS ping (should map to driver.enroute outbound)
const enroutePing = await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
  event: 'location',
  order_referance_no: booking_id,
  latitude: '28.5100',
  longitude: '77.1000',
  timestamp: now(),
  device_id: 'webapp1',
  total_travelled_fare: '0',
  partner,
});
steps.push({ label: 'vendor_cab_location_pretrip', note: 'may be CAB_LOCATION path depending on vendor API', ...enroutePing });

const arrived = await vendorPost(auth, '/api/v1/tracking/createCabTripTracking', {
  event: 'arrived',
  order_referance_no: booking_id,
  latitude: String(bd.sourceLatitude || 28.5201),
  longitude: String(bd.sourceLongitude || 77.1591),
  timestamp: now(),
  device_id: 'webapp1',
  total_travelled_fare: '0',
  partner,
});
steps.push({ label: 'vendor_arrived', ...arrived });
await snap('after_arrived');

const start = await vendorPost(auth, '/api/v1/tracking/tripDetails', {
  trip_event: 'start',
  booking_id,
  latitude: String(bd.sourceLatitude || 28.5201),
  longitude: String(bd.sourceLongitude || 77.1591),
  merutimestamp: now(),
  device_id: 'webapp1',
  partner,
  total_travelled_fare: '1100',
  reason: 'Start reason',
  extra_travelled_km: '0',
  extra_travelled_fare: '0',
  night_charges: '0',
});
steps.push({ label: 'vendor_trip_start', ...start });
await snap('after_trip_start');

const end = await vendorPost(auth, '/api/v1/tracking/tripDetails', {
  trip_event: 'stop',
  booking_id,
  latitude: String(bd.destinationLatitude || 28.5588),
  longitude: String(bd.destinationLongitude || 77.0814),
  merutimestamp: now(),
  device_id: 'webapp1',
  partner,
  total_travelled_fare: '1100',
  reason: 'End reason',
  extra_travelled_km: '5',
  extra_travelled_fare: '500',
  night_charges: '0',
});
steps.push({ label: 'vendor_trip_end', ...end });
await snap('after_trip_end');

const report = {
  ranAt: new Date().toISOString(),
  br,
  vendorBookingId,
  booking_id,
  partner,
  steps,
  dbSqlAfter: {
    trip: `SELECT event, provider_timestamp, provider_datetime, latitude, longitude FROM booking_item_cab_trip WHERE booking_item_cab_id=(SELECT bic.id FROM booking b JOIN booking_item bi ON bi.booking_id=b.id AND bi.service_type='cabs' JOIN booking_item_cab bic ON bic.booking_item_id=bi.id WHERE b.booking_reference='${br}') ORDER BY event`,
    cabTotals: `SELECT otp, total_travelled_km, total_travelled_fare, extra_travelled_km, extra_travelled_fare, night_charges, reason FROM booking_item_cab WHERE id=(SELECT bic.id FROM booking b JOIN booking_item bi ON bi.booking_id=b.id AND bi.service_type='cabs' JOIN booking_item_cab bic ON bic.booking_item_id=bi.id WHERE b.booking_reference='${br}')`,
    statusHistory: `SELECT m.status_code, h.provider_timestamp FROM booking_item_status_history h JOIN booking_status_mapping m ON m.id=h.status_mapping_id JOIN booking_item bi ON bi.id=h.booking_item_id JOIN booking b ON b.id=bi.booking_id WHERE b.booking_reference='${br}' ORDER BY h.id`,
  },
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('Report:', OUT);
console.log(JSON.stringify({
  br,
  vendorBookingId,
  last: steps.filter((s) => s.label?.startsWith('after_')).pop(),
}, null, 2));
