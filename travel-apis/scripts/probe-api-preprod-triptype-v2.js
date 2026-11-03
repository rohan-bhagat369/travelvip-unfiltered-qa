/**
 * tripType Filter – updated changelog on api-preprod (prod-style vgm creds).
 * NO book / finalize / issue-ticket.
 *
 *   $env:BASE_URL='https://api-preprod.travelvip.ai'
 *   node travel-apis/scripts/probe-api-preprod-triptype-v2.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../shared/lib/authService.js';
import { futureDate, sleep } from '../../shared/lib/testUtils.js';
import {
  buildSelectionPayload,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../flight/src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-preprod.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../reports', process.env.AK_TRIPTYPE_OUT || 'api-preprod-triptype-v2.json');

const MUMBAI = process.env.AK_HOTEL_CITY_ENTITY || '357389:IN';
const PUNE_FALLBACK = '328605:IN';
const INDIAN_HOTEL = process.env.AK_INDIAN_HOTEL_ID || '39624369';
const DEP = futureDate(45);
const RET = futureDate(52);

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function errMsg(r) {
  return String(r?.data?.error?.message || r?.data?.message || '');
}
function errDetails(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function errText(r) {
  return `${errDetails(r).join(' | ')} | ${errMsg(r)}`;
}
function respTripType(r) {
  const t = r?.data?.tripType ?? r?.data?.data?.tripType;
  return t == null ? null : String(t);
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
function flightHasResults(r) {
  const d = r?.data;
  if (!d) return false;
  if (Array.isArray(d?.onwardFlights) && d.onwardFlights.length) return true;
  if (Array.isArray(d?.flights) && d.flights.length) return true;
  if (Array.isArray(d?.results) && d.results.length) return true;
  if (d?.searchId || d?.data?.searchId) return true;
  if (d?.progress || d?.data?.progress) return true;
  return Boolean(r?.ok && r.status === 200);
}
function walkCodes(o, codes = []) {
  if (!o || typeof o !== 'object') return codes;
  if (o.bookingCode) codes.push(o.bookingCode);
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((x) => walkCodes(x, codes));
    else if (v && typeof v === 'object') walkCodes(v, codes);
  }
  return codes;
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL, 'tier', process.env.TIER_ID);
  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);

  const rows = [];
  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} — ${row.note}`);
  }
  function pass(id, rule, note, res, extra = {}) {
    add({
      id, rule, status: 'PASS', note,
      http: res?.status ?? null, code: errCode(res),
      details: errDetails(res), snippet: brief(res?.data), ...extra,
    });
  }
  function bug(id, rule, note, res, extra = {}) {
    add({
      id, rule, status: 'BUG', note,
      http: res?.status ?? null, code: errCode(res),
      details: errDetails(res), snippet: brief(res?.data), ...extra,
    });
  }
  function nt(id, rule, note) {
    add({ id, rule, status: 'NOT TESTED', note, http: null, code: null });
  }

  function expectInvalidTripType(id, rule, res) {
    const code = errCode(res);
    const text = errText(res);
    if (res.status === 400 && code === 'INVALID_TRIP_TYPE') {
      pass(id, rule, `INVALID_TRIP_TYPE ${text.slice(0, 160)}`, res);
    } else if (res.status === 400 && code === 'VALIDATION_ERROR') {
      bug(id, rule, `Got VALIDATION_ERROR (expected INVALID_TRIP_TYPE): ${text.slice(0, 160)}`, res);
    } else {
      bug(id, rule, `Expected 400 INVALID_TRIP_TYPE, got HTTP ${res.status} code=${code}`, res);
    }
  }

  function expectMismatch(id, rule, res) {
    const code = errCode(res);
    const text = errText(res);
    if (res.status === 400 && code === 'TRIP_TYPE_MISMATCH') {
      pass(id, rule, `TRIP_TYPE_MISMATCH ${text.slice(0, 180)}`, res);
    } else {
      bug(id, rule, `Expected 400 TRIP_TYPE_MISMATCH, got HTTP ${res.status} code=${code} ${text.slice(0, 120)}`, res);
    }
  }

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
  const owIntlMismatch = {
    ...owBody,
    itinerary: [{ origin: 'DEL', destination: 'DXB', date: DEP }],
  };

  async function flightSearch(query, body) {
    return client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { page: 0, perpage: 20, currency: 'INR', lang: 'en', ...query },
      body,
    });
  }

  async function pollSearch(query, body, { max = 8 } = {}) {
    let last = null;
    for (let i = 0; i < max; i += 1) {
      last = await flightSearch(query, body);
      if (last.status !== 200) return last;
      if (isSearchProgressComplete(last.data) || extractFirstSearchId(last.data) || flightHasResults(last)) {
        return last;
      }
      await sleep(2500);
    }
    return last;
  }

  // ─── F1–F8 Flight search ───────────────────────────────────────────
  let f1Res = null;
  {
    f1Res = await pollSearch({ tripType: 'domestic' }, owBody);
    const tt = respTripType(f1Res);
    if (f1Res.status === 200 && flightHasResults(f1Res) && String(tt).toUpperCase() === 'DOMESTIC') {
      pass('F1', 'domestic DEL→BOM → 200 + tripType DOMESTIC', `HTTP 200 tripType=${tt}`, f1Res);
    } else if (f1Res.status === 200 && flightHasResults(f1Res)) {
      bug('F1', 'domestic DEL→BOM → 200 + tripType DOMESTIC', `results ok but tripType=${JSON.stringify(tt)}`, f1Res);
    } else {
      bug('F1', 'domestic DEL→BOM → 200 + tripType DOMESTIC', `HTTP ${f1Res.status} tt=${tt}`, f1Res);
    }
  }
  {
    const res = await pollSearch({ tripType: 'international' }, rtBody);
    const tt = respTripType(res);
    if (res.status === 200 && flightHasResults(res) && String(tt).toUpperCase() === 'INTERNATIONAL') {
      pass('F2', 'international DEL→DXB RT → 200 + INTERNATIONAL', `HTTP 200 tripType=${tt}`, res);
    } else if (res.status === 200 && flightHasResults(res)) {
      bug('F2', 'international DEL→DXB RT → 200 + INTERNATIONAL', `results ok but tripType=${JSON.stringify(tt)}`, res);
    } else {
      bug('F2', 'international DEL→DXB RT → 200 + INTERNATIONAL', `HTTP ${res.status} tt=${tt}`, res);
    }
  }
  {
    const res = await pollSearch({ tripType: 'INTERNATIONAL' }, {
      ...owBody,
      itinerary: [{ origin: 'DEL', destination: 'DXB', date: DEP }],
    });
    const tt = respTripType(res);
    if (res.status === 200 && flightHasResults(res) && String(tt).toUpperCase() === 'INTERNATIONAL') {
      pass('F3', 'INTERNATIONAL upper DEL→DXB → 200', `HTTP 200 tripType=${tt}`, res);
    } else if (res.status === 200 && flightHasResults(res)) {
      bug('F3', 'INTERNATIONAL upper DEL→DXB → 200', `results ok but tripType=${JSON.stringify(tt)}`, res);
    } else {
      bug('F3', 'INTERNATIONAL upper DEL→DXB → 200', `HTTP ${res.status} tt=${tt}`, res);
    }
  }
  {
    const empty = await pollSearch({ tripType: '' }, owBody);
    const omit = await pollSearch({}, owBody);
    const ttE = respTripType(empty);
    const ttO = respTripType(omit);
    const okEmpty = empty.status === 200 && String(ttE).toUpperCase() === 'DOMESTIC';
    const okOmit = omit.status === 200 && String(ttO).toUpperCase() === 'DOMESTIC';
    if (okEmpty && okOmit) {
      pass('F4', 'empty/omit DEL→BOM → 200 tripType DOMESTIC', `empty=${ttE} omit=${ttO}`, empty);
    } else if (empty.status === 200 && omit.status === 200) {
      bug('F4', 'empty/omit DEL→BOM → 200 tripType DOMESTIC', `empty tt=${ttE} omit tt=${ttO}`, empty);
    } else {
      bug('F4', 'empty/omit DEL→BOM → 200 tripType DOMESTIC', `HTTP ${empty.status}/${omit.status}`, empty);
    }
  }
  {
    const res = await flightSearch({ tripType: 'international' }, owBody); // DEL→BOM
    expectMismatch('F5', 'international + DEL→BOM → TRIP_TYPE_MISMATCH', res);
  }
  {
    const res = await flightSearch({ tripType: 'domestic' }, owIntlMismatch); // DEL→DXB
    expectMismatch('F6', 'domestic + DEL→DXB → TRIP_TYPE_MISMATCH', res);
  }
  {
    const res = await flightSearch({ tripType: 'local' }, owBody);
    expectInvalidTripType('F7', 'tripType=local → INVALID_TRIP_TYPE', res);
  }
  {
    const bad = { itinerary: owBody.itinerary, travellers: owBody.travellers }; // no journeyType
    const res = await flightSearch({ tripType: 'local' }, bad);
    const code = errCode(res);
    const details = errDetails(res);
    const onlyTrip = code === 'INVALID_TRIP_TYPE'
      && !details.some((d) => /journeyType/i.test(d))
      && !/journeyType/i.test(errMsg(res));
    if (res.status === 400 && onlyTrip) {
      pass('F8', 'local + no journeyType → INVALID_TRIP_TYPE only', `code=${code} details=${details.length}`, res);
    } else if (res.status === 400 && code === 'INVALID_TRIP_TYPE') {
      bug('F8', 'local + no journeyType → INVALID_TRIP_TYPE only', `got INVALID_TRIP_TYPE but body also mentioned: ${errText(res).slice(0, 180)}`, res);
    } else {
      bug('F8', 'local + no journeyType → INVALID_TRIP_TYPE only', `HTTP ${res.status} code=${code} ${errText(res).slice(0, 140)}`, res);
    }
  }

  // ─── F9 downstream after F1 (no tripType query) ────────────────────
  {
    const searchId = extractFirstSearchId(f1Res?.data);
    if (!searchId) {
      nt('F9', 'Details/FareRules/Pricing/SSR/Seatmap carry tripType', 'No searchId from F1');
    } else {
      const sel = buildSelectionPayload([searchId], 'ONE_WAY');
      const details = await client.request({
        method: 'POST', path: '/v1/flights/details',
        query: { lang: 'en', currency: 'INR' }, body: sel,
      });
      const fareRules = await client.request({
        method: 'POST', path: '/v1/flights/fareRules',
        query: { lang: 'en', currency: 'INR' }, body: sel,
      });
      const pricing = await client.request({
        method: 'POST', path: '/v1/flights/pricing',
        query: { lang: 'en', currency: 'INR' }, body: sel,
      });
      const priceId = pricing?.data?.priceId;
      const bookingContext = pricing?.data?.bookingContext;
      let ssr = null;
      let seatmap = null;
      if (priceId) {
        ssr = await client.request({
          method: 'POST', path: '/v1/flights/ssr',
          query: { currency: 'INR', lang: 'en' }, body: { priceId },
        });
      }
      if (bookingContext) {
        seatmap = await client.request({
          method: 'POST', path: '/v1/flights/seatmap',
          query: { lang: 'en', currency: 'INR' },
          body: {
            currency: 'INR',
            requestReference: bookingContext,
            passengers: [{ type: 'ADT', id: 1 }],
          },
        });
      }
      const checks = [
        ['details', details],
        ['fareRules', fareRules],
        ['pricing', pricing],
        ['ssr', ssr],
        ['seatmap', seatmap],
      ];
      const notes = [];
      let allOk = true;
      for (const [name, res] of checks) {
        if (!res) {
          notes.push(`${name}=skipped`);
          continue;
        }
        const tt = respTripType(res);
        const ok = res.status === 200 && String(tt || '').toUpperCase() === 'DOMESTIC';
        notes.push(`${name}:HTTP${res.status}/tt=${tt}`);
        if (!ok) allOk = false;
      }
      if (allOk) pass('F9', 'downstream APIs carry tripType without passing it', notes.join('; '), details);
      else bug('F9', 'downstream APIs carry tripType without passing it', notes.join('; '), details);
    }
  }

  // ─── Airports A1–A6 ────────────────────────────────────────────────
  async function airports(p, query) {
    return client.request({ method: 'GET', path: p, query });
  }
  async function airportsRaw(p, search) {
    return client.request({ method: 'GET', path: `${p}?${search}`, query: {} });
  }

  {
    const res = await airports('/v1/flights/airports', { airport: 'del', tripType: 'domestic' });
    const list = airportRows(res.data);
    const foreign = list.filter((a) => {
      const cc = String(a?.countryCode || a?.country_code || '').toUpperCase();
      return cc && cc !== 'IN';
    });
    if (res.status === 200 && list.length > 0 && foreign.length === 0) {
      pass('A1', 'del+domestic → Indian only', `n=${list.length}`, res);
    } else bug('A1', 'del+domestic → Indian only', `HTTP ${res.status} n=${list.length} foreign=${foreign.length}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'dubai', tripType: 'international' });
    const list = airportRows(res.data);
    if (res.status === 200 && list.length > 0) pass('A2', 'dubai+international → list', `n=${list.length}`, res);
    else bug('A2', 'dubai+international → list', `HTTP ${res.status} n=${list.length}`, res);
  }
  {
    const res = await airportsRaw('/v1/flights/airports', 'airport=del&tripType=');
    if (res.status === 200) pass('A3', 'del+tripType= empty → 200', `n=${airportRows(res.data).length}`, res);
    else bug('A3', 'del+tripType= empty → 200', `HTTP ${res.status} code=${errCode(res)}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'del' });
    if (res.status === 200) pass('A4', 'del omit tripType → 200', `n=${airportRows(res.data).length}`, res);
    else bug('A4', 'del omit tripType → 200', `HTTP ${res.status}`, res);
  }
  {
    const res = await airports('/api/v2/flights/airports', { airport: 'del', tripType: 'xyz' });
    expectInvalidTripType('A5', 'tripType=xyz → INVALID_TRIP_TYPE', res);
  }
  {
    const res = await airports('/api/v2/flight/airports', { airport: 'del', tripType: 'domestic' });
    if (res.status === 200) pass('A5b', 'v2/flight/airports domestic → 200', `n=${airportRows(res.data).length}`, res);
    else bug('A5b', 'v2/flight/airports domestic → 200', `HTTP ${res.status}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { tripType: 'domestic' });
    const code = errCode(res);
    if (res.status === 400 && (code === 'MISSING_AIRPORT' || /airport/i.test(errText(res)))) {
      pass('A6', 'no airport → MISSING_AIRPORT', `code=${code}`, res);
    } else bug('A6', 'no airport → MISSING_AIRPORT', `HTTP ${res.status} code=${code}`, res);
  }

  // ─── Hotels autocomplete / search / details / prebook ──────────────
  async function autocomplete(query) {
    return client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 10, ...query },
    });
  }
  async function autocompleteRaw(search) {
    return client.request({ method: 'GET', path: `/v1/hotels/autocomplete?${search}`, query: {} });
  }
  async function hotelSearch(query, body) {
    return client.request({
      method: 'POST', path: '/v1/hotels/search',
      query: { offset: 0, limit: 10, ...query }, body,
    });
  }
  async function hotelDetails(query, body) {
    return client.request({ method: 'POST', path: '/v1/hotels/details', query: { ...query }, body });
  }
  async function hotelPrebook(query, body) {
    return client.request({ method: 'POST', path: '/v1/hotels/prebook', query: { ...query }, body });
  }

  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    const topTt = res.data?.tripType;
    const allIn = list.length > 0 && list.every(hotelIsIndia);
    if (res.status === 200 && allIn && topTt === 'domestic') {
      pass('H1', 'autocomplete mumbai domestic', `n=${list.length} tripType=domestic`, res);
    } else bug('H1', 'autocomplete mumbai domestic', `HTTP ${res.status} n=${list.length} tt=${topTt}`, res);
  }
  {
    const res = await autocomplete({ q: 'dubai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    const empty = res.data?.empty === true || list.length === 0;
    if (res.status === 200 && empty) pass('H2', 'autocomplete dubai domestic → empty', `empty=${res.data?.empty}`, res);
    else bug('H2', 'autocomplete dubai domestic → empty', `HTTP ${res.status} n=${list.length}`, res);
  }
  {
    const omit = await autocomplete({ q: 'dubai' });
    const empty = await autocompleteRaw('q=dubai&tripType=&page=0&perpage=10&lang=en&currency=INR');
    const list = hotelAutoRows(omit.data);
    const tt = omit.data?.tripType;
    if (omit.status === 200 && list.length > 0 && (tt === null || tt === undefined) && empty.status === 200) {
      pass('H3', 'dubai omit/empty → tripType null', `n=${list.length} tt=${JSON.stringify(tt)}`, omit);
    } else bug('H3', 'dubai omit/empty → tripType null', `HTTP ${omit.status}/${empty.status} tt=${JSON.stringify(tt)}`, omit);
  }
  {
    const res = await autocomplete({ q: 'DUBAI', tripType: 'INTERNATIONAL' });
    const list = hotelAutoRows(res.data);
    if (res.status === 200 && list.length > 0) {
      pass('H13', 'DUBAI + INTERNATIONAL upper → 200', `n=${list.length} tt=${res.data?.tripType}`, res);
    } else bug('H13', 'DUBAI + INTERNATIONAL upper → 200', `HTTP ${res.status} n=${list.length}`, res);
  }

  // Resolve inventory city (Mumbai first, Pune fallback)
  let cityEntity = MUMBAI;
  let checkin = futureDate(14);
  let checkout = futureDate(15);
  let searchBody = {
    type: 'CITY', entityId: cityEntity, nationality: 'IN', currency: 'INR',
    checkin, checkout, rooms: [{ adults: 2 }],
  };
  {
    let hit = false;
    for (const entity of [MUMBAI, PUNE_FALLBACK]) {
      for (const days of [7, 14, 21, 28, 35, 45, 60]) {
        const ci = futureDate(days);
        const co = futureDate(days + 1);
        const body = { ...searchBody, entityId: entity, checkin: ci, checkout: co };
        const res = await hotelSearch({ tripType: 'domestic' }, body);
        const list = hotelSearchList(res.data);
        if (res.status === 200 && list.length > 0) {
          cityEntity = entity;
          checkin = ci;
          checkout = co;
          searchBody = body;
          hit = true;
          console.log(`Hotel inventory hit entity=${entity} checkin=${ci} n=${list.length}`);
          break;
        }
      }
      if (hit) break;
    }
    if (!hit) console.log('No hotel inventory for Mumbai/Pune; continuing with Mumbai changelog entity');
  }

  let dubaiEntity = null;
  {
    const res = await autocomplete({ q: 'dubai' });
    const city = hotelAutoRows(res.data).find((r) => String(r.type || '').toUpperCase() === 'CITY')
      || hotelAutoRows(res.data)[0];
    dubaiEntity = city?.entityId || city?.id || '221688:AE';
    console.log('Dubai entityId', dubaiEntity);
  }

  {
    const res = await hotelSearch({ tripType: 'domestic' }, searchBody);
    const list = hotelSearchList(res.data);
    const topTt = res.data?.tripType;
    const allDom = list.length > 0 && list.every((h) => h.tripType === 'domestic');
    if (res.status === 200 && list.length > 0 && topTt === 'domestic' && allDom) {
      pass('H4', 'search India city domestic → hotels + tripType', `entity=${cityEntity} n=${list.length}`, res);
    } else if (res.status === 200 && list.length > 0) {
      bug('H4', 'search India city domestic → hotels + tripType', `n=${list.length} top=${topTt} allDom=${allDom}`, res);
    } else {
      bug('H4', 'search India city domestic → hotels + tripType', `HTTP ${res.status} n=0 entity=${cityEntity} msg=${String(res.data?.message || '').slice(0, 80)}`, res);
    }
  }
  {
    const res = await hotelSearch({ tripType: 'international' }, searchBody);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || '');
    if (res.status === 200 && list.length === 0 && /India|international/i.test(msg)) {
      pass('H5', 'India city + international → No hotels msg', msg.slice(0, 160), res);
    } else bug('H5', 'India city + international → No hotels msg', `n=${list.length} msg=${msg.slice(0, 120)}`, res);
  }
  {
    const body = {
      type: 'CITY', entityId: dubaiEntity, nationality: 'IN', currency: 'INR',
      checkin, checkout, rooms: [{ adults: 2 }],
    };
    const res = await hotelSearch({ tripType: 'domestic' }, body);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || '');
    if (res.status === 200 && list.length === 0 && /outside India|domestic/i.test(msg)) {
      pass('H6', 'Dubai + domestic → No hotels msg', msg.slice(0, 160), res);
    } else bug('H6', 'Dubai + domestic → No hotels msg', `n=${list.length} msg=${msg.slice(0, 120)}`, res);
  }
  {
    const res = await hotelSearch({}, searchBody);
    const list = hotelSearchList(res.data);
    const withTt = list.filter((h) => h.tripType != null).length;
    if (res.status === 200 && list.length > 0) {
      pass('H7', 'search no tripType → hotels with tripType', `n=${list.length} withTripType=${withTt}`, res);
    } else if (res.status === 200) {
      pass('H7', 'search no tripType → 200 (inventory empty)', `n=0`, res);
    } else bug('H7', 'search no tripType', `HTTP ${res.status}`, res);
  }

  // Prefer live hotel from search; fallback to fixed id
  let hotelId = INDIAN_HOTEL;
  {
    const list = hotelSearchList((await hotelSearch({ tripType: 'domestic' }, searchBody)).data);
    if (list[0]) hotelId = String(list[0].id || list[0].hotelId || list[0].entityId || INDIAN_HOTEL);
  }
  const detailsBody = {
    type: 'HOTEL', entityId: hotelId, nationality: 'IN', currency: 'INR',
    checkin, checkout, rooms: [{ adults: 2 }],
  };
  let bookingCode = null;
  let requestId = null;

  {
    const res = await hotelDetails({ tripType: 'domestic' }, detailsBody);
    const tt = res.data?.tripType || res.data?.hotel?.tripType || res.data?.results?.[0]?.tripType;
    const codes = walkCodes(res.data);
    bookingCode = codes[0] || null;
    requestId = res.data?.requestId || res.data?._meta?.request_id || null;
    if (res.status === 200 && (tt === 'domestic' || codes.length > 0)) {
      pass('H8', 'details Indian + domestic', `hotel=${hotelId} tripType=${tt} codes=${codes.length}`, res);
    } else bug('H8', 'details Indian + domestic', `HTTP ${res.status} hotel=${hotelId} tt=${tt}`, res);
  }
  {
    const res = await hotelDetails({ tripType: 'international' }, detailsBody);
    const msg = String(res.data?.message || '');
    const list = hotelSearchList(res.data);
    if (res.status === 200 && (list.length === 0 || /No hotels/i.test(msg)) && /No hotels|international/i.test(msg + brief(res.data))) {
      pass('H9', 'details Indian + international → No hotels', msg.slice(0, 160) || 'empty', res);
    } else bug('H9', 'details Indian + international → No hotels', `HTTP ${res.status} msg=${msg.slice(0, 120)}`, res);
  }

  // H10 / H11 prebook only — NO finalize/book
  if (bookingCode) {
    const body = {
      bookingCode,
      currency: 'INR',
      ...(requestId ? { requestId } : {}),
    };
    {
      const res = await hotelPrebook({ tripType: 'domestic' }, body);
      if (res.status === 200) pass('H10', 'prebook right side domestic → 200', `code=${bookingCode.slice(0, 16)}…`, res);
      else bug('H10', 'prebook right side domestic → 200', `HTTP ${res.status}`, res);
    }
    {
      const res = await hotelPrebook({ tripType: 'international' }, body);
      const blob = brief(res.data, 300);
      const code = errCode(res) || res.data?.code;
      const ok = /No hotels/i.test(blob) || code === '404' || code === 404 || res.status === 404;
      if (ok) pass('H11', 'prebook wrong side → 404 No hotels', `HTTP ${res.status} code=${code}`, res);
      else bug('H11', 'prebook wrong side → 404 No hotels', `HTTP ${res.status} code=${code} ${blob.slice(0, 140)}`, res);
    }
  } else {
    bug('H10', 'prebook right side', 'No bookingCode from details', null);
    bug('H11', 'prebook wrong side', 'Skipped — no bookingCode', null);
  }

  // H12 INVALID_TRIP_TYPE on all four (before body validation)
  {
    expectInvalidTripType('H12a', 'autocomplete tripType=local → INVALID_TRIP_TYPE',
      await autocomplete({ q: 'mumbai', tripType: 'local' }));
  }
  {
    expectInvalidTripType('H12b', 'search tripType=local → INVALID_TRIP_TYPE',
      await hotelSearch({ tripType: 'local' }, searchBody));
  }
  {
    expectInvalidTripType('H12c', 'details tripType=local → INVALID_TRIP_TYPE',
      await hotelDetails({ tripType: 'local' }, detailsBody));
  }
  {
    const res = await hotelPrebook({ tripType: 'local' }, {
      bookingCode: bookingCode || 'DUMMY',
      currency: 'INR',
    });
    // Must be INVALID_TRIP_TYPE only — not requestId body error first
    const code = errCode(res);
    if (res.status === 400 && code === 'INVALID_TRIP_TYPE') {
      pass('H12d', 'prebook tripType=local → INVALID_TRIP_TYPE (before body)', errText(res).slice(0, 160), res);
    } else {
      bug('H12d', 'prebook tripType=local → INVALID_TRIP_TYPE (before body)', `HTTP ${res.status} code=${code} ${errText(res).slice(0, 140)}`, res);
    }
  }

  // Extra validation table edges
  {
    expectInvalidTripType('V1', 'tripType=" domestic" → INVALID_TRIP_TYPE',
      await autocomplete({ q: 'mumbai', tripType: ' domestic' }));
  }
  {
    expectInvalidTripType('V2', 'tripType=abc → INVALID_TRIP_TYPE',
      await autocomplete({ q: 'mumbai', tripType: 'abc' }));
  }
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'DOMESTIC' });
    if (res.status === 200) pass('V3', 'DOMESTIC case accepted', `tt=${res.data?.tripType}`, res);
    else bug('V3', 'DOMESTIC case accepted', `HTTP ${res.status}`, res);
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    at: new Date().toISOString(),
    baseUrl: client.baseUrl || process.env.BASE_URL,
    cityEntity,
    hotelId,
    checkin,
    checkout,
    bookingCode: bookingCode ? `${bookingCode.slice(0, 12)}…` : null,
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
