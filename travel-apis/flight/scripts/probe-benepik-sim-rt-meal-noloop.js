/**
 * Retest HALFFAIL + PARTIALCANCEL with mandatory meals. NO loop.
 * Prefer PNQ-DEL RT; if meal attach fails, try PNQ-DXB once.
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
  extractOnwardSearchId,
  extractReturnSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('travel-apis', 'flight', 'reports', 'benepik-sim-rt-meal-noloop.json');

function brief(d, n = 700) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function opts(data, dir) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)?.options) || [];
}

function pickMealsAllSegments(ssrData) {
  const meals = [];
  for (const seg of ssrData?.meal?.segments || []) {
    const list = seg.Meals || seg.meals || [];
    const m = list.find((x) => x.priceReference || x.pricing?.priceReference) || list[0];
    if (!m) continue;
    const pref = m.priceReference || m.pricing?.priceReference;
    if (!pref) continue;
    const dir = String(seg.direction || m.direction || 'ONWARD').toUpperCase();
    meals.push({
      ssrId: String(m.ssrId || m.mealId || ''),
      mealId: String(m.ssrId || m.mealId || ''),
      direction: dir.includes('RET') ? 'RETURN' : 'ONWARD',
      segmentId: m.segmentId || seg.segmentId || 'SEG_1',
      paxType: 'ADT',
      code: m.code,
      title: m.title || m.description || 'Meal',
      description: m.description || m.title || 'Meal',
      priceReference: pref,
    });
  }
  return meals;
}

async function searchRtOnce(flight, origin, destination) {
  const body = buildRoundTripSearchBody(25, 32, {
    origin, destination, fareType: 'NORMAL', maxStops: null,
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  const search = await flight.search(body);
  const onward = extractOnwardSearchId(search.data) || opts(search.data, 'ONWARD')[0]?.searchId;
  if (!onward) return { error: 'no onward', search };
  const refined = { ...body, selection: { selectedSearchIds: [onward] } };
  const retRes = await flight.search(refined);
  const ret = extractReturnSearchId(retRes.data)
    || opts(retRes.data, 'RETURN').find((o) => o.searchId !== onward)?.searchId;
  if (!ret) return { error: 'no return', search, retRes };
  return { body, searchIds: [onward, ret], search, retRes };
}

async function waitStatus(flight, br, max = 10) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 3) return st;
    await sleep(3000);
  }
  return last?.data?.status || 'UNKNOWN';
}

async function bookOnce(flight, client, { origin, destination, lastName, doCancel = false }) {
  console.log(`\n=== ${lastName} RT ${origin}-${destination} (meal, no loop) ===`);
  const found = await searchRtOnce(flight, origin, destination);
  if (found.error) {
    return { lastName, origin, destination, status: 'FAIL', reason: found.error, sample: brief(found.search?.data) };
  }
  console.log('  searchIds', found.searchIds);

  const pricing = await flight.getPricing(found.searchIds, 'ROUND_TRIP');
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    return {
      lastName, origin, destination, status: 'FAIL', reason: 'pricing',
      sample: brief(pricing.data),
    };
  }
  console.log('  pricing', pricing.data.priceId, 'total', pricing.data?.pricing?.totalAmount);

  const ssr = await flight.getSsr(pricing.data.priceId);
  const meals = pickMealsAllSegments(ssr.data);
  console.log('  meals picked', meals.length, meals.map((m) => `${m.direction}:${m.code || m.ssrId}`).join(','));
  if (!meals.length) {
    return {
      lastName, origin, destination, status: 'FAIL', reason: 'no meals in SSR',
      ssrSample: brief(ssr.data),
    };
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: found.searchIds,
    journeyType: 'ROUND_TRIP',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName,
      gender: 'Male',
      dob: '1992-11-18',
      nationality: 'IN',
    },
  });
  payload.data.passengers[0].ssr.meals = meals;

  // PNQ-DXB may need passport
  if (destination === 'DXB' || origin === 'DXB') {
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
      count: 10, page: 0, perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  console.log('  issue', issue.status, br || brief(issue.data?.error || issue.data, 300));
  if (!br) {
    return {
      lastName, origin, destination, status: 'FAIL', reason: 'issue',
      http: issue.status, err: issue.data?.error || null, sample: brief(issue.data),
    };
  }

  const finalStatus = await waitStatus(flight, br);
  let cancel = null;
  if (doCancel && /confirm/i.test(String(finalStatus))) {
    cancel = await flight.cancelV2({
      bookingReference: br,
      bookingId: br,
      type: 'cancel',
      mode: 'ONLINE',
      reason: 'sim PARTIALCANCEL QA',
    });
    console.log('  cancel', cancel.status, brief(cancel.data, 250));
  }

  return {
    lastName,
    origin,
    destination,
    br,
    finalStatus,
    mealsAttached: meals.length,
    cancelHttp: cancel?.status,
    cancelErr: cancel?.data?.error || null,
    status: 'OK',
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://dev-benepik-api.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', process.env.BASE_URL, 'partner', config.partnerId, 'NO_LOOP');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = { at: new Date().toISOString(), base: process.env.BASE_URL, partner: config.partnerId, cases: [] };

  // 1) HALFFAIL on PNQ-DEL with meals
  let half = await bookOnce(flight, client, { origin: 'PNQ', destination: 'DEL', lastName: 'HALFFAIL' });
  if (half.status === 'FAIL' && /meal|validation/i.test(JSON.stringify(half))) {
    console.log('HALFFAIL PNQ-DEL failed — trying PNQ-DXB once');
    half = await bookOnce(flight, client, { origin: 'PNQ', destination: 'DXB', lastName: 'HALFFAIL' });
  }
  report.cases.push(half);

  // 2) PARTIALCANCEL on PNQ-DEL with meals + cancel attempt
  let part = await bookOnce(flight, client, {
    origin: 'PNQ', destination: 'DEL', lastName: 'PARTIALCANCEL', doCancel: true,
  });
  if (part.status === 'FAIL' && /meal|validation/i.test(JSON.stringify(part))) {
    console.log('PARTIALCANCEL PNQ-DEL failed — trying PNQ-DXB once');
    part = await bookOnce(flight, client, {
      origin: 'PNQ', destination: 'DXB', lastName: 'PARTIALCANCEL', doCancel: true,
    });
  }
  report.cases.push(part);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nREPORT', OUT);
  console.log(JSON.stringify(report.cases, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
