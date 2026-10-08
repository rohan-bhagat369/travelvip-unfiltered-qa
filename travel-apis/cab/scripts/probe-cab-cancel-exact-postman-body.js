import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';

clearSession();
process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const { client } = await authenticate(true);
const cab = new CabService(client);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(26)));
const selected = pickCab(search.data?.cabs);
const fare = await cab.fare(selected.searchId);
const book = await cab.finalizeBooking(
  buildFinalizeBody({
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
  }),
);
const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
let st = await cab.getBookingStatus(br);
for (let i = 0; i < 12 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
  await sleep(2000);
  st = await cab.getBookingStatus(br);
}
console.log('BR', br, st.data?.status);

// Exact body from Cab.postman_collection.json Cancel Booking request
const rawBody =
  '{\n  "cancelledBy": "USER",\n  "cancellationReason": "Customer flight rescheduled to next day"\n}\n';

const post = await client.request({
  method: 'POST',
  path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
  query: CAB_QUERY,
  partnerKey: client.partnerKey,
  signed: true,
  rawBody,
  extraHeaders: { Accept: 'application/json' },
});
const after = await cab.getBookingStatus(br);
console.log('POST exact Postman body', post.status, JSON.stringify(post.data).slice(0, 500));
console.log('after', after.data?.status);
