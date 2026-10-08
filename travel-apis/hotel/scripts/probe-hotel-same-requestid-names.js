/**
 * Hotel: same X-Request-Id + different guest names -> compare bookingRefId.
 *
 * Run:
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-hotel-same-requestid-names.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  HOTEL_QUERY,
  buildSearchBody,
  buildFinalizeBody,
  extractRequestId,
  extractBookingContext,
  extractBookingCodes,
  buildGuests,
} from '../src/helpers.js';

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}
function brOf(data) {
  return data?.bookingRefId || data?.bookingReferenceId || data?.bookingReference || null;
}
function isDup(data) {
  const msg = `${data?.message || ''} ${data?.error?.message || ''} ${JSON.stringify(data || {})}`.toLowerCase();
  return data?.duplicate === true || msg.includes('duplicate payload') || msg.includes('duplicate request');
}
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}
function safeName(s) {
  return String(s || '').replace(/[^A-Za-z]/g, '');
}

async function extractTotalAmountFromDetail(detailData) {
  // Try common places first, but don’t assume schema shape.
  return (
    detailData?.salesSummary?.totalAmount ??
    detailData?.pricing?.totalAmount ??
    detailData?.totalAmount ??
    detailData?.totalPrice ??
    detailData?.price?.totalAmount ??
    detailData?.price?.amount ??
    null
  );
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  const searchBody = buildSearchBody({
    entityId: config.hotel.defaultEntityId,
    checkinDays: 22,
    nights: config.hotel.nights || 1,
  });

  // Using helper to ensure we have the requestId + bookingCode scoped to this search/room list.
  const { searchResponse, detailsResponse, requestId, bookingCodes } = await hotel.searchWithDetails(searchBody);
  if (!searchResponse?.ok || !detailsResponse?.ok) throw new Error(`hotel search/details failed`);
  if (!requestId) throw new Error('hotel: missing requestId');
  if (!bookingCodes?.length) throw new Error('hotel: no bookingCodes');

  const bookingCode = bookingCodes[0];
  const prebook = await hotel.prebook({ bookingCode, requestId });
  if (!ok(prebook) || !prebook.data) throw new Error(`hotel prebook failed http=${prebook.status}`);

  const bookingContext = extractBookingContext(prebook.data);
  if (!bookingContext) throw new Error('hotel: missing bookingContext after prebook');

  const baseFinalize = buildFinalizeBody({
    bookingContext,
    bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    guests: buildGuests(),
  });

  // Two guest-name variants (letters only).
  const guestA = { firstName: safeName('GuestAOne'), lastName: safeName('NameAOne') };
  const guestB = { firstName: safeName('GuestBTwo'), lastName: safeName('NameBTwo') };

  const payloadA = clone(baseFinalize);
  payloadA.rooms[0].guests[0].firstName = guestA.firstName;
  payloadA.rooms[0].guests[0].lastName = guestA.lastName;

  const payloadB = clone(baseFinalize);
  payloadB.rooms[0].guests[0].firstName = guestB.firstName;
  payloadB.rooms[0].guests[0].lastName = guestB.lastName;

  const fixedXRequestId = `req-sameid-hotel-oneway-${Date.now()}`;
  const query = { ...HOTEL_QUERY, page: 0, perpage: 20 };

  const fin1 = await client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query,
    body: payloadA,
    correlation: true,
    extraHeaders: { 'X-Request-Id': fixedXRequestId },
  });
  const br1 = brOf(fin1.data);

  const fin2 = await client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query,
    body: payloadB,
    correlation: true,
    extraHeaders: { 'X-Request-Id': fixedXRequestId },
  });
  const br2 = brOf(fin2.data);

  // Fetch detail for exact “price/total” (if exposed).
  const detail1 = br1
    ? await hotel.getBookingDetail(br1).catch(() => null)
    : null;
  const detail2 = br2
    ? await hotel.getBookingDetail(br2).catch(() => null)
    : null;

  const totalA = detail1?.data ? await extractTotalAmountFromDetail(detail1.data) : null;
  const totalB = detail2?.data ? await extractTotalAmountFromDetail(detail2.data) : null;

  const out = {
    xRequestId: fixedXRequestId,
    bookingCode,
    bookingContextPresent: Boolean(bookingContext),
    hit1: {
      http: fin1.status,
      bookingRefId: br1,
      duplicate: isDup(fin1.data),
      status: fin1.data?.status ?? fin1.data?.bookingStatus ?? null,
      message: fin1.data?.message ?? fin1.data?.error?.message ?? fin1.data?.status ?? null,
      totalFromDetail: totalA,
    },
    hit2: {
      http: fin2.status,
      bookingRefId: br2,
      duplicate: isDup(fin2.data),
      status: fin2.data?.status ?? fin2.data?.bookingStatus ?? null,
      message: fin2.data?.message ?? fin2.data?.error?.message ?? fin2.data?.status ?? null,
      totalFromDetail: totalB,
    },
    sameBR: !!(br1 && br2 && br1 === br2),
    createdNewBooking: !!(br1 && br2 && br1 !== br2 && !isDup(fin2.data)),
  };

  console.log(JSON.stringify(out, null, 2));

  // Persist for later reference.
  // eslint-disable-next-line no-undef
  const fs = await import('fs');
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/hotel-same-requestid-names.json', JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('hotel same-requestid probe failed:', e);
  process.exit(1);
});

