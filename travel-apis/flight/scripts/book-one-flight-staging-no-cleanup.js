/**
 * One-shot OW flight booking on api-staging.
 * READ-ONLY DB constraint does NOT apply here because this script creates a booking.
 *
 * Differences vs `book-one-flight.js`:
 * - Does NOT cancel the booking after capture.
 * - Prints bookingReference + final status + key detail pointers.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody } from '../src/helpers.js';

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const origin = process.env.FLIGHT_ORIGIN || 'DEL';
  const destination = process.env.FLIGHT_DESTINATION || 'BOM';
  const daysFromNow = Number(process.env.FLIGHT_DEPART_OFFSET_DAYS || '45');
  const fareType = process.env.FLIGHT_FARE_TYPE || 'NORMAL';
  const maxStops = process.env.FLIGHT_MAX_STOPS ? Number(process.env.FLIGHT_MAX_STOPS) : 0;

  console.log('Searching OW DEL→BOM (api-staging)...');
  console.log(`Searching OW ${origin}→${destination} (+${daysFromNow}d, maxStops=${maxStops})...`);
  const search = await flight.searchUntilComplete(
    buildOneWaySearchBody(daysFromNow, { origin, destination, fareType, maxStops }),
  );
  console.log('searchId:', search.searchId);

  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  if (!pricing.ok) throw new Error(`Pricing failed: ${JSON.stringify(pricing.data)}`);

  const p = pricing.data.pricing || pricing.data;
  const price = {
    baseFare: p.baseFare ?? pricing.data.baseFare,
    taxes: p.taxes ?? pricing.data.taxes,
    convenienceFee: p.convenienceFee ?? pricing.data.convenienceFee,
    totalAmount: p.totalAmount ?? pricing.data.totalAmount,
    currency: p.currency || pricing.data.currency || 'INR',
  };

  console.log(
    'Pricing:',
    JSON.stringify(
      {
        priceId: pricing.data.priceId,
        ...price,
        fullPricingKeys: Object.keys(pricing.data || {}),
      },
      null,
      2,
    ),
  );

  console.log('Issuing ticket...');
  const issue = await flight.issueTicket({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });

  if (!issue.ok) throw new Error(`Issue ticket failed: ${JSON.stringify(issue.data)}`);

  const br = issue.data.bookingReference || issue.data.bookingReferenceId || issue.data.bookingRefId;
  console.log('bookingReference:', br, 'issueStatus:', issue.data.status);

  const { response: statusRes, status, timedOut } = await flight.waitForBookingStatus(br);
  console.log('Final status:', status, timedOut ? '(timed out polling)' : '');

  const detail = await flight.getBookingDetail(br);
  const detailPrice = detail.data?.pricing || detail.data?.fare || detail.data?.amount || detail.data?.totalAmount;

  console.log('\n=== BOOKING RESULT ===');
  console.log(
    JSON.stringify(
      {
        bookingReference: br,
        bookingStatus: status,
        route: `${origin} → ${destination}`,
        journeyType: 'ONE_WAY',
        priceId: pricing.data.priceId,
        currency: price.currency,
        baseFare: price.baseFare,
        taxes: price.taxes,
        convenienceFee: price.convenienceFee,
        totalAmount: price.totalAmount,
        detailPrice,
        confirmationPayloadKeys: detail?.data ? Object.keys(detail.data) : [],
        issueHttp: issue.status,
        statusHttp: statusRes?.status,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});

