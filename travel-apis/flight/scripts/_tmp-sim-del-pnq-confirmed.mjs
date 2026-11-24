/**
 * Quick sim check: DEL↔PNQ with lastName Confirmed on ak-api.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, buildIssueTicketPayload } from '../src/helpers.js';
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
process.env.BASE_URL = 'https://ak-api.travelvip.ai';
process.env.PARTNER_ID = vars.partner_id || 'vgm';
process.env.PARTNER_SECRET = vars.partner_secret;
process.env.SIGNING_KEY = vars.signing_key;
process.env.TIER_ID = vars.tier_id || '10546901';
process.env.ALLOW_BOOK = 'true';

function brief(d, n = 350) {
  return JSON.stringify(d).slice(0, n);
}

async function waitStatus(flight, br, max = 24) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  poll ${i + 1}: ${st}`);
    if (/confirm|fail|cancel|inprogress/i.test(st)) return st;
    await sleep(2500);
  }
  return last?.data?.status;
}

async function tryRoute(flight, client, origin, destination, days) {
  console.log(`\n=== Search ${origin}→${destination} d+${days} ===`);
  const body = buildOneWaySearchBody(days, { origin, destination, maxStops: 2, fareType: 'NORMAL' });
  const search = await flight.searchUntilComplete(body);
  console.log('search http', search.response?.status, 'sid', search.searchId, 'err', search.response?.data?.error?.code);
  if (!search.searchId) {
    console.log('search sample', brief(search.response?.data, 400));
    return null;
  }
  const details = await flight.getDetails(search.searchId);
  const pricing = await flight.getPricing(search.searchId);
  const ctx =
    pricing.data?.bookingReference ||
    pricing.data?.bookingContext ||
    pricing.data?.encryptedBookingReference ||
    details.data?.bookingReference ||
    details.data?.bookingContext;
  const priceId = pricing.data?.priceId || pricing.data?.pricing?.priceId || details.data?.pricing?.priceId;
  console.log('details/pricing', details.status, pricing.status, 'ctx', !!ctx, 'priceId', !!priceId);
  if (!ctx) {
    console.log('pricing sample', brief(pricing.data, 400));
    return null;
  }

  const payload = buildIssueTicketPayload({
    bookingContext: ctx,
    priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      firstName: 'Rohan',
      lastName: 'Confirmed',
      gender: 'Male',
      dob: '1992-05-15',
    },
  });
  // force surname exactly Confirmed (sanitize may alter)
  payload.data.passengers[0].profile.lastName = 'Confirmed';
  payload.data.passengers[0].profile.firstName = 'Rohan';
  payload.data.contact.email = `sim.confirmed.${Date.now()}@travelvip.ai`;

  const issue = await client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingRefId;
  console.log('issue', issue.status, 'br', br, brief(issue.data, 280));
  if (!br) return { br: null, status: null, error: issue.data?.error?.code };
  const status = await waitStatus(flight, br);
  return { br, status, route: `${origin}-${destination}`, lastName: 'Confirmed' };
}

async function main() {
  console.log('BASE', process.env.BASE_URL);
  const { client } = await authenticate(true);
  const flight = new FlightService(client);

  const results = [];
  for (const [o, d] of [
    ['DEL', 'PNQ'],
    ['PNQ', 'DEL'],
  ]) {
    for (const days of [20, 28, 35]) {
      try {
        const r = await tryRoute(flight, client, o, d, days);
        results.push(r);
        if (r?.status && /confirm/i.test(String(r.status))) {
          console.log('\nSUCCESS', r);
          break;
        }
      } catch (e) {
        console.log('error', e.message);
        results.push({ error: e.message, route: `${o}-${d}` });
      }
    }
    if (results.some((r) => r?.status && /confirm/i.test(String(r.status)))) break;
  }

  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'reports',
    'cancel-suite-2026-11-19',
    'sim-del-pnq-confirmed.json',
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log('\nWrote', out);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
