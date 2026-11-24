/**
 * Run Lounge + Fast Track bookings on gamma using updated Apidog env/collection shapes.
 *   node inventory/scripts/probe-gamma-collection-bookings.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { authenticate } from '../../shared/lib/authService.js';
import { createRequestId } from '../../shared/lib/signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATT =
  'c:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a';
const OUT = path.join(__dirname, '..', 'reports', 'gamma-catalog-v1');
fs.mkdirSync(OUT, { recursive: true });

function loadEnv(file) {
  const j = JSON.parse(fs.readFileSync(path.join(ATT, file), 'utf8'));
  const vars = {};
  for (const v of j.environments?.[0]?.variables || []) vars[v.name] = v.value;
  return vars;
}

const vgm = loadEnv('B2B_Dev_vgm.json');
const smt = loadEnv('Web_Dev_smt.json');
const BASE = process.env.BASE_URL || vgm.base_url || 'https://gamma-api.travelvip.ai';
const Q = { lang: smt.lang || 'en', currency: smt.currency || 'INR' };
const SMT_PID = smt.partner_id || 'smt';
const SMT_KEY = smt.partner_key || 'palsgcvgscvvs';
const STRIPE_SK = process.env.STRIPE_SECRET_KEY || smt.stripe_username || '';

process.env.BASE_URL = BASE;
process.env.PARTNER_ID = vgm.partner_id || process.env.PARTNER_ID;
process.env.PARTNER_SECRET = vgm.partner_secret || process.env.PARTNER_SECRET;

const report = {
  at: new Date().toISOString(),
  base: BASE,
  envBaseUrl: { vgm: vgm.base_url, smt: smt.base_url },
  cases: [],
};

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}
function brOf(res) {
  return (
    res.data?.bookingReference ||
    res.data?.bookingRefId ||
    res.data?.bookingReferenceId ||
    res.data?.error?.bookingReference ||
    null
  );
}
function codeOf(res) {
  return res.data?.error?.code || null;
}
function brief(d, n = 240) {
  return JSON.stringify(d ?? null).slice(0, n);
}
function record(caseId, product, status, extra = {}) {
  report.cases.push({ caseId, product, status, ...extra });
  console.log(
    `=> ${caseId} [${product}] ${status}${extra.br ? ` ${extra.br}` : ''}${extra.code ? ` ${extra.code}` : ''}${extra.note ? ` | ${String(extra.note).slice(0, 120)}` : ''}`,
  );
}
function extractPi(data) {
  const s = String(data?.paymentData?.paymentIntent || data?.paymentIntentId || '');
  const m = s.match(/^(pi_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
async function confirmStripe(piId) {
  if (!STRIPE_SK) return { ok: false, note: 'no stripe key' };
  const body = new URLSearchParams({
    payment_method: 'pm_card_visa',
    return_url: 'https://partner.example.com/return',
  });
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SK}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const j = await r.json().catch(() => ({}));
  return {
    ok: r.ok && ['succeeded', 'requires_capture', 'processing'].includes(j.status),
    status: j.status,
    note: j.error?.message || j.status,
  };
}

function contact() {
  return {
    email: 'sharayu@scandid.in',
    countryCode: '+91',
    mobile: '7410015224',
  };
}
function leadPax() {
  return {
    paxType: 'ADT',
    isLead: true,
    profile: {
      title: 'Ms',
      firstName: 'Sharayu',
      lastName: 'Meghare',
      gender: 'FEMALE',
      dob: '2003-05-01',
      nationality: 'IN',
    },
  };
}
function addDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function pickLounge(client) {
  // Prefer collection lounge product if present on gamma
  const preferred = ['ol0oanfxamjcbjhkodvy', '3uurropms0xwh7ubehpo'];
  for (const productId of preferred) {
    const detail = await client.request({
      method: 'GET',
      path: `/v1/lounges/${productId}`,
      query: Q,
    });
    for (const item of detail.data?.results || []) {
      for (const o of item.options || item.availableOptions || []) {
        const bookingContext = o.bookingContext || o.bookingReference;
        if (bookingContext) {
          return {
            productId,
            optionId: o.optionId,
            bookingContext,
            title: o.title || item.title,
            source: 'collection-product',
          };
        }
      }
    }
  }
  const search = await client.request({
    method: 'GET',
    path: '/v1/airports/search',
    query: { ...Q, page: 0, perpage: 10, q: 'bom' },
  });
  for (const a of search.data?.results || []) {
    const airportId = a.airportId || a.id;
    for (const terminal of a.terminals || ['Terminal 2', 'Terminal 1']) {
      const list = await client.request({
        method: 'GET',
        path: '/v1/lounges',
        query: { ...Q, page: 0, perpage: 10, airportId, terminal },
      });
      for (const lounge of list.data?.results || []) {
        const productId = lounge.productId;
        const optionId =
          lounge.availableOptions?.[0]?.optionId || lounge.options?.[0]?.optionId;
        if (!productId || !optionId) continue;
        const detail = await client.request({
          method: 'GET',
          path: `/v1/lounges/${productId}`,
          query: { ...Q, optionId },
        });
        for (const item of detail.data?.results || []) {
          for (const o of item.options || item.availableOptions || []) {
            const bookingContext = o.bookingContext || o.bookingReference;
            if (bookingContext) {
              return {
                productId,
                optionId: o.optionId || optionId,
                bookingContext,
                title: o.title || lounge.title,
                source: 'live-search',
              };
            }
          }
        }
      }
    }
  }
  throw new Error('no lounge inventory');
}

async function pickFastTrack(client) {
  const envProduct = smt.product_id || 'zfdhcngpwijngwvrfan7';
  const envOption = smt.option_id;
  const detail = await client.request({
    method: 'GET',
    path: `/v1/fasttracks/${envProduct}`,
    query: { ...Q, ...(envOption ? { optionId: envOption } : {}) },
  });
  for (const item of detail.data?.results || []) {
    for (const o of item.options || item.availableOptions || []) {
      const bookingContext = o.bookingContext || o.bookingReference;
      if (bookingContext) {
        return {
          productId: envProduct,
          optionId: o.optionId || envOption,
          bookingContext,
          offerId: o.offerId || smt.offer_id || null,
          title: o.title || item.title,
          source: 'collection-env-product',
        };
      }
    }
  }
  // fallback search
  const seeds = [{ airportId: Number(smt.airport_id) || 3110 }];
  for (const a of seeds) {
    for (const terminal of [smt.terminal || 'Terminal 1', 'Terminal 2']) {
      for (const terminalSide of [smt.terminal_side || 'Departure', 'Arrival']) {
        const list = await client.request({
          method: 'GET',
          path: '/v1/fasttracks',
          query: { ...Q, page: 0, perpage: 10, airportId: a.airportId, terminal, terminalSide },
        });
        for (const ft of list.data?.results || []) {
          const productId = ft.productId;
          const optionId = ft.options?.[0]?.optionId || ft.availableOptions?.[0]?.optionId;
          if (!productId) continue;
          const d2 = await client.request({
            method: 'GET',
            path: `/v1/fasttracks/${productId}`,
            query: { ...Q, ...(optionId ? { optionId } : {}) },
          });
          for (const item of d2.data?.results || []) {
            for (const o of item.options || item.availableOptions || []) {
              const bookingContext = o.bookingContext || o.bookingReference;
              if (bookingContext) {
                return {
                  productId,
                  optionId: o.optionId || optionId,
                  bookingContext,
                  offerId: o.offerId || null,
                  title: o.title || ft.title,
                  source: 'live-search',
                };
              }
            }
          }
        }
      }
    }
  }
  throw new Error('no fasttrack inventory');
}

async function main() {
  console.log('COLLECTION BOOKINGS', BASE);
  console.log('env base_url vgm=', vgm.base_url, 'smt=', smt.base_url);
  const { client } = await authenticate(true);

  // --- Lounge W1 (B2B collection shape) ---
  let lounge;
  try {
    lounge = await pickLounge(client);
    record('INV', 'lounge', 'PASS', { note: `${lounge.source} ${lounge.title}` });
  } catch (e) {
    record('INV', 'lounge', 'BUG', { note: e.message });
  }
  if (lounge) {
    const body = {
      bookingContext: lounge.bookingContext,
      travelDate: '2026-12-01',
      travelTime: '07:20',
      timezone: 'Asia/Kolkata',
      passengers: [leadPax()],
      contact: contact(),
    };
    const res = await client.request({
      method: 'POST',
      path: '/v1/airportServices/lounges/finalize-booking',
      query: Q,
      body,
      extraHeaders: {
        'X-Request-Id': `col-lounge-w1-${randomUUID()}`,
        'X-Correlation-ID': createRequestId(),
      },
    });
    const br = brOf(res);
    const code = codeOf(res);
    let status = 'FAIL';
    if (ok(res) && br) status = 'PASS';
    else if (code) status = 'FAIL';
    record('W1_finalize', 'lounge', status, {
      http: res.status,
      br,
      code,
      note: brief(res.data),
    });
    if (br) {
      const st = await client.request({
        method: 'GET',
        path: `/v1/airportServices/lounge/${br}/status`,
        query: Q,
      });
      record('W1_status', 'lounge', ok(st) ? 'PASS' : 'FAIL', {
        br,
        finalStatus: st.data?.status || st.data?.bookingStatus,
      });
    }
  }

  // --- Lounge C1/C2 (Web collection) ---
  if (lounge) {
    // refresh context
    const detail = await client.request({
      method: 'GET',
      path: `/v1/lounges/${lounge.productId}`,
      query: { ...Q, ...(lounge.optionId ? { optionId: lounge.optionId } : {}) },
    });
    for (const item of detail.data?.results || []) {
      for (const o of item.options || item.availableOptions || []) {
        const ctx = o.bookingContext || o.bookingReference;
        if (ctx) lounge.bookingContext = ctx;
      }
    }
    const createBody = {
      bookingContext: lounge.bookingContext,
      travelDate: '2026-11-30',
      travelTime: '07:20',
      timezone: 'Asia/Kolkata',
      redirectUrl: 'https://partner.example.com/return',
      passengers: [leadPax()],
      contact: contact(),
    };
    // Stale env offer_id (10558702) → OFFER_INVALID; omit unless FORCE_OFFER_ID=1
    if (process.env.FORCE_OFFER_ID === '1' && smt.offer_id) {
      createBody.offerId = Number(smt.offer_id) || smt.offer_id;
    }
    const c1 = await client.request({
      method: 'POST',
      path: '/v1/airportServices/lounges/create-booking',
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: createBody,
      extraHeaders: {
        'X-Request-Id': `col-lounge-c1-${randomUUID()}`,
        'X-Correlation-ID': createRequestId(),
      },
    });
    const br = brOf(c1);
    const pi = extractPi(c1.data);
    record('C1_create', 'lounge', ok(c1) && br && pi ? 'PASS' : 'FAIL', {
      http: c1.status,
      br,
      pi,
      code: codeOf(c1),
      note: brief(c1.data),
    });
    if (ok(c1) && pi) {
      const conf = await confirmStripe(pi);
      record('Stripe', 'lounge', conf.ok ? 'PASS' : 'FAIL', { pi, note: conf.note });
      if (conf.ok) {
        const c2 = await client.request({
          method: 'POST',
          path: '/v1/airportServices/lounges/booking',
          query: { ...Q, pid: SMT_PID, key: SMT_KEY },
          body: { paymentIntentId: pi },
          extraHeaders: {
            'X-Request-Id': `col-lounge-c2-${randomUUID()}`,
            'X-Correlation-ID': createRequestId(),
          },
        });
        const bBr = brOf(c2) || br;
        record('C2_booking', 'lounge', ok(c2) ? 'PASS' : 'FAIL', {
          http: c2.status,
          br: bBr,
          code: codeOf(c2),
          note: brief(c2.data),
        });
        if (bBr) {
          const st = await client.request({
            method: 'GET',
            path: `/v1/airportServices/lounge/${bBr}/status`,
            query: Q,
          });
          record('C2_status', 'lounge', ok(st) ? 'PASS' : 'FAIL', {
            br: bBr,
            finalStatus: st.data?.status || st.data?.bookingStatus,
          });
        }
      }
    }
  }

  // --- Fast Track W1 + C1/C2 using collection env product ---
  let ft;
  try {
    ft = await pickFastTrack(client);
    record('INV', 'fasttrack', 'PASS', { note: `${ft.source} ${ft.title || ft.productId}` });
  } catch (e) {
    record('INV', 'fasttrack', 'BUG', { note: e.message });
  }
  if (ft) {
    const body = {
      bookingContext: ft.bookingContext,
      travelDate: addDays(10),
      travelTime: '09:30',
      timezone: 'Asia/Kolkata',
      passengers: [leadPax()],
      contact: contact(),
    };
    const res = await client.request({
      method: 'POST',
      path: '/v1/airportServices/fasttracks/finalize-booking',
      query: Q,
      body,
      extraHeaders: {
        'X-Request-Id': `col-ft-w1-${randomUUID()}`,
        'X-Correlation-ID': createRequestId(),
      },
    });
    const br = brOf(res);
    record('W1_finalize', 'fasttrack', ok(res) && br ? 'PASS' : 'FAIL', {
      http: res.status,
      br,
      code: codeOf(res),
      note: brief(res.data),
    });
    if (br) {
      const st = await client.request({
        method: 'GET',
        path: `/v1/airportServices/fasttrack/${br}/status`,
        query: Q,
      });
      record('W1_status', 'fasttrack', ok(st) ? 'PASS' : 'FAIL', {
        br,
        finalStatus: st.data?.status || st.data?.bookingStatus,
      });
    }

    // refresh + web create
    const d2 = await client.request({
      method: 'GET',
      path: `/v1/fasttracks/${ft.productId}`,
      query: { ...Q, ...(ft.optionId ? { optionId: ft.optionId } : {}) },
    });
    for (const item of d2.data?.results || []) {
      for (const o of item.options || item.availableOptions || []) {
        const ctx = o.bookingContext || o.bookingReference;
        if (ctx) ft.bookingContext = ctx;
        if (o.offerId) ft.offerId = o.offerId;
      }
    }
    const createBody = {
      bookingContext: ft.bookingContext,
      travelDate: addDays(10),
      travelTime: '09:30',
      timezone: 'Asia/Kolkata',
      redirectUrl: 'https://partner.example.com/return',
      passengers: [leadPax()],
      contact: contact(),
    };
    // Inventory + env offerIds can be stale (10558702 → OFFER_INVALID). Omit unless forced.
    if (process.env.FORCE_OFFER_ID === '1') {
      if (ft.offerId) createBody.offerId = ft.offerId;
      else if (smt.offer_id) createBody.offerId = Number(smt.offer_id) || smt.offer_id;
    }
    const c1 = await client.request({
      method: 'POST',
      path: '/v1/airportServices/fasttracks/create-booking',
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: createBody,
      extraHeaders: {
        'X-Request-Id': `col-ft-c1-${randomUUID()}`,
        'X-Correlation-ID': createRequestId(),
      },
    });
    const c1br = brOf(c1);
    const pi = extractPi(c1.data);
    record('C1_create', 'fasttrack', ok(c1) && c1br && pi ? 'PASS' : 'FAIL', {
      http: c1.status,
      br: c1br,
      pi,
      code: codeOf(c1),
      note: brief(c1.data),
    });
    if (ok(c1) && pi) {
      const conf = await confirmStripe(pi);
      record('Stripe', 'fasttrack', conf.ok ? 'PASS' : 'FAIL', { pi, note: conf.note });
      if (conf.ok) {
        const c2 = await client.request({
          method: 'POST',
          path: '/v1/airportServices/fasttracks/booking',
          query: { ...Q, pid: SMT_PID, key: SMT_KEY },
          body: { paymentIntentId: pi },
          extraHeaders: {
            'X-Request-Id': `col-ft-c2-${randomUUID()}`,
            'X-Correlation-ID': createRequestId(),
          },
        });
        const bBr = brOf(c2) || c1br;
        record('C2_booking', 'fasttrack', ok(c2) ? 'PASS' : 'FAIL', {
          http: c2.status,
          br: bBr,
          code: codeOf(c2),
          note: brief(c2.data),
        });
        if (bBr) {
          const st = await client.request({
            method: 'GET',
            path: `/v1/airportServices/fasttrack/${bBr}/status`,
            query: Q,
          });
          record('C2_status', 'fasttrack', ok(st) ? 'PASS' : 'FAIL', {
            br: bBr,
            finalStatus: st.data?.status || st.data?.bookingStatus,
          });
        }
      }
    }
  }

  const outPath = path.join(OUT, 'collection-bookings-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  let md = `# Gamma collection bookings — ${report.at}\n\n**Base:** ${BASE}\n\n`;
  md += `| Case | Product | Status | BR / notes |\n|---|---|---|---|\n`;
  for (const c of report.cases) {
    md += `| ${c.caseId} | ${c.product} | ${c.status} | ${c.br || ''} ${c.code || ''} ${(c.finalStatus || c.note || '').toString().slice(0, 80)} |\n`;
  }
  fs.writeFileSync(path.join(OUT, 'COLLECTION-BOOKINGS-2026-11-23.md'), md);
  console.log('Wrote', outPath);
  const counts = {};
  for (const c of report.cases) counts[c.status] = (counts[c.status] || 0) + 1;
  console.log('COUNTS', counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
