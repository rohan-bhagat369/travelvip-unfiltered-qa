/**
 * Book Confirmed sim fixtures on ak-api for Flight Cancellation Bundle QA (Nov 20).
 * Does NOT cancel — leave Confirmed for Nexus manual.
 *
 *   node travel-apis/flight/scripts/book-cancel-bundle-fixtures-ak-api.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, buildRoundTripSearchBody } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

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
// Always ak-api for this suite — do not inherit zeta/staging BASE_URL from .env
process.env.BASE_URL = 'https://ak-api.travelvip.ai';
process.env.ALLOW_BOOK = 'true';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.TIER_ID = process.env.TIER_ID || '10546901';

function pickContext(pricing, details) {
  return (
    pricing?.data?.bookingReference ||
    pricing?.data?.bookingContext ||
    pricing?.data?.encryptedBookingReference ||
    pricing?.data?.pricing?.bookingReference ||
    details?.data?.bookingReference ||
    details?.data?.bookingContext ||
    details?.data?.pricing?.bookingReference ||
    null
  );
}
function pickPriceId(pricing, details) {
  return (
    pricing?.data?.priceId ||
    pricing?.data?.pricing?.priceId ||
    pricing?.data?.pricingId ||
    details?.data?.pricing?.priceId ||
    details?.data?.priceId ||
    null
  );
}
function extractPnrs(detailData) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /pnr/i.test(k) && !v.startsWith('BR') && v.length <= 24) {
        for (const p of String(v).split('|').map((x) => x.trim()).filter(Boolean)) {
          if (!seen.has(p)) {
            seen.add(p);
            found.push(p);
          }
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return found;
}

async function waitConfirmed(flight, br, max = 40) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  poll ${i + 1}: ${st}`);
    if (/confirmed|cancelled|failed/i.test(st)) return { status: st, response: last };
    await sleep(3000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function bookOw(flight, label, { origin, destination, daysList }) {
  for (const days of daysList) {
    try {
      console.log(`\n## ${label} OW ${origin}-${destination} days=${days}`);
      const body = buildOneWaySearchBody(days, { origin, destination, maxStops: 2, fareType: 'CORPORATE' });
      const search = await flight.searchUntilComplete(body);
      if (!search.searchId) continue;
      const details = await flight.getDetails(search.searchId);
      const pricing = await flight.getPricing(search.searchId);
      const ctx = pickContext(pricing, details);
      const priceId = pickPriceId(pricing, details);
      if (!ctx) {
        console.log('  no ctx');
        continue;
      }
      const issue = await flight.issueTicket({
        bookingContext: ctx,
        priceId,
        searchIds: [search.searchId],
        journeyType: 'ONE_WAY',
      });
      const br = issue.data?.bookingReference || issue.data?.bookingRefId || issue.data?.data?.bookingReference;
      console.log('  issue', issue.status, br);
      if (!br) continue;
      const polled = await waitConfirmed(flight, br);
      if (!/confirmed/i.test(String(polled.status))) {
        console.log('  not confirmed', polled.status);
        continue;
      }
      const detail = await flight.getBookingDetail(br);
      const pnrs = extractPnrs(detail.data);
      return {
        label,
        type: 'OW',
        br,
        status: polled.status,
        route: `${origin}-${destination}`,
        pnrs,
        pax: 1,
      };
    } catch (e) {
      console.log('  OW err', e.message);
    }
  }
  return { label, type: 'OW', error: 'FAILED' };
}

async function bookRt2adt(client, flight, label, { origin, destination, onwardDays, returnDays }) {
  try {
    console.log(`\n## ${label} RT 2ADT ${origin}-${destination} ${onwardDays}/${returnDays}`);
    const rtBody = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin,
      destination,
      maxStops: 2,
      fareType: 'CORPORATE',
    });
    rtBody.travellers = { adults: 2, children: 0, infants: 0 };
    const rt = await flight.searchRoundTripUntilComplete(rtBody);
    if (!rt.searchIds || rt.searchIds.length < 2) {
      return { label, type: 'RT', error: 'searchIds < 2' };
    }
    const ids = rt.searchIds.slice(0, 2);
    const details = await flight.getDetails(ids, 'ROUND_TRIP');
    const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
    const ctx = pickContext(pricing, details);
    const priceId = pickPriceId(pricing, details);
    if (!ctx) return { label, type: 'RT', error: 'no ctx' };

    const stamp = Date.now();
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
          email: `cancel.bundle.${stamp}@travelvip.ai`,
          mobile: '9921862715',
          countryCode: '+91',
        },
        passengers: [1, 2].map((n) => ({
          paxId: `PAX${n}`,
          type: 'adult',
          isLead: n === 1,
          profile: {
            title: 'Mr',
            firstName: n === 1 ? 'Rohan' : 'Amit',
            lastName: 'Bhagat',
            gender: 'Male',
            dob: n === 1 ? '1992-05-15' : '1990-03-10',
            nationality: 'IN',
          },
          city: { cityCode: 'Pune', cityName: 'Pune' },
          passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
          ssr: { baggage: [], meals: [], seats: [] },
        })),
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
    console.log('  issue', issue.status, br);
    if (!br) return { label, type: 'RT', error: issue.data?.error?.code || String(issue.status) };
    const polled = await waitConfirmed(flight, br, 45);
    if (!/confirmed/i.test(String(polled.status))) {
      return { label, type: 'RT', br, status: polled.status, error: 'not confirmed' };
    }
    const detail = await flight.getBookingDetail(br);
    const pnrs = extractPnrs(detail.data);
    return {
      label,
      type: 'RT',
      br,
      status: polled.status,
      route: `${origin}-${destination}-${origin}`,
      pnrs,
      pnrCount: pnrs.length,
      pax: 2,
    };
  } catch (e) {
    return { label, type: 'RT', error: e.message };
  }
}

async function main() {
  console.log('BASE', process.env.BASE_URL, 'partner', process.env.PARTNER_ID);
  const { client } = await authenticate(true);
  const flight = new FlightService(client);

  const fixtures = [];

  // Simulation inventory: DEL↔PNQ only
  fixtures.push(
    await bookOw(flight, 'B1-online-OW', {
      origin: 'DEL',
      destination: 'PNQ',
      daysList: [30, 35, 40, 28, 45],
    }),
  );
  fixtures.push(
    await bookOw(flight, 'F-partner-API-OW', {
      origin: 'DEL',
      destination: 'PNQ',
      daysList: [32, 38, 42, 29, 47],
    }),
  );

  // B2 full online RT · C1/C2/D offline RT · B4 leave-open RT
  const rtSpecs = [
    { label: 'B2-online-RT', onwardDays: 33, returnDays: 40 },
    { label: 'C1-offline-RT', onwardDays: 34, returnDays: 41 },
    { label: 'B4-open-offline-RT', onwardDays: 36, returnDays: 43 },
  ];
  for (const spec of rtSpecs) {
    fixtures.push(
      await bookRt2adt(client, flight, spec.label, {
        origin: 'DEL',
        destination: 'PNQ',
        onwardDays: spec.onwardDays,
        returnDays: spec.returnDays,
      }),
    );
  }

  const out = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    partner: process.env.PARTNER_ID,
    tierId: process.env.TIER_ID,
    nexus: 'https://dev-nexus.travelvip.ai',
    fixtures,
  };
  const jsonPath = path.join(OUT_DIR, 'fixtures.json');
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  const lines = [
    '# Cancel Bundle fixtures — ak-api Confirmed',
    '',
    `**At:** ${out.at}`,
    `**API:** ${out.base} · partner ${out.partner}`,
    `**Nexus:** ${out.nexus}`,
    '',
    '| Label | Type | BR | Status | Route | PNRs | Nexus use |',
    '|-------|------|----|--------|-------|------|-----------|',
  ];
  for (const f of fixtures) {
    const use =
      f.label === 'B1-online-OW'
        ? 'B1 online cancel (all pax)'
        : f.label === 'F-partner-API-OW'
          ? 'Leave for agent F1–F3 / or spare OW'
          : f.label === 'B2-online-RT'
            ? 'B2 full online (all ticks)'
            : f.label === 'C1-offline-RT'
              ? 'C1/C2/D raise offline + settle'
              : f.label === 'B4-open-offline-RT'
                ? 'B4: raise offline 1 pax, leave OPEN, then try online'
                : '';
    lines.push(
      `| ${f.label} | ${f.type} | \`${f.br || '-'}\` | ${f.status || f.error || '-'} | ${f.route || '-'} | ${(f.pnrs || []).join(', ') || '-'} | ${use} |`,
    );
  }
  lines.push('');
  lines.push('Open booking: `https://dev-nexus.travelvip.ai/` → search BR.');
  const mdPath = path.join(OUT_DIR, 'NEXUS-HANDOFF.md');
  fs.writeFileSync(mdPath, lines.join('\n'));
  console.log('\nWrote', jsonPath);
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
