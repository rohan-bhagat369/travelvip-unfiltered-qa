/**
 * READ-ONLY prod search: find routes with SpiceJet (SG).
 * Does not book / price / issue.
 *
 *   BASE_URL=https://api.travelvip.ai ... node scripts/probe-prod-sg-routes.js
 */
import fs from 'fs';
import { authenticate } from '../../../../shared/lib/authService.js';
import { buildOneWaySearchBody, extractSearchIds, pollUntil } from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';

const ROUTES = [
  ['DEL', 'BOM'],
  ['BOM', 'DEL'],
  ['DEL', 'BLR'],
  ['BLR', 'DEL'],
  ['DEL', 'HYD'],
  ['HYD', 'DEL'],
  ['DEL', 'MAA'],
  ['MAA', 'DEL'],
  ['BOM', 'BLR'],
  ['BLR', 'BOM'],
  ['BOM', 'HYD'],
  ['BOM', 'GOI'],
  ['DEL', 'GOI'],
  ['DEL', 'CCU'],
  ['BOM', 'MAA'],
  ['DEL', 'AMD'],
  ['BOM', 'AMD'],
  ['DEL', 'PNQ'],
  ['BOM', 'PNQ'],
  ['DEL', 'COK'],
  ['BOM', 'COK'],
];

const dayOffsets = [20, 30, 45];

function summarizeSg(searchData) {
  const flights = [];
  for (const result of searchData?.results || []) {
    for (const opt of result?.options || []) {
      const segs = opt.segments || [];
      const codes = segs.map((s) => String(s.airline?.code || '').toUpperCase());
      if (!codes.length || !codes.every((c) => c === 'SG')) continue;
      const first = segs[0];
      const last = segs[segs.length - 1];
      flights.push({
        searchId: opt.searchId,
        flight: segs.map((s) => `${s.airline?.code} ${s.flightNumber}`).join(' + '),
        from: first?.departure?.airportCode,
        to: last?.arrival?.airportCode,
        depart: first?.departure?.datetime || first?.departure?.dateTime || first?.departure?.time,
        stops: opt.totalStops ?? Math.max(0, segs.length - 1),
        refundable: opt.refundable,
        totalAmount: opt.pricing?.totalAmount ?? opt.totalAmount ?? null,
        currency: opt.pricing?.currency || null,
      });
    }
  }
  return flights;
}

const session = await authenticate(true);
console.log('Base URL:', config.baseUrl, '| READ-ONLY SG route scan (no booking)');

const hits = [];
const misses = [];

for (const [origin, destination] of ROUTES) {
  let found = [];
  let lastErr = null;
  for (const day of dayOffsets) {
    const body = buildOneWaySearchBody(day, {
      origin,
      destination,
      fareType: 'NORMAL',
      maxStops: 0,
    });
    body.preferences.airlines = ['SG'];
    try {
      const res = await pollUntil(
        () => session.client.request({
          method: 'POST',
          path: '/v1/flights/search',
          query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' },
          body,
          correlation: true,
        }),
        (r) => r.ok && (r.data?.progress?.state === 'COMPLETE' || extractSearchIds(r.data, 1).length > 0),
        { maxAttempts: 18, intervalMs: 3500, label: `SG ${origin}-${destination}` },
      );
      if (!res.ok) {
        lastErr = res.data?.error?.code || res.data?.error?.message || `http ${res.status}`;
        continue;
      }
      const sg = summarizeSg(res.data);
      if (sg.length) {
        found = sg;
        hits.push({
          route: `${origin} → ${destination}`,
          origin,
          destination,
          date: body.itinerary[0].date,
          dayOffset: day,
          sgCount: sg.length,
          sampleFlights: sg.slice(0, 5),
          cheapest: [...sg].sort((a, b) => (a.totalAmount ?? 1e12) - (b.totalAmount ?? 1e12))[0] || null,
        });
        break;
      }
      lastErr = res.data?.error?.code || 'NO_SG_OPTIONS';
    } catch (e) {
      lastErr = e.message;
    }
  }
  if (!found.length) {
    misses.push({ route: `${origin} → ${destination}`, note: lastErr });
    console.log('MISS', origin, '→', destination, lastErr);
  } else {
    console.log('HIT ', origin, '→', destination, 'date', hits[hits.length - 1].date, 'SG options', found.length, 'cheapest', hits[hits.length - 1].cheapest?.flight, hits[hits.length - 1].cheapest?.totalAmount);
  }
}

const report = {
  ranAt: new Date().toISOString(),
  env: config.baseUrl,
  mode: 'READ-ONLY search only (no pricing/booking)',
  airline: 'SG (SpiceJet)',
  routesWithSpiceJet: hits,
  routesWithoutSpiceJet: misses,
};
fs.mkdirSync('reports/flight', { recursive: true });
fs.writeFileSync('reports/flight/prod-sg-routes.json', JSON.stringify(report, null, 2));
console.log('\n=== SG ROUTES ON PROD ===');
console.log(JSON.stringify(hits.map((h) => ({
  route: h.route,
  date: h.date,
  sgCount: h.sgCount,
  sample: h.sampleFlights.map((f) => f.flight),
  cheapest: h.cheapest ? `${h.cheapest.flight} ${h.cheapest.totalAmount}` : null,
})), null, 2));
console.log('Wrote reports/flight/prod-sg-routes.json');
