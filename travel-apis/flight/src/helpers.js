import { config } from '../../../shared/config/env.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

const FLIGHT_QUERY = { lang: 'en', currency: 'INR' };

export function sanitizePassengerName(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z\s]/g, '')
    .trim();
  return cleaned.length >= 2 ? cleaned : fallback;
}

export function buildPassengerProfile(overrides = {}) {
  return {
    title: overrides.title || 'Mr',
    firstName: sanitizePassengerName(
      overrides.firstName || config.flight.passengerFirstName,
      'Chaitanya',
    ),
    lastName: sanitizePassengerName(
      overrides.lastName || config.flight.passengerLastName,
      'Patil',
    ),
    gender: overrides.gender || 'Male',
    dob: overrides.dob || config.flight.passengerDob,
  };
}

export function buildOneWaySearchBody(daysFromNow = 45, { origin = 'DEL', destination = 'BOM', maxStops = 0, fareType = 'CORPORATE' } = {}) {
  return {
    itinerary: [{ origin, destination, date: futureDate(daysFromNow) }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType,
  };
}

export function buildRoundTripSearchBody(onwardDays = 20, returnDays = 27, { origin = 'DEL', destination = 'BOM', maxStops = null, fareType = 'NORMAL' } = {}) {
  return {
    itinerary: [
      { origin, destination, date: futureDate(onwardDays) },
      { origin: destination, destination: origin, date: futureDate(returnDays) },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType,
  };
}

/** Classify search options into non-stop vs connecting (layover) flights. */
export function analyzeFlightOptions(searchData, direction = 'ONWARD') {
  const block = searchData?.results?.find((r) => String(r.direction).toUpperCase() === direction)
    || searchData?.results?.[0];
  const options = block?.options || [];
  const nonStop = [];
  const connecting = [];

  for (const opt of options) {
    const stops = opt.totalStops ?? 0;
    const segCount = opt.segments?.length ?? 0;
    const isConnecting = stops > 0 || segCount > 1;
    const summary = {
      searchId: opt.searchId,
      totalStops: stops,
      segmentCount: segCount,
      durationMinutes: opt.totalDurationMinutes,
      legs: opt.segments?.map((s) => ({
        flight: `${s.airline?.code} ${s.flightNumber}`,
        route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
      })),
    };
    if (isConnecting) connecting.push(summary);
    else nonStop.push(summary);
  }

  return {
    direction,
    total: options.length,
    nonStopCount: nonStop.length,
    connectingCount: connecting.length,
    nonStop,
    connecting,
    stopFilters: searchData?.filters?.[direction]?.stops,
  };
}

export function hasConnectingOptions(searchData, direction = 'ONWARD') {
  return analyzeFlightOptions(searchData, direction).connectingCount > 0;
}

export function buildSelectionPayload(searchIds, journeyType = 'ONE_WAY') {
  return {
    journeyType,
    selection: { selectedSearchIds: Array.isArray(searchIds) ? searchIds : [searchIds] },
  };
}

export function extractFirstSearchId(searchData) {
  return extractSearchIds(searchData, 1)[0] || null;
}

export function extractSearchIds(searchData, limit = 5) {
  const ids = [];
  const results = searchData?.results;
  if (!Array.isArray(results)) return ids;

  for (const result of results) {
    const options = result?.options;
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      if (option?.searchId) ids.push(option.searchId);
    }
  }
  return ids.slice(0, limit);
}

/** One searchId per direction (ONWARD + RETURN) for round-trip. */
export function extractDirectionSearchId(searchData, direction) {
  const results = searchData?.results;
  if (!Array.isArray(results)) return null;
  const block = results.find((r) => String(r.direction).toUpperCase() === direction);
  return block?.options?.[0]?.searchId || null;
}

export function extractOnwardSearchId(searchData) {
  return extractDirectionSearchId(searchData, 'ONWARD') || extractFirstSearchId(searchData);
}

export function extractOnwardSearchIds(searchData, limit = 5) {
  const results = searchData?.results;
  if (!Array.isArray(results)) return [];
  const block = results.find((r) => String(r.direction).toUpperCase() === 'ONWARD');
  if (!Array.isArray(block?.options)) return [];
  return block.options
    .map((option) => option?.searchId)
    .filter(Boolean)
    .slice(0, limit);
}

export function extractReturnSearchId(searchData) {
  return extractDirectionSearchId(searchData, 'RETURN');
}

export function isSearchProgressComplete(searchData) {
  return String(searchData?.progress?.state || '').toUpperCase() === 'COMPLETE';
}

export function hasRoundTripSearchPair(searchData) {
  const onward = extractOnwardSearchId(searchData);
  const returnId = extractReturnSearchId(searchData);
  return Boolean(onward && returnId && onward !== returnId);
}

export function buildRoundTripSearchIds(searchData) {
  if (hasRoundTripSearchPair(searchData)) {
    return [extractOnwardSearchId(searchData), extractReturnSearchId(searchData)];
  }

  const ids = extractRoundTripSearchIds(searchData);
  if (ids.length >= 2) return ids.slice(0, 2);

  const onward = extractOnwardSearchId(searchData);
  const returnId = extractReturnSearchId(searchData);
  if (onward && returnId) return [onward, returnId];
  return ids;
}

export function extractRoundTripSearchIds(searchData) {
  const results = searchData?.results;
  if (!Array.isArray(results)) return [];

  const ids = [];
  for (const result of results) {
    const first = result?.options?.[0]?.searchId;
    if (first) ids.push(first);
  }
  return ids;
}

export function buildSeatMapPassengers(profile = {}) {
  const passenger = buildPassengerProfile(profile);
  return [
    {
      paxRefNumber: '1',
      passengerType: 1,
      gender: passenger.gender,
      title: passenger.title,
      firstName: passenger.firstName,
      lastName: passenger.lastName,
    },
  ];
}

export function buildIssueTicketPayload({
  bookingContext,
  priceId,
  searchIds,
  journeyType = 'ONE_WAY',
  passengerProfile = {},
}) {
  const passenger = buildPassengerProfile(passengerProfile);

  return {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: bookingContext,
    searchIds: Array.isArray(searchIds) ? searchIds : [searchIds],
    journeyType,
    timezone: 'Asia/Calcutta',
    data: {
      priceId,
      passportType: 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: config.flight.contactEmail,
        mobile: config.flight.contactMobile,
        countryCode: config.flight.contactCountryCode,
      },
      passengers: [
        {
          paxId: 'PAX1',
          type: 'adult',
          isLead: true,
          profile: {
            title: passenger.title,
            firstName: passenger.firstName,
            lastName: passenger.lastName,
            gender: passenger.gender,
            dob: passenger.dob,
            nationality: 'IN',
          },
          city: { cityCode: 'Pune', cityName: 'Pune' },
          passport: {
            number: null,
            expiry: null,
            issuedDate: null,
            issuedCountryCode: null,
          },
          ssr: { baggage: [], meals: [], seats: [] },
        },
      ],
    },
  };
}

