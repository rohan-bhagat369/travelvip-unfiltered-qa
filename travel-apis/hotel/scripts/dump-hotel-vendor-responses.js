/**
 * Dump hotel details + prebook room snippets that contain the vendor in bookingCode.
 *   node scripts/dump-hotel-vendor-responses.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';

const OUT = path.join('reports', 'hotel-vendor-details-prebook.json');

function slimRoom(room) {
  if (!room) return null;
  return {
    bookingCode: room.bookingCode,
    supplierFromBookingCode: String(room.bookingCode || '').split('!TB!')[1] || null,
    title: room.title,
    name: room.name,
    roomType: room.roomType,
    mealType: room.mealType,
    refundable: room.refundable,
    isCancellable: room.isCancellable,
    isPANMandatory: room.isPANMandatory,
    isGSTClaimable: room.isGSTClaimable,
    price: room.price,
  };
}

function slimHotel(hotel) {
  if (!hotel) return null;
  return {
    id: hotel.id,
    name: hotel.name,
    rooms: (hotel.rooms || []).slice(0, 2).map(slimRoom),
  };
}

async function main() {
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays: 28,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.type = 'HOTEL';

  await hotel.search(searchBody);
  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data);
  const room0 = details.data?.results?.[0]?.rooms?.[0];
  const pre = room0?.bookingCode && requestId
    ? await hotel.prebook({ bookingCode: room0.bookingCode, requestId })
    : null;

  const report = {
    baseUrl: process.env.BASE_URL || 'https://api-staging.travelvip.ai',
    at: new Date().toISOString(),
    details: {
      method: 'POST',
      path: '/v1/hotels/details',
      http: details.status,
      requestId,
      hotel: slimHotel(details.data?.results?.[0]),
    },
    prebook: pre && {
      method: 'POST',
      path: '/v1/hotels/prebook',
      http: pre.status,
      ok: isPrebookSuccess(pre),
      requestId: pre.data?.requestId,
      bookingContextPresent: Boolean(pre.data?.bookingContext),
      hotel: slimHotel(pre.data?.results?.[0]),
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
