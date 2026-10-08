/**
 * Compare API-doc error responses vs live staging for:
 *  - POST /v1/flights/booking/issue-ticket
 *  - POST /v1/hotels/finalize-booking
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-booking-error-codes.js
 */
import fs from 'fs';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { HotelService } from '../../../hotel/src/service.js';
import {
  buildOneWaySearchBody,
  buildIssueTicketPayload,
} from '../../src/helpers.js';
import {
  buildFinalizeBody,
  buildGuests,
  extractBookingContext,
  isPrebookSuccess,
} from '../../../hotel/src/helpers.js';
import { config } from '../../../../shared/config/env.js';
import { futureDate } from '../../../../shared/lib/testUtils.js';

function summarize(res) {
  const d = res?.data || {};
  return {
    http: res?.status,
    ok: res?.ok,
    bodyStatus: d.status ?? null,
    code: d.code || d.error?.code || null,
    message: d.message || d.error?.message || null,
    available: d.available ?? null,
    required: d.required ?? null,
    bookingReference: d.bookingReference || d.bookingRefId || d.bookingReferenceId || null,
    error: d.error || null,
    rawKeys: Object.keys(d).filter((k) => k !== '_meta'),
    snippet: JSON.stringify(d).slice(0, 500),
  };
}

async function main() {
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const hotel = new HotelService(session.client);
  const client = session.client;

  console.log('Base:', config.baseUrl);

  // --- Prepare a valid flight pricing context (cheap DOM OW) ---
  const fBody = buildOneWaySearchBody(40, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'NORMAL',
    maxStops: 0,
  });
  fBody.preferences.airlines = ['SG', '6E'];
  const search = await flight.searchUntilComplete(fBody);
  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  if (!pricing.ok) throw new Error('pricing failed: ' + JSON.stringify(pricing.data).slice(0, 300));

  const validIssueBody = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });

  const flightCases = [];

  // Doc: 400 invalid params
  flightCases.push({
    caseId: 'FLIGHT_EMPTY_SEARCH_IDS',
    docHttp: 400,
    docMeaning: 'Invalid request parameters',
    result: summarize(await flight.issueTicket({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [],
      journeyType: 'ONE_WAY',
    })),
  });

  flightCases.push({
    caseId: 'FLIGHT_INVALID_PRICE_ID',
    docHttp: '400/422',
    docMeaning: 'Invalid request / fare unavailable',
    result: summarize(await flight.issueTicket({
      bookingContext: pricing.data.bookingContext,
      priceId: 'price_invalid_000',
      searchIds: [search.searchId],
      journeyType: 'ONE_WAY',
    })),
  });

  flightCases.push({
    caseId: 'FLIGHT_INVALID_BOOKING_CONTEXT',
    docHttp: 400,
    docMeaning: 'Invalid request parameters',
    result: summarize(await flight.issueTicket({
      bookingContext: 'invalid-booking-context-token',
      priceId: pricing.data.priceId,
      searchIds: [search.searchId],
      journeyType: 'ONE_WAY',
    })),
  });

  flightCases.push({
    caseId: 'FLIGHT_JOURNEY_TYPE_MISMATCH',
    docHttp: 400,
    docMeaning: 'Invalid request parameters',
    result: summarize(await flight.issueTicket({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [search.searchId],
      journeyType: 'ROUND_TRIP',
    })),
  });

  // Doc: 401
  flightCases.push({
    caseId: 'FLIGHT_NO_AUTH',
    docHttp: 401,
    docMeaning: 'Authentication failed or token expired',
    result: summarize(await client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: { lang: 'en', currency: 'INR' },
      body: validIssueBody,
      correlation: true,
      auth: false,
      partnerKey: session.accessToken,
    })),
  });

  // Doc: 403 partner mismatch / wallet — missing partner key
  const savedPartnerKey = client.partnerKey;
  client.setPartnerKey(null);
  flightCases.push({
    caseId: 'FLIGHT_MISSING_PARTNER_KEY',
    docHttp: 403,
    docMeaning: 'Partner-user mismatch or insufficient wallet balance',
    result: summarize(await client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: { lang: 'en', currency: 'INR' },
      body: validIssueBody,
      correlation: true,
    })),
  });

  flightCases.push({
    caseId: 'FLIGHT_INVALID_PARTNER_KEY',
    docHttp: 403,
    docMeaning: 'Partner-user mismatch or insufficient wallet balance',
    result: summarize(await client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: { lang: 'en', currency: 'INR' },
      body: validIssueBody,
      correlation: true,
      partnerKey: 'invalid-partner-key',
    })),
  });
  client.setPartnerKey(savedPartnerKey);

  // --- Hotel prebook for finalize error cases ---
  const ac = await hotel.autocomplete('Pune');
  const city = (ac.data?.content || []).find((x) => /CITY/i.test(String(x.type || '')) && /pune/i.test(x.title || ''));
  const checkin = futureDate(28);
  const checkout = futureDate(30);
  const roomsOcc = [{ adults: 1, children: 0, childrenAges: [] }];

  const citySearch = await hotel.client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 15, sortby: 'price,asc' },
    body: { checkin, checkout, entityId: String(city.entityId), nationality: 'IN', type: 'CITY', rooms: roomsOcc },
    correlation: true,
  });
  const hotelHits = (citySearch.data?.results || []).filter((h) => h.available !== false);
  if (!hotelHits.length) throw new Error('no hotel for prebook');

  let hotelHit = null;
  let requestId = null;
  let room = null;
  let prebook = null;
  let bookingContext = null;

  for (const h of hotelHits.slice(0, 8)) {
    await hotel.client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { lang: 'en', currency: 'INR' },
      body: { checkin, checkout, entityId: String(h.id), nationality: 'IN', type: 'HOTEL', rooms: roomsOcc },
      correlation: true,
    });
    const details = await hotel.getDetails({
      checkin, checkout, entityId: String(h.id), nationality: 'IN', rooms: roomsOcc,
    });
    const rid = details.data?.requestId;
    const rooms = details.data?.results?.[0]?.rooms || [];
    const candidate = rooms.find((r) => r.bookingCode);
    if (!rid || !candidate) {
      console.log('skip hotel (no rooms)', h.name);
      continue;
    }
    const pb = await hotel.prebook({ bookingCode: candidate.bookingCode, requestId: rid });
    if (!isPrebookSuccess(pb)) {
      console.log('skip hotel (prebook fail)', h.name, JSON.stringify(pb.data).slice(0, 120));
      continue;
    }
    hotelHit = h;
    requestId = rid;
    room = candidate;
    prebook = pb;
    bookingContext = extractBookingContext(pb.data);
    console.log('using hotel', h.name, 'room', Array.isArray(room.name) ? room.name[0] : room.name);
    break;
  }
  if (!hotelHit || !bookingContext) throw new Error('could not prebook any hotel for error probes');

  const validFinalize = buildFinalizeBody({
    bookingContext,
    bookingCode: room.bookingCode,
    requestId,
    checkin,
    checkout,
    guests: buildGuests(),
  });

  const hotelCases = [];

  hotelCases.push({
    caseId: 'HOTEL_INVALID_BOOKING_CODE',
    docHttp: 400,
    docMeaning: 'Invalid request parameters',
    result: summarize(await hotel.finalizeBooking({
      ...validFinalize,
      bookingCode: 'invalid-booking-code',
    })),
  });

  hotelCases.push({
    caseId: 'HOTEL_MISSING_BOOKING_CONTEXT',
    docHttp: 400,
    docMeaning: 'Invalid request parameters',
    result: summarize(await hotel.finalizeBooking({
      ...validFinalize,
      bookingContext: '',
    })),
  });

  hotelCases.push({
    caseId: 'HOTEL_MISSING_ROOMS',
    docHttp: 400,
    docMeaning: 'Invalid request parameters',
    result: summarize(await client.request({
      method: 'POST',
      path: '/v1/hotels/finalize-booking',
      query: { lang: 'en', currency: 'INR' },
      body: { ...validFinalize, rooms: [] },
      correlation: true,
      partnerKey: session.accessToken,
    })),
  });

  client.setPartnerKey(null);
  hotelCases.push({
    caseId: 'HOTEL_MISSING_PARTNER_KEY',
    docHttp: 403,
    docMeaning: 'Booking finalization failed or insufficient funds',
    result: summarize(await client.request({
      method: 'POST',
      path: '/v1/hotels/finalize-booking',
      query: { lang: 'en', currency: 'INR' },
      body: validFinalize,
      correlation: true,
    })),
  });

  hotelCases.push({
    caseId: 'HOTEL_INVALID_PARTNER_KEY',
    docHttp: 403,
    docMeaning: 'Booking finalization failed or insufficient funds',
    result: summarize(await client.request({
      method: 'POST',
      path: '/v1/hotels/finalize-booking',
      query: { lang: 'en', currency: 'INR' },
      body: validFinalize,
      correlation: true,
      partnerKey: 'invalid-partner-key',
    })),
  });
  client.setPartnerKey(savedPartnerKey);

  const report = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    docs: {
      flightIssueTicket: {
        url: 'https://api-docs.travelvip.ai/#tag/Flights/operation/issueFlightTicket',
        path: 'POST /v1/flights/booking/issue-ticket',
        documentedHttp: {
          200: 'Flight booking initiated successfully',
          400: 'Invalid request parameters',
          401: 'Authentication failed or token expired',
          403: 'Partner-user mismatch or insufficient wallet balance',
          409: 'Duplicate booking (idempotency key already used)',
          422: 'Fare expired or unavailable',
          429: 'Rate limit exceeded',
        },
      },
      hotelFinalize: {
        url: 'https://api-docs.travelvip.ai/#tag/Hotels/operation/finalizeHotelBooking',
        path: 'POST /v1/hotels/finalize-booking',
        documentedHttp: {
          200: 'Hotel booking finalized successfully',
          400: 'Invalid request parameters',
          401: 'Authentication failed or token expired',
          403: 'Booking finalization failed or insufficient funds',
          429: 'Rate limit exceeded',
        },
      },
    },
    knownBusinessErrorCodesFromPriorRuns: [
      {
        code: 'WALLET_INSUFFICIENT_BALANCE',
        message: 'Insufficient wallet balance to complete this booking.',
        fields: ['available', 'required'],
        note: 'Often returned with HTTP 200 and body status 400 (or as status/code fields). Seen on finalize/book wallet-debit flows.',
        example: {
          status: 400,
          code: 'WALLET_INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance to complete this booking.',
          available: 133221,
          required: 147150,
        },
      },
    ],
    flightLiveCases: flightCases,
    hotelLiveCases: hotelCases,
    context: {
      flight: {
        searchId: search.searchId,
        priceId: pricing.data.priceId,
        airline: pricing.data.itinerary?.[0]?.segments?.[0]?.airline?.code,
        totalAmount: pricing.data.pricing?.totalAmount,
      },
      hotel: {
        hotelId: hotelHit.id,
        hotelName: hotelHit.name,
        checkin,
        checkout,
        prebookRequestId: requestId,
        hotelNameFromSearch: hotelHit.name,
      },
    },
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.mkdirSync('reports/shared', { recursive: true });
  const out = 'reports/shared/booking-error-codes-dev.json';
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log('\n=== FLIGHT ISSUE TICKET ===');
  for (const c of flightCases) {
    console.log(JSON.stringify({
      caseId: c.caseId,
      docHttp: c.docHttp,
      http: c.result.http,
      code: c.result.code,
      bodyStatus: c.result.bodyStatus,
      message: c.result.message,
    }));
  }
  console.log('\n=== HOTEL FINALIZE ===');
  for (const c of hotelCases) {
    console.log(JSON.stringify({
      caseId: c.caseId,
      docHttp: c.docHttp,
      http: c.result.http,
      code: c.result.code,
      bodyStatus: c.result.bodyStatus,
      message: c.result.message,
    }));
  }
  console.log('\nWrote', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
