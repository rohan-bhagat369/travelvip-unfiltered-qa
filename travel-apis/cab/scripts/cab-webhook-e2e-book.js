/**
 * Step 1: book airport cab on api-staging for webhook e2e.
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/cab-webhook-e2e-book.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import { buildAirportSearchBody, buildFinalizeBody, pickCab, CAB_QUERY } from '../src/helpers.js';

clearSession();
process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';

const { client } = await authenticate(true);
const cab = new CabService(client);
const searchBody = buildAirportSearchBody();
const search = await cab.search(searchBody);
const selected =
  (search.data?.cabs || []).find((c) => /carzon/i.test(c.operator?.name || '')) ||
  pickCab(search.data?.cabs);
if (!selected) {
  console.error('NO_CABS', search.status, JSON.stringify(search.data).slice(0, 400));
  process.exit(1);
}

const fare = await cab.fare(selected.searchId);
const book = await cab.finalizeBooking(
  buildFinalizeBody({
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
  }),
);
const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
console.log('booked', br, book.data?.status);

let st = await cab.getBookingStatus(br);
for (let i = 0; i < 10 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
  await new Promise((r) => setTimeout(r, 2500));
  st = await cab.getBookingStatus(br);
  console.log('poll', st.data?.status);
}

const det = await client.request({
  method: 'GET',
  path: `/v1/airportServices/cabs/booking/${br}`,
  query: CAB_QUERY,
  correlation: true,
});

const sqlCab = `SELECT bic.id, bic.provider_booking_id, bic.otp,
  bic.vehicle_type, bic.vehicle_model, bic.operator_name, bic.extra_km_rate,
  bic.total_travelled_km, bic.total_travelled_fare,
  bic.extra_travelled_km, bic.extra_travelled_fare, bic.night_charges, bic.reason
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id AND bi.service_type = 'cabs'
JOIN booking_item_cab bic ON bic.booking_item_id = bi.id
WHERE b.booking_reference = '${br}'`;

const sqlLoc = `SELECT location_type, address, airport_code, latitude, longitude
FROM booking_item_cab_location
WHERE booking_item_cab_id = (
  SELECT bic.id FROM booking b
  JOIN booking_item bi ON bi.booking_id = b.id AND bi.service_type = 'cabs'
  JOIN booking_item_cab bic ON bic.booking_item_id = bi.id
  WHERE b.booking_reference = '${br}'
)`;

const sqlTrip = `SELECT event, provider_timestamp, provider_datetime, latitude, longitude
FROM booking_item_cab_trip
WHERE booking_item_cab_id = (
  SELECT bic.id FROM booking b
  JOIN booking_item bi ON bi.booking_id = b.id AND bi.service_type = 'cabs'
  JOIN booking_item_cab bic ON bic.booking_item_id = bi.id
  WHERE b.booking_reference = '${br}'
)
ORDER BY event`;

const out = {
  ranAt: new Date().toISOString(),
  baseUrl: process.env.BASE_URL,
  br,
  status: st.data?.status,
  otp: st.data?.details?.otp,
  extraKmRate: st.data?.details?.extraKmRate,
  airportCode: st.data?.details?.airportCode,
  pickup: st.data?.details?.pickup,
  drop: st.data?.details?.drop,
  vehicle: st.data?.details?.vehicle,
  operator: st.data?.details?.operator,
  progress: st.data?.details?.progress,
  salesSummary: st.data?.salesSummary || det.data?.salesSummary,
  fare: {
    extraKmRate: fare.data?.extraKmRate,
    extraKmFare: fare.data?.extraKmFare,
    extraKmFareLabel: fare.data?.extraKmFareLabel,
    vehicle: fare.data?.vehicle,
    operator: fare.data?.operator,
  },
  sql: { cab: sqlCab, locations: sqlLoc, trip: sqlTrip },
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(
  'reports/cab-webhook-e2e-book.json',
  JSON.stringify({ out, status: st.data, detail: det.data }, null, 2),
);
console.log(JSON.stringify(out, null, 2));