export function isTerminalBookingStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return ['confirmed', 'cancelled', 'failed'].includes(normalized);
}

export function canSelectSeats(pricingData) {
  const options = pricingData?.passengerOptions;
  if (!Array.isArray(options) || options.length === 0) return true;
  return options.some((p) => p.supportsSeats === true);
}

function getSeatMapStatusError(data) {
  return (
    data?.ResponseStatus?.Error
    || data?.responseStatus?.Error
    || data?.ResponseStatus?.error
    || data?.responseStatus?.error
    || null
  );
}

export function isSeatMapSkippedResponse(response) {
  const data = response?.data;
  if (!data) return false;
  if (data?.error?.code === 'VENDOR_UNAVAILABLE') return true;
  const statusError = getSeatMapStatusError(data);
  if (statusError && /seat\s*map|select\s*seat|not allow/i.test(String(statusError))) return true;
  if (data.FlightSeat == null && statusError) return true;
  return false;
}

export function getSeatMapSkipReason(response) {
  const data = response?.data;
  return (
    getSeatMapStatusError(data)
    || data?.error?.message
    || data?.error?.code
    || 'Seat map not available for this flight'
  );
}

export async function pollUntil(fn, predicate, { maxAttempts = 20, intervalMs = 4000, label = 'operation' } = {}) {
  let lastResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await fn();
    if (predicate(lastResult)) return lastResult;
    const waitMs = lastResult?.data?.progress?.pollAfterMs || intervalMs;
    await sleep(waitMs);
  }
  throw new Error(`${label} did not complete after ${maxAttempts} attempts`);
}

export { FLIGHT_QUERY };
