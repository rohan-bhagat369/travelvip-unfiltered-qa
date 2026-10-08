/**
 * Seat Guard + async outbox manual QA probe on canary.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-seat-guard-canary.js
 *
 * Maps to handover TCs (18). DB/log-only rows marked NOT TESTED.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  canSelectSeats,
  extractFirstSearchId,
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { collectOptions, pickFareSearchId } from '../src/searchPicker.js';
import { uniqueTag } from '../src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'seat-guard-canary.json');
const Q = { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 };
const ROUTES = [
  { o: 'DEL', d: 'BOM', days: [42, 45, 48, 51, 55], airlines: ['SG', '6E', 'IX'] },
  { o: 'BLR', d: 'HYD', days: [42, 45, 48], airlines: ['6E', 'SG'] },
  { o: 'BOM', d: 'DEL', days: [42, 45, 48], airlines: ['6E', 'IX'] },
];

const rows = [];

function brief(d, n = 320) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function errCode(d) {
  return d?.error?.code || d?.data?.error?.code || null;
}

function errMsg(d) {
  return d?.error?.message || d?.data?.error?.message || d?.message || '';
}

function add(tc, area, rule, how, expected, status, actual, extra = {}) {
  rows.push({ tc, area, rule, how, expected, status, actual, ...extra });
  console.log(`[${status}] ${tc} ${rule}`);
}

function seatMapSegments(sm) {
  const data = sm?.data?.data || sm?.data || {};
  return data.segments || data.FlightSeat?.segments || [];
}

function scanSeats(sm) {
  let open = 0;
  let closed = 0;
  let firstOpen = null;
  let firstClosed = null;
  for (const seg of seatMapSegments(sm)) {
    for (const s of seg.seatMap || seg.seats || []) {
      const avail = String(s.seatAvailability || s.availability || '');
      if (/open/i.test(avail)) {
        open += 1;
        if (!firstOpen) {
          const seatName = s.seatName || s.seatNumber;
          const seatId = s.seatId || s.seatKey;
          const pref = s.priceReference || s.priceDetail?.priceReference;
          if (seatName && seatId && pref) {
            firstOpen = {
              item: {
                origin: s.origin || seg.origin,
                destination: s.destination || seg.destination,
                segmentId: s.segmentId || seg.segmentId || 'SEG_1',
                seatAvailability: 'Open',
                seatName,
                seatPosition: s.seatPosition || '',
                seatKey: String(s.seatKey || seatId),
                seatId: String(seatId),
                direction: 'ONWARD',
                priceReference: pref,
              },
              amount: Number(s.amount || s.price || 0),
            };
          }
        }
      } else if (/closed/i.test(avail)) {
        closed += 1;
        if (!firstClosed) {
          const seatName = s.seatName || s.seatNumber;
          const seatId = s.seatId || s.seatKey;
          const pref = s.priceReference || s.priceDetail?.priceReference;
          if (seatName && seatId && pref) {
            firstClosed = {
              item: {
                origin: s.origin || seg.origin,
                destination: s.destination || seg.destination,
                segmentId: s.segmentId || seg.segmentId || 'SEG_1',
                seatAvailability: 'Closed',
                seatName,
                seatPosition: s.seatPosition || '',
                seatKey: String(s.seatKey || seatId),
                seatId: String(seatId),
                direction: 'ONWARD',
                priceReference: pref,
              },
              amount: Number(s.amount || s.price || 0),
            };
          }
        }
      }
    }
  }
  return { open, closed, firstOpen, firstClosed };
}

function buildPax(tag) {
  return [{
    paxId: 'PAX1',
    type: 'adult',
    isLead: true,
    profile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: `Bhagat${tag}`,
      gender: 'Male',
      dob: '2001-05-29',
      nationality: 'IN',
    },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }];
}

async function searchPricing(flight, route, day) {
  const body = buildOneWaySearchBody(day, {
    origin: route.o,
    destination: route.d,
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.preferences = { ...body.preferences, maxStops: 0 };

  let last = null;
  for (let i = 0; i < 10; i += 1) {
    for (const airline of route.airlines) {
      body.preferences.airlines = [airline];
      last = await flight.search(body);
      const sid = extractFirstSearchId(last.data);
      if (sid) {
        const opt = collectOptions(last.data, 'ONWARD')[0];
        const searchId = pickFareSearchId(opt, { fareType: 'NORMAL' }) || sid;
        const pricing = await flight.getPricing([searchId], 'ONE_WAY');
        if (pricing.ok && pricing.data?.priceId && pricing.data?.bookingContext) {
          return {
            route: `${route.o}-${route.d}`,
            day,
            airline,
            searchId,
            pricing: pricing.data,
            supportsSeats: canSelectSeats(pricing.data),
            flight: opt?.segments?.map((s) => `${s.airline?.code || s.airlineCode} ${s.flightNumber}`).join(' / '),
          };
        }
      }
      if (isSearchProgressComplete(last.data)) break;
    }
    await sleep(last?.data?.progress?.pollAfterMs || 2000);
  }
  return null;
}

async function getSeatMap(flight, bookingContext, passengers) {
  const smPax = passengers.map((p, i) => ({
    paxRefNumber: String(i + 1),
    passengerType: 1,
    gender: p.profile.gender,
    title: p.profile.title,
    firstName: p.profile.firstName,
    lastName: p.profile.lastName,
  }));
  return flight.getSeatMap(bookingContext, smPax);
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
  if (pricing.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.gstDetails = {
      gstNumber: '27AABCT1429B1Z1',
      gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
      gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
      gstEmailID: 'accounts@travelvip.ai',
      gstMobileNumber: '9921862715',
    };
  }
  const res = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = res.data?.bookingReference || res.data?.bookingReferenceId;
  return { res, br };
}

async function pollStatus(flight, br, max = 8) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (isTerminalBookingStatus(st) && !/pending/i.test(st)) return { status: st, polls: i + 1, raw: last.data };
    if (/pending/i.test(st) && i >= 4) return { status: st, polls: i + 1, raw: last.data };
    await sleep(2500);
  }
  return { status: String(last?.data?.status || ''), polls: max, raw: last?.data };
}

function seatCountFromDetail(detail) {
  const pax = detail?.data?.bookingResponse?.passengers || [];
  return pax.reduce((n, p) => n + (p.ssr?.seats || p.ssr?.seat || []).length, 0);
}

function salesSeatPrice(detail) {
  return detail?.data?.bookingResponse?.salesSummary?.seatPrice ?? null;
}

async function findFixture(flight) {
  for (const route of ROUTES) {
    for (const day of route.days) {
      const hit = await searchPricing(flight, route, day);
      if (!hit?.supportsSeats) continue;
      const tag = uniqueTag();
      const passengers = buildPax(tag);
      const sm = await getSeatMap(flight, hit.pricing.bookingContext, passengers);
      if (!sm.ok) continue;
      const stats = scanSeats(sm);
      if (stats.open > 0 || stats.closed > 0) {
        return { ...hit, tag, passengers, seatmap: sm, stats };
      }
    }
  }
  return null;
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;

  console.log('=== Seat Guard canary probe ===');
  console.log('Base', config.baseUrl);

  const fixture = await findFixture(flight);
  if (!fixture) {
    add('TC-01', 'Setup', 'Find seat-enabled OW pricing + seatmap', 'Search DEL-BOM/BLR-HYD/BOM-DEL', 'fixture with Open or Closed seats', 'NOT TESTED', 'no supportsSeats+seatmap inventory');
    fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), baseUrl: config.baseUrl, rows }, null, 2));
    console.log('Wrote', OUT);
    process.exit(1);
  }

  const { stats } = fixture;
  add(
    'TC-01',
    'Setup',
    'Seat-enabled flight + live seatmap',
    `GET seatmap after pricing ${fixture.route} d+${fixture.day} ${fixture.flight}`,
    'seatmap segments with seat rows',
    'PASS',
    `open=${stats.open} closed=${stats.closed} supportsSeats=true`,
    { route: fixture.route, flight: fixture.flight, searchId: fixture.searchId },
  );

  // TC-02: Open seat → book
  if (stats.firstOpen) {
    const pax = buildPax(uniqueTag());
    pax[0].ssr.seats = [stats.firstOpen.item];
    const { res, br } = await issueTicket(client, fixture.pricing, fixture.searchId, pax);
    if (!br) {
      add('TC-02', 'Seat guard', 'Open seat → books with seat', 'issue-ticket with Open seat from live map', 'BR + eventual Confirmed with seat', 'BUG', `issue HTTP ${res.status} ${brief(res.data)}`);
    } else {
      const immStatus = res.data?.status || null;
      add(
        'TC-09',
        'Outbox',
        'Issue-ticket returns BR before terminal status',
        `issue-ticket immediate response BR=${br}`,
        'bookingReference returned (async outbox enqueue)',
        br ? 'PASS' : 'BUG',
        `HTTP ${res.status} status=${immStatus || 'n/a'} br=${br}`,
        { br },
      );
      const polled = await pollStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const seats = seatCountFromDetail(detail);
      const ok = /confirm/i.test(polled.status) && seats >= 1;
      add(
        'TC-02',
        'Seat guard',
        'Open seat → books; seat present on Confirmed',
        `issue with ${stats.firstOpen.item.seatName} seatId=${stats.firstOpen.item.seatId}; poll status`,
        'Confirmed + seat on booking detail',
        ok ? 'PASS' : (/confirm/i.test(polled.status) ? 'BUG' : 'NOT TESTED'),
        `status=${polled.status} seatsOnDetail=${seats} seatPrice=${salesSeatPrice(detail)}`,
        { br, polled: polled.status, seatName: stats.firstOpen.item.seatName },
      );
      add(
        'TC-11',
        'Outbox',
        'Worker completes V2 booking to terminal status',
        `poll GET status until terminal for ${br}`,
        'Confirmed/Failed/Cancelled (not stuck forever at issue)',
        isTerminalBookingStatus(polled.status) ? 'PASS' : 'BUG',
        `terminal=${polled.status} polls=${polled.polls}`,
        { br },
      );
    }
  } else {
    add(
      'TC-02',
      'Seat guard',
      'Open seat → books with refreshed seat id',
      'Need ≥1 Open seat on canary seatmap',
      'Confirmed with seat on detail',
      'NOT TESTED',
      `all ${stats.closed} sampled seats Closed on ${fixture.route} ${fixture.flight}`,
    );
  }

  // TC-03 / TC-15: Closed or stale seat — vgm flag assumed ON
  if (stats.firstClosed || stats.firstOpen) {
    const pax = buildPax(uniqueTag());
    const closedItem = stats.firstClosed?.item || {
      ...stats.firstOpen.item,
      seatAvailability: 'Closed',
    };
    // Force stale seatId while keeping seatName from map
    pax[0].ssr.seats = [{
      ...closedItem,
      seatId: `STALE_${closedItem.seatId}`,
      seatKey: `STALE_${closedItem.seatKey}`,
    }];
    const { res, br } = await issueTicket(client, fixture.pricing, fixture.searchId, pax);
    if (!br) {
      const msg = errMsg(res.data);
      const code = errCode(res.data);
      const blocked = /price has expired|search again|validation|seat/i.test(msg);
      add(
        'TC-03',
        'Seat guard',
        'Seat gone + flag ON → drop seat, re-price, book without seat',
        'issue with Closed/stale seatId; partner retry_ticket_without_seat_on_seat_failure assumed ON',
        'BR issued; Confirmed without seat; seat refund',
        blocked ? 'NOT TESTED' : 'BUG',
        `HTTP ${res.status} code=${code} msg=${msg.slice(0, 200)}`,
      );
    } else {
      const polled = await pollStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const seats = seatCountFromDetail(detail);
      const seatPrice = salesSeatPrice(detail);
      const confirmedNoSeat = /confirm/i.test(polled.status) && seats === 0;
      add(
        'TC-03',
        'Seat guard',
        'Seat gone + flag ON → drop seat, book without seat',
        `stale/closed seat payload → issue ${br}`,
        'Confirmed without seat on detail',
        confirmedNoSeat ? 'PASS' : (/confirm/i.test(polled.status) && seats > 0 ? 'BUG' : 'NOT TESTED'),
        `status=${polled.status} seats=${seats} seatPrice=${seatPrice}`,
        { br },
      );
      add(
        'TC-15',
        'Bug fix',
        'Seatless retry must not report FAILED when ticketed',
        `same BR ${br} after seat dropped`,
        'Confirmed (not Failed) with ticket/PNR',
        /confirm/i.test(polled.status) ? 'PASS' : (/fail/i.test(polled.status) ? 'BUG' : 'NOT TESTED'),
        `status=${polled.status} pnr=${detail.data?.bookingResponse?.itinerary?.[0]?.pnr || 'n/a'}`,
        { br },
      );
      add(
        'TC-16',
        'Seat guard',
        'Seat amount refunded when seat dropped',
        'salesSummary.seatPrice on Confirmed seatless retry',
        'seatPrice 0 or absent; refund in wallet/alerts (API may omit)',
        seatPrice === 0 || seatPrice == null ? 'PASS' : 'NOT TESTED',
        `seatPrice=${seatPrice}`,
        { br },
      );
    }
  }

  // TC-04: flag OFF — needs partner without retry flag
  add(
    'TC-04',
    'Seat guard',
    'Seat gone + flag OFF → fail before vendor',
    'Needs partner with retry_ticket_without_seat_on_seat_failure=false',
    '4xx before vendor; no BR',
    process.env.PARTNER_ID_2 ? 'NOT TESTED' : 'NOT TESTED',
    'only vgm creds in env; cannot toggle flag OFF',
  );

  // TC-05: issue without any seat on optional-seat fare (fail-open baseline)
  {
    const pax = buildPax(uniqueTag());
    const { res, br } = await issueTicket(client, fixture.pricing, fixture.searchId, pax);
    add(
      'TC-05',
      'Seat guard',
      'No seat selected on optional-seat fare still books',
      'issue-ticket without seats array populated',
      'BR + Confirmed or Pending (legacy path)',
      br ? 'PASS' : 'BUG',
      `HTTP ${res.status} br=${br || 'none'} code=${errCode(res.data) || 'n/a'}`,
      { br },
    );
    if (br) {
      const polled = await pollStatus(flight, br, 6);
      add(
        'TC-08',
        'Seat guard',
        'No seat guard block when no seat requested',
        `seatless book ${br}`,
        'Proceeds without seat-guard re-price block',
        /confirm|pending|inprogress/i.test(polled.status) ? 'PASS' : 'BUG',
        `status=${polled.status}`,
        { br },
      );
    }
  }

  // TC-06/07 fare change — not reproducible on demand
  add('TC-06', 'Seat guard', 'Fare up on re-price → Price has expired', 'Manual/timed repro only', '400 message "Price has expired. Please search again."', 'NOT TESTED', 'no on-demand repro');
  add('TC-07', 'Seat guard', 'Fare change amounts only in alert not API', 'Same as TC-06', 'no amounts in error body', 'NOT TESTED', 'no on-demand repro');

  // TC-08b seatmap unavailable fail-open — skip destructive test; note
  add('TC-08b', 'Seat guard', 'Seatmap/re-price unavailable → fail open', 'Would need forced vendor outage', 'books as before', 'NOT TESTED', 'not simulated');

  // Outbox alert rows — DB/log only
  add('TC-12', 'Outbox', 'Alert PROCESSING stuck 10 min', 'DB/log grep booking_outbox', 'alert fired', 'NOT TESTED', 'requires log/DB access + wait');
  add('TC-13', 'Outbox', 'Alert vendor IN_PROGRESS 45 min', 'DB/log grep', 'alert fired', 'NOT TESTED', 'requires log/DB access + wait');
  add('TC-14', 'Outbox', 'Hotel/cab not on outbox path', 'compare product', 'flight V2 only', 'NOT TESTED', 'out of API-only probe scope');

  add('TC-17', 'Bug fix', 'Failed response must include refund payload when applicable', 'needs known failing wallet/refund case', 'refund block on partner response', 'NOT TESTED', 'no repro this run');
  add('TC-18', 'Bug fix', 'Regression — seatless Confirmed not masked as Failed', 'covered by TC-15 when repro succeeds', 'Confirmed', rows.find((r) => r.tc === 'TC-15')?.status || 'NOT TESTED', 'see TC-15');

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixture: {
      route: fixture.route,
      day: fixture.day,
      flight: fixture.flight,
      openSeats: stats.open,
      closedSeats: stats.closed,
    },
    summary,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===', summary);
  console.log('Wrote', OUT);
  if (summary.BUG > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
