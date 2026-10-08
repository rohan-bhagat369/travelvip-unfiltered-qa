import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'reports', 'cab-http200-error-envelope-staging.json'), 'utf8'),
);

/** QA / product expectation (correct platform behavior). */
function expectedQa(row) {
  if (row.kind === 'BUG_HTTP200_BODY_5xx') {
    return 'HTTP 400/404 with error.code (VALIDATION_ERROR or NOT_FOUND). Never HTTP 200 with body status 500 / Internal Server Error / vendor (Mojoboxx) error on bad client input.';
  }
  if (row.kind === 'BUG_ACCEPTED_INVALID') {
    return 'HTTP 400 VALIDATION_ERROR — reject invalid priceId; do not create bookingRefId.';
  }
  if (row.kind === 'BUG_HTTP200_BODY_4xx') {
    if (row.bodyStatus === 404) {
      return 'HTTP 404 with error.code (e.g. BOOKING_NOT_FOUND). Not HTTP 200 with body status 404.';
    }
    if (row.id === 'POS-CANCEL') {
      return 'Cancel should succeed for Confirmed booking (or clear HTTP 4xx with error.code). Not HTTP 200 wrapping body status 400.';
    }
    return 'HTTP 400 with error envelope { error: { code, message, details, timestamp, request_id } }. Not HTTP 200 with body status 400.';
  }
  return '';
}

/**
 * What api-docs.travelvip.ai #tag/Cabs documents for this case.
 * Source: OpenAPI responses + request schema on Cabs endpoints.
 */
