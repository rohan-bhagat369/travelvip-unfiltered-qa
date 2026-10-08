/**
 * Fast Track + Attractions booking E2E with exact price extraction.
 *
 * Output focuses on:
 * - Fast Track: booking detail `salesSummary.totalAmount`
 * - Attractions: booking detail `salesSummary.totalAmount` and also `details.price`
 *
 * Run:
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-fasttrack-attractions-e2e-prices.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const Q_INR = { lang: 'en', currency: 'INR' };
const TERMINALS = ['Terminal 1', 'Terminal 2', 'Terminal 3'];

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}

function brOf(data) {
  return data?.bookingRefId || data?.bookingReferenceId || data?.bookingReference || null;
}

function isoDateDaysFromNow(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findFirstStringByKey(obj, keyRegex) {
  let found = null;
  const walk = (x) => {
    if (found) return;
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      for (const it of x) walk(it);
      return;
    }
    for (const [k, v] of Object.entries(x)) {
      if (found) return;
      if (typeof v === 'string' && keyRegex.test(k)) {
        found = v;
        return;
      }
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(obj);
  return found;
}

async function fasttrackFlow(client) {
  console.log('\n================ Fast Track E2E =================');

  // 1) Search airport by query
  const ap = await client.request({
    method: 'GET',
    path: '/v1/fasttracks/airports/search',
    query: { ...Q_INR, page: 0, perpage: 20, q: 'dxb' },
    correlation: true,
  });
  if (!ok(ap)) throw new Error(`fasttrack airport search failed: ${ap.status}`);
  const airports = ap.data?.results || [];
  if (!Array.isArray(airports) || airports.length === 0) throw new Error('fasttrack airport search returned none');

  let chosen = null;
  for (const airport of airports) {
    const airportId = airport?.airportId || airport?.id;
    if (!airportId) continue;

    for (const terminal of TERMINALS) {
      const list = await client.request({
        method: 'GET',
        path: '/v1/fasttracks',
        query: {
          ...Q_INR,
          page: 0,
          perpage: 10,
          airportId,
          terminal,
          terminalSide: 'Departure',
        },
        correlation: true,
      });
      if (!ok(list)) continue;
      const results = list.data?.results;
      const first = Array.isArray(results) ? results[0] : null;
      if (!first?.productId) continue;

      const optionId = first.availableOptions?.[0]?.optionId || first.options?.[0]?.optionId;
      if (!optionId) continue;

      chosen = { airport, airportId, terminal, productId: first.productId, optionId };
      break;
    }
    if (chosen) break;
  }

  // Fallback: existing Fast Track tests use `3110` as a known working airportId.
  if (!chosen) {
    const fallbackAirportId = 3110;
    for (const terminal of TERMINALS) {
      const list = await client.request({
        method: 'GET',
        path: '/v1/fasttracks',
        query: {
          ...Q_INR,
          page: 0,
          perpage: 10,
          airportId: fallbackAirportId,
          terminal,
          terminalSide: 'Departure',
        },
        correlation: true,
      });
      if (!ok(list)) continue;
      const first = Array.isArray(list.data?.results) ? list.data?.results[0] : null;
      if (!first?.productId) continue;
      const optionId = first.availableOptions?.[0]?.optionId || first.options?.[0]?.optionId;
      if (!optionId) continue;
      chosen = {
        airport: { airportId: fallbackAirportId },
        airportId: fallbackAirportId,
        terminal,
        productId: first.productId,
        optionId,
      };
      break;
    }
  }

  if (!chosen) throw new Error('fasttrack: no product found across airports/terminals (including fallback 3110)');
  console.log(
    'fasttrack chosen:',
    chosen.airport?.airportCode || chosen.airport?.code || chosen.airport?.iataCode || '',
    'airportId:',
    chosen.airportId,
    'terminal:',
    chosen.terminal,
  );

  const { productId, optionId } = chosen;

  // 3) Detail to get bookingContext (and to verify option)
  const detail = await client.request({
    method: 'GET',
    path: `/v1/fasttracks/${productId}`,
    query: { ...Q_INR, optionId },
    correlation: true,
  });
  if (!ok(detail)) throw new Error(`fasttrack detail failed: ${detail.status}`);

  // bookingContext is expected inside options in response
  const bookingContextFromKey = findFirstStringByKey(detail.data, /bookingcontext/i);
  const bookingContextFromRef = findFirstStringByKey(detail.data, /bookingreference/i);
  const bookingContext = bookingContextFromKey || bookingContextFromRef;
  if (!bookingContext) throw new Error('fasttrack bookingContext/bookingReference not found in detail response');
  if (!bookingContextFromKey && bookingContextFromRef) {
    console.log('fasttrack: using bookingReference as bookingContext payload value');
  }

  // 4) Finalize booking
  const travelDate = isoDateDaysFromNow(2);
  const travelTime = '07:20';
  const finalizeBody = {
    bookingContext,
    travelDate,
    travelTime,
    passengers: [
      {
        paxType: 'ADT',
        isLead: true,
        profile: {
          title: 'Ms',
          firstName: (config.flight?.passengerFirstName || 'Rohan').replace(/[^A-Za-z]/g, '') || 'Rohan',
          lastName: (config.flight?.passengerLastName || 'Bhagat').replace(/[^A-Za-z]/g, '') || 'Bhagat',
          gender: 'MALE',
          dob: config.flight?.passengerDob || '2001-05-29',
          nationality: 'IN',
        },
      },
    ],
    contact: {
      email: config.flight?.contactEmail || 'rohan@travelvip.ai',
      countryCode: config.flight?.contactCountryCode || '+91',
      mobile: config.flight?.contactMobile || '9876543210',
    },
  };

  const fin = await client.request({
    method: 'POST',
    path: '/v1/airportServices/fasttracks/finalize-booking',
    query: Q_INR,
    body: finalizeBody,
    correlation: true,
  });
  const br = brOf(fin.data);
  console.log('fasttrack finalize:', 'HTTP', fin.status, 'BR', br, 'status', fin.data?.status);
  if (!ok(fin) || !br) throw new Error('fasttrack finalize failed');

  // 5) Poll status briefly
  let status = fin.data?.status || null;
  for (let i = 0; i < 8; i++) {
    const st = await client.request({
      method: 'GET',
      path: `/v1/airportServices/fasttrack/${br}/status`,
      query: Q_INR,
      correlation: true,
    });
    status = st.data?.status || st.data?.bookingStatus || status;
    console.log('fasttrack poll', i + 1, 'status=', status);
    if (['Confirmed', 'Failed', 'Cancelled'].includes(String(status))) break;
    await sleep(2500);
  }

  // 6) Booking details -> exact price
  const booking = await client.request({
    method: 'GET',
    path: `/v1/airportServices/fasttrack/booking/${br}`,
    query: Q_INR,
    correlation: true,
  });
  if (!ok(booking)) throw new Error(`fasttrack booking details failed: ${booking.status}`);
  const totalAmount = booking.data?.salesSummary?.totalAmount;
  console.log('fasttrack exact totalAmount:', totalAmount, 'currency:', booking.data?.salesSummary?.currency);

  return {
    br,
    status,
    totalAmount,
    bookingDetails: booking.data,
  };
}

async function attractionsFlow(client) {
  console.log('\n================ Attractions E2E =================');

  // 1) Search attractions (get a cityId/product seeds)
  const search = await client.request({
    method: 'GET',
    path: '/v1/attractions/search',
    query: { ...Q_INR, page: 0, perpage: 20, q: 'paris' },
    correlation: true,
  });
  if (!ok(search)) throw new Error(`attractions search failed: ${search.status}`);

  const searchResults = search.data?.results || [];
  if (!Array.isArray(searchResults) || searchResults.length === 0) throw new Error('attractions search empty');

  // Try multiple candidate cityIds until /v1/attractions returns products.
  let chosen = null;
  const candidates = searchResults
    .map((r) => ({ cityId: r?.cityId || r?.entityId || r?.id, country: r?.country, title: r?.title }))
    .filter((x) => x.cityId);

  for (const c of candidates) {
    const list = await client.request({
      method: 'GET',
      path: '/v1/attractions',
      query: { ...Q_INR, page: 0, perpage: 10, cityId: c.cityId },
      correlation: true,
    });
    if (!ok(list)) continue;
    const resultsObj = list.data?.results;
    const resultsArr = Array.isArray(resultsObj) ? resultsObj : Object.values(resultsObj || {});
    if (!resultsArr.length) continue;

    const productId = resultsArr[0]?.productId;
    if (!productId) continue;
    chosen = { cityId: c.cityId, country: c.country, title: c.title, productId };
    break;
  }

  if (!chosen) throw new Error('attractions: no purchasable product found across candidate cityIds');

  console.log('attractions chosen:', chosen.title || '', 'cityId:', chosen.cityId, 'country:', chosen.country, 'productId:', chosen.productId);

  // 3) Product detail to find optionId + variantId
  const detail = await client.request({
    method: 'GET',
    path: `/v1/attractions/${chosen.productId}`,
    query: { ...Q_INR },
    correlation: true,
  });
  if (!ok(detail)) throw new Error(`attractions detail failed: ${detail.status}`);

  const productDetails = detail.data?.results;
  const productDetailsArr = Array.isArray(productDetails) ? productDetails : Object.values(productDetails || {});
  const firstProduct = productDetailsArr[0];
  const optionId = firstProduct?.options?.[0]?.optionId;
  const variantId = firstProduct?.options?.[0]?.variants?.[0]?.variantId;
  if (!firstProduct || !optionId || !variantId) throw new Error('attractions optionId/variantId not found from product detail');

  // 4) Availability -> bookingReference + slots (with limited retry)
  const contact = {
    fullName: `${config.flight?.passengerFirstName || 'Rohan'} ${config.flight?.passengerLastName || 'Bhagat'}`,
    email: config.flight?.contactEmail || 'rohan@travelvip.ai',
    countryCode: config.flight?.contactCountryCode || '+91',
    mobile: config.flight?.contactMobile || '9876543210',
  };

  const attemptResults = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const dateFrom = isoDateDaysFromNow(3 + (attempt - 1) * 2);
    const dateTo = dateFrom;

    const availability = await client.request({
      method: 'POST',
      path: '/v1/attractions/availability',
      query: { ...Q_INR, optionId },
      body: {
        dateFrom,
        dateTo,
        productId: chosen.productId,
        variants: [{ variantId, quantity: 1 }],
      },
      correlation: true,
    });
    if (!ok(availability)) {
      console.log('attractions availability attempt', attempt, 'failed http', availability.status);
      continue;
    }

    const bookingReference = availability.data?.bookingReference || availability.data?.bookingRef;
    const slots = availability.data?.slots || [];
    if (!bookingReference || !slots.length) {
      console.log('attractions availability attempt', attempt, 'missing bookingReference/slots');
      continue;
    }

    // Try first slot for now
    const slot = slots[0];

    // 5) Finalize booking
    const finalizeBody = {
      productId: chosen.productId,
      optionId,
      bookingReference,
      variants: [
        {
          variantId,
          quantity: 1,
          visitDate: dateFrom,
          questionList: [],
          slot: [slot],
        },
      ],
      contact,
    };

    const fin = await client.request({
      method: 'POST',
      path: '/v1/airportServices/attractions/finalize-booking',
      query: { ...Q_INR, optionId },
      body: finalizeBody,
      correlation: true,
    });
    const br = brOf(fin.data);
    console.log('attractions finalize attempt', attempt, ':', 'HTTP', fin.status, 'BR', br, 'status', fin.data?.status);
    if (!ok(fin) || !br) continue;

    // 6) Poll status
    let status = fin.data?.status || null;
    for (let i = 0; i < 10; i++) {
      const st = await client.request({
        method: 'GET',
        path: `/v1/airportServices/attractions/${br}/status`,
        query: Q_INR,
        correlation: true,
      });
      status = st.data?.status || st.data?.bookingStatus || status;
      console.log('attractions poll', attempt + '.' + (i + 1), 'status=', status);
      if (['Confirmed', 'Failed', 'Cancelled'].includes(String(status))) break;
      await sleep(2500);
    }

    if (status !== 'Confirmed') {
      // If failed, still fetch booking details to capture quoted price.
      try {
        const booking = await client.request({
          method: 'GET',
          path: `/v1/airportServices/attractions/booking/${br}`,
          query: Q_INR,
          correlation: true,
        });
        const totalAmount = booking.data?.salesSummary?.totalAmount;
        const detailsPrice = booking.data?.details?.price;
        attemptResults.push({
          attempt,
          br,
          status,
          totalAmount,
          detailsPrice,
          currency: booking.data?.details?.currency || booking.data?.salesSummary?.currency,
          providerBookingId: booking.data?.details?.providerBookingId || null,
        });
      } catch {
        attemptResults.push({ attempt, br, status, totalAmount: null, detailsPrice: null, currency: null, providerBookingId: null });
      }

      // Try another attempt with fresh availability.
      continue;
    }

    // 7) Booking details -> exact price
    const booking = await client.request({
      method: 'GET',
      path: `/v1/airportServices/attractions/booking/${br}`,
      query: Q_INR,
      correlation: true,
    });
    if (!ok(booking)) throw new Error(`attractions booking details failed: ${booking.status}`);
    const totalAmount = booking.data?.salesSummary?.totalAmount;
    const detailsPrice = booking.data?.details?.price;
    console.log(
      'attractions CONFIRMED exact totalAmount:',
      totalAmount,
      'details.price:',
      detailsPrice,
      'currency:',
      booking.data?.details?.currency || booking.data?.salesSummary?.currency,
    );

    return { br, status, totalAmount, detailsPrice, bookingDetails: booking.data, attemptResults: attemptResults.length ? attemptResults : undefined };
  }

  return {
    br: null,
    status: 'Failed',
    totalAmount: null,
    detailsPrice: null,
    attemptResults,
  };
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;

  const fasttrack = await fasttrackFlow(client).catch((e) => ({ error: e.message }));
  console.log('\n[Fast Track result]', fasttrack?.error ? fasttrack : { br: fasttrack.br, status: fasttrack.status, totalAmount: fasttrack.totalAmount });

  const attractions = await attractionsFlow(client).catch((e) => ({ error: e.message }));
  console.log(
    '\n[Attractions result]',
    attractions?.error
      ? attractions
      : {
          br: attractions.br,
          status: attractions.status,
          totalAmount: attractions.totalAmount,
          detailsPrice: attractions.detailsPrice,
          attemptResults: attractions.attemptResults,
        },
  );

  if (fasttrack?.error || attractions?.error) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

