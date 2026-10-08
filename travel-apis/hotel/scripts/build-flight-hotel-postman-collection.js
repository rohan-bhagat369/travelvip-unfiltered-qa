/**
 * Build updated Flights + Hotels Postman collection (docs-aligned payloads).
 *   node scripts/build-flight-hotel-postman-collection.js
 */
import fs from 'fs';

const SRC = 'c:/Users/Rohan Bhagat/Downloads/TravelVIP.postman.json';
const OUT = 'postman/TravelVIP-Flights-Hotels-Updated.postman_collection.json';
const OUT_DL = 'c:/Users/Rohan Bhagat/Downloads/TravelVIP-Flights-Hotels-Updated.postman_collection.json';

const pm = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function walk(items, folder = '', out = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, folder ? `${folder}/${it.name}` : it.name, out);
    if (it.request) out.push({ ...it, _folder: folder });
  }
  return out;
}

const all = walk(pm.item);
const byName = (n) => all.find((x) => x.name === n);

function signingEvent() {
  const src = byName('Cancellation Penlty Check') || byName('Hotel Search') || byName('Access Token');
  return src?.event ? JSON.parse(JSON.stringify(src.event)) : [
    {
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          'const timestamp = Math.floor(Date.now() / 1000).toString();',
          'const body = pm.request.body && pm.request.body.raw ? pm.request.body.raw : "";',
          'const signingKey = pm.environment.get("signing_key") || pm.collectionVariables.get("signing_key");',
          'const signature = CryptoJS.HmacSHA256(body + timestamp, signingKey).toString(CryptoJS.enc.Hex);',
          'pm.collectionVariables.set("timestamp", timestamp);',
          'pm.collectionVariables.set("signature", signature);',
          'pm.variables.set("request_id", "req-" + Date.now());',
          'if (!pm.collectionVariables.get("correlation_id")) {',
          '  pm.collectionVariables.set("correlation_id", require("uuid").v4 ? require("uuid").v4() : ("corr-" + Date.now()));',
          '}',
        ],
      },
    },
  ];
}

function headers(extra = []) {
  return [
    { key: 'Authorization', value: 'Bearer {{auth_token}}', type: 'string' },
    { key: 'X-Request-Id', value: '{{request_id}}', type: 'string' },
    { key: 'X-Timestamp', value: '{{timestamp}}', type: 'string' },
    { key: 'X-Signature', value: '{{signature}}', type: 'string' },
    { key: 'X-Correlation-ID', value: '{{correlation_id}}', type: 'string' },
    { key: 'X-Partner-Key', value: '{{access_token}}', type: 'string' },
    { key: 'Content-Type', value: 'application/json', type: 'string' },
    ...extra,
  ];
}

function url(pathParts, query = [
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
]) {
  const qs = query.map((q) => `${q.key}=${q.value}`).join('&');
  return {
    raw: `{{base_url}}/${pathParts.join('/')}${qs ? `?${qs}` : ''}`,
    host: ['{{base_url}}'],
    path: pathParts,
    query,
  };
}

function example(name, code, body, originalBody, method = 'POST', pathHint = '') {
  return {
    name,
    status: String(code),
    code,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    cookie: [],
    body: JSON.stringify(body, null, 2),
    originalRequest: {
      method,
      header: [],
      body: originalBody
        ? {
            mode: 'raw',
            raw: JSON.stringify(originalBody, null, 2),
            options: { raw: { language: 'json' } },
          }
        : undefined,
      url: { raw: pathHint || '{{base_url}}' },
    },
  };
}

function req({ name, method = 'POST', pathParts, query, body, description, responses = [], extraHeaders = [] }) {
  const item = {
    name,
    event: signingEvent(),
    request: {
      auth: { type: 'noauth' },
      method,
      header: headers(extraHeaders),
      url: url(pathParts, query),
      description: description || '',
    },
    response: responses,
  };
  if (body != null) {
    item.request.body = {
      mode: 'raw',
      raw: `${JSON.stringify(body, null, 2)}\n`,
      options: { raw: { language: 'json' } },
    };
  }
  return item;
}