function expectedFromDoc(row) {
  const id = row.id || '';

  // --- Search ---
  if (id === 'SEARCH-empty') {
    return 'Doc (POST /airportServices/cabs/search): request body required with journeyType, travelType, pickup, drop, distanceKm, durationMin, pickupDatetime. Invalid request → HTTP 400 "Invalid request parameters". Responses listed: 200, 400, 401, 429. No HTTP 500.';
  }
  if (id === 'SEARCH-missing-journeyType') {
    return 'Doc: journeyType is required; Enum AIRPORT | RENTAL | OUTSTATION only. Invalid/missing → HTTP 400.';
  }
  if (id === 'SEARCH-invalid-journeyType') {
    return 'Doc: journeyType Enum "AIRPORT" "RENTAL" "OUTSTATION" only — "No other values are accepted." Invalid → HTTP 400.';
  }
  if (id === 'SEARCH-airport-XXX') {
    return 'Doc: airportCode pattern ^[A-Z]{3}$ (IATA). Required when journeyType=AIRPORT. Invalid params → HTTP 400. HTTP 500 not documented.';
  }
  if (id === 'SEARCH-past-datetime') {
    return 'Doc: pickupDatetime required (ISO 8601 UTC) and "Must be in the future." Invalid → HTTP 400.';
  }
  if (id === 'SEARCH-bad-datetime') {
    return 'Doc: pickupDatetime must be ISO 8601 UTC and in the future. Invalid format → HTTP 400.';
  }
  if (id === 'SEARCH-lat999') {
    return 'Doc: pickup/drop are CabPoint with latitude/longitude (valid coordinates implied). Invalid request parameters → HTTP 400.';
  }
  if (id === 'SEARCH-neg-distance') {
    return 'Doc: distanceKm required (driving km; for RENTAL fixed packages 20/40/…). Negative not allowed by intent. Invalid → HTTP 400. HTTP 500 / fareSearch failed not documented.';
  }
  if (id === 'SEARCH-html-journeyType') {
    return 'Doc: journeyType enum only (AIRPORT/RENTAL/OUTSTATION). Other values not accepted → HTTP 400.';
  }
  if (id === 'SEARCH-comma-airport') {
    return 'Doc: airportCode must match ^[A-Z]{3}$. "DEL," is invalid → HTTP 400. HTTP 500 not documented.';
  }

  // --- Fare ---
  if (id === 'FARE-missing-searchId' || id === 'FARE-empty-searchId') {
    return 'Doc (POST /airportServices/cabs/fare): searchId required — "The searchId of the selected option" from search. Invalid request parameters → HTTP 400. Responses: 200, 400, 401, 429. No HTTP 500.';
  }
  if (id.startsWith('FARE-')) {
    return 'Doc: searchId must be a real cabs[].searchId from search (pass selected option). Invalid request parameters → HTTP 400. Vendor/Mojoboxx Internal Server Error and HTTP 500 are not documented for this endpoint.';
  }

  // --- Finalize ---
  if (id === 'BOOK-bad-ref') {
    return 'Doc (POST /airportServices/cabs/finalize-booking): bookingReference required — "copied verbatim from fare". Invalid request parameters → HTTP 400. Responses: 200, 400, 401, 403, 429.';
  }
  if (id === 'BOOK-bad-priceId') {
    return 'Doc: priceId required — "Confirmed price identifier copied verbatim from the priceId returned by fare." Implies only fare-issued priceId is valid; invalid params → HTTP 400. Doc does not explicitly say "reject fake priceId", but 400 is the listed error for invalid request.';
  }
  if (id === 'BOOK-empty-body') {
    return 'Doc: request body required with bookingReference, priceId, passengers (non-empty), contact. Invalid → HTTP 400.';
  }
  if (id === 'BOOK-bad-email') {
    return 'Doc: contact required (email, countryCode, mobile in samples). Cab section does not list email format rules (unlike Flights VALIDATION_ERROR matrix). Invalid request → HTTP 400.';
  }
  if (id === 'BOOK-html-name') {
    return 'Doc: passengers[].profile required (title, firstName, lastName, …). No cab-specific name charset rules in Cabs tag. Invalid request → HTTP 400.';
  }
  if (id === 'BOOK-comma-mobile') {
    return 'Doc: contact.mobile required in samples. No cab-specific mobile digit rules in Cabs tag. Invalid request → HTTP 400.';
  }

  // --- Status / Detail / Track / Cancel unknown BR ---
  if (id.startsWith('STATUS-')) {
    return 'Doc (GET /airportServices/cabs/{bookingId}/status): bookingId path required (BR… from finalize). Resource not found → HTTP 404. Also lists HTTP 400 for invalid params. Responses: 200, 400, 401, 404, 429.';
  }
  if (id.startsWith('DETAIL-')) {
    return 'Doc (GET /airportServices/cabs/booking/{bookingId}): bookingId required. Resource not found → HTTP 404. Responses: 200, 401, 404.';
  }
  if (id.startsWith('TRACK-')) {
    return 'Doc (Fetch Cab Location): bookingId required. Resource not found → HTTP 404; invalid params → HTTP 400. Responses: 200, 400, 401, 404, 429. (Doc path note: singular /cab/tracking/…; live often /cabs/tracking/…)';
  }
  if (id.startsWith('CANCEL-') || id === 'POS-CANCEL') {
    return 'Doc (GET /airportServices/cabs/bookings/{bookingId}/cancel): cancel within cancellable window → HTTP 200 with result.bookingStatus CANCELLED. If already cancelled / not cancellable → HTTP 400. Not found → HTTP 404. Responses: 200, 400, 401, 404, 429.';
  }

  // --- Locations / Places ---
  if (id === 'LOC-missing-coords') {
    return 'Doc (GET /airportServices/cabs/locations): either query OR both latitude and longitude required. Invalid request parameters → HTTP 400.';
  }
  if (id === 'LOC-bad-coords') {
    return 'Doc: invalid latitude/longitude → HTTP 400 "Invalid request parameters". Responses: 200, 400, 401, 429.';
  }
  if (id === 'PLACE-empty' || id === 'PLACE-missing') {
    return 'Doc: places/autocomplete is not under Cabs tag (docs point city-side resolve to Google Places). If exposed on TravelVIP, treat missing searchText as invalid → HTTP 400 (same pattern as other cab GETs).';
  }

  return 'Doc: invalid client input → HTTP 400 (or HTTP 404 if resource missing). Success → HTTP 200. HTTP 500 not listed on Cabs endpoints.';
}

