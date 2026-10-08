/**
 * Dev-ready hotel validation bugs — staging evidence pack
 * Generated from probe run 2026-08-10 against api-staging.travelvip.ai
 *
 * Expected for ALL invalid cases:
 *   HTTP 400
 *   {
 *     "error": {
 *       "code": "VALIDATION_ERROR",
 *       "message": "Validation failed",
 *       "details": ["...","..."],
 *       "timestamp": "...",
 *       "request_id": "..."
 *     }
 *   }
 * Finalize: nothing created (no wallet hold / no rows / no supplier call).
 */
export const meta = {
  baseUrl: 'https://api-staging.travelvip.ai',
  partner: 'vgm',
  probedAt: '2026-08-10T06:31:34Z',
  correlation_id: 'f7a1d323-9b61-4b76-8186-5853540a0a9c',
  finalizePath: 'POST /api/v2/hotels/finalize-booking',
  searchPath: 'POST /v1/hotels/search',
  detailsPath: 'POST /v1/hotels/details',
  prebookPath: 'POST /v1/hotels/prebook',
  fullReport: 'reports/hotel-payload-validations-staging.json',
};

/** P0 — invalid finalize created bookings */
export const P0_finalize_accepted = [
  {
    id: 'HOT-FIN-DATE-01',
    title: 'Finalize accepts invalid checkin DD-MM-YYYY and creates booking',
    endpoint: 'POST /api/v2/hotels/finalize-booking',
    mutatedField: 'checkin',
    requestMutation: { checkin: '14-09-2026' },
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: {
      http: 200,
      body: {
        status: 'Pending',
        statusCode: 200,
        bookingRefId: 'BR1786343470299898',
      },
    },
  },
  {
    id: 'HOT-FIN-DATE-02',
    title: 'Finalize accepts checkin with slashes',
    mutatedField: 'checkin',
    requestMutation: { checkin: '2026/09/14' },
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343470610730' } },
  },
  {
    id: 'HOT-FIN-DATE-03',
    title: 'Finalize accepts unpadded checkin',
    mutatedField: 'checkin',
    requestMutation: { checkin: '2026-9-14' },
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343471867354' } },
  },
  {
    id: 'HOT-FIN-DATE-04',
    title: 'Finalize accepts impossible date 2026-02-30',
    mutatedField: 'checkin',
    requestMutation: { checkin: '2026-02-30', checkout: '2026-03-02' },
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343472637630' } },
  },
  {
    id: 'HOT-FIN-DATE-05',
    title: 'Finalize accepts checkout == checkin',
    mutatedField: 'checkout',
    requestMutation: { note: 'checkout set equal to checkin' },
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343472998761' } },
  },
  {
    id: 'HOT-FIN-DATE-06',
    title: 'Finalize accepts past checkin',
    mutatedField: 'checkin',
    requestMutation: { checkin: '2020-01-15', checkout: '2020-01-17' },
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343473513607' } },
  },
  {
    id: 'HOT-FIN-GUEST-01',
    title: 'Finalize accepts type Infant',
    mutatedField: 'rooms[0].guests[1].type',
    requestMutation: {
      rooms: [{ guests: [{ /* lead Adult */ }, { title: 'Mstr', firstName: 'Arjun', lastName: 'Patil', type: 'Infant', age: 1, isLead: false }] }],
    },
    expected: { http: 400, code: 'VALIDATION_ERROR', detailHint: "must be one of: Adult, Child" },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343474213234' } },
  },
  {
    id: 'HOT-FIN-GUEST-02',
    title: 'Finalize accepts title MR / mr (case-sensitive titles required)',
    mutatedField: 'rooms[0].guests[0].title',
    requestMutationExamples: [{ title: 'MR' }, { title: 'mr' }],
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: {
      http: 200,
      bookingRefIds: ['BR1786343474209519', 'BR1786343475906891'],
    },
  },
  {
    id: 'HOT-FIN-GUEST-03',
    title: 'Finalize accepts Adult with title Mstr / Child with title Mr',
    requestMutationExamples: [
      { adultTitle: 'Mstr' },
      { childTitle: 'Mr' },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: {
      http: 200,
      bookingRefIds: ['BR1786343475167124', 'BR1786343476402857'],
    },
  },
  {
    id: 'HOT-FIN-GUEST-04',
    title: 'Finalize accepts title/gender mismatch (Mr + Female)',
    mutatedField: 'rooms[0].guests[0].gender',
    requestMutation: { title: 'Mr', gender: 'Female' },
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343476474200' } },
  },
  {
    id: 'HOT-FIN-GUEST-05',
    title: 'Finalize accepts hyphen/apostrophe in lastName (docs now forbid punctuation)',
    requestMutationExamples: [
      { lastName: 'Jean-Luc' },
      { lastName: "O'Brien" },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR', detailHint: 'letters and spaces only' },
    actual: {
      http: 200,
      bookingRefIds: ['BR1786343477407197', 'BR1786343478535548'],
      note: 'API error text for digits still says apostrophes/hyphens/dots ARE allowed — conflicts with new docs',
    },
  },
  {
    id: 'HOT-FIN-GUEST-06',
    title: 'Finalize accepts Child age 18',
    mutatedField: 'rooms[0].guests[1].age',
    requestMutation: { type: 'Child', age: 18, title: 'Mstr' },
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: { http: 200, body: { status: 'Pending', bookingRefId: 'BR1786343479457474' } },
  },
  {
    id: 'HOT-FIN-GUEST-07',
    title: 'Finalize accepts future dob / non-YYYY-MM-DD dob / age-from-dob mismatches',
    requestMutationExamples: [
      { dob: '2099-01-01' },
      { dob: '29-05-2001' },
      { adultDobUnder18OnCheckin: true },
      { childDobAdultOnCheckin: true },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: {
      http: 200,
      bookingRefIds: [
        'BR1786343479668051',
        'BR1786343480182289',
        'BR1786343480960382',
        'BR1786343481247571',
      ],
    },
  },
  {
    id: 'HOT-FIN-CONTACT-01',
    title: 'Finalize accepts invalid +91 mobile (not 6-9 start / wrong length)',
    requestMutationExamples: [
      { countryCode: '+91', mobile: '5123456789' },
      { countryCode: '+91', mobile: '98765' },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: {
      http: 200,
      bookingRefIds: ['BR1786343484550038', 'BR1786343484504721'],
    },
  },
  {
    id: 'HOT-FIN-CONTACT-02',
    title: 'Finalize accepts invalid PAN / PAN without panCardName',
    requestMutationExamples: [
      { panCardNumber: 'BADPAN', panCardName: 'TRAVELVIP' },
      { panCardNumber: 'AABCT1332L', panCardName: '' },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: {
      http: 200,
      bookingRefIds: ['BR1786343489187211', 'BR1786343490597030'],
    },
  },
  {
    id: 'HOT-FIN-GST-01',
    title: 'Finalize accepts partial/invalid GST block',
    requestMutationExamples: [
      { gstDetails: { gstNumber: '27AABCT1332L1ZU' } },
      {
        gstDetails: {
          gstNumber: 'INVALID',
          gstCompanyName: 'TravelVIP',
          gstAddress: 'Mumbai',
          gstEmailID: 'accounts@travelvip.ai',
          gstMobileNumber: '9820011223',
        },
      },
      {
        gstDetails: {
          gstNumber: '27AABCT1332L1ZU',
          gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
          gstAddress: 'BKC Mumbai',
          gstEmailId: 'accounts@travelvip.ai',
          gstMobileNumber: '9820011223',
        },
        note: 'wrong key gstEmailId — should be treated as missing gstEmailID',
      },
      {
        gstDetails: {
          gstNumber: '27AABCT1332L1ZU',
          gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
          gstAddress: 'BKC Mumbai',
          gstEmailID: 'accounts@travelvip.ai',
          gstMobileNumber: '5123456789',
        },
      },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR', noBooking: true },
    actual: {
      http: 200,
      bookingRefIds: [
        'BR1786343491348575',
        'BR1786343492400614',
        'BR1786343492118269',
        'BR1786343493607292',
      ],
    },
  },
];

/** P1 — rule sometimes enforced but envelope incomplete */
export const P1_envelope = [
  {
    id: 'HOT-ENV-01',
    title: 'VALIDATION_ERROR returns details:null instead of details[]',
    examples: [
      {
        mutation: { 'rooms[0].guests[0].firstName': 'Rohan2' },
        actual: {
          http: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'rooms[0].guests[0].firstName is invalid. Only letters, spaces, apostrophes, hyphens and dots are allowed',
              details: null,
              timestamp: '2026-08-10T06:31:17Z',
              request_id: 'req-1786343477261',
            },
          },
        },
      },
      {
        mutation: { 'rooms[0].guests[0].firstName': 'R' },
        actual: {
          http: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'rooms[0].guests[0].firstName must be between 2 and 50 characters',
              details: null,
              timestamp: '2026-08-10T06:31:18Z',
              request_id: 'req-1786343478779',
            },
          },
        },
      },
      {
        mutation: { 'contact.email': 'bad' },
        actual: {
          http: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'contact.email is invalid',
              details: null,
              timestamp: '2026-08-10T06:31:34Z',
              request_id: 'req-1786343494182',
            },
          },
        },
      },
      {
        mutation: { delete: 'contact.email' },
        actualMessage: 'contact.email is required',
      },
      {
        mutation: { delete: 'contact.countryCode' },
        actualMessage: 'contact.countryCode is required',
      },
      {
        mutation: { delete: 'contact.mobile' },
        actualMessage: 'contact.mobile is required',
      },
      {
        mutation: { noLead: true },
        actualMessage: 'A lead guest is required (set isLead to true for exactly one guest)',
      },
      {
        mutation: { twoLeads: true },
        actualMessage: 'Only one guest can be marked as lead (isLead)',
      },
      {
        mutation: { childMissingAge: true },
        actualMessage: 'rooms[0].guests[1].age is required for Child',
      },
    ],
    expected: {
      details: ['...'],
      note: 'details must always be an array of messages; multiple problems listed together',
    },
  },
  {
    id: 'HOT-ENV-02',
    title: 'Multiple validation failures not aggregated',
    requestMutation: {
      checkin: '14-09-2026',
      'rooms[0].guests[0].firstName': 'R',
      'contact.email': 'bad',
    },
    expected: {
      http: 400,
      code: 'VALIDATION_ERROR',
      detailsMinLength: 2,
    },
    actual: {
      http: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'rooms[0].guests[0].firstName must be between 2 and 50 characters',
          details: null,
          timestamp: '2026-08-10T06:31:34Z',
          request_id: 'req-1786343494273',
        },
      },
      note: 'Only one message returned; date + email errors omitted',
    },
  },
];

