/**
 * Postman-aligned paxwise flow on staging:
 *   1) POST .../cancel  { action: PENALTY, pnr, cancellationPaxList: [PAX1] }
 *   2) POST .../cancel  { action: CANCEL,  pnr, cancellationPaxList: [PAX1] }
 *
 * Mirrors TravelVIP.postman.json:
 *   - "Cancellation Penlty Check"
 *   - cancel with cancellationPaxList
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-paxwise-penalty-then-cancel-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/paxwise-penalty-then-cancel-staging.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 1200) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function cancelStatus(r) {
  return r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || null;
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}

function adultProfiles(n) {
  const base = [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
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

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  const days = Number(process.env.DAYS || 80);
  const origin = process.env.ORIGIN || 'DEL';
  const destination = process.env.DEST || 'BOM';
  const cancelPax = process.env.CANCEL_PAX || 'PAX1';

  console.log('Base', config.baseUrl, 'partner', config.partnerId);
  console.log(`Flow: book OW 2ADT → PENALTY [${cancelPax}] → CANCEL [${cancelPax}]`);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const body = buildOneWaySearchBody(days, {
    origin, destination, fareType: 'NORMAL', maxStops: 0,
  });
  body.travellers = { adults: 2, children: 0, infants: 0 };

  const search = await flight.searchUntilComplete(body);
  console.log('searchId', search.searchId);
  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    throw new Error(`pricing failed: ${brief(pricing.data, 500)}`);
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = adultProfiles(2);
  // Staging IX fares often require GST (Postman / pricing addGstInfo)
  payload.data.includeGst = true;
  payload.data.gstDetails = {
    gstNumber: '27AABCT1429B1Z1',
    gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
    gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
    gstEmailID: 'accounts@travelvip.ai',
    gstMobileNumber: '9921862715',
  };

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  console.log('issue', issue.status, br || brief(issue.data, 400));
  if (!br) throw new Error('issue-ticket missing bookingReference');

  let status;
  for (let i = 0; i < 14; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = String(st.data?.status || '');
    console.log('status', i + 1, status);
    if (isTerminalBookingStatus(status)) break;
    if (/inprogress/i.test(status) && i >= 5) break;
    await sleep(3500);
  }

  const detail = await flight.getBookingDetail(br);
  status = detail.data?.status || status;
  const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
  const pax = (detail.data?.bookingResponse?.passengers
    || detail.data?.passengers
    || []).map((p) => p.paxId || p.passengerId).filter(Boolean);

  const fixture = {
    br,
    pnr,
    status,
    route: `${origin}-${destination}`,
    days,
    paxIds: pax.length ? pax : ['PAX1', 'PAX2'],
    postman: {
      penaltyBody: { action: 'PENALTY', pnr, cancellationPaxList: [cancelPax] },
      cancelBody: { action: 'CANCEL', pnr, cancellationPaxList: [cancelPax] },
      path: `/v1/flights/booking/${br}/cancel?lang=en&currency=INR`,
    },
  };
  console.log('fixture', fixture);

  const cancelApi = (bodyCancel) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: bodyCancel,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const steps = [];
  const results = [];

  if (!pnr || !/confirm/i.test(String(status))) {
    const out = {
      ranAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      fixture,
      steps,
      results: [{
        id: 'setup',
        how: 'book OW 2ADT',
        expected: 'Confirmed + PNR',
        actual: brief(fixture, 300),
        status: 'NOT_TESTED',
      }],
      score: { PASS: 0, BUG: 0, NOT_TESTED: 1 },
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('NOT_TESTED — booking not confirmed. Wrote', OUT);
    return;
  }

  // Step 1 — Postman "Cancellation Penlty Check"
  const penaltyBody = { action: 'PENALTY', pnr, cancellationPaxList: [cancelPax] };
  console.log('\n=== STEP 1 PENALTY ===', JSON.stringify(penaltyBody));
  const pen = await cancelApi(penaltyBody);
  const penStep = {
    step: 1,
    name: 'Cancellation Penalty Check (Postman)',
    request: penaltyBody,
    http: pen.status,
    cancelStatus: cancelStatus(pen),
    paxScope: paxScope(pen),
    errorCode: errCode(pen),
    body: pen.data,
  };
  steps.push(penStep);
  console.log('PENALTY', pen.status, penStep.cancelStatus, brief(pen.data, 500));

  const penOk = pen.status === 200 && /Penalty Fetched|Penalty Check Failed|Penalty Not Available|not available/i.test(
    String(penStep.cancelStatus || ''),
  );
  results.push({
    id: '1',
    how: `PENALTY cancellationPaxList=["${cancelPax}"]`,
    expected: 'HTTP 200 + Penalty Fetched | Penalty Check Failed | Penalty Not Available',
    actual: `${pen.status} ${penStep.cancelStatus}`,
    status: penOk ? 'PASS' : 'BUG',
    note: brief(pen.data, 500),
  });

  await sleep(2000);

  // Step 2 — Postman paxwise CANCEL
  const cancelBody = {
    action: 'CANCEL',
    pnr,
    cancellationPaxList: [cancelPax],
    cancellationReason: 'QA Postman paxwise PENALTY then CANCEL',
  };
  console.log('\n=== STEP 2 CANCEL ===', JSON.stringify(cancelBody));
  const can = await cancelApi(cancelBody);
  const canStep = {
    step: 2,
    name: 'Paxwise CANCEL (Postman)',
    request: cancelBody,
    http: can.status,
    cancelStatus: cancelStatus(can),
    paxScope: paxScope(can),
    errorCode: errCode(can),
    body: can.data,
  };
  steps.push(canStep);
  console.log('CANCEL', can.status, canStep.cancelStatus, canStep.paxScope, brief(can.data, 500));

  const scope = canStep.paxScope;
  const cancelOk = can.status === 200
    && /Cancellation Requested|Cancelled|Cancellation Failed/i.test(String(canStep.cancelStatus || ''))
    && (scope?.scope === 'PARTIAL_PAX' || scope?.cancellationPaxList?.includes(cancelPax));
  results.push({
    id: '2',
    how: `CANCEL cancellationPaxList=["${cancelPax}"] after PENALTY`,
    expected: 'HTTP 200 + Cancellation Requested + PARTIAL_PAX',
    actual: `${can.status} ${canStep.cancelStatus} scope=${brief(scope, 200)}`,
    status: cancelOk ? 'PASS' : 'BUG',
    note: brief(can.data, 500),
  });

  await sleep(4000);
  const after = await flight.getBookingStatus(br);
  const afterStatus = after.data?.status;
  console.log('afterStatus', afterStatus);

  results.push({
    id: '3',
    how: 'booking status after paxwise cancel',
    expected: 'Confirmed | Partially cancelled (async)',
    actual: String(afterStatus || ''),
    status: afterStatus ? 'PASS' : 'BUG',
  });

  const score = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  for (const r of results) {
    if (score[r.status] != null) score[r.status] += 1;
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    source: 'TravelVIP.postman.json — Cancellation Penlty Check + CANCEL cancellationPaxList',
    fixture,
    steps,
    afterStatus,
    results,
    score,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\nSCORE', score);
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
