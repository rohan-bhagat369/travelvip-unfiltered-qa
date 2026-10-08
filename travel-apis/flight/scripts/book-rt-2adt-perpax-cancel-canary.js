/**
 * Book RT 2ADT on canary → per-pax cancel (cancellationPaxList=[PAX1]) on onward PNR.
 * Prefer CORPORATE (NORMAL subset often returns penaltyBasis NONE / empty quote).
 *
 *   FLIGHT_ISSUE_PID=vgm node scripts/book-rt-2adt-perpax-cancel-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-rt-2adt-perpax-cancel-canary.json';
const Q = { ...FLIGHT_QUERY };
const CANCEL_LIST = ['PAX1'];
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}
function scope(r) {
  return env(r).paxScope || null;
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function nearly(a, b, tol = 1) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function passengers(tag) {
  const pool = [
    { title: 'Mr', firstName: 'Arjun', lastName: 'Kapoor', gender: 'Male', dob: '1989-04-18' },
    { title: 'Mrs', firstName: 'Meera', lastName: 'Kapoor', gender: 'Female', dob: '1992-11-09' },
  ];
  return pool.map((p, i) => {
    const prof = buildPassengerProfile({ ...p, lastName: `${p.lastName}${tag}` });
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: prof.title,
        firstName: prof.firstName,
        lastName: prof.lastName,
        gender: prof.gender,
        dob: prof.dob,
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  });
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

async function waitConfirm(flight, br, max = 14) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return last;
    if (/inprogress/i.test(last) && i >= 3) return last;
    if (isTerminalBookingStatus(last) && !/pending|progress/i.test(last)) return last;
    await sleep(3000);
  }
  return last;
}

function pickOpt(analysis) {
  return analysis.nonStop[0] || analysis.connecting[0] || null;
}

async function bookRt2Adt(flight, client) {
  const plans = [
    { fareType: 'CORPORATE', o: 'DEL', d: 'BOM', od: 45, rd: 52, airlines: [] },
    { fareType: 'CORPORATE', o: 'BOM', d: 'BLR', od: 40, rd: 47, airlines: ['6E'] },
    { fareType: 'CORPORATE', o: 'DEL', d: 'HYD', od: 50, rd: 57, airlines: [] },
    { fareType: 'NORMAL', o: 'DEL', d: 'BOM', od: 42, rd: 49, airlines: ['6E'] },
    { fareType: 'NORMAL', o: 'BOM', d: 'DEL', od: 38, rd: 45, airlines: ['SG', '6E'] },
  ];

  for (const plan of plans) {
    console.log(`\nBOOK RT 2ADT ${plan.fareType} ${plan.o}<->${plan.d} +${plan.od}/+${plan.rd}`);
    const body = buildRoundTripSearchBody(plan.od, plan.rd, {
      origin: plan.o,
      destination: plan.d,
      fareType: plan.fareType,
      maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences = {
      airlines: plan.airlines || [],
      maxStops: 0,
      refundableOnly: false,
    };

    let onwardOpt = null;
    for (let i = 0; i < 14; i += 1) {
      const s = await flight.search(body);
      const onward = analyzeFlightOptions(s.data, 'ONWARD');
      onwardOpt = pickOpt(onward);
      console.log(`  onward poll ${i + 1}`, s.data?.progress?.state, 'opts', onward.total);
      if (onwardOpt?.searchId && (isSearchProgressComplete(s.data) || i >= 4)) break;
      if (isSearchProgressComplete(s.data) && !onwardOpt) break;
      await sleep(s.data?.progress?.pollAfterMs || 3000);
    }
    if (!onwardOpt?.searchId) continue;

    const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
    let returnOpt = null;
    for (let i = 0; i < 14; i += 1) {
      const s = await flight.search(refined);
      const ret = analyzeFlightOptions(s.data, 'RETURN');
      returnOpt = pickOpt(ret);
      console.log(`  return poll ${i + 1}`, s.data?.progress?.state, 'opts', ret.total);
      if (returnOpt?.searchId && (isSearchProgressComplete(s.data) || i >= 3)) break;
      if (isSearchProgressComplete(s.data) && !returnOpt) break;
      await sleep(s.data?.progress?.pollAfterMs || 3000);
    }
    if (!returnOpt?.searchId) continue;

    const searchIds = [onwardOpt.searchId, returnOpt.searchId];
    const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      console.log('  pricing fail', brief(pricing.data, 220));
      continue;
    }
    const addGst = pricing.data?.addGstInfo === true;
    console.log('  price', pricing.data.pricing?.totalAmount, 'addGst', addGst);

    const tag = String(Date.now()).slice(-4);
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: 'ROUND_TRIP',
    });
    payload.data.passengers = passengers(tag);
    if (addGst || plan.fareType === 'CORPORATE') {
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
    console.log('  issue', issue.status, br || brief(issue.data, 250));
    if (!br) {
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
        return { error: 'INSUFFICIENT_BALANCE' };
      }
      continue;
    }

    const status = await waitConfirm(flight, br);
    if (!/confirm/i.test(String(status))) {
      console.log('  not Confirmed — try next');
      continue;
    }

    const detail = await flight.getBookingDetail(br);
    const itins = detail.data?.bookingResponse?.itinerary || [];
    const onward = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
    const ret = itins.find((l) => /return/i.test(l.direction)) || itins[1];
    const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);

    return {
      br,
      status,
      fareType: plan.fareType,
      journeyType: 'ROUND_TRIP',
      route: `${plan.o}-${plan.d}`,
      dates: {
        onward: body.itinerary[0].date,
        return: body.itinerary[1].date,
      },
      totalAmount: detail.data?.bookingResponse?.salesSummary?.totalAmount
        ?? pricing.data.pricing?.totalAmount,
      passengers: pax,
      onward: {
        pnr: onward?.pnr,
        onlineCancellation: onward?.onlineCancellation,
        airline: onward?.segments?.[0]?.airline?.code || onward?.segments?.[0]?.airlineCode,
      },
      return: {
        pnr: ret?.pnr,
        onlineCancellation: ret?.onlineCancellation,
        airline: ret?.segments?.[0]?.airline?.code || ret?.segments?.[0]?.airlineCode,
      },
    };
  }
  return null;
}

function score(label, res) {
  const c = cr(res);
  const sc = scope(res);
  const perPax = c.perPax;
  const perPaxObj = Array.isArray(perPax) ? null : perPax;
  const perPaxArr = Array.isArray(perPax) ? perPax : null;
  const totalAmount = num(c.totalAmount);
  const charge = num(c.estimatedCancellationCharge);
  const refund = num(c.estimatedRefund);
  const basis = perPaxObj?.penaltyBasis
    || (perPaxArr ? 'ARRAY' : null)
    || c.penaltyBasis
    || null;

  const rows = [
    {
      rule: `${label}: HTTP 200 / success envelope`,
      expected: 'HTTP 200 + status 0 or cancellationRequest',
      actual: `http=${res.status} status=${res.data?.status} cr=${c.status || '-'}`,
      status: res.status === 200 && (c.status || res.data?.status === 0) ? 'PASS' : 'BUG',
    },
    {
      rule: `${label}: paxScope PARTIAL_PAX`,
      expected: `scope=PARTIAL_PAX cancelledPaxCount=1 list=${CANCEL_LIST.join(',')}`,
      actual: sc ? brief(sc, 220) : 'MISSING',
      status: sc?.scope === 'PARTIAL_PAX'
        && Number(sc.cancelledPaxCount) === 1
        && (sc.cancellationPaxList || []).includes('PAX1')
        ? 'PASS' : 'BUG',
    },
    {
      rule: `${label}: money quote present`,
      expected: 'totalAmount + charge + refund numeric; basis not NONE',
      actual: `total=${totalAmount} charge=${charge} refund=${refund} basis=${basis} msg=${c.message || ''}`,
      status: totalAmount != null
        && charge != null
        && refund != null
        && String(basis) !== 'NONE'
        && !/no estimated/i.test(String(c.message || ''))
        ? 'PASS' : 'BUG',
    },
    {
      rule: `${label}: refund ≈ total − charge`,
      expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
      actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
      status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
    },
    {
      rule: `${label}: perPax present`,
      expected: 'perPax object or array with PAX1',
      actual: perPax ? brief(perPax, 280) : 'MISSING',
      status: perPax ? 'PASS' : 'BUG',
    },
    {
      rule: `${label}: cancel/penalty status ok`,
      expected: 'Penalty Fetched / Cancellation Requested / Cancelled / Partial',
      actual: c.status || res.data?.error?.code || res.status,
      status: /penalty fetched|cancellation requested|cancelled|partial/i.test(String(c.status || ''))
        && !/failed|not available/i.test(String(c.status || ''))
        ? 'PASS' : 'BUG',
    },
  ];

  return {
    rows,
    snapshot: {
      http: res.status,
      status: c.status,
      totalAmount,
      charge,
      refund,
      penaltyBasis: basis,
      message: c.message || null,
      paxScope: sc,
      perPax,
      raw: env(res),
      error: res.data?.error || null,
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);
  console.log('Goal: RT 2ADT → perPax cancel', CANCEL_LIST);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookRt2Adt(flight, client);
  if (fixture?.error === 'INSUFFICIENT_BALANCE') {
    fs.writeFileSync(OUT, JSON.stringify({ error: fixture }, null, 2));
    throw new Error('INSUFFICIENT_BALANCE');
  }
  if (!fixture?.br || !fixture?.onward?.pnr) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_BOOKING', fixture }, null, 2));
    throw new Error('No RT 2ADT Confirmed booking');
  }

  const targetPnr = fixture.onward.pnr;
  console.log('\n=== FIXTURE ===');
  console.log(JSON.stringify(fixture, null, 2));

  console.log('\n=== PER-PAX PENALTY', fixture.br, targetPnr, CANCEL_LIST);
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: targetPnr,
    cancellationPaxList: CANCEL_LIST,
    cancellationReason: 'RT 2ADT perPax PAX1',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = score('PENALTY perPax', pen);

  await sleep(1500);
  console.log('\n=== PER-PAX CANCEL');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: targetPnr,
    cancellationPaxList: CANCEL_LIST,
    cancellationReason: 'RT 2ADT perPax PAX1',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = score('CANCEL perPax', can);

  await sleep(2500);
  const afterDetail = await flight.getBookingDetail(fixture.br);
  const afterStatus = await flight.getBookingStatus(fixture.br);
  const paxAfter = (afterDetail.data?.bookingResponse?.passengers || []).map((p) => ({
    paxId: p.paxId,
    name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
    legs: (p.legs || []).map((l) => ({ pnr: l.pnr, status: l.status, eticket: l.eticket })),
  }));

  const table = [
    ...sPen.rows,
    ...sCan.rows,
    {
      rule: 'Booking still retrievable after partial cancel',
      expected: 'HTTP 200 detail',
      actual: `http=${afterDetail.status} bookingStatus=${afterStatus.data?.status}`,
      status: afterDetail.status === 200 ? 'PASS' : 'BUG',
    },
    {
      rule: 'PAX2 still present on booking',
      expected: 'PAX2 remains',
      actual: paxAfter.map((p) => p.paxId).join(',') || 'none',
      status: paxAfter.some((p) => p.paxId === 'PAX2') ? 'PASS' : 'BUG',
    },
  ];

  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'RT 2ADT perPax cancel cancellationPaxList=[PAX1] on onward PNR',
    fixture,
    request: {
      action: 'PENALTY then CANCEL',
      pnr: targetPnr,
      cancellationPaxList: CANCEL_LIST,
    },
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
    after: {
      bookingStatus: afterStatus.data?.status,
      passengers: paxAfter,
    },
    table,
    score: scorecard,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Report', OUT);
  if (scorecard.BUG > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
