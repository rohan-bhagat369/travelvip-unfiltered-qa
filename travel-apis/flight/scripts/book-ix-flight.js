/**
 * Book & confirm one OW flight on IX (Air India Express). Does not cancel.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, extractSearchIds } from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

function findIxOptions(searchData) {
  const matches = [];
  for (const result of searchData?.results || []) {
    for (const opt of result?.options || []) {
      const codes = (opt.segments || [])
        .map((s) => s.airline?.code || s.airlineCode)
        .filter(Boolean)
        .map((c) => String(c).toUpperCase());
      const allIx = codes.length > 0 && codes.every((c) => c === 'IX');
      const anyIx = codes.some((c) => c === 'IX');
      if (allIx || anyIx) {
        matches.push({
          searchId: opt.searchId,
          direction: result.direction,
          airlineCodes: codes,
          allIx,
          flights: (opt.segments || []).map((s) => ({
            code: s.airline?.code,
            flightNumber: s.flightNumber,
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
          })),
          totalStops: opt.totalStops,
          refundable: opt.refundable,
          refundText: opt.refundText,
        });
      }
    }
  }
  return matches;
}

function airlinesInSearch(searchData) {
  const codes = new Set();
  for (const result of searchData?.results || []) {
    for (const opt of result?.options || []) {
      for (const s of opt.segments || []) {
        if (s.airline?.code) codes.add(s.airline.code);
      }
    }
  }
  return [...codes].sort();
}

async function searchForIx(flight) {
  const attempts = [
    { days: 45, origin: 'DEL', destination: 'BOM', airlines: ['IX'] },
    { days: 45, origin: 'DEL', destination: 'BOM', airlines: [] },
    { days: 30, origin: 'DEL', destination: 'BOM', airlines: ['IX'] },
    { days: 60, origin: 'DEL', destination: 'BOM', airlines: ['IX'] },
    { days: 75, origin: 'BOM', destination: 'DEL', airlines: ['IX'] },
    { days: 45, origin: 'DEL', destination: 'MAA', airlines: ['IX'] },
    { days: 45, origin: 'BOM', destination: 'BLR', airlines: ['IX'] },
    { days: 45, origin: 'DEL', destination: 'HYD', airlines: ['IX'] },
    { days: 45, origin: 'BOM', destination: 'COK', airlines: ['IX'] },
  ];

  let lastSearch = null;
  for (const attempt of attempts) {
    const label = `${attempt.origin}→${attempt.destination} +${attempt.days}d airlines=${JSON.stringify(attempt.airlines)}`;
    console.log(`Searching ${label}...`);
    const body = buildOneWaySearchBody(attempt.days, {
      origin: attempt.origin,
      destination: attempt.destination,
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.preferences.airlines = attempt.airlines;
    const search = await flight.searchUntilComplete(body);
    lastSearch = search;
    const ix = findIxOptions(search.response.data);
    console.log(`  progress=${search.response.data?.progress?.state} sampleIds=${extractSearchIds(search.response.data, 2).join(',')} IX=${ix.length}`);
    if (ix.length) {
      return { search, ix, route: `${attempt.origin} → ${attempt.destination}`, days: attempt.days };
    }
  }

  console.error('No IX flights found. Airlines in last search:', airlinesInSearch(lastSearch?.response?.data).join(', '));
  throw new Error('No IX flights available');
}

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  console.log('Base URL:', config.baseUrl);

  const { search, ix, route, days } = await searchForIx(flight);
  const pick = ix.find((x) => x.allIx) || ix[0];
  console.log('Selected IX option:', JSON.stringify(pick, null, 2));
  console.log('Route/date offset:', route, `+${days} days`);

  const pricing = await flight.getPricing([pick.searchId], 'ONE_WAY');
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

  console.log('Issuing ticket...');
  const issue = await flight.issueTicket({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [pick.searchId],
    journeyType: 'ONE_WAY',
  });
  if (!issue.ok) throw new Error(`Issue ticket failed: ${JSON.stringify(issue.data)}`);

  const br = issue.data.bookingReference || issue.data.bookingReferenceId || issue.data.bookingRefId;
  console.log('bookingReference:', br, 'issueStatus:', issue.data.status);

  const { response: statusRes, status, timedOut } = await flight.waitForBookingStatus(br);
  console.log('Final status:', status, timedOut ? '(timed out polling)' : '');

  const detail = await flight.getBookingDetail(br);
  const itinerary = detail.data?.bookingResponse?.itinerary || [];
  const flights = itinerary.flatMap((j) =>
    (j.segments || []).map((s) => ({
      airlineCode: s.airline?.code,
      airlineName: s.airline?.name,
      flightNumber: s.flightNumber,
      route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
      pnr: j.pnr,
    })),
  );

  console.log('\n=== BOOKING RESULT ===');
  console.log(JSON.stringify({
    bookingReference: br,
    bookingStatus: status,
    route,
    airline: 'IX',
    flights,
    salesSummary: detail.data?.bookingResponse?.salesSummary,
    priceId: price.priceId,
    totalAmount: price.totalAmount,
    currency: price.currency,
    issueHttp: issue.status,
    statusHttp: statusRes.status,
    searchId: pick.searchId,
  }, null, 2));

  if (String(status).toLowerCase() !== 'confirmed') {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
