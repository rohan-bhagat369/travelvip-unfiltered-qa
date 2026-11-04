/**
 * tripType lowercase everywhere — delta-api (staging creds, delta base URL).
 * Covers flights (OW/RT domestic+intl → search/pricing/details/fareRules/SSR/seatmap),
 * input casing, mismatch/invalid errors, hotels autocomplete/listing/prebook, airports.
 * NO book / finalize / issue-ticket.
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   node travel-apis/scripts/probe-delta-triptype-lowercase.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../shared/lib/authService.js';
import { futureDate, sleep } from '../../shared/lib/testUtils.js';
import {
  buildSelectionPayload,
  extractFirstSearchId,
  extractDirectionSearchId,
  isSearchProgressComplete,
} from '../flight/src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://delta-api.travelvip.ai';
// Staging partner defaults (override via .env / shell if needed)
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.TIER_ID = process.env.TIER_ID || '10546901';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.resolve(__dirname, '../reports', process.env.DELTA_TRIPTYPE_OUT || 'delta-triptype-lowercase.json');
const OUT_MD = OUT_JSON.replace(/\.json$/i, '.md');

const MUMBAI = process.env.AK_HOTEL_CITY_ENTITY || '357389:IN';
const PUNE_FALLBACK = '328605:IN';
const INDIAN_HOTEL = process.env.AK_INDIAN_HOTEL_ID || '39624369';
const DEP = futureDate(45);
const RET = futureDate(52);

function brief(d, n = 420) {
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
function decodeBookingContext(bc) {
  if (bc == null) return null;
  if (typeof bc === 'object') return bc;
  const s = String(bc);
  // try JSON first
  try { return JSON.parse(s); } catch { /* continue */ }
  // try base64url / base64 JSON
  try {
    const pad = s.length % 4 === 0 ? s : s + '='.repeat(4 - (s.length % 4));
    const raw = Buffer.from(pad.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return { _raw: s.slice(0, 80) };
  }
}
function bookingContextTripType(pricingRes) {
  const data = pricingRes?.data || {};
  if (data.tripType != null) return String(data.tripType);
  const decoded = decodeBookingContext(data.bookingContext);
  if (decoded && typeof decoded === 'object' && decoded.tripType != null) {
    return String(decoded.tripType);
  }
  // some envs nest under bookingContext.tripType after parse of nested fields
  if (decoded && typeof decoded === 'object') {
    const nested = decoded.tripType || decoded?.selection?.tripType || decoded?.meta?.tripType;
    if (nested != null) return String(nested);
  }
  return null;
}
function isLowerTripType(v, expected) {
  return v === expected; // exact lowercase match
}
function hasUpperTripTypeLeak(text) {
  return /\bDOMESTIC\b|\bINTERNATIONAL\b/.test(String(text || ''));
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
  if (extractFirstSearchId(d)) return true;
  if (Array.isArray(d?.onwardFlights) && d.onwardFlights.length) return true;
  if (Array.isArray(d?.returnFlights) && d.returnFlights.length) return true;
  if (Array.isArray(d?.flights) && d.flights.length) return true;
  if (Array.isArray(d?.results) && d.results.some((block) => Array.isArray(block?.options) && block.options.length)) {
    return true;
  }
  return false;
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
function collectSearchIds(data, journeyType) {
  if (journeyType === 'ROUND_TRIP') {
    const on = extractDirectionSearchId(data, 'ONWARD');
    const ret = extractDirectionSearchId(data, 'RETURN');
    if (on && ret) return [on, ret];
  }
  const one = extractFirstSearchId(data);
  return one ? [one] : [];
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL, 'tier', process.env.TIER_ID, 'partner', process.env.PARTNER_ID);
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
    const msgLowerOk = !hasUpperTripTypeLeak(text)
      && (/domestic|international|tripType|trip type|invalid/i.test(text) || code === 'INVALID_TRIP_TYPE' || code === 'VALIDATION_ERROR');
    if (res.status === 400 && (code === 'INVALID_TRIP_TYPE' || code === 'VALIDATION_ERROR') && msgLowerOk) {
      if (hasUpperTripTypeLeak(text)) {
        bug(id, rule, `error ok but message still uses UPPERCASE: ${text.slice(0, 180)}`, res);
      } else {
        pass(id, rule, `${code} ${text.slice(0, 160)}`, res);
      }
    } else if (res.status === 400 && hasUpperTripTypeLeak(text)) {
      bug(id, rule, `400 but message uses UPPERCASE (expected lowercase): ${text.slice(0, 180)}`, res);
    } else {
      bug(id, rule, `Expected 400 invalid tripType (lowercase msg), got HTTP ${res.status} code=${code} ${text.slice(0, 120)}`, res);
    }
  }

  function expectMismatch(id, rule, res) {
    const code = errCode(res);
    const text = errText(res);
    if (res.status === 400 && (code === 'TRIP_TYPE_MISMATCH' || code === 'VALIDATION_ERROR')) {
      if (hasUpperTripTypeLeak(text)) {
        bug(id, rule, `mismatch code ok but message UPPERCASE: ${text.slice(0, 180)}`, res);
      } else {
        pass(id, rule, `${code} ${text.slice(0, 180)}`, res);
      }
    } else {
      bug(id, rule, `Expected 400 mismatch, got HTTP ${res.status} code=${code} ${text.slice(0, 120)}`, res);
    }
  }

  const owDomBody = {
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
  const rtDomBody = {
    journeyType: 'ROUND_TRIP',
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: DEP },
      { origin: 'BOM', destination: 'DEL', date: RET },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
  const owIntlBody = {
    ...owDomBody,
    itinerary: [{ origin: 'DEL', destination: 'DXB', date: DEP }],
  };
  const rtIntlBody = {
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
      query: { page: 0, perpage: 20, currency: 'INR', lang: 'en', ...query },
      body,
    });
  }

  async function pollSearch(query, body, { max = 12 } = {}) {
    let last = null;
    for (let i = 0; i < max; i += 1) {
      last = await flightSearch(query, body);
      if (last.status !== 200) return last;
      if (extractFirstSearchId(last.data) || flightHasResults(last)) return last;
      if (isSearchProgressComplete(last.data) && !extractFirstSearchId(last.data)) return last;
      await sleep(2500);
    }
    return last;
  }

  /** Retry search on NO_FLIGHTS_FOUND / empty by stepping dates (+7 days). */
  async function pollSearchWithDateRetry(query, body, { maxAttempts = 4 } = {}) {
    let attemptBody = structuredClone(body);
    let last = null;
    for (let a = 0; a < maxAttempts; a += 1) {
      last = await pollSearch(query, attemptBody);
      if (last.status === 200 && extractFirstSearchId(last.data)) return last;
      const code = errCode(last);
      if (last.status === 400 && code && code !== 'NO_FLIGHTS_FOUND') return last;
      // step itinerary dates +7
      attemptBody = structuredClone(attemptBody);
      attemptBody.itinerary = (attemptBody.itinerary || []).map((leg) => {
        const d = new Date(`${leg.date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 7);
        return { ...leg, date: d.toISOString().slice(0, 10) };
      });
      console.log(`search retry ${a + 1} dates`, attemptBody.itinerary.map((x) => x.date).join(','));
    }
    return last;
  }

  async function runDownstream(idPrefix, rulePrefix, searchRes, expectedTt, journeyType) {
    const ids = collectSearchIds(searchRes?.data, journeyType);
    if (!ids.length) {
      nt(idPrefix, `${rulePrefix} downstream`, 'No searchId from search');
      return;
    }
    const sel = buildSelectionPayload(ids, journeyType);
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
    const bcTt = bookingContextTripType(pricing);
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
          passengers: [{ passengerType: 1, paxRefNumber: '1' }],
        },
      });
    }

    // Core tripType carriers (must be 200 + lowercase). Seatmap may be inventory-dependent.
    const core = [
      ['details', details],
      ['fareRules', fareRules],
      ['pricing', pricing],
      ['ssr', ssr],
    ];
    const notes = [];
    let allOk = true;
    for (const [name, res] of core) {
      if (!res) {
        notes.push(`${name}=skipped`);
        allOk = false;
        continue;
      }
      // one pricing retry on transient vendor fail
      let use = res;
      if (name === 'pricing' && use.status !== 200) {
        await sleep(1500);
        use = await client.request({
          method: 'POST', path: '/v1/flights/pricing',
          query: { lang: 'en', currency: 'INR' }, body: sel,
        });
        if (use.status === 200) {
          // refresh ssr/seatmap if pricing recovered
          const pid = use?.data?.priceId;
          const bc = use?.data?.bookingContext;
          if (pid) {
            ssr = await client.request({
              method: 'POST', path: '/v1/flights/ssr',
              query: { currency: 'INR', lang: 'en' }, body: { priceId: pid },
            });
          }
          if (bc) {
            seatmap = await client.request({
              method: 'POST', path: '/v1/flights/seatmap',
              query: { lang: 'en', currency: 'INR' },
              body: {
                currency: 'INR',
                requestReference: bc,
                passengers: [{ passengerType: 1, paxRefNumber: '1' }],
              },
            });
          }
        }
      }
      const tt = respTripType(use);
      const ok = use.status === 200 && isLowerTripType(tt, expectedTt);
      notes.push(`${name}:HTTP${use.status}/tt=${tt}`);
      if (!ok) allOk = false;
      if (name === 'pricing') {
        // refresh bcTt from possibly retried pricing
        const refreshed = bookingContextTripType(use);
        if (refreshed) notes.push(`bookingContext.tripType=${refreshed}`);
        else notes.push(`bookingContext.tripType=${bcTt}`);
      }
    }
    if (seatmap) {
      const stt = respTripType(seatmap);
      if (seatmap.status === 200) {
        notes.push(`seatmap:HTTP200/tt=${stt}`);
        if (!isLowerTripType(stt, expectedTt)) allOk = false;
      } else {
        // seatmap availability / vendor — not a tripType casing fail if core passed
        notes.push(`seatmap:HTTP${seatmap.status}/code=${errCode(seatmap)} (non-blocking)`);
      }
    } else {
      notes.push('seatmap=skipped');
    }

    const priceTt = (() => {
      const p = core.find(([n]) => n === 'pricing')?.[1];
      return respTripType(p);
    })();
    const finalBc = notes.find((n) => n.startsWith('bookingContext.tripType='))?.split('=')[1] || bcTt;

    if (allOk && (isLowerTripType(finalBc, expectedTt) || isLowerTripType(priceTt, expectedTt) || isLowerTripType(respTripType(pricing), expectedTt))) {
      pass(idPrefix, `${rulePrefix} → details/fareRules/pricing/SSR/seatmap lowercase`, notes.join('; '), details, {
        bookingContextTripType: finalBc,
        priceTripType: respTripType(pricing),
      });
    } else {
      bug(idPrefix, `${rulePrefix} → details/fareRules/pricing/SSR/seatmap lowercase`, notes.join('; '), details || pricing, {
        bookingContextTripType: finalBc,
        pricingSnippet: brief(pricing?.data),
      });
    }
  }

  // ─── F1–F4 happy search lowercase response ─────────────────────────
  let fOwDom = null;
  let fRtDom = null;
  let fOwIntl = null;
  let fRtIntl = null;

  {
    fOwDom = await pollSearchWithDateRetry({ tripType: 'domestic' }, owDomBody);
    const tt = respTripType(fOwDom);
    if (fOwDom.status === 200 && flightHasResults(fOwDom) && isLowerTripType(tt, 'domestic')) {
      pass('F1', 'OW domestic DEL→BOM search → tripType=domestic', `HTTP 200 tripType=${tt}`, fOwDom);
    } else {
      bug('F1', 'OW domestic DEL→BOM search → tripType=domestic', `HTTP ${fOwDom.status} tt=${JSON.stringify(tt)}`, fOwDom);
    }
  }
  {
    fRtDom = await pollSearchWithDateRetry({ tripType: 'domestic' }, rtDomBody);
    const tt = respTripType(fRtDom);
    if (fRtDom.status === 200 && flightHasResults(fRtDom) && isLowerTripType(tt, 'domestic')) {
      pass('F2', 'RT domestic DEL↔BOM search → tripType=domestic', `HTTP 200 tripType=${tt}`, fRtDom);
    } else {
      bug('F2', 'RT domestic DEL↔BOM search → tripType=domestic', `HTTP ${fRtDom.status} code=${errCode(fRtDom)} tt=${JSON.stringify(tt)}`, fRtDom);
    }
  }
  {
    fOwIntl = await pollSearchWithDateRetry({ tripType: 'international' }, owIntlBody);
    const tt = respTripType(fOwIntl);
    if (fOwIntl.status === 200 && flightHasResults(fOwIntl) && isLowerTripType(tt, 'international')) {
      pass('F3', 'OW international DEL→DXB search → tripType=international', `HTTP 200 tripType=${tt}`, fOwIntl);
    } else {
      bug('F3', 'OW international DEL→DXB search → tripType=international', `HTTP ${fOwIntl.status} tt=${JSON.stringify(tt)}`, fOwIntl);
    }
  }
  {
    fRtIntl = await pollSearchWithDateRetry({ tripType: 'international' }, rtIntlBody);
    const tt = respTripType(fRtIntl);
    if (fRtIntl.status === 200 && flightHasResults(fRtIntl) && isLowerTripType(tt, 'international')) {
      pass('F4', 'RT international DEL↔DXB search → tripType=international', `HTTP 200 tripType=${tt}`, fRtIntl);
    } else {
      bug('F4', 'RT international DEL↔DXB search → tripType=international', `HTTP ${fRtIntl.status} tt=${JSON.stringify(tt)}`, fRtIntl);
    }
  }

  // ─── F5–F7 input casing ────────────────────────────────────────────
  for (const [id, casing] of [['F5a', 'domestic'], ['F5b', 'Domestic'], ['F5c', 'DOMESTIC']]) {
    const res = await pollSearch({ tripType: casing }, owDomBody);
    const tt = respTripType(res);
    if (res.status === 200 && flightHasResults(res) && isLowerTripType(tt, 'domestic')) {
      pass(id, `input tripType=${casing} → response domestic`, `tt=${tt}`, res);
    } else {
      bug(id, `input tripType=${casing} → response domestic`, `HTTP ${res.status} tt=${JSON.stringify(tt)}`, res);
    }
  }
  for (const [id, casing] of [['F6a', 'international'], ['F6b', 'International'], ['F6c', 'INTERNATIONAL']]) {
    const res = await pollSearch({ tripType: casing }, owIntlBody);
    const tt = respTripType(res);
    if (res.status === 200 && flightHasResults(res) && isLowerTripType(tt, 'international')) {
      pass(id, `input tripType=${casing} → response international`, `tt=${tt}`, res);
    } else {
      bug(id, `input tripType=${casing} → response international`, `HTTP ${res.status} tt=${JSON.stringify(tt)}`, res);
    }
  }

  // ─── F7–F8 negatives ───────────────────────────────────────────────
  {
    const res = await flightSearch({ tripType: 'domestic' }, owIntlBody); // DEL→DXB
    expectMismatch('F7', 'DEL→DXB + tripType=domestic → mismatch (lowercase msg)', res);
  }
  {
    const res = await flightSearch({ tripType: 'foo' }, owDomBody);
    expectInvalidTripType('F8', 'tripType=foo → invalid (lowercase msg)', res);
  }
  {
    const res = await flightSearch({ tripType: 'international' }, owDomBody); // DEL→BOM
    expectMismatch('F9', 'DEL→BOM + tripType=international → mismatch', res);
  }

  // ─── Downstream flows ──────────────────────────────────────────────
  await runDownstream('F10', 'OW domestic', fOwDom, 'domestic', 'ONE_WAY');
  // Fresh RT domestic search for downstream if F2 response aged / incomplete
  if (!collectSearchIds(fRtDom?.data, 'ROUND_TRIP').length) {
    fRtDom = await pollSearchWithDateRetry({ tripType: 'domestic' }, rtDomBody);
  }
  await runDownstream('F11', 'RT domestic', fRtDom, 'domestic', 'ROUND_TRIP');
  await runDownstream('F12', 'OW international', fOwIntl, 'international', 'ONE_WAY');
  await runDownstream('F13', 'RT international', fRtIntl, 'international', 'ROUND_TRIP');

  // ─── Airports regression ───────────────────────────────────────────
  async function airports(p, query) {
    return client.request({ method: 'GET', path: p, query });
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'del', tripType: 'domestic' });
    const list = airportRows(res.data);
    const foreign = list.filter((a) => {
      const cc = String(a?.countryCode || a?.country_code || '').toUpperCase();
      return cc && cc !== 'IN';
    });
    if (res.status === 200 && list.length > 0 && foreign.length === 0) {
      pass('A1', 'airports del+domestic → India only', `n=${list.length}`, res);
    } else bug('A1', 'airports del+domestic → India only', `HTTP ${res.status} n=${list.length} foreign=${foreign.length}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'dubai', tripType: 'international' });
    const list = airportRows(res.data);
    if (res.status === 200 && list.length > 0) pass('A2', 'airports dubai+international → list', `n=${list.length}`, res);
    else bug('A2', 'airports dubai+international → list', `HTTP ${res.status} n=${list.length}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'del', tripType: 'DOMESTIC' });
    const list = airportRows(res.data);
    if (res.status === 200 && list.length > 0) pass('A3', 'airports tripType=DOMESTIC accepted', `n=${list.length}`, res);
    else bug('A3', 'airports tripType=DOMESTIC accepted', `HTTP ${res.status}`, res);
  }
  {
    const res = await airports('/v1/flights/airports', { airport: 'del', tripType: 'foo' });
    expectInvalidTripType('A4', 'airports tripType=foo → invalid lowercase msg', res);
  }

  // ─── Hotels ────────────────────────────────────────────────────────
  async function autocomplete(query) {
    return client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 10, ...query },
    });
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
    if (res.status === 200 && allIn && isLowerTripType(topTt, 'domestic')) {
      pass('H1', 'autocomplete mumbai domestic → lowercase', `n=${list.length} tt=${topTt}`, res);
    } else bug('H1', 'autocomplete mumbai domestic → lowercase', `HTTP ${res.status} n=${list.length} tt=${topTt}`, res);
  }
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'Domestic' });
    const tt = res.data?.tripType;
    if (res.status === 200 && isLowerTripType(tt, 'domestic')) {
      pass('H1b', 'autocomplete tripType=Domestic → domestic', `tt=${tt}`, res);
    } else bug('H1b', 'autocomplete tripType=Domestic → domestic', `HTTP ${res.status} tt=${tt}`, res);
  }
  {
    const res = await autocomplete({ q: 'mumbai', tripType: 'DOMESTIC' });
    const tt = res.data?.tripType;
    if (res.status === 200 && isLowerTripType(tt, 'domestic')) {
      pass('H1c', 'autocomplete tripType=DOMESTIC → domestic', `tt=${tt}`, res);
    } else bug('H1c', 'autocomplete tripType=DOMESTIC → domestic', `HTTP ${res.status} tt=${tt}`, res);
  }
  {
    const res = await autocomplete({ q: 'dubai', tripType: 'domestic' });
    const list = hotelAutoRows(res.data);
    const empty = res.data?.empty === true || list.length === 0;
    if (res.status === 200 && empty) pass('H2', 'autocomplete dubai+domestic → empty', `empty=${res.data?.empty}`, res);
    else bug('H2', 'autocomplete dubai+domestic → empty', `HTTP ${res.status} n=${list.length}`, res);
  }
  {
    const res = await autocomplete({ q: 'dubai', tripType: 'international' });
    const list = hotelAutoRows(res.data);
    const tt = res.data?.tripType;
    if (res.status === 200 && list.length > 0 && isLowerTripType(tt, 'international')) {
      pass('H3', 'autocomplete dubai+international → lowercase', `n=${list.length} tt=${tt}`, res);
    } else if (res.status === 200 && list.length > 0) {
      bug('H3', 'autocomplete dubai+international → lowercase', `n=${list.length} tt=${tt}`, res);
    } else {
      bug('H3', 'autocomplete dubai+international → lowercase', `HTTP ${res.status} n=${list.length}`, res);
    }
  }
  {
    expectInvalidTripType('H4', 'autocomplete tripType=foo → invalid',
      await autocomplete({ q: 'mumbai', tripType: 'foo' }));
  }

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
    if (!hit) console.log('No hotel inventory for Mumbai/Pune; continuing with Mumbai entity');
  }

  let dubaiEntity = '221688:AE';
  {
    const res = await autocomplete({ q: 'dubai', tripType: 'international' });
    const city = hotelAutoRows(res.data).find((r) => String(r.type || '').toUpperCase() === 'CITY')
      || hotelAutoRows(res.data)[0];
    dubaiEntity = city?.entityId || city?.id || dubaiEntity;
    console.log('Dubai entityId', dubaiEntity);
  }

  {
    const res = await hotelSearch({ tripType: 'domestic' }, searchBody);
    const list = hotelSearchList(res.data);
    const topTt = res.data?.tripType;
    const allDom = list.length > 0 && list.every((h) => h.tripType == null || h.tripType === 'domestic');
    if (res.status === 200 && list.length > 0 && isLowerTripType(topTt, 'domestic') && allDom) {
      pass('H5', 'listing India city domestic → lowercase', `entity=${cityEntity} n=${list.length}`, res);
    } else if (res.status === 200 && list.length > 0) {
      bug('H5', 'listing India city domestic → lowercase', `n=${list.length} top=${topTt} allDom=${allDom}`, res);
    } else {
      bug('H5', 'listing India city domestic → lowercase', `HTTP ${res.status} n=0 entity=${cityEntity}`, res);
    }
  }
  {
    const res = await hotelSearch({ tripType: 'international' }, searchBody);
    const list = hotelSearchList(res.data);
    const msg = String(res.data?.message || '');
    if (res.status === 200 && list.length === 0 && /India|international/i.test(msg)) {
      if (hasUpperTripTypeLeak(msg)) {
        bug('H6', 'India city + international → empty filter msg lowercase', `UPPERCASE in msg: ${msg.slice(0, 160)}`, res);
      } else {
        pass('H6', 'India city + international → empty filter', msg.slice(0, 160), res);
      }
    } else bug('H6', 'India city + international → empty filter', `n=${list.length} msg=${msg.slice(0, 120)}`, res);
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
      pass('H7', 'Dubai + domestic → empty filter', msg.slice(0, 160), res);
    } else bug('H7', 'Dubai + domestic → empty filter', `n=${list.length} msg=${msg.slice(0, 120)}`, res);
  }

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
    if (res.status === 200 && (isLowerTripType(tt, 'domestic') || (tt == null && codes.length > 0))) {
      pass('H8', 'details Indian + domestic lowercase', `hotel=${hotelId} tt=${tt} codes=${codes.length}`, res);
    } else bug('H8', 'details Indian + domestic lowercase', `HTTP ${res.status} hotel=${hotelId} tt=${tt}`, res);
  }

  if (bookingCode) {
    const body = {
      bookingCode,
      currency: 'INR',
      ...(requestId ? { requestId } : {}),
    };
    {
      const res = await hotelPrebook({ tripType: 'domestic' }, body);
      const tt = res.data?.tripType;
      if (res.status === 200 && (tt == null || isLowerTripType(tt, 'domestic'))) {
        pass('H9', 'prebook domestic → 200 lowercase', `tt=${tt} code=${bookingCode.slice(0, 16)}…`, res);
      } else if (res.status === 200) {
        bug('H9', 'prebook domestic → 200 lowercase', `HTTP 200 but tt=${tt}`, res);
      } else bug('H9', 'prebook domestic → 200 lowercase', `HTTP ${res.status}`, res);
    }
    {
      const res = await hotelPrebook({ tripType: 'international' }, body);
      const blob = brief(res.data, 300);
      const code = errCode(res) || res.data?.code;
      const ok = /No hotels/i.test(blob) || code === '404' || code === 404 || res.status === 404;
      if (ok) pass('H10', 'prebook wrong side → filtered', `HTTP ${res.status} code=${code}`, res);
      else bug('H10', 'prebook wrong side → filtered', `HTTP ${res.status} code=${code} ${blob.slice(0, 140)}`, res);
    }
  } else {
    bug('H9', 'prebook domestic', 'No bookingCode from details', null);
    bug('H10', 'prebook wrong side', 'Skipped — no bookingCode', null);
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    at: new Date().toISOString(),
    baseUrl: client.baseUrl || process.env.BASE_URL,
    partnerId: process.env.PARTNER_ID,
    tierId: process.env.TIER_ID,
    cityEntity,
    hotelId,
    checkin,
    checkout,
    bookingCode: bookingCode ? `${bookingCode.slice(0, 12)}…` : null,
    counts,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [
    `# delta-api tripType lowercase`,
    ``,
    `- at: ${report.at}`,
    `- base: ${report.baseUrl}`,
    `- counts: PASS=${counts.PASS || 0} BUG=${counts.BUG || 0} NOT TESTED=${counts['NOT TESTED'] || 0}`,
    ``,
    `| ID | Rule | Status | Note |`,
    `|----|------|--------|------|`,
    ...rows.map((r) => `| ${r.id} | ${r.rule} | ${r.status} | ${String(r.note || '').replace(/\|/g, '/')} |`),
    ``,
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);

  console.log('\nCOUNTS', counts);
  console.log('Wrote', OUT_JSON);
  console.log('Wrote', OUT_MD);
  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
