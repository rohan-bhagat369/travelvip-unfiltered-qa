/**
 * Probe flight ancillary APIs: SSR (meals/baggage) + seatmap.
 * Usage: node scripts/probe-flight-ancillary.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  canSelectSeats,
  extractSearchIds,
  getSeatMapSkipReason,
  isSeatMapSkippedResponse,
} from '../src/helpers.js';

const issues = [];

function addIssue(area, title, severity, expected, actual, notes = '') {
  issues.push({ area, title, severity, expected, actual, notes });
  console.log(`[ISSUE] ${area} — ${title}`);
  console.log(`        ${actual}`);
}

function ok(msg) {
  console.log(`[OK] ${msg}`);
}

function countSegments(data, key) {
  const segs = data?.[key]?.segments;
  return Array.isArray(segs) ? segs.length : 0;
}

function countMeals(ssrData) {
  const segs = ssrData?.meal?.segments || [];
  return segs.reduce((n, s) => n + (Array.isArray(s.Meals) ? s.Meals.length : 0), 0);
}

function countBaggage(ssrData) {
  const segs = ssrData?.baggage?.segments || ssrData?.baggage?.Segments || [];
  return segs.reduce((n, s) => {
    const opts = s.Baggage || s.baggage || s.Options || s.options || [];
    return n + (Array.isArray(opts) ? opts.length : 0);
  }, 0);
}

function seatSegmentInfo(seatData) {
  const segs = seatData?.data?.segments || seatData?.segments || [];
  return segs.map((s) => ({
    route: `${s.origin || s.Origin}-${s.destination || s.Destination}`,
    seats: Array.isArray(s.seatMap) ? s.seatMap.length : 0,
    open: Array.isArray(s.seatMap)
      ? s.seatMap.filter((x) => /open/i.test(String(x.seatAvailability || x.SeatAvailability))).length
      : 0,
  }));
}

async function probeJourney(label, flight, searchIds, journeyType) {
  console.log(`\n=== ${label} (${journeyType}) ===`);

  const pricing = await flight.getPricing(searchIds, journeyType);
  if (!pricing.ok) {
    addIssue('Pricing', `${label} pricing failed`, 'Critical', 'HTTP 200 pricing', `HTTP ${pricing.status} ${pricing.data?.message || pricing.data?.error?.message || ''}`);
    return;
  }

  const { priceId, bookingContext, passengerOptions } = pricing.data;
  const supportsSeats = canSelectSeats(pricing.data);
  ok(`${label} pricing OK priceId=${priceId?.slice(0, 20)}... supportsSeats=${supportsSeats}`);

  // SSR — meals & baggage
  const ssr = await flight.getSsr(priceId);
  const ssrHttp = ssr.status;
  const ssrBody = ssr.data || {};

  if (!ssr.ok) {
    addIssue(
      'SSR',
      `${label} SSR API fails`,
      'High',
      'HTTP 200 with meal/baggage catalog',
      `HTTP ${ssrHttp} ${ssr.data?.message || ssr.data?.error?.message || ssr.data?.error?.code || ''}`,
    );
  } else {
    const mealSegs = countSegments(ssrBody, 'meal');
    const bagSegs = countSegments(ssrBody, 'baggage');
    const mealCount = countMeals(ssrBody);
    const bagCount = countBaggage(ssrBody);

    ok(`${label} SSR HTTP ${ssrHttp} mealSegments=${mealSegs} meals=${mealCount} baggageSegments=${bagSegs} baggageOptions=${bagCount}`);

    if (!ssrBody.meal && !ssrBody.baggage) {
      addIssue(
        'SSR',
        `${label} SSR returns no meal or baggage sections`,
        'High',
        'meal and baggage objects in SSR response',
        `keys=${Object.keys(ssrBody).join(', ')}`,
      );
    }

    if (ssrBody.meal && mealSegs === 0) {
      addIssue(
        'Meal',
        `${label} meal catalog empty`,
        'Medium',
        'meal.segments with options',
        'meal present but segments=[]',
      );
    }

    if (ssrBody.baggage && bagSegs === 0) {
      addIssue(
        'Baggage',
        `${label} baggage catalog empty`,
        'Medium',
        'baggage.segments with options',
        'baggage present but segments=[]',
      );
    }

    // Invalid priceId
    const badSsr = await flight.getSsr('price_invalid_ancillary_test');
    if (badSsr.ok) {
      addIssue(
        'SSR',
        `${label} invalid priceId accepted on SSR`,
        'High',
        'HTTP 400',
        `HTTP ${badSsr.status} accepted invalid priceId`,
      );
    } else {
      ok(`${label} invalid priceId rejected HTTP ${badSsr.status}`);
    }
  }

  // Seatmap
  const seat = await flight.getSeatMap(bookingContext);
  const seatHttp = seat.status;
  const seatData = seat.data || {};

  if (seatHttp === 502) {
    addIssue(
      'Seat Map',
      `${label} seat map vendor 502`,
      'Medium',
      'Stable seat map or retryable 4xx',
      `HTTP 502 ${seat.data?.message || seat.data?.error?.message || ''}`,
    );
  } else if (!seat.ok) {
    addIssue(
      'Seat Map',
      `${label} seat map request failed`,
      'High',
      'HTTP 200 seat layout',
      `HTTP ${seatHttp} ${seat.data?.message || seat.data?.error?.message || ''}`,
    );
  } else if (isSeatMapSkippedResponse(seat)) {
    const reason = getSeatMapSkipReason(seat);
    if (supportsSeats) {
      addIssue(
        'Seat Map',
        `${label} supportsSeats=true but seat map blocked/skipped`,
        'High',
        'Seat layout when supportsSeats=true',
        `HTTP 200 embedded error: ${reason}`,
      );
    } else {
      ok(`${label} seat not allowed (expected skip): ${reason}`);
      if (seatHttp === 200) {
        addIssue(
          'Seat Map',
          `${label} seats not allowed returns HTTP 200 instead of 4xx`,
          'High',
          'HTTP 4xx or structured error when seat selection not allowed',
          `HTTP 200 embedded error: ${reason}`,
        );
      }
    }
  } else {
    const info = seatSegmentInfo(seat);
    const totalSegs = info.length;
    const totalSeats = info.reduce((n, x) => n + x.seats, 0);
    ok(`${label} seatmap HTTP ${seatHttp} segments=${totalSegs} seats=${totalSeats} detail=${JSON.stringify(info)}`);

    if (supportsSeats && totalSegs === 0) {
      addIssue(
        'Seat Map',
        `${label} supportsSeats=true but empty segments`,
        'Medium',
        'data.segments populated',
        'HTTP 200 segments=[]',
      );
    }

    if (supportsSeats && totalSegs > 0 && totalSeats === 0) {
      addIssue(
        'Seat Map',
        `${label} supportsSeats=true but empty seatMap rows`,
        'Medium',
        'seat rows in segments',
        `segments=${totalSegs} seatMap rows=0`,
      );
    }
  }

  // Invalid bookingContext on seatmap
  const badSeat = await flight.getSeatMap('invalid-booking-context-token');
  if (badSeat.ok && !isSeatMapSkippedResponse(badSeat)) {
    addIssue(
      'Seat Map',
      `${label} invalid requestReference accepted`,
      'High',
      'HTTP 400',
      `HTTP ${badSeat.status} accepted invalid bookingContext`,
    );
  } else {
    ok(`${label} invalid seatmap context rejected/skipped HTTP ${badSeat.status}`);
  }
}

async function main() {
  console.log('=== Flight Ancillary Probe ===\n');
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  // OW
  try {
    const owBody = buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    const ow = await flight.searchUntilComplete(owBody);
    await probeJourney('OW DEL-BOM', flight, [ow.searchId], 'ONE_WAY');

    // Try a second OW with CORPORATE for seat-not-allowed case
    const owCorpBody = buildOneWaySearchBody(48, { origin: 'DEL', destination: 'BOM', fareType: 'CORPORATE' });
    const owCorp = await flight.searchUntilComplete(owCorpBody);
    await probeJourney('OW CORPORATE DEL-BOM', flight, [owCorp.searchId], 'ONE_WAY');
  } catch (e) {
    addIssue('Search', 'OW search failed', 'Critical', 'Complete search', e.message);
  }

  // RT
  try {
    const rtBody = buildRoundTripSearchBody(40, 47, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    const rt = await flight.searchRoundTripUntilComplete(rtBody);
    await probeJourney('RT DEL-BOM', flight, rt.searchIds, 'ROUND_TRIP');
  } catch (e) {
    addIssue('Search', 'RT search failed', 'Critical', 'Complete RT search', e.message);
  }

  const report = {
    ranAt: new Date().toISOString(),
    issueCount: issues.length,
    issues,
  };

  fs.mkdirSync('reports/flight', { recursive: true });
  fs.writeFileSync('reports/flight/ancillary-probe.json', JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`Issues found: ${issues.length}`);
  for (const i of issues) {
    console.log(` - [${i.severity}] ${i.area}: ${i.title}`);
  }
  console.log('\nWrote reports/flight/ancillary-probe.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
