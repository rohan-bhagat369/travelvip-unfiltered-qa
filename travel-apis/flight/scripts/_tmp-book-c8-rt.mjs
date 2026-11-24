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

const { client } = await authenticate(true);
client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
const flight = new FlightService(client);
const body = buildRoundTripSearchBody(34, 40, {
  origin: 'DEL',
  destination: 'PNQ',
  maxStops: 2,
  fareType: 'NORMAL',
});
body.travellers = { adults: 2, children: 0, infants: 0 };
const search = await flight.search(body);
const onward = extractOnwardSearchId(search.data) || opts(search.data, 'ONWARD')[0]?.searchId;
const retRes = await flight.search({ ...body, selection: { selectedSearchIds: [onward] } });
const ret =
  extractReturnSearchId(retRes.data) ||
  opts(retRes.data, 'RETURN').find((o) => o.searchId !== onward)?.searchId;
const ids = [onward, ret];
const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
const ctx = pricing.data?.bookingContext || pricing.data?.bookingReference;
const priceId = pricing.data?.priceId;
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
payload.data.contact.email = `ak.c8rt.${Date.now()}@travelvip.ai`;
payload.data.passengers[0].profile.lastName = 'Confirmed';
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
  ssr: { baggage: [], meals: [], seats: [] },
});
const issue = await client.request({
  method: 'POST',
  path: '/api/v2/flights/booking/issue-ticket',
  query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, pid: 'vgm', count: 10, page: 0, perpage: 20 },
  body: payload,
  correlation: true,
  partnerKey: client.partnerKey,
});
const br = issue.data?.bookingReference;
let last;
let st;
for (let i = 0; i < 20; i++) {
  last = await flight.getBookingStatus(br);
  st = String(last.data?.status || '');
  console.log('poll', i + 1, st);
  if (/confirm|fail|cancel/i.test(st)) break;
  await sleep(2500);
}
const pnrs = [...new Set(JSON.stringify(last.data).match(/SIM-[A-Z0-9]+/g) || [])];
const out = { br, status: st, pnrs };
fs.writeFileSync(
  'd:/Travel VIP API Automation/travel-apis/flight/reports/cancel-suite-2026-11-19/c8-rt-fixture.json',
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
