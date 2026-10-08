/**
 * Retry A3 trip-lifecycle events on an existing vendor booking.
 * Usage:
 *   CAB_VENDOR_PASS=... CAB_BOOKING_REF=BR... CAB_VENDOR_BOOKING_ID=TVIPWE...
 *   node scripts/probe-cab-a3-trip-retry.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';

const DEV_URL = 'https://travelvip-dev.bookairportcab.com';
const username = process.env.CAB_VENDOR_USER || 'gyanesh';
const password = process.env.CAB_VENDOR_PASS || '';
const tvipBr = process.env.CAB_BOOKING_REF || 'BR1787744137248898';
const vendorBookingId =
  process.env.CAB_VENDOR_BOOKING_ID || 'TVIPWE2608261705379F51';

async function post(auth, path, body) {
  const res = await fetch(`${DEV_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { http: res.status, ok: res.ok, data };
}

async function main() {
  if (!password) throw new Error('CAB_VENDOR_PASS required');

  const { client } = await authenticate();
  const cab = new CabService(client);
  const out = [];

  const login = await (
    await fetch(`${DEV_URL}/auth/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  ).json();
  if (!login?.token) throw new Error('vendor login failed');
  const auth = `Bearer ${login.token}`;

  const fetchData = await (
    await fetch(
      `${DEV_URL}/api/v1/booking/bookingDetailsOps?bookingId=${encodeURIComponent(vendorBookingId)}`,
      { headers: { Authorization: auth, correlationId: crypto.randomUUID() } },
    )
  ).json();
  const bd = fetchData?.data?.[0];
  if (!bd) throw new Error(`vendor fetch failed: ${JSON.stringify(fetchData)}`);
  const partner = bd.cabPartner;
  const booking_id = bd.bookingId;

  const before = await cab.getBookingStatus(tvipBr);
  out.push({
    step: 'before',
    status: before.data?.status,
    progress: before.data?.details?.progress,
    trip: before.data?.details?.trip,
  });

  // Try several Trip Start payload variants — vendor accepted prior string but TVIP did not advance
  const variants = [
    {
      id: 'TS1',
      event: 'Trip Start',
      order_referance_no: booking_id,
    },
    {
      id: 'TS2',
      event: 'Trip Started',
      order_referance_no: booking_id,
    },
    {
      id: 'TS3',
      event: 'Trip Start',
      order_referance_no: `MJB${booking_id}`,
    },
    {
      id: 'TS4',
      event: 'cabTripStarted',
      order_referance_no: booking_id,
    },
  ];

  for (const v of variants) {
    const body = {
      event: v.event,
      order_referance_no: v.order_referance_no,
      latitude: '28.5201',
      longitude: '77.1591',
      timestamp: String(Date.now()),
      device_id: 'webapp1',
      total_travelled_fare: '0',
      partner,
    };
    const r = await post(auth, '/api/v1/tracking/createCabTripTracking', body);
    await new Promise((x) => setTimeout(x, 2000));
    const st = await cab.getBookingStatus(tvipBr);
    out.push({
      step: v.id,
      sent: body,
      vendor: r,
      tvip: {
        status: st.data?.status,
        progress: st.data?.details?.progress,
        trip: st.data?.details?.trip,
      },
    });
    if (st.data?.details?.progress?.cabTripStarted) {
      out.push({ step: 'tripStarted_ok_with', variant: v.id });
      break;
    }
  }

  // If started, fire Trip End + Trip End With Extra Km
  const mid = await cab.getBookingStatus(tvipBr);
  if (mid.data?.details?.progress?.cabTripStarted) {
    for (const e of [
      { id: 'TE1', event: 'Trip End' },
      { id: 'TE2', event: 'Trip End With Extra Km', total_travelled_fare: '150' },
    ]) {
      const body = {
        event: e.event,
        order_referance_no: booking_id,
        latitude: '28.5588',
        longitude: '77.0814',
        timestamp: String(Date.now()),
        device_id: 'webapp1',
        total_travelled_fare: e.total_travelled_fare || '0',
        partner,
      };
      const r = await post(auth, '/api/v1/tracking/createCabTripTracking', body);
      await new Promise((x) => setTimeout(x, 2000));
      const st = await cab.getBookingStatus(tvipBr);
      out.push({
        step: e.id,
        sent: body,
        vendor: r,
        tvip: {
          status: st.data?.status,
          progress: st.data?.details?.progress,
          trip: st.data?.details?.trip,
        },
      });
    }
  }

  const after = await cab.getBookingStatus(tvipBr);
  out.push({
    step: 'after',
    status: after.data?.status,
    progress: after.data?.details?.progress,
    trip: after.data?.details?.trip,
    assignment: after.data?.details?.assignment,
  });

  fs.writeFileSync(
    'reports/cab-a3-trip-retry.json',
    JSON.stringify({ tvipBr, vendorBookingId, out }, null, 2),
  );
  console.log(JSON.stringify({ tvipBr, vendorBookingId, out }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
