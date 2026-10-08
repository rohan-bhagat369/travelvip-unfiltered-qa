/**
 * Retest A2 on /api/airportServices/updateAirportServiceBooking with key+pid.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { createRequestId, createSignature, createTimestamp } from '../../../shared/lib/signature.js';
import fs from 'fs';

const br = process.env.CAB_BOOKING_REF || 'BR1787744137248898';
const vendorBookingId = process.env.CAB_VENDOR_BOOKING_ID || 'TVIPWE2608261705379F51';

async function post(client, path, query, body) {
  const bodyString = JSON.stringify(body);
  const timestamp = createTimestamp();
  const signature = createSignature(bodyString, timestamp, client.signingKey);
  const url = new URL(path, client.baseUrl);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.authToken}`,
      'X-Partner-Key': client.partnerKey,
      'X-Request-Id': createRequestId(),
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Correlation-ID': client.correlationId,
    },
    body: bodyString,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  const { client } = await authenticate(true);
  const rows = [];

  const mismatch = {
    bookingId: 'TVIPWE_WRONG_ID_XXXX',
    bookingRefId: br,
    assignment: {
      driverName: 'MismatchDriver',
      driverMobile: '+911111111111',
      vehicleRegistrationNo: 'DL00X0000',
    },
  };
  const good = {
    bookingId: vendorBookingId,
    bookingRefId: br,
    providerBookingId: vendorBookingId,
    assignment: {
      driverName: 'ApiEndpointDriver',
      driverMobile: '+918888888888',
      vehicleRegistrationNo: 'DL88Z8888',
      vehicleName: 'SWIFT',
      vehicleColor: 'black',
      partner: 'CARZONRENT',
      assignedAt: new Date().toISOString(),
    },
  };

  const queryVariants = [
    { label: 'key+pid', query: { key: client.partnerKey, pid: config.partnerId, lang: 'en', currency: 'INR' } },
    { label: 'pid-only', query: { pid: config.partnerId, lang: 'en', currency: 'INR' } },
    { label: 'key=partnerId', query: { key: config.partnerId, pid: config.partnerId, lang: 'en', currency: 'INR' } },
  ];

  for (const qv of queryVariants) {
    const bad = await post(client, '/api/airportServices/updateAirportServiceBooking', qv.query, mismatch);
    rows.push({
      case: `mismatch.${qv.label}`,
      http: bad.status,
      code: bad.data?.error?.code || bad.data?.code,
      message: bad.data?.error?.message || bad.data?.message,
      body: bad.data,
    });
    const ok = await post(client, '/api/airportServices/updateAirportServiceBooking', qv.query, good);
    rows.push({
      case: `callback.${qv.label}`,
      http: ok.status,
      code: ok.data?.error?.code || ok.data?.code || ok.data?.status,
      message: ok.data?.error?.message || ok.data?.message,
      body: ok.data,
    });
  }

  // Also confirm v1 still works for good assignment
  const v1 = await post(client, '/v1/airportServices/cabs/update-booking', { lang: 'en', currency: 'INR' }, good);
  rows.push({
    case: 'callback.v1',
    http: v1.status,
    code: v1.data?.error?.code || v1.data?.status,
    message: v1.data?.message || v1.data?.error?.message,
    body: v1.data,
  });

  fs.writeFileSync('reports/cab-a2-api-endpoint.json', JSON.stringify({ br, vendorBookingId, rows }, null, 2));
  console.log(JSON.stringify({ br, vendorBookingId, rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
