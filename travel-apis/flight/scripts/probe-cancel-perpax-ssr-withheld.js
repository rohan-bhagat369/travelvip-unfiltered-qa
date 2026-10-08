/**
 * Next case after S5: SSR withheld from refund
 * Book OW 1ADT + meal/baggage → PENALTY→CANCEL → assert perPax.ssr > 0 and SSR in charge / not refunded
 *
 * Inprogress → leave immediately; next attempt = different airline + dates + names
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-ssr-withheld.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
  analyzeFlightOptions,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-ssr-withheld.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ATTEMPTS = [
  { airline: '6E', o: 'BOM', d: 'BLR', days: 42, fareType: 'NORMAL', name: ['Siddharth', 'Naik'] },
  { airline: '6E', o: 'DEL', d: 'HYD', days: 38, fareType: 'CORPORATE', name: ['Tanmay', 'Kale'] },
  { airline: '6E', o: 'DEL', d: 'BOM', days: 45, fareType: 'NORMAL', name: ['Karan', 'Deshmukh'] },
  { airline: 'SG', o: 'DEL', d: 'BOM', days: 48, fareType: 'NORMAL', name: ['Parth', 'Sawant'] },
  { airline: '6E', o: 'HYD', d: 'BOM', days: 52, fareType: 'NORMAL', name: ['Omkar', 'Joshi'] },
];

function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function nearly(a, b, tol = 2) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function waitConfirmOrBail(flight, br) {
  let last = null;
  for (let i = 0; i < 4; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return { status: last, bail: false };
    if (/inprogress|in.?progress/i.test(last)) {
      console.log('  Inprogress — LEAVE, next airline/dates/names');
      return { status: last, bail: true };
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) {
      return { status: last, bail: !/confirm/i.test(last) };
    }
    await sleep(2000);
  }
  console.log('  still Pending — LEAVE');
  return { status: last, bail: true };
}

function pickAirline(analysis, airline) {
  const code = String(airline).toUpperCase();
  const pool = [...analysis.nonStop, ...analysis.connecting];
  return pool.find((o) => (o.legs || []).some((l) => String(l.flight || '').toUpperCase().startsWith(code)))
    || analysis.nonStop[0]
    || analysis.connecting[0]
    || null;
}

function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function pickPaidMeal(ssrData, meta) {
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      const amt = Number(m.pricing?.totalAmount || m.amount || 0);
      if (!pref || amt <= 0) continue;
      return {
        item: {
          ssrId: String(m.ssrId || m.mealId || ''),
          mealId: String(m.ssrId || m.mealId || ''),
          direction: 'ONWARD',
          segmentId: m.segmentId || seg.segmentId || meta.segmentId,
          paxType: 'ADT',
          code: m.code,
          title: m.title || m.description || 'Meal',
          description: m.description || m.title || 'Meal',
          priceReference: pref,
        },
        amount: amt,
      };
    }
  }
  return null;
}

function pickPaidBag(ssrData, meta) {
  for (const seg of ssrData?.baggage?.segments || ssrData?.baggage?.Segments || []) {
    const o = seg.Origin || seg.origin || meta.origin;
    const d = seg.Destination || seg.destination || meta.destination;
    for (const b of seg.Baggage || seg.baggage || []) {
      const pref = b.priceReference || b.pricing?.priceReference;
      const amt = Number(b.pricing?.totalAmount || b.amount || 0);
      if (!pref || amt <= 0) continue;
      return {
        item: {
          ssrId: String(b.ssrId || b.baggageId || ''),
          baggageId: String(b.ssrId || b.baggageId || ''),
          direction: 'ONWARD',
          segmentId: b.segmentId || seg.segmentId || meta.segmentId,
          paxType: 'ADT',
          code: b.code,
          title: b.title || b.description || 'Baggage',
          description: b.description || b.title || 'Baggage',
          priceReference: pref,
          weight: Number(b.weight || 5),
          origin: o,
          destination: d,
        },
        amount: amt,
      };
    }
  }
  return null;
}

async function bookWithSsr(flight, client) {
  const left = [];
  for (const a of ATTEMPTS) {
    console.log(`\nBOOK ${a.fareType} OW 1ADT ${a.airline} ${a.o}-${a.d} d+${a.days} ${a.name.join(' ')}`);
    const body = buildOneWaySearchBody(a.days, {
      origin: a.o, destination: a.d, fareType: a.fareType, maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences.airlines = [a.airline];

    let sid = null;
    let opt = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      const analysis = analyzeFlightOptions(s.data, 'ONWARD');
      opt = pickAirline(analysis, a.airline);
      sid = opt?.searchId || extractFirstSearchId(s.data);
      console.log('  search', i + 1, s.data?.progress?.state, !!sid);
      if (sid || isSearchProgressComplete(s.data)) break;
      await sleep(2000);
    }
    if (!sid) continue;

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!pricing.data?.priceId) {
      console.log('  pricing fail', brief(pricing.data, 180));
      continue;
    }

    const leg0 = (pricing.data?.itinerary || [])[0] || {};
    const seg0 = (leg0.segments || [])[0] || {};
    const meta = {
      origin: seg0.departure?.airportCode || a.o,
      destination: seg0.arrival?.airportCode || a.d,
      segmentId: seg0.segmentId || 'SEG_1',
    };

    let meal = null;
    let bag = null;
    try {
      const ssr = await flight.getSsr(pricing.data.priceId);
      meal = pickPaidMeal(ssr.data, meta);
      bag = pickPaidBag(ssr.data, meta);
    } catch (e) {
      console.log('  ssr fail', e.message);
    }
    if (!meal && !bag) {
      console.log('  no paid meal/bag — next');
      continue;
    }
    const ssrPaid = (meal?.amount || 0) + (bag?.amount || 0);
    console.log('  fare', pricing.data.pricing?.totalAmount, 'ssrPaid', ssrPaid, 'meal', meal?.amount, 'bag', bag?.amount);

    const tag = letterTag();
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [sid],
      journeyType: 'ONE_WAY',
    });
    payload.data.passengers = [{
      paxId: 'PAX1',
      type: 'adult',
      isLead: true,
      profile: {
        title: 'Mr',
        firstName: a.name[0],
        lastName: `${a.name[1]} ${tag}`,
        gender: 'Male',
        dob: '1988-05-12',
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: {
        meals: meal ? [meal.item] : [],
        baggage: bag ? [bag.item] : [],
        seats: [],
      },
    }];
    if (pricing.data.addGstInfo === true || a.fareType === 'CORPORATE') {
      payload.data.includeGst = true;
      payload.data.addGstInfo = true;
      payload.data.gstDetails = { ...GST };
    }

    const issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    if (!br) {
      console.log('  issue fail', brief(issue.data, 220));
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
        return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
      }
      continue;
    }

    const { status, bail } = await waitConfirmOrBail(flight, br);
    if (bail || !/confirm/i.test(status)) {
      left.push({ br, status, airline: a.airline });
      continue;
    }

    const detail = await flight.getBookingDetail(br);
    const leg = (detail.data?.bookingResponse?.itinerary || [])[0] || {};
    const pnr = leg.pnr;
    if (!pnr) {
      left.push({ br, status, reason: 'no pnr' });
      continue;
    }

    // Prefer reading SSR from booking detail if present
    const pax = (detail.data?.bookingResponse?.passengers || [])[0] || {};
    const bookedMeals = pax.ssr?.meals || pax.ssr?.meal || [];
    const bookedBags = pax.ssr?.baggage || [];
    console.log('  =>', br, pnr, 'online', leg.onlineCancellation, 'bookedSSR', bookedMeals.length, bookedBags.length);

    return {
      br,
      pnr,
      status,
      airline: a.airline,
      fareType: a.fareType,
      route: `${a.o}-${a.d}`,
      onlineCancellation: leg.onlineCancellation,
      fareTotal: pricing.data.pricing?.totalAmount,
      ssrExpected: ssrPaid,
      mealAmount: meal?.amount || 0,
      bagAmount: bag?.amount || 0,
      left,
    };
  }
  return { error: 'NO_BOOKING', left };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('SSR withheld cancel test on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookWithSsr(flight, client);
  if (fixture?.error) {
    fs.writeFileSync(OUT, JSON.stringify({ error: fixture }, null, 2));
    throw new Error(fixture.error);
  }

  console.log('\n=== PENALTY', fixture.br, fixture.pnr);
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY', pnr: fixture.pnr, cancellationReason: 'SSR withheld',
  });
  console.log('PENALTY', pen.status, brief(pen.data));

  await sleep(1500);
  console.log('\n=== CANCEL');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL', pnr: fixture.pnr, cancellationReason: 'SSR withheld',
  });
  console.log('CANCEL', can.status, brief(can.data));

  const c = cr(can.status === 200 && cr(can).status ? can : pen);
  // Prefer CANCEL snapshot if it has amounts; else PENALTY
  const use = num(cr(can).estimatedRefund) != null ? can : pen;
  const snap = cr(use);
  const perPax = snap.perPax || {};
  const totalAmount = num(snap.totalAmount);
  const charge = num(snap.estimatedCancellationCharge);
  const refund = num(snap.estimatedRefund);
  const ssr = num(perPax.ssr) ?? 0;
  const breakup = env(use).refundSummary?.cancellationChargeBreakup || {};

  const table = [
    {
      rule: 'Cancel/PENALTY amounts present',
      expected: 'total, charge, refund numeric',
      actual: `total=${totalAmount} charge=${charge} refund=${refund} status=${snap.status}`,
      status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
    },
    {
      rule: 'refund = total − charge',
      expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
      actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
      status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
    },
    {
      rule: 'SSR amount present on quote (perPax.ssr > 0)',
      expected: `perPax.ssr ≈ booked SSR (${fixture.ssrExpected}) or > 0`,
      actual: `perPax.ssr=${ssr} booked=${fixture.ssrExpected} meal=${fixture.mealAmount} bag=${fixture.bagAmount}`,
      status: ssr > 0 ? 'PASS' : 'BUG',
    },
    {
      rule: 'SSR withheld (included in charge / not refunded)',
      expected: 'charge >= ssr (SSR deducted); refund does not return SSR',
      actual: `charge=${charge} ssr=${ssr} refund=${refund}`,
      status: ssr > 0 && charge != null && charge >= ssr - 1 ? 'PASS' : 'BUG',
    },
    {
      rule: 'Cancel completed (or request path)',
      expected: 'Cancelled / Cancellation Requested (provider fail = note only)',
      actual: snap.status || can.data?.error?.code || can.status,
      status: /cancelled|cancellation requested/i.test(String(snap.status || ''))
        && !/failed|not available/i.test(String(snap.status || ''))
        ? 'PASS' : 'BUG',
    },
  ];

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'SSR withheld from refund',
    fixture,
    penalty: { http: pen.status, raw: env(pen) },
    cancel: { http: can.status, raw: env(can) },
    used: { status: snap.status, totalAmount, charge, refund, perPax, breakup },
    table,
    score: scorecard,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
