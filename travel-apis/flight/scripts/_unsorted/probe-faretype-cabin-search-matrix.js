/**
 * Search-only matrix: fareType × cabinClass (no booking).
 * fareTypes: NORMAL, CORPORATE, RETAIL
 * cabins: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST
 *
 *   node scripts/probe-faretype-cabin-search-matrix.js
 */
import { writeFileSync } from 'fs';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { buildOneWaySearchBody, buildRoundTripSearchBody } from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const FARE_TYPES = ['NORMAL', 'CORPORATE', 'RETAIL'];
const CABIN_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

function normalizeCabin(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '_');
}

function summarizeOptions(data, requestedCabin) {
  const req = normalizeCabin(requestedCabin);
  const airlines = new Set();
  const cabinCounts = {};
  const fareLabels = new Set();
  let options = 0;
  let matchCabin = 0;
  let mismatchCabin = 0;
  const samples = [];

  for (const result of data?.results || []) {
    for (const opt of result?.options || []) {
      options += 1;
      const code = opt.segments?.[0]?.airline?.code;
      if (code) airlines.add(code);
      const segCabins = (opt.segments || []).map((s) => normalizeCabin(s.cabinClass));
      for (const c of segCabins) cabinCounts[c || 'MISSING'] = (cabinCounts[c || 'MISSING'] || 0) + 1;
      const allMatch = segCabins.length > 0 && segCabins.every((c) => c === req);
      if (allMatch) matchCabin += 1;
      else if (segCabins.length) mismatchCabin += 1;

      for (const f of opt.fares || []) {
        const label = f.fareName || f.brandName || f.fareType || f.cabin || f.name;
        if (label) fareLabels.add(String(label));
      }
      if (opt.fareType || opt.fareFamily) fareLabels.add(String(opt.fareType || opt.fareFamily));

      if (samples.length < 3) {
        samples.push({
          direction: result.direction,
          airline: code,
          flight: opt.segments?.[0]?.flightNumber,
          cabins: segCabins,
          amount: opt.displayPricing?.pricing?.totalAmount ?? opt.pricing?.totalAmount ?? null,
          fareBrands: (opt.fares || []).map((f) => f.fareName || f.brandName || f.name).filter(Boolean).slice(0, 4),
        });
      }
    }
  }

  return {
    options,
    matchCabin,
    mismatchCabin,
    airlines: [...airlines].sort(),
    cabinCounts,
    fareLabels: [...fareLabels].slice(0, 20),
    samples,
  };
}

async function searchUntil(flight, body, { maxPolls = 20, intervalMs = 4000 } = {}) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    last = await flight.search(body);
    if (!last.ok) return last;
    const state = String(last.data?.progress?.state || '').toUpperCase();
    const opts = (last.data?.results || []).reduce((n, r) => n + (r.options?.length || 0), 0);
    if (state === 'COMPLETE' || (i >= 3 && opts > 0 && last.data?.progress?.partial === false)) {
      return last;
    }
    if (state === 'COMPLETE') return last;
    await sleep(intervalMs);
  }
  return last;
}

async function runCase(flight, {
  label, journeyType, origin, destination, fareType, cabinClass, onwardDays = 42, returnDays = 49,
}) {
  let body;
  if (journeyType === 'ROUND_TRIP') {
    body = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin, destination, fareType, maxStops: null,
    });
  } else {
    body = buildOneWaySearchBody(onwardDays, {
      origin, destination, fareType, maxStops: null,
    });
  }
  body.cabinClass = cabinClass;
  body.travellers = { adults: 1, children: 0, infants: 0 };
  body.preferences.airlines = [];

  const started = Date.now();
  const res = await searchUntil(flight, body);
  const elapsedMs = Date.now() - started;
  const summary = res.ok ? summarizeOptions(res.data, cabinClass) : null;

  const row = {
    label,
    journeyType,
    market: `${origin}-${destination}`,
    fareType,
    cabinClass,
    date: body.itinerary?.[0]?.date,
    http: res.status,
    ok: res.ok,
    progress: res.data?.progress?.state || null,
    partial: res.data?.progress?.partial ?? null,
    error: res.data?.error || (res.ok ? null : res.data),
    elapsedMs,
    ...(summary || { options: 0 }),
  };

  const mark = !res.ok
    ? 'ERR'
    : summary.options === 0
      ? 'EMPTY'
      : 'OK';
  console.log(
    `[${mark}] ${label} ${fareType}/${cabinClass} → opts=${summary?.options ?? 0} airlines=${(summary?.airlines || []).join(',') || '-'} progress=${row.progress} ${elapsedMs}ms`
  );
  return row;
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Search-only matrix: fareType × cabinClass (no booking)\n');

  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const results = [];

  // Domestic OW — full fare × cabin
  for (const fareType of FARE_TYPES) {
    for (const cabinClass of CABIN_CLASSES) {
      results.push(
        await runCase(flight, {
          label: 'DOM_OW',
          journeyType: 'ONE_WAY',
          origin: 'DEL',
          destination: 'BOM',
          fareType,
          cabinClass,
          onwardDays: 42,
        })
      );
    }
  }

  // Domestic RT — ECONOMY only for each fare (spot check)
  for (const fareType of FARE_TYPES) {
    results.push(
      await runCase(flight, {
        label: 'DOM_RT',
        journeyType: 'ROUND_TRIP',
        origin: 'DEL',
        destination: 'BOM',
        fareType,
        cabinClass: 'ECONOMY',
        onwardDays: 43,
        returnDays: 50,
      })
    );
  }

  // International OW — each fare × ECONOMY + BUSINESS
  for (const fareType of FARE_TYPES) {
    for (const cabinClass of ['ECONOMY', 'BUSINESS']) {
      results.push(
        await runCase(flight, {
          label: 'INTL_OW',
          journeyType: 'ONE_WAY',
          origin: 'DEL',
          destination: 'DXB',
          fareType,
          cabinClass,
          onwardDays: 45,
        })
      );
    }
  }

  // Pivot summary
  const pivot = {};
  for (const r of results) {
    const key = `${r.label}|${r.fareType}|${r.cabinClass}`;
    pivot[key] = {
      options: r.options,
      progress: r.progress,
      airlines: r.airlines,
      http: r.http,
      error: r.error?.code || r.error?.message || null,
      matchCabin: r.matchCabin,
      mismatchCabin: r.mismatchCabin,
    };
  }

  const byFare = {};
  for (const ft of FARE_TYPES) {
    const rows = results.filter((r) => r.fareType === ft);
    byFare[ft] = {
      cases: rows.length,
      withResults: rows.filter((r) => r.options > 0).length,
      empty: rows.filter((r) => r.ok && r.options === 0).length,
      errors: rows.filter((r) => !r.ok).length,
      totalOptions: rows.reduce((s, r) => s + (r.options || 0), 0),
    };
  }

  const report = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    note: 'Search only — no booking. fareType array rejected earlier (INVALID_REQUEST); each type searched separately.',
    byFare,
    pivot,
    results,
  };

  writeFileSync('reports/faretype-cabin-search-matrix-staging.json', JSON.stringify(report, null, 2));

  console.log('\n===== BY FARE TYPE =====');
  console.log(JSON.stringify(byFare, null, 2));
  console.log('\n===== PIVOT (options) =====');
  for (const [k, v] of Object.entries(pivot)) {
    console.log(k.padEnd(42), `opts=${String(v.options).padStart(3)}`, v.progress || '', v.error || '', (v.airlines || []).join(',') || '-');
  }
  console.log('\nWrote reports/faretype-cabin-search-matrix-staging.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
