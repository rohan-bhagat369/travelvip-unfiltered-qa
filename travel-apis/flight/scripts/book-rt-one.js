/**
 * Book one confirmed ROUND_TRIP (1 adult), prefer refundable/cancellable fare.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildRoundTripSearchBody } from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

function dirOptions(data, direction) {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === direction);
  return block?.options || [];
}

function isRefundable(opt) {
  return opt?.refundable === true || /refundable|cancell/i.test(String(opt?.refundText || ''));
}

function summarize(opt, direction) {
  const seg = opt?.segments?.[0];
  return {
    searchId: opt.searchId,
    direction,
    airline: seg?.airline?.code,
    flight: seg?.flightNumber,
    route: seg ? `${seg.departure?.airportCode}→${seg.arrival?.airportCode}` : null,
    refundable: isRefundable(opt),
    refundText: opt?.refundText,
  };
}

async function findPair(flight, body) {
  const search = await flight.searchRoundTripUntilComplete(body);
  const data = search.response.data;
  const onwardList = dirOptions(data, 'ONWARD');
  const onwardCandidates = [
    ...onwardList.filter(isRefundable),
    ...onwardList.filter((o) => !isRefundable(o)),
  ];

  for (const onward of onwardCandidates.slice(0, 10)) {
    const refined = { ...body, selection: { selectedSearchIds: [onward.searchId] } };
    const returnRes = await flight.pollReturnSearch(body, refined);
    const returnList = dirOptions(returnRes.data, 'RETURN');
    const returnCandidates = [
      ...returnList.filter(isRefundable),
      ...returnList.filter((o) => !isRefundable(o)),
    ];

    for (const ret of returnCandidates.slice(0, 8)) {
      if (!ret.searchId || ret.searchId === onward.searchId) continue;
      const pair = {
        searchIds: [onward.searchId, ret.searchId],
        onward: summarize(onward, 'ONWARD'),
        return: summarize(ret, 'RETURN'),
      };
      if (pair.onward.refundable && pair.return.refundable) return pair;
    }
  }

  throw new Error('No refundable round-trip pair found');
}

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  console.log('Base URL:', config.baseUrl);

  const attempts = [
    {
      label: 'DEL-BOM IX refundable RT',
      body: (() => {
        const b = buildRoundTripSearchBody(45, 52, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0 });
        b.preferences.refundableOnly = true;
        b.preferences.airlines = ['IX'];
        b.travellers = { adults: 1, children: 0, infants: 0 };
        return b;
      })(),
    },
    {
      label: 'DEL-BOM refundable RT',
      body: (() => {
        const b = buildRoundTripSearchBody(35, 42, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0 });
        b.preferences.refundableOnly = true;
        b.travellers = { adults: 1, children: 0, infants: 0 };
        return b;
      })(),
    },
    {
      label: 'BOM-DEL refundable RT',
      body: (() => {
        const b = buildRoundTripSearchBody(40, 47, { origin: 'BOM', destination: 'DEL', fareType: 'NORMAL', maxStops: 0 });
        b.preferences.refundableOnly = true;
        b.travellers = { adults: 1, children: 0, infants: 0 };
        return b;
      })(),
    },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      console.log(`\nTrying ${attempt.label}...`);
      const pair = await findPair(flight, attempt.body);
      console.log('Selected pair:', JSON.stringify(pair, null, 2));

      const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
      if (!pricing.ok) throw new Error(`Pricing failed: ${JSON.stringify(pricing.data)}`);

      const p = pricing.data.pricing || pricing.data;
      console.log('Pricing total:', p.totalAmount ?? pricing.data.totalAmount, p.currency || 'INR');

      const issue = await flight.issueTicket({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: pair.searchIds,
        journeyType: 'ROUND_TRIP',
      });
      if (!issue.ok) throw new Error(`Issue failed: ${JSON.stringify(issue.data)}`);

      const br = issue.data.bookingReference || issue.data.bookingReferenceId;
      console.log('bookingReference:', br, 'issueStatus:', issue.data.status);

      const { status, timedOut } = await flight.waitForBookingStatus(br, 72);
      console.log('Final status:', status, timedOut ? '(timed out)' : '');

      const detail = await flight.getBookingDetail(br);
      const itinerary = detail.data?.bookingResponse?.itinerary || [];

      console.log('\n=== BOOKING RESULT ===');
      console.log(JSON.stringify({
        bookingReference: br,
        bookingStatus: status,
        journeyType: 'ROUND_TRIP',
        travellers: { adults: 1 },
        onward: pair.onward,
        return: pair.return,
        flights: itinerary.map((j) => ({
          direction: j.direction,
          refundable: j.refundable,
          refundText: j.refundText,
          pnr: j.pnr,
          segments: (j.segments || []).map((s) => ({
            airline: s.airline?.code,
            flight: s.flightNumber,
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
          })),
        })),
        salesSummary: detail.data?.bookingResponse?.salesSummary,
        onlineCancellation: detail.data?.bookingResponse?.onlineCancellation,
        priceId: pricing.data.priceId,
      }, null, 2));

      if (String(status).toLowerCase() === 'confirmed') {
        console.log('\nLeft CONFIRMED (not cancelled).');
        return;
      }

      lastError = new Error(`${br} ended as ${status}`);
      console.warn(lastError.message);
    } catch (e) {
      lastError = e;
      console.warn('Attempt failed:', e.message);
    }
  }

  throw lastError || new Error('All booking attempts failed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
