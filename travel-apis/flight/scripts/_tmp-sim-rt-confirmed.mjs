/**
 * One-shot RT book on ak-api — PNQ↔DEL, lastName Confirmed. No date/name retry loop.
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildRoundTripSearchBody } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

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
process.env.BASE_URL = process.env.BASE_URL || 'https://ak-api.travelvip.ai';
process.env.PARTNER_ID = vars.partner_id || 'vgm';
process.env.PARTNER_SECRET = vars.partner_secret;
process.env.SIGNING_KEY = vars.signing_key;
process.env.TIER_ID = vars.tier_id || '10546901';

function brief(d, n = 400) {
  return JSON.stringify(d).slice(0, n);
}

async function main() {
  console.log('BASE', process.env.BASE_URL);
  const { client } = await authenticate(true);
  const flight = new FlightService(client);

  const body = buildRoundTripSearchBody(25, 30, {
    origin: 'PNQ',
    destination: 'DEL',
    maxStops: 2,
    fareType: 'NORMAL',
  });
  body.travellers = { adults: 2, children: 0, infants: 0 };

  console.log('RT search PNQ↔DEL', body.itinerary);
  const rt = await flight.searchRoundTripUntilComplete(body);
  console.log('search', rt.response?.status, 'ids', rt.searchIds);
  if (!rt.searchIds || rt.searchIds.length < 2) {
    console.log('FAIL no RT searchIds', brief(rt.response?.data, 500));
    process.exit(2);
  }
  const ids = rt.searchIds.slice(0, 2);
  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  const ctx =
    pricing.data?.bookingReference ||
    pricing.data?.bookingContext ||
    pricing.data?.encryptedBookingReference ||
    details.data?.bookingReference ||
    details.data?.bookingContext;
  const priceId = pricing.data?.priceId || pricing.data?.pricing?.priceId || details.data?.pricing?.priceId;
  console.log('details/pricing', details.status, pricing.status, 'ctx', !!ctx, 'priceId', !!priceId);
  if (!ctx) {
    console.log('FAIL no ctx', brief(pricing.data, 500));
    process.exit(2);
  }

  const issueBody = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: ctx,
    searchIds: ids,
    journeyType: 'ROUND_TRIP',
    timezone: 'Asia/Calcutta',
    data: {
      priceId,
      passportType: 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: `sim.rt.confirmed.${Date.now()}@travelvip.ai`,
        mobile: '9921862715',
        countryCode: '+91',
      },
      passengers: [
        {
          paxId: 'PAX1',
          type: 'adult',
          isLead: true,
          profile: {
            title: 'Mr',
            firstName: 'Rohan',
            lastName: 'Confirmed',
            gender: 'Male',
            dob: '1992-05-15',
            nationality: 'IN',
          },
          city: { cityCode: 'Pune', cityName: 'Pune' },
          passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
          ssr: { baggage: [], meals: [], seats: [] },
        },
        {
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
          city: { cityCode: 'Pune', cityName: 'Pune' },
          passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
          ssr: { baggage: [], meals: [], seats: [] },
        },
      ],
    },
  };

  const issue = await client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
    body: issueBody,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingRefId;
  console.log('issue', issue.status, 'br', br, brief(issue.data, 300));
  if (!br) {
    console.log('FAIL issue', brief(issue.data, 600));
    process.exit(2);
  }

  let status = null;
  for (let i = 0; i < 20; i++) {
    const st = await flight.getBookingStatus(br);
    status = String(st.data?.status || '');
    console.log(`poll ${i + 1}: ${status}`);
    if (/confirm|fail|cancel|inprogress/i.test(status)) break;
    await sleep(3000);
  }

  const out = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    route: 'PNQ-DEL-PNQ',
    pax: 2,
    lastName: 'Confirmed',
    br,
    status,
    issueHttp: issue.status,
  };
  const outPath = path.join(
    'd:/Travel VIP API Automation/travel-apis/flight/reports/cancel-suite-2026-11-19',
    'sim-rt-confirmed.json',
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\nRESULT', JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
