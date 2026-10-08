/**
 * Finish RT fareTypes book cases on staging (two-step search + compatible pairs).
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildIssueTicketPayload } from '../src/helpers.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { GST } from '../../hotel/src/regression/fixtures.js';
import { sleep } from '../../../shared/lib/testUtils.js';

function norm(s) { return String(s || '').trim().toUpperCase(); }
function brief(d, n = 400) { try { return JSON.stringify(d).slice(0, n); } catch { return String(d); } }

function blocks(data) {
  return Array.isArray(data?.results) ? data.results : [];
}
function opts(data, dir) {
  const b = blocks(data).find((x) => String(x.direction).toUpperCase() === dir) || (dir === 'ONWARD' ? blocks(data)[0] : null);
  return b?.options || [];
}
function facet(data, dir) {
  const f = data?.filters?.[dir]?.fareTypes || [];
  return (Array.isArray(f) ? f : []).map((x) => x.fareType || x.label).filter(Boolean);
}
function fares(opt) {
  return Array.isArray(opt?.fares) && opt.fares.length ? opt.fares : (opt?.fare ? [opt.fare] : []);
}
function ftype(f) { return f?.fareType || f?.type || null; }
function fprice(f, opt) {
  const n = Number(f?.pricing?.totalAmount ?? f?.totalAmount ?? opt?.displayPricing?.pricing?.totalAmount);
  return Number.isFinite(n) ? n : 999999;
}

function pickFare(options, label) {
  let best = null;
  for (const opt of options) {
    for (const fare of fares(opt)) {
      if (label && norm(ftype(fare)) !== norm(label)) continue;
      const searchId = fare.searchId || opt.searchId;
      if (!searchId) continue;
      const row = { searchId, fareType: ftype(fare), price: fprice(fare, opt), flights: (opt.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`).join('/') };
      if (!best || row.price < best.price) best = row;
    }
  }
  return best;
}

function labelsIn(options) {
  const set = new Set();
  for (const opt of options) for (const f of fares(opt)) if (ftype(f)) set.add(ftype(f));
  return [...set];
}

function rtBody({ origin, dest, oDate, rDate, appliedFilters = {}, selected = [] }) {
  return {
    itinerary: [
      { origin, destination: dest, date: oDate },
      { origin: dest, destination: origin, date: rDate },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters,
    selection: { selectedSearchIds: selected },
    fareType: 'NORMAL',
  };
}

async function searchUntil(client, body, dir = 'ONWARD') {
  let last = null;
  for (let i = 0; i < 12; i += 1) {
    last = await client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' },
      body,
      correlation: true,
    });
    const n = opts(last.data, dir).length;
    const done = last.data?.progress?.state === 'COMPLETE';
    if (last.ok && (n > 0 || done)) return last;
    await sleep(2500);
  }
  return last;
}

async function rtPair(client, { origin, dest, oDate, rDate, onwardFare, returnFare, appliedFilters }) {
  const first = await searchUntil(client, rtBody({ origin, dest, oDate, rDate, appliedFilters }), 'ONWARD');
  const onward = pickFare(opts(first.data, 'ONWARD'), onwardFare);
  const ret0 = pickFare(opts(first.data, 'RETURN'), returnFare);
  const dump = {
    firstHttp: first.status,
    firstO: opts(first.data, 'ONWARD').length,
    firstR: opts(first.data, 'RETURN').length,
    facetO: facet(first.data, 'ONWARD'),
    facetR: facet(first.data, 'RETURN'),
    labelsO: labelsIn(opts(first.data, 'ONWARD')).slice(0, 12),
    labelsR: labelsIn(opts(first.data, 'RETURN')).slice(0, 12),
    onward,
    ret0,
    filterKeys: Object.keys(first.data?.filters || {}),
  };
  if (onward && ret0 && onward.searchId !== ret0.searchId) {
    return { ...dump, searchIds: [onward.searchId, ret0.searchId], ret: ret0, twoStep: false };
  }
  if (!onward) return { ...dump, searchIds: [], skip: 'no onward fare' };
  const second = await searchUntil(client, rtBody({
    origin, dest, oDate, rDate, appliedFilters, selected: [onward.searchId],
  }), 'RETURN');
  const ret = pickFare(opts(second.data, 'RETURN'), returnFare);
  return {
    ...dump,
    secondHttp: second.status,
    secondO: opts(second.data, 'ONWARD').length,
    secondR: opts(second.data, 'RETURN').length,
    secondLabelsR: labelsIn(opts(second.data, 'RETURN')).slice(0, 12),
    secondFacetR: facet(second.data, 'RETURN'),
    ret,
    twoStep: true,
    searchIds: ret?.searchId ? [onward.searchId, ret.searchId] : [],
    skip: ret?.searchId ? null : 'no return after two-step',
  };
}

function classify(raw) {
  const s = String(raw || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

async function poll(flight, br) {
  let last = { classified: 'Pending' };
  for (let i = 0; i < 20; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = { classified: classify(st.data?.status), raw: st.data?.status };
    console.log('  status', i + 1, last.classified);
    if (['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(last.classified)) return last;
    await sleep(3000);
  }
  return last;
}

async function book(flight, searchIds, intl, nameLag) {
  const details = await flight.getDetails(searchIds, 'ROUND_TRIP');
  const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
  const out = {
    detailsHttp: details.status,
    detailsCode: details.data?.error?.code || null,
    detailsMsg: details.data?.error?.message || null,
    pricingHttp: pricing.status,
    pricingCode: pricing.data?.error?.code || null,
  };
  if (!pricing.ok || !pricing.data?.priceId) return { ...out, br: null };
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = buildPassengers({ adults: 1, uniqueNames: true, nameIndex: nameLag, withPassport: intl });
  payload.data.contact.email = `faretypes.rt.${uniqueTag()}@travelvip.ai`;
  payload.data.passportType = intl
    ? (pricing.data.passportType && pricing.data.passportType !== 'NONE' ? pricing.data.passportType : 'MINI')
    : (pricing.data.passportType || 'NONE');
  if (pricing.data.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };
  }
  const issue = await flight.issueTicketV2(payload);
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
  out.issueHttp = issue.status;
  out.issueCode = issue.data?.error?.code || null;
  out.br = br;
  if (br) {
    const settled = await poll(flight, br);
    out.status = settled.classified;
  }
  return out;
}

async function runCase(client, flight, spec) {
  console.log(`\n=== ${spec.id}`);
  const pair = await rtPair(client, spec);
  console.log('  pair', brief({
    firstO: pair.firstO, firstR: pair.firstR, twoStep: pair.twoStep,
    secondR: pair.secondR, labelsO: pair.labelsO, labelsR: pair.labelsR || pair.secondLabelsR,
    onward: pair.onward, ret: pair.ret, skip: pair.skip, codes: pair.searchIds,
  }, 500));
  if (!pair.searchIds?.length) {
    return { id: spec.id, status: 'NOT TESTED', actual: pair.skip || 'no pair', pair };
  }
  const booked = await book(flight, pair.searchIds, spec.intl, spec.nameLag);
  console.log('  book', brief(booked, 350));
  let status = 'BUG';
  if (spec.expectCode) {
    status = booked.detailsCode === spec.expectCode || booked.pricingCode === spec.expectCode ? 'PASS' : 'BUG';
  } else if (booked.br && (booked.status === 'Confirmed' || booked.status === 'Inprogress')) {
    status = 'PASS';
  } else if (booked.br && booked.status === 'Failed') {
    status = 'BUG';
  } else if (!booked.br && booked.detailsHttp === 400 && booked.detailsCode === 'INVALID_COMBINATION') {
    status = spec.allowInvalidCombo ? 'PASS' : 'BUG';
  }
  return { id: spec.id, rule: spec.rule, status, pair, booked };
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const rows = [];

  const cases = [
    {
      id: 'RT-DOM-SAME',
      rule: 'RT domestic same fareTypes Normal/Normal then book',
      origin: 'DEL', dest: 'BOM', oDate: '2026-09-22', rDate: '2026-09-29',
      onwardFare: 'Normal', returnFare: 'Normal',
      appliedFilters: { ONWARD: { fareTypes: ['Normal'] }, RETURN: { fareTypes: ['Normal'] } },
      intl: false, nameLag: 11,
    },
    {
      id: 'RT-DOM-DIFF',
      rule: 'RT domestic different fareTypes Normal/Flexi then book',
      origin: 'DEL', dest: 'BOM', oDate: '2026-09-22', rDate: '2026-09-29',
      onwardFare: 'Normal', returnFare: 'Flexi',
      appliedFilters: { ONWARD: { fareTypes: ['Normal'] }, RETURN: { fareTypes: ['Flexi'] } },
      intl: false, nameLag: 12,
    },
    {
      id: 'RT-INTL-SAME-1',
      rule: 'Intl RT #1 same fareType Economy Saver both legs then book',
      origin: 'BOM', dest: 'DXB', oDate: '2026-09-22', rDate: '2026-09-29',
      onwardFare: 'Economy Saver', returnFare: 'Economy Saver',
      appliedFilters: { ONWARD: { fareTypes: ['Economy Saver'] }, RETURN: { fareTypes: ['Economy Saver'] } },
      intl: true, nameLag: 13,
    },
    {
      id: 'RT-INTL-SAME-2',
      rule: 'Intl RT #2 same fareType Economy Flex both legs then book',
      origin: 'BOM', dest: 'DXB', oDate: '2026-09-25', rDate: '2026-10-02',
      onwardFare: 'Economy Flex', returnFare: 'Economy Flex',
      appliedFilters: { ONWARD: { fareTypes: ['Economy Flex'] }, RETURN: { fareTypes: ['Economy Flex'] } },
      intl: true, nameLag: 14,
    },
    {
      id: 'RT-INTL-DIFF-COMPAT',
      rule: 'Intl RT different published fares Economy Saver + Economy Flex (book if combinable)',
      origin: 'BOM', dest: 'DXB', oDate: '2026-09-22', rDate: '2026-09-29',
      onwardFare: 'Economy Saver', returnFare: 'Economy Flex',
      appliedFilters: { ONWARD: { fareTypes: ['Economy Saver'] }, RETURN: { fareTypes: ['Economy Flex'] } },
      intl: true, nameLag: 15,
    },
    {
      id: 'RT-INTL-DIFF-NDC',
      rule: 'Intl RT Economy Saver + NDC:-Economy Saver → INVALID_COMBINATION (no book)',
      origin: 'BOM', dest: 'DXB', oDate: '2026-09-22', rDate: '2026-09-29',
      onwardFare: 'Economy Saver', returnFare: 'NDC:-Economy Saver',
      appliedFilters: { ONWARD: { fareTypes: ['Economy Saver'] }, RETURN: { fareTypes: ['NDC:-Economy Saver'] } },
      intl: true, nameLag: 16, allowInvalidCombo: true, expectCode: 'INVALID_COMBINATION',
    },
  ];

  for (const spec of cases) {
    rows.push(await runCase(client, flight, spec));
  }

  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const out = { counts, rows: rows.map((r) => ({
    id: r.id, rule: r.rule, status: r.status,
    br: r.booked?.br, bookingStatus: r.booked?.status,
    details: `${r.booked?.detailsHttp} ${r.booked?.detailsCode || ''}`,
    pricing: `${r.booked?.pricingHttp} ${r.booked?.pricingCode || ''}`,
    searchIds: r.pair?.searchIds,
    selected: { onward: r.pair?.onward, ret: r.pair?.ret },
    skip: r.pair?.skip,
    twoStep: r.pair?.twoStep,
    inventory: { o: r.pair?.firstO, r: r.pair?.firstR, r2: r.pair?.secondR, labelsO: r.pair?.labelsO, labelsR: r.pair?.secondLabelsR || r.pair?.labelsR },
  })) };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/flight-faretypes-rt-retry-staging.json', JSON.stringify(out, null, 2));
  console.log('\nSaved reports/flight-faretypes-rt-retry-staging.json', counts);
  if (counts.BUG) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
