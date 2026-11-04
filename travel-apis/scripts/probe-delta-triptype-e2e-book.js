/**
 * delta-api tripType lowercase — full E2E including booking.
 * Flights: search→details→fareRules→pricing→SSR→seatmap→issue-ticket→status→detail→cancel
 * Hotels: autocomplete→search→details→prebook→finalize→status→cancel
 * Also re-checks casing / mismatch / invalid negatives.
 * NO retry loops beyond AGENTS default (Inprogress → one retry with new names+dates).
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   node travel-apis/scripts/probe-delta-triptype-e2e-book.js
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
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildRoundTripSearchIds,
  buildSeatMapPassengers,
  buildSelectionPayload,
  extractFirstSearchId,
  extractOnwardSearchId,
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
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.TIER_ID = process.env.TIER_ID || '10546901';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.resolve(__dirname, '../reports', process.env.DELTA_E2E_OUT || 'delta-triptype-e2e-book.json');
const OUT_MD = OUT_JSON.replace(/\.json$/i, '.md');
const MAX_FARE = Number(process.env.MAX_FARE || 25000);

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function errMsg(r) {
  return String(r?.data?.error?.message || r?.data?.message || '');
}
function errText(r) {
  const d = r?.data?.error?.details;
  const details = Array.isArray(d) ? d.join(' | ') : (d == null ? '' : String(d));
  return `${details} | ${errMsg(r)}`;
}
function respTripType(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.tripType != null) return String(payload.tripType);
  if (payload?.data?.tripType != null) return String(payload.data.tripType);
  if (payload?.hotel?.tripType != null) return String(payload.hotel.tripType);
  if (payload?.bookingResponse?.tripType != null) return String(payload.bookingResponse.tripType);
  return null;
}
function hasUpperTripTypeLeak(text) {
  return /\bDOMESTIC\b|\bINTERNATIONAL\b/.test(String(text || ''));
}
function scanPayload(label, data, observations) {
  const raw = brief(data, 8000);
  if (hasUpperTripTypeLeak(raw)) {
    observations.push({
      severity: 'BUG',
      where: label,
      note: 'Found UPPERCASE DOMESTIC/INTERNATIONAL in response body',
      sample: raw.match(/DOMESTIC|INTERNATIONAL/g)?.slice(0, 8),
    });
  }
  // Riya leak guard
  if (/\bRiya\b/i.test(raw) && /fareRules|bookingCode|fare.?rule/i.test(label + raw)) {
    observations.push({
      severity: 'BUG',
      where: label,
      note: 'Possible Riya vendor leak in response',
    });
  }
}
function uniquePax(seq = 1) {
  const tag = `${Date.now().toString(36)}${seq}`.replace(/[^a-z]/gi, 'x').slice(-6);
  return {
    title: 'Mr',
    firstName: 'Rohan',
    lastName: `Bhagat${tag}`,
    gender: 'Male',
    dob: '2001-05-29',
  };
}
function hotelList(data) {
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.hotels)) return data.hotels;
  return [];
}
function hotelAuto(data) {
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

async function main() {
  clearSession();
  console.log('BASE', config.baseUrl, 'tier', config.tierId, 'partner', config.partnerId);

  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);
  const flight = new FlightService(client);
  const hotel = new HotelService(client);

  const rows = [];
  const observations = [];
  const bookings = [];
  let abortBooks = false;

  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} — ${row.note}`);
  }
  function pass(id, rule, note, res, extra = {}) {
    add({
      id, rule, status: 'PASS', note,
      http: res?.status ?? null, code: errCode(res), snippet: brief(res?.data), ...extra,
    });
  }
  function bug(id, rule, note, res, extra = {}) {
    add({
      id, rule, status: 'BUG', note,
      http: res?.status ?? null, code: errCode(res), snippet: brief(res?.data), ...extra,
    });
  }
  function nt(id, rule, note) {
    add({ id, rule, status: 'NOT TESTED', note, http: null, code: null });
  }

  async function flightSearch(tripType, body) {
    return client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: {
        lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc',
        ...(tripType != null ? { tripType } : {}),
      },
      body,
      correlation: true,
    });
  }

  async function pollSearch(tripType, body, { max = 12 } = {}) {
    let last = null;
    for (let i = 0; i < max; i += 1) {
      last = await flightSearch(tripType, body);
      if (last.status !== 200) return last;
      if (extractFirstSearchId(last.data) || extractOnwardSearchId(last.data)) return last;
      if (isSearchProgressComplete(last.data)) return last;
      await sleep(2500);
    }
    return last;
  }

  async function pollSearchDateRetry(tripType, bodyFactory, { attempts = 4 } = {}) {
    let last = null;
    for (let a = 0; a < attempts; a += 1) {
      const body = bodyFactory(a);
      last = await pollSearch(tripType, body);
      if (last.status === 200 && extractFirstSearchId(last.data)) return { res: last, body };
      if (last.status === 400 && errCode(last) && errCode(last) !== 'NO_FLIGHTS_FOUND') {
        return { res: last, body };
      }
      console.log(`  search date retry ${a + 1}`);
    }
    return { res: last, body: bodyFactory(attempts - 1) };
  }

  function expectLower(id, rule, res, expected) {
    const tt = respTripType(res?.data);
    scanPayload(id, res?.data, observations);
    if (res?.status === 200 && tt === expected) {
      pass(id, rule, `tt=${tt}`, res);
      return true;
    }
    bug(id, rule, `HTTP ${res?.status} tt=${JSON.stringify(tt)} expected=${expected}`, res);
    return false;
  }

  // ─── Negatives / edges (quick) ─────────────────────────────────────
  {
    const body = buildOneWaySearchBody(45, { origin: 'DEL', destination: 'DXB', maxStops: null, fareType: 'NORMAL' });
    const res = await flightSearch('domestic', body);
    const text = errText(res);
    scanPayload('NEG-mismatch', res.data, observations);
    if (res.status === 400 && errCode(res) === 'TRIP_TYPE_MISMATCH' && !hasUpperTripTypeLeak(text)) {
      pass('N1', 'DEL→DXB + domestic → TRIP_TYPE_MISMATCH lowercase', text.slice(0, 160), res);
    } else bug('N1', 'DEL→DXB + domestic → TRIP_TYPE_MISMATCH lowercase', `HTTP ${res.status} ${errCode(res)} ${text.slice(0, 120)}`, res);
  }
  {
    const body = buildOneWaySearchBody(45, { origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL' });
    const res = await flightSearch('foo', body);
    const text = errText(res);
    scanPayload('NEG-foo', res.data, observations);
    if (res.status === 400 && errCode(res) === 'INVALID_TRIP_TYPE' && !hasUpperTripTypeLeak(text)) {
      pass('N2', 'tripType=foo → INVALID_TRIP_TYPE lowercase', text.slice(0, 160), res);
    } else bug('N2', 'tripType=foo → INVALID_TRIP_TYPE lowercase', `HTTP ${res.status} ${errCode(res)} ${text.slice(0, 120)}`, res);
  }
  for (const [id, casing] of [['E1', 'Domestic'], ['E2', 'DOMESTIC']]) {
    const { res } = await pollSearchDateRetry(casing, (a) => buildOneWaySearchBody(40 + a * 7, {
      origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL',
    }), { attempts: 2 });
    expectLower(id, `input ${casing} → response domestic`, res, 'domestic');
  }

  // ─── Flight E2E book helper ────────────────────────────────────────
  async function bookScenario({
    id, label, tripType, journeyType, bodyFactory, maxFare = MAX_FARE,
  }) {
    if (abortBooks) {
      nt(id, label, 'Aborted — prior INSUFFICIENT_BALANCE / hard stop');
      return null;
    }

    const pax = uniquePax(rows.length + 1);
    console.log(`\n=== ${id} ${label} pax=${pax.firstName} ${pax.lastName} ===`);

    async function oneAttempt(attempt) {
      const { res: search, body } = await pollSearchDateRetry(
        tripType,
        (a) => bodyFactory(a + attempt * 3),
        { attempts: 4 },
      );
      scanPayload(`${id}-search`, search?.data, observations);
      const tt = respTripType(search?.data);
      if (search.status !== 200 || !extractFirstSearchId(search.data)) {
        return { ok: false, stage: 'search', search, note: `search HTTP ${search.status} code=${errCode(search)} tt=${tt}` };
      }
      if (tt !== tripType) {
        return { ok: false, stage: 'search-tt', search, note: `search tt=${tt} expected ${tripType}` };
      }

      let searchIds;
      if (journeyType === 'ROUND_TRIP') {
        searchIds = buildRoundTripSearchIds(search.data);
        if (searchIds.length < 2) {
          // try refine via service path
          try {
            const rt = await flight.searchRoundTripUntilComplete(body);
            searchIds = rt.searchIds;
            scanPayload(`${id}-search-rt`, rt.response?.data, observations);
            if (respTripType(rt.response?.data) && respTripType(rt.response.data) !== tripType) {
              observations.push({
                severity: 'BUG',
                where: `${id}-rt-refine`,
                note: `rt refine tripType=${respTripType(rt.response.data)}`,
              });
            }
          } catch (e) {
            return { ok: false, stage: 'rt-ids', search, note: String(e.message || e) };
          }
        }
      } else {
        searchIds = [extractFirstSearchId(search.data)];
      }
      if (!searchIds?.length) {
        return { ok: false, stage: 'ids', search, note: 'no searchIds' };
      }

      const details = await flight.getDetails(searchIds, journeyType);
      const fareRules = await flight.getFareRules(searchIds, journeyType);
      const pricing = await flight.getPricing(searchIds, journeyType);
      scanPayload(`${id}-details`, details.data, observations);
      scanPayload(`${id}-fareRules`, fareRules.data, observations);
      scanPayload(`${id}-pricing`, pricing.data, observations);

      const hops = [
        ['details', details],
        ['fareRules', fareRules],
        ['pricing', pricing],
      ];
      for (const [name, res] of hops) {
        const htt = respTripType(res.data);
        if (res.status !== 200 || htt !== tripType) {
          return {
            ok: false, stage: name, search, details, fareRules, pricing,
            note: `${name} HTTP ${res.status} tt=${htt}`,
          };
        }
      }

      const priceId = pricing.data?.priceId;
      const bookingContext = pricing.data?.bookingContext;
      const total = Number(
        pricing.data?.totalAmount
        ?? pricing.data?.fare?.total
        ?? pricing.data?.price?.total
        ?? NaN,
      );
      if (!priceId || !bookingContext) {
        return { ok: false, stage: 'pricing-fields', pricing, note: 'missing priceId/bookingContext' };
      }
      if (Number.isFinite(total) && total > maxFare) {
        return { ok: false, stage: 'fare-cap', pricing, note: `fare ${total} > max ${maxFare}` };
      }

      let ssr = null;
      let seatmap = null;
      if (priceId) {
        ssr = await flight.getSsr(priceId);
        scanPayload(`${id}-ssr`, ssr.data, observations);
        if (ssr.status === 200 && respTripType(ssr.data) !== tripType) {
          return { ok: false, stage: 'ssr-tt', ssr, note: `ssr tt=${respTripType(ssr.data)}` };
        }
      }
      if (bookingContext) {
        seatmap = await flight.getSeatMap(bookingContext, buildSeatMapPassengers(pax));
        scanPayload(`${id}-seatmap`, seatmap.data, observations);
        if (seatmap.status === 200 && respTripType(seatmap.data) != null && respTripType(seatmap.data) !== tripType) {
          return { ok: false, stage: 'seatmap-tt', seatmap, note: `seatmap tt=${respTripType(seatmap.data)}` };
        }
      }

      const issueBody = buildIssueTicketPayload({
        bookingContext, priceId, searchIds, journeyType, passengerProfile: pax,
      });
      const issue = await flight.issueTicketV2(issueBody);
      scanPayload(`${id}-issue`, issue.data, observations);
      const br = issue.data?.bookingRefId
        || issue.data?.bookingReferenceId
        || issue.data?.bookingReference
        || issue.data?.data?.bookingRefId;
      const issueTt = respTripType(issue.data);
      console.log(`  issue HTTP ${issue.status} br=${br || '-'} code=${errCode(issue)} tt=${issueTt}`);

      if (errCode(issue) === 'INSUFFICIENT_BALANCE' || /INSUFFICIENT_BALANCE/i.test(brief(issue.data))) {
        abortBooks = true;
        return { ok: false, stage: 'balance', issue, note: 'INSUFFICIENT_BALANCE — abort remaining books' };
      }
      if (!issue.ok || !br) {
        return {
          ok: false, stage: 'issue', issue, pricing, ssr, seatmap,
          note: `issue HTTP ${issue.status} code=${errCode(issue)} ${errText(issue).slice(0, 120)}`,
        };
      }
      if (issueTt != null && issueTt !== tripType) {
        observations.push({
          severity: 'BUG',
          where: `${id}-issue`,
          note: `issue-ticket tripType=${issueTt} expected ${tripType}`,
        });
      }

      let finalStatus = null;
      let statusRes = null;
      for (let i = 0; i < 12; i += 1) {
        statusRes = await flight.getBookingStatus(br);
        scanPayload(`${id}-status-${i}`, statusRes.data, observations);
        finalStatus = String(statusRes.data?.status || '');
        console.log(`  status ${i + 1}: ${finalStatus}`);
        if (isTerminalBookingStatus(finalStatus) || /inprogress/i.test(finalStatus)) break;
        await sleep(3000);
      }

      const detail = await flight.getBookingDetail(br);
      scanPayload(`${id}-detail`, detail.data, observations);
      const detailTt = respTripType(detail.data);
      const statusTt = respTripType(statusRes?.data);

      let cancelRes = null;
      if (/confirm/i.test(finalStatus)) {
        // try cancel to free inventory/wallet
        const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr
          || detail.data?.pnr
          || null;
        cancelRes = await flight.cancelBooking(br, {
          ...(pnr ? { pnr } : {}),
          cancelledBy: 'QA-delta-triptype',
        });
        scanPayload(`${id}-cancel`, cancelRes.data, observations);
        console.log(`  cancel HTTP ${cancelRes.status} code=${errCode(cancelRes)}`);
      }

      return {
        ok: true,
        br,
        finalStatus,
        detailTt,
        statusTt,
        issueTt,
        searchTt: tt,
        seatmapHttp: seatmap?.status ?? null,
        seatmapCode: errCode(seatmap),
        cancelHttp: cancelRes?.status ?? null,
        pax,
        total: Number.isFinite(total) ? total : null,
        issue,
        detail,
        statusRes,
      };
    }

    // attempt 1
    let result = await oneAttempt(0);
    if (!result.ok && /inprogress/i.test(String(result.finalStatus || '')) === false
      && result.stage !== 'balance'
      && result.stage !== 'search-tt'
      && result.stage !== 'ssr-tt'
      && result.stage !== 'seatmap-tt') {
      // If failed at issue/search inventory — one retry with new dates happens inside attempt via bodyFactory offset
    }
    // Inprogress → one retry with different names+dates (AGENTS default)
    if (result.ok && /inprogress/i.test(String(result.finalStatus || ''))) {
      console.log('  Inprogress — retry once with new names+dates');
      const retry = await oneAttempt(1);
      result = retry.ok ? retry : { ...result, retry };
    }

    if (!result.ok) {
      if (result.stage === 'balance') {
        bug(id, label, result.note, result.issue);
      } else if (/search|ids|rt|fare-cap/i.test(result.stage || '')) {
        nt(id, label, result.note);
      } else {
        bug(id, label, result.note, result.issue || result.pricing || result.search);
      }
      return result;
    }

    const ttOk = [result.searchTt, result.issueTt, result.detailTt, result.statusTt]
      .filter((x) => x != null)
      .every((x) => x === tripType);

    const note = [
      `BR=${result.br}`,
      `status=${result.finalStatus}`,
      `tt search/issue/detail/status=${result.searchTt}/${result.issueTt}/${result.detailTt}/${result.statusTt}`,
      `seatmap HTTP ${result.seatmapHttp} code=${result.seatmapCode}`,
      `cancel HTTP ${result.cancelHttp}`,
      `fare≈${result.total}`,
    ].join(' | ');

    if (!/confirm|cancel|fail/i.test(String(result.finalStatus || '')) && /inprogress/i.test(String(result.finalStatus || ''))) {
      nt(id, label, `left Inprogress after retry — ${note}`);
    } else if (ttOk && /confirm/i.test(String(result.finalStatus || ''))) {
      pass(id, label, note, result.issue, { br: result.br, finalStatus: result.finalStatus });
    } else if (ttOk && /fail/i.test(String(result.finalStatus || ''))) {
      // booking failed but tripType casing path worked through issue
      bug(id, label, `terminal Failed (tripType ok) — ${note}`, result.issue, { br: result.br });
    } else if (!ttOk) {
      bug(id, label, `tripType casing/missing on book path — ${note}`, result.detail || result.issue);
    } else {
      pass(id, label, note, result.issue, { br: result.br, finalStatus: result.finalStatus });
    }

    bookings.push({
      id, label, br: result.br, status: result.finalStatus, tripType, journeyType, pax: result.pax,
    });
    return result;
  }

  // Flight books
  await bookScenario({
    id: 'B1',
    label: 'E2E OW domestic DEL→BOM book',
    tripType: 'domestic',
    journeyType: 'ONE_WAY',
    bodyFactory: (a) => buildOneWaySearchBody(35 + a * 7, {
      origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL',
    }),
  });

  await bookScenario({
    id: 'B2',
    label: 'E2E RT domestic DEL↔BOM book',
    tripType: 'domestic',
    journeyType: 'ROUND_TRIP',
    bodyFactory: (a) => buildRoundTripSearchBody(40 + a * 7, 47 + a * 7, {
      origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL',
    }),
  });

  await bookScenario({
    id: 'B3',
    label: 'E2E OW international DEL→DXB book',
    tripType: 'international',
    journeyType: 'ONE_WAY',
    bodyFactory: (a) => buildOneWaySearchBody(40 + a * 7, {
      origin: 'DEL', destination: 'DXB', maxStops: null, fareType: 'NORMAL',
    }),
  });

  await bookScenario({
    id: 'B4',
    label: 'E2E RT international DEL↔DXB book',
    tripType: 'international',
    journeyType: 'ROUND_TRIP',
    bodyFactory: (a) => buildRoundTripSearchBody(45 + a * 7, 52 + a * 7, {
      origin: 'DEL', destination: 'DXB', maxStops: null, fareType: 'NORMAL',
    }),
  });

  // ─── Hotel E2E with tripType ───────────────────────────────────────
  async function hotelE2E() {
    if (abortBooks) {
      nt('H1', 'Hotel E2E domestic finalize', 'Aborted — balance');
      return;
    }
    console.log('\n=== H1 Hotel domestic E2E ===');
    const cities = ['328605:IN', '357389:IN'];
    let booked = null;

    for (const entityId of cities) {
      for (const days of [14, 21, 28, 35]) {
        const checkin = futureDate(days);
        const checkout = futureDate(days + 1);
        const searchBody = {
          type: 'CITY',
          entityId,
          nationality: 'IN',
          currency: 'INR',
          checkin,
          checkout,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        };
        const search = await hotel.search(searchBody, { tripType: 'domestic' });
        scanPayload('H-search', search.data, observations);
        const list = hotelList(search.data);
        const stt = respTripType(search.data);
        console.log(`  search entity=${entityId} +${days}d n=${list.length} tt=${stt}`);
        if (search.status !== 200 || !list.length || stt !== 'domestic') continue;

        const detailsBody = {
          type: 'HOTEL',
          entityId: String(list[0].id || list[0].hotelId || list[0].entityId),
          nationality: 'IN',
          currency: 'INR',
          checkin,
          checkout,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        };
        const details = await client.request({
          method: 'POST',
          path: '/v1/hotels/details',
          query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, tripType: 'domestic' },
          body: detailsBody,
          correlation: true,
        });
        scanPayload('H-details', details.data, observations);
        const dtt = respTripType(details.data);
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        const codes = extractBookingCodes(details.data, 8);
        if (details.status !== 200 || !requestId || !codes.length) continue;
        if (dtt != null && dtt !== 'domestic') {
          bug('H1', 'Hotel details tripType domestic', `tt=${dtt}`, details);
          return;
        }

        for (const bookingCode of codes.slice(0, 4)) {
          const prebook = await client.request({
            method: 'POST',
            path: '/v1/hotels/prebook',
            query: { lang: 'en', currency: 'INR', tripType: 'domestic' },
            body: { bookingCode, requestId },
            correlation: true,
          });
          scanPayload('H-prebook', prebook.data, observations);
          if (!isPrebookSuccess(prebook)) continue;
          const ptt = respTripType(prebook.data);
          if (ptt != null && ptt !== 'domestic') {
            bug('H1', 'Hotel prebook tripType domestic', `tt=${ptt}`, prebook);
            return;
          }

          const finalizeBody = {
            bookingContext: extractBookingContext(prebook.data),
            bookingCode,
            requestId,
            checkin,
            checkout,
            rooms: [{
              guests: [{
                title: 'Mr',
                firstName: config.hotel.guestFirstName,
                lastName: `${config.hotel.guestLastName}${Date.now().toString(36).slice(-4)}`,
                type: 'Adult',
                isLead: true,
              }],
            }],
            contact: {
              email: `delta.triptype.${Date.now()}@travelvip.ai`,
              countryCode: '+91',
              mobile: config.hotel.contactMobile,
              panCardNumber: 'ABCDE1234F',
              panCardName: `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`,
            },
          };
          const finalize = await client.request({
            method: 'POST',
            path: '/v1/hotels/finalize-booking',
            query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, tripType: 'domestic' },
            body: finalizeBody,
            correlation: true,
            partnerKey: client.partnerKey,
          });
          scanPayload('H-finalize', finalize.data, observations);
          const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
          console.log(`  finalize HTTP ${finalize.status} br=${br || '-'} code=${errCode(finalize)}`);
          if (errCode(finalize) === 'INSUFFICIENT_BALANCE') {
            abortBooks = true;
            bug('H1', 'Hotel E2E domestic finalize', 'INSUFFICIENT_BALANCE', finalize);
            return;
          }
          if (!finalize.ok || !br) continue;

          let st = null;
          let statusRes = null;
          for (let i = 0; i < 20; i += 1) {
            statusRes = await hotel.getBookingStatus(br);
            scanPayload(`H-status-${i}`, statusRes.data, observations);
            st = String(statusRes.data?.status || '');
            console.log(`  hotel status ${i + 1}: ${st}`);
            if (statusRes.ok && isTerminalHotelStatus(st)) break;
            await sleep(4000);
          }
          const hDetail = await hotel.getBookingDetail(br);
          scanPayload('H-detail', hDetail.data, observations);
          const cancel = /confirm/i.test(st) ? await hotel.cancelBooking(br) : null;
          if (cancel) scanPayload('H-cancel', cancel.data, observations);

          booked = {
            br, st, searchTt: stt, detailsTt: dtt, prebookTt: ptt,
            finalizeTt: respTripType(finalize.data),
            detailTt: respTripType(hDetail.data),
            cancelHttp: cancel?.status ?? null,
            entityId, checkin, checkout,
          };
          break;
        }
        if (booked) break;
      }
      if (booked) break;
    }

    // Autocomplete casing observation
    const auto = await client.request({
      method: 'GET',
      path: '/v1/hotels/autocomplete',
      query: { q: 'mumbai', tripType: 'DOMESTIC', lang: 'en', currency: 'INR', page: 0, perpage: 10 },
      correlation: true,
    });
    scanPayload('H-auto', auto.data, observations);
    if (auto.status === 200 && respTripType(auto.data) === 'domestic') {
      pass('H0', 'Hotel autocomplete DOMESTIC → domestic', `tt=${respTripType(auto.data)} n=${hotelAuto(auto.data).length}`, auto);
    } else {
      bug('H0', 'Hotel autocomplete DOMESTIC → domestic', `HTTP ${auto.status} tt=${respTripType(auto.data)}`, auto);
    }

    if (!booked) {
      nt('H1', 'Hotel E2E domestic finalize', 'No bookable inventory / finalize failed');
      return;
    }
    const tts = [booked.searchTt, booked.detailsTt, booked.prebookTt, booked.finalizeTt, booked.detailTt]
      .filter((x) => x != null);
    const allDom = tts.every((x) => x === 'domestic');
    const note = `BR=${booked.br} status=${booked.st} tts=${tts.join(',')} cancelHTTP=${booked.cancelHttp}`;
    if (allDom && /confirm/i.test(booked.st)) pass('H1', 'Hotel E2E domestic finalize+cancel', note, null, booked);
    else if (allDom) bug('H1', 'Hotel E2E domestic finalize+cancel', `not Confirmed — ${note}`, null, booked);
    else bug('H1', 'Hotel E2E domestic finalize+cancel', `tripType issue — ${note}`, null, booked);
    bookings.push({ id: 'H1', ...booked, product: 'hotel' });
  }

  await hotelE2E();

  // Airports regression quick
  {
    const res = await client.request({
      method: 'GET',
      path: '/v1/flights/airports',
      query: { airport: 'del', tripType: 'domestic' },
    });
    scanPayload('A1', res.data, observations);
    const list = Array.isArray(res.data?.content) ? res.data.content
      : Array.isArray(res.data?.result) ? res.data.result
        : Array.isArray(res.data?.data) ? res.data.data : [];
    const foreign = list.filter((a) => {
      const cc = String(a?.countryCode || a?.country_code || '').toUpperCase();
      return cc && cc !== 'IN';
    });
    if (res.status === 200 && list.length && foreign.length === 0) {
      pass('A1', 'Airports domestic filter still works', `n=${list.length}`, res);
    } else bug('A1', 'Airports domestic filter still works', `HTTP ${res.status} n=${list.length} foreign=${foreign.length}`, res);
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    counts,
    bookings,
    observations,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [
    `# delta-api tripType E2E book`,
    ``,
    `- at: ${report.at}`,
    `- base: ${report.baseUrl}`,
    `- PASS=${counts.PASS || 0} BUG=${counts.BUG || 0} NOT TESTED=${counts['NOT TESTED'] || 0}`,
    ``,
    `## Bookings`,
    ...(bookings.length
      ? bookings.map((b) => `- ${b.id}: ${b.br || '-'} status=${b.status || b.st || '-'} ${b.label || b.product || ''}`)
      : ['- none']),
    ``,
    `## Observations`,
    ...(observations.length
      ? observations.map((o) => `- [${o.severity}] ${o.where}: ${o.note}`)
      : ['- none (no UPPERCASE tripType leak / Riya leak spotted)']),
    ``,
    `| ID | Rule | Status | Note |`,
    `|----|------|--------|------|`,
    ...rows.map((r) => `| ${r.id} | ${r.rule} | ${r.status} | ${String(r.note || '').replace(/\|/g, '/')} |`),
    ``,
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);

  console.log('\nCOUNTS', counts);
  console.log('BOOKINGS', bookings);
  console.log('OBSERVATIONS', observations.length ? observations : 'none');
  console.log('Wrote', OUT_JSON);
  if ((counts.BUG || 0) > 0 || observations.some((o) => o.severity === 'BUG')) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
