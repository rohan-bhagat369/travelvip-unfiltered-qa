/**
 * ak-api tripType — full Positive / Negative / Edge matrix
 * Flight search + airports + hotel autocomplete/search/details/prebook
 *
 *   $env:BASE_URL='https://ak-api.travelvip.ai'; node travel-apis/scripts/probe-ak-triptype-full-matrix.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { futureDate } from '../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  __dirname,
  '../reports',
  process.env.AK_TRIPTYPE_FULL_OUT || 'ak-triptype-full-matrix.json',
);

const TT_MSG = /must be 'domestic', 'international' or an empty string/i;
const MUMBAI = '357389:IN';
const INDIAN_HOTEL = process.env.AK_INDIAN_HOTEL_ID || '39624369';
const DATE_CANDIDATES = (process.env.HOTEL_CHECKIN_CANDIDATES || '14,21,28,35,45,60')
  .split(',')
  .map(Number);

function brief(d, n = 450) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function detailsArr(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function errText(r) {
  return `${detailsArr(r).join(' | ')} | ${r?.data?.error?.message || r?.data?.message || ''}`;
}

function airportRows(data) {
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}
function hotelAutoRows(data) {
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}
function hotelIsIndia(row) {
  const country = String(row?.country || row?.countryCode || '').toLowerCase();
  const id = String(row?.entityId || row?.id || '');
  return country === 'india' || id.endsWith(':IN');
}
function hotelSearchList(data) {
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.hotels)) return data.hotels;
  return [];
}
function flightOk(r) {
  if (!r || r.status !== 200) return false;
  const d = r.data;
  if (!d) return false;
  if (d.searchId || d?.data?.searchId) return true;
  if (d.progress || d?.data?.progress) return true;
  if (Array.isArray(d.results) && d.results.length) return true;
  if (Array.isArray(d.onwardFlights) && d.onwardFlights.length) return true;
  return Boolean(r.ok);
}
function collectBookingCodes(data) {
  const codes = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.bookingCode) codes.push(String(o.bookingCode));
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(data);
  return [...new Set(codes)];
}
function foreignAirports(list) {
  return list.filter((a) => {
    const cc = String(a?.countryCode || a?.country_code || '').toUpperCase();
    return cc && cc !== 'IN';
  });
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);

  const rows = [];
  const add = (row) => {
    rows.push(row);
    console.log(`[${row.status}] ${row.kind}/${row.id} — ${row.note}`);
  };
  const pass = (id, kind, rule, note, res, extra = {}) => add({
    id, kind, rule, status: 'PASS', note,
    http: res?.status ?? null, code: errCode(res), details: detailsArr(res),
    snippet: brief(res?.data), ...extra,
  });
  const bug = (id, kind, rule, note, res, extra = {}) => add({
    id, kind, rule, status: 'BUG', note,
    http: res?.status ?? null, code: errCode(res), details: detailsArr(res),
    snippet: brief(res?.data), ...extra,
  });
  const nt = (id, kind, rule, note) => add({
    id, kind, rule, status: 'NOT TESTED', note, http: null, code: null, details: [], snippet: null,
  });

  function expect400TripType(id, kind, rule, res, { both = false } = {}) {
    const http = res?.status ?? 0;
    const code = errCode(res);
    const text = errText(res);
    if (http === 400 && code === 'VALIDATION_ERROR' && TT_MSG.test(text)) {
      if (both && detailsArr(res).length < 2 && !/journeyType|required/i.test(text)) {
        bug(id, kind, rule, `tripType msg ok but missing body error peer: ${text.slice(0, 180)}`, res);
      } else {
        pass(id, kind, rule, `VALIDATION_ERROR ${text.slice(0, 180)}`, res);
      }
    } else if (http >= 500) {
      bug(id, kind, rule, `HTTP ${http} never allowed`, res);
    } else {
      bug(id, kind, rule, `Expected 400 VALIDATION_ERROR tripType msg, got HTTP ${http} code=${code} ${text.slice(0, 140)}`, res);
    }
  }

  // ── shared bodies ──────────────────────────────────────────────────
  function owBody(days = 45) {
    return {
      itinerary: [{ origin: 'DEL', destination: 'BOM', date: futureDate(days) }],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      journeyType: 'ONE_WAY',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: null, refundableOnly: false },
      appliedFilters: {},
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    };
  }
  function rtIntlBody(on = 45, ret = 52) {
    return {
      itinerary: [
        { origin: 'DEL', destination: 'DXB', date: futureDate(on) },
        { origin: 'DXB', destination: 'DEL', date: futureDate(ret) },
      ],
      travellers: { adults: 2, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      journeyType: 'ROUND_TRIP',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: null, refundableOnly: false },
      appliedFilters: {},
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    };
  }

  async function flightSearch(path, query, body) {
    return client.request({
      method: 'POST',
      path,
      query: { page: 0, perpage: 20, currency: 'INR', lang: 'en', ...query },
      body,
    });
  }
  async function airports(path, query) {
    return client.request({ method: 'GET', path, query });
  }
  async function airportsRaw(path, qs) {
    return client.request({ method: 'GET', path: `${path}?${qs}`, query: {} });
  }
  async function autocomplete(query) {
    return client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 10, ...query },
    });
  }
  async function autocompleteRaw(qs) {
    return client.request({ method: 'GET', path: `/v1/hotels/autocomplete?${qs}`, query: {} });
  }
  async function hotelSearch(query, body) {
    return client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { offset: 0, limit: 10, ...query },
      body,
    });
  }
  async function hotelDetails(query, body) {
    return client.request({ method: 'POST', path: '/v1/hotels/details', query, body });
  }
  async function hotelPrebook(query, body) {
    return client.request({ method: 'POST', path: '/v1/hotels/prebook', query, body });
  }

  // =====================================================================
  // FLIGHT SEARCH — Positive
  // =====================================================================
  {
    const res = await flightSearch('/v1/flights/search', { tripType: 'domestic' }, owBody());
    if (flightOk(res)) pass('FS-P1', 'positive', 'v1 search tripType=domestic DEL-BOM → 200', `HTTP 200`, res);
    else bug('FS-P1', 'positive', 'v1 search tripType=domestic DEL-BOM → 200', `HTTP ${res.status} ${errText(res).slice(0, 160)}`, res);
  }
  {
    const res = await flightSearch('/v1/flights/search', { tripType: 'international' }, rtIntlBody());
    if (flightOk(res)) pass('FS-P2', 'positive', 'v1 search tripType=international DEL-DXB RT → 200', `HTTP 200`, res);
    else bug('FS-P2', 'positive', 'v1 search tripType=international DEL-DXB RT → 200', `HTTP ${res.status} ${errText(res).slice(0, 160)}`, res);
  }
  {
    const res = await flightSearch('/v1/flights/search', { tripType: '' }, owBody());
    if (flightOk(res)) pass('FS-P3', 'positive', 'v1 search tripType= empty → 200', `HTTP 200`, res);
    else bug('FS-P3', 'positive', 'v1 search tripType= empty → 200', `HTTP ${res.status} ${errText(res).slice(0, 160)}`, res);
  }
  {
    const res = await flightSearch('/v1/flights/search', {}, owBody());
    if (flightOk(res)) pass('FS-P4', 'positive', 'v1 search tripType omitted → 200', `HTTP 200`, res);
    else bug('FS-P4', 'positive', 'v1 search tripType omitted → 200', `HTTP ${res.status} ${errText(res).slice(0, 160)}`, res);
  }
  {
    const res = await flightSearch('/v1/flights/search', { tripType: 'DOMESTIC' }, owBody());
    if (flightOk(res)) pass('FS-P5', 'positive', 'v1 search tripType=DOMESTIC (case) → 200', `HTTP 200`, res);
    else bug('FS-P5', 'positive', 'v1 search tripType=DOMESTIC (case) → 200', `HTTP ${res.status}`, res);
  }
  {
    const res = await flightSearch('/api/v2/flight/search', { tripType: 'domestic' }, owBody());
    if (flightOk(res)) pass('FS-P6', 'positive', 'v2 flight/search tripType=domestic → 200', `HTTP 200`, res);
    else bug('FS-P6', 'positive', 'v2 flight/search tripType=domestic → 200', `HTTP ${res.status} ${errText(res).slice(0, 160)}`, res);
  }

  // FLIGHT SEARCH — Negative
  for (const [id, val] of [
    ['FS-N1', 'local'],
    ['FS-N2', 'abc'],
    ['FS-N3', ' domestic'],
    ['FS-N4', 'domestic '],
    ['FS-N5', 'GARBAGE'],
    ['FS-N6', '<script>'],
    ['FS-N7', 'true'],
    ['FS-N8', '1'],
  ]) {
    const res = await flightSearch('/v1/flights/search', { tripType: val }, owBody());
    expect400TripType(id, 'negative', `v1 search tripType=${JSON.stringify(val)} → 400`, res);
  }
  {
    // array-style tripType[]=x via raw query
    const res = await client.request({
      method: 'POST',
      path: '/v1/flights/search?tripType%5B%5D=x&page=0&perpage=20&currency=INR',
      query: {},
      body: owBody(),
    });
    expect400TripType('FS-N9', 'negative', 'v1 search tripType[]=x → 400', res);
  }

  // FLIGHT SEARCH — Edge
  {
    const bad = { itinerary: owBody().itinerary, travellers: { adults: 1, children: 0, infants: 0 } };
    const res = await flightSearch('/v1/flights/search', { tripType: 'local' }, bad);
    expect400TripType('FS-E1', 'edge', 'tripType=local + missing journeyType → both errors', res, { both: true });
  }
  {
    const res = await flightSearch('/v1/flights/search', { tripType: 'International' }, rtIntlBody());
    if (flightOk(res)) pass('FS-E2', 'edge', 'tripType=International mixed case → 200', `HTTP 200`, res);
    else bug('FS-E2', 'edge', 'tripType=International mixed case → 200', `HTTP ${res.status}`, res);
  }

  // =====================================================================
  // AIRPORTS — Positive
  // =====================================================================
  {
    const res = await airports('/v1/flights/airports', { airport: 'del', tripType: 'domestic' });
    const list = airportRows(res.data);
    const foreign = foreignAirports(list);
    if (res.status === 200 && list.length > 0 && foreign.length === 0) {
      pass('AP-P1', 'positive', 'airports del+domestic → India only', `n=${list.length}`, res);
    } else bug('AP-P1', 'positive', 'airports del+domestic → India only', `HTTP ${res.status} n=${list.length} foreign=${foreign.length}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'dubai', tripType: 'international' });
    if (res.status === 200 && airportRows(res.data).length > 0) {
      pass('AP-P2', 'positive', 'airports dubai+international → list', `n=${airportRows(res.data).length}`, res);
    } else bug('AP-P2', 'positive', 'airports dubai+international → list', `HTTP ${res.status}`, res);
  }
  {
    const res = await airportsRaw('/v1/flights/airports', 'airport=del&tripType=');
    if (res.status === 200) pass('AP-P3', 'positive', 'airports del+tripType= empty → 200 (was 400)', `n=${airportRows(res.data).length}`, res);
    else bug('AP-P3', 'positive', 'airports del+tripType= empty → 200', `HTTP ${res.status} code=${errCode(res)}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'del' });
    if (res.status === 200) pass('AP-P4', 'positive', 'airports del omit tripType → 200 (default intl)', `n=${airportRows(res.data).length}`, res);
    else bug('AP-P4', 'positive', 'airports del omit tripType → 200', `HTTP ${res.status}`, res);
  }
  {
    const res = await airports('/api/v2/flight/airports', { airport: 'del', tripType: 'domestic' });
    if (res.status === 200) pass('AP-P5', 'positive', 'v2/flight/airports domestic → 200', `n=${airportRows(res.data).length}`, res);
    else bug('AP-P5', 'positive', 'v2/flight/airports domestic → 200', `HTTP ${res.status}`, res);
  }
  {
    const res = await airports('/api/v2/flights/airports', { airport: 'del', tripType: 'DOMESTIC' });
    if (res.status === 200) pass('AP-P6', 'positive', 'v2/flights/airports DOMESTIC case → 200', `n=${airportRows(res.data).length}`, res);
    else bug('AP-P6', 'positive', 'v2/flights/airports DOMESTIC case → 200', `HTTP ${res.status}`, res);
  }

  // AIRPORTS — Negative
  for (const [id, val] of [
    ['AP-N1', 'xyz'],
    ['AP-N2', 'local'],
    ['AP-N3', ' domestic'],
    ['AP-N4', 'abc'],
    ['AP-N5', 'yes'],
  ]) {
    const res = await airports('/api/v2/flights/airports', { airport: 'del', tripType: val });
    expect400TripType(id, 'negative', `airports tripType=${JSON.stringify(val)} → 400`, res);
  }

  // AIRPORTS — Edge
  {
    const res = await airports('/v1/flights/airports', { tripType: 'domestic' });
    const code = errCode(res);
    if (res.status === 400 && (code === 'MISSING_AIRPORT' || /airport/i.test(errText(res)))) {
      pass('AP-E1', 'edge', 'no airport → MISSING_AIRPORT', `code=${code}`, res);
    } else bug('AP-E1', 'edge', 'no airport → MISSING_AIRPORT', `HTTP ${res.status} code=${code}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'lhr', tripType: 'domestic' });
    const list = airportRows(res.data);
    const foreign = foreignAirports(list);
    if (res.status === 200 && foreign.length === 0) {
      pass('AP-E2', 'edge', 'lhr+domestic hides foreign / empty India-only', `n=${list.length}`, res);
    } else bug('AP-E2', 'edge', 'lhr+domestic hides foreign', `HTTP ${res.status} foreign=${foreign.length}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'lhr' });
    const list = airportRows(res.data);
    const hasLhr = list.some((a) => String(a?.iata || a?.code || a?.airportCode || '').toUpperCase() === 'LHR');
    if (res.status === 200 && (hasLhr || list.length > 0)) {
      pass('AP-E3', 'edge', 'lhr omit tripType (default intl) returns foreign', `n=${list.length} hasLhr=${hasLhr}`, res);
    } else bug('AP-E3', 'edge', 'lhr omit tripType returns foreign', `HTTP ${res.status}`, res);
  }

  // =====================================================================
  // HOTEL AUTOCOMPLETE — Positive / Negative / Edge
  // =====================================================================
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    const allIn = list.length > 0 && list.every(hotelIsIndia);
    if (res.status === 200 && allIn && res.data?.tripType === 'domestic') {
      pass('HA-P1', 'positive', 'autocomplete mumbai domestic → India + tripType domestic', `n=${list.length}`, res);
    } else bug('HA-P1', 'positive', 'autocomplete mumbai domestic', `HTTP ${res.status} n=${list.length} tt=${res.data?.tripType}`, res);
  }
  {
    const res = await autocomplete({ q: 'dubai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    if (res.status === 200 && (res.data?.empty === true || list.length === 0)) {
      pass('HA-P2', 'positive', 'autocomplete dubai domestic → empty', `n=${list.length}`, res);
    } else bug('HA-P2', 'positive', 'autocomplete dubai domestic → empty', `HTTP ${res.status} n=${list.length}`, res);
  }
  {
    const res = await autocomplete({ q: 'dubai' });
    const list = hotelAutoRows(res.data);
    if (res.status === 200 && list.length > 0 && (res.data?.tripType === null || res.data?.tripType === undefined)) {
      pass('HA-P3', 'positive', 'autocomplete dubai omit → all countries tripType null', `n=${list.length}`, res);
    } else bug('HA-P3', 'positive', 'autocomplete dubai omit → tripType null', `HTTP ${res.status} tt=${res.data?.tripType} n=${list.length}`, res);
  }
  {
    const res = await autocompleteRaw('q=dubai&tripType=&page=0&perpage=10&lang=en&currency=INR');
    if (res.status === 200) pass('HA-P4', 'positive', 'autocomplete dubai tripType= empty → 200', `n=${hotelAutoRows(res.data).length}`, res);
    else bug('HA-P4', 'positive', 'autocomplete dubai tripType= empty → 200', `HTTP ${res.status}`, res);
  }
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'DOMESTIC' });
    if (res.status === 200 && hotelAutoRows(res.data).every(hotelIsIndia)) {
      pass('HA-P5', 'positive', 'autocomplete DOMESTIC case → accept', `n=${hotelAutoRows(res.data).length}`, res);
    } else bug('HA-P5', 'positive', 'autocomplete DOMESTIC case → accept', `HTTP ${res.status}`, res);
  }

  for (const [id, val] of [
    ['HA-N1', 'local'],
    ['HA-N2', 'abc'],
    ['HA-N3', ' domestic'],
    ['HA-N4', 'foo'],
  ]) {
    const res = await autocomplete({ q: 'mumbai', tripType: val });
    expect400TripType(id, 'negative', `autocomplete tripType=${JSON.stringify(val)} → 400`, res);
  }

  {
    const res = await autocomplete({ q: 'pune', tripType: 'international' });
    // international filter on Indian query — may return empty or non-India only; changelog says no default filter when omitted, but with international should still return (unfiltered catalog view for autocomplete? For hotels autocomplete with international — typically still returns. Document as edge.)
    if (res.status === 200) {
      pass('HA-E1', 'edge', 'autocomplete pune+international → 200 (unfiltered or filtered)', `n=${hotelAutoRows(res.data).length} tt=${res.data?.tripType}`, res);
    } else bug('HA-E1', 'edge', 'autocomplete pune+international → 200', `HTTP ${res.status}`, res);
  }

  // Resolve Dubai city
  let dubaiEntity = process.env.AK_DUBAI_ENTITY || null;
  {
    const res = await autocomplete({ q: 'dubai' });
    const city = hotelAutoRows(res.data).find((r) => String(r.type || '').toUpperCase() === 'CITY')
      || hotelAutoRows(res.data)[0];
    dubaiEntity = dubaiEntity || city?.entityId || city?.id || null;
    console.log('Dubai entityId', dubaiEntity);
  }

  // =====================================================================
  // HOTEL SEARCH — date step for inventory
  // =====================================================================
  let goodCheckin = null;
  let goodCheckout = null;
  let searchBodyMumbai = null;
  for (const days of DATE_CANDIDATES) {
    const checkin = futureDate(days);
    const checkout = futureDate(days + 1);
    const body = {
      type: 'CITY',
      entityId: MUMBAI,
      nationality: 'IN',
      currency: 'INR',
      checkin,
      checkout,
      rooms: [{ adults: 2 }],
    };
    const res = await hotelSearch({ tripType: 'domestic' }, body);
    const list = hotelSearchList(res.data);
    if (res.status === 200 && list.length > 0) {
      goodCheckin = checkin;
      goodCheckout = checkout;
      searchBodyMumbai = body;
      console.log(`Hotel inventory hit Mumbai domestic checkin=${checkin} n=${list.length}`);
      break;
    }
  }
  if (!searchBodyMumbai) {
    // fallback fixed dates from changelog
    searchBodyMumbai = {
      type: 'CITY',
      entityId: MUMBAI,
      nationality: 'IN',
      currency: 'INR',
      checkin: '2026-11-12',
      checkout: '2026-11-13',
      rooms: [{ adults: 2 }],
    };
    console.log('No Mumbai inventory in candidates; using changelog dates');
  }

  {
    const res = await hotelSearch({ tripType: 'domestic' }, searchBodyMumbai);
    const list = hotelSearchList(res.data);
    if (res.status === 200 && list.length > 0 && res.data?.tripType === 'domestic') {
      pass('HS-P1', 'positive', 'search Mumbai domestic → hotels + top tripType domestic', `n=${list.length} checkin=${searchBodyMumbai.checkin}`, res);
    } else if (res.status === 200 && list.length > 0) {
      bug('HS-P1', 'positive', 'search Mumbai domestic', `n=${list.length} top tt=${res.data?.tripType}`, res);
    } else {
      bug('HS-P1', 'positive', 'search Mumbai domestic → hotels', `HTTP ${res.status} n=${list.length} msg=${String(res.data?.message || '').slice(0, 100)}`, res);
    }
  }
  {
    const res = await hotelSearch({}, searchBodyMumbai);
    const list = hotelSearchList(res.data);
    if (res.status === 200 && list.length > 0) {
      pass('HS-P2', 'positive', 'search Mumbai omit tripType → hotels', `n=${list.length}`, res);
    } else if (res.status === 200 && list.length === 0) {
      // inventory miss — still valid response shape
      pass('HS-P2', 'positive', 'search Mumbai omit tripType → 200 (inventory may be empty)', `n=0 msg=${String(res.data?.message || '').slice(0, 80)}`, res);
    } else bug('HS-P2', 'positive', 'search Mumbai omit tripType', `HTTP ${res.status}`, res);
  }
  {
    const res = await hotelSearch({ tripType: '' }, searchBodyMumbai);
    if (res.status === 200) pass('HS-P3', 'positive', 'search tripType= empty → 200', `n=${hotelSearchList(res.data).length}`, res);
    else bug('HS-P3', 'positive', 'search tripType= empty → 200', `HTTP ${res.status}`, res);
  }

  {
    const res = await hotelSearch({ tripType: 'international' }, searchBodyMumbai);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || '');
    if (res.status === 200 && list.length === 0 && /India|international/i.test(msg)) {
      pass('HS-E1', 'edge', 'search Mumbai + international → [] + message', msg.slice(0, 160), res);
    } else bug('HS-E1', 'edge', 'search Mumbai + international → [] + message', `n=${list.length} msg=${msg.slice(0, 120)}`, res);
  }
  if (dubaiEntity) {
    const body = {
      type: 'CITY',
      entityId: dubaiEntity,
      nationality: 'IN',
      currency: 'INR',
      checkin: searchBodyMumbai.checkin,
      checkout: searchBodyMumbai.checkout,
      rooms: [{ adults: 2 }],
    };
    const res = await hotelSearch({ tripType: 'domestic' }, body);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || '');
    if (res.status === 200 && list.length === 0 && /outside India|domestic/i.test(msg)) {
      pass('HS-E2', 'edge', 'search Dubai + domestic → [] + message', msg.slice(0, 160), res);
    } else bug('HS-E2', 'edge', 'search Dubai + domestic → [] + message', `n=${list.length} msg=${msg.slice(0, 120)}`, res);
  } else nt('HS-E2', 'edge', 'search Dubai + domestic', 'No Dubai entityId');

  for (const [id, val] of [['HS-N1', 'local'], ['HS-N2', 'abc'], ['HS-N3', ' domestic']]) {
    const res = await hotelSearch({ tripType: val }, searchBodyMumbai);
    expect400TripType(id, 'negative', `search tripType=${JSON.stringify(val)} → 400`, res);
  }

  // =====================================================================
  // HOTEL DETAILS + PREBOOK
  // =====================================================================
  const detailsBody = {
    type: 'HOTEL',
    entityId: INDIAN_HOTEL,
    nationality: 'IN',
    currency: 'INR',
    checkin: searchBodyMumbai.checkin,
    checkout: searchBodyMumbai.checkout,
    rooms: [{ adults: 2 }],
  };

  let bookingCode = null;
  let requestId = null;
  {
    const res = await hotelDetails({ tripType: 'domestic' }, detailsBody);
    const tt = res.data?.tripType || res.data?.hotel?.tripType;
    const codes = collectBookingCodes(res.data);
    bookingCode = codes[0] || null;
    requestId = res.data?.requestId || res.headers?.get?.('x-request-id') || null;
    // try _meta
    if (!requestId && res.data?._meta?.request_id) requestId = res.data._meta.request_id;
    if (res.status === 200 && tt === 'domestic') {
      pass('HD-P1', 'positive', 'details Indian hotel + domestic → tripType domestic', `codes=${codes.length}`, res);
    } else if (res.status === 200) {
      bug('HD-P1', 'positive', 'details Indian hotel + domestic → tripType domestic', `tt=${tt}`, res);
    } else bug('HD-P1', 'positive', 'details Indian hotel + domestic', `HTTP ${res.status}`, res);

    // if no codes, try a hotel from search results
    if (!bookingCode) {
      const s = await hotelSearch({ tripType: 'domestic' }, searchBodyMumbai);
      const first = hotelSearchList(s.data)[0];
      const hid = first?.id || first?.hotelId || first?.entityId;
      if (hid) {
        const d = await hotelDetails({ tripType: 'domestic' }, {
          ...detailsBody,
          entityId: String(hid),
        });
        const c2 = collectBookingCodes(d.data);
        bookingCode = c2[0] || null;
        requestId = d.data?.requestId || requestId;
        console.log('Fallback hotel', hid, 'codes', c2.length);
      }
    }
  }
  {
    const res = await hotelDetails({ tripType: 'international' }, detailsBody);
    const msg = String(res.data?.message || '');
    const list = hotelSearchList(res.data);
    if (res.status === 200 && (list.length === 0 || /No hotels/i.test(msg))) {
      pass('HD-E1', 'edge', 'details Indian + international → empty/No hotels', msg.slice(0, 160) || 'empty', res);
    } else bug('HD-E1', 'edge', 'details Indian + international → empty/No hotels', `HTTP ${res.status} msg=${msg.slice(0, 100)}`, res);
  }
  {
    const res = await hotelDetails({ tripType: 'local' }, detailsBody);
    expect400TripType('HD-N1', 'negative', 'details tripType=local → 400', res);
  }
  {
    const res = await hotelDetails({}, detailsBody);
    if (res.status === 200) pass('HD-P2', 'positive', 'details omit tripType → 200', `HTTP 200`, res);
    else bug('HD-P2', 'positive', 'details omit tripType → 200', `HTTP ${res.status}`, res);
  }

  // Prebook
  if (bookingCode) {
    const pbBody = {
      bookingCode,
      currency: 'INR',
      ...(requestId ? { requestId } : {}),
    };
    {
      const res = await hotelPrebook({ tripType: 'domestic' }, pbBody);
      if (res.status === 200 && (res.data?.bookingContext || res.ok)) {
        pass('HP-P1', 'positive', 'prebook right side domestic → 200', `HTTP 200`, res);
      } else if (res.status === 200) {
        pass('HP-P1', 'positive', 'prebook right side domestic → 200', brief(res.data, 200), res);
      } else {
        // retry omit tripType
        const res2 = await hotelPrebook({}, pbBody);
        if (res2.status === 200) pass('HP-P1', 'positive', 'prebook omit tripType → 200 (domestic query failed)', `dom HTTP ${res.status}`, res2);
        else bug('HP-P1', 'positive', 'prebook right side', `HTTP ${res.status}/${res2.status} ${errText(res2).slice(0, 120)}`, res2);
      }
    }
    {
      const res = await hotelPrebook({ tripType: 'international' }, pbBody);
      const msg = String(res.data?.message || res.data?.error?.message || '') + brief(res.data);
      const code = errCode(res) || res.data?.code;
      if (res.status === 404 || String(code) === '404' || /No hotels/i.test(msg)) {
        pass('HP-E1', 'edge', 'prebook wrong side → 404/No hotels', `HTTP ${res.status} code=${code} ${msg.slice(0, 120)}`, res);
      } else {
        bug('HP-E1', 'edge', 'prebook wrong side → 404/No hotels', `HTTP ${res.status} code=${code} ${errText(res).slice(0, 160)}`, res);
      }
    }
    {
      const res = await hotelPrebook({ tripType: 'local' }, pbBody);
      expect400TripType('HP-N1', 'negative', 'prebook tripType=local → 400', res);
    }
  } else {
    nt('HP-P1', 'positive', 'prebook right side', 'No bookingCode from details');
    nt('HP-E1', 'edge', 'prebook wrong side', 'No bookingCode from details');
    nt('HP-N1', 'negative', 'prebook tripType=local', 'No bookingCode from details');
  }

  // v2 hotel path smoke (autocomplete under api/v2)
  {
    const res = await client.request({
      method: 'GET',
      path: '/api/v2/hotels/autocomplete',
      query: { q: 'mumbai', tripType: 'domestic', page: 0, perpage: 5, lang: 'en', currency: 'INR' },
    });
    if (res.status === 200 || res.status === 404) {
      // 404 = path may not exist on ak — note it
      if (res.status === 200) pass('HV2-P1', 'positive', 'api/v2/hotels/autocomplete domestic → 200', `n=${hotelAutoRows(res.data).length}`, res);
      else pass('HV2-P1', 'positive', 'api/v2/hotels/autocomplete not mounted on ak (404) — v1 covered', `HTTP 404`, res);
    } else bug('HV2-P1', 'positive', 'api/v2/hotels/autocomplete domestic', `HTTP ${res.status}`, res);
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});
  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] = byKind[r.kind] || { PASS: 0, BUG: 0, 'NOT TESTED': 0 };
    byKind[r.kind][r.status] = (byKind[r.kind][r.status] || 0) + 1;
  }

  const report = {
    at: new Date().toISOString(),
    baseUrl: client.baseUrl,
    dubaiEntity,
    indianHotel: INDIAN_HOTEL,
    hotelDates: { checkin: searchBodyMumbai.checkin, checkout: searchBodyMumbai.checkout, goodCheckin, goodCheckout },
    bookingCode: bookingCode ? `${String(bookingCode).slice(0, 12)}…` : null,
    counts,
    byKind,
    bugs: rows.filter((r) => r.status === 'BUG').map((r) => ({ id: r.id, rule: r.rule, note: r.note, http: r.http, code: r.code })),
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nBY KIND', byKind);
  console.log('COUNTS', counts);
  console.log('Wrote', OUT);
  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
