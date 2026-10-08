import { assertOk } from '../../../shared/lib/testUtils.js';

/**
 * Full cab booking lifecycle from Postman Cab collection:
 * Search → Fare → Finalize → Status → Cancel
 */
export async function runCabBookingE2e(cab, journeyType) {
  const result = await cab.runBookingFlow(journeyType);
  const ctx = {
    journeyType: result.journeyType,
    steps: [],
    searchBody: result.searchBody,
    bookingRefId: result.bookingRefId,
    bookingStatus: result.bookingStatus,
    selectedCab: result.selectedCab,
  };

  const record = (step, response, extra = {}) => {
    ctx.steps.push({
      step,
      ok: response?.ok ?? false,
      status: response?.status,
      ...extra,
    });
    return response;
  };

  record('Cab Search', result.searchResponse, {
    cabCount: result.searchResponse.data?.cabs?.length ?? 0,
    searchId: result.selectedCab?.searchId,
  });
  assertOk(result.searchResponse, `Cab search (${journeyType})`);
  if (!result.selectedCab?.searchId) {
    throw new Error(`Cab search (${journeyType}) returned no selectable cabs`);
  }

  record('Cab Fare', result.fareResponse, {
    priceId: result.fareResponse.data?.priceId,
  });
  assertOk(result.fareResponse, `Cab fare (${journeyType})`);
  if (!result.fareResponse.data?.bookingReference || !result.fareResponse.data?.priceId) {
    throw new Error(`Cab fare (${journeyType}) missing bookingReference/priceId`);
  }

  record('Cab Book', result.finalizeResponse, {
    bookingRefId: result.bookingRefId,
  });
  assertOk(result.finalizeResponse, `Cab book (${journeyType})`);
  if (!result.bookingRefId) {
    throw new Error(`Cab book (${journeyType}) did not return bookingRefId`);
  }

  record('Cab Booking Status', result.statusResponse, {
    bookingStatus: result.bookingStatus,
  });
  assertOk(result.statusResponse, `Cab status (${journeyType})`);

  record('Cab Cancel', result.cancelResponse, {
    cancelStatus: result.cancelResponse.data?.status || result.cancelResponse.data?.message,
  });
  assertOk(result.cancelResponse, `Cab cancel (${journeyType})`);

  return ctx;
}
