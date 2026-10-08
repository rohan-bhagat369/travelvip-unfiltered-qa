import {
  expectArray,
  expectBoolean,
  expectDefined,
  expectNumber,
  expectOneOf,
  expectString,
} from '../lib/validators.js';

function validatePricingBlock(pricing) {
  expectDefined(pricing);
  expectNumber(pricing.baseFare, { min: 0 });
  expectNumber(pricing.taxes, { min: 0 });
  expectNumber(pricing.totalAmount, { min: 0 });
  expectString(pricing.currency, { minLength: 3 });
}

function validateSegment(segment) {
  expectString(segment.segmentId);
  expectString(segment.flightNumber);
  expectDefined(segment.airline);
  expectString(segment.airline.code);
  expectString(segment.airline.name);
  expectNumber(segment.durationMinutes, { min: 1 });
  expectDefined(segment.departure);
  expectString(segment.departure.airportCode, { minLength: 3 });
  expectString(segment.departure.time);
  expectDefined(segment.arrival);
  expectString(segment.arrival.airportCode, { minLength: 3 });
}

function validateFlightOption(option) {
  expectString(option.searchId);
  expect(option.searchId).toMatch(/^srch_/);
  expectNumber(option.totalStops, { min: 0 });
  expectNumber(option.totalDurationMinutes, { min: 1 });
  expectBoolean(option.refundable);
  expectArray(option.segments, { minLength: 1 });
  option.segments.forEach((seg) => validateSegment(seg));
  if (option.displayPricing?.pricing) {
    validatePricingBlock(option.displayPricing.pricing);
  }
}

export function validateSearchResponse(data, journeyType) {
  expectString(data.journeyType);
  expect(data.journeyType).toBe(journeyType);
  expectDefined(data.progress);
  expectOneOf(data.progress.state, ['INPROGRESS', 'COMPLETE']);
  expectBoolean(data.progress.partial);
  expectDefined(data.selection);
  expectArray(data.selection.selectedSearchIds);
  expectArray(data.results, { minLength: 1 });
  data.results.forEach((result) => {
    expectOneOf(result.direction, ['ONWARD', 'RETURN']);
    expectArray(result.options);
    result.options.forEach((opt) => validateFlightOption(opt));
  });
}

export function validateSelectionPayload(data, journeyType, searchIdCount) {
  expectString(data.journeyType);
  expect(data.journeyType).toBe(journeyType);
  expectDefined(data.selection);
  expectArray(data.selection.selectedSearchIds, { minLength: searchIdCount });
  expect(data.selection.selectedSearchIds.length).toBe(searchIdCount);
  data.selection.selectedSearchIds.forEach((id) => expect(id).toMatch(/^srch_/));
}

export function validateDetailsResponse(data, journeyType) {
  validateSelectionPayload(data, journeyType, journeyType === 'ROUND_TRIP' ? 2 : 1);
  expectDefined(data.pricing);
  validatePricingBlock(data.pricing);
  expectArray(data.itinerary, { minLength: 1 });
  data.itinerary.forEach((leg) => {
    expectOneOf(leg.direction, ['ONWARD', 'RETURN']);
    expectArray(leg.segments, { minLength: 1 });
  });
}

export function validateFareRulesResponse(data, journeyType) {
  validateSelectionPayload(data, journeyType, journeyType === 'ROUND_TRIP' ? 2 : 1);
  expectArray(data.fareRules, { minLength: 1 });
  data.fareRules.forEach((rule) => {
    expectString(rule.title);
    expectString(rule.text);
  });
}

export function validatePricingResponse(data, journeyType) {
  expectString(data.priceId);
  expect(data.priceId).toMatch(/^price_/);
  expectString(data.bookingContext, { minLength: 20 });
  validateSelectionPayload(data, journeyType, journeyType === 'ROUND_TRIP' ? 2 : 1);
  expectDefined(data.pricing);
  validatePricingBlock(data.pricing);
  if (data.expiresAt) expectString(data.expiresAt);
  if (data.passengerOptions) {
    expectArray(data.passengerOptions, { minLength: 1 });
    data.passengerOptions.forEach((pax) => {
      expectDefined(pax.supportsSeats);
      expect(typeof pax.supportsSeats).toBe('boolean');
    });
  }
}

