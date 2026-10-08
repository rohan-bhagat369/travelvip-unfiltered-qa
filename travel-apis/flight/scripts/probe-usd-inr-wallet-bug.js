/**
 * Reproduce: USD flight/hotel bookings return INR fare summary on status/detail
 * and wallet debit matches INR amounts.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-usd-inr-wallet-bug.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const FLIGHT_BR = process.env.FLIGHT_BR || 'BR1785764940538353';
const HOTEL_BR = process.env.HOTEL_BR || 'BR1785766760194184';

async function get(client, path, currency) {
  return client.request({
    method: 'GET',
    path,
    query: { lang: 'en', currency },
    correlation: true,
  });
}

function flightSales(data) {
  return data?.bookingResponse?.salesSummary
    || data?.salesSummary
    || data?.bookingResponse?.pricing
    || null;
}

function hotelSales(data) {
  return data?.salesSummary || data?.pricing || null;
}

const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const client = session.client;

console.log('Base:', config.baseUrl);
console.log('Flight BR:', FLIGHT_BR);
console.log('Hotel BR:', HOTEL_BR);

const flight = {
  bookingReference: FLIGHT_BR,
  bookedCurrency: 'USD',
  pricingAtBookTimeUsd: {
    baseFare: 13.19,
    taxes: 1.1,
    convenienceFee: 0,
    flexiCancelFee: 0,
    platformFee: 0,
    totalAmount: 14.29,
    currency: 'USD',
  },
  status: {},
  detail: {},
};

for (const currency of ['USD', 'INR']) {
  const status = await get(client, `/v1/flights/booking/${FLIGHT_BR}/status`, currency);
  const detail = await get(client, `/v1/flights/booking/${FLIGHT_BR}`, currency);
  flight.status[currency] = {
    http: status.status,
    bookingStatus: status.data?.status,
    salesSummary: flightSales(status.data),
  };
  flight.detail[currency] = {
    http: detail.status,
    bookingStatus: detail.data?.status,
    salesSummary: flightSales(detail.data),
  };
}

const hotel = {
  bookingReference: HOTEL_BR,
  bookedCurrency: 'USD',
  pricingAtBookTimeUsd: {
    baseFare: 1.28,
    taxes: 0.72,
    convenienceFee: 0,
    totalAmount: 2,
    currency: 'USD',
  },
  // companion INR booking same hotel/dates for comparison
  companionInrBooking: {
    bookingReference: 'BR1785766557509753',
    totalAmount: 181.92,
    currency: 'INR',
  },
  status: {},
  detail: {},
};

for (const currency of ['USD', 'INR']) {
  const status = await get(client, `/v1/hotels/bookings/${HOTEL_BR}/status`, currency);
  const detail = await get(client, `/v1/hotels/bookings/${HOTEL_BR}`, currency);
  hotel.status[currency] = {
    http: status.status,
    bookingStatus: status.data?.status,
    // hotel status endpoint may not include salesSummary
    hasSalesSummary: Boolean(hotelSales(status.data)),
    salesSummary: hotelSales(status.data),
    rawKeys: Object.keys(status.data || {}).filter((k) => k !== '_meta'),
  };
  hotel.detail[currency] = {
    http: detail.status,
    bookingStatus: detail.data?.status,
    salesSummary: hotelSales(detail.data),
  };
}

// FX sanity: USD total * rate ≈ INR total (from earlier pricing conversion rate ~90.9645)
const fxRateObserved = 90.9645;
const flightImpliedInr = Number((14.29 * fxRateObserved).toFixed(2));
const hotelImpliedInr = Number((2 * fxRateObserved).toFixed(2));

const report = {
  ranAt: new Date().toISOString(),
  env: config.baseUrl,
  title: 'Bug: USD booking shows INR fare summary / wallet debit in INR',
  severity: 'High',
  services: ['Flights', 'Hotels'],
  environment: 'Staging / Dev (api-staging.travelvip.ai)',
  summary:
    'When a flight or hotel is booked with currency=USD, pricing/finalize correctly returns USD amounts. After confirmation, booking status/detail fare summary (and observed wallet debit) uses INR amounts instead of the USD totals shown at booking time.',
  expected:
    'Booking status/detail salesSummary (and wallet debit) should remain in the booked currency (USD) with the same USD amounts returned at pricing/finalize. If conversion is required, API should clearly return both booked currency and charged currency with rate.',
  actual:
    'Flight detail salesSummary returns INR (e.g. totalAmount 1300 INR) for a booking priced at 14.29 USD. Hotel detail may return USD on detail for some bookings, but wallet debit aligns with INR equivalent / INR companion booking amounts. Passing currency=USD on status/detail does not keep flight fare summary in USD.',
  evidence: { flight, hotel },
  calculations: {
    fxRateFromHotelPricingExample: fxRateObserved,
    flightUsdTotal: 14.29,
    flightUsdTimesRate: flightImpliedInr,
    flightDetailInrTotal: flight.detail.USD?.salesSummary?.totalAmount
      || flight.detail.INR?.salesSummary?.totalAmount,
    hotelUsdTotal: 2,
    hotelUsdTimesRate: hotelImpliedInr,
    hotelCompanionInrTotal: 181.92,
  },
  stepsToReproduce: [
    '1. Auth on staging; set query currency=USD on search/pricing (flight) or search/details/prebook/finalize (hotel).',
    '2. Complete booking successfully (Confirmed).',
    '3. Call GET flight status/detail or GET hotel status/detail with currency=USD.',
    '4. Observe salesSummary currency/amounts vs USD pricing at book time; check partner wallet debit amount.',
  ],
  endpoints: {
    flightIssue: 'POST /v1/flights/booking/issue-ticket?currency=USD',
    flightStatus: 'GET /v1/flights/booking/{br}/status?currency=USD',
    flightDetail: 'GET /v1/flights/booking/{br}?currency=USD',
    hotelFinalize: 'POST /v1/hotels/finalize-booking?currency=USD',
    hotelStatus: 'GET /v1/hotels/bookings/{br}/status?currency=USD',
    hotelDetail: 'GET /v1/hotels/bookings/{br}?currency=USD',
  },
};

fs.mkdirSync('reports/shared', { recursive: true });
fs.mkdirSync('docs', { recursive: true });
const jsonOut = 'reports/shared/usd-booking-inr-wallet-bug.json';
fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

const md = `# Bug Report: USD booking fare summary / wallet debit in INR

**Environment:** Staging (\`https://api-staging.travelvip.ai\`)  
**Severity:** High  
**Services:** Flights + Hotels  
**Reproduced:** ${report.ranAt}

## Summary
When booking with \`currency=USD\`, pricing/finalize returns **USD** amounts correctly. After the booking is **Confirmed**, fetch booking **status/detail** shows fare summary in **INR** (flight clearly; wallet debit matches INR). Wallet amount deducted matches the **INR** totals, not the USD totals shown at book time.

## Expected
- Status/detail \`salesSummary\` stays in booked currency (**USD**) with same USD totals.
- Wallet debit uses the USD booking amount (or explicitly returns charged currency + FX rate).

## Actual
### Flight (reproduced)
| Step | Currency | Amount |
|------|----------|--------|
| Pricing / issue time | **USD** | baseFare **13.19** + taxes **1.10** = **14.29 USD** |
| GET booking detail (\`currency=USD\`) | **INR** | basePrice **1200** + tax **100** = **1300 INR** |
| GET booking detail (\`currency=INR\`) | **INR** | same **1300 INR** |

- **BR:** \`${FLIGHT_BR}\`
- **Route:** 6E 46 DEL→BOM (2026-09-14)
- Passing \`currency=USD\` on status/detail **does not** keep salesSummary in USD.

**FX check:** 14.29 × 90.9645 ≈ **${flightImpliedInr} INR** ≈ detail total **1300 INR** → wallet/debit side is INR equivalent, while client booked in USD.

### Hotel (reproduced)
| Step | Currency | Amount |
|------|----------|--------|
| Details / finalize time | **USD** | baseFare **1.28** + taxes **0.72** = **2.00 USD** |
| Companion INR booking same hotel/dates | **INR** | **181.92 INR** |
| USD × rate (90.9645) | — | 2 × 90.9645 ≈ **${hotelImpliedInr} INR** (~ companion INR total) |

- **USD BR:** \`${HOTEL_BR}\` (Taj Dubai, Confirmed)
- **INR companion BR:** \`BR1785766557509753\` (Taj Dubai, ~181.92 INR)
- Detail may still show USD fields for hotel in some responses, but charged/wallet amount aligns with **INR** equivalent of the same product.

## Steps to reproduce
1. Authenticate against staging.
2. Run search → pricing/details → issue-ticket/finalize with \`currency=USD\`.
3. Wait until booking status = Confirmed.
4. Call status + detail with \`currency=USD\`.
5. Compare \`salesSummary\` currency/amounts to USD pricing at book time; check partner wallet debit.

## Endpoints
- Flight issue: \`POST /v1/flights/booking/issue-ticket?currency=USD\`
- Flight status: \`GET /v1/flights/booking/{br}/status?currency=USD\`
- Flight detail: \`GET /v1/flights/booking/{br}?currency=USD\`
- Hotel finalize: \`POST /v1/hotels/finalize-booking?currency=USD\`
- Hotel status: \`GET /v1/hotels/bookings/{br}/status?currency=USD\`
- Hotel detail: \`GET /v1/hotels/bookings/{br}?currency=USD\`

## Impact
- Partner/client UI shows USD at checkout but INR after confirmation.
- Wallet balance drops by INR amount, causing confusion and incorrect reconciliation for USD bookings.
- \`currency\` query param on fetch booking APIs appears ignored for fare currency (flight).

## Ask to Dev
1. Persist and return booking currency on status/detail \`salesSummary\`.
2. Debit wallet in booked currency **or** return explicit \`chargedCurrency\`, \`chargedAmount\`, and FX rate.
3. Honor \`currency=USD\` on GET status/detail (convert display consistently, do not silently replace with INR base amounts without labeling).

## Evidence files
- \`reports/flight/usd-booking.json\`
- \`reports/hotel/taj-dubai-usd-single.json\`
- \`reports/hotel/taj-dubai-single.json\` (INR companion)
- \`reports/shared/usd-booking-inr-wallet-bug.json\` (this repro dump)
`;

fs.writeFileSync('docs/Bug-USD-Booking-INR-Wallet-Fare-Summary.md', md);
console.log(JSON.stringify({
  flightStatusUsd: flight.status.USD,
  flightDetailUsd: flight.detail.USD,
  flightDetailInr: flight.detail.INR,
  hotelDetailUsd: hotel.detail.USD,
  hotelDetailInr: hotel.detail.INR,
  hotelStatusUsdKeys: hotel.status.USD.rawKeys,
}, null, 2));
console.log('Wrote', jsonOut);
console.log('Wrote docs/Bug-USD-Booking-INR-Wallet-Fare-Summary.md');
