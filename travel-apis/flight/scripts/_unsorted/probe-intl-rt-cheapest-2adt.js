/**
 * Probe international RT routes for cheapest connecting (2 adults).
 * Does NOT book — only search + price compare.
 *
 * Run: node scripts/probe-intl-rt-cheapest-2adt.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import { buildRoundTripSearchBody } from '../../src/helpers.js';

const OUT = path.join('reports', 'probe-intl-rt-cheapest-2adt-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}

function pricingTotal(data) {
  const keys = [
    data?.totalAmount, data?.amount, data?.grandTotal, data?.payableAmount,
    data?.pricing?.totalAmount, data?.price?.totalAmount, data?.fare?.totalAmount,
    data?.breakdown?.totalAmount, data?.totalFare,
  ];
  for (const k of keys) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // deep-ish scan for a reasonable total
  const s = JSON.stringify(data || {});
  const m = s.match(/"totalAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
  if (m) return Number(m[1]);
  return null;
}

function isConnecting(opt) {
  return (opt.totalStops ?? 0) > 0 || (opt.segments?.length ?? 0) > 1;
}

function dirOptions(data, direction) {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === direction);
  return block?.options || [];
}

function flightMeta(opt) {
  return (opt?.segments || []).map((s) => ({
    flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
    route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
  }));
}

async function pricePair(flight, o, r) {
  const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
  if (!ok(pricing) || !pricing.data?.priceId) {
    return { ok: false, error: JSON.stringify(pricing.data).slice(0, 200) };
  }
  return {
    ok: true,
    total: pricingTotal(pricing.data),
    passportType: pricing.data.passportType,
    priceId: pricing.data.priceId,
    bookingContext: pricing.data.bookingContext,
  };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: find cheapest intl RT connecting | 2ADT (no book)');

  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const routes = [
    { origin: 'DEL', destination: 'KTM' },
    { origin: 'BOM', destination: 'KTM' },
    { origin: 'DEL', destination: 'CMB' },
    { origin: 'BOM', destination: 'CMB' },
    { origin: 'CCU', destination: 'DAC' },
    { origin: 'DEL', destination: 'DAC' },
    { origin: 'MAA', destination: 'CMB' },
    { origin: 'DEL', destination: 'MLE' },
    { origin: 'BOM', destination: 'MLE' },
    { origin: 'DEL', destination: 'KUL' },
    { origin: 'BOM', destination: 'BKK' },
    { origin: 'DEL', destination: 'BKK' },
    { origin: 'BOM', destination: 'SIN' },
    { origin: 'DEL', destination: 'DXB' },
  ];

  const dateWindows = [[21, 28], [28, 35]];
  const results = [];

  for (const route of routes) {
    let bestForRoute = null;

    for (const [onwardDays, returnDays] of dateWindows) {
      const body = buildRoundTripSearchBody(onwardDays, returnDays, {
        origin: route.origin,
        destination: route.destination,
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

      const label = `${route.origin}-${route.destination} d${onwardDays}/${returnDays}`;
      console.log(`\n=== ${label} ===`);

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('search fail', e.message);
        results.push({ route, onwardDays, returnDays, error: e.message });
        continue;
      }

      let data = searchRes.response?.data;
      let onward = dirOptions(data, 'ONWARD').filter(isConnecting);
      let ret = dirOptions(data, 'RETURN').filter(isConnecting);

      if (onward.length && !ret.length) {
        try {
          const retRes = await flight.pollReturnSearch(body, {
            ...body,
            selection: { selectedSearchIds: [onward[0].searchId] },
          });
          data = retRes.data;
          ret = dirOptions(data, 'RETURN').filter(isConnecting);
          const o2 = dirOptions(data, 'ONWARD').filter(isConnecting);
          if (o2.length) onward = o2;
        } catch (e) {
          console.log('refine fail', e.message);
        }
      }

      console.log('conn onward/return', onward.length, ret.length);
      if (!onward.length || !ret.length) {
        results.push({
          route: `${route.origin}-${route.destination}`,
          onwardDays,
          returnDays,
          note: 'no connecting pair',
          onwardConn: onward.length,
          returnConn: ret.length,
        });
        continue;
      }

      // Price up to 3x3 cheapest-looking (first options often cheaper in list)
      const oTop = onward.slice(0, 3);
      const rTop = ret.slice(0, 3);
      for (const o of oTop) {
        for (const r of rTop) {
          if (o.searchId === r.searchId) continue;
          try {
            const p = await pricePair(flight, o, r);
            if (!p.ok || p.total == null) {
              console.log('price skip', p.error?.slice?.(0, 80) || p);
              continue;
            }
            console.log('  total', p.total);
            const entry = {
              route: `${route.origin}-${route.destination}-${route.origin}`,
              onwardDays,
              returnDays,
              total: p.total,
              passportType: p.passportType,
              onwardFlights: flightMeta(o),
              returnFlights: flightMeta(r),
              searchIds: [o.searchId, r.searchId],
              priceId: p.priceId,
              bookingContext: p.bookingContext,
            };
            if (!bestForRoute || entry.total < bestForRoute.total) {
              bestForRoute = entry;
            }
          } catch (e) {
            console.log('price err', e.message);
          }
        }
      }
      // once we have a priced option for this date window, still try next window if cheaper
    }

    if (bestForRoute) {
      results.push(bestForRoute);
      console.log('Best for route', bestForRoute.route, bestForRoute.total);
    }
  }

  const priced = results.filter((r) => typeof r.total === 'number').sort((a, b) => a.total - b.total);
  const summary = {
    baseUrl: config.baseUrl,
    goal: 'cheapest intl RT connecting 2ADT (probe only)',
    cheapest: priced[0] || null,
    ranked: priced.slice(0, 10),
    all: results,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== CHEAPEST RANKED ===');
  for (const [i, r] of priced.slice(0, 8).entries()) {
    console.log(`${i + 1}. ${r.route}  INR ${r.total}  days ${r.onwardDays}/${r.returnDays}`);
  }
  console.log('\nReport:', OUT);
  if (!priced.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
