/**
 * G3 reverify: RT 2ADT / 2-PNR Confirmed on ak-api for Nexus dashboard online cancel.
 * lastName=Confirmed · step logs · short search polls · stop on Confirmed|Inprogress|Failed.
 *
 *   node travel-apis/flight/scripts/_tmp-book-g3-reverify-rt.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports', 'cancel-bundle-2026-11-20');
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadSecrets() {
  for (const p of [
    path.join(process.cwd(), '.env'),
    path.join(
      process.env.USERPROFILE || '',
      '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
    ),
  ]) {
    if (!fs.existsSync(p)) continue;
    if (p.endsWith('.env')) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m || process.env[m[1]]) continue;
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } else {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const vars = {};
      for (const v of j.environments?.[0]?.variables || []) vars[v.name] = v.value ?? v.initialValue ?? '';
      if (!process.env.PARTNER_SECRET) process.env.PARTNER_SECRET = vars.partner_secret;
      if (!process.env.SIGNING_KEY) process.env.SIGNING_KEY = vars.signing_key;
      if (!process.env.PARTNER_ID) process.env.PARTNER_ID = vars.partner_id || 'vgm';
      if (!process.env.TIER_ID) process.env.TIER_ID = vars.tier_id || '10546901';
    }
  }
}
loadSecrets();
process.env.BASE_URL = 'https://ak-api.travelvip.ai';
process.env.ALLOW_BOOK = 'true';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.TIER_ID = process.env.TIER_ID || '10546901';

function opts(data, dir) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)?.options) || [];
}

function collectPnrs(st) {
  const raw = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const [k, v] of Object.entries(o)) {
      if (/pnr/i.test(k) && typeof v === 'string' && v.trim()) raw.push(v.trim());
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(st);
  return [...new Set(raw)];
}

async function searchRtPair(flight, body, maxPoll = 12) {
  console.log('  search onward…', body.itinerary);
  let search;
  for (let i = 0; i < maxPoll; i++) {
    search = await flight.search(body);
    const state = search.data?.progress?.state;
    const onward = extractOnwardSearchId(search.data) || opts(search.data, 'ONWARD')[0]?.searchId;
    console.log(`  onward poll ${i + 1}: http=${search.status} state=${state} onward=${onward || '-'}`);
    if (onward) {
      const refined = { ...body, selection: { selectedSearchIds: [onward] } };
      for (let j = 0; j < maxPoll; j++) {
        const retRes = await flight.search(refined);
        const retState = retRes.data?.progress?.state;
        const ret =
          extractReturnSearchId(retRes.data) ||
          opts(retRes.data, 'RETURN').find((o) => o.searchId !== onward)?.searchId;
        console.log(`  return poll ${j + 1}: http=${retRes.status} state=${retState} return=${ret || '-'}`);
        if (ret) return [onward, ret];
        if (/COMPLETE/i.test(String(retState)) && !ret) break;
        await sleep(2500);
      }
      throw new Error('no return searchId');
    }
    if (/COMPLETE/i.test(String(state)) && !onward) break;
    await sleep(2500);
  }
  throw new Error('no onward searchId');
}

async function tryOne(client, flight, { origin, destination, onwardDays, returnDays, fareType }) {
  console.log(`\n## RT 2ADT ${origin}-${destination} days=${onwardDays}/${returnDays} fare=${fareType} lastName=Confirmed`);
  const body = buildRoundTripSearchBody(onwardDays, returnDays, {
    origin,
    destination,
    maxStops: 2,
    fareType,
  });
  body.travellers = { adults: 2, children: 0, infants: 0 };

  const ids = await searchRtPair(flight, body);
  console.log('  searchIds', ids);

  console.log('  pricing…');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  const ctx = pricing.data?.bookingContext || pricing.data?.bookingReference;
  const priceId = pricing.data?.priceId;
  const money = {
    totalAmount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
    baseFare: pricing.data?.pricing?.baseFare,
    taxes: pricing.data?.pricing?.taxes,
    convenienceFee: pricing.data?.pricing?.convenienceFee,
  };
  console.log('  pricing', pricing.status, 'ctx', !!ctx, 'priceId', !!priceId, money);
  if (!ctx || !priceId) throw new Error('pricing missing ctx/priceId');

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
  payload.data.contact.email = `g3.reverify.${Date.now()}@travelvip.ai`;
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

  console.log('  issue-ticket…');
  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: 'vgm',
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
  console.log('  issue', issue.status, 'br', br, issue.data?.error?.code || '');
  if (!br) throw new Error(`issue failed: ${issue.data?.error?.code || issue.status}`);

  let status = null;
  let lastSt = null;
  for (let i = 0; i < 24; i++) {
    lastSt = await flight.getBookingStatus(br);
    status = String(lastSt.data?.status || '');
    console.log(`  poll ${i + 1}: ${status}`);
    if (isTerminalBookingStatus(status) || /confirm|fail|cancel|inprogress/i.test(status)) break;
    await sleep(3000);
  }

  const pnrs = collectPnrs(lastSt?.data);
  return {
    br,
    status,
    route: `${origin}-${destination}-${origin}`,
    pax: 2,
    lastName: 'Confirmed',
    fareType,
    days: [onwardDays, returnDays],
    money,
    pnrs,
    uniquePnrs: [...new Set(pnrs)],
  };
}

async function main() {
  console.log('BASE', process.env.BASE_URL, 'partner', process.env.PARTNER_ID);
  const { client } = await authenticate(true);
  client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
  const flight = new FlightService(client);

  // Fresh dates (avoid 48/55 Inprogress + 72/79 hung search)
  const attempts = [
    { origin: 'DEL', destination: 'PNQ', onwardDays: 40, returnDays: 47, fareType: 'NORMAL' },
    { origin: 'DEL', destination: 'PNQ', onwardDays: 42, returnDays: 49, fareType: 'CORPORATE' },
    { origin: 'PNQ', destination: 'DEL', onwardDays: 44, returnDays: 51, fareType: 'NORMAL' },
  ];

  const failures = [];
  for (const a of attempts) {
    try {
      const result = await tryOne(client, flight, a);
      const out = {
        at: new Date().toISOString(),
        base: process.env.BASE_URL,
        partner: process.env.PARTNER_ID,
        purpose: 'G3 dashboard reverify — RT online cancel both PNRs; convenience once per booking',
        originalBugBr: 'BR1795177933483097',
        nexus: 'https://dev-nexus.travelvip.ai/',
        fixture: result,
        failures,
      };
      const outPath = path.join(OUT_DIR, 'g3-reverify-fixture.json');
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
      console.log('\n=== RESULT ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('Wrote', outPath);
      if (/confirm/i.test(String(result.status)) && result.uniquePnrs.length >= 2) {
        console.log(`\nNexus: open ${result.br} → online cancel both PNRs → check convenience fee not duplicated.`);
        return;
      }
      console.log('  not Confirmed 2-PNR — trying next dates…');
      failures.push(result);
    } catch (e) {
      console.log('  FAIL', e.message);
      failures.push({ attempt: a, error: e.message });
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'g3-reverify-fixture-FAILED.json'),
    JSON.stringify({ at: new Date().toISOString(), failures }, null, 2),
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