// ─── Flight payloads ───
const flightSearch = {
  itinerary: [{ origin: 'BOM', destination: 'HYD', date: '2026-11-12' }],
  travellers: { adults: 2, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ONE_WAY',
  fareType: 'NORMAL',
  preferences: { airlines: [], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
};
const flightSelection = {
  journeyType: 'ONE_WAY',
  selection: { selectedSearchIds: ['{{flight_search_id}}'] },
};
const flightSsr = { priceId: '{{flight_price_id}}' };
const flightSeatmap = {
  currency: 'INR',
  requestReference: '{{flight_price_id}}',
  passengers: [
    { paxId: 'PAX1', type: 'adult' },
    { paxId: 'PAX2', type: 'adult' },
  ],
};
const flightIssue = {
  type: 'ticket',
  currency: 'INR',
  language: 'en',
  bookingReference: '{{flight_pricing_booking_reference}}',
  searchIds: ['{{flight_search_id}}'],
  journeyType: 'ONE_WAY',
  timezone: 'Asia/Calcutta',
  reschedulingReferenceId: null,
  reschedulingPnr: null,
  data: {
    priceId: '{{flight_price_id}}',
    passportType: 'NONE',
    includeGst: false,
    gstDetails: null,
    contact: { email: 'qa@travelvip.ai', mobile: '9921862715', countryCode: '+91' },
    passengers: [
      {
        paxId: 'PAX1', type: 'adult', isLead: true,
        profile: { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', gender: 'Male', dob: '2001-05-29', nationality: 'IN' },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: null,
        ssr: { baggage: [], meals: [], seats: [] },
      },
      {
        paxId: 'PAX2', type: 'adult', isLead: false,
        profile: { title: 'Mr', firstName: 'Amit', lastName: 'Sharma', gender: 'Male', dob: '1995-08-15', nationality: 'IN' },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: null,
        ssr: { baggage: [], meals: [], seats: [] },
      },
    ],
  },
};
const flightIssueGst = {
  ...flightIssue,
  data: {
    ...flightIssue.data,
    includeGst: true,
    gstDetails: {
      gstNumber: '27AABCT1429B1Z1',
      gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
      gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
      gstEmailID: 'accounts@travelvip.ai',
      gstMobileNumber: '9921862715',
    },
  },
};
const flightIssueReschedule = {
  ...flightIssue,
  reschedulingReferenceId: '{{flight_cancelled_booking_reference}}',
  reschedulingPnr: '{{flight_cancelled_pnr}}',
};

const flightPenaltyFull = { action: 'PENALTY', pnr: '{{flight_pnr}}' };
const flightPenaltyPax = { action: 'PENALTY', pnr: '{{flight_pnr}}', cancellationPaxList: ['PAX1'] };
const flightCancelFull = {
  action: 'CANCEL',
  pnr: '{{flight_pnr}}',
  cancellationReason: 'Customer requested cancellation',
  remarks: 'cancelled by user',
  cancelledBy: 'USER',
};
const flightCancelPax = {
  action: 'CANCEL',
  pnr: '{{flight_pnr}}',
  cancellationPaxList: ['PAX1'],
  cancellationReason: 'Partial pax cancel',
};

const respFlightPenaltyFetched = {
  status: 0, statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805', pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Penalty Fetched', estimatedCancellationCharge: 350, estimatedRefund: 8047,
      createdAt: '2026-08-12T15:01:51Z',
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};
const respFlightPenaltyNA = {
  status: 0, statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805', pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Penalty Not Available',
      message: "PNR 'KPGQYI' carries 2 passengers and cancellationPaxList names 1 (PAX1). The airline prices a cancellation for the whole PNR, so the charge for individual passengers cannot be calculated. Omit cancellationPaxList to get the charge for the full PNR, or send action CANCEL with cancellationPaxList to raise a cancellation request for these passengers — the exact charge is then confirmed with the airline before any refund is made.",
      createdAt: '2026-08-12T15:01:51Z',
    },
    paxScope: {
      scope: 'PARTIAL_PAX', cancellationPaxList: ['PAX1'], totalPaxOnPnr: 2,
      cancelledPaxCount: 1, prorated: false, penaltyQuotable: false,
      reasonCode: 'PENALTY_NOT_AVAILABLE_FOR_PARTIAL_PAX',
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};
const respFlightCancelPax = {
  status: 0, statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805', pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Cancellation Requested',
      message: 'No estimated cancellation and refund amount available',
      createdAt: '2026-08-12T15:01:53Z',
    },
    paxScope: {
      scope: 'PARTIAL_PAX', cancellationPaxList: ['PAX1'],
      totalPaxOnPnr: 2, cancelledPaxCount: 1, prorated: true,
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};
const respFlightCancelFull = {
  status: 0, statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805', pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Cancelled', estimatedCancellationCharge: 700, estimatedRefund: 16094,
      createdAt: '2026-08-12T15:02:00Z',
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};

// ─── Hotel payloads ───
const hotelSearch = {
  checkin: '2026-09-15',
  checkout: '2026-09-16',
  entityId: '{{hotel_entity_id}}',
  nationality: 'IN',
  type: 'CITY',
  rooms: [{ adults: 2, children: 0, childrenAges: [] }],
};
const hotelDetails = {
  checkin: '2026-09-15',
  checkout: '2026-09-16',
  entityId: '{{hotel_entity_id}}',
  nationality: 'IN',
  rooms: [{ adults: 2, children: 0, childrenAges: [] }],
};
const hotelPrebook = {
  bookingCode: '{{hotel_booking_code}}',
  requestId: '{{hotel_request_id}}',
};
const hotelFinalize = {
  bookingContext: '{{hotel_booking_context}}',
  bookingCode: '{{hotel_booking_code}}',
  requestId: '{{hotel_request_id}}',
  checkin: '2026-09-15',
  checkout: '2026-09-16',
  gstDetails: null,
  rooms: [{
    guests: [
      { title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true },
      { title: 'Mrs.', firstName: 'Neha', lastName: 'Bhagat', type: 'Adult', isLead: false },
    ],
  }],
  contact: {
    email: 'qa@travelvip.ai',
    countryCode: '+91',
    mobile: '9921862715',
  },
};
const hotelFinalizeGst = {
  ...hotelFinalize,
  gstDetails: {
    gstNumber: '27AABCT1429B1Z1',
    gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
    gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
    gstEmailID: 'accounts@travelvip.ai',
    gstMobileNumber: '9921862715',
  },
  contact: {
    ...hotelFinalize.contact,
    panCardNumber: 'ABCDE1234F',
  },
};
const hotelFinalizeReschedule = {
  ...hotelFinalize,
  reschedulingReferenceId: '{{hotel_cancelled_booking_reference}}',
};

const respHotelPenalty = {
  status: 0,
  statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786528522623648',
    confirmationNumber: 'SNHAPI00010618',
    currency: 'INR',
    cancellationRequest: {
      status: 'Penalty Fetched',
      estimatedCancellationCharge: 0,
      estimatedRefund: 7364.86,
      createdAt: '2026-08-12T11:58:10Z',
    },
  },
  _meta: { correlation_id: '41985e8b-632f-42d8-b316-01a718126059' },
};
const respHotelCancel = {
  status: 0,
  statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786528522623648',
    confirmationNumber: 'SNHAPI00010618',
    currency: 'INR',
    cancellationRequest: {
      status: 'Cancelled',
      estimatedCancellationCharge: 0,
      estimatedRefund: 7364.86,
      createdAt: '2026-08-12T12:00:00Z',
    },
  },
  _meta: { correlation_id: '41985e8b-632f-42d8-b316-01a718126059' },
};

// Auth from source
function pickAuth() {
  const names = ['Access Token', 'Refresh Token', 'User Auth'];
  return names.map((n) => {
    const src = byName(n);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    delete copy.response;
    delete copy._folder;
    return copy;
  }).filter(Boolean);
}

const collection = {
  info: {
    name: 'TravelVIP Flights + Hotels — Updated Payloads',
    description: [
      '# TravelVIP Flights + Hotels — Updated Payloads',
      '',
      'Docs-aligned request bodies for Flights and Hotels.',
      'Source of truth: https://api-docs.travelvip.ai',
      '',
      '## Flights',
      'Search → Details → FareRules → Pricing → SSR → SeatMap → Issue (standard / GST / reschedule) → Status/Detail/History → PENALTY / CANCEL (full + paxwise)',
      '',
      '## Hotels',
      'Autocomplete → Search → Details → Prebook → Finalize (standard / GST+PAN / reschedule) → Status/Detail/History → Penalty-check → Cancel',
      '',
      '## Notes',
      '- Flight cancel actions documented: **PENALTY | CANCEL** only (no PENALTY_AND_CANCEL)',
      '- Hotel penalty/cancel are **GET** endpoints',
      `- Generated: ${new Date().toISOString()}`,
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'base_url', value: 'https://api-staging.travelvip.ai' },
    { key: 'access_token', value: '' },
    { key: 'auth_token', value: '' },
    { key: 'signing_key', value: '' },
    { key: 'correlation_id', value: '' },
    { key: 'request_id', value: '' },
    { key: 'timestamp', value: '' },
    { key: 'signature', value: '' },
    // flight
    { key: 'flight_search_id', value: '' },
    { key: 'flight_price_id', value: '' },
    { key: 'flight_pricing_booking_reference', value: '' },
    { key: 'flight_booking_reference', value: '' },
    { key: 'flight_pnr', value: '' },
    { key: 'flight_cancelled_booking_reference', value: '' },
    { key: 'flight_cancelled_pnr', value: '' },
    // hotel
    { key: 'hotel_entity_id', value: '' },
    { key: 'hotel_booking_code', value: '' },
    { key: 'hotel_request_id', value: '' },
    { key: 'hotel_booking_context', value: '' },
    { key: 'hotel_booking_reference', value: '' },
    { key: 'hotel_cancelled_booking_reference', value: '' },
  ],
  item: [
    {
      name: '0. Auth',
      description: 'Run Access Token → User Auth before product APIs.',
      item: pickAuth(),
    },
    {
      name: 'Flights',
      item: [
        {
          name: '1. Reference',
          item: [
            req({
              name: '1.1 Airport Search', method: 'GET',
              pathParts: ['v1', 'flights', 'airports'],
              query: [
                { key: 'airport', value: 'del' },
                { key: 'page', value: '1' },
                { key: 'perpage', value: '20' },
                { key: 'lang', value: 'en' },
              ],
            }),
            req({
              name: '1.2 Airline Search', method: 'GET',
              pathParts: ['v1', 'flights', 'airlines'],
              query: [
                { key: 'airline', value: '6E' },
                { key: 'page', value: '1' },
                { key: 'perpage', value: '20' },
                { key: 'lang', value: 'en' },
              ],
            }),
            req({
              name: '1.3 City Search', method: 'GET',
              pathParts: ['v1', 'flights', 'citySearch'],
              query: [
                { key: 'city', value: 'mum' },
                { key: 'page', value: '1' },
                { key: 'perpage', value: '20' },
                { key: 'lang', value: 'en' },
              ],
            }),
          ],
        },
        {
          name: '2. Search → Price',
          item: [
            req({ name: '2.1 Flight Search', pathParts: ['v1', 'flights', 'search'], body: flightSearch }),
            req({ name: '2.2 Flight Details', pathParts: ['v1', 'flights', 'details'], body: flightSelection }),
            req({ name: '2.3 Flight Fare Rules', pathParts: ['v1', 'flights', 'fareRules'], body: flightSelection }),
            req({ name: '2.4 Flight Pricing', pathParts: ['v1', 'flights', 'pricing'], body: flightSelection }),
          ],
        },
        {
          name: '3. Ancillaries',
          item: [
            req({ name: '3.1 Flight SSR', pathParts: ['v1', 'flights', 'ssr'], body: flightSsr }),
            req({ name: '3.2 Flight SeatMap', pathParts: ['v1', 'flights', 'seatmap'], body: flightSeatmap }),
          ],
        },
        {
          name: '4. Issue ticket',
          item: [
            req({
              name: '4.1 Issue Ticket (standard)',
              pathParts: ['v1', 'flights', 'booking', 'issue-ticket'],
              body: flightIssue,
              extraHeaders: [{ key: 'X-Idempotency-Key', value: 'idem-flight-{{$timestamp}}', type: 'string' }],
            }),
            req({
              name: '4.2 Issue Ticket (GST on)',
              pathParts: ['v1', 'flights', 'booking', 'issue-ticket'],
              body: flightIssueGst,
              description: 'When pricing addGstInfo=true — includeGst true + full gstDetails.',
              extraHeaders: [{ key: 'X-Idempotency-Key', value: 'idem-flight-gst-{{$timestamp}}', type: 'string' }],
            }),
            req({
              name: '4.3 Issue Ticket (reschedule)',
              pathParts: ['v1', 'flights', 'booking', 'issue-ticket'],
              body: flightIssueReschedule,
              description: 'Both reschedulingReferenceId + reschedulingPnr after cancel, or neither.',
              extraHeaders: [{ key: 'X-Idempotency-Key', value: 'idem-flight-rs-{{$timestamp}}', type: 'string' }],
            }),
          ],
        },
        {
          name: '5. Booking read',
          item: [
            req({
              name: '5.1 Booking Status', method: 'GET',
              pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'status'],
            }),
            req({
              name: '5.2 Booking Detail', method: 'GET',
              pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}'],
            }),
            req({
              name: '5.3 Booking History', method: 'GET',
              pathParts: ['v1', 'flights', 'bookings', 'history'],
            }),
          ],
        },
        {
          name: '6. Cancel / Penalty',
          description: 'Docs: action PENALTY | CANCEL only.',
          item: [
            req({
              name: '6.1 Penalty — full PNR',
              pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'cancel'],
              body: flightPenaltyFull,
              responses: [example('Penalty Fetched', 200, respFlightPenaltyFetched, flightPenaltyFull)],
            }),
            req({
              name: '6.2 Penalty — paxwise',
              pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'cancel'],
              body: flightPenaltyPax,
              description: 'Subset often → Penalty Not Available (HTTP 200). Then CANCEL with same list.',
              responses: [example('Penalty Not Available', 200, respFlightPenaltyNA, flightPenaltyPax)],
            }),
            req({
              name: '6.3 Cancel — full PNR',
              pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'cancel'],
              body: flightCancelFull,
              responses: [example('Cancelled', 200, respFlightCancelFull, flightCancelFull)],
            }),
            req({
              name: '6.4 Cancel — paxwise',
              pathParts: ['v1', 'flights', 'booking', '{{flight_booking_reference}}', 'cancel'],
              body: flightCancelPax,
              responses: [example('Cancellation Requested + paxScope', 200, respFlightCancelPax, flightCancelPax)],
            }),
          ],
        },
      ],
    },
    {
      name: 'Hotels',
      item: [
        {
          name: '1. Search → Prebook',
          item: [
            req({
              name: '1.1 Autocomplete', method: 'GET',
              pathParts: ['v1', 'hotels', 'autocomplete'],
              query: [
                { key: 'q', value: 'mumbai' },
                { key: 'page', value: '1' },
                { key: 'perpage', value: '20' },
                { key: 'lang', value: 'en' },
              ],
              description: 'Save entityId + type into hotel_entity_id / use type in search.',
            }),
            req({
              name: '1.2 Hotel Search',
              pathParts: ['v1', 'hotels', 'search'],
              body: hotelSearch,
              query: [
                { key: 'lang', value: 'en' },
                { key: 'currency', value: 'INR' },
                { key: 'page', value: '0' },
                { key: 'perpage', value: '20' },
              ],
            }),
            req({
              name: '1.3 Hotel Details',
              pathParts: ['v1', 'hotels', 'details'],
              body: hotelDetails,
              description: 'Save room bookingCode + top-level requestId.',
            }),
            req({
              name: '1.4 Hotel Prebook',
              pathParts: ['v1', 'hotels', 'prebook'],
              body: hotelPrebook,
              description: 'Returns bookingContext — forward with bookingCode + requestId to finalize.',
            }),
          ],
        },
        {
          name: '2. Finalize',
          item: [
            req({
              name: '2.1 Finalize (standard)',
              pathParts: ['v1', 'hotels', 'finalize-booking'],
              body: hotelFinalize,
              extraHeaders: [{ key: 'X-Idempotency-Key', value: 'idem-hotel-{{$timestamp}}', type: 'string' }],
            }),
            req({
              name: '2.2 Finalize (GST + PAN)',
              pathParts: ['v1', 'hotels', 'finalize-booking'],
              body: hotelFinalizeGst,
              description: 'When room/hotel requires GST or PAN.',
              extraHeaders: [{ key: 'X-Idempotency-Key', value: 'idem-hotel-gst-{{$timestamp}}', type: 'string' }],
            }),
            req({
              name: '2.3 Finalize (reschedule)',
              pathParts: ['v1', 'hotels', 'finalize-booking'],
              body: hotelFinalizeReschedule,
              description: 'After hotel cancel — set reschedulingReferenceId to cancelled booking reference.',
              extraHeaders: [{ key: 'X-Idempotency-Key', value: 'idem-hotel-rs-{{$timestamp}}', type: 'string' }],
            }),
          ],
        },
        {
          name: '3. Booking read',
          item: [
            req({
              name: '3.1 Booking Status', method: 'GET',
              pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'status'],
            }),
            req({
              name: '3.2 Booking Detail', method: 'GET',
              pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}'],
            }),
            req({
              name: '3.3 Booking History', method: 'GET',
              pathParts: ['v1', 'hotels', 'bookings', 'history'],
            }),
          ],
        },
        {
          name: '4. Penalty / Cancel',
          description: 'Hotel penalty-check and cancel are GET (no body).',
          item: [
            req({
              name: '4.1 Penalty Check', method: 'GET',
              pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'penalty-check'],
              description: 'Quote cancellation charge/refund without cancelling.',
              responses: [example(
                'Penalty Fetched',
                200,
                respHotelPenalty,
                null,
                'GET',
                '{{base_url}}/v1/hotels/bookings/{{hotel_booking_reference}}/penalty-check',
              )],
            }),
            req({
              name: '4.2 Cancel Booking', method: 'GET',
              pathParts: ['v1', 'hotels', 'bookings', '{{hotel_booking_reference}}', 'cancel'],
              responses: [example(
                'Cancelled',
                200,
                respHotelCancel,
                null,
                'GET',
                '{{base_url}}/v1/hotels/bookings/{{hotel_booking_reference}}/cancel',
              )],
            }),
          ],
        },
      ],
    },
  ],
};

fs.writeFileSync(OUT, JSON.stringify(collection, null, 2));
fs.writeFileSync(OUT_DL, JSON.stringify(collection, null, 2));

function countReqs(items) {
  let n = 0;
  for (const it of items || []) {
    if (it.request) n += 1;
    if (it.item) n += countReqs(it.item);
  }
  return n;
}

console.log(JSON.stringify({
  out: OUT,
  downloads: OUT_DL,
  bytes: fs.statSync(OUT).size,
  requests: countReqs(collection.item),
  folders: collection.item.map((f) => f.name),
}, null, 2));
