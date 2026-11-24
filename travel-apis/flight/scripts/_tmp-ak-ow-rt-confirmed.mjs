/**
 * One OW + one RT on ak-api. Surname Confirmed. No date/name retry loop.
 * OW: PNQ→DEL · RT: PNQ↔DXB (PNQ↔DEL RT needs meals)
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, buildRoundTripSearchBody, buildIssueTicketPayload } from '../src/helpers.js';
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

function brief(d, n = 320) {
  return JSON.stringify(d).slice(0, n);
}
function pickCtx(pricing, details) {
  return (
    pricing?.data?.bookingReference ||
    pricing?.data?.bookingContext ||
    pricing?.data?.encryptedBookingReference ||
    details?.data?.bookingReference ||
    details?.data?.bookingContext ||
    null
  );
}
function pickPriceId(pricing, details) {
  return pricing?.data?.priceId || pricing?.data?.pricing?.priceId || details?.data?.pricing?.priceId || null;
}
async function pollOnce(flight, br, max = 20) {
  let status = null;
  for (let i = 0; i < max; i++) {
    const st = await flight.getBookingStatus(br);
    status = String(st.data?.status || '');
    console.log(`  poll ${i + 1}: ${status}`);
    if (/confirm|fail|cancel|inprogress/i.test(status)) break;
    await sleep(3000);
  }
  return status;
}

async function main() {
  console.log('BASE', process.env.BASE_URL);
  const { client } = await authenticate(true);
  const flight = new FlightService(client);
  const out = { at: new Date().toISOString(), base: process.env.BASE_URL, ow: null, rt: null };

  // --- OW PNQ→DEL ---
  console.log('\n## OW PNQ→DEL lastName=Confirmed');
  {
    const body = buildOneWaySearchBody(26, { origin: 'PNQ', destination: 'DEL', maxStops: 2, fareType: 'NORMAL' });
    const search = await flight.searchUntilComplete(body);
    console.log('search', search.response?.status, search.searchId);
    if (!search.searchId) {
      out.ow = { ok: false, error: 'NO_SEARCH', sample: brief(search.response?.data) };
    } else {
      const details = await flight.getDetails(search.searchId);
      const pricing = await flight.getPricing(search.searchId);
      const ctx = pickCtx(pricing, details);
      const priceId = pickPriceId(pricing, details);
      console.log('pricing', pricing.status, !!ctx, !!priceId);
      const payload = buildIssueTicketPayload({
        bookingContext: ctx,
        priceId,
        searchIds: [search.searchId],
        journeyType: 'ONE_WAY',
        passengerProfile: { firstName: 'Rohan', lastName: 'Confirmed', gender: 'Male', dob: '1992-05-15' },
      });
      payload.data.passengers[0].profile.lastName = 'Confirmed';
      payload.data.passengers[0].profile.firstName = 'Rohan';
      payload.data.contact.email = `ak.ow.confirmed.${Date.now()}@travelvip.ai`;
      const issue = await client.request({
        method: 'POST',
        path: '/v1/flights/booking/issue-ticket',
        query: { lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingRefId;
      console.log('issue', issue.status, br, brief(issue.data));
      if (!br) {
        out.ow = { ok: false, error: issue.data?.error?.code || issue.status, sample: brief(issue.data, 500) };
      } else {
        const status = await pollOnce(flight, br);
        out.ow = { ok: true, br, status, route: 'PNQ-DEL', lastName: 'Confirmed' };
      }
    }
  }

  // --- RT PNQ↔DXB ---
  console.log('\n## RT PNQ↔DXB 2ADT lastName=Confirmed');
  {
    const body = buildRoundTripSearchBody(27, 32, { origin: 'PNQ', destination: 'DXB', maxStops: 2, fareType: 'NORMAL' });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    const rt = await flight.searchRoundTripUntilComplete(body);
    console.log('search', rt.response?.status, rt.searchIds);
    if (!rt.searchIds || rt.searchIds.length < 2) {
      out.rt = { ok: false, error: 'NO_RT_IDS', sample: brief(rt.response?.data) };
    } else {
      const ids = rt.searchIds.slice(0, 2);
      const details = await flight.getDetails(ids, 'ROUND_TRIP');
      const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
      const ctx = pickCtx(pricing, details);
      const priceId = pickPriceId(pricing, details);
      console.log('pricing', pricing.status, !!ctx, !!priceId);
      const mk = (id, first, lead) => ({
        paxId: id,
        type: 'adult',
        isLead: lead,
        profile: {
          title: 'Mr',
          firstName: first,
          lastName: 'Confirmed',
          gender: 'Male',
          dob: lead ? '1992-05-15' : '1990-03-10',
          nationality: 'IN',
        },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
        ssr: { baggage: [], meals: [], seats: [] },
      });
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
            email: `ak.rt.confirmed.${Date.now()}@travelvip.ai`,
            mobile: '9921862715',
            countryCode: '+91',
          },
          passengers: [mk('PAX1', 'Rohan', true), mk('PAX2', 'Amit', false)],
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
      console.log('issue', issue.status, br, brief(issue.data));
      if (!br) {
        out.rt = { ok: false, error: issue.data?.error?.code || issue.status, sample: brief(issue.data, 500) };
      } else {
        const status = await pollOnce(flight, br);
        out.rt = { ok: true, br, status, route: 'PNQ-DXB-PNQ', pax: 2, lastName: 'Confirmed' };
      }
    }
  }

  const outPath = path.join(
    'd:/Travel VIP API Automation/travel-apis/flight/reports/cancel-suite-2026-11-19',
    'ak-ow-rt-confirmed.json',
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
