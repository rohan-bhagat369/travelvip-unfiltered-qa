/**
 * api-staging: booking flow after Mag fareTypes filter.
 * OW + RT domestic (same / different) + two intl RT (different fareTypes).
 * Negatives must not produce a BR.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'
 *   node scripts/probe-flight-faretypes-book-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildIssueTicketPayload } from '../src/helpers.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { GST } from '../../hotel/src/regression/fixtures.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const SEARCH_PATH = '/v1/flights/search';
const OUT = path.join('reports', 'flight-faretypes-book-staging.json');
const rows = [];
const books = [];

function add(section, n, rule, how, status, extra = {}) {
  rows.push({
    tag: 'FARETYPES-BOOK',
    section,
    n,
    id: `${section}.${n}`,
    rule,
    how,
    expected: extra.expected || '',
    actual: extra.actual || '',
    status,
    payload: extra.payload,
    bookingReference: extra.bookingReference,
  });
  const mark = status === 'PASS' ? 'PASS' : status === 'BUG' ? 'BUG ' : 'NT  ';
  console.log(`[${mark}] ${section}.${n} ${rule}`);
  if (extra.actual) console.log(`       ${String(extra.actual).slice(0, 280)}`);
}

function norm(s) {
  return String(s || '').trim().toUpperCase();
}

function resultBlock(data, dir) {
  const want = String(dir).toUpperCase();
  const arr = Array.isArray(data?.results) ? data.results : [];
  return arr.find((b) => String(b.direction || b.key || '').toUpperCase() === want)
    || (want === 'ONWARD' ? arr[0] : null)
    || {};
}

function optionsOf(data, dir) {
  const block = resultBlock(data, dir);
  return block?.options || block?.flights || [];
}

function facetFareTypes(data, dir) {
  const filters = data?.filters || {};
  const block = filters[dir] || filters[String(dir).toLowerCase()] || {};
  const list = block.fareTypes || [];
  return Array.isArray(list) ? list : [];
}

function facetLabel(item) {
  return item?.fareType || item?.type || item?.code || item?.label || item?.value || null;
}

function fareTypeOf(fare) {
  return fare?.fareType || fare?.type || fare?.fareName || fare?.brandName || fare?.code || null;
}

function optionFares(opt) {
  if (Array.isArray(opt?.fares) && opt.fares.length) return opt.fares;
  if (opt?.fare) return [opt.fare];
  return [];
}

function farePrice(fare) {
  const n = Number(fare?.pricing?.totalAmount ?? fare?.totalAmount ?? fare?.price?.totalAmount);
  return Number.isFinite(n) ? n : null;
}

function optionPrice(opt) {
  const n = Number(
    opt?.displayPricing?.pricing?.totalAmount
    ?? opt?.displayPricing?.totalAmount
    ?? opt?.fare?.pricing?.totalAmount
    ?? opt?.pricing?.totalAmount,
  );
  return Number.isFinite(n) ? n : null;
}

function pickCheapest(opts, wantedLabel) {
  let best = null;
  for (const opt of opts) {
    const fares = optionFares(opt);
    const wanted = fares.filter((f) => !wantedLabel || norm(fareTypeOf(f)) === norm(wantedLabel));
    const pool = wanted.length ? wanted : (wantedLabel && fares.length ? [] : fares);
    if (pool.length) {
      for (const fare of pool) {
        const price = farePrice(fare) ?? optionPrice(opt) ?? Infinity;
        const searchId = fare.searchId || opt.searchId;
        if (!searchId) continue;
        if (!best || price < best.price) {
          best = {
            searchId,
            price,
            fareType: fareTypeOf(fare),
            flights: (opt.segments || []).map((s) => `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber || ''}`.trim()),
          };
        }
      }
    } else if (!wantedLabel && opt.searchId) {
      const price = optionPrice(opt) ?? Infinity;
      if (!best || price < best.price) {
        best = {
          searchId: opt.searchId,
          price,
          fareType: fareTypeOf(opt.fare) || opt.displayPricing?.fareCategory,
          flights: (opt.segments || []).map((s) => `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber || ''}`.trim()),
        };
      }
    }
  }
  return best;
}

function twoDistinctLabels(facet) {
  const labels = facet.map(facetLabel).filter(Boolean);
  const uniq = [];
  for (const l of labels) {
    if (!uniq.some((u) => norm(u) === norm(l))) uniq.push(l);
  }
  return uniq;
}

function owBody({ origin, destination, date, appliedFilters = {} }) {
  return {
    itinerary: [{ origin, destination, date }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters,
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function rtBody({ origin, destination, onwardDate, returnDate, appliedFilters = {} }) {
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
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters,
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function classifyStatus(raw) {
  const s = String(raw || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

function uniqueEmail() {
  return `faretypes.book.${uniqueTag()}@travelvip.ai`;
}

function applyGst(payload, pricingData) {
  if (pricingData?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };
    return;
  }
  payload.data.includeGst = false;
  payload.data.addGstInfo = false;
  payload.data.gstDetails = null;
}

function itineraryFareTypes(detail) {
  const it = detail?.bookingResponse?.itinerary || detail?.itinerary || [];
  return it.map((leg) => ({
    direction: leg.direction || leg.journeyType,
    fareType: leg.fareType || leg.fare?.fareType || leg.selectedFare?.fareType || null,
    pnr: leg.pnr || null,
  }));
}

async function searchUntil(client, body, dir = 'ONWARD') {
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    last = await client.request({
      method: 'POST',
      path: SEARCH_PATH,
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' },
      body,
      correlation: true,
    });
    const n = optionsOf(last.data, dir).length;
    const done = last.data?.progress?.state === 'COMPLETE'
      || last.data?.progress?.complete === true;
    if (!last.ok) {
      if (last.data?.error?.code === 'NO_FLIGHTS_FOUND' && i < 9) {
        await sleep(2500);
        continue;
      }
      return last;
    }
    if (n > 0 || done) return last;
    await sleep(2500);
  }
  return last;
}

async function pollSettled(flight, br) {
  let last = { status: '', classified: 'Pending' };
  for (let i = 0; i < 24; i += 1) {
    const st = await flight.getBookingStatus(br);
    const raw = String(st.data?.status || '');
    last = { status: raw, classified: classifyStatus(raw), http: st.status };
    console.log(`         status ${i + 1} ${last.classified} (${raw || 'empty'})`);
    if (['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(last.classified)) return last;
    await sleep(3000);
  }
  return last;
}

async function hopAndBook(flight, {
  searchIds,
  journeyType,
  intl,
  nameLag,
  selected,
}) {
  const details = await flight.getDetails(searchIds, journeyType);
  const rules = await flight.getFareRules(searchIds, journeyType);
  const pricing = await flight.getPricing(searchIds, journeyType);
  const hop = {
    detailsHttp: details.status,
    detailsOk: details.ok,
    rulesHttp: rules.status,
    pricingHttp: pricing.status,
    pricingOk: Boolean(pricing.ok && pricing.data?.priceId && pricing.data?.bookingContext),
    priceId: pricing.data?.priceId || null,
    detailsCode: details.data?.error?.code || null,
    pricingCode: pricing.data?.error?.code || null,
    detailsError: details.data?.error || details.data?.message || null,
    pricingError: pricing.data?.error || pricing.data?.message || null,
    searchIds,
    selected,
  };
  if (!hop.pricingOk) {
    return { hop, issue: null, br: null, settled: null, details, pricing };
  }

  const passengers = buildPassengers({
    adults: 1,
    uniqueNames: true,
    nameIndex: nameLag,
    withPassport: intl,
  });
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds,
    journeyType,
  });
  payload.data.passengers = passengers;
  payload.data.contact.email = uniqueEmail();
  payload.data.passportType = intl
    ? (pricing.data.passportType && pricing.data.passportType !== 'NONE'
      ? pricing.data.passportType
      : 'MINI')
    : (pricing.data.passportType || 'NONE');
  applyGst(payload, pricing.data);

  const issue = await flight.issueTicketV2(payload);
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
  hop.issueHttp = issue.status;
  hop.issueOk = issue.ok;
  hop.issueCode = issue.data?.error?.code || null;
  hop.detailsError = details.data?.error || details.data?.message || null;
  hop.pricingError = pricing.data?.error || pricing.data?.message || null;
  hop.bookingReference = br;

  let settled = null;
  let detail = null;
  if (br) {
    settled = await pollSettled(flight, br);
    detail = await flight.getBookingDetail(br);
    hop.bookingFareTypes = itineraryFareTypes(detail.data);
    hop.bookingStatus = settled.classified;
  }
  return { hop, issue, br, settled, details, pricing, detail };
}

async function bookScenario(client, flight, spec) {
  const attempts = [];
  const dateSets = [
    { onward: spec.onwardDate, ret: spec.returnDate },
    { onward: addDays(spec.onwardDate, 7), ret: spec.returnDate ? addDays(spec.returnDate, 7) : null },
  ];

  for (let i = 0; i < dateSets.length; i += 1) {
    const dates = dateSets[i];
    const appliedFilters = spec.appliedFilters;
    const body = spec.journeyType === 'ROUND_TRIP'
      ? rtBody({
        origin: spec.origin,
        destination: spec.destination,
        onwardDate: dates.onward,
        returnDate: dates.ret,
        appliedFilters,
      })
      : owBody({
        origin: spec.origin,
        destination: spec.destination,
        date: dates.onward,
        appliedFilters,
      });

    let search = await searchUntil(client, body, 'ONWARD');
    let onwardOpts = optionsOf(search.data, 'ONWARD');
    let returnOpts = spec.journeyType === 'ROUND_TRIP' ? optionsOf(search.data, 'RETURN') : [];
    const onwardPick = pickCheapest(onwardOpts, spec.onwardFare);
    let returnPick = spec.journeyType === 'ROUND_TRIP' ? pickCheapest(returnOpts, spec.returnFare) : null;

    if (spec.journeyType === 'ROUND_TRIP' && onwardPick?.searchId && !returnPick?.searchId) {
      const refined = {
        ...body,
        selection: { selectedSearchIds: [onwardPick.searchId] },
      };
      search = await searchUntil(client, refined, 'RETURN');
      onwardOpts = optionsOf(search.data, 'ONWARD').length ? optionsOf(search.data, 'ONWARD') : onwardOpts;
      returnOpts = optionsOf(search.data, 'RETURN');
      returnPick = pickCheapest(returnOpts, spec.returnFare);
    }

    const searchIds = spec.journeyType === 'ROUND_TRIP'
      ? [onwardPick?.searchId, returnPick?.searchId].filter(Boolean)
      : (onwardPick?.searchId ? [onwardPick.searchId] : []);

    const attempt = {
      dates,
      searchHttp: search.status,
      onwardCount: onwardOpts.length,
      returnCount: returnOpts.length,
      onwardPick,
      returnPick,
      searchIds,
    };

    if (spec.journeyType === 'ROUND_TRIP' && searchIds.length < 2) {
      attempts.push({ ...attempt, skip: 'no RT pair after fareTypes filter' });
      continue;
    }
    if (spec.journeyType === 'ONE_WAY' && searchIds.length < 1) {
      attempts.push({ ...attempt, skip: 'no OW option after fareTypes filter' });
      continue;
    }

    const booked = await hopAndBook(flight, {
      searchIds,
      journeyType: spec.journeyType,
      intl: spec.intl,
      nameLag: spec.nameLag + i * 3,
      selected: { onward: onwardPick, ret: returnPick },
    });
    attempts.push({ ...attempt, ...booked.hop, settled: booked.settled, br: booked.br });

    if (booked.settled?.classified === 'Inprogress') {
      console.log('         Inprogress — leave BR, retry with new names + dates');
      continue;
    }
    return { attempts, final: attempts[attempts.length - 1] };
  }
  return { attempts, final: attempts[attempts.length - 1] || null };
}

function bookStatus(final) {
  if (!final) return 'NOT TESTED';
  if (final.skip) return 'NOT TESTED';
  if (final.detailsHttp >= 500 || final.pricingHttp >= 500 || final.issueHttp >= 500) return 'BUG';
  if (!final.pricingOk) return 'BUG';
  if (!final.br) return 'BUG';
  if (final.bookingStatus === 'Failed') return 'BUG';
  if (final.bookingStatus === 'Confirmed' || final.bookingStatus === 'Inprogress' || final.bookingStatus === 'Cancelled') {
    return 'PASS';
  }
  return 'BUG';
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const skipOw = String(process.env.SKIP_OW || '') === '1';
  const skipNeg = String(process.env.SKIP_NEG || '') === '1';
  const owDate = '2026-09-20';
  const rtOnward = '2026-09-20';
  const rtReturn = '2026-09-27';

  // --- discover labels ---
  const owDisc = await searchUntil(client, owBody({ origin: 'DEL', destination: 'BOM', date: owDate }));
  const owLabels = twoDistinctLabels(facetFareTypes(owDisc.data, 'ONWARD'));
  const owA = owLabels[0] || 'Normal';
  const owB = owLabels.find((l) => norm(l) !== norm(owA)) || owLabels[1] || 'Flexi';

  const rtDomDisc = await searchUntil(client, rtBody({
    origin: 'DEL', destination: 'BOM', onwardDate: rtOnward, returnDate: rtReturn,
  }));
  const domOnwardLabels = twoDistinctLabels(facetFareTypes(rtDomDisc.data, 'ONWARD'));
  const domReturnLabels = twoDistinctLabels(facetFareTypes(rtDomDisc.data, 'RETURN'));
  const domSame = domOnwardLabels[0] || owA;
  const domRetOther = domReturnLabels.find((l) => norm(l) !== norm(domSame)) || domReturnLabels[1] || owB;

  const rtIntlDisc = await searchUntil(client, rtBody({
    origin: 'BOM', destination: 'DXB', onwardDate: rtOnward, returnDate: rtReturn,
  }));
  const intlO = twoDistinctLabels(facetFareTypes(rtIntlDisc.data, 'ONWARD'));
  const intlR = twoDistinctLabels(facetFareTypes(rtIntlDisc.data, 'RETURN'));
  const intlA = intlO[0] || 'Economy Saver';
  const intlB = intlR.find((l) => norm(l) !== norm(intlA)) || intlR[1] || intlO[1] || 'NDC:-Economy Saver';
  const intlC = intlO.find((l) => norm(l) !== norm(intlA)) || intlO[1] || intlA;
  const intlD = intlR.find((l) => norm(l) !== norm(intlB) && norm(l) !== norm(intlC)) || intlR[0] || intlB;

  console.log('Discovered OW labels', owLabels);
  console.log('Discovered RT DOM ONWARD', domOnwardLabels, 'RETURN', domReturnLabels);
  console.log('Discovered RT INTL ONWARD', intlO, 'RETURN', intlR);

  // --- NEGATIVES (must not book) ---
  if (!skipNeg) {
  const negOw = await searchUntil(client, owBody({
    origin: 'DEL',
    destination: 'BOM',
    date: owDate,
    appliedFilters: { ONWARD: { fareTypes: ['NOT_A_REAL_FARE'] } },
  }));
  const negOwOpts = optionsOf(negOw.data, 'ONWARD');
  const negMismatched = negOwOpts.filter((o) => !optionFares(o).every((f) => norm(fareTypeOf(f)) === 'NOT_A_REAL_FARE'));
  add(
    'NEG',
    1,
    'OW unknown fareTypes=["NOT_A_REAL_FARE"] must not yield a bookable mismatched option',
    'POST /v1/flights/search DEL→BOM appliedFilters.ONWARD.fareTypes=["NOT_A_REAL_FARE"]',
    !negOw.ok && negOw.status >= 500 ? 'BUG'
      : (negOwOpts.length === 0 || negMismatched.length === 0 ? 'PASS' : 'BUG'),
    {
      expected: 'empty options or only that fake fare; no BR',
      actual: `HTTP ${negOw.status} options=${negOwOpts.length} mismatched=${negMismatched.length} code=${negOw.data?.error?.code || ''}`,
      payload: { ONWARD: { fareTypes: ['NOT_A_REAL_FARE'] } },
    },
  );

  const negRt = await searchUntil(client, rtBody({
    origin: 'DEL',
    destination: 'BOM',
    onwardDate: rtOnward,
    returnDate: rtReturn,
    appliedFilters: {
      ONWARD: { fareTypes: [domSame] },
      RETURN: { fareTypes: ['NOT_A_REAL_FARE'] },
    },
  }));
  const negRtRet = optionsOf(negRt.data, 'RETURN');
  const negRtOn = optionsOf(negRt.data, 'ONWARD');
  add(
    'NEG',
    2,
    'RT domestic RETURN unknown fareTypes cannot complete a pair (no book)',
    `ONWARD=["${domSame}"] RETURN=["NOT_A_REAL_FARE"]`,
    !negRt.ok && negRt.status >= 500 ? 'BUG'
      : (negRtRet.length === 0 ? 'PASS' : (negRtRet.every((o) => optionFares(o).every((f) => norm(fareTypeOf(f)) === 'NOT_A_REAL_FARE')) ? 'PASS' : 'BUG')),
    {
      expected: 'RETURN empty (or only fake fare) so RT book cannot proceed',
      actual: `HTTP ${negRt.status} onward=${negRtOn.length} return=${negRtRet.length}`,
      payload: { ONWARD: { fareTypes: [domSame] }, RETURN: { fareTypes: ['NOT_A_REAL_FARE'] } },
    },
  );

  const negIntl = await searchUntil(client, rtBody({
    origin: 'BOM',
    destination: 'DXB',
    onwardDate: rtOnward,
    returnDate: rtReturn,
    appliedFilters: {
      ONWARD: { fareTypes: ['NOT_A_REAL_FARE'] },
      RETURN: { fareTypes: ['NOT_A_REAL_FARE'] },
    },
  }));
  add(
    'NEG',
    3,
    'RT intl both directions unknown fareTypes — no bookable pair',
    'BOM↔DXB fareTypes=["NOT_A_REAL_FARE"] both ways',
    !negIntl.ok && negIntl.status >= 500 ? 'BUG'
      : ((optionsOf(negIntl.data, 'ONWARD').length === 0 || optionsOf(negIntl.data, 'RETURN').length === 0) ? 'PASS' : 'BUG'),
    {
      expected: 'no RT pair',
      actual: `HTTP ${negIntl.status} o=${optionsOf(negIntl.data, 'ONWARD').length} r=${optionsOf(negIntl.data, 'RETURN').length}`,
    },
  );

  if (negOwOpts.length) {
    const badId = pickCheapest(negOwOpts)?.searchId;
    if (badId) {
      const det = await flight.getDetails([badId], 'ONE_WAY');
      add(
        'NEG',
        4,
        'Details on unknown-fare leftover option must not 500',
        `POST /v1/flights/details searchIds=[${badId}]`,
        det.status >= 500 ? 'BUG' : 'PASS',
        { actual: `HTTP ${det.status} code=${det.data?.error?.code || ''}` },
      );
    }
  } else {
    add('NEG', 4, 'Details on unknown-fare leftover option must not 500', 'No leftover options', 'NOT TESTED');
  }
  }

  // --- POSITIVE BOOKS ---
  const allScenarios = [
    {
      id: 'OW-SAME',
      section: 'OW',
      n: 1,
      rule: `OW domestic book with fareTypes=["${owA}"]`,
      origin: 'DEL',
      destination: 'BOM',
      journeyType: 'ONE_WAY',
      intl: false,
      onwardDate: owDate,
      onwardFare: owA,
      appliedFilters: { ONWARD: { fareTypes: [owA] } },
      nameLag: 1,
    },
    {
      id: 'OW-OTHER',
      section: 'OW',
      n: 2,
      rule: `OW domestic book with a different fareTypes=["${owB}"]`,
      origin: 'DEL',
      destination: 'BOM',
      journeyType: 'ONE_WAY',
      intl: false,
      onwardDate: owDate,
      onwardFare: owB,
      appliedFilters: { ONWARD: { fareTypes: [owB] } },
      nameLag: 2,
    },
    {
      id: 'RT-DOM-SAME',
      section: 'RT-DOM',
      n: 1,
      rule: `RT domestic same fare both legs ["${domSame}"] / ["${domSame}"]`,
      origin: 'DEL',
      destination: 'BOM',
      journeyType: 'ROUND_TRIP',
      intl: false,
      onwardDate: rtOnward,
      returnDate: rtReturn,
      onwardFare: domSame,
      returnFare: domSame,
      appliedFilters: {
        ONWARD: { fareTypes: [domSame] },
        RETURN: { fareTypes: [domSame] },
      },
      nameLag: 3,
    },
    {
      id: 'RT-DOM-DIFF',
      section: 'RT-DOM',
      n: 2,
      rule: `RT domestic different fareTypes ONWARD=["${domSame}"] RETURN=["${domRetOther}"]`,
      origin: 'DEL',
      destination: 'BOM',
      journeyType: 'ROUND_TRIP',
      intl: false,
      onwardDate: rtOnward,
      returnDate: rtReturn,
      onwardFare: domSame,
      returnFare: domRetOther,
      appliedFilters: {
        ONWARD: { fareTypes: [domSame] },
        RETURN: { fareTypes: [domRetOther] },
      },
      nameLag: 4,
    },
    {
      id: 'RT-INTL-DIFF-1',
      section: 'RT-INTL',
      n: 1,
      rule: `Intl RT #1 different fareTypes ONWARD=["${intlA}"] RETURN=["${intlB}"] BOM↔DXB`,
      origin: 'BOM',
      destination: 'DXB',
      journeyType: 'ROUND_TRIP',
      intl: true,
      onwardDate: rtOnward,
      returnDate: rtReturn,
      onwardFare: intlA,
      returnFare: intlB,
      appliedFilters: {
        ONWARD: { fareTypes: [intlA] },
        RETURN: { fareTypes: [intlB] },
      },
      nameLag: 5,
    },
    {
      id: 'RT-INTL-DIFF-2',
      section: 'RT-INTL',
      n: 2,
      rule: `Intl RT #2 different fareTypes ONWARD=["${intlC}"] RETURN=["${intlD}"] BOM↔DXB`,
      origin: 'BOM',
      destination: 'DXB',
      journeyType: 'ROUND_TRIP',
      intl: true,
      onwardDate: addDays(rtOnward, 3),
      returnDate: addDays(rtReturn, 3),
      onwardFare: intlC,
      returnFare: intlD,
      appliedFilters: {
        ONWARD: { fareTypes: [intlC] },
        RETURN: { fareTypes: [intlD] },
      },
      nameLag: 6,
    },
  ];

  const scenarios = skipOw ? allScenarios.filter((s) => s.section !== 'OW') : allScenarios;
  for (const spec of scenarios) {
    console.log(`\n=== ${spec.id} ${spec.rule}`);
    const result = await bookScenario(client, flight, spec);
    const final = result.final;
    const status = bookStatus(final);
    const how = `search fareTypes filter → details → pricing → POST /api/v2/flights/booking/issue-ticket`;
    const actual = !final
      ? 'no attempt'
      : (final.skip
        ? final.skip
        : `searchIds=${(final.searchIds || []).join(',')} details=${final.detailsHttp} ${final.detailsCode || JSON.stringify(final.detailsError || '').slice(0, 120)} pricing=${final.pricingHttp} ${final.pricingCode || ''} issue=${final.issueHttp} BR=${final.br || '-'} status=${final.bookingStatus || '-'} selected=${final.selected?.onward?.fareType || spec.onwardFare}${spec.returnFare ? `/${final.selected?.ret?.fareType || spec.returnFare}` : ''} bookedFares=${JSON.stringify(final.bookingFareTypes || [])}`);
    add(spec.section, spec.n, spec.rule, how, status, {
      expected: 'HTTP 200 hops, issue BR, status Confirmed (Inprogress after 1 retry still PASS)',
      actual,
      payload: spec.appliedFilters,
      bookingReference: final?.br,
    });
    books.push({ id: spec.id, spec: { ...spec, appliedFilters: spec.appliedFilters }, result });
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});
  const report = {
    summary: {
      baseUrl: process.env.BASE_URL,
      path: SEARCH_PATH,
      startedAt: new Date().toISOString(),
      discovered: { owLabels, domOnwardLabels, domReturnLabels, intlOnward: intlO, intlReturn: intlR },
    },
    counts,
    rows,
    books: books.map((b) => ({
      id: b.id,
      br: b.result.final?.br,
      status: b.result.final?.bookingStatus,
      searchIds: b.result.final?.searchIds,
      selected: b.result.final?.selected || {
        onward: b.result.final?.onwardPick,
        ret: b.result.final?.returnPick,
      },
      attempts: b.result.attempts?.map((a) => ({
        dates: a.dates,
        br: a.br,
        skip: a.skip,
        bookingStatus: a.bookingStatus || a.settled?.classified,
        detailsHttp: a.detailsHttp,
        pricingHttp: a.pricingHttp,
        issueHttp: a.issueHttp,
        searchIds: a.searchIds,
      })),
    })),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nSaved ${OUT}`, counts);
  if (counts.BUG) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
