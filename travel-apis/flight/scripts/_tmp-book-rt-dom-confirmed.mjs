/**
 * One-shot domestic RT on ak-api — DEL↔PNQ, 2ADT, lastName Confirmed, meals.
 * No date/name retry loop.
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
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
import { config } from '../../../shared/config/env.js';

const j = JSON.parse(
  fs.readFileSync(
    path.join(
      process.env.USERPROFILE || '',
      '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
    ),
    'utf8',
  ),
);
const vars = {};
for (const v of j.environments[0].variables) vars[v.name] = v.value ?? v.initialValue ?? '';
process.env.BASE_URL = 'https://ak-api.travelvip.ai';
process.env.PARTNER_ID = vars.partner_id || 'vgm';
process.env.PARTNER_SECRET = vars.partner_secret;
process.env.SIGNING_KEY = vars.signing_key;
process.env.TIER_ID = vars.tier_id || '10546901';

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

function collectPnrs(st) {
  const raw = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const [k, v] of Object.entries(o)) {
      if (/pnr/i.test(k) && typeof v === 'string' && v.trim()) raw.push(v.trim());
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(st);
  return [...new Set(raw)];
}

async function main() {
  console.log('BASE', process.env.BASE_URL);
  const { client } = await authenticate(true);
  client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
  const flight = new FlightService(client);

  const body = buildRoundTripSearchBody(30, 36, {
    origin: 'DEL',
    destination: 'PNQ',
    maxStops: 2,
    fareType: 'NORMAL',
  });
  body.travellers = { adults: 2, children: 0, infants: 0 };

  console.log('RT search DEL↔PNQ', body.itinerary);
  const search = await flight.search(body);
  const onward = extractOnwardSearchId(search.data) || opts(search.data, 'ONWARD')[0]?.searchId;
  if (!onward) {
    console.log('FAIL no onward', JSON.stringify(search.data).slice(0, 500));
    process.exit(2);
  }
  const refined = { ...body, selection: { selectedSearchIds: [onward] } };
  const retRes = await flight.search(refined);
  const ret =
    extractReturnSearchId(retRes.data) ||
    opts(retRes.data, 'RETURN').find((o) => o.searchId !== onward)?.searchId;
  if (!ret) {
    console.log('FAIL no return', JSON.stringify(retRes.data).slice(0, 500));
    process.exit(2);
  }
  const ids = [onward, ret];
  console.log('searchIds', ids);

  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  const ctx = pricing.data?.bookingContext || pricing.data?.bookingReference;
  const priceId = pricing.data?.priceId;
  console.log('pricing', pricing.status, 'ctx', !!ctx, 'priceId', priceId, 'total', pricing.data?.pricing?.totalAmount);
  if (!ctx || !priceId) {
    console.log('FAIL pricing', JSON.stringify(pricing.data).slice(0, 600));
    process.exit(2);
  }

  const ssr = await flight.getSsr(priceId);
  const meals = pickMealsAllSegments(ssr.data);
  console.log('meals', meals.length, meals.map((m) => `${m.direction}:${m.code || m.ssrId}`).join(','));
  if (!meals.length) {
    console.log('FAIL no meals', JSON.stringify(ssr.data).slice(0, 600));
    process.exit(2);
  }

  const payload = buildIssueTicketPayload({
    bookingContext: ctx,
    priceId,
    searchIds: ids,
    journeyType: 'ROUND_TRIP',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: 'Confirmed',
      gender: 'Male',
      dob: '1992-05-15',
      nationality: 'IN',
    },
  });
  payload.data.contact.email = `ak.rt.delpnq.${Date.now()}@travelvip.ai`;
  payload.data.passengers[0].profile.lastName = 'Confirmed';
  payload.data.passengers[0].ssr.meals = meals;
  payload.data.passengers.push({
    paxId: 'PAX2',
    type: 'adult',
    isLead: false,
    profile: {
      title: 'Mr',
      firstName: 'Amit',
      lastName: 'Confirmed',
      gender: 'Male',
      dob: '1990-03-10',
      nationality: 'IN',
    },
    city: payload.data.passengers[0].city,
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [...meals], seats: [] },
  });

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: 'vgm',
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
  console.log('issue', issue.status, 'br', br);
  if (!br) {
    console.log('FAIL issue', JSON.stringify(issue.data).slice(0, 800));
    process.exit(2);
  }

  let status = null;
  let lastSt = null;
  for (let i = 0; i < 24; i++) {
    lastSt = await flight.getBookingStatus(br);
    status = String(lastSt.data?.status || '');
    console.log(`poll ${i + 1}: ${status}`);
    if (isTerminalBookingStatus(status) || /confirm|fail|cancel/i.test(status)) break;
    await sleep(3000);
  }

  const pnrs = collectPnrs(lastSt?.data);
  const out = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    br,
    status,
    route: 'DEL-PNQ-DEL',
    pax: 2,
    lastName: 'Confirmed',
    mealsAttached: meals.length,
    pnrs,
    uniquePnrs: [...new Set(pnrs)],
    distinct: new Set(pnrs).size > 1,
  };
  const outPath = path.join(
    'd:/Travel VIP API Automation/travel-apis/flight/reports/cancel-suite-2026-11-19',
    'ak-rt-dom-fresh.json',
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\nRESULT', JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
  if (!/confirm/i.test(String(status))) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