function apiName(row) {
  return `${row.method || ''} ${row.path || ''}`.trim();
}

const INPUT_MAP = {
  'SEARCH-empty': 'Empty body {}',
  'SEARCH-missing-journeyType': 'Omit journeyType (rest valid AIRPORT body)',
  'SEARCH-invalid-journeyType': 'journeyType = "INVALID"',
  'SEARCH-airport-XXX': 'airportCode = "XXX"',
  'SEARCH-past-datetime': 'pickupDatetime = "2020-01-01T10:00:00Z"',
  'SEARCH-bad-datetime': 'pickupDatetime = "ROHAN"',
  'SEARCH-lat999': 'pickup.latitude = 999, pickup.longitude = 999',
  'SEARCH-neg-distance': 'distanceKm = -5',
  'SEARCH-html-journeyType': 'journeyType = "<script>alert(1)</script>"',
  'SEARCH-comma-airport': 'airportCode = "DEL,"',
  'FARE-missing-searchId': 'Empty body {}',
  'FARE-empty-searchId': 'searchId = ""',
  'FARE-ROHAN': 'searchId = "ROHAN"',
  'FARE-garbage': 'searchId = "not-a-real-search-id"',
  'FARE-uuid-only': 'searchId = "00000000-0000-0000-0000-000000000000"',
  'FARE-html': 'searchId = "<script>x</script>"',
  'FARE-comma': 'searchId = "abc,"',
  'BOOK-bad-ref': 'bookingReference = "INVALID_REF" (valid priceId + passengers)',
  'BOOK-bad-priceId': 'priceId = "invalid-price-id" (valid bookingReference + passengers)',
  'BOOK-empty-body': 'Empty body {}',
  'BOOK-bad-email': 'contact.email = "not-an-email"',
  'BOOK-html-name': 'passengers[0].profile.firstName = "<script>"',
  'BOOK-comma-mobile': 'contact.mobile = "9921862715,"',
  'LOC-missing-coords': 'No latitude / longitude query params',
  'LOC-bad-coords': 'latitude = 999, longitude = 999',
  'PLACE-empty': 'searchText = "" (empty)',
  'PLACE-missing': 'Omit searchText query param',
  'POS-CANCEL': 'Cancel live booking BR1787649852197160',
};

function inputText(row) {
  if (INPUT_MAP[row.id]) return INPUT_MAP[row.id];
  if (row.mutation?.startsWith('bookingRef=')) {
    return `bookingRefId = ${row.mutation.replace('bookingRef=', '')}`;
  }
  return row.mutation || '';
}

function actualText(row) {
  const b = row.body || {};
  const payload = {};
  if (b.status !== undefined) payload.status = b.status;
  if (b.statusCode !== undefined) payload.statusCode = b.statusCode;
  if (b.title) payload.title = b.title;
  if (b.message) payload.message = b.message;
  if (b.detail) payload.detail = b.detail;
  if (b.bookingRefId) payload.bookingRefId = b.bookingRefId;
  if (b.path) payload.path = b.path;
  const bodyStr = Object.keys(payload).length ? JSON.stringify(payload) : JSON.stringify(b || {});
  return `HTTP ${row.httpStatus} | ${bodyStr}`;
}

const bugs = report.rows.filter((r) => r.kind && String(r.kind).startsWith('BUG'));
const rows = bugs.map((r) => ({
  'Testcase ID': r.id,
  'API Name': apiName(r),
  Input: inputText(r),
  'Actual Response': actualText(r),
  Expected: expectedQa(r),
  'Expected from Doc': expectedFromDoc(r),
}));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [
  { wch: 28 },
  { wch: 62 },
  { wch: 55 },
  { wch: 95 },
  { wch: 85 },
  { wch: 95 },
];
XLSX.utils.book_append_sheet(wb, ws, 'Cab Validation Bugs');

const out = path.join(ROOT, 'reports', 'cab-validation-bugs-staging.xlsx');
XLSX.writeFile(wb, out);
console.log('Wrote', out, 'rows=', rows.length, 'cols=6');
