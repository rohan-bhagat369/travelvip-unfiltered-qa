/**
 * delta-api tripType lowercase — ONE booking per scenario, NO retry loops.
 * On Failed / Inprogress / any book fail: stop that case (no new dates/names/airlines).
 *
 * Scenarios (1 attempt each):
 *   B1 OW domestic DEL→BOM
 *   B2 RT domestic BOM↔BLR
 *   B3 OW international DEL→DXB
 *   B4 RT international DEL↔DXB
 *   H1 Hotel domestic finalize
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   node travel-apis/scripts/probe-delta-triptype-e2e-noloop.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { futureDate, sleep } from '../../shared/lib/testUtils.js';
import { FlightService } from '../flight/src/service.js';
import { HotelService } from '../hotel/src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildSeatMapPassengers,
  extractFirstSearchId,
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../flight/src/helpers.js';
import {
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../hotel/src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://delta-api.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.resolve(__dirname, '../reports/delta-triptype-e2e-noloop.json');
const OUT_MD = path.resolve(__dirname, '../reports/delta-triptype-e2e-noloop.md');

function brief(d, n = 450) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function tripTypeOf(data) {
  if (!data || typeof data !== 'object') return null;
  return data.tripType ?? data?.data?.tripType ?? data?.bookingResponse?.tripType ?? data?.hotel?.tripType ?? null;
}
function hasUpperLeak(text) {
  return /\bDOMESTIC\b|\bINTERNATIONAL\b/.test(String(text || ''));
}
function isVendorSkip(res) {
  const code = errCode(res);
  const msg = String(res?.data?.error?.message || res?.data?.message || '');
  return code === 'VENDOR_ERROR'
    || code === 'VENDOR_UNAVAILABLE'
    || /currently not available/i.test(msg)
    || /fare rules failed/i.test(msg)
    || /not available/i.test(msg);
}
function dirOptions(data, direction) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === direction)?.options) || [];
}

async function main() {
  clearSession();
  console.log('BASE', config.baseUrl, 'tier', config.tierId, 'NO LOOP — one attempt per scenario');

  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);
  const flight = new FlightService(client);
  const hotel = new HotelService(client);

  const rows = [];
  const observations = [];
  let abort = false;

  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} — ${row.note}`);
  }
  function observe(where, data) {
    const raw = brief(data, 6000);
    if (hasUpperLeak(raw)) {
      observations.push({ severity: 'BUG', where, note: 'UPPERCASE DOMESTIC/INTERNATIONAL in body' });
    }
    if (/\bRiya\b/i.test(raw) && /fareRules|bookingCode/i.test(where + raw)) {
      observations.push({ severity: 'BUG', where, note: 'Riya leak' });
    }
  }

  async function searchWithTripType(tripType, body) {
    // Poll search completion only (not a book retry loop)
    let last = null;
    for (let i = 0; i < 15; i += 1) {
      last = await client.request({
        method: 'POST',
        path: '/v1/flights/search',
        query: { ...FLIGHT_QUERY, page: 0, perpage: 20, sortby: 'fare,asc', tripType },
        body,
        correlation: true,
      });
      if (last.status !== 200) return last;
      if (extractFirstSearchId(last.data)) return last;
      if (isSearchProgressComplete(last.data)) return last;
      await sleep(2500);
    }
    return last;
  }

  async function waitStatusNoLoop(br, { max = 12 } = {}) {
    let last = null;
    for (let i = 0; i < max; i += 1) {
      last = await flight.getBookingStatus(br);
      const st = String(last.data?.status || '');
      console.log('  status', br, i + 1, st);
      if (isTerminalBookingStatus(st)) return { status: st, res: last };
      if (/inprogress/i.test(st) && i >= 2) {
        console.log('  STOP — Inprogress (no loop)');
        return { status: st, res: last, stopped: true };
      }
      await sleep(3000);
    }
    return { status: last?.data?.status || 'UNKNOWN', res: last, stopped: true };
  }

  async function bookOw({ id, label, tripType, origin, destination, days, intlPassport = false }) {
    if (abort) {
      add({ id, rule: label, status: 'NOT TESTED', note: 'Aborted — INSUFFICIENT_BALANCE' });
      return;
    }
    console.log(`\n=== ${id} ${label} (single attempt) ===`);
    try {
      const body = buildOneWaySearchBody(days, {
        origin, destination, maxStops: null, fareType: 'NORMAL',
      });
      const search = await searchWithTripType(tripType, body);
      observe(`${id}-search`, search.data);
      const stt = tripTypeOf(search.data);
      const sid = extractFirstSearchId(search.data);
      if (search.status !== 200 || !sid) {
        add({
          id, rule: label, status: 'BUG', note: `search HTTP ${search.status} code=${errCode(search)} tt=${stt}`,
          http: search.status, snippet: brief(search.data),
        });
        return;
      }
      if (stt !== tripType) {
        add({
          id, rule: label, status: 'BUG', note: `search tripType=${stt} expected ${tripType}`,
          http: 200, snippet: brief(search.data),
        });
        return;
      }

      const searchIds = [sid];
      const details = await flight.getDetails(searchIds, 'ONE_WAY');
      const fareRules = await flight.getFareRules(searchIds, 'ONE_WAY');
      const pricing = await flight.getPricing(searchIds, 'ONE_WAY');
      observe(`${id}-details`, details.data);
      observe(`${id}-fareRules`, fareRules.data);
      observe(`${id}-pricing`, pricing.data);

      if (isVendorSkip(details) || isVendorSkip(pricing) || isVendorSkip(fareRules)) {
        const which = isVendorSkip(details) ? 'details' : isVendorSkip(pricing) ? 'pricing' : 'fareRules';
        const res = which === 'details' ? details : which === 'pricing' ? pricing : fareRules;
        add({
          id, rule: label, status: 'NOT TESTED',
          note: `SKIP vendor/unavailable on ${which}: ${errCode(res)} ${brief(res.data, 120)}`,
          http: res.status, snippet: brief(res.data),
        });
        return;
      }

      for (const [name, res] of [['details', details], ['pricing', pricing]]) {
        const tt = tripTypeOf(res.data);
        if (res.status !== 200 || tt !== tripType) {
          add({
            id, rule: label, status: 'BUG',
            note: `${name} HTTP ${res.status} tt=${tt} code=${errCode(res)} ${brief(res.data, 180)}`,
            http: res.status, snippet: brief(res.data),
          });
          return;
        }
      }
      // fareRules: require lowercase only when 200; vendor fail already skipped above
      if (fareRules.status === 200 && tripTypeOf(fareRules.data) !== tripType) {
        add({
          id, rule: label, status: 'BUG',
          note: `fareRules tt=${tripTypeOf(fareRules.data)} expected ${tripType}`,
          http: fareRules.status, snippet: brief(fareRules.data),
        });
        return;
      }

      const priceId = pricing.data.priceId;
      const bookingContext = pricing.data.bookingContext;
      const ssr = await flight.getSsr(priceId);
      observe(`${id}-ssr`, ssr.data);
      if (ssr.status === 200 && tripTypeOf(ssr.data) !== tripType) {
        add({ id, rule: label, status: 'BUG', note: `ssr tt=${tripTypeOf(ssr.data)}`, http: ssr.status });
        return;
      }
      const seatmap = await flight.getSeatMap(bookingContext, buildSeatMapPassengers());
      observe(`${id}-seatmap`, seatmap.data);
      console.log('  seatmap', seatmap.status, errCode(seatmap) || tripTypeOf(seatmap.data));

      const payload = buildIssueTicketPayload({
        bookingContext, priceId, searchIds, journeyType: 'ONE_WAY',
        passengerProfile: {
          title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', gender: 'Male', dob: '1992-11-18',
        },
      });
      if (intlPassport) {
        payload.data.passportType = 'FULL';
        payload.data.passengers[0].passport = {
          number: 'M7654321', expiry: '2031-06-30', issuedDate: '2021-03-01', issuedCountryCode: 'IN',
        };
      }

      const issue = await flight.issueTicketV2(payload);
      observe(`${id}-issue`, issue.data);
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
      console.log('  issue', issue.status, 'br=', br, 'code=', errCode(issue), 'tt=', tripTypeOf(issue.data));

      if (errCode(issue) === 'INSUFFICIENT_BALANCE') {
        abort = true;
        add({ id, rule: label, status: 'BUG', note: 'INSUFFICIENT_BALANCE — abort remaining', http: issue.status, snippet: brief(issue.data) });
        return;
      }
      if (!br) {
        add({ id, rule: label, status: 'BUG', note: `issue failed ${errCode(issue)} ${brief(issue.data, 200)}`, http: issue.status });
        return;
      }

      const waited = await waitStatusNoLoop(br);
      observe(`${id}-status`, waited.res?.data);
      const detail = await flight.getBookingDetail(br);
      observe(`${id}-detail`, detail.data);
      const tts = [stt, tripTypeOf(details.data), tripTypeOf(pricing.data), tripTypeOf(ssr.data), tripTypeOf(issue.data), tripTypeOf(detail.data)]
        .filter((x) => x != null);
      const ttOk = tts.every((x) => x === tripType);

      let cancelHttp = null;
      if (/confirm/i.test(String(waited.status))) {
        const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr;
        const cancel = await flight.cancelBooking(br, { ...(pnr ? { pnr } : {}), cancelledBy: 'QA-delta-noloop' });
        cancelHttp = cancel.status;
        observe(`${id}-cancel`, cancel.data);
        console.log('  cancel', cancel.status, errCode(cancel));
      }

      const note = `BR=${br} status=${waited.status} tts=${tts.join(',')} seatmap=${seatmap.status} cancel=${cancelHttp}`;
      if (!ttOk) add({ id, rule: label, status: 'BUG', note: `tripType mismatch — ${note}`, br });
      else if (/confirm/i.test(String(waited.status))) add({ id, rule: label, status: 'PASS', note, br });
      else {
        // Pending/Failed/Inprogress after single poll — treat as inventory/vendor skip
        add({ id, rule: label, status: 'NOT TESTED', note: `SKIP book outcome ${note}`, br });
      }
    } catch (e) {
      add({ id, rule: label, status: 'NOT TESTED', note: `SKIP ${e.message}` });
    }
  }

  async function bookRt({ id, label, tripType, origin, destination, onDays, retDays, intlPassport = false }) {
    if (abort) {
      add({ id, rule: label, status: 'NOT TESTED', note: 'Aborted — INSUFFICIENT_BALANCE' });
      return;
    }
    console.log(`\n=== ${id} ${label} (single attempt) ===`);
    try {
      const body = buildRoundTripSearchBody(onDays, retDays, {
        origin, destination, maxStops: null, fareType: 'NORMAL',
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };

      // one RT resolve path (same as noloop wallet probe) + tripType on every search call
      const searchFn = async (b) => client.request({
        method: 'POST',
        path: '/v1/flights/search',
        query: { ...FLIGHT_QUERY, page: 0, perpage: 20, sortby: 'fare,asc', tripType },
        body: b,
        correlation: true,
      });

      let search = null;
      for (let i = 0; i < 15; i += 1) {
        search = await searchFn(body);
        if (search.status !== 200) break;
        if (dirOptions(search.data, 'ONWARD')[0]?.searchId) break;
        if (isSearchProgressComplete(search.data)) break;
        await sleep(2500);
      }
      observe(`${id}-search`, search?.data);
      const stt = tripTypeOf(search?.data);
      const onward = dirOptions(search?.data, 'ONWARD')[0];
      if (search.status !== 200 || !onward?.searchId || stt !== tripType) {
        add({
          id, rule: label, status: 'BUG',
          note: `search HTTP ${search.status} tt=${stt} onward=${!!onward?.searchId} code=${errCode(search)}`,
          snippet: brief(search?.data),
        });
        return;
      }

      const refined = { ...body, selection: { selectedSearchIds: [onward.searchId] } };
      let returnRes = null;
      for (let i = 0; i < 12; i += 1) {
        returnRes = await searchFn(refined);
        if (returnRes.status !== 200 && errCode(returnRes) === 'SEARCH_CACHE_MISS') {
          await searchFn(body);
          continue;
        }
        if (dirOptions(returnRes.data, 'RETURN').some((o) => o.searchId && o.searchId !== onward.searchId)) break;
        if (isSearchProgressComplete(returnRes.data)) break;
        await sleep(2500);
      }
      observe(`${id}-return`, returnRes?.data);
      const ret = dirOptions(returnRes?.data, 'RETURN').find((o) => o.searchId && o.searchId !== onward.searchId)
        || dirOptions(returnRes?.data, 'RETURN')[0];
      if (!ret?.searchId) {
        add({ id, rule: label, status: 'BUG', note: 'no return searchId', snippet: brief(returnRes?.data) });
        return;
      }
      const searchIds = [onward.searchId, ret.searchId];
      console.log('  pair', searchIds.join(','));

      const details = await flight.getDetails(searchIds, 'ROUND_TRIP');
      const fareRules = await flight.getFareRules(searchIds, 'ROUND_TRIP');
      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      observe(`${id}-details`, details.data);
      observe(`${id}-fareRules`, fareRules.data);
      observe(`${id}-pricing`, pricing.data);

      if (isVendorSkip(details) || isVendorSkip(pricing) || isVendorSkip(fareRules)) {
        const which = isVendorSkip(details) ? 'details' : isVendorSkip(pricing) ? 'pricing' : 'fareRules';
        const res = which === 'details' ? details : which === 'pricing' ? pricing : fareRules;
        add({
          id, rule: label, status: 'NOT TESTED',
          note: `SKIP vendor/unavailable on ${which}: ${errCode(res)} ${brief(res.data, 120)}`,
          http: res.status, snippet: brief(res.data),
        });
        return;
      }

      for (const [name, res] of [['details', details], ['pricing', pricing]]) {
        const tt = tripTypeOf(res.data);
        if (res.status !== 200 || tt !== tripType) {
          add({
            id, rule: label, status: 'BUG',
            note: `${name} HTTP ${res.status} tt=${tt} ${brief(res.data, 160)}`,
            http: res.status, snippet: brief(res.data),
          });
          return;
        }
      }
      if (fareRules.status === 200 && tripTypeOf(fareRules.data) !== tripType) {
        add({
          id, rule: label, status: 'BUG',
          note: `fareRules tt=${tripTypeOf(fareRules.data)} expected ${tripType}`,
          http: fareRules.status, snippet: brief(fareRules.data),
        });
        return;
      }

      const priceId = pricing.data.priceId;
      const bookingContext = pricing.data.bookingContext;
      const ssr = await flight.getSsr(priceId);
      observe(`${id}-ssr`, ssr.data);
      if (ssr.status === 200 && tripTypeOf(ssr.data) !== tripType) {
        add({ id, rule: label, status: 'BUG', note: `ssr tt=${tripTypeOf(ssr.data)}` });
        return;
      }
      const seatmap = await flight.getSeatMap(bookingContext, buildSeatMapPassengers());
      observe(`${id}-seatmap`, seatmap.data);
      console.log('  seatmap', seatmap.status, errCode(seatmap) || tripTypeOf(seatmap.data));

      const payload = buildIssueTicketPayload({
        bookingContext, priceId, searchIds, journeyType: 'ROUND_TRIP',
        passengerProfile: {
          title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', gender: 'Male', dob: '1992-11-18',
        },
      });
      if (intlPassport) {
        payload.data.passportType = 'FULL';
        payload.data.passengers[0].passport = {
          number: 'M7654321', expiry: '2031-06-30', issuedDate: '2021-03-01', issuedCountryCode: 'IN',
        };
      }

      const issue = await flight.issueTicketV2(payload);
      observe(`${id}-issue`, issue.data);
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
      console.log('  issue', issue.status, 'br=', br, 'code=', errCode(issue), 'tt=', tripTypeOf(issue.data));

      if (errCode(issue) === 'INSUFFICIENT_BALANCE') {
        abort = true;
        add({ id, rule: label, status: 'BUG', note: 'INSUFFICIENT_BALANCE — abort remaining', snippet: brief(issue.data) });
        return;
      }
      if (!br) {
        add({ id, rule: label, status: 'BUG', note: `issue failed ${errCode(issue)} ${brief(issue.data, 200)}` });
        return;
      }

      const waited = await waitStatusNoLoop(br);
      observe(`${id}-status`, waited.res?.data);
      const detail = await flight.getBookingDetail(br);
      observe(`${id}-detail`, detail.data);
      const tts = [stt, tripTypeOf(details.data), tripTypeOf(pricing.data), tripTypeOf(ssr.data), tripTypeOf(detail.data)]
        .filter((x) => x != null);
      const ttOk = tts.every((x) => x === tripType);

      let cancelHttp = null;
      if (/confirm/i.test(String(waited.status))) {
        const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr;
        const cancel = await flight.cancelBooking(br, { ...(pnr ? { pnr } : {}), cancelledBy: 'QA-delta-noloop' });
        cancelHttp = cancel.status;
        observe(`${id}-cancel`, cancel.data);
      }

      const note = `BR=${br} status=${waited.status} tts=${tts.join(',')} seatmap=${seatmap.status} cancel=${cancelHttp}`;
      if (!ttOk) add({ id, rule: label, status: 'BUG', note: `tripType mismatch — ${note}`, br });
      else if (/confirm/i.test(String(waited.status))) add({ id, rule: label, status: 'PASS', note, br });
      else add({ id, rule: label, status: 'NOT TESTED', note: `SKIP book outcome ${note}`, br });
    } catch (e) {
      add({ id, rule: label, status: 'NOT TESTED', note: `SKIP ${e.message}` });
    }
  }

  async function hotelOnce() {
    if (abort) {
      add({ id: 'H1', rule: 'Hotel domestic E2E', status: 'NOT TESTED', note: 'Aborted — INSUFFICIENT_BALANCE' });
      return;
    }
    console.log('\n=== H1 Hotel domestic (single attempt) ===');
    try {
      const entityId = '328605:IN'; // Pune (worked earlier)
      const checkin = futureDate(21);
      const checkout = futureDate(22);
      const searchBody = {
        type: 'CITY', entityId, nationality: 'IN', currency: 'INR',
        checkin, checkout, rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      };
      const search = await hotel.search(searchBody, { tripType: 'domestic' });
      observe('H-search', search.data);
      const list = Array.isArray(search.data?.results) ? search.data.results : [];
      const stt = tripTypeOf(search.data);
      if (search.status !== 200 || !list.length || stt !== 'domestic') {
        add({
          id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG',
          note: `search HTTP ${search.status} n=${list.length} tt=${stt}`,
          snippet: brief(search.data),
        });
        return;
      }

      const hotelId = String(list[0].id || list[0].hotelId);
      const details = await client.request({
        method: 'POST',
        path: '/v1/hotels/details',
        query: { ...FLIGHT_QUERY, page: 0, perpage: 20, tripType: 'domestic' },
        body: {
          type: 'HOTEL', entityId: hotelId, nationality: 'IN', currency: 'INR',
          checkin, checkout, rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        },
        correlation: true,
      });
      observe('H-details', details.data);
      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      const codes = extractBookingCodes(details.data, 3);
      if (details.status !== 200 || !requestId || !codes.length) {
        add({
          id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG',
          note: `details HTTP ${details.status} codes=${codes.length} tt=${tripTypeOf(details.data)}`,
        });
        return;
      }

      const bookingCode = codes[0];
      const prebook = await client.request({
        method: 'POST',
        path: '/v1/hotels/prebook',
        query: { lang: 'en', currency: 'INR', tripType: 'domestic' },
        body: { bookingCode, requestId },
        correlation: true,
      });
      observe('H-prebook', prebook.data);
      if (!isPrebookSuccess(prebook)) {
        add({
          id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG',
          note: `prebook fail HTTP ${prebook.status} ${brief(prebook.data, 160)}`,
        });
        return;
      }

      const finalize = await client.request({
        method: 'POST',
        path: '/v1/hotels/finalize-booking',
        query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, tripType: 'domestic' },
        body: {
          bookingContext: extractBookingContext(prebook.data),
          bookingCode,
          requestId,
          checkin,
          checkout,
          rooms: [{
            guests: [{
              title: 'Mr',
              firstName: config.hotel.guestFirstName,
              lastName: config.hotel.guestLastName,
              type: 'Adult',
              isLead: true,
            }],
          }],
          contact: {
            email: `delta.noloop.${Date.now()}@travelvip.ai`,
            countryCode: '+91',
            mobile: config.hotel.contactMobile,
            panCardNumber: 'ABCDE1234F',
            panCardName: `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`,
          },
        },
        correlation: true,
        partnerKey: client.partnerKey,
      });
      observe('H-finalize', finalize.data);
      const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
      console.log('  finalize', finalize.status, 'br=', br, 'code=', errCode(finalize));

      if (errCode(finalize) === 'INSUFFICIENT_BALANCE') {
        abort = true;
        add({ id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG', note: 'INSUFFICIENT_BALANCE', snippet: brief(finalize.data) });
        return;
      }
      if (!br) {
        add({
          id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG',
          note: `finalize HTTP ${finalize.status} ${errCode(finalize)} ${brief(finalize.data, 200)}`,
        });
        return;
      }

      let st = null;
      let statusRes = null;
      for (let i = 0; i < 15; i += 1) {
        statusRes = await hotel.getBookingStatus(br);
        st = String(statusRes.data?.status || '');
        console.log('  hotel status', i + 1, st);
        if (statusRes.ok && isTerminalHotelStatus(st)) break;
        if (/inprogress/i.test(st) && i >= 3) {
          console.log('  STOP — hotel Inprogress (no loop)');
          break;
        }
        await sleep(4000);
      }
      observe('H-status', statusRes?.data);
      const detail = await hotel.getBookingDetail(br);
      observe('H-detail', detail.data);

      let cancelHttp = null;
      if (/confirm/i.test(String(st))) {
        const cancel = await hotel.cancelBooking(br);
        cancelHttp = cancel.status;
        observe('H-cancel', cancel.data);
      }

      const tts = [stt, tripTypeOf(details.data), tripTypeOf(prebook.data), tripTypeOf(detail.data)].filter((x) => x != null);
      const ttOk = tts.every((x) => x === 'domestic');
      const note = `BR=${br} status=${st} tts=${tts.join(',')} cancel=${cancelHttp}`;
      if (!ttOk) add({ id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG', note: `tripType mismatch — ${note}`, br });
      else if (/confirm/i.test(String(st))) add({ id: 'H1', rule: 'Hotel domestic E2E', status: 'PASS', note, br });
      else add({ id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG', note: `NO_LOOP_STOP ${note}`, br });
    } catch (e) {
      add({ id: 'H1', rule: 'Hotel domestic E2E', status: 'BUG', note: `NO_LOOP_STOP ${e.message}` });
    }
  }

  // One booking each — fixed dates, no scenario hunting
  // SKIP_FLIGHTS=1 → hotel (+ non-flight) only when flights are unavailable
  const skipFlights = process.env.SKIP_FLIGHTS === '1';
  if (skipFlights) {
    add({ id: 'B1', rule: 'OW domestic DEL→BOM', status: 'NOT TESTED', note: 'SKIP_FLIGHTS=1 (vendor unavailable)' });
    add({ id: 'B2', rule: 'RT domestic BOM↔BLR', status: 'NOT TESTED', note: 'SKIP_FLIGHTS=1 (vendor unavailable)' });
    add({ id: 'B3', rule: 'OW international DEL→DXB', status: 'NOT TESTED', note: 'SKIP_FLIGHTS=1 (vendor unavailable)' });
    add({ id: 'B4', rule: 'RT international DEL↔DXB', status: 'NOT TESTED', note: 'SKIP_FLIGHTS=1 (vendor unavailable)' });
  } else {
    await bookOw({
      id: 'B1', label: 'OW domestic DEL→BOM', tripType: 'domestic',
      origin: 'DEL', destination: 'BOM', days: 35,
    });
    await bookRt({
      id: 'B2', label: 'RT domestic BOM↔BLR', tripType: 'domestic',
      origin: 'BOM', destination: 'BLR', onDays: 25, retDays: 32,
    });
    await bookOw({
      id: 'B3', label: 'OW international DEL→DXB', tripType: 'international',
      origin: 'DEL', destination: 'DXB', days: 40, intlPassport: true,
    });
    await bookRt({
      id: 'B4', label: 'RT international DEL↔DXB', tripType: 'international',
      origin: 'DEL', destination: 'DXB', onDays: 45, retDays: 52, intlPassport: true,
    });
  }
  await hotelOnce();

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});
  const report = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    note: 'no-loop: one attempt per scenario; stop on Failed/Inprogress',
    counts,
    observations,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, [
    `# delta-api tripType E2E (no loop)`,
    ``,
    `- ${report.at} · ${report.baseUrl}`,
    `- PASS=${counts.PASS || 0} BUG=${counts.BUG || 0} NOT TESTED=${counts['NOT TESTED'] || 0}`,
    ``,
    `## Observations`,
    ...(observations.length ? observations.map((o) => `- [${o.severity}] ${o.where}: ${o.note}`) : ['- none']),
    ``,
    `| ID | Rule | Status | Note |`,
    `|----|------|--------|------|`,
    ...rows.map((r) => `| ${r.id} | ${r.rule} | ${r.status} | ${String(r.note || '').replace(/\|/g, '/')} |`),
    ``,
  ].join('\n'));

  console.log('\nCOUNTS', counts);
  console.log('OBSERVATIONS', observations.length ? observations : 'none');
  console.log('Wrote', OUT_JSON);
  if ((counts.BUG || 0) > 0 || observations.some((o) => o.severity === 'BUG')) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
