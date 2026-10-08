import {
  expectArray,
  expectDefined,
  expectNumber,
  expectOneOf,
  expectString,
} from '../lib/validators.js';

export function validateAutocompleteResponse(data) {
  expectArray(data.content, { minLength: 1 });
  const first = data.content[0];
  expectString(first.entityId);
  expectString(first.title);
}

export function validateSearchResponse(data) {
  expectDefined(data);
  expectString(data.requestId);
  expectArray(data.results, { minLength: 1 });
  const hotel = data.results[0];
  expectString(hotel.id);
  expectString(hotel.name);
  expectDefined(hotel.price);
}

export function validateDetailsResponse(data) {
  expectDefined(data);
  expectString(data.requestId);
  expectArray(data.results, { minLength: 1 });
  const hotel = data.results[0];
  expectString(hotel.id);
  expectString(hotel.name);
  expectArray(hotel.rooms, { minLength: 1 });
  hotel.rooms.forEach((room) => {
    expectString(room.bookingCode);
    expectDefined(room.price);
  });
}

export function validatePrebookResponse(data) {
  expectString(data.bookingContext, { minLength: 10 });
}

export function validateFinalizeResponse(data) {
  expectString(data.bookingRefId);
  expect(data.bookingRefId).toMatch(/^BR/);
  expectOneOf(String(data.status || '').toLowerCase(), ['pending', 'confirmed']);
}

export function validateBookingStatusResponse(data) {
  expectString(data.status);
  expectOneOf(String(data.status).toLowerCase(), ['pending', 'confirmed', 'cancelled', 'failed', 'rejected']);
  if (String(data.status).toLowerCase() === 'confirmed') {
    expectString(data.confirmationNumber);
    expectDefined(data.hotelDetails);
    expectString(data.hotelDetails.name || data.hotelDetails.hotelName);
  }
}

export function validateBookingDetailResponse(data) {
  expectString(data.status);
  expectDefined(data.hotelDetails);
}

export function validateCancelResponse(data) {
  expectDefined(data.result);
  expectDefined(data.result.status);
}
