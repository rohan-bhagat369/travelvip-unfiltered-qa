/**
 * One-shot HALFFAIL + PARTIALCANCEL with ONWARD meal forced from SSR options.
 * NO loop. BASE_URL=dev-benepik-api + staging creds.
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

const OUT = path.join('travel-apis', 'flight', 'reports', 'benepik-sim-halffail-meal-fix.json');

function opts(data, dir) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)?.options) || [];
}

function firstMeal(ssrData) {
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      if (!pref) continue;
      return { m, pref, seg };
    }
  }
  return null;
}

function mealsForItinerary(pricingData, raw) {
  const meals = [];
  for (const leg of pricingData?.itinerary || []) {
    const seg0 = (leg.segments || [])[0] || {};
    const dir = String(leg.direction || '').toUpperCase() === 'RETURN' ? 'RETURN' : 'ONWARD';
    // Always attach ONWARD (mandatory on sim PNQ-DEL) + RETURN when present
    if (dir === 'ONWARD' || dir === 'RETURN') {
      meals.push({
        ssrId: String(raw.m.ssrId || raw.m.mealId || ''),
        mealId: String(raw.m.ssrId || raw.m.mealId || ''),
        direction: dir,
        segmentId: seg0.segmentId || 'SEG_1',
        paxType: 'ADT',
        code: raw.m.code,
        title: raw.m.title || 'Meal',
        description: raw.m.description || raw.m.title || 'Meal',
        priceReference: raw.pref,
        origin: seg0.departure?.airportCode,
        destination: seg0.arrival?.airportCode,
      });
    }
  }
  return meals;
}

async function bookOnce(flight, client, lastName, onwardIdx = 0) {
  console.log(`\n=== ${lastName} onwardIdx=${onwardIdx} ===`);
  const body = buildRoundTripSearchBody(25, 32, {
    origin: 'PNQ', destination: 'DEL', fareType: 'NORMAL', maxStops: null,
  });
  const s1 = await flight.search(body);
  const onwardList = opts(s1.data, 'ONWARD');
  const onward = onwardList[onwardIdx]?.searchId || extractOnwardSearchId(s1.data);
  if (!onward) return { lastName, status: 'FAIL', reason: 'no onward' };

  const s2 = await flight.search({ ...body, selection: { selectedSearchIds: [onward] } });
  const ret = extractReturnSearchId(s2.data) || opts(s2.data, 'RETURN')[0]?.searchId;
  if (!ret) return { lastName, status: 'FAIL', reason: 'no return' };

  const pricing = await flight.getPricing([onward, ret], 'ROUND_TRIP');
  if (!pricing.data?.priceId) return { lastName, status: 'FAIL', reason: 'pricing' };

  const ssr = await flight.getSsr(pricing.data.priceId);
  const raw = firstMeal(ssr.data);
  if (!raw) return { lastName, status: 'FAIL', reason: 'no meal in SSR' };

  const meals = mealsForItinerary(pricing.data, raw);
  console.log('  meals', meals.map((m) => `${m.direction}:${m.origin}-${m.destination}`).join(', '));

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [onward, ret],
    journeyType: 'ROUND_TRIP',
    passengerProfile: {
      title: 'Mr', firstName: 'Rohan', lastName, gender: 'Male', dob: '1992-11-18', nationality: 'IN',
    },
  });
  payload.data.passengers[0].ssr.meals = meals;

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: process.env.FLIGHT_ISSUE_PID || 'vgm',
      count: 10, page: 0, perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  console.log('  issue', issue.status, br || JSON.stringify(issue.data?.error).slice(0, 280));
  if (!br) {
    return { lastName, status: 'FAIL', reason: 'issue', err: issue.data?.error || null };
  }

  let finalStatus = 'UNKNOWN';
  for (let i = 0; i < 12; i += 1) {
    const st = await flight.getBookingStatus(br);
    finalStatus = String(st.data?.status || '');
    console.log('  status', i + 1, finalStatus);
    if (isTerminalBookingStatus(finalStatus)) break;
    if (/inprogress/i.test(finalStatus) && i >= 4) break;
    await sleep(3000);
  }

  let cancel = null;
  if (lastName === 'PARTIALCANCEL' && /confirm/i.test(finalStatus)) {
    cancel = await flight.cancelV2({
      bookingReference: br,
      bookingId: br,
      type: 'cancel',
      mode: 'ONLINE',
      reason: 'sim partial cancel QA',
    });
    console.log('  cancel', cancel.status, JSON.stringify(cancel.data?.error || cancel.data).slice(0, 250));
  }

  return {
    lastName,
    br,
    finalStatus,
    cancelHttp: cancel?.status ?? null,
    cancelBody: cancel?.data?.error || (cancel ? { ok: cancel.ok } : null),
    status: 'OK',
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://dev-benepik-api.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', process.env.BASE_URL, 'partner', config.partnerId);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;

  const cases = [];
  let half = await bookOnce(flight, client, 'HALFFAIL', 0);
  if (half.status === 'FAIL') {
    console.log('retry HALFFAIL with 2nd onward option once');
    half = await bookOnce(flight, client, 'HALFFAIL', 1);
  }
  cases.push(half);

  let part = await bookOnce(flight, client, 'PARTIALCANCEL', 0);
  if (part.status === 'FAIL') {
    console.log('retry PARTIALCANCEL with 2nd onward option once');
    part = await bookOnce(flight, client, 'PARTIALCANCEL', 1);
  }
  cases.push(part);

  const report = { at: new Date().toISOString(), base: process.env.BASE_URL, cases };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nREPORT', OUT);
  console.log(JSON.stringify(cases, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
