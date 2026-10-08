/**
 * One-shot OW flight booking — print price + BR.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody } from '../src/helpers.js';

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  console.log('Searching OW DEL→BOM...');
  const search = await flight.searchUntilComplete(
    buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' }),
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
  console.log('Pricing:', JSON.stringify({
    priceId: pricing.data.priceId,
    ...price,
    fullPricingKeys: Object.keys(pricing.data || {}),
  }, null, 2));

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
  const detailPrice =
    detail.data?.pricing ||
    detail.data?.fare ||
    detail.data?.amount ||
    detail.data?.totalAmount;

  console.log('\n=== BOOKING RESULT ===');
  console.log(JSON.stringify({
    bookingReference: br,
    bookingStatus: status,
    route: 'DEL → BOM',
    journeyType: 'ONE_WAY',
    priceId: pricing.data.priceId,
    currency: price.currency,
    baseFare: price.baseFare,
    taxes: price.taxes,
    convenienceFee: price.convenienceFee,
    totalAmount: price.totalAmount,
    detailPrice,
    issueHttp: issue.status,
    statusHttp: statusRes.status,
  }, null, 2));

  // Cleanup on staging
  if (String(status).toLowerCase() === 'confirmed') {
    try {
      await flight.cancelBooking(br);
      console.log('Cancelled booking after capture.');
    } catch (e) {
      console.warn('Cancel skipped:', e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
