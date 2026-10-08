/**
 * eSIM API smoke + book flow on staging/canary.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-esim-e2e.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const Q = { lang: 'en', currency: 'INR' };

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const results = [];

  function record(name, res, extra = {}) {
    const row = {
      api: name,
      http: res.status,
      ok: ok(res),
      ...extra,
    };
    results.push(row);
    console.log(`\n[${row.ok ? 'PASS' : 'FAIL'}] ${name} HTTP ${res.status}`);
    if (extra.summary) console.log(' ', extra.summary);
  }

  // 1) Search
  const search = await client.request({
    method: 'GET',
    path: '/v1/esim/search',
    query: { ...Q, page: 1, perpage: 20, q: 'united states' },
    correlation: true,
  });
  const searchResults = search.data?.results || [];
  const country = searchResults[0];
  record('eSIM Search', search, {
    summary: `results=${searchResults.length} first=${country?.title || country?.country || country?.entityId}`,
  });
  if (!ok(search) || !country) {
    console.log(JSON.stringify(search.data, null, 2).slice(0, 800));
    throw new Error('eSIM search failed / empty');
  }

  const entityId = country.entityId || country.id || country.productId;
  console.log('Selected country entityId:', entityId, country.title || country.country);

  // 2) Listing (plans)
  const listing = await client.request({
    method: 'GET',
    path: `/v1/esims/${entityId}`,
    query: Q,
    correlation: true,
  });
  const plans = listing.data?.results || [];
  record('eSIM Listing', listing, {
    summary: `plans=${plans.length}`,
  });
  if (!ok(listing) || !plans.length) {
    console.log(JSON.stringify(listing.data, null, 2).slice(0, 1000));
    throw new Error('eSIM listing failed / empty');
  }

  // Pick cheapest variant with bookingContext
  let pick = null;
  for (const plan of plans) {
    for (const opt of plan.options || plan.availableOptions || []) {
      for (const variant of opt.variants || []) {
        const bookingContext = variant.bookingContext || variant.bookingReference;
        if (!bookingContext) continue;
        const amount = variant.pricing?.totalAmount
          ?? variant.price?.totalAmount
          ?? variant.totalAmount
          ?? opt.startingPrice
          ?? plan.startingPrice
          ?? Number.MAX_SAFE_INTEGER;
        const candidate = {
          productId: plan.productId,
          title: plan.title,
          optionId: opt.optionId,
          optionTitle: opt.title,
          variantId: variant.variantId,
          variantTitle: variant.title,
          tag: variant.tag,
          bookingContext,
          amount: Number(amount),
          currency: variant.pricing?.currency || variant.price?.currency || 'INR',
          sku: opt.sku || variant.sku,
        };
        if (!pick || candidate.amount < pick.amount) pick = candidate;
      }
    }
  }

  if (!pick) {
    console.log('Sample plan structure:', JSON.stringify(plans[0], null, 2).slice(0, 2000));
    throw new Error('No eSIM variant with bookingContext found');
  }

  console.log('\nSelected plan:', JSON.stringify({
    title: pick.title,
    optionTitle: pick.optionTitle,
    optionId: pick.optionId,
    variantId: pick.variantId,
    amount: pick.amount,
    currency: pick.currency,
    bookingContextLen: pick.bookingContext?.length,
  }, null, 2));

  // 3) Finalize booking
  const bookBody = {
    bookingContext: pick.bookingContext,
    passengers: [
      {
        paxType: 'ADT',
        profile: {
          title: 'Mr',
          firstName: 'Rohan',
          lastName: 'Bhagat',
          gender: 'MALE',
          dob: '2001-05-29',
          nationality: 'IN',
        },
      },
    ],
    contact: {
      email: config.flight?.contactEmail || 'rohan@travelvip.ai',
      countryCode: '+91',
      mobile: config.flight?.contactMobile || '9876543210',
    },
  };

  const book = await client.request({
    method: 'POST',
    path: '/v1/esims/finalize-booking',
    query: Q,
    body: bookBody,
    correlation: true,
  });
  const br = book.data?.bookingRefId || book.data?.bookingReferenceId || book.data?.bookingReference;
  record('eSIM Finalize Booking', book, {
    summary: `br=${br} status=${book.data?.status} code=${book.data?.code || book.data?.error?.code}`,
  });
  if (!ok(book) || !br) {
    console.log(JSON.stringify(book.data, null, 2));
    throw new Error('eSIM booking failed');
  }

  // Poll status briefly
  let finalStatus = book.data?.status;
  for (let i = 0; i < 12; i += 1) {
    const st = await client.request({
      method: 'GET',
      path: `/v1/esim/${br}/status`,
      query: Q,
      correlation: true,
    });
    finalStatus = st.data?.status || st.data?.bookingStatus || finalStatus;
    if (i === 0) {
      record('eSIM Booking Status', st, {
        summary: `status=${finalStatus}`,
      });
    }
    if (['Confirmed', 'Failed', 'Cancelled'].includes(String(finalStatus))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('Final booking status:', finalStatus);

  // 4) Booking details
  const detail = await client.request({
    method: 'GET',
    path: `/v1/esim/booking/${br}`,
    query: Q,
    correlation: true,
  });
  record('eSIM Booking Details', detail, {
    summary: `status=${detail.data?.status} sales=${JSON.stringify(detail.data?.salesSummary || detail.data?.details?.price || null)}`,
  });
  console.log('\n=== BOOKING DETAIL (trimmed) ===');
  console.log(JSON.stringify({
    bookingReferenceId: detail.data?.bookingReferenceId || br,
    status: detail.data?.status,
    contact: detail.data?.contact,
    details: detail.data?.details,
    salesSummary: detail.data?.salesSummary,
    passengers: detail.data?.passengers,
  }, null, 2));

  // 5) History
  const history = await client.request({
    method: 'GET',
    path: '/v1/esim/booking/history',
    query: { ...Q, page: 0, perpage: 10 },
  });
  const bookings = history.data?.bookings || history.data?.results || [];
  const found = bookings.some((b) => (b.bookingReferenceId || b.bookingRefId || b.id) === br);
  record('eSIM Booking History', history, {
    summary: `count=${history.data?.totalCount ?? bookings.length} containsBR=${found}`,
  });

  console.log('\n========== eSIM SUMMARY ==========');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.api} | HTTP ${r.http} | ${r.summary || ''}`);
  }
  console.log('\nBooked BR:', br, 'status:', finalStatus);
  console.log('Plan:', pick.title, '/', pick.optionTitle, 'amount~', pick.amount, pick.currency);

  if (results.some((r) => !r.ok)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
