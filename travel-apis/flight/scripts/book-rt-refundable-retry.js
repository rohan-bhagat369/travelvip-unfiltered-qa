import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import {
  buildRoundTripSearchBody,
  extractOnwardSearchIds,
  extractReturnSearchId,
  extractSearchIds,
  hasRoundTripSearchPair,
} from '../src/helpers.js';

function isRefundable(opt) {
  return opt?.refundable === true || /refundable/i.test(String(opt?.refundText || ''));
}

function dirOptions(data, direction) {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === direction);
  return block?.options || [];
}

async function pickRefundablePair(flight, body) {
  const search = await flight.searchRoundTripUntilComplete(body);
  let data = search.response.data;
  let onwardOpts = dirOptions(data, 'ONWARD').filter(isRefundable);
  if (!onwardOpts.length) onwardOpts = dirOptions(data, 'ONWARD');

  for (const onward of onwardOpts.slice(0, 8)) {
    const onwardId = onward.searchId;
    let returnData = data;
    let returnOpts = dirOptions(data, 'RETURN');
    if (!hasRoundTripSearchPair(data) || !returnOpts.some(isRefundable)) {
      const refined = { ...body, selection: { selectedSearchIds: [onwardId] } };
      returnData = await flight.pollReturnSearch(body, refined);
      returnOpts = dirOptions(returnData.data, 'RETURN');
    }
    const refundableReturns = returnOpts.filter(isRefundable);
    const candidates = refundableReturns.length ? refundableReturns : returnOpts;
    for (const ret of candidates.slice(0, 5)) {
      if (!ret.searchId || ret.searchId === onwardId) continue;
      // Prefer same airline both ways when possible
      const oCode = onward.segments?.[0]?.airline?.code;
      const rCode = ret.segments?.[0]?.airline?.code;
      const sameAirline = oCode && rCode && oCode === rCode;
      return {
        searchIds: [onwardId, ret.searchId],
        sameAirline,
        onward,
        ret,
        preferred: sameAirline && isRefundable(onward) && isRefundable(ret),
      };
    }
  }
  throw new Error('No RT pair found');
}

async function tryBook(flight, body, label) {
  console.log(`\n=== Attempt: ${label} ===`);
  const pair = await pickRefundablePair(flight, body);
  console.log('Pair:', JSON.stringify({
    searchIds: pair.searchIds,
    sameAirline: pair.sameAirline,
    onward: {
      id: pair.onward.searchId,
      airline: pair.onward.segments?.[0]?.airline?.code,
      flight: pair.onward.segments?.[0]?.flightNumber,
      refundable: pair.onward.refundable,
      refundText: pair.onward.refundText,
    },
    return: {
      id: pair.ret.searchId,
      airline: pair.ret.segments?.[0]?.airline?.code,
      flight: pair.ret.segments?.[0]?.flightNumber,
      refundable: pair.ret.refundable,
      refundText: pair.ret.refundText,
    },
  }, null, 2));

  const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
  if (!pricing.ok) {
    console.warn('Pricing failed:', JSON.stringify(pricing.data));
    return null;
  }
  console.log('Total:', pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount);

  const issue = await flight.issueTicket({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: pair.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  if (!issue.ok) {
    console.warn('Issue failed:', JSON.stringify(issue.data));
    return null;
  }

  const br = issue.data.bookingReference || issue.data.bookingReferenceId;
  console.log('BR:', br, 'pending...');

  // Poll up to ~6 min
  const { response, status, timedOut } = await flight.waitForBookingStatus(br, 72);
  console.log('Status:', status, timedOut ? '(timeout)' : '');

  const detail = await flight.getBookingDetail(br);
  const itinerary = detail.data?.bookingResponse?.itinerary || [];

  return {
    bookingReference: br,
    bookingStatus: status,
    timedOut,
    itinerary: itinerary.map((j) => ({
      direction: j.direction,
      refundable: j.refundable,
      refundText: j.refundText,
      pnr: j.pnr,
      segments: (j.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`),
    })),
    salesSummary: detail.data?.bookingResponse?.salesSummary,
    onlineCancellation: detail.data?.bookingResponse?.onlineCancellation,
    priceId: pricing.data.priceId,
  };
}

async function pollExisting(flight, br) {
  console.log(`\nPolling existing ${br}...`);
  for (let i = 1; i <= 24; i++) {
    const res = await flight.getBookingStatus(br);
    const status = res.data?.status;
    console.log(`[${i}] ${status}`);
    if (['confirmed', 'failed', 'cancelled', 'canceled'].includes(String(status).toLowerCase())) {
      return { bookingReference: br, bookingStatus: status, bookingResponse: res.data?.bookingResponse };
    }
    await sleep(10000);
  }
  const last = await flight.getBookingStatus(br);
  return { bookingReference: br, bookingStatus: last.data?.status };
}

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  // First check existing in-progress booking
  const existing = await pollExisting(flight, 'BR1784554182925512');
  if (String(existing.bookingStatus).toLowerCase() === 'confirmed') {
    console.log('\n=== EXISTING BOOKING CONFIRMED ===');
    console.log(JSON.stringify(existing, null, 2));
    return;
  }
  console.log('Existing booking ended as:', existing.bookingStatus);

  const attempts = [
    {
      label: 'DEL-BOM IX refundable RT +45/+52',
      body: (() => {
        const b = buildRoundTripSearchBody(45, 52, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0 });
        b.preferences.refundableOnly = true;
        b.preferences.airlines = ['IX'];
        b.travellers = { adults: 1, children: 0, infants: 0 };
        return b;
      })(),
    },
    {
      label: 'DEL-BOM refundable RT same-airline prefer +40/+47',
      body: (() => {
        const b = buildRoundTripSearchBody(40, 47, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0 });
        b.preferences.refundableOnly = true;
        b.travellers = { adults: 1, children: 0, infants: 0 };
        return b;
      })(),
    },
    {
      label: 'BOM-BLR refundable RT +35/+42',
      body: (() => {
        const b = buildRoundTripSearchBody(35, 42, { origin: 'BOM', destination: 'BLR', fareType: 'NORMAL', maxStops: 0 });
        b.preferences.refundableOnly = true;
        b.travellers = { adults: 1, children: 0, infants: 0 };
        return b;
      })(),
    },
  ];

  for (const attempt of attempts) {
    try {
      const result = await tryBook(flight, attempt.body, attempt.label);
      if (result && String(result.bookingStatus).toLowerCase() === 'confirmed') {
        console.log('\n=== BOOKING CONFIRMED ===');
        console.log(JSON.stringify(result, null, 2));
        console.log('\nLeft CONFIRMED (not cancelled) for your cancel/refund check.');
        return;
      }
      if (result) {
        console.warn('Not confirmed:', result.bookingReference, result.bookingStatus);
      }
    } catch (e) {
      console.warn('Attempt failed:', e.message);
    }
  }

  console.error('Could not get a Confirmed refundable RT booking.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
