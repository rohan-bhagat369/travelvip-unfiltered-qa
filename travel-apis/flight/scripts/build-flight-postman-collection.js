/**
 * Build an up-to-date Flights-only Postman collection from docs + live samples.
 *   node scripts/build-flight-postman-collection.js
 */
import fs from 'fs';

const OUT = 'postman/TravelVIP-Flights-Updated.postman_collection.json';
const SRC = 'c:/Users/Rohan Bhagat/Downloads/TravelVIP.postman.json';

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

function cloneReq(src, overrides = {}) {
  if (!src?.request) throw new Error(`missing source ${overrides.name}`);
  const req = JSON.parse(JSON.stringify(src.request));
  // Normalize URL host to {{base_url}}
  if (req.url && typeof req.url === 'object') {
    req.url.host = ['{{base_url}}'];
  }
  return {
    name: overrides.name || src.name,
    event: src.event ? JSON.parse(JSON.stringify(src.event)) : undefined,
    request: { ...req, ...(overrides.request || {}) },
    response: overrides.response || [],
  };
}

function setBody(item, rawObj) {
  item.request.body = {
    mode: 'raw',
    raw: `${JSON.stringify(rawObj, null, 2)}\n`,
    options: { raw: { language: 'json' } },
  };
  return item;
}

function setUrl(item, pathParts, query = [
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
]) {
  item.request.url = {
    raw: `{{base_url}}/${pathParts.join('/')}?lang=en&currency=INR`,
    host: ['{{base_url}}'],
    path: pathParts,
    query,
  };
  return item;
}

function example(name, status, body, originalBody) {
  return {
    name,
    status: String(status),
    code: status,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    cookie: [],
    body: JSON.stringify(body, null, 2),
    originalRequest: originalBody
      ? {
          method: 'POST',
          header: [],
          body: {
            mode: 'raw',
            raw: JSON.stringify(originalBody, null, 2),
            options: { raw: { language: 'json' } },
          },
          url: { raw: '{{base_url}}/v1/flights/booking/{{booking_reference}}/cancel' },
        }
      : undefined,
  };
}

// --- Source requests ---
const src = {
  airports: byName('Airport Search'),
  airlines: byName('Airline Search'),
  search: byName('Flight Search'),
  details: byName('Flight Details'),
  fareRules: byName('Flight Fare Rules'),
  pricing: byName('Flight Pricing'),
  city: byName('City Search'),
  ssr: byName('Flight SSR'),
  seatmap: byName('Flight SeatMap'),
  issue: byName('Issue Flight Ticket'),
  status: byName('Flight Booking Status'),
  detail: byName('Flight Booking Detail'),
  history: byName('Flight Booking History'),
  penalty: byName('Cancellation Penlty Check'),
  cancel: byName('Flight Cancellation'),
};

for (const [k, v] of Object.entries(src)) {
  if (!v) console.warn('WARN missing source', k);
}

