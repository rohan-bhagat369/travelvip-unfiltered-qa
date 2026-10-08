/**
 * Flight search fareTypes facet + appliedFilters.*.fareTypes (OW + RT, positive + negative).
 * Pack: spawned by SEARCH. Path: POST /v1/flights/search (not Mag catalog-v2).
 *
 *   node scripts/probe-flight-v2-faretypes-filter-canary.js
 *   INCLUDE_MAG_PATH=1  — also probe /api/flights/catalog-v2/search
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';

const SEARCH_PATH = process.env.FLIGHT_V2_SEARCH_PATH || '/v1/flights/search';
const INCLUDE_MAG_PATH = String(process.env.INCLUDE_MAG_PATH || '').trim() === '1';
const OUT = path.join('reports', process.env.FARETYPES_OUT || 'flight-search-faretypes-filter.json');

const rows = [];
const dumps = {};

function add(section, n, rule, how, status, extra = {}) {
  const st = status === 'NOT TESTED' || status === 'NOT_TESTED' ? 'NOT TESTED' : status;
  rows.push({
    tag: 'SEARCH',
    section,
    n,
    id: `${section}.${n}`,
    rule,
    how,
    expected: extra.expected || '',
    actual: extra.actual || '',
    status: st,
    payload: extra.payload || undefined,
  });
  const mark = st === 'PASS' ? 'PASS' : st === 'BUG' ? 'BUG ' : 'NT  ';
  console.log(`[${mark}] ${section}.${n} ${rule}`);
  if (extra.actual) console.log(`       ${String(extra.actual).slice(0, 240)}`);
}

function norm(s) {
  return String(s || '').trim().toUpperCase();
}

function fareTypeOf(fare) {
  return fare?.fareType || fare?.type || fare?.code || fare?.label || fare?.name || null;
}

function optionFares(opt) {
  if (Array.isArray(opt?.fares) && opt.fares.length) return opt.fares;
  if (Array.isArray(opt?.fareOptions) && opt.fareOptions.length) return opt.fareOptions;
  return opt?.fare ? [opt.fare] : [];
}

function optionPrice(opt) {
  const p = opt?.displayPricing?.pricing || opt?.displayPricing || opt?.price || opt?.pricing || {};
  const n = Number(p.totalAmount ?? p.total ?? p.totalFare ?? p.grandTotal ?? p.amount ?? opt?.totalPrice ?? opt?.totalFare);
  return Number.isFinite(n) ? n : null;
}

function farePrice(fare) {
  const p = fare?.pricing || fare?.price || fare?.displayPricing?.pricing || fare?.displayPricing || {};
  const n = Number(p.totalAmount ?? p.total ?? p.totalFare ?? p.grandTotal ?? fare?.total ?? fare?.amount);
  return Number.isFinite(n) ? n : null;
}

function resultsBlock(data, dir) {
  const want = String(dir).toUpperCase();
  if (data?.results?.[want]) return data.results[want];
  const arr = Array.isArray(data?.results) ? data.results : [];
  return arr.find((b) => String(b.direction || b.key || '').toUpperCase() === want)
    || (want === 'ONWARD' ? arr[0] : null)
    || {};
}

function optionsOf(data, dir) {
  const block = resultsBlock(data, dir);
  return block?.options || block?.flights || [];
}

function facetFareTypes(data, dir) {
  const filters = data?.filters || data?.facets || {};
  const block = filters[dir] || filters[String(dir).toLowerCase()] || {};
  const list = block.fareTypes || block.fare_types || [];
  if (Array.isArray(list)) return list;
  if (list && typeof list === 'object') {
    return Object.entries(list).map(([k, v]) => (
      typeof v === 'object' ? { fareType: k, ...v } : { fareType: k, count: v }
    ));
  }
  return [];
}

function facetLabel(item) {
  return item?.fareType || item?.type || item?.code || item?.label || item?.value || item?.key || null;
}

function otherFacets(data, dir) {
  const block = (data?.filters || {})[dir] || {};
  return {
    airlines: Boolean(block.airlines),
    stops: Boolean(block.stops),
    refundable: block.refundable != null || block.refundableOnly != null,
    priceRange: Boolean(block.priceRange || block.price),
    fareTypes: Boolean(block.fareTypes),
  };
}

function distinctFareLabels(options) {
  const set = new Set();
  for (const opt of options) {
    for (const fare of optionFares(opt)) {
      const t = fareTypeOf(fare);
      if (t) set.add(String(t));
    }
  }
  return [...set];
}

function optionHasFare(opt, wanted) {
  const want = wanted.map(norm);
  return optionFares(opt).some((f) => want.includes(norm(fareTypeOf(f))));
}

function faresOnlySelected(opt, wanted) {
  const want = wanted.map(norm);
  const fares = optionFares(opt);
  return fares.length > 0 && fares.every((f) => want.includes(norm(fareTypeOf(f))));
}

function displayMatchesSelected(opt, wanted) {
  const want = wanted.map(norm);
  const category = opt?.displayPricing?.fareCategory || opt?.displayPricing?.type;
  if (category && want.includes(norm(category))) {
    const display = optionPrice(opt);
    const selected = optionFares(opt).filter((f) => want.includes(norm(fareTypeOf(f))));
    const prices = selected.map(farePrice).filter((p) => p != null);
    if (!prices.length || display == null) return { ok: true, reason: `fareCategory=${category}` };
    const match = prices.some((p) => Math.abs(p - display) <= 2);
    return { ok: match, reason: match ? `fareCategory=${category} price match` : `fareCategory=${category} display=${display} selected=${prices.join(',')}` };
  }
  const display = optionPrice(opt);
  const selected = optionFares(opt).filter((f) => want.includes(norm(fareTypeOf(f))));
  if (display == null || !selected.length) return { ok: false, reason: 'missing displayPricing or selected fare' };
  const prices = selected.map(farePrice).filter((p) => p != null);
  if (!prices.length) return { ok: true, reason: 'selected fare has no price field' };
  const match = prices.some((p) => Math.abs(p - display) <= 2);
  return { ok: match, reason: match ? 'match' : `displayPricing=${display} selected=${prices.join(',')}` };
}

function scoreFilter(unfilteredOpts, filteredData, dir, wanted) {
  const opts = optionsOf(filteredData, dir);
  const bugs = [];
  const hadInventory = unfilteredOpts.some((o) => optionHasFare(o, wanted));
  if (!opts.length && hadInventory) bugs.push('no options after filter though unfiltered inventory had that fareType');
  for (const opt of opts) {
    const id = opt.searchId || opt.id;
    if (!optionHasFare(opt, wanted)) bugs.push(`option missing selected fareType id=${id}`);
    if (!faresOnlySelected(opt, wanted)) {
      bugs.push(`fares[] not reduced to selected type(s) id=${id} fares=${optionFares(opt).map(fareTypeOf).join(',')}`);
    }
    const priceCheck = displayMatchesSelected(opt, wanted);
    if (!priceCheck.ok) bugs.push(`displayPricing mismatch id=${id} ${priceCheck.reason}`);
  }
  return bugs;
}

function facetStillFull(unfilteredFacet, filteredFacet) {
  const a = new Set(unfilteredFacet.map(facetLabel).filter(Boolean).map(norm));
  const b = new Set(filteredFacet.map(facetLabel).filter(Boolean).map(norm));
  if (!a.size) return { ok: false, reason: 'unfiltered facet empty', unfiltered: [...a], filtered: [...b] };
  const missing = [...a].filter((x) => !b.has(x));
  return { ok: missing.length === 0, missing, unfiltered: [...a], filtered: [...b] };
}

function owBody({ origin = 'DEL', destination = 'BOM', date = '2026-09-15', appliedFilters = {}, maxStops = null } = {}) {
  return {
    itinerary: [{ origin, destination, date }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters,
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function rtBody({
  origin = 'DEL',
  destination = 'BOM',
  onwardDate = '2026-09-15',
  returnDate = '2026-09-22',
  appliedFilters = {},
  maxStops = null,
} = {}) {
  return {
    itinerary: [
      { origin, destination, date: onwardDate },
      { origin: destination, destination: origin, date: returnDate },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops, refundableOnly: false },
    appliedFilters,
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

const SEARCH_PATH_CANDIDATES = INCLUDE_MAG_PATH
  ? ['/api/flights/catalog-v2/search', '/api/v2/flights/search', '/v2/flights/search', '/v1/flights/search']
  : [SEARCH_PATH];

let resolvedPath = SEARCH_PATH;

async function search(client, body) {
  return client.request({
    method: 'POST',
    path: resolvedPath,
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' },
    body,
    correlation: true,
  });
}

async function searchUntilOptions(client, body, { max = 8, dir = 'ONWARD' } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await search(client, body);
    const n = optionsOf(last.data, dir).length;
    const done = last.data?.progress?.state === 'COMPLETE'
      || last.data?.progress?.complete === true
      || last.data?.status === 'COMPLETE';
    if (!last.ok) {
      const code = last.data?.error?.code;
      if (code === 'NO_FLIGHTS_FOUND' && i < max - 1) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      return last;
    }
    if (n > 0 || done) return last;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return last;
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;
  const summary = {
    baseUrl: process.env.BASE_URL,
    path: SEARCH_PATH,
    startedAt: new Date().toISOString(),
  };

  const owBase = owBody();
  let owRes = null;
  for (const p of SEARCH_PATH_CANDIDATES) {
    resolvedPath = p;
    owRes = await searchUntilOptions(client, owBase, { max: 2 });
    dumps.pathProbe = dumps.pathProbe || [];
    dumps.pathProbe.push({
      path: p,
      http: owRes.status,
      error: owRes.data?.error || (typeof owRes.data === 'string' ? String(owRes.data).slice(0, 120) : null),
    });
    if (owRes.status !== 404) {
      summary.path = p;
      break;
    }
  }
  if (owRes.status === 404) resolvedPath = SEARCH_PATH;
  owRes = await searchUntilOptions(client, owBase);
  const owOpts = optionsOf(owRes.data, 'ONWARD');
  const owFacet = facetFareTypes(owRes.data, 'ONWARD');
  dumps.owUnfiltered = {
    http: owRes.status,
    optionCount: owOpts.length,
    facet: owFacet,
    otherFacets: otherFacets(owRes.data, 'ONWARD'),
    sampleFares: optionFares(owOpts[0] || {}).map((f) => ({ fareType: fareTypeOf(f), price: farePrice(f) })),
    sampleDisplayPricing: owOpts[0]?.displayPricing || owOpts[0]?.price || null,
    sampleFareRaw: optionFares(owOpts[0] || {})[0] || null,
    filtersKeys: Object.keys(owRes.data?.filters || {}),
    resultsType: Array.isArray(owRes.data?.results) ? 'array' : typeof owRes.data?.results,
    error: owRes.data?.error || null,
  };

  if (INCLUDE_MAG_PATH) {
    add(
      'SETUP',
      0,
      'Optional Mag path POST /api/flights/catalog-v2/search',
      'INCLUDE_MAG_PATH=1 path probe',
      (dumps.pathProbe || []).some((p) => p.path === '/api/flights/catalog-v2/search' && p.http !== 404) ? 'PASS' : 'BUG',
      {
        expected: 'HTTP 200 (or non-404) on catalog-v2 search',
        actual: JSON.stringify(dumps.pathProbe || []),
      },
    );
  }

  add(
    'SETUP',
    1,
    'OW unfiltered search DEL→BOM',
    `POST ${summary.path} ECONOMY 1ADT NORMAL`,
    owRes.ok && owOpts.length ? 'PASS' : (owRes.data?.error?.code === 'NO_FLIGHTS_FOUND' ? 'NOT TESTED' : 'BUG'),
    { actual: `HTTP ${owRes.status} options=${owOpts.length} ${JSON.stringify(owRes.data?.error || {}).slice(0, 180)}` },
  );

  const labelsFromOptions = distinctFareLabels(owOpts);
  const labelsFromFacet = owFacet.map(facetLabel).filter(Boolean);
  const facetCoversOptions = labelsFromOptions.every((l) => labelsFromFacet.some((f) => norm(f) === norm(l)));

  add(
    'OW',
    1,
    'See the facet (no filter) — filters.ONWARD.fareTypes lists every distinct fare label with counts',
    'Unfiltered search; compare facet vs option.fares[].fareType',
    !owRes.ok || !owOpts.length ? 'NOT TESTED' : (owFacet.length && facetCoversOptions ? 'PASS' : 'BUG'),
    {
      expected: 'filters.ONWARD.fareTypes = distinct fare labels in options, with counts',
      actual: `facet=${JSON.stringify(owFacet).slice(0, 400)} optionLabels=${labelsFromOptions.join(',')}`,
    },
  );

  const of = otherFacets(owRes.data, 'ONWARD');
  add(
    'OW',
    2,
    'No filter applied → airlines/stops/refundable/price facets still present (regression)',
    'Inspect filters.ONWARD without appliedFilters',
    !owRes.ok ? 'NOT TESTED' : (of.airlines || of.stops || of.priceRange || of.refundable ? 'PASS' : 'BUG'),
    { expected: 'existing facets unchanged', actual: JSON.stringify(of) },
  );

  const typesToTry = labelsFromFacet.length ? labelsFromFacet : labelsFromOptions;
  let n = 3;
  for (const label of typesToTry) {
    const filteredBody = owBody({ appliedFilters: { ONWARD: { fareTypes: [label] } } });
    const filteredRes = await searchUntilOptions(client, filteredBody);
    const bugs = scoreFilter(owOpts, filteredRes.data, 'ONWARD', [label]);
    const filteredOpts = optionsOf(filteredRes.data, 'ONWARD');
    const facetCheck = facetStillFull(owFacet, facetFareTypes(filteredRes.data, 'ONWARD'));
    dumps[`owFilter_${label}`] = {
      http: filteredRes.status,
      requested: label,
      optionCount: filteredOpts.length,
      sampleFares: optionFares(filteredOpts[0] || {}).map(fareTypeOf),
      sampleDisplay: optionPrice(filteredOpts[0] || {}),
      facetAfter: facetFareTypes(filteredRes.data, 'ONWARD'),
      bugs,
      facetStillFull: facetCheck,
    };

    const hadInv = owOpts.some((o) => optionHasFare(o, [label]));
    add(
      'OW',
      n,
      `Positive filter fareTypes=["${label}"] — options only offer that fare; fares[] reduced; displayPricing matches`,
      `appliedFilters.ONWARD.fareTypes=["${label}"]`,
      !filteredRes.ok ? 'BUG' : (!hadInv && !filteredOpts.length ? 'NOT TESTED' : (bugs.length ? 'BUG' : 'PASS')),
      {
        expected: 'surviving options only include selected fareType; fares[] only that type; displayPricing = selected fare',
        actual: bugs.length ? bugs.slice(0, 4).join(' | ') : `HTTP ${filteredRes.status} options=${filteredOpts.length}`,
        payload: filteredBody.appliedFilters,
      },
    );
    n += 1;

    add(
      'OW',
      n,
      `After filtering ${label}, filters.ONWARD.fareTypes still shows full facet (not only selected)`,
      'Compare unfiltered vs filtered fareTypes facet',
      !filteredRes.ok ? 'NOT TESTED' : (facetCheck.ok ? 'PASS' : 'BUG'),
      { expected: 'full facet remains so client can switch without re-search', actual: JSON.stringify(facetCheck) },
    );
    n += 1;

    const lowerBody = owBody({ appliedFilters: { ONWARD: { fareTypes: [String(label).toLowerCase()] } } });
    const lowerRes = await searchUntilOptions(client, lowerBody);
    const lowerOpts = optionsOf(lowerRes.data, 'ONWARD');
    const lowerBugs = scoreFilter(owOpts, lowerRes.data, 'ONWARD', [label]);
    const upperIds = filteredOpts.map((o) => o.searchId || o.id).filter(Boolean).sort().join(',');
    const lowerIds = lowerOpts.map((o) => o.searchId || o.id).filter(Boolean).sort().join(',');
    const caseOk = filteredOpts.length === lowerOpts.length && upperIds === lowerIds && !lowerBugs.some((b) => !b.includes('displayPricing'));
    // Prefer ID set equality for case-insensitive; still fail if lower returns mismatched fare families
    const casePass = filteredOpts.length === lowerOpts.length
      && upperIds === lowerIds
      && optionsOf(lowerRes.data, 'ONWARD').every((o) => optionHasFare(o, [label]) && faresOnlySelected(o, [label]));
    add(
      'OW',
      n,
      `Case-insensitive: ["${String(label).toLowerCase()}"] same as ["${label}"]`,
      'Repeat filter with lowercase fareTypes value',
      !lowerRes.ok ? 'BUG' : (casePass ? 'PASS' : 'BUG'),
      {
        expected: 'same option set as uppercase filter',
        actual: `upper=${filteredOpts.length} lower=${lowerOpts.length} idsMatch=${upperIds === lowerIds} lowerBugs=${lowerBugs.slice(0, 2).join(';')}`,
        payload: lowerBody.appliedFilters,
      },
    );
    n += 1;
  }

  for (const bad of [[''], [' ']]) {
    const body = owBody({ appliedFilters: { ONWARD: { fareTypes: bad } } });
    const res = await searchUntilOptions(client, body);
    const opts = optionsOf(res.data, 'ONWARD');
    add(
      'OW',
      n,
      `Negative: fareTypes=${JSON.stringify(bad)} must not wipe all results (treat as no filter)`,
      `appliedFilters.ONWARD.fareTypes=${JSON.stringify(bad)}`,
      !res.ok ? 'BUG' : (opts.length > 0 || owOpts.length === 0 ? 'PASS' : 'BUG'),
      {
        expected: 'results remain (empty/blank fareTypes ignored)',
        actual: `HTTP ${res.status} options=${opts.length} unfiltered=${owOpts.length}`,
        payload: body.appliedFilters,
      },
    );
    n += 1;
  }

  {
    const body = owBody({ appliedFilters: { ONWARD: { fareTypes: ['NOT_A_REAL_FARE'] } } });
    const res = await searchUntilOptions(client, body);
    const opts = optionsOf(res.data, 'ONWARD');
    const leak = opts.filter((o) => optionFares(o).length && !optionHasFare(o, ['NOT_A_REAL_FARE']));
    add(
      'OW',
      n,
      'Negative: unknown fareTypes=["NOT_A_REAL_FARE"] should not return mismatched fares',
      'Filter a fare label that does not exist',
      !res.ok ? 'BUG' : (leak.length ? 'BUG' : 'PASS'),
      {
        expected: 'empty options OR only matching fares; never keep other fare families',
        actual: `HTTP ${res.status} options=${opts.length} mismatched=${leak.length}`,
        payload: body.appliedFilters,
      },
    );
    n += 1;
  }

  {
    const multi = owOpts.find((o) => optionFares(o).length >= 2
      && optionFares(o).every((f) => farePrice(f) != null));
    if (multi) {
      const priced = optionFares(multi)
        .map((f) => ({ t: fareTypeOf(f), p: farePrice(f) }))
        .filter((x) => x.t && x.p != null)
        .sort((a, b) => a.p - b.p);
      const cheapFare = priced[0];
      const expensiveFare = priced[priced.length - 1];
      if (expensiveFare && cheapFare && expensiveFare.p > cheapFare.p && cheapFare.p <= expensiveFare.p - 1) {
        const max = expensiveFare.p - 1;
        const body = owBody({
          appliedFilters: {
            ONWARD: { fareTypes: [expensiveFare.t], priceRange: { min: 0, max } },
          },
        });
        const res = await searchUntilOptions(client, body);
        const opts = optionsOf(res.data, 'ONWARD');
        const keptSame = opts.find((o) => (o.searchId || o.id) === (multi.searchId || multi.id));
        const status = !res.ok
          ? 'BUG'
          : (keptSame ? 'BUG' : 'PASS');
        dumps.priceRangeCombo = {
          searchId: multi.searchId || multi.id,
          cheapFare,
          expensiveFare,
          max,
          keptSame: Boolean(keptSame),
          optionCount: opts.length,
          keptSample: keptSame
            ? {
              fares: optionFares(keptSame).map(fareTypeOf),
              farePrices: optionFares(keptSame).map((f) => ({ t: fareTypeOf(f), p: farePrice(f) })),
              displayPrice: optionPrice(keptSame),
              fareCategory: keptSame?.displayPricing?.fareCategory || null,
            }
            : null,
        };
        add(
          'OW',
          n,
          `Combine fareTypes=["${expensiveFare.t}"] with priceRange.max=${max} below that fare — option excluded (not kept via cheaper ${cheapFare.t})`,
          `Option ${multi.searchId || multi.id} has ${cheapFare.t}=${cheapFare.p} and ${expensiveFare.t}=${expensiveFare.p}`,
          status,
          {
            expected: `same option excluded when filtering ${expensiveFare.t} with max below its price; cheaper ${cheapFare.t} must not keep it`,
            actual: keptSame
              ? `BUG: option still present after filter samples=${JSON.stringify(dumps.priceRangeCombo.keptSample)}`
              : `HTTP ${res.status} option excluded; remaining=${opts.length}`,
            payload: body.appliedFilters,
          },
        );
      } else {
        add('OW', n, 'Combine fareTypes + priceRange.max on multi-fare option', 'Need cheap+expensive fares on one option', 'NOT TESTED');
      }
    } else {
      add('OW', n, 'Combine fareTypes + priceRange.max on multi-fare option', 'Need option with 2+ priced fares', 'NOT TESTED');
    }
  }

  const rtBase = rtBody();
  const rtRes = await searchUntilOptions(client, rtBase);
  const rtOnward = optionsOf(rtRes.data, 'ONWARD');
  const rtReturn = optionsOf(rtRes.data, 'RETURN');
  const rtOnwardFacet = facetFareTypes(rtRes.data, 'ONWARD');
  const rtReturnFacet = facetFareTypes(rtRes.data, 'RETURN');
  dumps.rtUnfiltered = {
    http: rtRes.status,
    onward: rtOnward.length,
    ret: rtReturn.length,
    onwardFacet: rtOnwardFacet,
    returnFacet: rtReturnFacet,
    error: rtRes.data?.error || null,
  };

  add(
    'RT-DOM',
    1,
    'RT unfiltered — fareTypes facet per direction (ONWARD and RETURN)',
    'POST ROUND_TRIP BOM↔DEL',
    !rtRes.ok
      ? 'BUG'
      : ((rtOnward.length && rtReturn.length)
        ? ((rtOnwardFacet.length || rtReturnFacet.length) ? 'PASS' : 'BUG')
        : 'NOT TESTED'),
    {
      expected: 'filters.ONWARD.fareTypes and filters.RETURN.fareTypes present',
      actual: `HTTP ${rtRes.status} onwardOpts=${rtOnward.length} returnOpts=${rtReturn.length} onwardFacet=${rtOnwardFacet.map(facetLabel)} returnFacet=${rtReturnFacet.map(facetLabel)}`,
    },
  );

  const onwardPick = facetLabel(rtOnwardFacet[0]) || distinctFareLabels(rtOnward)[0];
  const returnPick = facetLabel(rtReturnFacet.find((x) => norm(facetLabel(x)) !== norm(onwardPick)))
    || facetLabel(rtReturnFacet[0])
    || distinctFareLabels(rtReturn)[0];

  if (onwardPick && returnPick && rtOnward.length && rtReturn.length) {
    const body = rtBody({
      appliedFilters: {
        ONWARD: { fareTypes: [onwardPick] },
        RETURN: { fareTypes: [returnPick] },
      },
    });
    const res = await searchUntilOptions(client, body);
    const oBugs = scoreFilter(rtOnward, res.data, 'ONWARD', [onwardPick]);
    const rBugs = scoreFilter(rtReturn, res.data, 'RETURN', [returnPick]);
    add(
      'RT-DOM',
      2,
      `Independent filters ONWARD=["${onwardPick}"] vs RETURN=["${returnPick}"]`,
      'Different fareTypes per direction on domestic RT',
      !res.ok ? 'BUG' : ((oBugs.length || rBugs.length) ? 'BUG' : 'PASS'),
      {
        expected: 'each direction filtered independently',
        actual: `onwardBugs=${oBugs.slice(0, 2).join(';')} returnBugs=${rBugs.slice(0, 2).join(';')} o=${optionsOf(res.data, 'ONWARD').length} r=${optionsOf(res.data, 'RETURN').length}`,
        payload: body.appliedFilters,
      },
    );

    const oFull = facetStillFull(rtOnwardFacet, facetFareTypes(res.data, 'ONWARD'));
    const rFull = facetStillFull(rtReturnFacet, facetFareTypes(res.data, 'RETURN'));
    add(
      'RT-DOM',
      3,
      'After RT filter, both direction facets remain full',
      'Compare unfiltered vs filtered facets',
      oFull.ok && rFull.ok ? 'PASS' : 'BUG',
      { actual: JSON.stringify({ onward: oFull, ret: rFull }) },
    );
  } else {
    add('RT-DOM', 2, 'Independent ONWARD vs RETURN fareTypes', 'Need RT inventory + two labels', 'NOT TESTED', dumps.rtUnfiltered);
    add('RT-DOM', 3, 'RT facets remain full after filter', 'Need RT inventory', 'NOT TESTED');
  }

  {
    const body = rtBody({ appliedFilters: { ONWARD: { fareTypes: [''] }, RETURN: { fareTypes: [' '] } } });
    const res = await searchUntilOptions(client, body);
    add(
      'RT-DOM',
      4,
      'Negative RT: empty/whitespace fareTypes must not wipe results',
      'ONWARD=[""] RETURN=[" "]',
      !res.ok ? 'BUG' : ((optionsOf(res.data, 'ONWARD').length || rtOnward.length === 0) ? 'PASS' : 'BUG'),
      {
        actual: `HTTP ${res.status} o=${optionsOf(res.data, 'ONWARD').length} r=${optionsOf(res.data, 'RETURN').length}`,
        payload: body.appliedFilters,
      },
    );
  }

  const intl = rtBody({ origin: 'DEL', destination: 'DXB', onwardDate: '2026-10-10', returnDate: '2026-10-17' });
  const intlRes = await searchUntilOptions(client, intl);
  const intlO = optionsOf(intlRes.data, 'ONWARD');
  const intlR = optionsOf(intlRes.data, 'RETURN');
  const intlOf = facetFareTypes(intlRes.data, 'ONWARD');
  const intlRf = facetFareTypes(intlRes.data, 'RETURN');
  dumps.intlUnfiltered = {
    http: intlRes.status,
    onward: intlO.length,
    ret: intlR.length,
    onwardFacet: intlOf,
    returnFacet: intlRf,
    error: intlRes.data?.error || null,
  };

  add(
    'RT-INTL',
    1,
    'International RT unfiltered — fareTypes facet per direction',
    'POST ROUND_TRIP BOM↔DXB',
    !intlRes.ok ? 'BUG' : (intlO.length && intlR.length ? (intlOf.length || intlRf.length ? 'PASS' : 'BUG') : 'NOT TESTED'),
    { actual: `HTTP ${intlRes.status} o=${intlO.length} r=${intlR.length} oFacet=${intlOf.map(facetLabel)} rFacet=${intlRf.map(facetLabel)}` },
  );

  const iPickO = facetLabel(intlOf[0]) || distinctFareLabels(intlO)[0];
  const iPickR = facetLabel(intlRf.find((x) => norm(facetLabel(x)) !== norm(iPickO)))
    || facetLabel(intlRf[0])
    || distinctFareLabels(intlR)[0];
  if (iPickO && iPickR && intlO.length && intlR.length) {
    const body = { ...intl, appliedFilters: { ONWARD: { fareTypes: [iPickO] }, RETURN: { fareTypes: [iPickR] } } };
    const res = await searchUntilOptions(client, body);
    const oBugs = scoreFilter(intlO, res.data, 'ONWARD', [iPickO]);
    const rBugs = scoreFilter(intlR, res.data, 'RETURN', [iPickR]);
    add(
      'RT-INTL',
      2,
      `Intl independent filters ONWARD=["${iPickO}"] RETURN=["${iPickR}"]`,
      'Different fareTypes per direction on BOM↔DXB',
      !res.ok ? 'BUG' : ((oBugs.length || rBugs.length) ? 'BUG' : 'PASS'),
      {
        actual: `oBugs=${oBugs.slice(0, 2).join(';')} rBugs=${rBugs.slice(0, 2).join(';')} o=${optionsOf(res.data, 'ONWARD').length} r=${optionsOf(res.data, 'RETURN').length}`,
        payload: body.appliedFilters,
      },
    );
  } else {
    add('RT-INTL', 2, 'Intl independent ONWARD vs RETURN fareTypes', 'Need intl RT inventory', 'NOT TESTED', dumps.intlUnfiltered);
  }

  const counts = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED' || r.status === 'NOT_TESTED').length,
  };
  const report = { summary, counts, rows, dumps, finishedAt: new Date().toISOString() };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSaved', OUT, counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
