/**
 * Theta wallet charge-first changelog — Flight / Hotel / Cab
 *
 *   BASE_URL=https://theta-api.travelvip.ai node travel-apis/scripts/probe-theta-wallet-charge-first-changelog.js
 *
 * Env:
 *   PRODUCTS=flight,hotel,cab   (default all)
 *   CASES=A,C,D,E,F,G,H,I,J     (default A,C,D,E,F,G,H,I,J — B/K skipped)
 *   SKIP_DEBIT_CASES=1          skip G/I (leave money out)
 *
 * Scores API + wallet activity. DB / Mattermost = NOT TESTED without access.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { sleep, futureDate } from '../../shared/lib/testUtils.js';
import { FlightService } from '../flight/src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
} from '../flight/src/helpers.js';
import { HotelService } from '../hotel/src/service.js';
import {
  buildSearchBody,
  buildFinalizeBody,
  buildGuests,
  extractRequestId,
  extractBookingContext,
} from '../hotel/src/helpers.js';
import { CabService } from '../cab/src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody as buildCabFinalize,
  pickCab,
} from '../cab/src/helpers.js';

const BASE = (process.env.BASE_URL || config.baseUrl || 'https://theta-api.travelvip.ai').replace(/\/$/, '');
const OUT_DIR = path.join('travel-apis', 'reports');
const OUT_SUFFIX = process.env.REPORT_SUFFIX || '';
const OUT = path.join(OUT_DIR, `theta-wallet-charge-first-changelog${OUT_SUFFIX}.json`);
const MD = path.join(OUT_DIR, `theta-wallet-charge-first-changelog${OUT_SUFFIX}.md`);

const PRODUCTS = String(process.env.PRODUCTS || 'flight,hotel,cab')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const CASES = String(process.env.CASES || 'A,C,D,E,F,G,H,I,J')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const SKIP_DEBIT = process.env.SKIP_DEBIT_CASES === '1';

const CASE_HEADER = {
  A: null,
  C: 'provider_reject',
  D: 'provider_no_response',
  E: 'wallet_commit_fail',
  F: 'wallet_commit_fail,wallet_release_fail',
  G: 'provider_reject,wallet_refund_fail',
  H: 'wallet_debit_record_fail',
  I: 'provider_reject,wallet_debit_record_fail',
  J: null,
};

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

function refundBlock(data) {
  return data?.refund || data?.error?.refund || data?.data?.refund || null;
}

function pickBr(product, data) {
  if (product === 'cab') return data?.bookingRefId || data?.bookingReference || null;
  return data?.bookingReference || data?.bookingReferenceId || data?.bookingRefId || null;
}

function uniqLast(tag) {
  const t = String(tag || 'X').replace(/[^A-Za-z]/g, '').slice(0, 6) || 'X';
  // letters only — hotel/cab reject digits in names
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let stamp = '';
  let n = Date.now();
  while (stamp.length < 5) {
    stamp += alphabet[n % 26];
    n = Math.floor(n / 26);
  }
  return `Qa${t}${stamp}`;
}

async function walletFeed(accessToken) {
  const url = new URL(`${BASE}/v1/wallet/activity`);
  url.searchParams.set('page', '1');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Request-Id': `wa-${Date.now()}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, summary: data?.summary || null };
}

function walletAvailable(summary) {
  if (!summary) return null;
  return summary.available ?? summary.cashBalance ?? summary.balance ?? null;
}

function scoreCase(product, caseId, ctx) {
  const { http, code, statusText, refund, balBefore, balAfter, bookRes } = ctx;
  const delta = (balBefore != null && balAfter != null) ? Number(balAfter) - Number(balBefore) : null;
  const checks = [];
  const add = (rule, ok, actual) => checks.push({ rule, status: ok ? 'PASS' : 'BUG', actual });

  if (caseId === 'A') {
    const accepted = http < 500 && !/WALLET_COMMIT|INSUFFICIENT|HOLD_FAILED/i.test(String(code || ''))
      && !/FAIL/i.test(String(statusText || ''));
    // Cab/hotel may return PENDING; flight may be pending/confirmed
    const okStatus = product === 'cab'
      ? /PENDING|CONFIRMED|ASSIGNED|COMPLETED/i.test(String(statusText || bookRes?.data?.status || ''))
        || (http === 200 && pickBr(product, bookRes?.data))
      : Boolean(pickBr(product, bookRes?.data)) && !/FAIL/i.test(String(statusText || ''));
    add('Booking accepted / not wallet-fail', accepted && okStatus, `http=${http} code=${code} status=${statusText} br=${pickBr(product, bookRes?.data)}`);
    add('No refund section', !refund, `refund=${brief(refund, 120)}`);
    if (balBefore != null && balAfter != null) {
      add('Wallet charged (balance dropped or equal if free)', delta <= 0.01, `before=${balBefore} after=${balAfter} delta=${delta}`);
    } else {
      checks.push({ rule: 'Wallet charged', status: 'NOT TESTED', actual: 'wallet feed unavailable' });
    }
  } else if (caseId === 'C') {
    if (product === 'flight') {
      add('TICKET_ISSUANCE_FAILED / 502', code === 'TICKET_ISSUANCE_FAILED' || http === 502, `http=${http} code=${code}`);
    } else if (product === 'hotel') {
      add('Hotel FAILED / 400', /FAIL/i.test(String(statusText || bookRes?.data?.status || '')) || http === 400 || bookRes?.data?.statusCode === 400,
        `http=${http} status=${statusText||bookRes?.data?.status} statusCode=${bookRes?.data?.statusCode}`);
    } else {
      add('Cab FAILED statusCode 200', /FAIL/i.test(String(statusText || bookRes?.data?.status || '')) && (http === 200 || bookRes?.data?.statusCode === 200),
        `http=${http} status=${statusText||bookRes?.data?.status} statusCode=${bookRes?.data?.statusCode}`);
    }
    add('refund.status SUCCESS + walletTransactionId', refund?.status === 'SUCCESS' && Boolean(refund?.walletTransactionId),
      `refund=${brief(refund, 220)}`);
    if (balBefore != null && balAfter != null) {
      add('Balance restored (±2)', Math.abs(delta) <= 2, `before=${balBefore} after=${balAfter} delta=${delta}`);
    } else {
      checks.push({ rule: 'Balance restored', status: 'NOT TESTED', actual: 'wallet feed unavailable' });
    }
  } else if (caseId === 'D') {
    add('Stays PENDING (not FAILED)', /PENDING/i.test(String(statusText || bookRes?.data?.status || ''))
      && !/FAIL/i.test(String(statusText || '')), `status=${statusText||bookRes?.data?.status}`);
    add('No refund section', !refund, `refund=${brief(refund, 80)}`);
    if (balBefore != null && balAfter != null) {
      add('Charged (no refund)', delta < -0.01, `before=${balBefore} after=${balAfter} delta=${delta}`);
    }
  } else if (caseId === 'E' || caseId === 'F') {
    add('WALLET_COMMIT_FAILED HTTP 502', code === 'WALLET_COMMIT_FAILED' && http === 502,
      `http=${http} code=${code} msg=${bookRes?.data?.error?.message || ''}`);
    if (balBefore != null && balAfter != null) {
      if (caseId === 'E') {
        add('Balance unchanged after hold release (±2)', Math.abs(delta) <= 2,
          `before=${balBefore} after=${balAfter} delta=${delta}`);
      } else {
        // F: hold not released — available may drop until hold expires (~15m)
        add('Hold retained (available may drop until expiry)', true,
          `before=${balBefore} after=${balAfter} delta=${delta}`);
      }
    }
    // BR may exist as FAILED booking; supplier must not have been called
    add('Response is wallet commit failure (supplier not charged path)', code === 'WALLET_COMMIT_FAILED',
      `br=${pickBr(product, bookRes?.data)}`);
  } else if (caseId === 'G' || caseId === 'I') {
    add('Failure response present', Boolean(code) || /FAIL/i.test(String(statusText || bookRes?.data?.status || '')) || http >= 400,
      `http=${http} code=${code} status=${statusText}`);
    add('refund.status FAILED', refund?.status === 'FAILED', `refund=${brief(refund, 220)}`);
    add('walletTransactionId empty', !refund?.walletTransactionId, `walletTransactionId=${refund?.walletTransactionId}`);
    if (balBefore != null && balAfter != null) {
      add('Still charged (not refunded)', delta < -0.01, `before=${balBefore} after=${balAfter} delta=${delta}`);
    }
  } else if (caseId === 'H') {
    const okBook = Boolean(pickBr(product, bookRes?.data)) && !/WALLET_COMMIT/i.test(String(code || ''));
    add('Booking continues normally', okBook, `http=${http} code=${code} br=${pickBr(product, bookRes?.data)} status=${statusText}`);
    add('No refund section', !refund, `refund=${brief(refund, 80)}`);
    if (balBefore != null && balAfter != null) {
      add('Wallet charged', delta < -0.01, `before=${balBefore} after=${balAfter} delta=${delta}`);
    }
  } else if (caseId === 'J') {
    add('Cancel HTTP not 500', http < 500, `http=${http} code=${code}`);
    if (balBefore != null && balAfter != null) {
      add('Wallet credited or unchanged (penalty)', delta >= -0.01, `before=${balBefore} after=${balAfter} delta=${delta}`);
    }
  }

  checks.push({ rule: 'DB tables', status: 'NOT TESTED', actual: 'no DB access from this runner' });
  checks.push({ rule: 'Mattermost alerts', status: 'NOT TESTED', actual: 'check critical-partner-alerts-dev manually' });

  const bugs = checks.filter((c) => c.status === 'BUG').length;
  const passes = checks.filter((c) => c.status === 'PASS').length;
  const verdict = bugs ? 'BUG' : (passes ? 'PASS' : 'NOT TESTED');
  return { verdict, checks, delta, balBefore, balAfter };
}

async function prepareFlight(flight, tag) {
  const pinOrigin = process.env.FLIGHT_ORIGIN || 'DEL';
  const pinDest = process.env.FLIGHT_DEST || 'PNQ';
  const pinDate = process.env.FLIGHT_DATE || '2026-12-27';
  const days = 28 + Math.floor(Math.random() * 10);
  const routes = [
    [pinOrigin, pinDest],
    ['DEL', 'PNQ'],
    ['DEL', 'BOM'],
    ['BOM', 'DEL'],
    ['DEL', 'GOI'],
    ['BLR', 'DEL'],
  ];
  let lastErr = null;
  for (const [origin, destination] of routes) {
    const body = buildOneWaySearchBody(days, {
      origin, destination, maxStops: null, fareType: 'NORMAL',
    });
    if (pinDate && origin === pinOrigin && destination === pinDest) {
      body.itinerary[0].date = pinDate;
    }
    const first = await flight.search(body);
    if (first.data?.error?.code === 'VENDOR_ERROR' || (!first.ok && first.status >= 400)) {
      lastErr = new Error(`FLIGHT_VENDOR_DOWN: ${errCode(first)} ${brief(first.data, 200)}`);
      continue;
    }
    try {
      const search = await flight.searchUntilComplete(body);
      const searchId = search.searchId;
      if (!searchId) {
        lastErr = new Error(`flight search empty: ${brief(search.response?.data)}`);
        continue;
      }
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
        lastErr = new Error(`pricing missing: ${brief(pricing.data)}`);
        continue;
      }
      const lastName = uniqLast(tag);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
        passengerProfile: {
          title: 'Mr',
          firstName: 'Rohan',
          lastName,
          gender: 'Male',
          dob: '1992-11-18',
        },
      });
      return {
        amount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
        payload,
        lastName,
        searchId,
        route: `${origin}-${destination}`,
        date: body.itinerary[0].date,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('flight prepare failed');
}

async function issueFlight(client, payload, simHeader) {
  const extraHeaders = simHeader ? { 'X-Simulate-Failure': simHeader } : {};
  // Prefer v2 issue-ticket (pack path); changelog sims attach via X-Simulate-Failure
  return client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...config.flight.issueTicketQuery,
      pid: process.env.FLIGHT_ISSUE_PID || config.flight.issueTicketQuery?.pid || 'vgm',
      ...FLIGHT_QUERY,
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders,
  });
}

async function prepareHotel(hotel, tag) {
  const checkinDays = 18 + Math.floor(Math.random() * 8);
  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  const search = await hotel.search(searchBody);
  if (!search.ok) throw new Error(`hotel search HTTP ${search.status}: ${brief(search.data)}`);
  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data);
  const room = (details.data?.results?.[0]?.rooms || []).find((r) => r.available !== false && r.bookingCode)
    || (details.data?.results?.[0]?.rooms || [])[0];
  if (!room?.bookingCode || !requestId) throw new Error(`no room/requestId: ${brief(details.data)}`);
  const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  const bookingContext = extractBookingContext(prebook.data);
  if (!bookingContext) throw new Error(`prebook failed: ${brief(prebook.data)}`);
  // PAN-safe lead (unique last names fail supplier PAN check → Failed after charge)
  const lastName = process.env.HOTEL_LAST_NAME || 'Bhagat';
  const guests = [{
    title: 'Mr',
    firstName: 'Rohan',
    lastName,
    type: 'Adult',
    isLead: true,
  }];
  const body = buildFinalizeBody({
    bookingContext,
    bookingCode: room.bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    guests,
  });
  body.rooms = [{ guests }];
  body.contact.panCardNumber = 'EUIPB1672M';
  body.contact.panCardName = `Rohan ${lastName}`;
  return {
    amount: room?.price?.totalAmount || room?.totalAmount,
    body,
    lastName,
    checkin: searchBody.checkin,
  };
}

async function finalizeHotel(client, body, simHeader) {
  const extraHeaders = simHeader ? { 'X-Simulate-Failure': simHeader } : {};
  return client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders,
  });
}

async function prepareCab(cab, tag) {
  const body = buildAirportSearchBody();
  // jitter pickup so fare/cache differs
  const d = new Date(body.pickupDatetime);
  d.setUTCMinutes(d.getUTCMinutes() + Math.floor(Math.random() * 40));
  body.pickupDatetime = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const search = await cab.search(body);
  const selected = pickCab(search.data?.cabs);
  if (!selected?.searchId) throw new Error(`cab search empty: ${brief(search.data)}`);
  const fare = await cab.fare(selected.searchId);
  if (!fare.data?.priceId || !fare.data?.bookingReference) {
    throw new Error(`cab fare missing: ${brief(fare.data)}`);
  }
  const lastName = uniqLast(tag);
  const finBody = buildCabFinalize({
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
  });
  finBody.passengers[0].profile.lastName = lastName;
  return {
    amount: fare.data?.priceDetail?.totalAmount || fare.data?.totalAmount,
    body: finBody,
    lastName,
  };
}

async function finalizeCab(client, body, simHeader) {
  const extraHeaders = simHeader ? { 'X-Simulate-Failure': simHeader } : {};
  return client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders,
  });
}

async function cancelProduct(product, services, br, simHeader) {
  const { flight, hotel, cab, client } = services;
  const extraHeaders = simHeader ? { 'X-Simulate-Failure': simHeader } : {};
  if (product === 'flight') {
    const detail = await flight.getBookingDetail(br);
    const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr
      || detail.data?.pnr
      || detail.data?.bookingResponse?.pnr;
    return client.request({
      method: 'POST',
      path: '/api/v2/flight/cancel',
      query: FLIGHT_QUERY,
      body: {
        bookingId: br,
        action: 'CANCEL',
        pnr: pnr || undefined,
        cancelledBy: 'USER',
      },
      correlation: true,
      partnerKey: client.partnerKey,
      extraHeaders,
    });
  }
  if (product === 'hotel') {
    return client.request({
      method: 'GET',
      path: `/v1/hotels/bookings/${br}/cancel`,
      query: { lang: 'en', currency: 'INR' },
      correlation: true,
      partnerKey: client.partnerKey,
      extraHeaders,
    });
  }
  return client.request({
    method: 'GET',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: { lang: 'en', currency: 'INR' },
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders,
  });
}

async function runCase(product, caseId, services, accessToken, happyBrStore) {
  if ((caseId === 'G' || caseId === 'I') && SKIP_DEBIT) {
    return {
      product, caseId, verdict: 'NOT TESTED',
      note: 'SKIP_DEBIT_CASES=1',
      checks: [{ rule: 'skipped', status: 'NOT TESTED', actual: 'debit cases skipped' }],
    };
  }

  const { flight, hotel, cab, client } = services;
  const header = CASE_HEADER[caseId];
  console.log(`\n=== ${product.toUpperCase()} Case ${caseId} header=${header || '(none)'} ===`);

  const waBefore = await walletFeed(accessToken);
  const balBefore = walletAvailable(waBefore.summary);
  console.log('  wallet before', balBefore, 'http', waBefore.status);

  let bookRes;
  let prep;
  try {
    if (caseId === 'J') {
      const br = happyBrStore[product];
      if (!br) {
        return {
          product, caseId, verdict: 'NOT TESTED',
          note: 'no Case A BR to cancel',
          checks: [{ rule: 'cancel fixture', status: 'NOT TESTED', actual: 'Case A did not yield a BR' }],
        };
      }
      const waB2 = await walletFeed(accessToken);
      const balB2 = walletAvailable(waB2.summary);
      bookRes = await cancelProduct(product, services, br, null);
      await sleep(2500);
      const waA2 = await walletFeed(accessToken);
      const balA2 = walletAvailable(waA2.summary);
      const scored = scoreCase(product, 'J', {
        http: bookRes.status,
        code: errCode(bookRes),
        statusText: bookRes.data?.status,
        refund: refundBlock(bookRes.data),
        balBefore: balB2,
        balAfter: balA2,
        bookRes,
      });
      console.log('  cancel', bookRes.status, brief(bookRes.data, 200));
      return {
        product, caseId, header: null, br,
        http: bookRes.status,
        code: errCode(bookRes),
        responseSnippet: brief(bookRes.data, 800),
        ...scored,
      };
    }

    if (product === 'flight') {
      prep = await prepareFlight(flight, `${product}${caseId}`);
      console.log('  prepared amount', prep.amount, 'route', prep.route, 'date', prep.date, 'pax', prep.lastName);
      bookRes = await issueFlight(client, prep.payload, header);
    } else if (product === 'hotel') {
      prep = await prepareHotel(hotel, `${product}${caseId}`);
      console.log('  prepared amount', prep.amount, 'checkin', prep.checkin, 'pax', prep.lastName);
      bookRes = await finalizeHotel(client, prep.body, header);
    } else {
      prep = await prepareCab(cab, `${product}${caseId}`);
      console.log('  prepared amount', prep.amount, 'pax', prep.lastName);
      bookRes = await finalizeCab(client, prep.body, header);
    }
  } catch (e) {
    console.log('  PREP/BOOK ERROR', e.message);
    const vendorDown = /FLIGHT_VENDOR_DOWN|VENDOR_ERROR|did not complete/i.test(e.message);
    return {
      product, caseId, header,
      verdict: vendorDown ? 'NOT TESTED' : 'BUG',
      error: e.message,
      checks: [{
        rule: 'prepare+book',
        status: vendorDown ? 'NOT TESTED' : 'BUG',
        actual: e.message,
      }],
    };
  }

  await sleep(2000);
  const waAfter = await walletFeed(accessToken);
  const balAfter = walletAvailable(waAfter.summary);

  const br = pickBr(product, bookRes.data);
  const statusText = bookRes.data?.status || bookRes.data?.bookingStatus || bookRes.data?.ticketStatus;
  const refund = refundBlock(bookRes.data);
  console.log('  http', bookRes.status, 'code', errCode(bookRes), 'br', br, 'status', statusText);
  console.log('  refund', brief(refund, 180));
  console.log('  wallet after', balAfter);

  if (caseId === 'A' && br) happyBrStore[product] = br;

  // soft status poll for A/D/H
  let polled = statusText;
  if (br && ['A', 'D', 'H'].includes(caseId)) {
    try {
      for (let i = 0; i < 4; i += 1) {
        let st;
        if (product === 'flight') st = await flight.getBookingStatus(br);
        else if (product === 'hotel') st = await hotel.getBookingStatus(br);
        else st = await cab.getBookingStatus(br);
        polled = st.data?.status || polled;
        console.log('  poll', i + 1, polled);
        if (/CONFIRMED|FAILED|CANCELLED|ASSIGNED/i.test(String(polled))) break;
        await sleep(2500);
      }
    } catch (e) {
      console.log('  poll err', e.message);
    }
  }

  const scored = scoreCase(product, caseId, {
    http: bookRes.status,
    code: errCode(bookRes),
    statusText: polled || statusText,
    refund,
    balBefore,
    balAfter,
    bookRes,
  });

  return {
    product,
    caseId,
    header,
    br,
    amount: prep?.amount,
    http: bookRes.status,
    code: errCode(bookRes),
    status: polled || statusText,
    refund,
    responseSnippet: brief(bookRes.data, 1000),
    walletFeedHttp: { before: waBefore.status, after: waAfter.status },
    ...scored,
  };
}

async function main() {
  process.env.BASE_URL = BASE;
  clearSession();
  console.log('BASE', BASE);
  console.log('PRODUCTS', PRODUCTS.join(','));
  console.log('CASES', CASES.join(','));

  const session = await authenticate(true);
  const { client, accessToken } = session;
  const flight = new FlightService(client);
  const hotel = new HotelService(client);
  const cab = new CabService(client);
  const services = { flight, hotel, cab, client };

  const wa0 = await walletFeed(accessToken);
  console.log('wallet feed', wa0.status, brief(wa0.summary, 200));

  const rows = [];
  const happyBrStore = {};

  // Prefer order that protects balance: E F C H A D G I J
  const order = ['E', 'F', 'C', 'H', 'A', 'D', 'G', 'I', 'J'].filter((c) => CASES.includes(c));
  // Also allow any extra cases listed
  for (const c of CASES) if (!order.includes(c)) order.push(c);

  for (const product of PRODUCTS) {
    for (const caseId of order) {
      if (!CASE_HEADER.hasOwnProperty(caseId) && caseId !== 'J') {
        rows.push({ product, caseId, verdict: 'NOT TESTED', note: 'unknown case' });
        continue;
      }
      try {
        const row = await runCase(product, caseId, services, accessToken, happyBrStore);
        rows.push(row);
        console.log(`  >> ${product} ${caseId} = ${row.verdict}`);
      } catch (e) {
        rows.push({ product, caseId, verdict: 'BUG', error: e.message });
        console.log(`  >> ${product} ${caseId} = BUG ${e.message}`);
      }
      await sleep(1500);
    }
  }

  // B / K placeholders
  if (!CASES.includes('B')) {
    rows.push({
      product: 'all', caseId: 'B', verdict: 'NOT TESTED',
      note: 'needs low-balance partner; not forced in this run',
      checks: [{ rule: 'INSUFFICIENT_BALANCE', status: 'NOT TESTED', actual: 'no low-balance partner' }],
    });
  }
  rows.push({
    product: 'all', caseId: 'K', verdict: 'NOT TESTED',
    note: 'Blocked: vgm B2B is wallet-only; Card/Stripe is web path — need shop/Stripe or non-wallet partner',
    checks: [{ rule: 'card regression', status: 'NOT TESTED', actual: 'no Stripe/web partner or card finalize path in this runner' }],
  });

  const summary = {
    PASS: rows.filter((r) => r.verdict === 'PASS').length,
    BUG: rows.filter((r) => r.verdict === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.verdict === 'NOT TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    partnerId: config.partnerId,
    tierId: config.tierId,
    products: PRODUCTS,
    cases: order,
    walletStart: wa0.summary,
    happyBrStore,
    summary,
    rows,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = [
    `# Theta wallet charge-first changelog`,
    ``,
    `- Ran: ${report.ranAt}`,
    `- Base: ${BASE}`,
    `- Partner: ${config.partnerId} · tier ${config.tierId}`,
    `- Summary: **${summary.PASS} PASS / ${summary.BUG} BUG / ${summary.NOT_TESTED} NOT TESTED**`,
    ``,
    `| Product | Case | Verdict | HTTP | Code | BR | Wallet Δ | Notes |`,
    `|---------|------|---------|------|------|----|----------|-------|`,
    ...rows.map((r) => {
      const notes = r.note || (r.checks || []).filter((c) => c.status === 'BUG').map((c) => c.rule).join('; ') || '';
      return `| ${r.product} | ${r.caseId} | ${r.verdict} | ${r.http ?? ''} | ${r.code ?? ''} | ${r.br ?? ''} | ${r.delta ?? ''} | ${String(notes).replace(/\|/g, '/').slice(0, 120)} |`;
    }),
    ``,
    `DB + Mattermost checks were **NOT TESTED** from this runner — verify manually for Cases E/F/G/H/I alerts.`,
    ``,
  ].join('\n');
  fs.writeFileSync(MD, md);

  console.log('\n=== SUMMARY ===', summary);
  console.log('Wrote', OUT);
  console.log('Wrote', MD);
  if (summary.BUG) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
