/**
 * Book ONE_WAY, 1 adult, connecting (1-stop / layover) on api-staging.
 * Does NOT cancel after booking.
 *
 * Run: node scripts/book-ow-1adt-connecting-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  analyzeFlightOptions,
  buildOneWaySearchBody,
  pollUntil,
  extractFirstSearchId,
} from '../src/helpers.js';

const OUT = path.join('reports', 'book-ow-1adt-connecting-staging.json');

const ROUTES = [
  { origin: 'DEL', destination: 'GOI', days: 58 },
  { origin: 'DEL', destination: 'IXC', days: 50 },
  { origin: 'BOM', destination: 'CCU', days: 52 },
  { origin: 'DEL', destination: 'GAU', days: 55 },
  { origin: 'BLR', destination: 'PAT', days: 48 },
  { origin: 'BOM', destination: 'IXR', days: 54 },
  { origin: 'DEL', destination: 'TRV', days: 60 },
];

function pickOneStop(searchData) {
  const { connecting } = analyzeFlightOptions(searchData, 'ONWARD');
  // Prefer exact 1-stop / 2-segment (A→H→B)
  const exact = connecting.find((c) => c.totalStops === 1 || c.segmentCount === 2);
  return exact || connecting[0] || null;
}

function optionFlights(searchData, searchId) {
  for (const block of searchData?.results || []) {
    for (const opt of block?.options || []) {
      if (opt.searchId !== searchId) continue;
      return {
        totalStops: opt.totalStops ?? 0,
        segmentCount: opt.segments?.length ?? 0,
        durationMinutes: opt.totalDurationMinutes,
        flights: (opt.segments || []).map((s) => ({
          flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
          route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
          dep: s.departure?.time || s.departure?.dateTime,
          arr: s.arrival?.time || s.arrival?.dateTime,
        })),
      };
    }
  }
  return null;
}

async function searchWithConnecting(flight, body) {
  const response = await pollUntil(
    () => flight.search(body),
    (res) => {
      if (!res.ok) return false;
      const hasId = Boolean(extractFirstSearchId(res.data));
      const complete = String(res.data?.progress?.state || '').toUpperCase() === 'COMPLETE';
      const hasConnecting = analyzeFlightOptions(res.data, 'ONWARD').connectingCount > 0;
      return hasId && (complete || hasConnecting);
    },
    { maxAttempts: 25, intervalMs: 4500, label: 'OW connecting search' },
  );
  return response;
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: ONE_WAY | 1 Adult | connecting (layover A→H→B)');

  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const attempts = [];
  let booked = null;

  for (const route of ROUTES) {
    const body = buildOneWaySearchBody(route.days, {
      origin: route.origin,
      destination: route.destination,
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

    console.log(`\n=== Search ${route.origin}→${route.destination} (+${route.days}d) ===`);
    let searchRes;
    try {
      searchRes = await searchWithConnecting(flight, body);
    } catch (e) {
      console.log('  search fail:', e.message);
      attempts.push({ ...route, ok: false, error: e.message });
      continue;
    }

    const analysis = analyzeFlightOptions(searchRes.data, 'ONWARD');
    console.log(
      `  options=${analysis.total} nonStop=${analysis.nonStopCount} connecting=${analysis.connectingCount}`,
    );

    const pick = pickOneStop(searchRes.data);
    if (!pick) {
      console.log('  no connecting option');
      attempts.push({ ...route, ok: false, error: 'no connecting', analysis });
      continue;
    }

    const meta = optionFlights(searchRes.data, pick.searchId);
    console.log('  picked:', JSON.stringify(meta));

    const pricing = await flight.getPricing([pick.searchId], 'ONE_WAY');
    if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      console.log('  pricing fail:', JSON.stringify(pricing.data)?.slice(0, 300));
      attempts.push({ ...route, ok: false, error: 'pricing', meta, pricing: pricing.data });
      continue;
    }

    const p = pricing.data.pricing || pricing.data;
    const price = {
      priceId: pricing.data.priceId,
      baseFare: p.baseFare ?? pricing.data.baseFare,
      taxes: p.taxes ?? pricing.data.taxes,
      convenienceFee: p.convenienceFee ?? pricing.data.convenienceFee,
      totalAmount: p.totalAmount ?? pricing.data.totalAmount,
      currency: p.currency || pricing.data.currency || 'INR',
    };
    console.log('  pricing:', JSON.stringify(price));

    console.log('  issuing ticket...');
    const issue = await flight.issueTicket({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [pick.searchId],
      journeyType: 'ONE_WAY',
    });

    if (!issue.ok) {
      console.log('  issue fail:', JSON.stringify(issue.data)?.slice(0, 400));
      attempts.push({ ...route, ok: false, error: 'issue', meta, price, issue: issue.data });
      continue;
    }

    const br = issue.data.bookingReference || issue.data.bookingReferenceId || issue.data.bookingRefId;
    console.log('  bookingReference:', br, 'issueStatus:', issue.data.status);

    const { status, timedOut } = await flight.waitForBookingStatus(br);
    console.log('  final status:', status, timedOut ? '(timed out)' : '');

    const detail = await flight.getBookingDetail(br);
    const itinerary = detail.data?.bookingResponse?.itinerary || [];
    const segs = itinerary.flatMap((leg) => leg.segments || []);
    const pnr = itinerary.find((x) => x.pnr)?.pnr || null;

    booked = {
      bookingReference: br,
      bookingStatus: status,
      pnr,
      route: `${route.origin} → ${route.destination}`,
      journeyType: 'ONE_WAY',
      adults: 1,
      connecting: true,
      totalStops: meta?.totalStops,
      segmentCount: segs.length || meta?.segmentCount,
      flights: meta?.flights,
      detailSegments: segs.map((s) => ({
        flight: `${s.airline?.code || s.marketingAirline || ''} ${s.flightNumber || ''}`.trim(),
        route: `${s.departure?.airportCode || s.origin}→${s.arrival?.airportCode || s.destination}`,
      })),
      price,
      issueHttp: issue.status,
      timedOut: Boolean(timedOut),
    };

    attempts.push({ ...route, ok: true, searchId: pick.searchId, meta, br, status });
    break;
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    goal: 'OW 1ADT connecting (layover)',
    booked,
    attempts,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== BOOKING RESULT ===');
  console.log(JSON.stringify(booked || { error: 'No connecting booking completed', attempts }, null, 2));
  console.log('Report:', OUT);

  if (!booked) process.exit(1);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});
