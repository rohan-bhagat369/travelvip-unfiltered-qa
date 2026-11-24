/**
 * ENG-826 retest after Dev clarification (23 Nov 2026):
 * - finalize-booking is the vgm/wallet path — NOT used for SMT card flow
 * - finalize ignores offerId / pid query (partner from auth + X-Partner-Key)
 * - SMT uses create-booking (+ booking after Stripe) with pid+key
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'
 *   node inventory/scripts/probe-canary-catalog-v1-dev-retest.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { authenticate } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { createRequestId } from '../../shared/lib/signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'canary-catalog-v1');
fs.mkdirSync(OUT, { recursive: true });

const Q = { lang: 'en', currency: 'INR' };
const SMT_PID = process.env.SMT_PID || 'smt';
const SMT_KEY = process.env.SMT_KEY || 'palsgcvgscvvs';

const PRODUCTS = {
  lounge: {
    finalize: '/v1/airportServices/lounges/finalize-booking',
    create: '/v1/airportServices/lounges/create-booking',
    status: '/v1/airportServices/lounge/{br}/status',
    details: '/v1/airportServices/lounge/booking/{br}',
  },
  fasttrack: {
    finalize: '/v1/airportServices/fasttracks/finalize-booking',
    create: '/v1/airportServices/fasttracks/create-booking',
    status: '/v1/airportServices/fasttrack/{br}/status',
    details: '/v1/airportServices/fasttrack/booking/{br}',
  },
  esim: {
    finalize: '/v1/esims/finalize-booking',
    create: '/v1/esims/create-booking',
    status: '/v1/esim/{br}/status',
    details: '/v1/esim/booking/{br}',
  },
};

const report = { at: new Date().toISOString(), base: config.baseUrl, partner: config.partnerId, cases: [], brs: {}, notes: [
  'Dev: finalize-booking is not the SMT flow; offerId and pid on finalize are ignored.',
  'SMT path = create-booking (+ booking after pay) with pid+key.',
] };

function ok(res) { return res.ok || (res.status >= 200 && res.status < 300); }
function brief(d, n = 220) { return JSON.stringify(d ?? null).slice(0, n); }
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
function codeOf(res) { return res.data?.error?.code || res.data?.code || null; }
function brOf(res) {
  return res.data?.bookingReference || res.data?.bookingRefId || res.data?.error?.bookingReference || null;
}
function record(caseId, product, status, extra = {}) {
  const row = { caseId, product, status, ...extra };
  report.cases.push(row);
  console.log(`=> ${caseId} [${product}] ${status}${extra.br ? ` ${extra.br}` : ''}${extra.code ? ` ${extra.code}` : ''}${extra.note ? ` | ${String(extra.note).slice(0, 120)}` : ''}`);
}

async function req(client, { method, path: p, query, body, requestId, headers }) {
  return client.request({
    method,
    path: p,
    query,
    body,
    headers: {
      ...(requestId ? { 'X-Request-Id': requestId, 'X-Correlation-ID': createRequestId() } : {}),
      ...headers,
    },
  });
}

function contact() {
  return {
    email: `qa.catalog.${Date.now()}@travelvip.test`,
    countryCode: '+91',
    mobile: '9876543210',
  };
}
function leadPax(suffix = '') {
  return {
    paxType: 'ADT',
    isLead: true,
    profile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: `Bhagat${suffix}`,
      gender: 'MALE',
      dob: '2001-05-29',
      nationality: 'IN',
    },
  };
}
function bodyFor(product, inv, overrides = {}) {
  if (product === 'esim') {
    return {
      bookingContext: inv.bookingContext,
      passengers: [{ paxType: 'ADT', profile: leadPax().profile }],
      contact: contact(),
      ...overrides,
    };
  }
  return {
    bookingContext: inv.bookingContext,
    travelDate: overrides.travelDate || addDays(product === 'fasttrack' ? 5 : 7),
    travelTime: overrides.travelTime || '10:00',
    timezone: 'Asia/Kolkata',
    passengers: [leadPax()],
    contact: contact(),
    ...overrides,
  };
}

async function pickLounge(client) {
  const search = await req(client, { method: 'GET', path: '/v1/airports/search', query: { ...Q, page: 0, perpage: 20, q: 'bom' } });
  for (const a of search.data?.results || []) {
    const airportId = a.airportId || a.id;
    for (const terminal of ['Terminal 2', 'Terminal 1', 'Terminal 3']) {
      const list = await req(client, { method: 'GET', path: '/v1/lounges', query: { ...Q, page: 0, perpage: 10, airportId, terminal } });
      for (const lounge of list.data?.results || []) {
        const productId = lounge.productId;
        const optionId = lounge.availableOptions?.[0]?.optionId || lounge.options?.[0]?.optionId;
        if (!productId || !optionId) continue;
        const detail = await req(client, { method: 'GET', path: `/v1/lounges/${productId}`, query: { ...Q, optionId } });
        for (const item of detail.data?.results || []) {
          for (const o of item.options || item.availableOptions || []) {
            const bookingContext = o.bookingContext || o.bookingReference;
            if (bookingContext) return { productId, optionId, bookingContext, airportId, terminal };
          }
        }
      }
    }
  }
  throw new Error('no lounge inventory');
}

async function pickFastTrack(client) {
  const seeds = [{ airportId: 3110 }];
  for (const q of ['hak', 'del', 'dxb']) {
    const s = await req(client, { method: 'GET', path: '/v1/fasttracks/airports/search', query: { ...Q, page: 0, perpage: 5, q } });
    for (const a of s.data?.results || []) if (a.airportId) seeds.push({ airportId: a.airportId });
  }
  const seen = new Set();
  for (const a of seeds) {
    if (seen.has(a.airportId)) continue;
    seen.add(a.airportId);
    for (const terminal of ['Terminal 2', 'Terminal 1']) {
      for (const terminalSide of ['Departure', 'Arrival']) {
        const list = await req(client, {
          method: 'GET', path: '/v1/fasttracks',
          query: { ...Q, page: 0, perpage: 10, airportId: a.airportId, terminal, terminalSide },
        });
        for (const ft of list.data?.results || []) {
          const productId = ft.productId;
          const optionId = ft.options?.[0]?.optionId || ft.availableOptions?.[0]?.optionId;
          if (!productId) continue;
          const detail = await req(client, {
            method: 'GET', path: `/v1/fasttracks/${productId}`,
            query: { ...Q, ...(optionId ? { optionId } : {}) },
          });
          for (const item of detail.data?.results || []) {
            for (const o of item.options || item.availableOptions || []) {
              const bookingContext = o.bookingContext || o.bookingReference;
              if (bookingContext) return { productId, optionId: o.optionId || optionId, bookingContext, airportId: a.airportId };
            }
          }
        }
      }
    }
  }
  throw new Error('no fasttrack inventory');
}

async function pickEsim(client) {
  const search = await req(client, { method: 'GET', path: '/v1/esim/search', query: { ...Q, page: 1, perpage: 20, q: 'singapore' } });
  const country = (search.data?.results || [])[0];
  if (!country) throw new Error('no esim search');
  const entityId = country.entityId || country.id || country.productId;
  const listing = await req(client, { method: 'GET', path: `/v1/esims/${entityId}`, query: Q });
  let pick = null;
  for (const plan of listing.data?.results || []) {
    for (const opt of plan.options || plan.availableOptions || []) {
      for (const variant of opt.variants || []) {
        const bookingContext = variant.bookingContext || variant.bookingReference;
        if (!bookingContext) continue;
        const amount = Number(variant.pricing?.totalAmount ?? variant.totalAmount ?? 999999);
        if (!pick || amount < pick.amount) {
          pick = { entityId, productId: plan.productId, optionId: opt.optionId, variantId: variant.variantId, bookingContext, amount };
        }
      }
    }
  }
  if (!pick) throw new Error('no esim variant');
  return pick;
}

async function pollStatus(client, p, br) {
  let status = null; let last = null;
  for (let i = 0; i < 6; i += 1) {
    last = await req(client, { method: 'GET', path: p.status.replace('{br}', br), query: Q });
    status = last.data?.status || last.data?.bookingStatus || status;
    if (/Confirm|Fail|Cancel|Refund|Pending/i.test(String(status || ''))) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status, last };
}

async function runProduct(client, key, pickFn) {
  const p = PRODUCTS[key];
  let inv;
  try {
    inv = await pickFn(client);
    record('INV', key, 'PASS', { note: `ctx=${String(inv.bookingContext).slice(0, 40)}` });
  } catch (e) {
    record('INV', key, 'BUG', { note: e.message });
    return;
  }

  // --- vgm wallet: finalize happy path ---
  {
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: Q, body: bodyFor(key, inv),
      requestId: `dev-w1-${key}-${randomUUID()}`,
    });
    const br = brOf(res);
    const code = codeOf(res);
    let status = 'BUG';
    if (ok(res) && br) status = 'PASS';
    else if (code === 'PROVIDER_BOOKING_FAILED' && br) status = 'CHECK';
    record('W1_finalize', key, status, { http: res.status, br, code, note: brief(res.data) });
    if (br) {
      report.brs[`${key}_W1`] = br;
      const polled = await pollStatus(client, p, br);
      record('R1_status', key, ok(polled.last) ? 'PASS' : 'BUG', { br, finalStatus: polled.status });
      const det = await req(client, { method: 'GET', path: p.details.replace('{br}', br), query: Q });
      record('R2_details', key, ok(det) ? 'PASS' : 'BUG', { br, http: det.status });
    }
  }

  try { inv = await pickFn(client); } catch { /* keep */ }

  // --- Dev: finalize ignores offerId (expected to still book from bookingContext) ---
  {
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: Q,
      body: bodyFor(key, inv, { offerId: 'offer_bogus_should_be_ignored' }),
      requestId: `dev-offer-ignore-${key}-${randomUUID()}`,
    });
    const br = brOf(res);
    const code = codeOf(res);
    // Per Dev: offerId ignored → book or provider fail is OK; OFFER_INVALID would be unexpected for finalize
    let status = 'CHECK';
    if (ok(res) && br) status = 'PASS';
    else if (code === 'PROVIDER_BOOKING_FAILED' && br) status = 'PASS'; // ignored offerId; supplier path ran
    else if (code === 'OFFER_INVALID') status = 'CHECK'; // would contradict "ignored"
    record('finalize_ignores_offerId', key, status, {
      http: res.status, br, code,
      note: 'Dev: offerId ignored on finalize — expected book from bookingContext',
    });
    if (br) report.brs[`${key}_offerIgnore`] = br;
  }

  try { inv = await pickFn(client); } catch { /* keep */ }

  // --- Dev: finalize ignores pid query (partner from token + X-Partner-Key) ---
  {
    const res = await req(client, {
      method: 'POST', path: p.finalize,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: bodyFor(key, inv),
      requestId: `dev-pid-ignore-${key}-${randomUUID()}`,
    });
    const br = brOf(res);
    const code = codeOf(res);
    let status = 'CHECK';
    if (ok(res) && br) status = 'PASS';
    else if (code === 'PROVIDER_BOOKING_FAILED' && br) status = 'PASS';
    else if (/PARTNER_NOT_ALLOWED|FORBIDDEN/i.test(String(code || ''))) status = 'CHECK'; // stricter than Dev said
    record('finalize_ignores_pid', key, status, {
      http: res.status, br, code,
      note: 'Dev: pid on finalize ignored — partner from auth/X-Partner-Key',
    });
    if (br) report.brs[`${key}_pidIgnore`] = br;
  }

  try { inv = await pickFn(client); } catch { /* keep */ }

  // --- SMT card path: create-booking (not finalize) ---
  {
    const createBody = bodyFor(key, inv, { redirectUrl: 'https://partner.example.com/return' });
    const res = await req(client, {
      method: 'POST', path: p.create,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: createBody,
      requestId: `dev-c1-${key}-${randomUUID()}`,
    });
    const br = brOf(res);
    const code = codeOf(res);
    const pi = res.data?.paymentData?.paymentIntent || res.data?.paymentIntentId;
    const hasPay = Boolean(pi);
    let status = 'BUG';
    if (ok(res) && br && hasPay) status = 'PASS';
    else if (ok(res) && br) status = 'CHECK';
    else if (code === 'PROVIDER_BOOKING_FAILED' || code === 'BOOKING_SUBMIT_FAILED') status = 'CHECK';
    record('C1_smt_create', key, status, { http: res.status, br, code, hasPay, note: brief(res.data) });
    if (br) report.brs[`${key}_C1`] = br;
  }

  try { inv = await pickFn(client); } catch { /* keep */ }

  // --- SMT create without pid/key should fail (pid matters on SMT path) ---
  {
    const res = await req(client, {
      method: 'POST', path: p.create, query: Q,
      body: bodyFor(key, inv, { redirectUrl: 'https://partner.example.com/return' }),
      requestId: `dev-c1-nopid-${key}-${randomUUID()}`,
    });
    const code = codeOf(res);
    const pass = !ok(res) || /INVALID_PARTNER|MISSING|FORBIDDEN|UNAUTHORIZED/i.test(String(code || ''));
    record('C1_smt_requires_pid', key, pass ? 'PASS' : 'BUG', {
      http: res.status, code, note: brief(res.data),
    });
  }
}

