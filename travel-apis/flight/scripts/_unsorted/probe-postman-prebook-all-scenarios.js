/**
 * Staging only. No issue-ticket / no hotel finalize.
 * Walks every Postman collection scenario through the last hop before book,
 * using the same pretty-JSON body the collection signs.
 */
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { HotelService } from '../../../hotel/src/service.js';
import { extractBookingCodes, extractRequestId, isPrebookSuccess } from '../../../hotel/src/helpers.js';
import { extractFirstSearchId, extractOnwardSearchId, extractReturnSearchId } from '../../src/helpers.js';
import { collectOptions } from '../../src/searchPicker.js';

const PAX = [
  { key: '1ADT', adults: 1, children: 0, infants: 0 },
  { key: '1ADT+1CHD', adults: 1, children: 1, infants: 0 },
  { key: '2ADT', adults: 2, children: 0, infants: 0 },
  { key: '1ADT+1CHD+1INF', adults: 1, children: 1, infants: 1 },
];

function flightSearchBody({ journeyType, pax, connecting }) {
  const origin = 'DEL';
  const destination = 'BOM';
  return {
    itinerary: journeyType === 'ROUND_TRIP'
      ? [
        { origin, destination, date: '2026-11-12' },
        { origin: destination, destination: origin, date: '2026-11-19' },
      ]
      : [{ origin, destination, date: '2026-11-12' }],
    travellers: { adults: pax.adults, children: pax.children, infants: pax.infants },
    cabinClass: 'ECONOMY',
    journeyType,
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: connecting ? 1 : 0, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function isConnectingOption(o) {
  const stops = o?.totalStops ?? 0;
  const segCount = o?.segments?.length ?? 0;
  return Number(stops) > 0 || Number(segCount) > 1;
}

function pickDir(data, dir, connecting) {
  const opts = collectOptions(data, dir);
  if (connecting) {
    const hit = opts.find((o) => isConnectingOption(o) && o.searchId);
    if (hit?.searchId) return String(hit.searchId);
  }
  return opts.find((o) => o?.searchId)?.searchId ? String(opts.find((o) => o.searchId).searchId) : null;
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

function hopStatus(res, { allowVendor = false } = {}) {
  if (res?.ok) return 'PASS';
  if (allowVendor && errCode(res) === 'VENDOR_ERROR') return 'PASS';
  if (errCode(res) === 'INVALID_SIGNATURE') return 'BUG';
  if (!res) return 'NOT TESTED';
  return 'BUG';
}

function logRow(rows, product, scenario, hop, res, extra = '', opts = {}) {
  const status = hopStatus(res, opts);
  const line = {
    product,
    scenario,
    hop,
    status,
    http: res?.status ?? '',
    code: errCode(res) || '',
    extra,
  };
  rows.push(line);
  console.log(`${status.padEnd(11)} ${product.padEnd(6)} ${scenario} | ${hop} | HTTP ${line.http} ${line.code} ${extra}`.trim());
  return status;
}

async function runFlightScenario(flight, rows, { name, journeyType, connecting, pax, withSSR }) {
  const body = flightSearchBody({ journeyType, pax, connecting });
  let searchIds;

  try {
    if (journeyType === 'ROUND_TRIP') {
      const rt = await flight.searchRoundTripUntilComplete(body);
      const onward = pickDir(rt.response.data, 'ONWARD', connecting) || rt.searchIds?.[0] || extractOnwardSearchId(rt.response.data);
      const ret = pickDir(rt.response.data, 'RETURN', connecting) || rt.searchIds?.[1] || extractReturnSearchId(rt.response.data);
      searchIds = onward && ret ? [onward, ret] : rt.searchIds;
      logRow(rows, 'Flight', name, 'search', rt.response, `ids=${(searchIds || []).join(',')}`);
      if (!searchIds?.[0] || !searchIds[1]) {
        logRow(rows, 'Flight', name, 'details', null, 'no RT pair');
        return;
      }
    } else {
      const ow = await flight.searchUntilComplete(body);
      const sid = pickDir(ow.response.data, 'ONWARD', connecting) || ow.searchId || extractFirstSearchId(ow.response.data);
      searchIds = sid ? [sid] : [];
      logRow(rows, 'Flight', name, 'search', ow.response, `id=${sid || 'none'}`);
      if (!sid) {
        logRow(rows, 'Flight', name, 'details', null, 'no searchId');
        return;
      }
    }
  } catch (e) {
    console.log(`BUG         Flight ${name} | search | ${e.message}`);
    rows.push({
      product: 'Flight', scenario: name, hop: 'search', status: 'BUG', http: '', code: '', extra: e.message,
    });
    return;
  }

  const details = await flight.getDetails(searchIds, journeyType);
  logRow(rows, 'Flight', name, 'details', details);

  const rules = await flight.getFareRules(searchIds, journeyType);
  logRow(rows, 'Flight', name, 'fareRules', rules, '', { allowVendor: true });

  const pricing = await flight.getPricing(searchIds, journeyType);
  const priceId = pricing.data?.priceId || pricing.data?.data?.priceId || null;
  const bookingContext = pricing.data?.bookingContext || null;
  logRow(rows, 'Flight', name, 'pricing', pricing, `priceId=${priceId || 'none'}`);

  if (!withSSR) return;
  if (!pricing.ok || !priceId) {
    logRow(rows, 'Flight', name, 'ssr', null, 'no priceId');
    return;
  }

  const ssr = await flight.getSsr(priceId);
  logRow(rows, 'Flight', name, 'ssr', ssr);

  const paxList = [];
  for (let i = 0; i < pax.adults; i += 1) paxList.push({ paxId: `PAX${i + 1}`, type: 'adult' });
  for (let i = 0; i < pax.children; i += 1) paxList.push({ paxId: `PAX${pax.adults + i + 1}`, type: 'child' });
  for (let i = 0; i < pax.infants; i += 1) paxList.push({ paxId: `PAX${pax.adults + pax.children + i + 1}`, type: 'infant' });

  const seat = await flight.getSeatMap(bookingContext || priceId, paxList);
  const seatOk = seat.ok || (seat.status >= 400 && seat.status < 500 && errCode(seat) !== 'INVALID_SIGNATURE');
  const seatStatus = seat.ok ? 'PASS' : (seatOk ? 'PASS' : 'BUG');
  rows.push({
    product: 'Flight',
    scenario: name,
    hop: 'seatmap',
    status: seatStatus,
    http: seat.status,
    code: errCode(seat) || '',
    extra: bookingContext ? 'bookingContext' : 'priceId-fallback',
  });
  console.log(`${seatStatus.padEnd(11)} Flight ${name} | seatmap | HTTP ${seat.status} ${errCode(seat) || ''}`);
}

function hotelSearchBody(pax) {
  return {
    entityId: '39627872',
    nationality: 'IN',
    type: 'HOTEL',
    checkin: '2026-09-15',
    checkout: '2026-09-16',
    rooms: [{
      adults: pax.adults,
      children: pax.children,
      childrenAges: pax.children > 0 ? Array.from({ length: pax.children }, () => 9) : [],
    }],
  };
}

async function runHotelScenario(hotel, rows, { name, pax }) {
  const auto = await hotel.autocomplete('hiltop');
  logRow(rows, 'Hotel', name, 'autocomplete', auto);

  const searchBody = hotelSearchBody(pax);
  const search = await hotel.search(searchBody, { pid: 'vgm', page: 0, perpage: 20 });
  logRow(rows, 'Hotel', name, 'search', search);

  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data);
  const bookingCode = extractBookingCodes(details.data, 1)[0] || null;
  logRow(rows, 'Hotel', name, 'details', details, `requestId=${requestId ? 'yes' : 'no'} code=${bookingCode ? 'yes' : 'no'}`);

  if (!requestId || !bookingCode) {
    logRow(rows, 'Hotel', name, 'prebook', null, 'missing details fields');
    return;
  }

  const prebook = await hotel.prebook({ bookingCode, requestId });
  const ok = isPrebookSuccess(prebook);
  const status = ok ? 'PASS' : (errCode(prebook) === 'INVALID_SIGNATURE' ? 'BUG' : (prebook.ok ? 'BUG' : 'BUG'));
  rows.push({
    product: 'Hotel',
    scenario: name,
    hop: 'prebook',
    status: prebook.ok && ok ? 'PASS' : 'BUG',
    http: prebook.status,
    code: errCode(prebook) || '',
    extra: ok ? 'bookingContext' : 'no context',
  });
  console.log(`${(prebook.ok && ok ? 'PASS' : 'BUG').padEnd(11)} Hotel ${name} | prebook | HTTP ${prebook.status} ${errCode(prebook) || ''}`);
}

async function main() {
  console.log('Host staging — NO booking (no issue-ticket, no finalize)\n');
  const { client } = await authenticate();
  const flight = new FlightService(client);
  const hotel = new HotelService(client);
  const rows = [];

  const refAirports = await flight.client.request({
    method: 'GET', path: '/v1/flights/airports', query: { lang: 'en', currency: 'INR', airport: 'BOM', page: 0, perpage: 10 },
  });
  logRow(rows, 'Flight', 'reference', 'airports', refAirports);

  const refAirlines = await flight.client.request({
    method: 'GET', path: '/v1/flights/airlines', query: { lang: 'en', currency: 'INR', airline: 'AI', page: 0, perpage: 10 },
  });
  logRow(rows, 'Flight', 'reference', 'airlines', refAirlines);

  const refCity = await flight.client.request({
    method: 'GET', path: '/v1/flights/citySearch', query: { lang: 'en', currency: 'INR', q: 'Pune', page: 0, perpage: 10 },
  });
  logRow(rows, 'Flight', 'reference', 'citySearch', refCity);

  const flightScenarios = [];
  for (const p of PAX) {
    flightScenarios.push({ name: `OW/Direct/${p.key}`, journeyType: 'ONE_WAY', connecting: false, pax: p, withSSR: false });
    flightScenarios.push({ name: `OW/Connecting/${p.key}`, journeyType: 'ONE_WAY', connecting: true, pax: p, withSSR: false });
    flightScenarios.push({ name: `RT/Direct/${p.key}`, journeyType: 'ROUND_TRIP', connecting: false, pax: p, withSSR: false });
    flightScenarios.push({ name: `RT/Connecting/${p.key}`, journeyType: 'ROUND_TRIP', connecting: true, pax: p, withSSR: false });
  }
  flightScenarios.push({
    name: 'OW/Direct/SSR/1ADT', journeyType: 'ONE_WAY', connecting: false, pax: PAX[0], withSSR: true,
  });
  flightScenarios.push({
    name: 'RT/Direct/SSR/1ADT', journeyType: 'ROUND_TRIP', connecting: false, pax: PAX[0], withSSR: true,
  });

  for (const sc of flightScenarios) {
    await runFlightScenario(flight, rows, sc);
  }

  const hotelPax = [
    { key: '1ADT', adults: 1, children: 0, infants: 0 },
    { key: '1ADT+1CHD', adults: 1, children: 1, infants: 0 },
    { key: '2ADT', adults: 2, children: 0, infants: 0 },
    { key: '1ADT+1CHD+1INF', adults: 1, children: 1, infants: 0 },
  ];
  for (const p of hotelPax) {
    await runHotelScenario(hotel, rows, { name: `Hotel/${p.key}`, pax: p });
  }

  const pass = rows.filter((r) => r.status === 'PASS').length;
  const bug = rows.filter((r) => r.status === 'BUG').length;
  const nt = rows.filter((r) => r.status === 'NOT TESTED').length;
  console.log(`\nSCORE PASS=${pass} BUG=${bug} NOT_TESTED=${nt} (no bookings made)`);
  if (bug) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