// --- Updated payloads (docs-aligned) ---
const searchBody = {
  itinerary: [{ origin: 'BOM', destination: 'HYD', date: '2026-11-12' }],
  travellers: { adults: 2, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ONE_WAY',
  fareType: 'NORMAL',
  preferences: { airlines: [], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
};

const detailsBody = {
  journeyType: 'ONE_WAY',
  selection: { selectedSearchIds: ['{{search_id}}'] },
};

const fareRulesBody = {
  journeyType: 'ONE_WAY',
  selection: { selectedSearchIds: ['{{search_id}}'] },
};

const pricingBody = {
  journeyType: 'ONE_WAY',
  selection: { selectedSearchIds: ['{{search_id}}'] },
};

const ssrBody = { priceId: '{{price_id}}' };

const seatmapBody = {
  currency: 'INR',
  requestReference: '{{price_id}}',
  passengers: [{ paxId: 'PAX1', type: 'adult' }, { paxId: 'PAX2', type: 'adult' }],
};

const issueBody = {
  type: 'ticket',
  currency: 'INR',
  language: 'en',
  bookingReference: '{{pricing_booking_reference}}',
  searchIds: ['{{search_id}}'],
  journeyType: 'ONE_WAY',
  timezone: 'Asia/Calcutta',
  reschedulingReferenceId: null,
  reschedulingPnr: null,
  data: {
    priceId: '{{price_id}}',
    passportType: 'NONE',
    includeGst: false,
    gstDetails: null,
    contact: {
      email: 'qa@travelvip.ai',
      mobile: '9921862715',
      countryCode: '+91',
    },
    passengers: [
      {
        paxId: 'PAX1',
        type: 'adult',
        isLead: true,
        profile: {
          title: 'Mr',
          firstName: 'Rohan',
          lastName: 'Bhagat',
          gender: 'Male',
          dob: '2001-05-29',
          nationality: 'IN',
        },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: null,
        ssr: { baggage: [], meals: [], seats: [] },
      },
      {
        paxId: 'PAX2',
        type: 'adult',
        isLead: false,
        profile: {
          title: 'Mr',
          firstName: 'Amit',
          lastName: 'Sharma',
          gender: 'Male',
          dob: '1995-08-15',
          nationality: 'IN',
        },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: null,
        ssr: { baggage: [], meals: [], seats: [] },
      },
    ],
  },
};

const issueGstBody = {
  ...issueBody,
  data: {
    ...issueBody.data,
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

const issueRescheduleBody = {
  ...issueBody,
  reschedulingReferenceId: '{{cancelled_booking_reference}}',
  reschedulingPnr: '{{cancelled_pnr}}',
};

const penaltyFullBody = { action: 'PENALTY', pnr: '{{pnr}}' };
const penaltyPaxBody = {
  action: 'PENALTY',
  pnr: '{{pnr}}',
  cancellationPaxList: ['PAX1'],
};
const cancelFullBody = {
  action: 'CANCEL',
  pnr: '{{pnr}}',
  cancellationReason: 'Customer requested cancellation',
  remarks: 'cancelled by user',
  cancelledBy: 'USER',
};
const cancelPaxBody = {
  action: 'CANCEL',
  pnr: '{{pnr}}',
  cancellationPaxList: ['PAX1'],
  cancellationReason: 'Partial pax cancel',
};

// Live-shaped responses (docs-aligned)
const respPenaltyFetched = {
  status: 0,
  statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805',
    pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Penalty Fetched',
      estimatedCancellationCharge: 350,
      estimatedRefund: 8047,
      createdAt: '2026-08-12T15:01:51Z',
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};

const respPenaltyNotAvailable = {
  status: 0,
  statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805',
    pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Penalty Not Available',
      message:
        "PNR 'KPGQYI' carries 2 passengers and cancellationPaxList names 1 (PAX1). The airline prices a cancellation for the whole PNR, so the charge for individual passengers cannot be calculated. Omit cancellationPaxList to get the charge for the full PNR, or send action CANCEL with cancellationPaxList to raise a cancellation request for these passengers — the exact charge is then confirmed with the airline before any refund is made.",
      createdAt: '2026-08-12T15:01:51Z',
    },
    paxScope: {
      scope: 'PARTIAL_PAX',
      cancellationPaxList: ['PAX1'],
      totalPaxOnPnr: 2,
      cancelledPaxCount: 1,
      prorated: false,
      penaltyQuotable: false,
      reasonCode: 'PENALTY_NOT_AVAILABLE_FOR_PARTIAL_PAX',
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};

const respCancelRequested = {
  status: 0,
  statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805',
    pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Cancellation Requested',
      message: 'No estimated cancellation and refund amount available',
      createdAt: '2026-08-12T15:01:53Z',
    },
    paxScope: {
      scope: 'PARTIAL_PAX',
      cancellationPaxList: ['PAX1'],
      totalPaxOnPnr: 2,
      cancelledPaxCount: 1,
      prorated: true,
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};

const respCancelFull = {
  status: 0,
  statusMessage: 'Success',
  data: {
    bookingReference: 'BR1786546901714805',
    pnr: 'KPGQYI',
    cancellationRequest: {
      status: 'Cancelled',
      estimatedCancellationCharge: 700,
      estimatedRefund: 16094,
      createdAt: '2026-08-12T15:02:00Z',
    },
  },
  _meta: { correlation_id: 'e32c38e2-601d-49c6-946a-c5e759efe63b' },
};

// Build items — reuse auth/signing scripts from source where present
function withSigning(item) {
  if (!item.event && src.penalty?.event) {
    item.event = JSON.parse(JSON.stringify(src.penalty.event));
  }
  // Ensure standard headers
  const headers = [
    { key: 'Authorization', value: 'Bearer {{auth_token}}', type: 'string' },
    { key: 'X-Request-Id', value: '{{request_id}}', type: 'string' },
    { key: 'X-Timestamp', value: '{{timestamp}}', type: 'string' },
    { key: 'X-Signature', value: '{{signature}}', type: 'string' },
    { key: 'X-Correlation-ID', value: '{{correlation_id}}', type: 'string' },
    { key: 'X-Partner-Key', value: '{{access_token}}', type: 'string' },
    { key: 'Content-Type', value: 'application/json', type: 'string' },
  ];
  item.request.header = headers;
  item.request.auth = { type: 'noauth' };
  return item;
}

function getItem(name, pathParts, method = 'GET') {
  const base = src.airports || src.search;
  const item = cloneReq(base, { name });
  item.request.method = method;
  setUrl(item, pathParts);
  if (method === 'GET') {
    delete item.request.body;
  }
  return withSigning(item);
}

function postItem(name, pathParts, body, responses = []) {
  const base = src.search || src.penalty;
  const item = cloneReq(base, { name, response: responses });
  item.request.method = 'POST';
  setUrl(item, pathParts);
  setBody(item, body);
  return withSigning(item);
}

const collection = {
  info: {
    name: 'TravelVIP Flights — Updated Payloads',
    description: [
      '# TravelVIP Flights — Updated Payloads',
      '',
      'Generated to match current API docs (`https://api-docs.travelvip.ai/#tag/Flights`) and live staging responses.',
      '',
      '## Covers',
      '- Full book flow: search → details → fareRules → pricing → SSR → seatmap → issue-ticket → status/detail/history',
      '- Cancel: PENALTY (full + paxwise), CANCEL (full + paxwise)',
      '- Issue variants: standard, GST-on, reschedule',
      '',
      '## Not included',
      '- `PENALTY_AND_CANCEL` — present in older collections but **not** in current API docs (use PENALTY then CANCEL)',
      '',
      '## Setup',
      '1. Import this collection',
      '2. Use env with: `base_url`, `partner_id`, `partner_secret`, `signing_key`, then run Partner Auth to set `access_token` / `auth_token`',
      '3. Run requests top → bottom; save `search_id`, `price_id`, `booking_reference`, `pnr` into collection vars',
      '',
      `Generated: ${new Date().toISOString()}`,
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
    { key: 'search_id', value: '' },
    { key: 'price_id', value: '' },
    { key: 'pricing_booking_reference', value: '' },
    { key: 'booking_reference', value: '' },
    { key: 'pnr', value: '' },
    { key: 'cancelled_booking_reference', value: '' },
    { key: 'cancelled_pnr', value: '' },
  ],
  item: [
    {
      name: '0. Auth (required once)',
      description: 'Copy partner token + session requests from main TravelVIP collection, or set access_token/auth_token manually.',
      item: [
        {
          name: 'README — set tokens',
          request: {
            method: 'GET',
            header: [],
            url: { raw: '{{base_url}}/v1/partners/me', host: ['{{base_url}}'], path: ['v1', 'partners', 'me'] },
            description: 'Placeholder. Import Partner Access Token + Auth Session from the main TravelVIP collection first, or paste tokens into collection variables.',
          },
        },
      ],
    },
    {
      name: '1. Reference data',
      item: [
        getItem('1.1 Airport Search', ['v1', 'flights', 'airports'], 'GET'),
        getItem('1.2 Airline Search', ['v1', 'flights', 'airlines'], 'GET'),
        getItem('1.3 City Search', ['v1', 'flights', 'citySearch'], 'GET'),
      ],
    },
    {
      name: '2. Search → Price',
      item: [
        postItem('2.1 Flight Search', ['v1', 'flights', 'search'], searchBody),
        postItem('2.2 Flight Details', ['v1', 'flights', 'details'], detailsBody),
        postItem('2.3 Flight Fare Rules', ['v1', 'flights', 'fareRules'], fareRulesBody),
        postItem('2.4 Flight Pricing', ['v1', 'flights', 'pricing'], pricingBody),
      ],
    },
    {
      name: '3. Ancillaries',
      item: [
        postItem('3.1 Flight SSR', ['v1', 'flights', 'ssr'], ssrBody),
        postItem('3.2 Flight SeatMap', ['v1', 'flights', 'seatmap'], seatmapBody),
      ],
    },
    {
      name: '4. Issue ticket',
      item: [
        (() => {
          const it = postItem('4.1 Issue Ticket (standard)', ['v1', 'flights', 'booking', 'issue-ticket'], issueBody);
          it.request.header.push({ key: 'X-Idempotency-Key', value: 'idem-{{$timestamp}}', type: 'string' });
          return it;
        })(),
        (() => {
          const it = postItem('4.2 Issue Ticket (GST on)', ['v1', 'flights', 'booking', 'issue-ticket'], issueGstBody);
          it.request.header.push({ key: 'X-Idempotency-Key', value: 'idem-gst-{{$timestamp}}', type: 'string' });
          it.request.description = 'Use when pricing `addGstInfo: true`. Mirror includeGst + full gstDetails.';
          return it;
        })(),
        (() => {
          const it = postItem('4.3 Issue Ticket (reschedule)', ['v1', 'flights', 'booking', 'issue-ticket'], issueRescheduleBody);
          it.request.header.push({ key: 'X-Idempotency-Key', value: 'idem-rs-{{$timestamp}}', type: 'string' });
          it.request.description = 'Send BOTH reschedulingReferenceId and reschedulingPnr after cancelling the old PNR. Omit both (or null) for a normal booking.';
          return it;
        })(),
      ],
    },
    {
      name: '5. Booking read',
      item: [
        getItem('5.1 Booking Status', ['v1', 'flights', 'booking', '{{booking_reference}}', 'status'], 'GET'),
        getItem('5.2 Booking Detail', ['v1', 'flights', 'booking', '{{booking_reference}}'], 'GET'),
        getItem('5.3 Booking History', ['v1', 'flights', 'bookings', 'history'], 'GET'),
      ],
    },
    {
      name: '6. Cancel / Penalty (docs-aligned)',
      description: 'Docs action enum: PENALTY | CANCEL only. Do not use PENALTY_AND_CANCEL.',
      item: [
        (() => {
          const it = postItem(
            '6.1 Penalty — full PNR',
            ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
            penaltyFullBody,
            [
              example('Penalty Fetched', 200, respPenaltyFetched, penaltyFullBody),
            ],
          );
          it.request.description = 'Optional quote before cancel. Omit cancellationPaxList for whole-PNR penalty.';
          return it;
        })(),
        (() => {
          const it = postItem(
            '6.2 Penalty — paxwise (subset)',
            ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
            penaltyPaxBody,
            [
              example('Penalty Not Available (PARTIAL_PAX)', 200, respPenaltyNotAvailable, penaltyPaxBody),
            ],
          );
          it.request.description = 'Subset PENALTY often returns Penalty Not Available (HTTP 200) — not an error. Then use CANCEL with the same list.';
          return it;
        })(),
        (() => {
          const it = postItem(
            '6.3 Cancel — full PNR',
            ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
            cancelFullBody,
            [
              example('Cancelled', 200, respCancelFull, cancelFullBody),
            ],
          );
          it.request.description = 'Includes optional cancellationReason, remarks, cancelledBy from API docs.';
          return it;
        })(),
        (() => {
          const it = postItem(
            '6.4 Cancel — paxwise (PARTIAL_PAX)',
            ['v1', 'flights', 'booking', '{{booking_reference}}', 'cancel'],
            cancelPaxBody,
            [
              example('Cancellation Requested + paxScope', 200, respCancelRequested, cancelPaxBody),
            ],
          );
          it.request.description = 'Partial pax cancel → Cancellation Requested + paxScope.PARTIAL_PAX (offline/CS path).';
          return it;
        })(),
      ],
    },
  ],
};

// Fix GET airport query (airport=del)
const airports = collection.item[1].item[0];
airports.request.url.query = [
  { key: 'airport', value: 'del' },
  { key: 'page', value: '1' },
  { key: 'perpage', value: '20' },
  { key: 'lang', value: 'en' },
  { key: 'currency', value: 'INR' },
];
airports.request.url.raw = '{{base_url}}/v1/flights/airports?airport=del&page=1&perpage=20&lang=en&currency=INR';

const airlines = collection.item[1].item[1];
airlines.request.url.query = [
  { key: 'airline', value: '6E' },
  { key: 'page', value: '1' },
  { key: 'perpage', value: '20' },
  { key: 'lang', value: 'en' },
];
airlines.request.url.raw = '{{base_url}}/v1/flights/airlines?airline=6E&page=1&perpage=20&lang=en';

const city = collection.item[1].item[2];
city.request.url.query = [
  { key: 'city', value: 'mum' },
  { key: 'page', value: '1' },
  { key: 'perpage', value: '20' },
  { key: 'lang', value: 'en' },
];
city.request.url.raw = '{{base_url}}/v1/flights/citySearch?city=mum&page=1&perpage=20&lang=en';

fs.writeFileSync(OUT, JSON.stringify(collection, null, 2));
console.log('Wrote', OUT);
console.log('Requests:', JSON.stringify(collection.item.map((f) => ({
  folder: f.name,
  items: (f.item || []).map((i) => i.name),
})), null, 2));
