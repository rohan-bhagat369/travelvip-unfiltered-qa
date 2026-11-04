/**
 * Lounge E2E probe + basic validations.
 *
 * Flow:
 * 1) GET /v1/airports/search
 * 2) GET /v1/lounges?airportId=...&terminal=Terminal 1
 * 3) GET /v1/lounges/{productId}?optionId=...
 * 4) POST /v1/airportServices/lounges/finalize-booking  (uses bookingContext from step 3)
 * 5) GET /v1/airportServices/lounge/{BR}/status
 * 6) GET /v1/airportServices/lounge/booking/{BR}
 * 7) GET /v1/airportServices/lounge/booking/history
 *
 * Also:
 * - Replay same finalize payload once to check duplicate-payload protection.
 * - Try 2 validation failures on finalize booking (missing bookingContext, invalid mobile).
 *
 * Run:
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-lounge-e2e.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const Q = { lang: 'en', currency: 'INR' };
const TERMINAL = 'Terminal 1';

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}

function pickFirst(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function addDaysISODate(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;

  const results = [];
  function record(name, res, extra = {}) {
    const row = { api: name, http: res.status, ok: ok(res), ...extra };
    results.push(row);
    console.log(`\n[${row.ok ? 'PASS' : 'FAIL'}] ${name} HTTP ${row.http}`);
    if (extra.summary) console.log(' ', extra.summary);
  }

  // 1) Search airports
  const airportSearch = await client.request({
    method: 'GET',
    path: '/v1/airports/search',
    query: { ...Q, page: 0, perpage: 20, q: 'bom' },
    correlation: true,
  });
  const airports = airportSearch.data?.results || [];
  record('Lounge airport search', airportSearch, {
    summary: `airports=${airports.length}`,
  });
  if (!ok(airportSearch) || !airports.length) throw new Error('Airport search failed / empty');

  const terminalsToTry = [TERMINAL, 'Terminal 2', 'Terminal 3'];

  // 2-3) Find any airport+terminal combo that returns a lounge bookingContext.
  let picked = null;
  for (const a of airports) {
    const airportId = a?.airportId || a?.id;
    if (!airportId) continue;

    for (const terminal of terminalsToTry) {
      const loungesList = await client.request({
        method: 'GET',
        path: '/v1/lounges',
        query: { ...Q, page: 0, perpage: 5, airportId, terminal },
        correlation: true,
      });

      const lounges = loungesList.data?.results || [];
      const loungeSummary = pickFirst(lounges);
      if (!ok(loungesList) || !loungeSummary) continue;

      const productId = loungeSummary.productId;
      const optionId =
        loungeSummary.availableOptions?.[0]?.optionId
        || loungeSummary.options?.[0]?.optionId;
      if (!productId || !optionId) continue;

      const loungeDetail = await client.request({
        method: 'GET',
        path: `/v1/lounges/${productId}`,
        query: { ...Q, optionId },
        correlation: true,
      });

      const results2 = loungeDetail.data?.results || [];
      let bookingContext = null;
      for (const item of results2) {
        const optionsArr = item?.options || item?.availableOptions || [];
        for (const o of optionsArr) {
          // Some deployments return `bookingContext`, others return `bookingReference`.
          // finalize-booking still expects a field named `bookingContext`, so we map the value.
          if (o?.bookingContext || o?.bookingReference) {
            bookingContext = o.bookingContext || o.bookingReference;
            break;
          }
        }
        if (bookingContext) break;
      }

      if (ok(loungeDetail) && bookingContext) {
        picked = {
          airportId,
          terminal,
          loungeSummary,
          productId,
          optionId,
          bookingContext,
          loungesList,
          loungeDetail,
          loungesReturned: lounges.length,
          detailResults: results2.length,
        };
        break;
      }
    }

    if (picked) break;
  }

  if (!picked) throw new Error('Could not find any lounge bookingContext (airportId+terminal)');

  record('Lounge list', picked.loungesList, {
    summary: `airportId=${picked.airportId} terminal=${picked.terminal} loungesReturned=${picked.loungesReturned}`,
  });
  record('Lounge detail/options (bookingContext)', picked.loungeDetail, {
    summary: `productId=${picked.productId} optionId=${picked.optionId} detailResults=${picked.detailResults} bookingContextPresent=true`,
  });

  const bookingContext = picked.bookingContext;

  // 4) Build finalize payload
  const travelDate = addDaysISODate(7);
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
          title: 'Mr',
          firstName: config.flight?.passengerFirstName || 'Rohan',
          lastName: config.flight?.passengerLastName || 'Bhagat',
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

  // 5) Finalize booking (primary)
  const finalize1 = await client.request({
    method: 'POST',
    path: '/v1/airportServices/lounges/finalize-booking',
    query: Q,
    body: finalizeBody,
    correlation: true,
  });
  const br1 =
    finalize1.data?.bookingRefId
    || finalize1.data?.bookingReferenceId
    || finalize1.data?.bookingReference
    || null;
  record('Lounge finalize #1', finalize1, {
    summary: `br=${br1 || 'n/a'} status=${finalize1.data?.status} code=${finalize1.data?.code || finalize1.data?.error?.code || ''}`,
  });
  if (!ok(finalize1) || !br1) throw new Error('Lounge booking failed (finalize #1)');

  // Duplicate replay (payload-level)
  const finalize2 = await client.request({
    method: 'POST',
    path: '/v1/airportServices/lounges/finalize-booking',
    query: Q,
    body: finalizeBody,
    correlation: true,
  });
  const br2 =
    finalize2.data?.bookingRefId
    || finalize2.data?.bookingReferenceId
    || finalize2.data?.bookingReference
    || null;
  record('Lounge finalize #2 (same payload)', finalize2, {
    summary: `br=${br2 || 'n/a'} status=${finalize2.data?.status} duplicate=${finalize2.data?.duplicate}`,
    duplicateFlag: finalize2.data?.duplicate,
    duplicateMsg: finalize2.data?.message || finalize2.data?.error?.message || null,
  });

  // 6) Poll status
  let status = finalize1.data?.status || null;
  let statusRes = null;
  for (let i = 0; i < 12; i += 1) {
    statusRes = await client.request({
      method: 'GET',
      path: `/v1/airportServices/lounge/${br1}/status`,
      query: Q,
      correlation: true,
    });
    status = statusRes.data?.status || statusRes.data?.bookingStatus || status;
    console.log('poll', i + 1, 'status=', status, 'http', statusRes.status);
    if (status && ['Confirmed', 'Failed', 'Cancelled'].includes(String(status))) break;
    await sleep(2500);
  }
  record('Lounge status', statusRes, { summary: `status=${status}` });

  // 7) Booking details
  const details = await client.request({
    method: 'GET',
    path: `/v1/airportServices/lounge/booking/${br1}`,
    query: Q,
    correlation: true,
  });
  record('Lounge booking details', details, {
    summary: `status=${details.data?.status || details.data?.bookingStatus || ''}`,
  });

  const loungeTotalAmount =
    details.data?.salesSummary?.totalAmount ||
    details.data?.totalAmount ||
    details.data?.details?.price ||
    null;
  const loungeCurrency =
    details.data?.salesSummary?.currency ||
    details.data?.currency ||
    details.data?.details?.currency ||
    null;
  console.log('LOUNGE exact totalAmount:', loungeTotalAmount, 'currency:', loungeCurrency);

  // 8) Booking history
  const history = await client.request({
    method: 'GET',
    path: '/v1/airportServices/lounge/booking/history',
    query: { ...Q, page: 0, perpage: 10 },
    correlation: true,
  });
  record('Lounge booking history', history, {
    summary: `totalCount=${history.data?.totalCount || history.data?.count || 'n/a'}`,
  });

  // 9) Validations on finalize booking
  // 9a) Missing bookingContext
  const invalidMissingCtx = await client.request({
    method: 'POST',
    path: '/v1/airportServices/lounges/finalize-booking',
    query: Q,
    body: {
      travelDate,
      travelTime,
      passengers: finalizeBody.passengers,
      contact: finalizeBody.contact,
    },
    correlation: true,
  });
  record('Finalize validation: missing bookingContext', invalidMissingCtx, {
    summary: `status=${invalidMissingCtx.data?.status || invalidMissingCtx.data?.error?.status || ''} code=${invalidMissingCtx.data?.code || invalidMissingCtx.data?.error?.code || ''}`,
  });

  // 9b) Invalid mobile
  const invalidMobile = await client.request({
    method: 'POST',
    path: '/v1/airportServices/lounges/finalize-booking',
    query: Q,
    body: {
      ...finalizeBody,
      contact: { ...finalizeBody.contact, mobile: '123' },
    },
    correlation: true,
  });
  record('Finalize validation: invalid mobile', invalidMobile, {
    summary: `status=${invalidMobile.data?.status || invalidMobile.data?.error?.status || ''} code=${invalidMobile.data?.code || invalidMobile.data?.error?.code || ''}`,
  });

  console.log('\n========== LOUNGE E2E SUMMARY ==========');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.api} | HTTP ${r.http}${r.summary ? ` | ${r.summary}` : ''}`);
  }
}

main().catch((e) => {
  console.error('Lounge probe failed:', e);
  process.exit(1);
});

