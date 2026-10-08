/**
 * Book & confirm one ROUND_TRIP (1 adult) on a cancellable/refundable fare.
 * Does not cancel — leaves booking Confirmed for manual cancel/refund checks.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildRoundTripSearchBody,
  extractOnwardSearchIds,
  extractReturnSearchId,
  extractSearchIds,
  hasRoundTripSearchPair,
  buildRoundTripSearchIds,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

function optionMeta(opt, direction) {
  const codes = (opt.segments || [])
    .map((s) => s.airline?.code || s.airlineCode)
    .filter(Boolean);
  const refundable =
    opt.refundable === true
    || /refundable/i.test(String(opt.refundText || ''))
    || /cancellable|cancel/i.test(String(opt.refundText || ''));
  return {
    searchId: opt.searchId,
    direction,
    airlineCodes: codes,
    flights: (opt.segments || []).map((s) => ({
      code: s.airline?.code,
      flightNumber: s.flightNumber,
      route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
    })),
    totalStops: opt.totalStops,
    refundable,
    refundText: opt.refundText,
    fare: opt.fare?.totalAmount ?? opt.totalAmount ?? opt.price,
  };
}

function optionsByDirection(searchData, direction) {
  const block = (searchData?.results || []).find(
    (r) => String(r.direction).toUpperCase() === direction,
  );
  return (block?.options || []).map((opt) => optionMeta(opt, direction));
}

function pickRefundable(options) {
  return options.find((o) => o.refundable && o.searchId) || null;
}

async function resolveRefundableRoundTrip(flight, body) {
  console.log('Searching RT (refundableOnly)...');
  const initial = await flight.search(body);
  // Warm up / complete search via existing helper, then refine for refundable
  const search = await flight.searchRoundTripUntilComplete(body);
  let data = search.response.data;

  let onwardOpts = optionsByDirection(data, 'ONWARD');
  let refundableOnward = pickRefundable(onwardOpts);

  // If current pair isn't refundable, try refundable onward candidates + return search
  if (!refundableOnward) {
    console.log('No refundable onward in current results — scanning onward candidates...');
    // Re-search without relying only on first pick
    const openBody = { ...body, preferences: { ...body.preferences, refundableOnly: false } };
    const openSearch = await flight.searchRoundTripUntilComplete(openBody);
    data = openSearch.response.data;
    onwardOpts = optionsByDirection(data, 'ONWARD');
    refundableOnward = pickRefundable(onwardOpts);
  }

  if (!refundableOnward) {
    // Try any onward and hope return is refundable after selection; still prefer refundable onward from raw search
    const allOnward = extractOnwardSearchIds(data, 15);
    for (const onwardId of allOnward) {
      const meta = onwardOpts.find((o) => o.searchId === onwardId);
      if (meta && !meta.refundable) continue;
      const refinedBody = { ...body, selection: { selectedSearchIds: [onwardId] } };
      const returnRes = await flight.pollReturnSearch(body, refinedBody);
      const returnOpts = optionsByDirection(returnRes.data, 'RETURN');
      const refundableReturn = pickRefundable(returnOpts);
      const onwardMeta = meta || optionMeta(
        (data.results || []).flatMap((r) => r.options || []).find((o) => o.searchId === onwardId) || { searchId: onwardId, segments: [] },
        'ONWARD',
      );
      if (refundableReturn && (onwardMeta.refundable || refundableOnward)) {
        return {
          searchIds: [onwardId, refundableReturn.searchId],
          onward: onwardMeta.refundable ? onwardMeta : refundableOnward || onwardMeta,
          returnOpt: refundableReturn,
          response: returnRes,
        };
      }
    }
  }

  // Prefer: refundable onward + refundable return
  const onwardId = refundableOnward?.searchId || extractOnwardSearchIds(data, 1)[0];
  if (!onwardId) throw new Error('No onward flight found');

  let returnData = data;
  let returnOpts = optionsByDirection(data, 'RETURN');
  if (!hasRoundTripSearchPair(data) || !pickRefundable(returnOpts)) {
    console.log('Refining return search for refundable fare...');
    const refinedBody = { ...body, selection: { selectedSearchIds: [onwardId] } };
    returnData = await flight.pollReturnSearch(body, refinedBody);
    returnOpts = optionsByDirection(returnData.data, 'RETURN');
  }

  const refundableReturn = pickRefundable(returnOpts);
  const returnId =
    refundableReturn?.searchId
    || extractReturnSearchId(returnData.data)
    || extractSearchIds(returnData.data, 10).find((id) => id !== onwardId);

  if (!returnId) throw new Error('No return flight found');

  const onwardMeta =
    refundableOnward
    || pickRefundable(optionsByDirection(returnData.data, 'ONWARD'))
    || optionsByDirection(returnData.data, 'ONWARD')[0]
    || optionsByDirection(data, 'ONWARD').find((o) => o.searchId === onwardId);

  const returnMeta = refundableReturn || returnOpts.find((o) => o.searchId === returnId) || { searchId: returnId };

  if (!onwardMeta?.refundable && !returnMeta?.refundable) {
    console.warn('WARNING: Could not find clearly refundable RT pair — booking best available and checking fare rules.');
  }

  return {
    searchIds: [onwardId, returnId],
    onward: onwardMeta,
    returnOpt: returnMeta,
    response: returnData,
  };
}

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  console.log('Base URL:', config.baseUrl);

  const body = buildRoundTripSearchBody(30, 37, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'NORMAL',
    maxStops: null,
  });
  body.preferences.refundableOnly = true;
  body.travellers = { adults: 1, children: 0, infants: 0 };

  let pair;
  try {
    pair = await resolveRefundableRoundTrip(flight, body);
  } catch (e) {
    console.warn('Primary RT search failed:', e.message);
    console.log('Retrying without refundableOnly filter...');
    body.preferences.refundableOnly = false;
    pair = await resolveRefundableRoundTrip(flight, body);
  }

  console.log('Selected RT pair:');
  console.log(JSON.stringify({
    searchIds: pair.searchIds,
    onward: pair.onward,
    return: pair.returnOpt,
  }, null, 2));

  if (!pair.onward?.refundable && !pair.returnOpt?.refundable) {
    // Last attempt: try IX which worked as refundable before, on RT
    console.log('Trying IX preference for refundable RT...');
    const ixBody = buildRoundTripSearchBody(45, 52, {
      origin: 'DEL',
      destination: 'BOM',
      fareType: 'NORMAL',
      maxStops: null,
    });
    ixBody.preferences.airlines = ['IX'];
    ixBody.preferences.refundableOnly = true;
    ixBody.travellers = { adults: 1, children: 0, infants: 0 };
    pair = await resolveRefundableRoundTrip(flight, ixBody);
    console.log('IX RT pair:', JSON.stringify({
      searchIds: pair.searchIds,
      onward: pair.onward,
      return: pair.returnOpt,
    }, null, 2));
  }

  const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
  if (!pricing.ok) throw new Error(`Pricing failed: ${JSON.stringify(pricing.data)}`);

  const p = pricing.data.pricing || pricing.data;
  const price = {
    priceId: pricing.data.priceId,
    baseFare: p.baseFare ?? pricing.data.baseFare,
    taxes: p.taxes ?? pricing.data.taxes,
    convenienceFee: p.convenienceFee ?? pricing.data.convenienceFee,
    totalAmount: p.totalAmount ?? pricing.data.totalAmount,
    currency: p.currency || pricing.data.currency || 'INR',
  };
  console.log('Pricing:', JSON.stringify(price, null, 2));

  // Fare rules hint for cancellability
  try {
    const rules = await flight.getFareRules(pair.searchIds, 'ROUND_TRIP');
    const snippet = JSON.stringify(rules.data).slice(0, 500);
    console.log('Fare rules snippet:', snippet);
  } catch {
    /* ignore */
  }

  console.log('Issuing RT ticket (1 adult)...');
  const issue = await flight.issueTicket({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: pair.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  if (!issue.ok) throw new Error(`Issue ticket failed: ${JSON.stringify(issue.data)}`);

  const br = issue.data.bookingReference || issue.data.bookingReferenceId || issue.data.bookingRefId;
  console.log('bookingReference:', br, 'issueStatus:', issue.data.status);

  const { response: statusRes, status, timedOut } = await flight.waitForBookingStatus(br);
  console.log('Final status:', status, timedOut ? '(timed out polling)' : '');

  const detail = await flight.getBookingDetail(br);
  const itinerary = detail.data?.bookingResponse?.itinerary || [];
  const flights = itinerary.map((j) => ({
    direction: j.direction,
    refundable: j.refundable,
    refundText: j.refundText,
    pnr: j.pnr,
    segments: (j.segments || []).map((s) => ({
      airline: s.airline?.code,
      flight: s.flightNumber,
      route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
    })),
  }));

  console.log('\n=== BOOKING RESULT ===');
  console.log(JSON.stringify({
    bookingReference: br,
    bookingStatus: status,
    journeyType: 'ROUND_TRIP',
    travellers: { adults: 1 },
    route: 'DEL ⇄ BOM',
    flights,
    salesSummary: detail.data?.bookingResponse?.salesSummary,
    onlineCancellation: detail.data?.bookingResponse?.onlineCancellation,
    priceId: price.priceId,
    totalAmount: price.totalAmount,
    currency: price.currency,
    searchIds: pair.searchIds,
    issueHttp: issue.status,
    statusHttp: statusRes.status,
  }, null, 2));

  if (String(status).toLowerCase() !== 'confirmed') {
    process.exit(2);
  }

  console.log('\nLeft CONFIRMED (not cancelled) for your refund check.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