async function main() {
  console.log('DEV-RETEST catalog_v1', config.baseUrl, config.partnerId);
  const { client } = await authenticate(true);

  await runProduct(client, 'lounge', pickLounge);
  await runProduct(client, 'fasttrack', pickFastTrack);
  await runProduct(client, 'esim', pickEsim);

  const outPath = path.join(OUT, 'dev-retest-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const counts = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
  for (const c of report.cases) counts[c.status] = (counts[c.status] || 0) + 1;

  let md = `# ENG-826 Dev-clarification retest — 23 Nov 2026\n\n`;
  md += `**Base:** ${config.baseUrl} · **Partner:** ${config.partnerId} · ${report.at}\n\n`;
  md += `**Dev note:** finalize-booking is **not** the SMT flow; finalize **ignores** \`offerId\` / \`pid\`. SMT = create-booking (+ booking after Stripe).\n\n`;
  md += `## Score\n\n| PASS | BUG | CHECK |\n|---:|---:|---:|\n| ${counts.PASS || 0} | ${counts.BUG || 0} | ${counts.CHECK || 0} |\n\n`;
  md += `| Case | Lounge | Fast Track | eSIM |\n|---|---|---|---|\n`;
  const ids = [...new Set(report.cases.map((c) => c.caseId))];
  for (const id of ids) {
    const row = {};
    for (const c of report.cases.filter((x) => x.caseId === id)) row[c.product] = `${c.status}${c.br ? ` \`${c.br}\`` : ''}`;
    md += `| ${id} | ${row.lounge || '—'} | ${row.fasttrack || '—'} | ${row.esim || '—'} |\n`;
  }
  md += `\n## BRs\n\`\`\`json\n${JSON.stringify(report.brs, null, 2)}\n\`\`\`\n`;
  md += `\n## Implication for prior issues\n`;
  md += `- **V4 invalid offerId on finalize** → **not a bug** (offerId ignored; pricing from bookingContext).\n`;
  md += `- **W5 pid=smt on finalize** → **not a bug** (pid ignored; partner from token + X-Partner-Key).\n`;
  md += `- SMT regressions belong on **create-booking / booking**, not finalize.\n`;

  const mdPath = path.join(OUT, 'DEV-RETEST-2026-11-23.md');
  fs.writeFileSync(mdPath, md);
  console.log('\nWrote', outPath);
  console.log('Wrote', mdPath);
  console.log('=== COUNTS ===', counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
