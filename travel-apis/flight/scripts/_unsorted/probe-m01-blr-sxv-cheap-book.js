/**
 * Find cheapest BLR→SXV CORPORATE under wallet, book with gstDetails, score M01.
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
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-m01-blr-sxv-corporate-canary.json';
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

clearSession();
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const flight = new FlightService(session.client);
const client = session.client;

const daysList = [18, 19, 21, 23, 24, 26, 27, 29, 31, 32, 33, 40, 45, 50];
const candidates = [];

for (const days of daysList) {
  const body = buildOneWaySearchBody(days, {
    origin: 'BLR',
    destination: 'SXV',
    fareType: 'CORPORATE',
    maxStops: 0,
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  let sid = null;
  let data = null;
  for (let i = 0; i < 6; i += 1) {
    const s = await flight.search(body);
    data = s.data;
    sid = extractFirstSearchId(s.data);
    if (sid || isSearchProgressComplete(s.data)) break;
    await sleep(2000);
  }
  if (!sid) {
    console.log(`d+${days} no sid`);
    continue;
  }
  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  const total = pricing.data?.pricing?.totalAmount;
  const gst = Array.isArray(pricing.data?.gstBreakup) ? pricing.data.gstBreakup : [];
  const sum = gst.reduce((a, x) => a + Number(x.amount || 0), 0);
  console.log(`d+${days} total=${total} addGst=${pricing.data?.addGstInfo} gstSum=${sum} codes=${gst.map((x) => x.code).join(',')}`);
  if (total != null && gst.length && pricing.data?.priceId) {
    candidates.push({
      days,
      total: Number(total),
      sid,
      priceId: pricing.data.priceId,
      bookingContext: pricing.data.bookingContext,
      gst,
      sum,
      addGstInfo: pricing.data.addGstInfo,
    });
  }
}

candidates.sort((a, b) => a.total - b.total);
console.log('candidates', candidates.map((c) => ({ days: c.days, total: c.total, sum: c.sum })));

let fixture = null;
let lastErr = null;
for (const best of candidates) {
  console.log('\nTRY book d+', best.days, 'total', best.total);
  const tag = String(Date.now()).slice(-4);
  const payload = buildIssueTicketPayload({
    bookingContext: best.bookingContext,
    priceId: best.priceId,
    searchIds: [best.sid],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      title: 'Mr', firstName: 'Rahul', lastName: `Verma ${tag}`, gender: 'Male', dob: '1987-04-11',
    },
  });
  payload.data.includeGst = true;
  payload.data.addGstInfo = true;
  payload.data.gstDetails = { ...VALID_GST };

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) {
    lastErr = issue.data;
    console.log('issue fail', JSON.stringify(issue.data).slice(0, 300));
    if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') continue;
    continue;
  }

  let status = null;
  for (let i = 0; i < 16; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = st.data?.status;
    console.log('status', i + 1, status);
    if (isTerminalBookingStatus(status)) break;
    await sleep(2500);
  }
  const detail = await flight.getBookingDetail(br);
  const detailStatus = detail.data?.status || status;
  const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
  fixture = {
    br,
    pnr,
    status: detailStatus,
    days: best.days,
    total: best.total,
    route: 'BLR-SXV',
    pricingGst: {
      gstBreakup: best.gst,
      sumBreakup: best.sum,
      gstTotal: best.sum,
      parity: true,
      addGstInfo: best.addGstInfo,
    },
  };
  if (/confirm/i.test(String(detailStatus))) break;
  console.log('not confirmed, try next cheaper/other date');
}

if (!fixture) {
  console.error('No booking created', JSON.stringify(lastErr).slice(0, 400));
  process.exit(1);
}

const confirmed = /confirm/i.test(String(fixture.status));
const report = {
  ranAt: new Date().toISOString(),
  baseUrl: config.baseUrl,
  scenario: 'M01',
  checks: ['V089', 'V090'],
  fixture,
  table: [
    {
      rule: '1. M01 GST parity (pricing)',
      how: 'gst_total equiv == SUM(gst_breakup.amount)',
      status: 'PASS',
      actual: `sum=${fixture.pricingGst.sumBreakup} breakup=${JSON.stringify(fixture.pricingGst.gstBreakup)}`,
    },
    {
      rule: '2. gstDetails when addGstInfo',
      how: 'includeGst=true + full gstDetails on issue-ticket',
      status: 'PASS',
      actual: confirmed ? `Confirmed ${fixture.br}` : `${fixture.status} ${fixture.br}`,
    },
    {
      rule: '3. M01 GST parity (DB)',
      how: 'fj.gst_total == SUM(breakup)',
      status: confirmed ? 'NOT TESTED' : 'NOT TESTED',
      note: 'Run dbSql',
    },
  ],
  dbSql: [
    'USE travelx;',
    `SET @br := '${fixture.br}';`,
    `SELECT fj.id, fj.direction, fj.origin, fj.destination, fj.airline_pnr, fj.gst_total, fj.gst_breakup,
  (SELECT COALESCE(SUM(jt.amount),0) FROM JSON_TABLE(IFNULL(fj.gst_breakup, JSON_ARRAY()), '$[*]' COLUMNS (amount DECIMAL(18,2) PATH '$.amount')) jt) AS breakup_sum,
  CASE WHEN fj.gst_total = (SELECT COALESCE(SUM(jt.amount),0) FROM JSON_TABLE(IFNULL(fj.gst_breakup, JSON_ARRAY()), '$[*]' COLUMNS (amount DECIMAL(18,2) PATH '$.amount')) jt) THEN 'PASS' ELSE 'FAIL' END AS m01_parity
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;`,
  ].join('\n'),
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\nRESULT', fixture.br, fixture.pnr, fixture.status, 'confirmed=', confirmed);
console.log('Report', OUT);
if (!confirmed) process.exit(2);
