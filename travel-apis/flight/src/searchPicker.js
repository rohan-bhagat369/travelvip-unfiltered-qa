import { extractFirstSearchId, isSearchProgressComplete } from './helpers.js';

function normAirline(code) {
  return String(code || '').toUpperCase();
}

function flightNumbers(opt) {
  return (opt?.segments || []).map((s) => ({
    code: normAirline(s.airline?.code || s.airlineCode),
    number: String(s.flightNumber || '').replace(/\s+/g, ''),
    label: `${normAirline(s.airline?.code || s.airlineCode)} ${s.flightNumber || ''}`.trim(),
  }));
}

function matchesFlightFilter(opt, flightNumber, excludeFlightNumber) {
  const flights = flightNumbers(opt);
  if (flightNumber) {
    const want = String(flightNumber).replace(/\s+/g, '').toUpperCase();
    const hit = flights.some((f) => {
      const full = `${f.code}${f.number}`.toUpperCase();
      return full.includes(want) || f.number === want || full.endsWith(want);
    });
    if (!hit) return false;
  }
  if (excludeFlightNumber) {
    const skip = String(excludeFlightNumber).replace(/\s+/g, '').toUpperCase();
    const bad = flights.some((f) => {
      const full = `${f.code}${f.number}`.toUpperCase();
      return full.includes(skip) || f.number === skip || full.endsWith(skip);
    });
    if (bad) return false;
  }
  return true;
}

function matchesAirline(opt, airlines) {
  if (!airlines?.length) return true;
  const want = new Set(airlines.map(normAirline));
  return (opt?.segments || []).some((s) => want.has(normAirline(s.airline?.code || s.airlineCode)));
}

function matchesStops(opt, maxStops) {
  if (maxStops === null || maxStops === undefined) return true;
  const stops = opt.totalStops ?? 0;
  const segCount = opt.segments?.length ?? 1;
  if (maxStops === 0) return stops === 0 && segCount <= 1;
  return stops <= maxStops;
}

function fareAmount(fare, opt) {
  return Number(
    fare?.pricing?.totalAmount
    ?? fare?.totalAmount
    ?? opt?.displayPricing?.pricing?.totalAmount
    ?? opt?.displayPricing?.totalAmount
    ?? Infinity,
  );
}

export function pickFareSearchId(opt, { flexi = false, fareType = 'NORMAL' } = {}) {
  const fares = opt?.fares || [];
  if (!fares.length) return opt?.searchId || null;

  if (flexi) {
    const flexiFare = fares.find((f) => /flexi/i.test(String(f.fareType || '')));
    if (flexiFare?.searchId) return flexiFare.searchId;
  }

  const fareMatch = String(fareType || 'NORMAL').toUpperCase();
  const typed = fares.find((f) => normAirline(f.fareType).includes(fareMatch)
    || String(f.fareType || '').toUpperCase() === fareMatch);
  if (typed?.searchId) return typed.searchId;

  const normal = fares.find((f) => /normal/i.test(String(f.fareType || '')));
  return normal?.searchId || fares[0]?.searchId || opt?.searchId || null;
}

export function collectOptions(searchData, direction = 'ONWARD') {
  const block = (searchData?.results || []).find(
    (r) => String(r.direction).toUpperCase() === direction,
  ) || searchData?.results?.[0];
  return block?.options || [];
}

export function filterAndRankOptions(options, filters = {}) {
  const {
    airlines = [],
    maxStops = 0,
    flexi = false,
    fareType = 'NORMAL',
    flightNumber = null,
    excludeFlightNumber = null,
  } = filters;

  const matched = [];
  for (const opt of options) {
    if (!matchesAirline(opt, airlines)) continue;
    if (!matchesStops(opt, maxStops)) continue;
    if (!matchesFlightFilter(opt, flightNumber, excludeFlightNumber)) continue;

    const searchId = pickFareSearchId(opt, { flexi, fareType });
    if (!searchId) continue;

    if (flexi) {
      const hasFlexi = (opt.fares || []).some((f) => /flexi/i.test(String(f.fareType || '')));
      if (!hasFlexi) continue;
    }

    const amount = flexi
      ? fareAmount((opt.fares || []).find((f) => /flexi/i.test(String(f.fareType || ''))), opt)
      : fareAmount((opt.fares || [])[0], opt);

    matched.push({
      opt,
      searchId,
      amount,
      label: flightNumbers(opt).map((f) => f.label).join(' / '),
      stops: opt.totalStops ?? 0,
    });
  }

  matched.sort((a, b) => a.amount - b.amount);
  return matched;
}

export function pickRoundTripPairs(searchData, filters = {}) {
  const onward = filterAndRankOptions(collectOptions(searchData, 'ONWARD'), filters);
  const ret = filterAndRankOptions(collectOptions(searchData, 'RETURN'), filters);
  const pairs = [];

  for (const o of onward.slice(0, 8)) {
    for (const r of ret.slice(0, 8)) {
      if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
      pairs.push({
        searchIds: [o.searchId, r.searchId],
        total: o.amount + r.amount,
        onward: o,
        ret: r,
      });
    }
  }

  pairs.sort((a, b) => a.total - b.total);
  return pairs;
}

export async function pollSearchUntilOptions(flight, body, filters = {}, { maxPolls = 12 } = {}) {
  let lastData = null;
  for (let i = 0; i < maxPolls; i += 1) {
    const res = await flight.search(body);
    lastData = res.data;
    const options = collectOptions(lastData, 'ONWARD');
    const hits = filterAndRankOptions(options, filters);
    if (hits.length) return { response: res, data: lastData, picks: hits };
    if (isSearchProgressComplete(lastData)) break;
    const wait = lastData?.progress?.pollAfterMs || 2500;
    await new Promise((r) => setTimeout(r, wait));
  }

  const options = collectOptions(lastData, 'ONWARD');
  const picks = filterAndRankOptions(options, filters);
  return {
    response: { data: lastData },
    data: lastData,
    picks,
    searchId: picks[0]?.searchId || extractFirstSearchId(lastData),
  };
}

export async function pollRoundTripSearch(flight, body, filters = {}, { maxPolls = 15 } = {}) {
  let lastData = null;
  for (let i = 0; i < maxPolls; i += 1) {
    const res = await flight.search(body);
    lastData = res.data;
    const pairs = pickRoundTripPairs(lastData, filters);
    if (pairs.length) return { response: res, data: lastData, pairs };
    if (isSearchProgressComplete(lastData)) break;
    const wait = lastData?.progress?.pollAfterMs || 2500;
    await new Promise((r) => setTimeout(r, wait));
  }
  return { response: { data: lastData }, data: lastData, pairs: pickRoundTripPairs(lastData, filters) };
}

const DOMESTIC_IN = new Set([
  'DEL', 'BOM', 'BLR', 'MAA', 'HYD', 'CCU', 'GOI', 'PNQ', 'AMD', 'COK', 'LKO', 'JAI',
  'GAU', 'IXC', 'BBI', 'TRV', 'VNS', 'PAT', 'IDR', 'NAG', 'SXR', 'IXB', 'IXR', 'SXV',
]);

export function isInternationalRoute(origin, destination) {
  const o = String(origin || '').toUpperCase();
  const d = String(destination || '').toUpperCase();
  return !DOMESTIC_IN.has(o) || !DOMESTIC_IN.has(d);
}
