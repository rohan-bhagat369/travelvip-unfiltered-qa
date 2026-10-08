import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

function buildOwBody(origin, destination, days = 45, maxStops = null) {
  return {
    itinerary: [{ origin, destination, date: futureDate(days) }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function buildRtBody(origin, destination, daysOn = 45, daysRet = 52, maxStops = null) {
  return {
    itinerary: [
      { origin, destination, date: futureDate(daysOn) },
      { origin: destination, destination: origin, date: futureDate(daysRet) },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function analyzeOptions(data, direction = 'ONWARD') {
  const block = data?.results?.find((r) => r.direction === direction) || data?.results?.[0];
  const options = block?.options || [];
  let nonStop = 0;
  let oneStop = 0;
  let twoPlus = 0;
  const samples = [];

  for (const opt of options) {
    const stops = opt.totalStops ?? 0;
    const segCount = opt.segments?.length ?? 0;
    if (stops === 0 && segCount <= 1) nonStop++;
    else if (stops === 1 || segCount === 2) oneStop++;
    else twoPlus++;

    if ((stops > 0 || segCount > 1) && samples.length < 2) {
      samples.push({
        searchId: opt.searchId,
        stops,
        segments: segCount,
        duration: opt.totalDurationMinutes,
        flights: opt.segments?.map((s) => `${s.airline?.code} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`),
      });
    }
  }

  return { total: options.length, nonStop, oneStop, twoPlus, samples, stopFilters: data?.filters?.[direction]?.stops };
}

async function pollSearch(flight, body, label, maxAttempts = 20) {
  let last;
  for (let i = 1; i <= maxAttempts; i++) {
    last = await flight.search(body);
    if (!last.ok) return { ok: false, status: last.status, error: last.data?.error?.code, label };
    const state = last.data?.progress?.state;
    const hasOptions = last.data?.results?.some((r) => r.options?.length > 0);
    if (state === 'COMPLETE' || (hasOptions && i >= 4)) break;
    await sleep(last.data?.progress?.pollAfterMs || 4000);
  }
  return { ok: true, data: last.data, label };
}

const ROUTES = [
  { origin: 'DEL', destination: 'BOM', note: 'short domestic' },
  { origin: 'DEL', destination: 'BLR', note: 'metro domestic' },
  { origin: 'DEL', destination: 'GAU', note: 'domestic NE' },
  { origin: 'BOM', destination: 'CCU', note: 'cross domestic' },
  { origin: 'DEL', destination: 'IXC', note: 'domestic hill' },
  { origin: 'PAT', destination: 'BOM', note: 'tier2 origin' },
  { origin: 'DEL', destination: 'DXB', note: 'international short' },
  { origin: 'BOM', destination: 'LHR', note: 'international long' },
  { origin: 'DEL', destination: 'SIN', note: 'international hub' },
  { origin: 'BLR', destination: 'JFK', note: 'long haul' },
];

async function main() {
  const { client } = await authenticate();
  const flight = new FlightService(client);
  const results = [];

  console.log('\n=== ONE-WAY — maxStops: null (all stops allowed) ===\n');
  for (const route of ROUTES) {
    const body = buildOwBody(route.origin, route.destination, 45, null);
    const res = await pollSearch(flight, body, `${route.origin}→${route.destination} OW`);
    if (!res.ok) {
      console.log(`${route.origin}→${route.destination}: FAIL ${res.status} ${res.error || ''}`);
      results.push({ ...route, journeyType: 'ONE_WAY', ok: false });
      continue;
    }
    const onward = analyzeOptions(res.data, 'ONWARD');
    const hasConnecting = onward.oneStop + onward.twoPlus > 0;
    console.log(
      `${route.origin}→${route.destination} (${route.note}): options=${onward.total} | non-stop=${onward.nonStop} | 1-stop=${onward.oneStop} | 2+=${onward.twoPlus} | connecting=${hasConnecting ? 'YES' : 'NO'}`,
    );
    if (onward.samples[0]) {
      console.log('  sample:', JSON.stringify(onward.samples[0]));
    }
    if (onward.stopFilters) console.log('  filter stops:', onward.stopFilters);
    results.push({ ...route, journeyType: 'ONE_WAY', ok: true, ...onward, hasConnecting });
    await sleep(500);
  }

  console.log('\n=== ROUND-TRIP — maxStops: null (all stops allowed) ===\n');
  const rtRoutes = ROUTES.filter((r) => !['BLR', 'PAT'].includes(r.origin));
  for (const route of rtRoutes) {
    const body = buildRtBody(route.origin, route.destination, 30, 37, null);
    let res = await pollSearch(flight, body, `${route.origin}↔${route.destination} RT`, 25);
    if (!res.ok) {
      console.log(`${route.origin}↔${route.destination}: FAIL ${res.status}`);
      continue;
    }

    const onward = analyzeOptions(res.data, 'ONWARD');
    const ret = analyzeOptions(res.data, 'RETURN');
    const onwardId = res.data?.results?.find((r) => r.direction === 'ONWARD')?.options?.[0]?.searchId;

    let retAnalysis = ret;
    if (onwardId && ret.total === 0) {
      const selBody = { ...body, selection: { selectedSearchIds: [onwardId] } };
      const res2 = await pollSearch(flight, selBody, 'RT return leg', 20);
      if (res2.ok) retAnalysis = analyzeOptions(res2.data, 'RETURN');
    }

    const hasConnecting = onward.oneStop + onward.twoPlus + retAnalysis.oneStop + retAnalysis.twoPlus > 0;
    console.log(
      `${route.origin}↔${route.destination}: ONWARD opts=${onward.total} (1-stop=${onward.oneStop}, 2+=${onward.twoPlus}) | RETURN opts=${retAnalysis.total} (1-stop=${retAnalysis.oneStop}, 2+=${retAnalysis.twoPlus}) | connecting=${hasConnecting ? 'YES' : 'NO'}`,
    );
    if (onward.samples[0]) console.log('  onward sample:', JSON.stringify(onward.samples[0]));
    if (retAnalysis.samples[0]) console.log('  return sample:', JSON.stringify(retAnalysis.samples[0]));
    results.push({
      ...route,
      journeyType: 'ROUND_TRIP',
      onward,
      return: retAnalysis,
      hasConnecting,
    });
    await sleep(500);
  }

  console.log('\n=== Compare: DEL-BOM with maxStops=0 vs maxStops=null ===\n');
  for (const maxStops of [0, null, 1, 2]) {
    const body = buildOwBody('DEL', 'BOM', 45, maxStops);
    const res = await pollSearch(flight, body, `DEL-BOM maxStops=${maxStops}`);
    if (res.ok) {
      const a = analyzeOptions(res.data);
      console.log(`maxStops=${maxStops}: total=${a.total} non-stop=${a.nonStop} 1-stop=${a.oneStop} 2+=${a.twoPlus} filters=${JSON.stringify(a.stopFilters)}`);
    }
  }

  const owWithConnecting = results.filter((r) => r.journeyType === 'ONE_WAY' && r.hasConnecting);
  console.log(`\nOW routes with connecting flights: ${owWithConnecting.map((r) => `${r.origin}→${r.destination}`).join(', ') || 'none'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
