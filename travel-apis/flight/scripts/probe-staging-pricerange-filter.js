/**
 * Staging spot-check: apply filters.ONWARD.priceRange (min/max) and verify options.
 * Uses appliedFilters.ONWARD.priceRange on POST /v1/flights/search (response facet is filters.*).
 *
 *   BASE_URL=https://api-staging.travelvip.ai node travel-apis/flight/scripts/probe-staging-pricerange-filter.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody } from '../src/helpers.js';

const OUT = path.join('travel-apis', 'flight', 'reports', 'flight-pricerange-staging-spotcheck.json');

function optionPrice(opt) {
  const p = opt?.displayPricing?.pricing || opt?.displayPricing || opt?.price || opt?.pricing || {};
  const n = Number(
    p.totalAmount ?? p.total ?? p.totalFare ?? p.grandTotal ?? p.amount ?? opt?.totalPrice ?? opt?.totalFare,
  );
  return Number.isFinite(n) ? n : null;
}

function optionsOf(data, dir = 'ONWARD') {
  const block =
    (data?.results || []).find((r) => String(r.direction || '').toUpperCase() === dir) ||
    data?.results?.[0] ||
    {};
  return Array.isArray(block.options) ? block.options : [];
}

function facetPrice(data, dir = 'ONWARD') {
  const f = data?.filters?.[dir]?.priceRange || data?.filters?.[dir]?.price || {};
  const min = Number(f.min ?? f.from ?? f.lowest);
  const max = Number(f.max ?? f.to ?? f.highest);
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
}

function priceStats(opts) {
  const prices = opts.map(optionPrice).filter((p) => p != null).sort((a, b) => a - b);
  return {
    count: opts.length,
    priced: prices.length,
    min: prices[0] ?? null,
    max: prices[prices.length - 1] ?? null,
    sampleLow: prices.slice(0, 3),
    sampleHigh: prices.slice(-3),
  };
}

function outsideRange(opts, min, max) {
  return opts
    .map((o) => ({ id: o.searchId || o.id, price: optionPrice(o) }))
    .filter((x) => x.price == null || x.price < min - 1 || x.price > max + 1);
}

async function searchOnce(flight, body, polls = 5) {
  let last = null;
  for (let i = 0; i < polls; i++) {
    last = await flight.search(body);
    if (optionsOf(last.data).length) return last;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return last;
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  // Example range from user + tighter-derived ranges from 3 routes
  const routes = [
    { origin: 'DEL', destination: 'BOM', days: 31, fixedRange: { min: 1300, max: 38286 } },
    { origin: 'BOM', destination: 'BLR', days: 35, fixedRange: { min: 1300, max: 38286 } },
    { origin: 'DEL', destination: 'HYD', days: 40, fixedRange: { min: 1300, max: 38286 } },
  ];

  const rows = [];

  for (const route of routes) {
    const label = `${route.origin}-${route.destination}`;
    console.log(`\n=== ${label} ===`);
    const base = buildOneWaySearchBody(route.days, {
      origin: route.origin,
      destination: route.destination,
      fareType: 'NORMAL',
      maxStops: null,
    });

    const unf = await searchOnce(flight, base);
    const opts0 = optionsOf(unf.data);
    const stats0 = priceStats(opts0);
    const facet0 = facetPrice(unf.data);
    console.log('unfiltered', unf.status, 'opts', stats0.count, 'prices', stats0.min, '..', stats0.max, 'facet', facet0);

    if (!stats0.priced) {
      rows.push({
        route: label,
        case: 'baseline',
        status: 'NOT TESTED',
        note: `no options HTTP ${unf.status}`,
        date: base.itinerary[0].date,
      });
      continue;
    }

    // 1) Apply exact user-style range: filters.ONWARD.priceRange min/max via appliedFilters
    {
      const min = route.fixedRange.min;
      const max = route.fixedRange.max;
      const body = JSON.parse(JSON.stringify(base));
      body.appliedFilters = { ONWARD: { priceRange: { min, max } } };
      const res = await searchOnce(flight, body);
      const opts = optionsOf(res.data);
      const stats = priceStats(opts);
      const bad = outsideRange(opts, min, max);
      const status = res.status >= 500 ? 'BUG' : bad.length ? 'BUG' : 'PASS';
      const note = `HTTP ${res.status} appliedFilters.ONWARD.priceRange={min:${min},max:${max}} opts=${stats.count} priced=${stats.priced} resultPrices=[${stats.min}..${stats.max}] outside=${bad.length}`;
      console.log(`[${status}] fixed ${min}-${max}`, note);
      if (bad[0]) console.log('  outside sample', bad.slice(0, 3));
      rows.push({
        route: label,
        date: base.itinerary[0].date,
        case: `appliedFilters.ONWARD.priceRange min=${min} max=${max}`,
        filter: { min, max },
        unfiltered: stats0,
        facet: facet0,
        filtered: stats,
        outside: bad.slice(0, 8),
        status,
        note,
        payload: body.appliedFilters,
      });
    }

    // 2) Tight band using facet/response inventory: keep only cheaper half
    {
      const min = stats0.min;
      const max = Math.max(min, Math.round(stats0.min + (stats0.max - stats0.min) * 0.4));
      const body = JSON.parse(JSON.stringify(base));
      body.appliedFilters = { ONWARD: { priceRange: { min, max } } };
      const res = await searchOnce(flight, body);
      const opts = optionsOf(res.data);
      const stats = priceStats(opts);
      const bad = outsideRange(opts, min, max);
      // Also: filtered max should not exceed filter max; count should shrink if inventory had higher fares
      const hadAbove = stats0.max > max + 1;
      const shrunk = !hadAbove || stats.count < stats0.count;
      let status = 'PASS';
      let note = '';
      if (res.status >= 500) {
        status = 'BUG';
        note = `HTTP ${res.status}`;
      } else if (bad.length) {
        status = 'BUG';
        note = `options outside range outside=${bad.length} e.g. ${JSON.stringify(bad[0])}`;
      } else if (hadAbove && stats.count >= stats0.count && stats.max > max + 1) {
        status = 'BUG';
        note = `filter not applied; still returning high fares max=${stats.max}`;
      } else if (hadAbove && !shrunk && stats.max <= max + 1) {
        status = 'PASS';
        note = `HTTP ${res.status} all within [${min},${max}] opts=${stats.count} (unfiltered had higher but count same page)`;
      } else {
        status = 'PASS';
        note = `HTTP ${res.status} within [${min},${max}] opts=${stats.count}/${stats0.count} resultMax=${stats.max}`;
      }
      console.log(`[${status}] tight ${min}-${max}`, note);
      rows.push({
        route: label,
        date: base.itinerary[0].date,
        case: `tight priceRange min=${min} max=${max}`,
        filter: { min, max },
        unfiltered: stats0,
        filtered: stats,
        outside: bad.slice(0, 8),
        status,
        note,
        payload: body.appliedFilters,
      });
    }

    // 3) Impossible low max — expect empty (or none outside)
    {
      const max = Math.max(0, Math.floor(stats0.min) - 100);
      const body = JSON.parse(JSON.stringify(base));
      body.appliedFilters = { ONWARD: { priceRange: { min: 0, max } } };
      const res = await searchOnce(flight, body, 3);
      const opts = optionsOf(res.data);
      const stats = priceStats(opts);
      const bad = outsideRange(opts, 0, max);
      const status = bad.length ? 'BUG' : opts.length === 0 ? 'PASS' : 'BUG';
      const note =
        opts.length === 0
          ? `HTTP ${res.status} empty as expected max=${max} < inventoryMin=${stats0.min}`
          : `HTTP ${res.status} expected empty but opts=${stats.count} prices=[${stats.min}..${stats.max}]`;
      console.log(`[${status}] impossible max=${max}`, note);
      rows.push({
        route: label,
        date: base.itinerary[0].date,
        case: `impossible priceRange max=${max}`,
        filter: { min: 0, max },
        unfilteredMin: stats0.min,
        filtered: stats,
        outside: bad.slice(0, 8),
        status,
        note,
        payload: body.appliedFilters,
      });
    }
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});
  const summary = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    suite: 'flight-pricerange-appliedFilters',
    note: 'Request uses appliedFilters.ONWARD.priceRange; response facet is filters.ONWARD.priceRange',
    counts,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\nCOUNTS', counts);
  console.log('WROTE', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