/** P1 — search/details/prebook legacy envelope + silent accepts */
export const P1_search_details_prebook = [
  {
    id: 'HOT-SEARCH-01',
    title: 'Search accepts unpadded date and returns hotels',
    endpoint: 'POST /v1/hotels/search',
    requestMutation: { checkin: '2026-8-22' },
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: {
      http: 200,
      bodySnippet: { totalResults: 1, availableResults: 1, hotel: 'Taj Dubai' },
    },
  },
  {
    id: 'HOT-SEARCH-02',
    title: 'Search accepts adults as string / decimal; children decimal; childrenAges string',
    requestMutationExamples: [
      { 'rooms[0].adults': '1' },
      { 'rooms[0].adults': 1.5 },
      { 'rooms[0].children': 1.5, 'rooms[0].childrenAges': [9] },
      { 'rooms[0].children': 1, 'rooms[0].childrenAges': ['9'] },
    ],
    expected: { http: 400, code: 'VALIDATION_ERROR', detailHint: 'whole number / not text' },
    actual: { http: 200, bodySnippet: { totalResults: 1, availableResults: 1 } },
  },
  {
    id: 'HOT-SEARCH-03',
    title: 'Search validation errors return HTTP 200 with legacy {status:400,message}',
    examples: [
      {
        mutation: { checkin: '2020-01-15', checkout: '2020-01-17' },
        actual: { http: 200, body: { status: 400, message: 'Check-in date cannot be in the past.' } },
      },
      {
        mutation: { 'rooms[0].adults': 0 },
        actual: { http: 200, body: { status: 400, message: 'Room 1 must have between 1 and 6 adults.' } },
      },
      {
        mutation: { 'rooms[0].adults': 7 },
        actual: { http: 200, body: { status: 400, message: 'Room 1 must have between 1 and 6 adults.' } },
      },
      {
        mutation: { 'rooms[0].children': 5, childrenAges: [1, 2, 3, 4, 5] },
        actual: { http: 200, body: { status: 400, message: 'Room 1 can have at most 4 children.' } },
      },
      {
        mutation: { nationality: 'IND' },
        actual: {
          http: 200,
          body: {
            status: 400,
            message: 'Nationality must be a valid 2-letter country code (for example IN, US or AE).',
          },
        },
      },
      {
        mutation: { roomsCount: 7 },
        actual: { http: 200, body: { status: 400, message: 'A maximum of 6 rooms is allowed per booking.' } },
      },
    ],
    expectedEnvelope: {
      http: 400,
      error: { code: 'VALIDATION_ERROR', details: ['...'] },
    },
  },
  {
    id: 'HOT-SEARCH-04',
    title: 'Search slash date returns HTTP 200 + JHipster problem+json (not shared envelope)',
    requestMutation: { checkin: '2026/08/22' },
    actual: {
      http: 200,
      body: {
        type: 'https://www.jhipster.tech/problem/problem-with-message',
        title: 'Bad Request',
        status: 400,
        detail: 'JSON parse error: Cannot deserialize value of type `java.util.Date` from String "2026/08/22": expected format "yyyy-MM-dd"',
        path: '/api/hotels/v2/availability/listing',
        message: 'error.http.400',
      },
    },
  },
  {
    id: 'HOT-DETAILS-01',
    title: 'Details accepts unpadded checkin',
    endpoint: 'POST /v1/hotels/details',
    requestMutation: { checkin: '2026-8-22' },
    expected: { http: 400, code: 'VALIDATION_ERROR' },
    actual: { http: 200, bodySnippet: { totalResults: 1, hotel: 'Taj Dubai' } },
  },
  {
    id: 'HOT-PREBOOK-01',
    title: 'Prebook blank fields use legacy envelope (HTTP 200)',
    endpoint: 'POST /v1/hotels/prebook',
    examples: [
      {
        body: { bookingCode: '', requestId: 'req-dummy' },
        actual: { http: 200, body: { status: 400, message: 'bookingCode is required' } },
      },
      {
        body: { bookingCode: 'dummy-code', requestId: '' },
        actual: { http: 200, body: { status: 400, message: 'requestId is required' } },
      },
      {
        body: {},
        actual: { http: 200, body: { status: 400, message: 'Request body is required' } },
        note: 'Docs: both bookingCode + requestId missing should be reported together in details[]',
      },
    ],
  },
];

export const summaryForDev = {
  p0Count: 16,
  p1Count: 8,
  ask: [
    'Return real HTTP 400 (not 200 with body.status=400).',
    'Use shared error envelope with details as array.',
    'Aggregate all validation problems in one response.',
    'On finalize VALIDATION_ERROR: do not create bookingRefId / Pending booking.',
    'Align name punctuation rules with docs (letters+spaces only) OR update docs.',
    'Reject string/decimal occupancy fields and unpadded dates on search/details.',
  ],
};
