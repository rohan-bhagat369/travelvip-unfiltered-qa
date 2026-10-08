/**
 * Round-trip fare rules probe across routes — LCC vs FSC combinations.
 */
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import {
  buildRoundTripSearchBody,
  extractOnwardSearchIds,
} from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';

const KNOWN_LCC = new Set(['6E', 'SG', 'IX', 'QP', 'I5', 'G8']);
const KNOWN_FSC = new Set(['AI', 'UK', '9W']);

function isLcc(option) {
  if (typeof option.lcc === 'boolean') return option.lcc;
  const code = option.segments?.[0]?.airline?.code;
  if (KNOWN_LCC.has(code)) return true;
  if (KNOWN_FSC.has(code)) return false;
  return null;
}

function summarizeOption(opt, direction) {
  const airline = opt.segments?.[0]?.airline;
  const lcc = isLcc(opt);
  return {
    searchId: opt.searchId,
    direction,
    airlineCode: airline?.code,
    airlineName: airline?.name,
    flight: opt.segments?.[0]?.flightNumber,
    lcc,
    lccLabel: lcc === true ? 'LCC' : lcc === false ? 'FSC' : 'UNKNOWN',
    totalAmount: opt.displayPricing?.pricing?.totalAmount,
  };
}

function fareRulesError(data) {
  if (!data) return 'empty response';
  if (data.error) return `${data.error.code || 'ERROR'}: ${data.error.message || JSON.stringify(data.error)}`;
  if (Array.isArray(data.fareRules) && data.fareRules.length > 0) return null;
  return 'no fareRules in response';
}

async function getRtOptions(flight, route, airlineFilter = []) {
  const body = buildRoundTripSearchBody(route.onwardDays, route.returnDays, {
    origin: route.origin,
    destination: route.destination,
    fareType: 'NORMAL',
    maxStops: null,
  });
  if (airlineFilter.length) body.preferences.airlines = airlineFilter;

  let onwardOpts = [];
  let returnOpts = [];

  try {
    const initial = await flight.searchRoundTripUntilComplete(body);
    const data = initial.response.data;
    onwardOpts = (data.results || []).find((r) => r.direction === 'ONWARD')?.options || [];
    returnOpts = (data.results || []).find((r) => r.direction === 'RETURN')?.options || [];

    if (!returnOpts.length) {
      const onwardId = extractOnwardSearchIds(data, 1)[0];
      if (onwardId) {
        const refined = { ...body, selection: { selectedSearchIds: [onwardId] } };
        const returnRes = await flight.pollReturnSearch(body, refined);
        returnOpts = (returnRes.data?.results || []).find((r) => r.direction === 'RETURN')?.options || [];
      }
    }
  } catch (e) {
    return { route, airlineFilter, error: e.message, onwardOpts: [], returnOpts: [] };
  }

  return { route, airlineFilter, onwardOpts, returnOpts };
}

async function testPair(flight, onward, ret, meta) {
  const o = summarizeOption(onward, 'ONWARD');
  const r = summarizeOption(ret, 'RETURN');
  const fareRules = await flight.getFareRules([o.searchId, r.searchId], 'ROUND_TRIP');
  const err = fareRulesError(fareRules.data);
  return {
    ...meta,
    combo: `${o.lccLabel}+${r.lccLabel}`,
    onward: o,
    return: r,
    http: fareRules.status,
    status: fareRules.ok && !err ? 'PASS' : 'FAIL',
    error: err,
    fareRulesCount: fareRules.data?.fareRules?.length ?? 0,
    bodySnippet: err ? JSON.stringify(fareRules.data).slice(0, 250) : null,
  };
}

