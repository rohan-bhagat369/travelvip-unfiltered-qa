/**
 * Cab API Error Contract — automation case catalog
 * Source: Cab-API-Error-Contract.pdf (CabBookingController v2)
 *
 * Tags: VALIDATE (payload/HTTP), FILTERS (locations/places), LIVE (needs book/fixture)
 * Status last live (2026-09-03 staging/canary) noted in docs/CAB-API-ERROR-CONTRACT.md
 */
export const CAB_ERROR_CONTRACT_SOURCE = 'Cab-API-Error-Contract.pdf';

/** @typedef {{ id: string, section: string, tag: string, api: string, rule: string, expectHttp: number|number[], expectCode: string|null, needs?: string, note?: string }} CabCase */

/** @type {CabCase[]} */
export const CAB_ERROR_CONTRACT_CASES = [
  // §1 locations
  { id: 'LOC-1', section: '1', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/locations', rule: "Either 'query' or both 'latitude' and 'longitude' required", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'LOC-2', section: '1', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/locations', rule: "Both 'latitude' and 'longitude' required when searching by coordinates", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'LOC-3', section: '1', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/locations', rule: "'latitude' and 'longitude' must be numeric decimal degrees", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'LOC-4', section: '1', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/locations', rule: "'latitude' between -90..90 and 'longitude' between -180..180", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },

  // §2 search
  { id: 'SR-1', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'Request body missing or not valid JSON', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-2', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'Missing required field journeyType', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-3', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: "Invalid journeyType — Allowed AIRPORT, RENTAL, OUTSTATION", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-4', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: "Invalid travelType — Allowed DEPARTURE, ARRIVAL", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-5', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'airportCode mandatory when journeyType is AIRPORT', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-6', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'Invalid coordinates for pickup/drop', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-7', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'distanceKm must be 0 or more (not negative)', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-8', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'pickupDatetime in the past rejected', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-9', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'RENTAL pickup and drop must be same location', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'SR-10', section: '2', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/search', rule: 'RENTAL_PACKAGE_MISMATCH with availablePackages', expectHttp: 400, expectCode: 'RENTAL_PACKAGE_MISMATCH' },

  // §3 fare
  { id: 'FR-1', section: '3', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/fare', rule: 'searchId is required (empty body)', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'FR-2', section: '3', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/fare', rule: 'searchId is required (empty string)', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'FR-3', section: '3', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/fare', rule: 'Invalid/expired searchId rejected', expectHttp: 400, expectCode: 'INVALID_SEARCH_ID', note: 'PDF said provider fail may be 200 []; staging/canary return 400 INVALID_SEARCH_ID' },

  // §4 finalize
  { id: 'FB-1', section: '4', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/finalize-booking', rule: 'Request body must be a non-empty JSON object', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'FB-2', section: '4', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/finalize-booking', rule: 'Invalid bookingReference', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'FB-3', section: '4', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/finalize-booking', rule: 'Invalid priceId must not create bookingRefId', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'FB-4', section: '4', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/finalize-booking', rule: 'Invalid passenger/contact email', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },

  // §5 update-booking
  { id: 'UB-1', section: '5', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/update-booking', rule: 'Request body is required', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'UB-2', section: '5', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/update-booking', rule: 'bookingRefId is required', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'UB-3', section: '5', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/update-booking', rule: 'Invalid status — Allowed CONFIRMED, CANCELLED, FAILED', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'UB-4', section: '5', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/update-booking', rule: 'BOOKING_NOT_FOUND for fake BR', expectHttp: 404, expectCode: 'BOOKING_NOT_FOUND' },
  { id: 'UB-5', section: '5', tag: 'LIVE', api: 'POST /v1/airportServices/cabs/update-booking', rule: 'PROVIDER_BOOKING_ID_MISMATCH', expectHttp: 400, expectCode: 'PROVIDER_BOOKING_ID_MISMATCH', needs: 'CAB_BOOKING_REF on same env' },

  // §6 webhook
  { id: 'WH-1', section: '6', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/partner-webhook', rule: 'Request body is required (valid Basic Auth)', expectHttp: 400, expectCode: 'VALIDATION_ERROR', needs: 'CAB_WEBHOOK_USER + CAB_WEBHOOK_PASS' },
  { id: 'WH-2', section: '6', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/partner-webhook', rule: 'INVALID_WEBHOOK_CREDENTIALS or WEBHOOK_IP_NOT_ALLOWED', expectHttp: [401, 403], expectCode: null, note: 'Accept 401 INVALID_WEBHOOK_CREDENTIALS or 403 WEBHOOK_IP_NOT_ALLOWED' },

  // §7–9 reads
  { id: 'ST-1', section: '7', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/{id}/status', rule: 'bookingId is not a valid booking reference', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'ST-2', section: '7', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/{id}/status', rule: 'BOOKING_NOT_FOUND', expectHttp: 404, expectCode: 'BOOKING_NOT_FOUND' },
  { id: 'DT-1', section: '8', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/booking/{id}', rule: 'bookingId is not a valid booking reference', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'DT-2', section: '8', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/booking/{id}', rule: 'BOOKING_NOT_FOUND', expectHttp: 404, expectCode: 'BOOKING_NOT_FOUND' },
  { id: 'TR-1', section: '9', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/tracking/{id}/location', rule: 'bookingId is not a valid booking reference', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'TR-2', section: '9', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/tracking/{id}/location', rule: 'BOOKING_NOT_FOUND', expectHttp: 404, expectCode: 'BOOKING_NOT_FOUND' },

  // §10 history
  { id: 'HI-1', section: '10', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/booking/history', rule: 'userId is required', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'HI-2', section: '10', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/booking/history', rule: 'page/perpage clamped (not rejected)', expectHttp: 200, expectCode: null },

  // §11 cancel
  { id: 'CA-1', section: '11', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/bookings/{id}/cancel', rule: 'bookingId is not a valid booking reference', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'CA-2', section: '11', tag: 'VALIDATE', api: 'GET /v1/airportServices/cabs/bookings/{id}/cancel', rule: 'BOOKING_NOT_FOUND', expectHttp: 404, expectCode: 'BOOKING_NOT_FOUND' },
  { id: 'CA-3', section: '11', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/bookings/{id}/cancel', rule: 'Invalid cancelledBy — Allowed USER, ADMIN, SYSTEM', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'CA-4', section: '11', tag: 'VALIDATE', api: 'POST /v1/airportServices/cabs/bookings/{id}/cancel', rule: "cancellationReason max 500 characters", expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'CA-5', section: '11', tag: 'LIVE', api: 'GET /v1/airportServices/cabs/bookings/{id}/cancel', rule: 'Pending → BOOKING_NOT_CANCELLABLE (or Confirmed cancel path)', expectHttp: 400, expectCode: 'BOOKING_NOT_CANCELLABLE', needs: 'live book' },

  // Filters (locations / places — existing partner contract)
  { id: 'FLT-LOC-Q', section: 'F', tag: 'FILTERS', api: 'GET /v1/airportServices/cabs/locations', rule: 'query=Delhi returns airport terminals', expectHttp: 200, expectCode: null },
  { id: 'FLT-LOC-XY', section: 'F', tag: 'FILTERS', api: 'GET /v1/airportServices/cabs/locations', rule: 'lat+long returns nearby airports', expectHttp: 200, expectCode: null },
  { id: 'FLT-LOC-AIR', section: 'F', tag: 'FILTERS', api: 'GET /v1/airportServices/cabs/locations', rule: 'airportCode alone rejected (need query or lat+long)', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
  { id: 'FLT-PLACE-OK', section: 'F', tag: 'FILTERS', api: 'GET /v1/airportServices/cabs/places/autocomplete', rule: 'searchText returns suggestions', expectHttp: 200, expectCode: null },
  { id: 'FLT-PLACE-MISS', section: 'F', tag: 'FILTERS', api: 'GET /v1/airportServices/cabs/places/autocomplete', rule: 'searchText required', expectHttp: 400, expectCode: 'VALIDATION_ERROR' },
];

export function casesByTag(tags = []) {
  if (!tags.length) return CAB_ERROR_CONTRACT_CASES;
  const set = new Set(tags.map((t) => String(t).toUpperCase()));
  return CAB_ERROR_CONTRACT_CASES.filter((c) => set.has(c.tag) || set.has('ALL'));
}
