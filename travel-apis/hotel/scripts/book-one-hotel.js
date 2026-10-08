/**
 * One-shot hotel booking — prints BR and leaves it active (no cancel).
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';

async function main() {
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);

  console.log('Base URL:', config.baseUrl);
  console.log('Searching hotel entityId:', config.hotel.defaultEntityId);

  const autocomplete = await hotel.autocomplete();
  if (autocomplete.ok) {
    const name = autocomplete.data?.results?.[0]?.name || autocomplete.data?.[0]?.name;
    console.log('Autocomplete sample:', name || 'ok');
  }

  const booking = await hotel.bookUntilConfirmed({
    entityId: config.hotel.defaultEntityId,
    checkinDayCandidates: config.hotel.checkinDayCandidates,
    nights: config.hotel.nights,
  });

  const detail = await hotel.getBookingDetail(booking.bookingRefId);
  const hotelInfo = detail.data?.hotel || detail.data?.bookingResponse?.hotel || detail.data?.details;
  const pricing = detail.data?.pricing || detail.data?.salesSummary || detail.data?.amount;

  console.log('\n=== HOTEL BOOKING RESULT ===');
  console.log(JSON.stringify({
    bookingRefId: booking.bookingRefId,
    bookingStatus: booking.bookingStatus,
    pendingTimedOut: booking.pendingTimedOut || false,
    checkin: booking.searchBody?.checkin,
    checkout: booking.searchBody?.checkout,
    nights: config.hotel.nights,
    entityId: booking.searchBody?.entityId,
    bookingCode: booking.bookingCode,
    requestId: booking.requestId,
    hotel: hotelInfo,
    pricing,
    guests: booking.searchBody?.rooms,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
