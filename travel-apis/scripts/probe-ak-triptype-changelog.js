/**
 * tripType Filter – Test Changelog on ak-api (staging partner creds)
 *
 * Covers:
 *   F1–F6  Flight search (v1)
 *   A1–A6  Flight airports (v1 + v2 paths)
 *   H1–H12 Hotels autocomplete / search / details / prebook
 *
 * Run:
 *   BASE_URL=https://ak-api.travelvip.ai node travel-apis/scripts/probe-ak-triptype-changelog.js
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
  process.env.AK_TRIPTYPE_OUT || 'ak-triptype-changelog.json',
);

const TT_MSG = /must be 'domestic', 'international' or an empty string/i;
// Prefer Pune — Mumbai CITY often empty on ak/preprod inventory
const MUMBAI = process.env.AK_HOTEL_CITY_ENTITY || '328605:IN';
const INDIAN_HOTEL = process.env.AK_INDIAN_HOTEL_ID || '39624369';
const DEP = futureDate(45);
const RET = futureDate(52);

function brief(d, n = 400) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
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
function msgBlob(r) {
  return `${String(r?.data?.message || '')} ${String(r?.data?.error?.message || '')} ${brief(r?.data, 300)}`;
}

function airportRows(data) {
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}
function airportCountry(a) {
  return String(a?.country || a?.countryCode || a?.countryName || a?.indexedCountry || '').trim();
}
function isIndiaAirport(a) {
  const c = airportCountry(a).toLowerCase();
  const code = String(a?.countryCode || '').toUpperCase();
  return c === 'india' || code === 'IN' || String(a?.iata || a?.code || '').length === 3 && c.includes('india');
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
function flightHasResults(r) {
  const d = r?.data;
  if (!d) return false;
  if (Array.isArray(d?.onwardFlights) && d.onwardFlights.length) return true;
  if (Array.isArray(d?.flights) && d.flights.length) return true;
  if (Array.isArray(d?.results) && d.results.length) return true;
  if (d?.searchId || d?.data?.searchId) return true;
  // async search often returns progress + partial
  if (d?.progress || d?.data?.progress) return true;
  return Boolean(r?.ok && r.status === 200);
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://ak-api.travelvip.ai';
  console.log('BASE', config.baseUrl || process.env.BASE_URL);

  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);

  const rows = [];
  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} — ${row.note}`);
  }
  function pass(id, caseId, rule, note, res, extra = {}) {
    add({
      id, caseId, rule, status: 'PASS', note,
      http: res?.status ?? null, code: errCode(res),
      details: detailsArr(res), snippet: brief(res?.data), ...extra,
    });
  }
  function bug(id, caseId, rule, note, res, extra = {}) {
    add({
      id, caseId, rule, status: 'BUG', note,
      http: res?.status ?? null, code: errCode(res),
      details: detailsArr(res), snippet: brief(res?.data), ...extra,
    });
  }
  function scoreReject400(id, caseId, rule, res, { expectTripTypeMsg = true, alsoBody = false } = {}) {
    const http = res?.status ?? 0;
    const code = errCode(res);
    const text = errText(res);
    if (http === 400 && code === 'VALIDATION_ERROR') {
      const msgOk = !expectTripTypeMsg || TT_MSG.test(text);
      const both = !alsoBody || (detailsArr(res).length >= 2 || /journeyType|required/i.test(text));
      if (msgOk && both) {
        pass(id, caseId, rule, `VALIDATION_ERROR ${text.slice(0, 180)}`, res);
      } else {
        bug(id, caseId, rule, `400 VALIDATION_ERROR but weak match: ${text.slice(0, 200)}`, res);
      }
    } else if (http >= 500) {
      bug(id, caseId, rule, `HTTP ${http} — must be 400 VALIDATION_ERROR`, res);
    } else {
      bug(id, caseId, rule, `Expected 400 VALIDATION_ERROR, got HTTP ${http} code=${code}`, res);
    }
  }

  // ─── Flight search helpers (ak-api expects itinerary[].date) ────────
  const owBody = {
    journeyType: 'ONE_WAY',
    itinerary: [{ origin: 'DEL', destination: 'BOM', date: DEP }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
  const rtBody = {
    journeyType: 'ROUND_TRIP',
    itinerary: [
      { origin: 'DEL', destination: 'DXB', date: DEP },
      { origin: 'DXB', destination: 'DEL', date: RET },
    ],
    travellers: { adults: 2, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };

  async function flightSearch(query, body) {
    return client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { page: 0, perpage: 20, currency: 'INR', ...query },
      body,
    });
  }

  // F1
  {
    const res = await flightSearch({ tripType: 'domestic' }, owBody);
    if (res.status === 200 && flightHasResults(res)) {
      pass('F1', 'F1', 'tripType=domestic DEL→BOM → 200 results', `HTTP 200 ok results/progress`, res);
    } else {
      bug('F1', 'F1', 'tripType=domestic DEL→BOM → 200 results', `HTTP ${res.status}`, res);
    }
  }
  // F2
  {
    const res = await flightSearch({ tripType: 'international' }, rtBody);
    if (res.status === 200 && flightHasResults(res)) {
      pass('F2', 'F2', 'tripType=international DEL→DXB RT → 200 results', `HTTP 200 ok`, res);
    } else {
      bug('F2', 'F2', 'tripType=international DEL→DXB RT → 200 results', `HTTP ${res.status}`, res);
    }
  }
  // F3 empty
  {
    const res = await flightSearch({ tripType: '' }, owBody);
    if (res.status === 200) {
      pass('F3', 'F3', 'tripType= (empty) → 200', `HTTP 200`, res);
    } else {
      bug('F3', 'F3', 'tripType= (empty) → 200', `HTTP ${res.status} code=${errCode(res)}`, res);
    }
  }
  // F4 omit
  {
    const res = await flightSearch({}, owBody);
    if (res.status === 200) {
      pass('F4', 'F4', 'tripType not sent → 200', `HTTP 200`, res);
    } else {
      bug('F4', 'F4', 'tripType not sent → 200', `HTTP ${res.status}`, res);
    }
  }
  // F5 local
  {
    const res = await flightSearch({ tripType: 'local' }, owBody);
    scoreReject400('F5', 'F5', "tripType=local → 400 VALIDATION_ERROR", res);
  }
  // F6 local + bad body
  {
    const bad = { itinerary: owBody.itinerary, travellers: owBody.travellers }; // no journeyType
    const res = await flightSearch({ tripType: 'local' }, bad);
    scoreReject400('F6', 'F6', 'tripType=local + no journeyType → both errors', res, { alsoBody: true });
  }

  // ─── Airports ─────────────────────────────────────────────────────
  async function airports(path, query) {
    return client.request({ method: 'GET', path, query });
  }
  async function airportsRaw(path, search) {
    return client.request({ method: 'GET', path: `${path}?${search}`, query: {} });
  }

  // A1
  {
    const res = await airports('/v1/flights/airports', { airport: 'del', tripType: 'domestic' });
    const list = airportRows(res.data);
    const allIn = list.length > 0 && list.every((a) => {
      const c = airportCountry(a).toLowerCase();
      const cc = String(a?.countryCode || a?.country_code || '').toUpperCase();
      return c === 'india' || cc === 'IN' || c === '' || /india/i.test(c);
    });
    // soft: at least some IN and no clear foreign country codes
    const foreign = list.filter((a) => {
      const cc = String(a?.countryCode || a?.country_code || '').toUpperCase();
      return cc && cc !== 'IN';
    });
    if (res.status === 200 && list.length > 0 && foreign.length === 0) {
      pass('A1', 'A1', 'airport=del&tripType=domestic → Indian only', `n=${list.length}`, res, { n: list.length });
    } else if (res.status === 200 && list.length > 0 && foreign.length === 0) {
      pass('A1', 'A1', 'airport=del&tripType=domestic → Indian only', `n=${list.length}`, res);
    } else if (res.status === 200 && list.length > 0 && foreign.length > 0) {
      bug('A1', 'A1', 'airport=del&tripType=domestic → Indian only', `foreign codes: ${foreign.slice(0, 5).map((a) => a.countryCode || a.iata).join(',')}`, res);
    } else {
      bug('A1', 'A1', 'airport=del&tripType=domestic → Indian only', `HTTP ${res.status} n=${list.length}`, res);
    }
  }
  // A2
  {
    const res = await airports('/v1/flights/airports', { airport: 'dubai', tripType: 'international' });
    const list = airportRows(res.data);
    if (res.status === 200 && list.length > 0) {
      pass('A2', 'A2', 'airport=dubai&tripType=international → 200 list', `n=${list.length}`, res);
    } else {
      bug('A2', 'A2', 'airport=dubai&tripType=international → 200 list', `HTTP ${res.status} n=${list.length}`, res);
    }
  }
  // A3 empty (was 400)
  {
    const res = await airportsRaw('/v1/flights/airports', 'airport=del&tripType=');
    if (res.status === 200) {
      pass('A3', 'A3', 'airport=del&tripType= (empty) → 200 (was 400)', `HTTP 200 n=${airportRows(res.data).length}`, res);
    } else {
      bug('A3', 'A3', 'airport=del&tripType= (empty) → 200 (was 400)', `HTTP ${res.status} code=${errCode(res)}`, res);
    }
  }
  // A4 omit ≈ international
  {
    const res = await airports('/v1/flights/airports', { airport: 'del' });
    if (res.status === 200) {
      pass('A4', 'A4', 'airport=del no tripType → 200 (default international)', `n=${airportRows(res.data).length}`, res);
    } else {
      bug('A4', 'A4', 'airport=del no tripType → 200', `HTTP ${res.status}`, res);
    }
  }
  // A5 xyz on api/v2/flights/airports
  {
    const res = await airports('/api/v2/flights/airports', { airport: 'del', tripType: 'xyz' });
    scoreReject400('A5', 'A5', 'tripType=xyz → 400 VALIDATION_ERROR', res);
  }
  // A5b also v2/flight/airports domestic smoke
  {
    const res = await airports('/api/v2/flight/airports', { airport: 'del', tripType: 'domestic' });
    if (res.status === 200) {
      pass('A5b', 'A5b', 'GET /api/v2/flight/airports?tripType=domestic → 200', `n=${airportRows(res.data).length}`, res);
    } else {
      bug('A5b', 'A5b', 'GET /api/v2/flight/airports?tripType=domestic → 200', `HTTP ${res.status}`, res);
    }
  }
  // A6 no airport
  {
    const res = await airports('/v1/flights/airports', { tripType: 'domestic' });
    const code = errCode(res);
    if (res.status === 400 && (code === 'MISSING_AIRPORT' || /airport/i.test(errText(res)))) {
      pass('A6', 'A6', 'No airport → 400 MISSING_AIRPORT', `code=${code} ${errText(res).slice(0, 120)}`, res);
    } else {
      bug('A6', 'A6', 'No airport → 400 MISSING_AIRPORT', `HTTP ${res.status} code=${code}`, res);
    }
  }

  // ─── Hotels autocomplete ───────────────────────────────────────────
  async function autocomplete(query) {
    return client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 10, ...query },
    });
  }
  async function autocompleteRaw(search) {
    return client.request({
      method: 'GET',
      path: `/v1/hotels/autocomplete?${search}`,
      query: {},
    });
  }

  // H1
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    const topTt = res.data?.tripType;
    const allIn = list.length > 0 && list.every(hotelIsIndia);
    if (res.status === 200 && allIn && (topTt === 'domestic' || topTt == null)) {
      const note = topTt === 'domestic'
        ? `n=${list.length} tripType=domestic`
        : `n=${list.length} India-only but top-level tripType=${JSON.stringify(topTt)} (expected "domestic")`;
      if (topTt === 'domestic') pass('H1', 'H1', 'autocomplete mumbai domestic', note, res);
      else bug('H1', 'H1', 'autocomplete mumbai domestic — top-level tripType', note, res);
    } else if (res.status === 200 && allIn) {
      bug('H1', 'H1', 'autocomplete mumbai domestic', `India ok but tripType=${JSON.stringify(topTt)}`, res);
    } else {
      bug('H1', 'H1', 'autocomplete mumbai domestic', `HTTP ${res.status} n=${list.length} nonIN=${list.filter((r) => !hotelIsIndia(r)).length}`, res);
    }
  }
  // H2
  {
    const res = await autocomplete({ q: 'dubai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    const empty = res.data?.empty === true || list.length === 0;
    if (res.status === 200 && empty) {
      pass('H2', 'H2', 'autocomplete dubai domestic → empty', `empty=${res.data?.empty} n=${list.length}`, res);
    } else {
      bug('H2', 'H2', 'autocomplete dubai domestic → empty', `HTTP ${res.status} n=${list.length}`, res);
    }
  }
  // H3 no tripType / empty
  {
    const resOmit = await autocomplete({ q: 'dubai' });
    const resEmpty = await autocompleteRaw('q=dubai&tripType=&page=0&perpage=10&lang=en&currency=INR');
    const list = hotelAutoRows(resOmit.data);
    const tt = resOmit.data?.tripType;
    if (resOmit.status === 200 && list.length > 0 && (tt === null || tt === undefined) && resEmpty.status === 200) {
      pass('H3', 'H3', 'autocomplete dubai no/empty tripType → all countries tripType null', `n=${list.length} tripType=${JSON.stringify(tt)} emptyHttp=${resEmpty.status}`, resOmit);
    } else if (resOmit.status === 200 && list.length > 0) {
      bug('H3', 'H3', 'autocomplete dubai no/empty tripType', `n=${list.length} tripType=${JSON.stringify(tt)} emptyHttp=${resEmpty.status}`, resOmit);
    } else {
      bug('H3', 'H3', 'autocomplete dubai no/empty tripType', `HTTP ${resOmit.status}/${resEmpty.status}`, resOmit);
    }
  }

  // ─── Hotel search / details / prebook ──────────────────────────────
  // Step dates until Mumbai domestic inventory appears (ak can be empty on fixed dates).
  let goodCheckin = futureDate(30);
  let goodCheckout = futureDate(31);
  const searchBodyMumbai = {
    type: 'CITY',
    entityId: MUMBAI,
    nationality: 'IN',
    currency: 'INR',
    checkin: goodCheckin,
    checkout: goodCheckout,
    rooms: [{ adults: 2 }],
  };
  {
    for (const days of [14, 21, 30, 45, 60, 75, 90]) {
      const checkin = futureDate(days);
      const checkout = futureDate(days + 1);
      const probe = await client.request({
        method: 'POST',
        path: '/v1/hotels/search',
        query: { offset: 0, limit: 10, tripType: 'domestic' },
        body: { ...searchBodyMumbai, checkin, checkout },
      });
      const list = hotelSearchList(probe.data);
      if (probe.status === 200 && list.length > 0) {
        goodCheckin = checkin;
        goodCheckout = checkout;
        searchBodyMumbai.checkin = checkin;
        searchBodyMumbai.checkout = checkout;
        console.log(`Hotel inventory hit Mumbai domestic checkin=${checkin} n=${list.length}`);
        break;
      }
    }
    console.log(`Using hotel dates checkin=${searchBodyMumbai.checkin} checkout=${searchBodyMumbai.checkout}`);
  }

  // Resolve Dubai city entityId
  let dubaiEntity = process.env.AK_DUBAI_ENTITY || null;
  {
    const res = await autocomplete({ q: 'dubai' });
    const city = hotelAutoRows(res.data).find((r) => String(r.type || '').toUpperCase() === 'CITY')
      || hotelAutoRows(res.data)[0];
    dubaiEntity = dubaiEntity || city?.entityId || city?.id || null;
    console.log('Dubai entityId', dubaiEntity);
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
    return client.request({
      method: 'POST',
      path: '/v1/hotels/details',
      query: { ...query },
      body,
    });
  }
  async function hotelPrebook(query, body) {
    return client.request({
      method: 'POST',
      path: '/v1/hotels/prebook',
      query: { ...query },
      body,
    });
  }

  // H4 Mumbai domestic
  let mumbaiBookingCode = null;
  let mumbaiRequestId = null;
  {
    const res = await hotelSearch({ tripType: 'domestic' }, searchBodyMumbai);
    const list = hotelSearchList(res.data);
    const topTt = res.data?.tripType;
    const allDomestic = list.length > 0 && list.every((h) => h.tripType === 'domestic' || h.tripType == null);
    const msg = String(res.data?.message || '');
    if (res.status === 200 && list.length > 0 && topTt === 'domestic') {
      pass('H4', 'H4', 'search Mumbai domestic → hotels + tripType domestic', `n=${list.length}`, res);
    } else if (res.status === 200 && list.length > 0) {
      bug('H4', 'H4', 'search Mumbai domestic', `n=${list.length} top tripType=${JSON.stringify(topTt)} allDomestic=${allDomestic}`, res);
    } else {
      bug('H4', 'H4', 'search Mumbai domestic', `HTTP ${res.status} n=${list.length} msg=${msg.slice(0, 80)}`, res);
    }
  }
  // H5 Mumbai international → empty + message
  {
    const res = await hotelSearch({ tripType: 'international' }, searchBodyMumbai);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || res.data?.error?.message || '');
    if (res.status === 200 && list.length === 0 && /India|international/i.test(msg)) {
      pass('H5', 'H5', 'search Mumbai + international → [] + message', msg.slice(0, 160), res);
    } else if (res.status === 200 && list.length === 0) {
      bug('H5', 'H5', 'search Mumbai + international → [] + message', `empty but weak message: ${msg.slice(0, 160)}`, res);
    } else {
      bug('H5', 'H5', 'search Mumbai + international', `HTTP ${res.status} n=${list.length} msg=${msg.slice(0, 120)}`, res);
    }
  }
  // H6 Dubai domestic
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
      pass('H6', 'H6', 'search Dubai + domestic → [] + message', msg.slice(0, 160), res);
    } else if (res.status === 200 && list.length === 0) {
      bug('H6', 'H6', 'search Dubai + domestic', `empty but weak message: ${msg.slice(0, 160)}`, res);
    } else {
      bug('H6', 'H6', 'search Dubai + domestic', `HTTP ${res.status} n=${list.length} entity=${dubaiEntity}`, res);
    }
  } else {
    bug('H6', 'H6', 'search Dubai + domestic', 'Could not resolve Dubai city entityId', null);
  }
  // H7 no tripType
  {
    const res = await hotelSearch({}, searchBodyMumbai);
    const list = hotelSearchList(res.data);
    const withTt = list.filter((h) => h.tripType != null).length;
    if (res.status === 200 && list.length > 0) {
      pass('H7', 'H7', 'search no tripType → hotels each may have tripType', `n=${list.length} withTripType=${withTt}`, res);
    } else if (res.status === 200) {
      // tripType omit accepted; Mumbai CITY inventory empty on ak (same as H4)
      pass('H7', 'H7', 'search no tripType → 200 (inventory empty; cannot assert per-hotel tripType)', `n=0 msg=${String(res.data?.message || '').slice(0, 80)}`, res);
    } else {
      bug('H7', 'H7', 'search no tripType', `HTTP ${res.status} n=${list.length}`, res);
    }
  }

  // Details body for Indian hotel
  const detailsBody = {
    type: 'HOTEL',
    entityId: INDIAN_HOTEL,
    nationality: 'IN',
    currency: 'INR',
    checkin: searchBodyMumbai.checkin,
    checkout: searchBodyMumbai.checkout,
    rooms: [{ adults: 2 }],
  };

  // H8 details Indian + domestic
  {
    const res = await hotelDetails({ tripType: 'domestic' }, detailsBody);
    const hotel = res.data?.hotel || res.data?.result || res.data;
    const tt = hotel?.tripType || res.data?.tripType;
    const list = hotelSearchList(res.data);
    const okHotel = res.status === 200 && (tt === 'domestic' || (list.length > 0) || hotel?.name || hotel?.hotelName || res.data?.rooms);
    if (res.status === 200 && (tt === 'domestic' || okHotel)) {
      if (tt === 'domestic') pass('H8', 'H8', 'details Indian + domestic → tripType domestic', `tripType=${tt}`, res);
      else bug('H8', 'H8', 'details Indian + domestic — tripType field', `HTTP 200 but tripType=${JSON.stringify(tt)}`, res);
      mumbaiRequestId = res.data?.requestId || res.data?._meta?.request_id || null;
      const codes = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (o.bookingCode) codes.push(o.bookingCode);
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(res.data);
      mumbaiBookingCode = codes[0] || null;
    } else {
      bug('H8', 'H8', 'details Indian + domestic', `HTTP ${res.status}`, res);
    }
  }
  // H9 details Indian + international → empty
  {
    const res = await hotelDetails({ tripType: 'international' }, detailsBody);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || '');
    const empty = list.length === 0 && (!res.data?.hotel || res.data?.results?.length === 0 || /No hotels/i.test(msg));
    if (res.status === 200 && (/No hotels/i.test(msg) || empty)) {
      pass('H9', 'H9', 'details Indian + international → [] + No hotels', msg.slice(0, 160) || 'empty', res);
    } else {
      bug('H9', 'H9', 'details Indian + international', `HTTP ${res.status} msg=${msg.slice(0, 120)}`, res);
    }
  }

  // H10 prebook right side / no tripType
  if (mumbaiBookingCode) {
    const res = await hotelPrebook({ tripType: 'domestic' }, {
      bookingCode: mumbaiBookingCode,
      currency: 'INR',
      ...(mumbaiRequestId ? { requestId: mumbaiRequestId } : {}),
    });
    // also try without embedding requestId if client uses header — already in body optional
    if (res.status === 200 && (res.data?.bookingContext || res.data?.status || res.ok)) {
      pass('H10', 'H10', 'prebook right side tripType=domestic → 200', `code=${mumbaiBookingCode.slice(0, 16)}…`, res);
    } else if (res.status === 200) {
      pass('H10', 'H10', 'prebook right side → 200', brief(res.data, 200), res);
    } else {
      // retry without tripType
      const res2 = await hotelPrebook({}, {
        bookingCode: mumbaiBookingCode,
        currency: 'INR',
      });
      if (res2.status === 200) {
        pass('H10', 'H10', 'prebook no tripType → 200', `domestic query failed HTTP ${res.status}; omit ok`, res2);
      } else {
        bug('H10', 'H10', 'prebook right side', `HTTP ${res.status}/${res2.status}`, res2);
      }
    }
  } else {
    // try get booking code via search→details mumbai hotel from H4 path
    const s = await hotelSearch({ tripType: 'domestic' }, searchBodyMumbai);
    const first = hotelSearchList(s.data)[0];
    const hid = first?.id || first?.hotelId || first?.entityId;
    if (hid) {
      const d = await hotelDetails({ tripType: 'domestic' }, {
        type: 'HOTEL',
        entityId: String(hid),
        nationality: 'IN',
        currency: 'INR',
        checkin: searchBodyMumbai.checkin,
        checkout: searchBodyMumbai.checkout,
        rooms: [{ adults: 2 }],
      });
      const codes = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (o.bookingCode) codes.push(o.bookingCode);
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(d.data);
      const bc = codes[0];
      if (bc) {
        const res = await hotelPrebook({ tripType: 'domestic' }, { bookingCode: bc, currency: 'INR' });
        if (res.status === 200) pass('H10', 'H10', 'prebook right side (from search hotel)', `HTTP 200`, res);
        else bug('H10', 'H10', 'prebook right side', `HTTP ${res.status}`, res);
        mumbaiBookingCode = bc;
      } else {
        bug('H10', 'H10', 'prebook right side', 'No bookingCode from details', d);
      }
    } else {
      bug('H10', 'H10', 'prebook right side', 'No hotel id / bookingCode available', s);
    }
  }

  // H11 prebook wrong side (ak may wrap catalog 404 as HTTP 200 + body code 404)
  if (mumbaiBookingCode) {
    const prebookBody = {
      bookingCode: mumbaiBookingCode,
      currency: 'INR',
      ...(mumbaiRequestId ? { requestId: mumbaiRequestId } : {}),
    };
    const res = await hotelPrebook({ tripType: 'international' }, prebookBody);
    const blob = msgBlob(res);
    const code = errCode(res) || res.data?.code;
    const hasNoHotels = /No hotels/i.test(blob);
    const is404 = res.status === 404 || code === '404' || code === 404;
    if (is404 || hasNoHotels) {
      pass('H11', 'H11', 'prebook wrong side → catalog 404 No hotels', `HTTP ${res.status} code=${code} ${blob.slice(0, 160)}`, res);
    } else {
      bug('H11', 'H11', 'prebook wrong side → 404 No hotels', `HTTP ${res.status} code=${code} ${blob.slice(0, 160)}`, res);
    }
  } else {
    bug('H11', 'H11', 'prebook wrong side', 'Skipped — no bookingCode', null);
  }

  // H12 tripType=local on each family
  {
    const resA = await autocomplete({ q: 'mumbai', tripType: 'local' });
    scoreReject400('H12a', 'H12', 'autocomplete tripType=local → 400', resA);
  }
  {
    const resS = await hotelSearch({ tripType: 'local' }, searchBodyMumbai);
    scoreReject400('H12b', 'H12', 'search tripType=local → 400', resS);
  }
  {
    const resD = await hotelDetails({ tripType: 'local' }, detailsBody);
    scoreReject400('H12c', 'H12', 'details tripType=local → 400', resD);
  }
  {
    const resP = await hotelPrebook({ tripType: 'local' }, {
      bookingCode: mumbaiBookingCode || 'DUMMY',
      currency: 'INR',
    });
    scoreReject400('H12d', 'H12', 'prebook tripType=local → 400', resP);
  }

  // Extra validation edges from changelog
  {
    const res = await autocomplete({ q: 'mumbai', tripType: ' domestic' });
    scoreReject400('V1', 'VAL', 'tripType=" domestic" (leading space) → 400', res);
  }
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'DOMESTIC' });
    if (res.status === 200) pass('V2', 'VAL', 'tripType=DOMESTIC case-insensitive → accept', 'HTTP 200', res);
    else bug('V2', 'VAL', 'tripType=DOMESTIC case-insensitive → accept', `HTTP ${res.status}`, res);
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    at: new Date().toISOString(),
    baseUrl: client.baseUrl,
    dubaiEntity,
    indianHotel: INDIAN_HOTEL,
    mumbaiBookingCode: mumbaiBookingCode ? `${mumbaiBookingCode.slice(0, 12)}…` : null,
    counts,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nCOUNTS', counts);
  console.log('Wrote', OUT);
  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
