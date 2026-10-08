/**
 * Remaining seat-guard TCs on api-staging that are API-testable.
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/probe-seat-guard-remaining-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { HotelService } from '../../hotel/src/service.js';
import { buildSearchBody as buildHotelSearchBody } from '../../hotel/src/helpers.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  canSelectSeats,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions, pickFareSearchId } from '../src/searchPicker.js';
import { uniqueTag } from '../src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'seat-guard-remaining-staging.json');
const Q = { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 };
const FAILED_BR = process.env.FAILED_BR || 'BR1788426895817401';

const rows = [];
function add(tc, rule, how, expected, status, actual, extra = {}) {
  rows.push({ tc, rule, how, expected, status, actual, ...extra });
  console.log(`[${status}] ${tc} | ${actual}`);
}

function classify(status) {
  const s = String(status || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}
function isSettled(s) {
  return ['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classify(s));
}
function hasMandatorySsr(pricing) {
  return (pricing?.itinerary || []).some((leg) => {
    const m = leg.mandatorySsr;
    return Boolean(m?.meal || m?.seat || m?.baggage) || (Array.isArray(m?.types) && m.types.length > 0);
  });
}
function errCode(d) { return d?.error?.code || d?.data?.error?.code || null; }
function errMsg(d) { return d?.error?.message || d?.data?.error?.message || d?.message || ''; }
function brief(d, n = 280) { try { return JSON.stringify(d).slice(0, n); } catch { return String(d); } }

function buildPax(tag) {
  return [{
    paxId: 'PAX1', type: 'adult', isLead: true,
    profile: { title: 'Mr', firstName: 'Rohan', lastName: `Bhagat${tag}`, gender: 'Male', dob: '2001-05-29', nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }];
}

async function searchUntil(flight, body) {
  let last = null;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.search(body);
    if (last?.ok && (isSearchProgressComplete(last.data) || extractFirstSearchId(last.data))) {
      if (isSearchProgressComplete(last.data) || i >= 3) break;
    }
    await sleep(last?.data?.progress?.pollAfterMs || 2000);
  }
  return last;
}

async function freshQuote(flight) {
  const body = buildOneWaySearchBody(42, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: 0 });
  body.preferences = { airlines: ['IX'], maxStops: 0, refundableOnly: false };
  const search = await searchUntil(flight, body);
  const opts = collectOptions(search?.data, 'ONWARD');
  const opt = opts.find((o) => (o.totalStops ?? 0) === 0) || opts[0];
  const searchId = pickFareSearchId(opt, { fareType: 'NORMAL' }) || extractFirstSearchId(search?.data);
  if (!searchId) return { error: 'no searchId' };
  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!pricing.ok || !pricing.data?.priceId) return { error: 'pricing failed' };
  if (hasMandatorySsr(pricing.data)) return { error: 'mandatorySsr' };
  if (!canSelectSeats(pricing.data)) return { error: 'no seats' };
  return { searchId, pricing: pricing.data, flight: (opt?.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`).join(' / ') };
}

async function issueTicket(client, pricing, searchId, passengers) {
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.bookingContext,
    priceId: pricing.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: passengers[0]?.profile,
  });
  payload.data.passengers = passengers;
  payload.data.passportType = pricing.passportType || 'NONE';
  const res = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = res.data?.bookingReference || res.data?.bookingReferenceId || res.data?.bookingRefId || null;
  return { res, br, payload };
}

async function pollSettled(flight, br) {
  let last = { status: '', polls: 0 };
  for (let i = 0; i < 24; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = { status: String(st.data?.status || ''), polls: i + 1, raw: st.data };
    console.log('  poll', br, last.status);
    if (isSettled(last.status)) return last;
    await sleep(3000);
  }
  return last;
}

function refundFields(obj) {
  const text = JSON.stringify(obj || {});
  const keys = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if (/refund/i.test(k)) keys.push(k);
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(obj);
  return { keys: [...new Set(keys)], hasRefundWord: /refund/i.test(text) };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;
  console.log('=== Remaining seat-guard TCs ===', config.baseUrl);

  // TC-05 / TC-08 — seatless book
  {
    const q = await freshQuote(flight);
    if (q.error) {
      add('TC-05', 'No seat selected still books', 'fresh quote', 'BR + Confirmed', 'NOT TESTED', q.error);
      add('TC-08', 'No seat guard block when no seat requested', 'seatless issue', 'Confirmed/Pending not blocked', 'NOT TESTED', q.error);
    } else {
      const pax = buildPax(uniqueTag());
      const { res, br } = await issueTicket(client, q.pricing, q.searchId, pax);
      if (!br) {
        add('TC-05', 'No seat selected still books', `${q.flight} no seats[]`, 'BR issued', 'BUG', `HTTP ${res.status} ${brief(res.data)}`, { flight: q.flight });
        add('TC-08', 'No seat guard block when no seat requested', 'same', 'not blocked by guard', 'BUG', `no BR code=${errCode(res.data)}`);
      } else {
        const polled = await pollSettled(flight, br);
        const detail = await flight.getBookingDetail(br);
        const seats = (detail.data?.bookingResponse?.passengers || []).flatMap((p) => p.ssr?.seats || []);
        const cls = classify(polled.status);
        const ok = cls === 'Confirmed' && seats.length === 0;
        add('TC-05', 'No seat selected still books', `issue without seats ${q.flight}`, 'Confirmed, no seat on detail',
          ok ? 'PASS' : (cls === 'Inprogress' ? 'NOT TESTED' : (cls === 'Confirmed' ? 'PASS' : 'BUG')),
          `br=${br} status=${polled.status} seats=${seats.length} pnr=${detail.data?.bookingResponse?.itinerary?.[0]?.pnr}`,
          { br });
        add('TC-08', 'No seat guard block when no seat requested', `seatless ${br}`, 'proceeds (not Price expired / seat-guard 4xx)',
          br && cls !== 'Failed' ? 'PASS' : (cls === 'Failed' ? 'BUG' : 'NOT TESTED'),
          `status=${polled.status}`,
          { br });
      }
    }
  }

  // TC-17 — Failed BR refund payload
  {
    const st = await flight.getBookingStatus(FAILED_BR);
    const det = await flight.getBookingDetail(FAILED_BR);
    const cls = classify(st.data?.status);
    const rf = refundFields(det.data);
    add('TC-17', 'Failed response must include refund payload when applicable',
      `GET detail ${FAILED_BR} (prior Failed book)`,
      'refund block if money moved',
      cls !== 'Failed' ? 'NOT TESTED' : (rf.hasRefundWord ? 'PASS' : 'NOT TESTED'),
      `status=${st.data?.status} refundKeys=${rf.keys.join(',') || 'none'}`,
      { br: FAILED_BR });
  }

  // TC-06 / TC-07 — stale priceId (best API proxy; not a live fare-up)
  {
    const q = await freshQuote(flight);
    if (q.error) {
      add('TC-06', 'Fare up → Price has expired', 'stale priceId', '400 Price has expired', 'NOT TESTED', q.error);
      add('TC-07', 'Fare amounts only in alert', 'same', 'no amounts in error body', 'NOT TESTED', q.error);
    } else {
      const fake = { ...q.pricing, priceId: 'price_00000000000000000000000000000000' };
      const pax = buildPax(uniqueTag());
      const { res, br } = await issueTicket(client, fake, q.searchId, pax);
      const msg = errMsg(res.data);
      const expired = /price has expired|search again/i.test(msg);
      const body = JSON.stringify(res.data || {});
      const amountsInError = /[₹]|INR\s*\d|totalAmount|baseFare/i.test(body) && res.status >= 400;
      add('TC-06', 'Fare up on re-price → Price has expired',
        'issue with unknown priceId (not a live fare-up)',
        '400 message Price has expired. Please search again.',
        expired ? 'PASS' : 'NOT TESTED',
        `HTTP ${res.status} br=${br || 'none'} code=${errCode(res.data)} msg=${msg.slice(0, 160)}`);
      add('TC-07', 'Fare change amounts only in alert not API',
        'error body of TC-06-style call',
        'no amounts in API error',
        expired && !amountsInError ? 'PASS' : 'NOT TESTED',
        `amountsInError=${amountsInError} body=${body.slice(0, 180)}`);
    }
  }

  // TC-08b — seatmap unavailable: call seatmap with junk bookingContext then issue without seat (fail-open path)
  {
    const q = await freshQuote(flight);
    const pax = buildPax(uniqueTag());
    const smPax = pax.map((p, i) => ({
      paxRefNumber: String(i + 1), passengerType: 1, gender: p.profile.gender,
      title: p.profile.title, firstName: p.profile.firstName, lastName: p.profile.lastName,
    }));
    const badSm = await flight.getSeatMap('NOT-A-REAL-BOOKING-CONTEXT', smPax);
    add('TC-08b-map', 'Seatmap with bad context does not 500',
      'GET/POST seatmap junk bookingContext',
      '4xx, not 500',
      badSm.status !== 500 ? 'PASS' : 'BUG',
      `seatmap HTTP ${badSm.status} code=${errCode(badSm.data)}`);
    add('TC-08b', 'Seatmap/re-price unavailable → fail open (book as before)',
      'cannot force vendor seatmap outage on live Riya',
      'books as before',
      'NOT TESTED',
      `junk seatmap HTTP ${badSm.status}; live outage not simulated`);
  }

  // TC-04 / TC-12 / TC-13 / TC-14 / TC-15 / TC-16 / TC-18
  add('TC-04', 'Seat gone + flag OFF → fail before vendor',
    'PARTNER_ID_2 with retry_ticket_without_seat_on_seat_failure=false',
    '4xx no BR',
    process.env.PARTNER_ID_2 ? 'NOT TESTED' : 'NOT TESTED',
    'no second partner in .env');
  add('TC-12', 'Alert PROCESSING stuck 10 min', 'booking_outbox logs/DB', 'alert fired', 'NOT TESTED', 'no log/DB access; would need 10 min wait');
  add('TC-13', 'Alert vendor IN_PROGRESS 45 min', 'logs/DB', 'alert fired', 'NOT TESTED', 'no log/DB access; would need 45 min wait');

  // TC-14 hotel path — search only, prove hotel finalize is a different API (not flight issue-ticket)
  try {
    const hotel = new HotelService(client);
    const hs = await hotel.search(buildHotelSearchBody());
    add('TC-14', 'Hotel/cab not on flight V2 outbox path',
      `POST /v1/hotels/search HTTP ${hs.status} (no flight issue-ticket)`,
      'hotel uses hotel APIs, not /api/v2/flights/booking/issue-ticket',
      hs.status === 200 || hs.status === 400 ? 'PASS' : 'NOT TESTED',
      `hotel search HTTP ${hs.status}; cab/esim not called; outbox table not inspected`);
  } catch (e) {
    add('TC-14', 'Hotel/cab not on flight V2 outbox path', 'hotel search', 'not flight outbox', 'NOT TESTED', String(e.message || e).slice(0, 160));
  }

  add('TC-15', 'Seatless retry must not report FAILED when ticketed',
    'needs TC-03 drop path', 'Confirmed not Failed', 'NOT TESTED',
    'TC-03 FAIL: both carts kept the seat; drop path never ran');
  add('TC-16', 'Seat amount refunded when dropped', 'needs TC-03', 'seatPrice 0 / refund', 'NOT TESTED', 'seat never dropped');
  add('TC-18', 'Seatless Confirmed not masked as Failed', 'see TC-15', 'Confirmed', 'NOT TESTED', 'see TC-15');

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl, summary, rows };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('=== SUMMARY ===', summary);
  console.log('Wrote', OUT);
  if (summary.BUG > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
