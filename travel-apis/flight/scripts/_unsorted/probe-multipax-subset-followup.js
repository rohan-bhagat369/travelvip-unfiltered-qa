/**
 * Follow-up: book Confirmed 4ADT + RT (plain) and run subset cancel cases.
 * Leaves Inprogress alone. Uses canary.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-multipax-subset-followup.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/multipax-cancel-canary-subset-followup.json';
const Q = { ...FLIGHT_QUERY };

function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function cancelStatus(r) {
  return (
    r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || r?.data?.status
    || null
  );
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
}
function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 300) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

function adultProfiles(n) {
  const base = [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
    ['Neha', 'Patil', 'Mrs', 'Female', '1994-03-12'],
    ['Vikram', 'Singh', 'Mr', 'Male', '1992-11-20'],
  ];
  return base.slice(0, n).map(([firstName, lastName, title, gender, dob], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { title, firstName, lastName, gender, dob, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
}

async function waitStatus(flight, br) {
  let status;
  for (let i = 0; i < 12; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = String(st.data?.status || '');
    console.log('  status', br, i + 1, status);
    if (isTerminalBookingStatus(status)) return status;
    if (/inprogress/i.test(status) && i >= 1) {
      console.log('  leave Inprogress');
      return status;
    }
    await sleep(3000);
  }
  return status;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const cancelApi = (br, body) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const results = [];
  const add = (id, how, expected, actual, status, note = '') => {
    results.push({ id, how, expected, actual, status, note });
    console.log(`[${status}] ${id} ${actual}`);
  };

  // ---- 4ADT plain ----
  console.log('\nBOOK OW4_PLAIN HYD->BOM');
  const body4 = buildOneWaySearchBody(74, {
    origin: 'HYD', destination: 'BOM', fareType: 'NORMAL', maxStops: 0,
  });
  body4.travellers = { adults: 4, children: 0, infants: 0 };
  const search4 = await flight.searchUntilComplete(body4);
  const pricing4 = await flight.getPricing([search4.searchId], 'ONE_WAY');
  const payload4 = buildIssueTicketPayload({
    bookingContext: pricing4.data.bookingContext,
    priceId: pricing4.data.priceId,
    searchIds: [search4.searchId],
    journeyType: 'ONE_WAY',
  });
  payload4.data.passengers = adultProfiles(4);
  const issue4 = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload4,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br4 = issue4.data?.bookingReference || issue4.data?.bookingReferenceId;
  if (!br4) throw new Error(`OW4 issue: ${brief(issue4.data)}`);
  let status4 = await waitStatus(flight, br4);
  const detail4 = await flight.getBookingDetail(br4);
  status4 = detail4.data?.status || status4;
  const pnr4 = (detail4.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
  const F4 = { br: br4, status: status4, pnr: pnr4 };
  console.log('F4', F4);

  if (pnr4 && !/fail|cancel/i.test(String(status4))) {
    const br = br4;
    const pnr = pnr4;

    let r = await cancelApi(br, { action: 'PENALTY', pnr, cancellationPaxList: ['PAX1'] });
    let st = String(cancelStatus(r) || errCode(r) || '');
    let scope = paxScope(r);
    add(
      '3.6',
      'PENALTY [PAX1]',
      'Penalty Not Available / penaltyQuotable=false',
      `${r.status} ${st} scope=${brief(scope)}`,
      (/not available/i.test(st) || scope?.penaltyQuotable === false) ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi(br, {
      action: 'CANCEL',
      pnr,
      cancellationPaxList: ['PAX1', 'PAX2'],
      cancellationReason: 'QA subset',
    });
    st = cancelStatus(r);
    scope = paxScope(r);
    add(
      '3.1',
      'CANCEL [PAX1,PAX2]',
      'Requested + PARTIAL_PAX prorated',
      `${r.status} ${st} scope=${brief(scope)}`,
      (ok(r) && /requested/i.test(String(st)) && scope?.scope === 'PARTIAL_PAX' && scope?.prorated === true)
        ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi(br, { action: 'CANCEL', pnr, cancellationPaxList: ['PAX1'] });
    add(
      '4.21',
      'repeat PAX1 while open',
      '409 CANCELLATION_ALREADY_IN_PROGRESS',
      `${r.status} ${errCode(r)}`,
      (r.status === 409 && errCode(r) === 'CANCELLATION_ALREADY_IN_PROGRESS') ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi(br, { action: 'CANCEL', pnr, cancellationPaxList: ['PAX3'] });
    add(
      '4.22',
      'PAX3 while open',
      'Cancellation Requested',
      `${r.status} ${cancelStatus(r)} ${errCode(r)}`,
      (ok(r) && /requested/i.test(String(cancelStatus(r)))) ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi(br, {
      action: 'PENALTY',
      pnr,
      cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
    });
    st = String(cancelStatus(r) || errCode(r) || '');
    add(
      '3.7',
      'PENALTY 3 of 4',
      'Penalty Not Available',
      `${r.status} ${st}`,
      (/not available/i.test(st) || paxScope(r)?.penaltyQuotable === false) ? 'PASS' : 'BUG',
      brief(r.data),
    );
  } else {
    add('3.x', 'subset', 'confirmed+pnr', brief(F4), 'NOT_TESTED');
  }

  // ---- RT plain ----
  console.log('\nBOOK RT2_PLAIN BOM<->DEL');
  let RT = null;
  try {
    const bodyRt = buildRoundTripSearchBody(80, 87, {
      origin: 'BOM', destination: 'DEL', fareType: 'NORMAL', maxStops: 0,
    });
    bodyRt.travellers = { adults: 2, children: 0, infants: 0 };
    const searchRt = await flight.searchRoundTripUntilComplete(bodyRt);
    const pricingRt = await flight.getPricing(searchRt.searchIds, 'ROUND_TRIP');
    const payloadRt = buildIssueTicketPayload({
      bookingContext: pricingRt.data.bookingContext,
      priceId: pricingRt.data.priceId,
      searchIds: searchRt.searchIds,
      journeyType: 'ROUND_TRIP',
    });
    payloadRt.data.passengers = adultProfiles(2);
    const issueRt = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payloadRt,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const brRt = issueRt.data?.bookingReference || issueRt.data?.bookingReferenceId;
    if (!brRt) throw new Error(brief(issueRt.data));
    let statusRt = await waitStatus(flight, brRt);
    const detailRt = await flight.getBookingDetail(brRt);
    statusRt = detailRt.data?.status || statusRt;
    const pnrs = (detailRt.data?.bookingResponse?.itinerary || [])
      .map((x) => x.pnr)
      .filter(Boolean);
    RT = { br: brRt, status: statusRt, pnrs, pnr: pnrs[0] || null };
    console.log('RT', RT);
  } catch (e) {
    RT = { error: e.message };
    console.log('RT fail', e.message);
  }

  if (RT?.pnr) {
    const r = await cancelApi(RT.br, {
      action: 'CANCEL',
      pnr: RT.pnr,
      cancellationPaxList: ['PAX1'],
      cancellationReason: 'QA RT partial',
    });
    const st = cancelStatus(r);
    const scope = paxScope(r);
    add(
      '3.4',
      'RT CANCEL [PAX1]',
      'Cancellation Requested (partial)',
      `${r.status} ${st} scope=${brief(scope)}`,
      (ok(r) && /requested/i.test(String(st))) ? 'PASS' : 'BUG',
      brief(r.data),
    );
  } else {
    add('3.4', 'RT subset', 'confirmed+pnr', brief(RT), 'NOT_TESTED');
  }

  const score = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  for (const x of results) {
    if (score[x.status] != null) score[x.status] += 1;
  }
  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixtures: { F4, RT },
    results,
    score,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('SCORE', score);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
