/**
 * vgm staging — ONE domestic RT + ONE international book. NO retry loops.
 * On Failed / Inprogress: stop that case (do not change dates/airlines/names).
 *
 *   BASE_URL=https://dev-benepik-api.travelvip.ai node travel-apis/flight/scripts/probe-vgm-wallet-rt-intl-noloop.js
 *   (staging partner/tier/signing creds; Benepik host only)
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('travel-apis', 'flight', 'reports', 'vgm-wallet-rt-intl-noloop.json');
const DEFAULT_BASE = 'https://dev-benepik-api.travelvip.ai';

function brief(d, n = 600) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d);
  }
}

function dirOptions(data, direction) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === direction)?.options) || [];
}

async function waitStatusOnce(flight, br, maxAttempts = 20) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 3) {
      console.log('  STOP — Inprogress (no loop)');
      return st;
    }
    await sleep(3000);
  }
  return last?.data?.status || 'UNKNOWN';
}

async function pickRtPair(flight, body) {
  const search = await flight.searchRoundTripUntilComplete(body);
  const data = search.response?.data || search.data;
  const onward = dirOptions(data, 'ONWARD')[0];
  if (!onward?.searchId) throw new Error('no onward options');

  const refined = { ...body, selection: { selectedSearchIds: [onward.searchId] } };
  const returnRes = await flight.pollReturnSearch(body, refined);
  const ret = dirOptions(returnRes.data, 'RETURN').find((o) => o.searchId && o.searchId !== onward.searchId)
    || dirOptions(returnRes.data, 'RETURN')[0];
  if (!ret?.searchId) throw new Error('no return options');

  return {
    searchIds: [onward.searchId, ret.searchId],
    onward: {
      airline: onward.segments?.[0]?.airline?.code,
      flight: onward.segments?.[0]?.flightNumber,
      route: `${onward.segments?.[0]?.departure?.airportCode}→${onward.segments?.[0]?.arrival?.airportCode}`,
    },
    return: {
      airline: ret.segments?.[0]?.airline?.code,
      flight: ret.segments?.[0]?.flightNumber,
      route: `${ret.segments?.[0]?.departure?.airportCode}→${ret.segments?.[0]?.arrival?.airportCode}`,
    },
  };
}

async function bookOnce(flight, client, label, body, { intlPassport = false } = {}) {
  console.log(`\n=== ${label} (single attempt, no loop) ===`);
  const pair = await pickRtPair(flight, body);
  console.log('  pair', JSON.stringify(pair));

  const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
  if (!pricing.ok && !(pricing.status >= 200 && pricing.status < 300)) {
    throw new Error(`pricing HTTP ${pricing.status}: ${brief(pricing.data)}`);
  }
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    throw new Error(`pricing missing fields: ${brief(pricing.data)}`);
  }
  console.log('  pricing total', pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount);

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: pair.searchIds,
    journeyType: 'ROUND_TRIP',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: 'Bhagat',
      gender: 'Male',
      dob: '1992-11-18',
      nationality: 'IN',
    },
  });

  if (intlPassport) {
    payload.data.passportType = 'FULL';
    payload.data.passengers[0].passport = {
      number: 'M7654321',
      expiry: '2031-06-30',
      issuedDate: '2021-03-01',
      issuedCountryCode: 'IN',
    };
  }

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: process.env.FLIGHT_ISSUE_PID || config.partnerId || 'vgm',
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) throw new Error(`issue failed: ${brief(issue.data)}`);
  console.log('  BR', br, 'issueStatus', issue.data?.status);

  const status = await waitStatusOnce(flight, br);
  const detail = await flight.getBookingDetail(br);
  const sales = detail.data?.bookingResponse?.salesSummary || detail.data?.salesSummary;
  const itinerary = detail.data?.bookingResponse?.itinerary || [];

  const row = {
    label,
    br,
    status,
    stopReason: /fail|inprogress/i.test(String(status)) ? 'NO_LOOP_STOP' : null,
    totalAmount: sales?.totalAmount,
    currency: sales?.currency || 'INR',
    pair,
    pnrs: itinerary.map((j) => j.pnr).filter(Boolean),
    flights: itinerary.map((j) => ({
      direction: j.direction,
      pnr: j.pnr,
      segs: (j.segments || []).map((s) => `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim()),
    })),
  };

  if (/fail|inprogress/i.test(String(status))) {
    console.log('  STOPPED — check Mattermost by BR', br);
  } else {
    console.log('  OK', status, 'total', row.totalAmount);
  }
  return row;
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || DEFAULT_BASE;
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  console.log('Base', process.env.BASE_URL, 'partner', config.partnerId, 'tier', config.tierId);
  console.log('NO LOOP — one attempt per case');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = {
    at: new Date().toISOString(),
    base: config.baseUrl,
    partner: config.partnerId,
    note: 'no-loop: stop on Failed/Inprogress; no date/airline/name retry',
    cases: [],
  };

  // 1) Domestic RT BOM–BLR
  try {
    // maxStops null — staging RT with maxStops:0 returns NO_FLIGHTS_FOUND (HTTP 400)
    const body = buildRoundTripSearchBody(25, 32, {
      origin: 'BOM',
      destination: 'BLR',
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences.refundableOnly = false;
    const row = await bookOnce(flight, client, 'RT_DOM_BOM_BLR', body, { intlPassport: false });
    report.cases.push(row);
  } catch (e) {
    console.error('RT_DOM failed (no retry):', e.message);
    report.cases.push({ label: 'RT_DOM_BOM_BLR', error: e.message, stopReason: 'NO_LOOP_STOP' });
  }

  // 2) International RT DEL–DXB — single date/airline set
  try {
    const body = buildRoundTripSearchBody(40, 47, {
      origin: 'DEL',
      destination: 'DXB',
      fareType: 'NORMAL',
      maxStops: null,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences.airlines = ['6E', 'AI', 'IX', 'SG'];
    body.preferences.refundableOnly = false;
    const row = await bookOnce(flight, client, 'RT_INTL_DEL_DXB', body, { intlPassport: true });
    report.cases.push(row);
  } catch (e) {
    console.error('RT_INTL failed (no retry):', e.message);
    report.cases.push({ label: 'RT_INTL_DEL_DXB', error: e.message, stopReason: 'NO_LOOP_STOP' });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nREPORT', OUT);
  console.log(JSON.stringify(report.cases, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
