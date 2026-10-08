/**
 * Minimal canary book check + optional 2ADT subset cancel.
 * BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-multipax-2adt-subset.js
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

const Q = { ...FLIGHT_QUERY };

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(r) { return r?.data?.error?.code || r?.data?.code || null; }
function cancelStatus(r) {
  return r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || null;
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
}
function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
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
  console.log('Base', config.baseUrl, 'partner', config.partnerId);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const days = Number(process.env.DAYS || 77);
  const origin = process.env.ORIGIN || 'BOM';
  const destination = process.env.DEST || 'HYD';
  const adults = Number(process.env.ADULTS || 2);

  console.log(`BOOK OW ${origin}->${destination} +${days}d adults=${adults}`);
  const body = buildOneWaySearchBody(days, {
    origin, destination, fareType: 'NORMAL', maxStops: 0,
  });
  body.travellers = { adults, children: 0, infants: 0 };

  const search = await flight.searchUntilComplete(body);
  console.log('searchId', search.searchId);
  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  console.log('pricing status', pricing.status, 'priceId', pricing.data?.priceId, 'bc?', Boolean(pricing.data?.bookingContext));
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    console.log('pricing body', brief(pricing.data, 600));
    throw new Error('pricing missing priceId/bookingContext');
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = adultProfiles(adults);
  console.log('issue payload keys', Object.keys(payload), 'data keys', Object.keys(payload.data || {}));

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  console.log('issue', issue.status, brief(issue.data, 500));
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) throw new Error(`issue failed: ${brief(issue.data)}`);

  let status;
  for (let i = 0; i < 12; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = String(st.data?.status || '');
    console.log('status', i + 1, status);
    if (isTerminalBookingStatus(status)) break;
    if (/inprogress/i.test(status) && i >= 1) {
      console.log('leave Inprogress');
      break;
    }
    await sleep(3000);
  }

  const detail = await flight.getBookingDetail(br);
  status = detail.data?.status || status;
  const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
  const fixture = { br, status, pnr, adults, route: `${origin}-${destination}` };
  console.log('fixture', fixture);

  const results = [];
  const add = (id, how, expected, actual, st, note = '') => {
    results.push({ id, how, expected, actual, status: st, note });
    console.log(`[${st}] ${id} ${actual}`);
  };

  if (!pnr || /fail|cancel/i.test(String(status))) {
    add('3.x', 'subset', 'confirmed+pnr', brief(fixture), 'NOT_TESTED');
  } else {
    const cancelApi = (bodyCancel) => client.request({
      method: 'POST',
      path: `/v1/flights/booking/${br}/cancel`,
      query: Q,
      body: bodyCancel,
      correlation: true,
      partnerKey: client.partnerKey,
    });

    let r = await cancelApi({ action: 'PENALTY', pnr, cancellationPaxList: ['PAX1'] });
    let st = String(cancelStatus(r) || errCode(r) || '');
    let scope = paxScope(r);
    add(
      '3.6',
      'PENALTY [PAX1]',
      'Penalty Not Available',
      `${r.status} ${st}`,
      (/not available/i.test(st) || scope?.penaltyQuotable === false) ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi({
      action: 'CANCEL', pnr, cancellationPaxList: ['PAX1'], cancellationReason: 'QA subset',
    });
    st = cancelStatus(r);
    scope = paxScope(r);
    add(
      '3.1',
      'CANCEL [PAX1] of 2',
      'Requested + PARTIAL_PAX',
      `${r.status} ${st} scope=${brief(scope)}`,
      (ok(r) && /requested/i.test(String(st)) && scope?.scope === 'PARTIAL_PAX') ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi({ action: 'CANCEL', pnr, cancellationPaxList: ['PAX1'] });
    add(
      '4.21',
      'repeat PAX1',
      '409 CANCELLATION_ALREADY_IN_PROGRESS',
      `${r.status} ${errCode(r)}`,
      (r.status === 409 && errCode(r) === 'CANCELLATION_ALREADY_IN_PROGRESS') ? 'PASS' : 'BUG',
      brief(r.data),
    );

    r = await cancelApi({ action: 'CANCEL', pnr, cancellationPaxList: ['PAX2'] });
    add(
      '4.22',
      'PAX2 while open',
      'Cancellation Requested',
      `${r.status} ${cancelStatus(r)} ${errCode(r)}`,
      (ok(r) && /requested/i.test(String(cancelStatus(r)))) ? 'PASS' : 'BUG',
      brief(r.data),
    );
  }

  const score = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  for (const x of results) {
    if (score[x.status] != null) score[x.status] += 1;
  }
  const out = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl, fixture, results, score };
  fs.writeFileSync('reports/multipax-cancel-canary-subset-2adt.json', JSON.stringify(out, null, 2));
  console.log('SCORE', score);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
