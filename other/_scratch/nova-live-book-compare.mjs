/**
 * Live book parity: Hotel + Cab + Flight on Node vs Canary.
 * Usage: node other/_scratch/nova-live-book-compare.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const POSTMAN_ENV = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
);

const env = {};
{
  const j = JSON.parse(fs.readFileSync(POSTMAN_ENV, 'utf8'));
  for (const v of j.environments[0].variables) env[v.name] = v.value ?? v.initialValue ?? '';
}
const PARTNER_ID = env.partner_id || 'vgm';
const PARTNER_SECRET = env.partner_secret;
const SIGNING_KEY = env.signing_key;
const TIER_ID = Number(env.tier_id || 10546901);
const NODE = 'https://dev-nova-api.travelvip.ai';
const LEGACY = 'https://canary-api.travelvip.ai';

const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function sign(body, ts) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(`${body || ''}${ts}`).digest('hex');
}
function rid() {
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function futureDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function futureIsoZ(days, hour = 18) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 35, 58, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function brief(d, n = 500) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}
function topKeys(o) {
  return o && typeof o === 'object' ? Object.keys(o) : [];
}
function shapeDiff(a, b) {
  const A = new Set(topKeys(a));
  const B = new Set(topKeys(b));
  return {
    missingInNode: [...A].filter((k) => !B.has(k)),
    extraInNode: [...B].filter((k) => !A.has(k)),
  };
}

async function call(base, { method = 'GET', path: p, body, authToken, partnerKey, signed = true }) {
  const bodyStr = body == null ? '' : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': rid(),
    'X-Correlation-ID': rid(),
  };
  if (signed) {
    headers['X-Timestamp'] = ts;
    headers['X-Signature'] = sign(bodyStr, ts);
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (partnerKey) headers['X-Partner-Key'] = partnerKey;
  const started = Date.now();
  try {
    const res = await fetch(`${base}${p}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : bodyStr || undefined,
      signal: AbortSignal.timeout(180000),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { _raw: text.slice(0, 400) };
    }
    return { status: res.status, ms: Date.now() - started, data, ok: res.status >= 200 && res.status < 300 };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, data: { error: { code: 'CLIENT_ERROR', message: String(e.message || e) } }, ok: false };
  }
}

async function authHop(base) {
  const tokenRes = await call(base, {
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET },
    signed: false,
  });
  const access = tokenRes.data?.access_token;
  const sessionRes = await call(base, {
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: TIER_ID },
    partnerKey: access,
    signed: false,
  });
  return {
    ok: sessionRes.ok,
    access,
    authToken: sessionRes.data?.auth_token,
    tokenStatus: tokenRes.status,
    sessionStatus: sessionRes.status,
    sessionMsg: sessionRes.data?.message || sessionRes.data?.code,
  };
}

function pickBr(data) {
  return (
    data?.bookingRefId ||
    data?.bookingReferenceId ||
    data?.bookingReference ||
    data?.bookingId ||
    data?.data?.bookingRefId ||
    data?.error?.details?.bookingReference ||
    null
  );
}

async function pollStatus(base, auth, pathFn, max = 18) {
  let last = null;
  for (let i = 0; i < max; i++) {
    last = await call(base, {
      method: 'GET',
      path: pathFn(),
      authToken: auth.authToken,
      partnerKey: auth.access,
    });
    const st = String(last.data?.status || last.data?.bookingStatus || '');
    console.log(`    poll ${i + 1}: http=${last.status} status=${st || '-'}`);
    if (/confirmed|cancelled|failed|rejected|booked|success/i.test(st)) return last;
    if (!last.ok && last.status >= 400 && last.status !== 404) return last;
    await sleep(3000);
  }
  return last;
}

async function bookHotel(label, base, auth) {
  console.log(`\n===== HOTEL BOOK @ ${label} =====`);
  const steps = [];
  const entityIds = ['357389:IN', '39627872', '2869073'];
  let found = null;

  for (const entityId of entityIds) {
    for (const days of [25, 32, 40, 18]) {
      const checkin = futureDate(days);
      const checkout = futureDate(days + 1);
      const searchBody = {
        checkin,
        checkout,
        entityId,
        nationality: 'IN',
        type: entityId.includes(':') ? 'CITY' : 'HOTEL',
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      };
      const search = await call(base, {
        method: 'POST',
        path: '/v1/hotels/search?currency=INR&page=0&perpage=10&lang=en',
        body: searchBody,
        authToken: auth.authToken,
        partnerKey: auth.access,
      });
      steps.push({ step: 'search', entityId, checkin, status: search.status, ok: search.ok, total: search.data?.totalResults });
      if (!search.ok || !(search.data?.results?.length > 0)) continue;

      // Prefer cheapest available with booking path via details on first few hotels
      const hotels = search.data.results.slice(0, 8);
      for (const h of hotels) {
        const detailsBody = {
          checkin,
          checkout,
          entityId: String(h.id),
          nationality: 'IN',
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        };
        const details = await call(base, {
          method: 'POST',
          path: '/v1/hotels/details?lang=en&currency=INR&page=0&perpage=20',
          body: detailsBody,
          authToken: auth.authToken,
          partnerKey: auth.access,
        });
        const requestId = details.data?.requestId || search.data?.requestId;
        const rooms = details.data?.results?.[0]?.rooms || [];
        const codes = rooms
          .filter((r) => r?.bookingCode && r.available !== false)
          .sort((a, b) => (String(a.bookingCode).includes('rh-test') ? 0 : 1) - (String(b.bookingCode).includes('rh-test') ? 0 : 1));
        if (!requestId || !codes.length) continue;

        for (const room of codes.slice(0, 5)) {
          const prebook = await call(base, {
            method: 'POST',
            path: '/v1/hotels/prebook?lang=en&currency=INR',
            body: { bookingCode: room.bookingCode, requestId },
            authToken: auth.authToken,
            partnerKey: auth.access,
          });
          const bookingContext = prebook.data?.bookingContext;
          if (!(prebook.ok && bookingContext)) continue;
          found = {
            searchBody,
            hotelName: h.name || details.data?.results?.[0]?.name,
            bookingCode: room.bookingCode,
            requestId,
            bookingContext,
            room,
            prebook,
            details,
          };
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (found) break;
  }

  if (!found) {
    return { product: 'hotel', label, base, ok: false, error: 'NO_INVENTORY', steps };
  }

  console.log(`  inventory: ${found.hotelName} ${found.searchBody.checkin} code=${!!found.bookingCode}`);
  const finalizeBody = {
    bookingContext: found.bookingContext,
    bookingCode: found.bookingCode,
    requestId: found.requestId,
    checkin: found.searchBody.checkin,
    checkout: found.searchBody.checkout,
    rooms: [
      {
        guests: [
          {
            title: 'Mr',
            firstName: 'Rohan',
            lastName: 'Bhagat',
            type: 'Adult',
            isLead: true,
          },
        ],
      },
    ],
    contact: {
      email: `nova.hotel.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: '9921862715',
      panCardNumber: PAN.panCardNumber,
      panCardName: PAN.panCardName,
    },
  };
  if (found.room?.isGSTClaimable || found.room?.isGstClaimable) finalizeBody.gstDetails = { ...GST };

  const finalize = await call(base, {
    method: 'POST',
    path: '/v1/hotels/finalize-booking?lang=en&currency=INR&page=0&perpage=20',
    body: finalizeBody,
    authToken: auth.authToken,
    partnerKey: auth.access,
  });
  const br = pickBr(finalize.data);
  console.log(`  finalize: ${finalize.status} br=${br} ${brief(finalize.data, 280)}`);
  steps.push({
    step: 'finalize',
    status: finalize.status,
    ok: finalize.ok,
    br,
    errorCode: finalize.data?.error?.code || null,
    topKeys: topKeys(finalize.data),
    sample: brief(finalize.data, 400),
  });

  let statusRes = null;
  let detailRes = null;
  if (br) {
    statusRes = await pollStatus(base, auth, () => `/v1/hotels/bookings/${br}/status?currency=INR&lang=en`);
    detailRes = await call(base, {
      method: 'GET',
      path: `/v1/hotels/bookings/${br}?lang=en&currency=INR`,
      authToken: auth.authToken,
      partnerKey: auth.access,
    });
    steps.push({
      step: 'status',
      status: statusRes?.status,
      bookingStatus: statusRes?.data?.status,
      topKeys: topKeys(statusRes?.data),
    });
    steps.push({
      step: 'detail',
      status: detailRes.status,
      topKeys: topKeys(detailRes.data),
      sample: brief(detailRes.data, 300),
    });
  }

  return {
    product: 'hotel',
    label,
    base,
    ok: Boolean(br),
    br,
    finalStatus: statusRes?.data?.status || finalize.data?.status || null,
    hotelName: found.hotelName,
    checkin: found.searchBody.checkin,
    finalizeHttp: finalize.status,
    finalizeKeys: topKeys(finalize.data),
    errorCode: finalize.data?.error?.code || null,
    requestKeys: Object.keys(finalizeBody),
    steps,
    finalizeSample: brief(finalize.data, 600),
  };
}

async function bookCab(label, base, auth) {
  console.log(`\n===== CAB BOOK @ ${label} =====`);
  const steps = [];
  let ready = null;

  for (let i = 0; i < 8; i++) {
    const pickupDatetime = futureIsoZ(10 + i, 18);
    const searchBody = {
      journeyType: 'RENTAL',
      travelType: 'DEPARTURE',
      pickup: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
      drop: { name: 'Keshav Nagar, Pune', city: 'Pune', latitude: 18.5518, longitude: 73.9467 },
      distanceKm: 20,
      durationMin: 120,
      pickupDatetime,
    };
    const search = await call(base, {
      method: 'POST',
      path: '/v1/airportServices/cabs/search?lang=en&currency=INR',
      body: searchBody,
      authToken: auth.authToken,
      partnerKey: auth.access,
    });
    const cab = (search.data?.cabs || []).find((c) => c?.searchId && c.fareId && c.fareId !== 'Unknown') || search.data?.cabs?.[0];
    steps.push({ step: 'search', status: search.status, cabs: search.data?.cabs?.length, pickupDatetime });
    if (!cab?.searchId) continue;

    const fare = await call(base, {
      method: 'POST',
      path: '/v1/airportServices/cabs/fare?lang=en&currency=INR',
      body: { searchId: cab.searchId },
      authToken: auth.authToken,
      partnerKey: auth.access,
    });
    const bookingReference = fare.data?.bookingReference;
    const priceId = fare.data?.priceId;
    steps.push({
      step: 'fare',
      status: fare.status,
      hasBookingReference: !!bookingReference,
      hasPriceId: !!priceId,
      topKeys: topKeys(fare.data),
      errorCode: fare.data?.error?.code || null,
    });
    if (bookingReference && priceId) {
      ready = { searchBody, fare, bookingReference, priceId, cab };
      break;
    }
  }

  if (!ready) return { product: 'cab', label, base, ok: false, error: 'NO_FARE', steps };

  const finalizeBody = {
    bookingReference: ready.bookingReference,
    priceId: ready.priceId,
    passengers: [
      {
        paxId: 1,
        paxType: 'ADT',
        isLead: true,
        profile: {
          title: 'Mr',
          firstName: 'Rohan',
          lastName: 'Bhagat',
          gender: 'male',
          dob: '1990-01-02',
          nationality: 'IN',
        },
      },
    ],
    contact: {
      email: `nova.cab.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: '9921862715',
    },
    otherDetails: 'Nova Node vs Canary live book test — cancel if needed',
  };

  const finalize = await call(base, {
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking?lang=en&currency=INR',
    body: finalizeBody,
    authToken: auth.authToken,
    partnerKey: auth.access,
  });
  const br = pickBr(finalize.data);
  console.log(`  finalize: ${finalize.status} br=${br} ${brief(finalize.data, 280)}`);
  steps.push({
    step: 'finalize',
    status: finalize.status,
    ok: finalize.ok,
    br,
    errorCode: finalize.data?.error?.code || null,
    topKeys: topKeys(finalize.data),
    sample: brief(finalize.data, 400),
  });

  let statusRes = null;
  if (br) {
    statusRes = await pollStatus(base, auth, () => `/v1/airportServices/cabs/${br}/status?lang=en&currency=INR`, 10);
    steps.push({ step: 'status', status: statusRes?.status, bookingStatus: statusRes?.data?.status, topKeys: topKeys(statusRes?.data) });
  }

  return {
    product: 'cab',
    label,
    base,
    ok: Boolean(br),
    br,
    finalStatus: statusRes?.data?.status || finalize.data?.status || null,
    finalizeHttp: finalize.status,
    finalizeKeys: topKeys(finalize.data),
    errorCode: finalize.data?.error?.code || null,
    requestKeys: Object.keys(finalizeBody),
    steps,
    finalizeSample: brief(finalize.data, 600),
  };
}

async function bookFlight(label, base, auth) {
  console.log(`\n===== FLIGHT BOOK @ ${label} =====`);
  const steps = [];
  // Keep attempts short; if no inventory → SKIP (do not grind all routes/dates).
  const routes = [
    ['DEL', 'BOM'],
    ['BOM', 'GOI'],
  ];
  const dates = [20, 25];
  let searchId = null;
  let searchBody = null;
  let searchRes = null;
  let noFlightHits = 0;

  outer: for (const [o, d] of routes) {
    for (const day of dates) {
      searchBody = {
        itinerary: [{ origin: o, destination: d, date: futureDate(day) }],
        travellers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'ECONOMY',
        journeyType: 'ONE_WAY',
        currency: 'INR',
        language: 'en',
        preferences: { airlines: [], maxStops: 2, refundableOnly: false },
        appliedFilters: {},
        selection: { selectedSearchIds: [] },
      };
      searchRes = await call(base, {
        method: 'POST',
        path: '/v1/flights/search?lang=en&currency=INR&page=0&perpage=10',
        body: searchBody,
        authToken: auth.authToken,
        partnerKey: auth.access,
      });
      // poll if in progress
      for (let p = 0; p < 4 && searchRes.data?.progress?.state === 'INPROGRESS'; p++) {
        await sleep(searchRes.data.progress.pollAfterMs || 3000);
        searchRes = await call(base, {
          method: 'POST',
          path: '/v1/flights/search?lang=en&currency=INR&page=0&perpage=10',
          body: {
            ...searchBody,
            selection: { selectedSearchIds: searchRes.data?.selection?.selectedSearchIds || [] },
          },
          authToken: auth.authToken,
          partnerKey: auth.access,
        });
      }
      searchId = searchRes.data?.results?.[0]?.options?.[0]?.searchId || null;
      const errCode = searchRes.data?.error?.code || null;
      steps.push({
        step: 'search',
        route: `${o}-${d}`,
        date: searchBody.itinerary[0].date,
        status: searchRes.status,
        code: errCode,
        progress: searchRes.data?.progress?.state || null,
        searchId: !!searchId,
      });
      console.log(`  search ${o}-${d} ${searchBody.itinerary[0].date}: ${searchRes.status} ${errCode || searchRes.data?.progress?.state || ''} sid=${!!searchId}`);
      if (searchId) break outer;
      if (errCode === 'NO_FLIGHTS_FOUND' || errCode === 'VENDOR_ERROR') {
        noFlightHits += 1;
        if (noFlightHits >= 2) {
          console.log('  SKIP — no flights found (stopping further date/route tries)');
          break outer;
        }
      }
    }
  }

  if (!searchId) {
    console.log('  SKIPPED_NO_FLIGHTS');
    return {
      product: 'flight',
      label,
      base,
      ok: false,
      skipped: true,
      error: 'SKIPPED_NO_FLIGHTS',
      steps,
      searchHttp: searchRes?.status,
      searchCode: searchRes?.data?.error?.code,
    };
  }

  const sel = { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [searchId] } };
  const details = await call(base, {
    method: 'POST',
    path: '/v1/flights/details?lang=en&currency=INR',
    body: sel,
    authToken: auth.authToken,
    partnerKey: auth.access,
  });
  steps.push({ step: 'details', status: details.status, code: details.data?.error?.code, topKeys: topKeys(details.data) });

  const pricing = await call(base, {
    method: 'POST',
    path: '/v1/flights/pricing?lang=en&currency=INR',
    body: sel,
    authToken: auth.authToken,
    partnerKey: auth.access,
  });
  steps.push({
    step: 'pricing',
    status: pricing.status,
    code: pricing.data?.error?.code,
    topKeys: topKeys(pricing.data),
    sample: brief(pricing.data, 350),
  });
  console.log(`  pricing: ${pricing.status} ${pricing.data?.error?.code || ''} ${brief(pricing.data, 200)}`);

  const bookingContext =
    pricing.data?.bookingReference ||
    pricing.data?.bookingContext ||
    pricing.data?.encryptedBookingReference ||
    details.data?.bookingReference ||
    details.data?.bookingContext ||
    details.data?.pricing?.bookingReference ||
    null;
  const priceId =
    pricing.data?.priceId ||
    pricing.data?.pricingId ||
    pricing.data?.pricing?.priceId ||
    details.data?.pricing?.priceId ||
    null;

  if (!bookingContext) {
    return {
      product: 'flight',
      label,
      base,
      ok: false,
      error: 'NO_BOOKING_CONTEXT',
      searchId,
      steps,
      detailsHttp: details.status,
      pricingHttp: pricing.status,
      pricingCode: pricing.data?.error?.code || null,
    };
  }

  const issueBody = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: bookingContext,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
    timezone: 'Asia/Calcutta',
    data: {
      priceId: priceId || undefined,
      passportType: 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: `nova.flight.${Date.now()}@travelvip.ai`,
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
            dob: '1992-05-15',
            nationality: 'IN',
          },
          city: { cityCode: 'Pune', cityName: 'Pune' },
          passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
          ssr: { baggage: [], meals: [], seats: [] },
        },
      ],
    },
  };

  const issue = await call(base, {
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket?lang=en&currency=INR',
    body: issueBody,
    authToken: auth.authToken,
    partnerKey: auth.access,
  });
  const br = pickBr(issue.data);
  console.log(`  issue-ticket: ${issue.status} br=${br} ${brief(issue.data, 300)}`);
  steps.push({
    step: 'issue-ticket',
    status: issue.status,
    br,
    code: issue.data?.error?.code || null,
    topKeys: topKeys(issue.data),
    sample: brief(issue.data, 450),
  });

  let statusRes = null;
  if (br) {
    statusRes = await pollStatus(base, auth, () => `/v1/flights/booking/${br}/status?lang=en&currency=INR`, 20);
    steps.push({ step: 'status', status: statusRes?.status, bookingStatus: statusRes?.data?.status, topKeys: topKeys(statusRes?.data) });
  }

  return {
    product: 'flight',
    label,
    base,
    ok: Boolean(br),
    br,
    finalStatus: statusRes?.data?.status || issue.data?.status || null,
    searchId,
    finalizeHttp: issue.status,
    finalizeKeys: topKeys(issue.data),
    errorCode: issue.data?.error?.code || null,
    requestKeys: Object.keys(issueBody),
    steps,
    finalizeSample: brief(issue.data, 600),
  };
}

async function main() {
  console.log('LIVE BOOK compare Node vs Canary');
  console.log('NODE', NODE);
  console.log('LEGACY', LEGACY);

  const legacyAuth = await authHop(LEGACY);
  const nodeAuthRaw = await authHop(NODE);
  const nodeAuth = {
    ...nodeAuthRaw,
    authToken: nodeAuthRaw.ok ? nodeAuthRaw.authToken : legacyAuth.authToken,
  };
  const authNote = nodeAuthRaw.ok
    ? 'native'
    : `fallback_legacy_jwt (node session ${nodeAuthRaw.sessionStatus}: ${nodeAuthRaw.sessionMsg})`;
  console.log('Auth legacy', legacyAuth.sessionStatus, '| node', nodeAuthRaw.sessionStatus, authNote);
  if (!legacyAuth.ok || !nodeAuth.access || !nodeAuth.authToken) {
    console.error('Auth blocked');
    process.exit(2);
  }

  const hotelLegacy = await bookHotel('CANARY', LEGACY, legacyAuth);
  const hotelNode = await bookHotel('NODE', NODE, nodeAuth);
  const cabLegacy = await bookCab('CANARY', LEGACY, legacyAuth);
  const cabNode = await bookCab('NODE', NODE, nodeAuth);
  const flightLegacy = await bookFlight('CANARY', LEGACY, legacyAuth);
  const flightNode = await bookFlight('NODE', NODE, nodeAuth);

  const pairs = [
    ['hotel', hotelLegacy, hotelNode],
    ['cab', cabLegacy, cabNode],
    ['flight', flightLegacy, flightNode],
  ];

  const compare = pairs.map(([product, L, N]) => ({
    product,
    canary: {
      ok: L.ok,
      skipped: !!L.skipped,
      br: L.br,
      finalStatus: L.finalStatus,
      http: L.finalizeHttp,
      error: L.error || L.errorCode,
      keys: L.finalizeKeys,
    },
    node: {
      ok: N.ok,
      skipped: !!N.skipped,
      br: N.br,
      finalStatus: N.finalStatus,
      http: N.finalizeHttp,
      error: N.error || N.errorCode,
      keys: N.finalizeKeys,
    },
    responseKeyDiff: shapeDiff(
      Object.fromEntries((L.finalizeKeys || []).map((k) => [k, true])),
      Object.fromEntries((N.finalizeKeys || []).map((k) => [k, true])),
    ),
    verdict: (() => {
      if (L.skipped || N.skipped) return 'SKIPPED_NO_INVENTORY';
      if (L.ok && N.ok) {
        const diff = shapeDiff(
          Object.fromEntries((L.finalizeKeys || []).map((k) => [k, true])),
          Object.fromEntries((N.finalizeKeys || []).map((k) => [k, true])),
        );
        return diff.missingInNode.length || diff.extraInNode.length ? 'WARN_SHAPE' : 'PASS_BOTH_BOOKED';
      }
      if (!L.ok && !N.ok) return 'BOTH_FAILED';
      return L.ok && !N.ok ? 'NODE_FAILED' : 'CANARY_FAILED';
    })(),
  }));

  const report = {
    at: new Date().toISOString(),
    authNote,
    compare,
    hotelLegacy,
    hotelNode,
    cabLegacy,
    cabNode,
    flightLegacy,
    flightNode,
  };

  const outJson = path.join(ROOT, 'other/_scratch/nova-live-book-report.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = [
    '# Nova vs Canary — Live booking compare',
    '',
    `**When:** ${report.at}`,
    `**Auth:** ${authNote}`,
    '',
    '| Product | Canary | Node | Verdict |',
    '|---------|--------|------|---------|',
    ...compare.map((c) => {
      const fmt = (side) =>
        side.ok
          ? `OK BR=${side.br} status=${side.finalStatus}`
          : String(side.error || '').startsWith('SKIPPED')
            ? `SKIP ${side.error}`
            : `FAIL ${side.error || side.http || '-'}`;
      return `| ${c.product} | ${fmt(c.canary)} | ${fmt(c.node)} | **${c.verdict}** |`;
    }),
    '',
    '## Details',
    '',
  ];
  for (const [name, L, N] of [
    ['Hotel', hotelLegacy, hotelNode],
    ['Cab', cabLegacy, cabNode],
    ['Flight', flightLegacy, flightNode],
  ]) {
    md.push(`### ${name}`);
    md.push(`- Canary: http=${L.finalizeHttp || L.searchHttp} br=${L.br || '-'} status=${L.finalStatus || '-'} err=${L.error || L.errorCode || L.pricingCode || '-'}`);
    md.push(`  - sample: \`${L.finalizeSample || brief(L)}\``);
    md.push(`- Node: http=${N.finalizeHttp || N.searchHttp} br=${N.br || '-'} status=${N.finalStatus || '-'} err=${N.error || N.errorCode || N.pricingCode || '-'}`);
    md.push(`  - sample: \`${N.finalizeSample || brief(N)}\``);
    md.push(`- Request keys: \`${(N.requestKeys || L.requestKeys || []).join(', ')}\``);
    md.push('');
  }

  const outMd = path.join(ROOT, 'other/_scratch/NOVA-LIVE-BOOK-REPORT.md');
  fs.writeFileSync(outMd, md.join('\n'));
  console.log('\n==== SUMMARY ====');
  for (const c of compare) {
    console.log(
      `${c.product}: ${c.verdict} | Canary ${c.canary.ok ? c.canary.br : c.canary.error} | Node ${c.node.ok ? c.node.br : c.node.error}`,
    );
  }
  console.log('Wrote', outJson);
  console.log('Wrote', outMd);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
