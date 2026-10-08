import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { collectOptions, pickFareSearchId } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
const OUT = 'reports/book-one-hotel-one-flight-staging.json';

function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

clearSession();
const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const flight = new FlightService(session.client);
const client = session.client;
console.log('Base', config.baseUrl, 'flight-only');

const body = buildOneWaySearchBody(50, {
  origin: 'BOM',
  destination: 'DEL',
  maxStops: 0,
  fareType: 'NORMAL',
});
let last = null;
for (let i = 0; i < 12; i += 1) {
  last = await flight.search(body);
  const n = collectOptions(last?.data, 'ONWARD').length;
  console.log('search', i + 1, last.status, n, last.data?.progress?.state);
  if (last.ok && isSearchProgressComplete(last.data) && n) break;
  await sleep(last.data?.progress?.pollAfterMs || 2500);
}
const opt = collectOptions(last?.data, 'ONWARD')[0];
if (!opt) throw new Error('no flight options');
const sid = pickFareSearchId(opt, { fareType: 'NORMAL' }) || opt.searchId;
const label = `${opt.segments?.[0]?.airline?.code} ${opt.segments?.[0]?.flightNumber}`;
console.log('pick', label, sid);

const pricing = await flight.getPricing([sid], 'ONE_WAY');
if (!pricing.ok || !pricing.data?.priceId) throw new Error('pricing fail');

const tag = letterTag();
const issueBody = buildIssueTicketPayload({
  bookingContext: pricing.data.bookingContext,
  priceId: pricing.data.priceId,
  searchIds: [sid],
  journeyType: 'ONE_WAY',
  passengerProfile: { firstName: `Karan${tag}`, lastName: 'Mehta' },
});
const issue = await client.request({
  method: 'POST',
  path: '/api/v2/flights/booking/issue-ticket',
  query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
  body: issueBody,
  correlation: true,
  partnerKey: client.partnerKey,
});
const br = issue.data?.bookingReference;
console.log('issue', issue.status, br || JSON.stringify(issue.data).slice(0, 280));
if (!br) process.exit(1);

let status = null;
for (let i = 0; i < 10; i += 1) {
  const st = await flight.getBookingStatus(br);
  status = st.data?.status;
  console.log('status', i + 1, status);
  if (isTerminalBookingStatus(status) || /inprogress/i.test(String(status))) break;
  await sleep(4000);
}

const det = await flight.getBookingDetail(br);
const flightBook = {
  br,
  status,
  flight: label,
  route: 'BOM-DEL',
  pnr: det.data?.bookingResponse?.itinerary?.[0]?.pnr || null,
  passenger: `Karan${tag} Mehta`,
};

let report = { ranAt: new Date().toISOString(), baseUrl: config.baseUrl };
try {
  report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch { /* first write */ }
report.flight = flightBook;
report.ranAt = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('FLIGHT', flightBook);
if (!/confirm/i.test(String(status))) process.exit(1);