async function main() {
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  console.log('Base URL:', config.baseUrl);

  const routes = [
    { label: 'DEL-BOM', origin: 'DEL', destination: 'BOM', onwardDays: 45, returnDays: 52 },
    { label: 'DEL-BLR', origin: 'DEL', destination: 'BLR', onwardDays: 30, returnDays: 37 },
    { label: 'DEL-HYD', origin: 'DEL', destination: 'HYD', onwardDays: 35, returnDays: 42 },
    { label: 'BOM-BLR', origin: 'BOM', destination: 'BLR', onwardDays: 40, returnDays: 47 },
  ];

  const airlineFilters = [
    { label: 'all airlines', codes: [] },
    { label: '6E only (LCC)', codes: ['6E'] },
    { label: 'SG only (LCC)', codes: ['SG'] },
    { label: 'IX only (LCC)', codes: ['IX'] },
    { label: 'AI only (FSC)', codes: ['AI'] },
    { label: 'QP only (LCC)', codes: ['QP'] },
  ];

  const allResults = [];

  for (const route of routes) {
    for (const filter of airlineFilters) {
      console.log(`\n--- ${route.label} | ${filter.label} ---`);
      const { onwardOpts, returnOpts, error } = await getRtOptions(flight, route, filter.codes);
      if (error) {
        console.log('Search error:', error);
        continue;
      }

      const onwardLcc = onwardOpts.filter((o) => isLcc(o) === true);
      const onwardFsc = onwardOpts.filter((o) => isLcc(o) === false);
      const returnLcc = returnOpts.filter((o) => isLcc(o) === true);
      const returnFsc = returnOpts.filter((o) => isLcc(o) === false);

      console.log(`Onward: ${onwardOpts.length} (${onwardLcc.length} LCC, ${onwardFsc.length} FSC) | Return: ${returnOpts.length} (${returnLcc.length} LCC, ${returnFsc.length} FSC)`);

      const pairs = [
        { tag: 'LCC+LCC', o: onwardLcc[0], r: returnLcc[0] },
        { tag: 'LCC+FSC', o: onwardLcc[0], r: returnFsc[0] },
        { tag: 'FSC+LCC', o: onwardFsc[0], r: returnLcc[0] },
        { tag: 'FSC+FSC', o: onwardFsc[0], r: returnFsc[0] },
      ];

      for (const p of pairs) {
        if (!p.o || !p.r) {
          console.log(`  [SKIP] ${p.tag}`);
          continue;
        }
        const result = await testPair(flight, p.o, p.r, {
          route: route.label,
          filter: filter.label,
          tag: p.tag,
        });
        allResults.push(result);
        console.log(`  [${result.status}] ${p.tag} ${result.onward.airlineCode}+${result.return.airlineCode} HTTP ${result.http}${result.error ? ` — ${result.error}` : ''}`);
      }
    }
  }

  const passed = allResults.filter((r) => r.status === 'PASS');
  const failed = allResults.filter((r) => r.status === 'FAIL');

  console.log('\n\n========== FINAL SUMMARY ==========');
  console.log(`Total fare-rules calls: ${allResults.length} | PASS: ${passed.length} | FAIL: ${failed.length}`);

  if (failed.length) {
    console.log('\n--- FAILURES ---');
    failed.forEach((f) => {
      console.log(`${f.route} | ${f.filter} | ${f.tag} | ${f.onward.airlineCode}+${f.return.airlineCode} | HTTP ${f.http}`);
      console.log(`  Error: ${f.error}`);
      console.log(`  Body: ${f.bodySnippet}`);
    });

    console.log('\n--- FAILURE PATTERN BY COMBO TYPE ---');
    for (const tag of ['LCC+LCC', 'LCC+FSC', 'FSC+LCC', 'FSC+FSC']) {
      const f = failed.filter((x) => x.tag === tag);
      const p = passed.filter((x) => x.tag === tag);
      if (f.length + p.length) console.log(`${tag}: ${p.length} pass, ${f.length} fail`);
    }
  } else {
    console.log('\nNo fare rules failures found in tested combinations.');
  }

  if (passed.length) {
    console.log('\n--- PASSES (sample) ---');
    passed.slice(0, 10).forEach((p) => {
      console.log(`${p.route} | ${p.tag} | ${p.onward.airlineCode}+${p.return.airlineCode} | rules=${p.fareRulesCount}`);
    });
  }

  console.log('\n=== JSON ===');
  console.log(JSON.stringify({ testedAt: new Date().toISOString(), allResults }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
