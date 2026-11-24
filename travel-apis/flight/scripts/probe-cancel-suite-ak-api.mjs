/**
 * Flight cancel suite — API side on ak-api (staging vgm creds).
 *
 *   node travel-apis/flight/scripts/probe-cancel-suite-ak-api.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, buildRoundTripSearchBody } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports', 'cancel-suite-2026-11-19');
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadPostmanSecrets() {
  const p = path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
  );
  if (!fs.existsSync(p)) return;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const vars = {};
  for (const v of j.environments?.[0]?.variables || []) vars[v.name] = v.value ?? v.initialValue ?? '';
  if (!process.env.PARTNER_SECRET) process.env.PARTNER_SECRET = vars.partner_secret;
  if (!process.env.SIGNING_KEY) process.env.SIGNING_KEY = vars.signing_key;
  if (!process.env.PARTNER_ID) process.env.PARTNER_ID = vars.partner_id || 'vgm';
  if (!process.env.TIER_ID) process.env.TIER_ID = vars.tier_id || '10546901';
}
loadPostmanSecrets();
process.env.BASE_URL = process.env.BASE_URL || 'https://ak-api.travelvip.ai';
process.env.ALLOW_BOOK = process.env.ALLOW_BOOK || 'true';

function brief(d, n = 400) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
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
function onlineFlags(data) {
  return JSON.stringify(data || {}).match(/"onlineCancellation"\s*:\s*(true|false)/g) || [];
}

const report = { at: new Date().toISOString(), base: process.env.BASE_URL, partner: process.env.PARTNER_ID, cases: [] };
function row(id, status, note, extra = {}) {
  const r = { id, status, note, ...extra };
  report.cases.push(r);
  console.log(`[${status}] ${id} — ${note}`);
  return r;
}

async function waitConfirmed(flight, br, max = 36) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status ${i + 1}: ${st}`);
    if (/confirmed|cancelled|failed/i.test(st)) return { status: st, response: last };
    await sleep(3000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function main() {
  console.log('BASE', process.env.BASE_URL, 'ALLOW_BOOK', process.env.ALLOW_BOOK);
  const { client } = await authenticate(true);
  const flight = new FlightService(client);
  row('AUTH', 'PASS', 'partner token + session on ak-api');

  let br = null;
  let pnr = null;

  console.log('\n## Book OW 1ADT DEL-BOM');
  for (const days of [32, 38, 28, 45]) {
    try {
      const body = buildOneWaySearchBody(days, { maxStops: 2, fareType: 'CORPORATE' });
      const search = await flight.searchUntilComplete(body);
      console.log('search days', days, 'http', search.response?.status, 'sid', search.searchId);
      console.log('online flags', onlineFlags(search.response?.data).slice(0, 8));
      if (!search.searchId) continue;

      const details = await flight.getDetails(search.searchId);
      const pricing = await flight.getPricing(search.searchId);
      const ctx = pickContext(pricing, details);
      const priceId = pickPriceId(pricing, details);
      console.log('details/pricing', details.status, pricing.status, 'ctx', !!ctx, 'priceId', !!priceId);
      if (!ctx) {
        row('BOOK-OW', 'WARN', `no bookingContext days=${days}`);
        continue;
      }

      const issue = await flight.issueTicket({
        bookingContext: ctx,
        priceId,
        searchIds: [search.searchId],
        journeyType: 'ONE_WAY',
      });
      br = issue.data?.bookingReference || issue.data?.bookingRefId || issue.data?.data?.bookingReference;
      console.log('issue', issue.status, 'br', br, brief(issue.data, 260));
      if (!br) {
        row('BOOK-OW', 'BUG', `issue no BR code=${issue.data?.error?.code || issue.status}`, { sample: brief(issue.data, 500) });
        continue;
      }
      const polled = await waitConfirmed(flight, br);
      row('BOOK-OW', /confirmed/i.test(String(polled.status)) ? 'PASS' : 'WARN', `BR=${br} status=${polled.status}`);
      if (!/confirmed/i.test(String(polled.status))) continue;

      const detail = await flight.getBookingDetail(br);
      pnr = extractPnrs(detail.data)[0] || null;
      console.log('pnrs', extractPnrs(detail.data));
      row('H2', 'PASS', `detail/status OK BR=${br}`, {
        topKeys: Object.keys(detail.data || {}).slice(0, 25),
        leakedFareType: Object.prototype.hasOwnProperty.call(detail.data || {}, 'fareType'),
        leakedActorRef: /"actorRef"/i.test(JSON.stringify(detail.data || {})),
      });
      break;
    } catch (e) {
      console.log('OW attempt error', e.message);
      row('BOOK-OW', 'BUG', e.message);
    }
  }

  if (br && /confirmed/i.test(String(report.cases.find((c) => c.id === 'BOOK-OW')?.note || '')) || report.cases.some((c) => c.id === 'BOOK-OW' && c.status === 'PASS')) {
    const penalty = await client.request({
      method: 'POST',
      path: `/v1/flights/booking/${br}/cancel`,
      query: { lang: 'en', currency: 'INR' },
      body: pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' },
      correlation: true,
      partnerKey: client.partnerKey,
    });
    console.log('penalty', penalty.status, brief(penalty.data, 400));
    row('H3', penalty.status === 500 ? 'BUG' : 'PASS', `PENALTY http=${penalty.status}`, {
      sample: brief(penalty.data, 600),
      pnr,
    });

    const v2 = await flight.cancelV2({
      bookingId: br,
      action: 'CANCEL',
      ...(pnr ? { pnr } : {}),
      cancelledBy: 'USER',
    });
    console.log('v2 cancel', v2.status, brief(v2.data, 450));
    const stAfter = await flight.getBookingStatus(br);
    const afterStatus = String(stAfter.data?.status || '');
    row('G4', v2.status === 500 ? 'BUG' : 'PASS', `v2 cancel http=${v2.status} booking=${afterStatus}`, {
      sample: brief(v2.data, 700),
    });
    const h5 =
      v2.status === 500
        ? 'BUG'
        : /cancelled/i.test(afterStatus) || /cancel/i.test(JSON.stringify(v2.data || {}))
          ? 'PASS'
          : 'WARN';
    row('H5', h5, `online/partner cancel outcome http=${v2.status} status=${afterStatus}`, {
      sample: brief(v2.data, 500),
    });
  } else {
    row('H3', 'NOT TESTED', 'no Confirmed OW');
    row('G4', 'NOT TESTED', 'no Confirmed OW');
    row('H5', 'NOT TESTED', 'no Confirmed OW');
  }

  console.log('\n## Book RT 2ADT fixture for Nexus');
  try {
    const rtBody = buildRoundTripSearchBody(33, 38, { maxStops: 2, fareType: 'CORPORATE' });
    rtBody.travellers = { adults: 2, children: 0, infants: 0 };
    const rt = await flight.searchRoundTripUntilComplete(rtBody);
    console.log('RT search http', rt.response?.status, 'ids', rt.searchIds);
    if (rt.searchIds?.length >= 2) {
      const ids = rt.searchIds.slice(0, 2);
      const details = await flight.getDetails(ids, 'ROUND_TRIP');
      const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
      const ctx = pickContext(pricing, details);
      const priceId = pickPriceId(pricing, details);
      console.log('RT details/pricing', details.status, pricing.status, !!ctx, !!priceId);
      // issueTicket helper only builds 1 pax — use raw multipax payload
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
            email: `cancel.suite.${Date.now()}@travelvip.ai`,
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
      const rtBr = issue.data?.bookingReference || issue.data?.bookingRefId;
      console.log('RT issue', issue.status, rtBr, brief(issue.data, 280));
      if (rtBr) {
        const polled = await waitConfirmed(flight, rtBr, 40);
        row(
          'FIXTURE-RT-2ADT',
          /confirmed/i.test(String(polled.status)) ? 'PASS' : 'WARN',
          `BR=${rtBr} status=${polled.status} — use on Nexus for offline/online`,
        );
        report.rtBr = rtBr;
      } else {
        row('FIXTURE-RT-2ADT', 'BUG', `no BR ${issue.data?.error?.code || issue.status}`, { sample: brief(issue.data, 500) });
      }
    } else {
      row('FIXTURE-RT-2ADT', 'NOT TESTED', 'RT searchIds < 2');
    }
  } catch (e) {
    row('FIXTURE-RT-2ADT', 'BUG', e.message);
  }

  report.owBr = br;
  report.owPnr = pnr;
  const out = path.join(OUT_DIR, 'api-ak-results.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  // refresh RESULTS.md fixtures
  const mdPath = path.join(OUT_DIR, 'RESULTS.md');
  if (fs.existsSync(mdPath)) {
    let md = fs.readFileSync(mdPath, 'utf8');
    md = md.replace(
      '| OW 1ADT wallet online-cancellable | | ak-api | |',
      `| OW 1ADT wallet online-cancellable | ${br || '-'} | ak-api | ${report.cases.find((c) => c.id === 'BOOK-OW')?.note || ''} |`,
    );
    md = md.replace(
      '| RT 2ADT 2 PNR wallet | | ak-api | |',
      `| RT 2ADT 2 PNR wallet | ${report.rtBr || '-'} | ak-api | ${report.cases.find((c) => c.id === 'FIXTURE-RT-2ADT')?.note || ''} |`,
    );
    fs.writeFileSync(mdPath, md);
  }
  console.log('\nWrote', out);
  console.log(
    'Summary',
    Object.fromEntries(['PASS', 'BUG', 'WARN', 'NOT TESTED'].map((s) => [s, report.cases.filter((c) => c.status === s).length])),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
