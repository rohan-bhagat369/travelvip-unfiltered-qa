/**
 * Search DEL→BOM for each cabin class and verify returned segment cabinClass matches request.
 * Run: node scripts/probe-cabin-class-search.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../../flight/src/service.js';
import { buildOneWaySearchBody } from '../../flight/src/helpers.js';
import { config } from '../../../shared/config/env.js';

const CABIN_CLASSES = [
  'ECONOMY',
  'PREMIUM_ECONOMY',
  'BUSINESS',
  'FIRST',
];

function normalizeCabin(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '_');
}

function analyzeSearch(data, requestedCabin) {
  const req = normalizeCabin(requestedCabin);
  const options = [];
  const cabinCounts = {};
  const mismatches = [];

  for (const result of data?.results || []) {
    for (const opt of result?.options || []) {
      const segCabins = (opt.segments || []).map((s) => normalizeCabin(s.cabinClass));
      const uniqueCabins = [...new Set(segCabins.filter(Boolean))];
      const allMatch = segCabins.length > 0 && segCabins.every((c) => c === req);
      const anyMatch = segCabins.some((c) => c === req);

      for (const c of segCabins) {
        cabinCounts[c || 'MISSING'] = (cabinCounts[c || 'MISSING'] || 0) + 1;
      }

      const summary = {
        searchId: opt.searchId,
        direction: result.direction,
        airline: opt.segments?.[0]?.airline?.code,
        flight: opt.segments?.[0]?.flightNumber,
        totalStops: opt.totalStops,
        segmentCabins: segCabins,
        uniqueCabins,
        matchesRequested: allMatch,
        partiallyMatches: anyMatch && !allMatch,
        totalAmount: opt.displayPricing?.pricing?.totalAmount ?? opt.pricing?.totalAmount,
        currency: opt.displayPricing?.pricing?.currency ?? opt.pricing?.currency ?? 'INR',
      };
      options.push(summary);

      if (segCabins.length && !allMatch) {
        mismatches.push(summary);
      }
    }
  }

  const totalOptions = options.length;
  const matchingOptions = options.filter((o) => o.matchesRequested).length;
  const mismatchOptions = options.filter((o) => o.partiallyMatches || (o.segmentCabins.length && !o.matchesRequested)).length;
  const missingCabin = options.filter((o) => o.segmentCabins.length === 0 || o.segmentCabins.includes('')).length;

  let verdict;
  if (!data || data?.error) {
    verdict = 'ERROR';
  } else if (totalOptions === 0) {
    verdict = 'NO_RESULTS';
  } else if (matchingOptions === totalOptions) {
    verdict = 'PASS — all options match requested cabin';
  } else if (matchingOptions > 0) {
    verdict = 'PARTIAL — mixed cabin classes in results';
  } else {
    verdict = 'FAIL — no options match requested cabin';
  }

  return {
    requestedCabin: req,
    progress: data?.progress?.state,
    totalOptions,
    matchingOptions,
    mismatchOptions,
    missingCabinField: missingCabin,
    cabinCounts,
    verdict,
    sampleMatches: options.filter((o) => o.matchesRequested).slice(0, 3),
    sampleMismatches: mismatches.slice(0, 5),
    cheapestMatch: options.filter((o) => o.matchesRequested).sort((a, b) => (a.totalAmount ?? 9e9) - (b.totalAmount ?? 9e9))[0] || null,
    cheapestAny: options.sort((a, b) => (a.totalAmount ?? 9e9) - (b.totalAmount ?? 9e9))[0] || null,
  };
}

async function searchCabin(flight, cabinClass) {
  const body = buildOneWaySearchBody(45, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'NORMAL',
    maxStops: null,
  });
  body.cabinClass = cabinClass;

  let last;
  try {
    const result = await flight.searchUntilComplete(body);
    last = { http: result.response.status, ok: result.response.ok, data: result.response.data };
  } catch (e) {
    const res = await flight.search(body);
    last = { http: res.status, ok: res.ok, data: res.data, error: e.message };
  }

  if (last.data?.error) {
    return {
      cabinClass,
      http: last.http,
      ok: last.ok,
      error: last.data.error,
      analysis: null,
    };
  }

  return {
    cabinClass,
    http: last.http,
    ok: last.ok,
    error: last.error || null,
    analysis: analyzeSearch(last.data, cabinClass),
  };
}

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  console.log('Base URL:', config.baseUrl);
  console.log('Route: DEL → BOM (ONE_WAY, NORMAL fare, +45 days)\n');

  const results = [];
  for (const cabinClass of CABIN_CLASSES) {
    console.log(`Searching cabinClass=${cabinClass}...`);
    const result = await searchCabin(flight, cabinClass);
    results.push(result);
  }

  console.log('\n=== CABIN CLASS SEARCH RESULTS ===\n');
  for (const r of results) {
    console.log(`--- ${r.cabinClass} ---`);
    if (r.error && !r.analysis) {
      console.log(`HTTP ${r.http} ERROR: ${JSON.stringify(r.error)}`);
      console.log('');
      continue;
    }
    const a = r.analysis;
    console.log(`HTTP ${r.http} | progress: ${a.progress} | verdict: ${a.verdict}`);
    console.log(`Options: ${a.totalOptions} total | ${a.matchingOptions} match requested | ${a.mismatchOptions} mismatch/mixed`);
    console.log(`Segment cabin breakdown: ${JSON.stringify(a.cabinCounts)}`);
    if (a.cheapestMatch) {
      console.log(`Cheapest matching: ${a.cheapestMatch.airline} ${a.cheapestMatch.flight} ₹${a.cheapestMatch.totalAmount} cabins=${a.cheapestMatch.uniqueCabins.join(',')}`);
    } else if (a.cheapestAny) {
      console.log(`Cheapest (any cabin): ${a.cheapestAny.airline} ${a.cheapestAny.flight} ₹${a.cheapestAny.totalAmount} cabins=${a.cheapestAny.uniqueCabins.join(',')}`);
    }
    if (a.sampleMismatches.length) {
      console.log('Sample mismatches:');
      a.sampleMismatches.forEach((m) => {
        console.log(`  ${m.airline} ${m.flight} searchId=${m.searchId} got=${m.uniqueCabins.join(',')} expected=${a.requestedCabin}`);
      });
    }
    console.log('');
  }

  console.log('\n=== SUMMARY TABLE ===');
  console.log('Cabin Class | HTTP | Options | Match | Mismatch | Verdict');
  for (const r of results) {
    const a = r.analysis;
    if (!a) {
      console.log(`${r.cabinClass} | ${r.http} | - | - | - | ERROR`);
    } else {
      console.log(`${r.cabinClass} | ${r.http} | ${a.totalOptions} | ${a.matchingOptions} | ${a.mismatchOptions} | ${a.verdict}`);
    }
  }

  console.log('\n=== JSON ===');
  console.log(JSON.stringify({ baseUrl: config.baseUrl, testedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
