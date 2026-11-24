/**
 * W7 — wallet disabled for partner (vgm finalize should 4xx, not book).
 *
 *   $env:BASE_URL='https://gamma-api.travelvip.ai'
 *   $env:LOUNGE_PRODUCT_ID='ol0oanfxamjcbjhkodvy'
 *   node inventory/scripts/probe-gamma-w7-wallet-disabled.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { authenticate } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { createRequestId } from '../../shared/lib/signature.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'gamma-catalog-v1');
fs.mkdirSync(OUT, { recursive: true });

const Q = { lang: 'en', currency: 'INR' };
const PRODUCTS = {
  lounge: { finalize: '/v1/airportServices/lounges/finalize-booking' },
  fasttrack: { finalize: '/v1/airportServices/fasttracks/finalize-booking' },
  esim: { finalize: '/v1/esims/finalize-booking' },
};

const report = { at: new Date().toISOString(), base: config.baseUrl, partner: config.partnerId, cases: [] };

function ok(res) { return res.ok || (res.status >= 200 && res.status < 300); }
function codeOf(res) { return res?.data?.error?.code || res?.data?.code || null; }
function brOf(res) {
  const d = res?.data || {};
  return d.bookingRefId || d.bookingReferenceId || d.bookingReference
    || d.error?.bookingReference || d.error?.details?.bookingReference || null;
}
function brief(d, n = 400) { return JSON.stringify(d ?? null).slice(0, n); }
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
function record(caseId, product, status, extra = {}) {
  const row = { caseId, product, status, ...extra };
  report.cases.push(row);
  console.log(`=> ${caseId} [${product}] ${status}${extra.br ? ` ${extra.br}` : ''}${extra.code ? ` ${extra.code}` : ''}${extra.note ? ` | ${extra.note}` : ''}`);
  return row;
}

async function req(client, opts) {
  const requestId = opts.requestId || createRequestId();
  return client.request({
    ...opts,
    correlation: true,
    partnerKey: opts.partnerKey === undefined ? client.partnerKey : opts.partnerKey,
    extraHeaders: { 'X-Request-Id': requestId, ...(opts.extraHeaders || {}) },
  });
}

function contact() {
  return {
    email: `w7.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: config.flight?.contactMobile || '9876543210',
  };
}
function leadPax() {
  const suffix = Date.now().toString(36).replace(/[0-9]/g, 'x').slice(-5);
  return {
    paxType: 'ADT',
    isLead: true,
    profile: {
      title: 'Mr', firstName: 'Rohan', lastName: `Wseven${suffix}`,
      gender: 'MALE', dob: '2001-05-29', nationality: 'IN',
    },
  };
}
function bodyFor(product, inv) {
  if (product === 'esim') {
    return {
      bookingContext: inv.bookingContext,
      passengers: [{ paxType: 'ADT', profile: leadPax().profile }],
      contact: contact(),
    };
  }
  return {
    bookingContext: inv.bookingContext,
    travelDate: addDays(product === 'fasttrack' ? 5 : 7),
    travelTime: '10:00',
    timezone: 'Asia/Kolkata',
    passengers: [leadPax()],
    contact: contact(),
  };
}

async function pickLounge(client) {
  for (const productId of (process.env.LOUNGE_PRODUCT_ID || 'ol0oanfxamjcbjhkodvy').split(',').map((s) => s.trim()).filter(Boolean)) {
    const detail = await req(client, { method: 'GET', path: `/v1/lounges/${productId}`, query: Q });
    for (const item of detail.data?.results || []) {
      for (const o of item.options || item.availableOptions || []) {
        const bookingContext = o.bookingContext || o.bookingReference;
        if (bookingContext) return { productId, bookingContext };
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
              if (bookingContext) return { productId, bookingContext };
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
  for (const plan of listing.data?.results || []) {
    for (const opt of plan.options || plan.availableOptions || []) {
      for (const variant of opt.variants || []) {
        const bookingContext = variant.bookingContext || variant.bookingReference;
        if (bookingContext) return { entityId, bookingContext };
      }
    }
  }
  throw new Error('no esim variant');
}

function classifyW7(res) {
  const code = codeOf(res);
  const msg = JSON.stringify(res?.data || {});
  const rejected = !ok(res) && res.status >= 400;
  const walletish = /WALLET|DISABLED|NOT_ENABLED|PAYMENT_METHOD|FORBIDDEN|NOT_ALLOWED|FEATURE/i.test(String(code || '') + msg);
  if (ok(res) && brOf(res)) return { status: 'BUG', note: 'wallet finalize accepted while wallet should be disabled' };
  if (rejected && walletish) return { status: 'PASS', note: brief(res.data) };
  if (rejected) return { status: 'CHECK', note: `rejected but unexpected code: ${code || res.status} | ${brief(res.data)}` };
  return { status: 'CHECK', note: brief(res.data) };
}

async function main() {
  console.log(`W7 wallet-disabled probe ${config.baseUrl} ${config.partnerId}`);
  const { client } = await authenticate(true);

  const picks = {
    lounge: pickLounge,
    fasttrack: pickFastTrack,
    esim: pickEsim,
  };

  for (const [key, pickFn] of Object.entries(picks)) {
    let inv;
    try {
      inv = await pickFn(client);
    } catch (e) {
      record('W7', key, 'NOT TESTED', { note: e.message });
      continue;
    }
    const res = await req(client, {
      method: 'POST',
      path: PRODUCTS[key].finalize,
      query: Q,
      body: bodyFor(key, inv),
      requestId: `w7-${key}-${randomUUID()}`,
    });
    const { status, note } = classifyW7(res);
    record('W7', key, status, {
      http: res.status,
      br: brOf(res),
      code: codeOf(res),
      note,
    });
  }

  const outJson = path.join(OUT, 'w7-wallet-disabled-latest.json');
  const outMd = path.join(OUT, 'W7-WALLET-DISABLED.md');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  const counts = report.cases.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
  let md = `# W7 — wallet disabled (gamma)\n\n**Base:** ${report.base} · **Partner:** ${report.partner} · ${report.at}\n\n`;
  md += `| Case | Product | Status | HTTP | code | BR | Note |\n|---|---|---|---|---|---|---|\n`;
  for (const c of report.cases) {
    md += `| ${c.caseId} | ${c.product} | ${c.status} | ${c.http ?? ''} | ${c.code ?? ''} | ${c.br ?? ''} | ${(c.note || '').replace(/\|/g, '/').slice(0, 180)} |\n`;
  }
  md += `\n**Counts:** ${JSON.stringify(counts)}\n`;
  fs.writeFileSync(outMd, md);
  console.log('Wrote', outJson);
  console.log('Wrote', outMd);
  console.log('COUNTS', counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
