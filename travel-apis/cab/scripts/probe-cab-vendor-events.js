/**
 * Probe vendor travelvip-dev event simulator APIs.
 * Usage:
 *   set CAB_VENDOR_USER=...
 *   set CAB_VENDOR_PASS=...
 *   set CAB_BOOKING_REF=BR...              (optional; creates one if missing)
 *   set CAB_VENDOR_BOOKING_ID=TVIPWE...    (required for fetch — NOT the TravelVIP BR)
 *   node scripts/probe-cab-vendor-events.js
 *
 * Vendor fetch uses provider booking id (e.g. TVIPWE2608261705379F51), stored as
 * booking_item_cab.provider_booking_id — TravelVIP BR returns 404 on the simulator.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
} from '../src/helpers.js';

const DEV_URL = 'https://travelvip-dev.bookairportcab.com';
const username = process.env.CAB_VENDOR_USER || 'gyanesh';
const password = process.env.CAB_VENDOR_PASS || '';

function summarize(data) {
  if (data == null) return null;
  if (typeof data === 'string') return data.slice(0, 500);
  return data;
}

async function main() {
  if (!password) {
    console.error('Set CAB_VENDOR_PASS env var');
    process.exit(1);
  }

  const out = [];

  // --- TravelVIP: ensure we have a BR ---
  const { client } = await authenticate();
  const cab = new CabService(client);
  let bookingRefId = process.env.CAB_BOOKING_REF || '';
  let vendorBookingId = process.env.CAB_VENDOR_BOOKING_ID || '';

  if (!bookingRefId) {
    const search = await cab.search(buildAirportSearchBody());
    const selected =
      (search.data?.cabs || []).find((c) =>
        /carzon/i.test(c.operator?.name || ''),
      ) || pickCab(search.data?.cabs);
    const fare = await cab.fare(selected.searchId);
    const book = await cab.finalizeBooking(
      buildFinalizeBody({
        bookingReference: fare.data.bookingReference,
        priceId: fare.data.priceId,
      }),
    );
    bookingRefId = book.data?.bookingRefId;
    out.push({
      step: 'createBooking',
      bookingRefId,
      bookStatus: book.data?.status,
      operator: fare.data?.operator?.name,
      note: 'Look up booking_item_cab.provider_booking_id (TVIPWE…) for CAB_VENDOR_BOOKING_ID',
    });
  }

  if (!vendorBookingId) {
    console.log(JSON.stringify(out, null, 2));
    console.error(
      'Set CAB_VENDOR_BOOKING_ID=TVIPWE… (from booking_item_cab.provider_booking_id). TravelVIP BR does not work on vendor fetch.',
    );
    process.exit(2);
  }

  const tvStatus1 = await cab.getBookingStatus(bookingRefId);
  out.push({
    step: 'travelVipStatus_before',
    http: tvStatus1.status,
    status: tvStatus1.data?.status,
    assignment: tvStatus1.data?.details?.assignment || null,
    progress: tvStatus1.data?.details?.progress || null,
  });

  // --- Vendor login ---
  const loginRes = await fetch(`${DEV_URL}/auth/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginData = await loginRes.json().catch(() => null);
  out.push({
    step: 'vendorLogin',
    http: loginRes.status,
    ok: Boolean(loginData?.token),
    keys: loginData && typeof loginData === 'object' ? Object.keys(loginData) : [],
  });

  if (!loginData?.token) {
    console.log(JSON.stringify(out, null, 2));
    console.error('Vendor login failed');
    process.exit(1);
  }

  const authHeader = `Bearer ${loginData.token}`;

  // --- Fetch booking with vendor provider id (TVIPWE…), not TravelVIP BR ---
  const fetchRes = await fetch(
    `${DEV_URL}/api/v1/booking/bookingDetailsOps?bookingId=${encodeURIComponent(vendorBookingId)}`,
    {
      headers: {
        Authorization: authHeader,
        correlationId: crypto.randomUUID(),
      },
    },
  );
  const fetchData = await fetchRes.json().catch((e) => ({ parseError: String(e) }));
  const bookingDetails =
    fetchData?.status === 'success' && Array.isArray(fetchData.data)
      ? fetchData.data[0]
      : null;

  out.push({
    step: 'vendorFetchBooking',
    bookingIdTried: vendorBookingId,
    travelVipBr: bookingRefId,
    http: fetchRes.status,
    vendorStatus: fetchData?.status,
    message: fetchData?.message,
    found: Boolean(bookingDetails),
    bookingDetails: bookingDetails
      ? {
          bookingId: bookingDetails.bookingId,
          cabPartner: bookingDetails.cabPartner,
          status: bookingDetails.status || bookingDetails.bookingStatus,
          destinationLatitude: bookingDetails.destinationLatitude,
          destinationLongitude: bookingDetails.destinationLongitude,
        }
      : summarize(fetchData),
  });

  if (!bookingDetails) {
    console.log(JSON.stringify(out, null, 2));
    console.error('Could not fetch booking on vendor side — simulator flow blocked');
    process.exit(2);
  }

  // --- Assign chauffer (use TVIPWE id as booking_id — MJB+BR does not work) ---
  const booking_id = bookingDetails.bookingId;
  const partner = bookingDetails.cabPartner;
  const chauffeurId = Math.floor(Math.random() * 900000 + 100000);
  const vehicleId = String(Math.floor(100000 + Math.random() * 899999));

  const assignRes = await fetch(`${DEV_URL}/api/v1/tracking/driverDetails`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      booking_id,
      chauffeur_id: String(chauffeurId),
      chauffeur_name: `Driver${chauffeurId}`,
      chauffeur_mobile_number: `+9715${Math.floor(10000000 + Math.random() * 89999999)}`,
      chauffeur_image: String(chauffeurId),
      vehicle_id: vehicleId,
      vehicle_name: 'SWIFT',
      vehicle_color: 'white',
      vehicle_registration_number: `DL${Math.floor(Math.random() * 90 + 10)}A${Math.floor(Math.random() * 9000 + 1000)}`,
      vehicle_type: 'SWIFT',
      partner,
      is_reassigned: 0,
    }),
  });
  const assignData = await assignRes.json().catch(() => null);
  out.push({
    step: 'assignChauffeur',
    booking_id,
    partner,
    http: assignRes.status,
    data: summarize(assignData),
  });

  // --- Left for pickup ---
  const leftRes = await fetch(`${DEV_URL}/api/v1/tracking/createCabTripTracking`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event: 'Left For pickup',
      order_referance_no: booking_id,
      latitude: '28.4951645',
      longitude: '77.0866388',
      timestamp: String(Date.now()),
      device_id: 'webapp1',
      total_travelled_fare: '0',
      partner,
    }),
  });
  const leftData = await leftRes.json().catch(() => null);
  out.push({
    step: 'leftForPickup',
    http: leftRes.status,
    data: summarize(leftData),
  });

  // --- TravelVIP status after events ---
  await new Promise((r) => setTimeout(r, 2000));
  const tvStatus2 = await cab.getBookingStatus(bookingRefId);
  out.push({
    step: 'travelVipStatus_after',
    http: tvStatus2.status,
    status: tvStatus2.data?.status,
    assignment: tvStatus2.data?.details?.assignment || null,
    progress: tvStatus2.data?.details?.progress || null,
  });

  const working =
    Boolean(loginData?.token) &&
    Boolean(bookingDetails) &&
    assignRes.ok;

  out.push({
    step: 'verdict',
    vendorPortalLogin: 'WORKING',
    fetchBookingWithTravelVipBR: bookingDetails ? 'WORKING' : 'FAILED',
    assignChauffeur: assignRes.ok ? 'WORKING' : 'FAILED',
    leftForPickup: leftRes.ok ? 'WORKING' : 'CHECK',
    travelVipSeesAssignment: Boolean(tvStatus2.data?.details?.assignment)
      ? 'YES'
      : 'NO / not synced yet',
    overall: working ? 'Vendor simulator APIs are reachable and usable' : 'Partial / blocked',
  });

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
