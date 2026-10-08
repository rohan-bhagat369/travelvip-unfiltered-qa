import { assertOk } from '../../../shared/lib/testUtils.js';
import {
  canSelectSeats,
  getSeatMapSkipReason,
  isSeatMapSkippedResponse,
} from './helpers.js';

/**
 * Shared E2E booking flow for ONE_WAY and ROUND_TRIP.
 * Returns context object with booking reference and step results.
 */
export async function runFlightBookingE2e(flight, {
  journeyType,
  searchFn,
  bookCandidates,
  selectionIds,
}) {
  const ctx = { journeyType, steps: [] };

  const record = (step, response, extra = {}) => {
    ctx.steps.push({ step, ok: response?.ok ?? true, status: response?.status, ...extra });
    return response;
  };

  const searchResult = await searchFn();
  record('Flight Search', searchResult.response, { searchIds: searchResult.searchIds });
  assertOk(searchResult.response, 'Flight search');
  ctx.searchIds = searchResult.searchIds;
  ctx.selectionIds = selectionIds ?? (
    journeyType === 'ONE_WAY'
      ? [searchResult.searchId || searchResult.searchIds?.[0]].filter(Boolean)
      : searchResult.searchIds
  );

  if (journeyType === 'ROUND_TRIP' && ctx.selectionIds.length !== 2) {
    throw new Error(`Round-trip requires exactly 2 searchIds, got ${ctx.selectionIds.length}`);
  }

  const details = await flight.getDetails(ctx.selectionIds, journeyType);
  record('Flight Details', details);
  assertOk(details, 'Flight details');

  const fareRules = await flight.getFareRules(ctx.selectionIds, journeyType);
  record('Flight Fare Rules', fareRules);
  assertOk(fareRules, 'Flight fare rules');

  const pricing = await flight.getPricing(ctx.selectionIds, journeyType);
  record('Flight Pricing', pricing);
  assertOk(pricing, 'Flight pricing');
  ctx.priceId = pricing.data.priceId;
  ctx.bookingContext = pricing.data.bookingContext;
  ctx.pricingData = pricing.data;

  const ssr = await flight.getSsr(ctx.priceId);
  record('Flight SSR', ssr);
  assertOk(ssr, 'Flight SSR');

  if (canSelectSeats(ctx.pricingData)) {
    const seatMap = await flight.getSeatMap(ctx.bookingContext);
    if (isSeatMapSkippedResponse(seatMap)) {
      record('Flight Seat Map', seatMap, { skipped: true, reason: getSeatMapSkipReason(seatMap) });
      ctx.seatMapSkipped = true;
    } else {
      record('Flight Seat Map', seatMap);
      assertOk(seatMap, 'Flight seat map');
    }
  } else {
    ctx.seatMapSkipped = true;
    record('Flight Seat Map', { ok: true, status: 200, skipped: true, reason: 'supportsSeats=false' });
  }

  const booking = await flight.bookUntilConfirmed(bookCandidates ?? ctx.searchIds, journeyType);
  record('Issue Ticket + Booking Status', booking.statusResponse, {
    bookingReference: booking.bookingReference,
    bookingStatus: booking.bookingStatus,
  });
  assertOk(booking.statusResponse, 'Flight booking status');
  ctx.bookingReference = booking.bookingReference;
  ctx.bookingStatus = booking.bookingStatus;

  const detail = await flight.getBookingDetail(ctx.bookingReference);
  record('Flight Booking Detail', detail);
  assertOk(detail, 'Flight booking detail');

  const penalty = await flight.checkCancellationPenalty(ctx.bookingReference);
  record('Cancellation Penalty Check', penalty);
  assertOk(penalty, 'Cancellation penalty check');

  const cancel = await flight.cancelBooking(ctx.bookingReference);
  record('Flight Cancellation', cancel);
  assertOk(cancel, 'Flight cancellation');

  return ctx;
}