export function validateSsrResponse(data) {
  expectDefined(data);
}

export function validateSeatMapResponse(data) {
  expectDefined(data);
  if (data.type) expectString(data.type);
  if (data.data?.segments) expectArray(data.data.segments);
}

export function validateIssueTicketResponse(data) {
  expectString(data.bookingReference);
  expect(data.bookingReference).toMatch(/^BR/);
  expectString(data.status);
  expectOneOf(data.status.toLowerCase(), ['pending', 'confirmed', 'failed', 'inprogress']);
  if (data.message) expectString(data.message);
  if (data._meta?.correlation_id) expectString(data._meta.correlation_id);
}

export function validateIssueTicketRequest(body, journeyType) {
  expect(body.type).toBe('ticket');
  expectString(body.currency);
  expectString(body.language);
  expectString(body.bookingReference, { minLength: 20 });
  expect(body.bookingReference).not.toMatch(/^BR/);
  expectArray(body.searchIds, { minLength: journeyType === 'ROUND_TRIP' ? 2 : 1 });
  expect(body.journeyType).toBe(journeyType);
  expectString(body.timezone);
  expectDefined(body.data);
  expectString(body.data.priceId);
  expect(body.data.priceId).toMatch(/^price_/);
  expectOneOf(body.data.passportType, ['NONE', 'PASSPORT']);
  expect(typeof body.data.includeGst).toBe('boolean');
  expectDefined(body.data.contact);
  expectString(body.data.contact.email);
  expectString(body.data.contact.mobile);
  expectString(body.data.contact.countryCode);
  expectArray(body.data.passengers, { minLength: 1 });
  body.data.passengers.forEach((pax) => {
    expectString(pax.paxId);
    expectOneOf(pax.type, ['adult', 'child', 'infant']);
    expect(pax.isLead).toBe(true);
    expectDefined(pax.profile);
    expectOneOf(pax.profile.title, ['Mr', 'Mrs', 'Ms', 'Miss', 'Mstr', 'Master']);
    expectString(pax.profile.firstName, { minLength: 2 });
    expectString(pax.profile.lastName, { minLength: 2 });
    expectString(pax.profile.gender);
    expectString(pax.profile.dob);
    expect(pax.profile.dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expectString(pax.profile.nationality, { minLength: 2 });
    expectDefined(pax.city);
    expectString(pax.city.cityCode);
    expectString(pax.city.cityName);
    expectDefined(pax.passport);
    expectDefined(pax.ssr);
    expectArray(pax.ssr.baggage);
    expectArray(pax.ssr.meals);
    expectArray(pax.ssr.seats);
  });
}

export function validateBookingStatusResponse(data) {
  expectString(data.status);
  if (data.bookingResponse) {
    expectString(data.bookingResponse.bookingReferenceId);
    expect(data.bookingResponse.bookingReferenceId).toMatch(/^BR/);
    if (data.bookingResponse.summary) {
      expectDefined(data.bookingResponse.summary.tripType);
      expectNumber(data.bookingResponse.summary.journeys, { min: 1 });
    }
  }
}

export function validateBookingDetailResponse(data) {
  expectString(data.bookingReference);
  expect(data.bookingReference).toMatch(/^BR/);
}

export function validatePenaltyResponse(data) {
  const payload = data?.data ?? data;
  expectDefined(payload);
  if (payload.action) expect(payload.action).toBe('PENALTY');
}

export function validateCancellationResponse(data) {
  const payload = data?.data ?? data;
  expectDefined(payload);
  if (payload.action) expectOneOf(payload.action, ['CANCEL', 'PENALTY_AND_CANCEL']);
}

export function validateAirportSearchResponse(data) {
  expectDefined(data);
}

export function validateAirlineSearchResponse(data) {
  expectDefined(data);
}

export function validateCitySearchResponse(data) {
  expectDefined(data);
}
