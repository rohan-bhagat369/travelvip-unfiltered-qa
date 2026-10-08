/**
 * ENG-22 — local OpenTelemetry collector on zenith-api.
 * Hits zenith with staging vgm creds. Unique X-Correlation-ID per call.
 * Does NOT book a live ticket. TC-6 uses a rejected book-shaped payload.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../../shared/config/env.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import { createRequestId } from '../../../shared/lib/signature.js';
import { futureDate } from '../../../shared/lib/testUtils.js';
import { CITY_MUMBAI } from '../../../travel-apis/hotel/src/regression/fixtures.js';
import { buildOneWaySearchBody } from '../../../travel-apis/flight/src/helpers.js';
import { buildAirportSearchBody } from '../../../travel-apis/cab/src/helpers.js';

const ZENITH = process.env.BASE_URL || 'https://zenith-api.travelvip.ai';
const STAGING = process.env.STAGING_URL || 'https://api-staging.travelvip.ai';
const PREFIX = process.env.CORR_PREFIX || `qa-otel-eng22-${Date.now()}`;
const OUT = path.join('reports', 'zenith-otel-eng22.json');

const calls = [];

function preview(data) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  return s.slice(0, 240);
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

async function hit(label, corr, opts, baseUrl = ZENITH) {
  const client = new TravelVipClient({
    baseUrl,
    correlationId: corr,
    authToken: opts.authToken || null,
    partnerKey: opts.partnerKey || null,
  });
  const t0 = Date.now();
  let res;
  try {
    const { extraHeaders, ...rest } = opts;
    res = await client.request({
      extraHeaders: { 'X-Request-Id': createRequestId(), ...(extraHeaders || {}) },
      ...rest,
    });
  } catch (e) {
    const ms = Date.now() - t0;
    const row = {
      label, corr, host: baseUrl, method: opts.method || 'GET', path: opts.path,
      http: 0, ok: false, clientMs: ms, errorCode: 'CLIENT_THROW', bodyPreview: String(e),
    };
    calls.push(row);
    console.log(JSON.stringify(row));
    return row;
  }
  const ms = Date.now() - t0;
  const row = {
    label,
    corr,
    host: baseUrl,
    method: opts.method || 'GET',
    path: opts.path,
    http: res.status,
    ok: res.ok,
    clientMs: ms,
    errorCode: errCode(res),
    bodyPreview: preview(res.data),
  };
  calls.push(row);
  console.log(JSON.stringify(row));
  return { ...row, data: res.data, status: res.status };
}

function stats(msList) {
  const xs = msList.filter((n) => Number.isFinite(n));
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, min: sorted[0], max: sorted[sorted.length - 1], avg: Math.round(avg), p50: sorted[Math.floor(sorted.length / 2)] };
}

async function authOn(baseUrl, corrSuffix) {
  const token = await hit(`auth-token-${corrSuffix}`, `${PREFIX}-${corrSuffix}-token`, {
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: config.partnerId, partner_secret: config.partnerSecret },
    signed: false,
    auth: false,
  }, baseUrl);
  if (!token.ok) return { ok: false };
  const sess = await hit(`auth-session-${corrSuffix}`, `${PREFIX}-${corrSuffix}-session`, {
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: config.tierId },
    signed: false,
    auth: false,
    partnerKey: token.data.access_token,
  }, baseUrl);
  if (!sess.ok) return { ok: false };
  return { ok: true, access: token.data.access_token, authToken: sess.data.auth_token };
}

(async () => {
  const started = new Date().toISOString();
  console.log(JSON.stringify({ baseUrl: ZENITH, staging: STAGING, prefix: PREFIX, partnerId: config.partnerId, tierId: config.tierId }));

  const z = await authOn(ZENITH, 'z');
  if (!z.ok) {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ started, prefix: PREFIX, error: 'zenith auth failed', calls }, null, 2));
    process.exit(1);
  }

  const s = await authOn(STAGING, 's');

  const hotelSearchBody = {
    entityId: CITY_MUMBAI.entityId,
    nationality: 'IN',
    checkin: futureDate(28),
    checkout: futureDate(30),
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: 'vgm',
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };

  // --- TC-1 positives (no book) ---
  await hit('pos-hotel-ac', `${PREFIX}-pos-hotel-ac`, {
    method: 'GET', path: '/v1/hotels/autocomplete', query: { q: 'pune', page: 1, perpage: 5 },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('pos-hotel-search', `${PREFIX}-pos-hotel-search`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', offset: 0, limit: 5, lang: 'en', currency: 'INR' },
    body: hotelSearchBody, signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('pos-airports', `${PREFIX}-pos-airports`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('pos-airlines', `${PREFIX}-pos-airlines`, {
    method: 'GET', path: '/v1/flights/airlines', query: { airline: 'AI' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('pos-citysearch', `${PREFIX}-pos-citysearch`, {
    method: 'GET', path: '/v1/flights/citySearch', query: { q: 'Pune' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });

  const flightBody = buildOneWaySearchBody(35, { origin: 'DEL', destination: 'BOM', maxStops: 0, fareType: 'NORMAL' });
  let flightSearchOk = false;
  for (let i = 0; i < 8; i += 1) {
    const fsRes = await hit(`pos-flight-search-${i}`, `${PREFIX}-pos-flight-search`, {
      method: 'POST', path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' },
      body: flightBody, signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
    });
    const opts = fsRes.data?.results?.[0]?.options?.length || fsRes.data?.options?.length || 0;
    const complete = fsRes.data?.progress?.state === 'COMPLETE' || fsRes.data?.progress?.complete === true;
    if (fsRes.ok && (opts > 0 || complete)) {
      flightSearchOk = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  await hit('pos-cab-search', `${PREFIX}-pos-cab-search`, {
    method: 'POST', path: '/v1/airportServices/cabs/search', query: { lang: 'en', currency: 'INR' },
    body: buildAirportSearchBody(), signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('pos-lounge-airports', `${PREFIX}-pos-lounge-airports`, {
    method: 'GET', path: '/v1/airports/search', query: { q: 'BOM' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('pos-lounge', `${PREFIX}-pos-lounge`, {
    method: 'GET', path: '/v1/lounges', query: { airport: 'BOM' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });

  // --- extra negatives ---
  await hit('neg-omit-bearer', `${PREFIX}-neg-omit-bearer`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' },
    signed: true, auth: false, partnerKey: z.access,
  });
  await hit('neg-garbage-bearer', `${PREFIX}-neg-garbage-bearer`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' },
    signed: true, auth: false, partnerKey: z.access,
    extraHeaders: { Authorization: 'Bearer not-a-real-token' },
  });
  await hit('neg-omit-partner-key', `${PREFIX}-neg-omit-pk`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' },
    signed: true, auth: true, authToken: z.authToken, omitPartnerKey: true,
  });
  await hit('neg-token-omit-id', `${PREFIX}-neg-token-omit-id`, {
    method: 'POST', path: '/auth/partner/token',
    body: { partner_secret: config.partnerSecret },
    signed: false, auth: false,
  });
  await hit('neg-hotel-checkout-before', `${PREFIX}-neg-hotel-dates`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, checkin: futureDate(30), checkout: futureDate(28) },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('neg-hotel-html-name', `${PREFIX}-neg-hotel-html`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, nationality: 'IN<script>' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('neg-flight-same-od', `${PREFIX}-neg-flight-deldel`, {
    method: 'POST', path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR' },
    body: buildOneWaySearchBody(35, { origin: 'DEL', destination: 'DEL' }),
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('neg-flight-html-dest', `${PREFIX}-neg-flight-html`, {
    method: 'POST', path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR' },
    body: buildOneWaySearchBody(35, { origin: 'DEL', destination: '<script>' }),
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });

  // --- TC-5 4xx + attempt 5xx ---
  await hit('tc5-4xx-invalid-payload', `${PREFIX}-tc5-4xx`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, checkin: '15-09-2026', checkout: '17-09-2026' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('tc5-comma-nationality', `${PREFIX}-tc5-comma`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, nationality: 'IN,' },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });

  // --- TC-6 PII: rejected book-shaped bodies (no Confirmed ticket) ---
  const piiIssue = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: 'PII-QA-FAKE',
    searchIds: ['fake-search-id'],
    journeyType: 'ONE_WAY',
    timezone: 'Asia/Calcutta',
    data: {
      priceId: 'fake-price-id',
      passportType: 'FULL',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: 'qa.otel.pii@travelvip.ai',
        mobile: '9876543210',
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
          passport: {
            number: 'Z1234567',
            expiry: '2031-08-01',
            issuedDate: '2020-08-01',
            issuedCountryCode: 'IN',
          },
          ssr: { baggage: [], meals: [], seats: [] },
        },
      ],
      cardNumber: '4111111111111111',
      authorizationJwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJxaS1vdGVsIn0.aaa',
    },
  };
  await hit('tc6-pii-issue-ticket', `${PREFIX}-tc6-pii`, {
    method: 'POST', path: '/api/v2/flights/booking/issue-ticket',
    body: piiIssue, signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });
  await hit('tc6-pii-hotel-finalize', `${PREFIX}-tc6-pii-hotel`, {
    method: 'POST', path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body: {
      bookingCode: 'FAKEBOOKINGCODE',
      requestId: 'fake-request-id',
      checkin: futureDate(28),
      checkout: futureDate(30),
      guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true, dob: '2001-05-29', nationality: 'IN' }],
      contact: { email: 'qa.otel.pii@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
    signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
  });

  // --- TC-2 timings: 5 repeats on zenith vs staging ---
  const timingEndpoints = [
    { key: 'airports', method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' } },
    { key: 'hotel-ac', method: 'GET', path: '/v1/hotels/autocomplete', query: { q: 'pune', page: 1, perpage: 5 } },
    { key: 'hotel-search', method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', offset: 0, limit: 5, lang: 'en', currency: 'INR' }, body: hotelSearchBody },
  ];
  for (const ep of timingEndpoints) {
    for (let i = 0; i < 5; i += 1) {
      await hit(`tc2-z-${ep.key}-${i}`, `${PREFIX}-tc2-z-${ep.key}-${i}`, {
        ...ep, signed: true, auth: true, authToken: z.authToken, partnerKey: z.access,
      }, ZENITH);
    }
    if (s.ok) {
      for (let i = 0; i < 5; i += 1) {
        await hit(`tc2-s-${ep.key}-${i}`, `${PREFIX}-tc2-s-${ep.key}-${i}`, {
          ...ep, signed: true, auth: true, authToken: s.authToken, partnerKey: s.access,
        }, STAGING);
      }
    }
  }

  const timingCompare = {};
  for (const ep of timingEndpoints) {
    const zMs = calls.filter((c) => c.label.startsWith(`tc2-z-${ep.key}-`)).map((c) => c.clientMs);
    const sMs = calls.filter((c) => c.label.startsWith(`tc2-s-${ep.key}-`)).map((c) => c.clientMs);
    timingCompare[ep.key] = { zenith: stats(zMs), staging: stats(sMs) };
  }

  const report = {
    started,
    ended: new Date().toISOString(),
    prefix: PREFIX,
    zenith: ZENITH,
    staging: STAGING,
    notes: {
      noLiveBook: true,
      tc6: 'Rejected book-shaped payloads only (fake priceId / bookingCode).',
      tc7: 'Needs infra to stop otelcol-contrib.',
      flightSearchOk,
      stagingAuth: Boolean(s.ok),
    },
    timingCompare,
    calls: calls.map(({ data, ...rest }) => rest),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ wrote: OUT, calls: calls.length, prefix: PREFIX, timingCompare }));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
