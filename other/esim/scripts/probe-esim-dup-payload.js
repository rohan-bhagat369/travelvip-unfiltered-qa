/**
 * eSIM finalize idempotency test:
 * - Book one eSIM (Search -> Listing -> Finalize)
 * - Re-send the exact same finalize payload immediately
 * - Check whether the API returns the same booking (duplicate payload protection)
 *
 * Run:
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-esim-dup-payload.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const Q = { lang: 'en', currency: 'INR' };

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}

function pickCheapestVariant(plans) {
  // Mirrors the logic in probe-esim-e2e.js: choose variant that contains bookingContext.
  let pick = null;
  for (const plan of plans) {
    for (const opt of plan.options || plan.availableOptions || []) {
      for (const variant of opt.variants || []) {
        const bookingContext = variant.bookingContext || variant.bookingReference;
        if (!bookingContext) continue;

        const amount =
          variant.pricing?.totalAmount
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
  return pick;
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
    console.log(`\n[${row.ok ? 'PASS' : 'FAIL'}] ${name} HTTP ${row.http}`);
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
  const entityId = country?.entityId || country?.id || country?.productId;
  record('eSIM Search', search, {
    summary: `results=${searchResults.length} selectedEntityId=${entityId || 'none'}`,
  });
  if (!ok(search) || !country || !entityId) throw new Error('eSIM search failed / empty');

  // 2) Listing
  const listing = await client.request({
    method: 'GET',
    path: `/v1/esims/${entityId}`,
    query: Q,
    correlation: true,
  });
  const plans = listing.data?.results || [];
  record('eSIM Listing', listing, { summary: `plans=${plans.length}` });
  if (!ok(listing) || !plans.length) throw new Error('eSIM listing failed / empty');

  const pick = pickCheapestVariant(plans);
  if (!pick) throw new Error('No eSIM variant with bookingContext found');
  console.log('\nSelected plan:', {
    title: pick.title,
    optionTitle: pick.optionTitle,
    variantTitle: pick.variantTitle,
    amount: pick.amount,
    bookingContextLen: pick.bookingContext?.length,
  });

  // 3) Finalize payload
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

  // 4) Finalize booking (first time)
  const finalize1 = await client.request({
    method: 'POST',
    path: '/v1/esims/finalize-booking',
    query: Q,
    body: bookBody,
    correlation: true,
  });
  const br1 = finalize1.data?.bookingRefId || finalize1.data?.bookingReferenceId || finalize1.data?.bookingReference;
  record('eSIM Finalize #1', finalize1, {
    summary: `br=${br1 || 'n/a'} status=${finalize1.data?.status} code=${finalize1.data?.code || finalize1.data?.error?.code || ''}`,
  });
  if (!ok(finalize1) || !br1) throw new Error('eSIM booking failed (first finalize)');

  // 5) Finalize booking (send exact same payload again)
  const finalize2 = await client.request({
    method: 'POST',
    path: '/v1/esims/finalize-booking',
    query: Q,
    body: bookBody,
    correlation: true,
  });
  const br2 = finalize2.data?.bookingRefId || finalize2.data?.bookingReferenceId || finalize2.data?.bookingReference;

  record('eSIM Finalize #2 (same payload)', finalize2, {
    summary: `br=${br2 || 'n/a'} status=${finalize2.data?.status} code=${finalize2.data?.code || finalize2.data?.error?.code || ''}`,
    duplicateFlag: finalize2.data?.duplicate,
    walletError: finalize2.data?.code === 'WALLET_INSUFFICIENT_BALANCE' ? 'YES' : 'NO',
  });

  // 6) Compare behavior
  const comparison = {
    bookingRefId_first: br1,
    bookingRefId_second: br2,
    sameBooking: br2 && br2 === br1,
    firstHttp: finalize1.status,
    secondHttp: finalize2.status,
    secondDuplicateFlag: finalize2.data?.duplicate,
    secondCode: finalize2.data?.code || finalize2.data?.error?.code || null,
    secondMessage: finalize2.data?.message || finalize2.data?.error?.message || null,
  };
  console.log('\n=== Duplicate payload comparison ===');
  console.log(JSON.stringify(comparison, null, 2));

  // 7) Check status for the booking we got back first
  const st1 = await client.request({
    method: 'GET',
    path: `/v1/esim/${br1}/status`,
    query: Q,
    correlation: true,
  });
  record('eSIM Status (BR #1)', st1, { summary: `status=${st1.data?.status || st1.data?.bookingStatus}` });

  if (br2 && br2 !== br1) {
    const st2 = await client.request({
      method: 'GET',
      path: `/v1/esim/${br2}/status`,
      query: Q,
      correlation: true,
    });
    record('eSIM Status (BR #2)', st2, { summary: `status=${st2.data?.status || st2.data?.bookingStatus}` });
  }

  console.log('\n========== eSIM DUPLICATE PAYLOAD SUMMARY ==========');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.api} | HTTP ${r.http}${r.summary ? ` | ${r.summary}` : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

