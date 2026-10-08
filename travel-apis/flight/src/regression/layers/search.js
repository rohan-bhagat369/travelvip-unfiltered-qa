import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../../../hotel/regression/spawnProbe.js';
import { row, errCode, brief } from '../../../hotel/regression/report.js';
import { noteCall } from '../session.js';
import {
  analyzeFlightOptions,
  buildOneWaySearchBody,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../../helpers.js';
import { sleep, futureDate } from '../../../../../shared/lib/testUtils.js';

async function pollSearch(flight, body, max = 6) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const n = (last.data?.results || []).reduce((c, b) => c + (b.options?.length || 0), 0);
    if (!last.ok || errCode(last) === 'VALIDATION_ERROR' || n > 0 || isSearchProgressComplete(last.data)) {
      return last;
    }
    await sleep(2500);
  }
  return last;
}

export async function runSearch(ctx, cwd) {
  const rows = [];

  const dateOut = process.env.FLIGHT_DATE_OUT || 'flight-regression-dates.json';
  await spawnNode('travel-apis/flight/scripts/probe-flight-date-format-yyyy-mm-dd.js', {
    FLIGHT_DATE_OUT: dateOut,
  }, { cwd });
  const dateRows = mergeRowsFromReport(path.join(cwd, 'reports', dateOut), 'SEARCH');
  if (dateRows.length) rows.push(...dateRows);
  else {
    rows.push(row('SEARCH', 'dates', 1, 'Date format probe', 'probe-flight-date-format-yyyy-mm-dd.js', 'JSON rows', 'missing report', 'BUG'));
  }

  const fareOut = process.env.FARETYPES_OUT || 'flight-search-faretypes-filter.json';
  await spawnNode('travel-apis/flight/scripts/probe-flight-v2-faretypes-filter-canary.js', {
    FARETYPES_OUT: fareOut,
  }, { cwd });
  const fareRows = mergeRowsFromReport(path.join(cwd, 'reports', fareOut), 'SEARCH');
  if (fareRows.length) rows.push(...fareRows);
  else {
    rows.push(row('SEARCH', 'fareTypes', 1, 'fareTypes facet/filter probe', 'probe-flight-v2-faretypes-filter-canary.js', 'JSON rows', 'missing report', 'BUG'));
  }

  const odOut = process.env.FLIGHT_RT_OD_OUT || 'flight-regression-rt-od.json';
  await spawnNode('travel-apis/flight/scripts/probe-flight-rt-od-validations.js', {
    FLIGHT_RT_OD_OUT: odOut,
  }, { cwd });
  const odRows = mergeRowsFromReport(path.join(cwd, 'reports', odOut), 'SEARCH');
  if (odRows.length) rows.push(...odRows);
  else {
    rows.push(row('SEARCH', 'od', 1, 'RT O&D probe', 'probe-flight-rt-od-validations.js', 'JSON rows', 'missing report', 'BUG'));
  }

  const { flight } = ctx;
  const connectingBody = buildOneWaySearchBody(45, { origin: 'DEL', destination: 'GOI', maxStops: 1, fareType: 'NORMAL' });
  const connecting = await pollSearch(flight, connectingBody);
  noteCall(ctx, 'search-connecting', '/v1/flights/search', connecting);
  const classified = analyzeFlightOptions(connecting.data);
  rows.push(row(
    'SEARCH', 'stops', 1, 'Connecting 1-stop inventory exists',
    'OW DEL→GOI maxStops=1',
    'connectingCount > 0 or documented empty',
    `HTTP ${connecting.status} total=${classified.total} connecting=${classified.connectingCount} nonStop=${classified.nonStopCount}`,
    connecting.ok && classified.connectingCount > 0 ? 'PASS' : (connecting.ok ? 'NOT TESTED' : 'BUG'),
  ));
  ctx.connectingSearch = classified;

  const directBody = buildOneWaySearchBody(46, { origin: 'DEL', destination: 'BOM', maxStops: 0, fareType: 'NORMAL' });
  const direct = await pollSearch(flight, directBody);
  noteCall(ctx, 'search-direct', '/v1/flights/search', direct);
  const directCl = analyzeFlightOptions(direct.data);
  const allDirect = directCl.total > 0 && directCl.connectingCount === 0;
  rows.push(row(
    'SEARCH', 'stops', 2, 'Direct maxStops=0',
    'OW DEL→BOM maxStops=0',
    'options with 0 stops (or empty)',
    `HTTP ${direct.status} total=${directCl.total} connecting=${directCl.connectingCount}`,
    direct.ok && allDirect ? 'PASS' : (direct.ok && directCl.total === 0 ? 'NOT TESTED' : (direct.ok ? 'BUG' : 'BUG')),
  ));

  const sameOd = buildOneWaySearchBody(47, { origin: 'DEL', destination: 'DEL', fareType: 'NORMAL' });
  const same = await flight.search(sameOd);
  noteCall(ctx, 'search-same-od', '/v1/flights/search', same);
  const sameReject = same.status === 400 || errCode(same) === 'VALIDATION_ERROR' || !same.ok;
  rows.push(row(
    'SEARCH', 'od', 2, 'Same origin/dest OW rejected',
    'DEL-DEL',
    '400 VALIDATION_ERROR',
    `HTTP ${same.status} code=${errCode(same)} ${brief(same.data, 160)}`,
    sameReject ? 'PASS' : 'BUG',
  ));

  const emptyArr = buildOneWaySearchBody(48, { origin: 'BOM', destination: 'DEL', fareType: 'NORMAL' });
  emptyArr.preferences = { airlines: [''], maxStops: null, refundableOnly: false };
  const emptyAir = await flight.search(emptyArr);
  noteCall(ctx, 'search-empty-airline', '/v1/flights/search', emptyAir);
  rows.push(row(
    'SEARCH', 'pref', 1, 'preferences.airlines=[""]',
    'OW BOM→DEL',
    '400 or ignore (not 500)',
    `HTTP ${emptyAir.status} code=${errCode(emptyAir)}`,
    emptyAir.status !== 500 && emptyAir.status !== 0 ? 'PASS' : 'BUG',
  ));

  const cabins = ['ECONOMY', 'BUSINESS'];
  for (const cabin of cabins) {
    const body = buildOneWaySearchBody(49, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.cabinClass = cabin;
    const res = await pollSearch(flight, body, 4);
    noteCall(ctx, `search-cabin-${cabin}`, '/v1/flights/search', res);
    const opts = res.data?.results?.[0]?.options || [];
    const segs = opts.flatMap((o) => o.segments || []);
    const mismatch = segs.filter((s) => String(s.cabinClass || '').toUpperCase().replace(/\s+/g, '_') !== cabin);
    const searchId = extractFirstSearchId(res.data);
    rows.push(row(
      'SEARCH', 'cabin', cabin === 'ECONOMY' ? 1 : 2, `POST /v1/flights/search — cabinClass=${cabin}`,
      `OW DEL→BOM cabinClass=${cabin}`,
      cabin === 'ECONOMY' ? 'HTTP 200 segments ECONOMY (or empty)' : 'matching cabin, empty inventory, or documented NO_FLIGHTS (not 500)',
      `HTTP ${res.status} options=${opts.length} mismatches=${mismatch.length} searchId=${searchId} code=${errCode(res)}`,
      res.status >= 500 ? 'BUG' : (!res.ok && errCode(res) === 'NO_FLIGHTS_FOUND' && cabin !== 'ECONOMY'
        ? 'BUG'
        : (!res.ok ? 'BUG' : (opts.length === 0 || mismatch.length === 0 ? 'PASS' : 'BUG'))),
    ));
  }

  for (const cabin of ['PREMIUM_ECONOMY', 'FIRST']) {
    const body = buildOneWaySearchBody(49, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.cabinClass = cabin;
    const res = await pollSearch(flight, body, 4);
    noteCall(ctx, `search-cabin-${cabin}`, '/v1/flights/search', res);
    rows.push(row(
      'SEARCH', 'cabin', cabin === 'PREMIUM_ECONOMY' ? 3 : 4, `POST /v1/flights/search — cabinClass=${cabin}`,
      `OW DEL→BOM cabinClass=${cabin}`,
      'HTTP 200 inventory, empty, or 4xx NO_FLIGHTS_FOUND — never 500',
      `HTTP ${res.status} options=${(res.data?.results?.[0]?.options || []).length} code=${errCode(res)}`,
      (res.status || 0) >= 500 ? 'BUG' : ((res.ok || res.status === 400) ? 'PASS' : 'BUG'),
    ));
  }

  const airBody = buildOneWaySearchBody(46, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
  airBody.preferences = { airlines: ['SG'], maxStops: null, refundableOnly: false };
  const airRes = await pollSearch(flight, airBody);
  noteCall(ctx, 'search-airline-SG', '/v1/flights/search', airRes);
  const airOpts = (airRes.data?.results || []).flatMap((b) => b.options || []);
  const airOk = airOpts.filter((o) => {
    const codes = [
      o.validatingAirline,
      o.airline?.code,
      ...(o.segments || []).map((s) => s.airline?.code),
    ].map((c) => String(c || '').toUpperCase());
    return codes.some((c) => c === 'SG');
  });
  const airMismatch = airOpts.length && airOk.length !== airOpts.length;
  rows.push(row(
    'SEARCH', 'pref', 2, 'POST /v1/flights/search — preferences.airlines=["SG"]',
    'OW DEL→BOM airlines=[SG]',
    'HTTP 200; empty or every option is SG (never 500)',
    `HTTP ${airRes.status} options=${airOpts.length} sg=${airOk.length} code=${errCode(airRes)}`,
    (airRes.status || 0) >= 500 ? 'BUG' : (airRes.ok && !airMismatch ? 'PASS' : (airRes.ok ? 'BUG' : 'BUG')),
  ));

  const refBody = buildOneWaySearchBody(46, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
  refBody.preferences = { airlines: [], maxStops: null, refundableOnly: true };
  const refRes = await pollSearch(flight, refBody);
  noteCall(ctx, 'search-refundable', '/v1/flights/search', refRes);
  rows.push(row(
    'SEARCH', 'pref', 3, 'POST /v1/flights/search — preferences.refundableOnly=true',
    'OW DEL→BOM refundableOnly=true',
    'HTTP 200 inventory or empty (never 500)',
    `HTTP ${refRes.status} options=${(refRes.data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0)} code=${errCode(refRes)}`,
    (refRes.status || 0) >= 500 ? 'BUG' : (refRes.ok || refRes.status === 400 ? 'PASS' : 'BUG'),
  ));

  const corpBody = buildOneWaySearchBody(46, { origin: 'DEL', destination: 'BOM', fareType: 'CORPORATE' });
  const corpRes = await pollSearch(flight, corpBody);
  noteCall(ctx, 'search-corporate', '/v1/flights/search', corpRes);
  rows.push(row(
    'SEARCH', 'fare', 1, 'POST /v1/flights/search — fareType=CORPORATE',
    'OW DEL→BOM fareType=CORPORATE',
    'HTTP 200 (inventory or empty) or 4xx — never 500',
    `HTTP ${corpRes.status} options=${(corpRes.data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0)} code=${errCode(corpRes)}`,
    (corpRes.status || 0) >= 500 ? 'BUG' : (corpRes.ok || corpRes.status === 400 ? 'PASS' : 'BUG'),
  ));

  const mcBody = {
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: futureDate(50) },
      { origin: 'BOM', destination: 'BLR', date: futureDate(53) },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'MULTI_CITY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
  const mcRes = await pollSearch(flight, mcBody, 4);
  noteCall(ctx, 'search-multicity', '/v1/flights/search', mcRes);
  rows.push(row(
    'SEARCH', 'mc', 1, 'POST /v1/flights/search — journeyType=MULTI_CITY',
    'DEL→BOM then BOM→BLR MULTI_CITY',
    'HTTP 200 inventory/empty or 4xx VALIDATION — never 500',
    `HTTP ${mcRes.status} code=${errCode(mcRes)} ${brief(mcRes.data, 140)}`,
    (mcRes.status || 0) >= 500 ? 'BUG' : (mcRes.status >= 400 || mcRes.ok ? 'PASS' : 'BUG'),
  ));

  return rows;
}
