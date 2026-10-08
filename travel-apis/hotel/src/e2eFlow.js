import { assertOk } from '../../../shared/lib/testUtils.js';
import { config } from '../../../shared/config/env.js';
import { extractEntityId } from './helpers.js';

/**
 * Full hotel booking lifecycle mirroring the flight E2E pattern.
 */
export async function runHotelBookingE2e(hotel, {
  entityId = config.hotel.defaultEntityId,
  useAutocomplete = true,
  checkinDayCandidates = config.hotel.checkinDayCandidates,
  nights = config.hotel.nights,
} = {}) {
  const ctx = { steps: [], entityId };

  const record = (step, response, extra = {}) => {
    ctx.steps.push({ step, ok: response?.ok ?? true, status: response?.status, ...extra });
    return response;
  };

  if (useAutocomplete) {
    const autocomplete = await hotel.autocomplete();
    record('Hotel Autocomplete', autocomplete);
    assertOk(autocomplete, 'Hotel autocomplete');
    ctx.autocompleteEntityId = extractEntityId(autocomplete.data, 'dubai');
  }

  const booking = await hotel.bookUntilConfirmed({ entityId, checkinDayCandidates, nights });

  ctx.searchBody = booking.searchBody;
  ctx.requestId = booking.requestId;
  ctx.bookingCode = booking.bookingCode;
  ctx.bookingContext = booking.bookingContext;
  ctx.bookingRefId = booking.bookingRefId;
  ctx.bookingStatus = booking.bookingStatus;

  record('Hotel Search', booking.searchResponse, { requestId: booking.requestId });
  record('Hotel Details', booking.detailsResponse, { roomCount: booking.bookingCode ? 1 : 0 });
  record('Hotel Prebook', booking.prebookResponse);
  record('Hotel Finalize Booking', booking.finalizeResponse, { bookingRefId: booking.bookingRefId });
  record('Hotel Booking Status', booking.statusResponse, { bookingStatus: booking.bookingStatus });

  const detail = await hotel.getBookingDetail(ctx.bookingRefId);
  record('Hotel Booking Detail', detail);
  assertOk(detail, 'Hotel booking detail');

  const cancel = await hotel.cancelBooking(ctx.bookingRefId);
  record('Hotel Cancellation', cancel);
  assertOk(cancel, 'Hotel cancellation');

  return ctx;
}
