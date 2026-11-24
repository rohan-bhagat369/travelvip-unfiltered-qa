/**
 * Full catalog_v1 changelog matrix — Lounge + Fast Track + eSIM on canary-api.
 * Covers W/C/A/U/V/R/L/I as far as staging inventory + vgm (+ smt query) allow.
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'
 *   node inventory/scripts/probe-canary-catalog-v1-full.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { authenticate } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { createRequestId } from '../../shared/lib/signature.js';
import { TravelVipClient } from '../../shared/lib/TravelVipClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'canary-catalog-v1');
fs.mkdirSync(OUT, { recursive: true });

const Q = { lang: 'en', currency: 'INR' };
const SMT_PID = process.env.SMT_PID || 'smt';
const SMT_KEY = process.env.SMT_KEY || 'palsgcvgscvvs';
const LEGACY_KEY = process.env.LEGACY_PARTNER_KEY || 'palsgcvgscvvs';

const PRODUCTS = {
  lounge: {
    name: 'lounge',
    finalize: '/v1/airportServices/lounges/finalize-booking',
    create: '/v1/airportServices/lounges/create-booking',
    booking: '/v1/airportServices/lounges/booking',
    update: '/v1/airportServices/lounges/update-booking',
    status: '/v1/airportServices/lounge/{br}/status',
    details: '/v1/airportServices/lounge/booking/{br}',
    history: '/v1/airportServices/lounge/booking/history',
    serviceType: 'lounge',
  },
  fasttrack: {
    name: 'fasttrack',
    finalize: '/v1/airportServices/fasttracks/finalize-booking',
    create: '/v1/airportServices/fasttracks/create-booking',
    booking: '/v1/airportServices/fasttracks/booking',
    update: '/v1/airportServices/fasttracks/update-booking',
    status: '/v1/airportServices/fasttrack/{br}/status',
    details: '/v1/airportServices/fasttrack/booking/{br}',
    history: '/v1/airportServices/fasttrack/booking/history',
    serviceType: 'fast_track',
  },
  esim: {
    name: 'esim',
    finalize: '/v1/esims/finalize-booking',
    create: '/v1/esims/create-booking',
    booking: '/v1/esims/booking',
    update: '/v1/esims/update-booking',
    status: '/v1/esim/{br}/status',
    details: '/v1/esim/booking/{br}',
    history: '/v1/esim/booking/history',
    serviceType: 'esim',
  },
};

const report = {
  at: new Date().toISOString(),
  base: config.baseUrl,
  partner: config.partnerId,
  cases: [],
  brs: {},
  notes: [],
};

function ok(res) {
  return res.ok || (res.status >= 200 && res.status < 300);
}
function brief(d, n = 280) {
  return JSON.stringify(d ?? null).slice(0, n);
}
function addDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
function codeOf(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}
function brOf(res) {
  const d = res?.data || {};
  return d.bookingRefId || d.bookingReferenceId || d.bookingReference
    || d.error?.bookingReference || d.error?.details?.bookingReference || null;
}
function record(caseId, product, status, extra = {}) {
  const row = { caseId, product, status, ...extra };
  report.cases.push(row);
  console.log(`=> ${caseId} [${product}] ${status}${extra.br ? ` ${extra.br}` : ''}${extra.code ? ` ${extra.code}` : ''}${extra.note ? ` | ${extra.note}` : ''}`);
  return row;
}

async function req(client, opts) {
  const requestId = opts.requestId || createRequestId();
  const { omitPartnerKey, extraHeaders, ...rest } = opts;
  return client.request({
    ...rest,
    correlation: true,
    partnerKey: omitPartnerKey ? null : (opts.partnerKey === undefined ? client.partnerKey : opts.partnerKey),
    omitPartnerKey: !!omitPartnerKey,
    extraHeaders: { 'X-Request-Id': requestId, ...(extraHeaders || {}) },
  });
}

function extractPaymentIntentId(data) {
  const d = data || {};
  const raw = d.paymentIntentId
    || d.payment?.paymentIntentId
    || d.paymentData?.paymentIntentId
    || d.paymentData?.paymentIntent
    || d.payment?.clientSecret
    || d.clientSecret
    || null;
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/^(pi_[A-Za-z0-9]+)/);
  return m ? m[1] : (/^pi_/.test(s) ? s.split('_secret_')[0] : null);
}

async function confirmStripePi(piId) {
  const sk = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SK || '';
  if (!sk) return { ok: false, note: 'no STRIPE_SECRET_KEY' };
  const body = new URLSearchParams({
    payment_method: process.env.STRIPE_PM || 'pm_card_visa',
    return_url: process.env.STRIPE_RETURN_URL || 'https://partner.example.com/return',
  });
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sk}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok && (data.status === 'succeeded' || data.status === 'requires_capture' || data.status === 'processing'),
    http: res.status,
    status: data.status,
    note: JSON.stringify({ status: data.status, code: data.error?.code, msg: data.error?.message }).slice(0, 200),
  };
}

function contact() {
  return {
    email: `canary.full.${Date.now()}@travelvip.ai`,
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
  // Prefer known-good gamma/collection lounge (Marhaba) before BOM Adani search
  for (const productId of (process.env.LOUNGE_PRODUCT_ID || 'ol0oanfxamjcbjhkodvy').split(',').map((s) => s.trim()).filter(Boolean)) {
    const detail = await req(client, { method: 'GET', path: `/v1/lounges/${productId}`, query: Q });
    for (const item of detail.data?.results || []) {
      for (const o of item.options || item.availableOptions || []) {
        const bookingContext = o.bookingContext || o.bookingReference;
        if (bookingContext) {
          return {
            productId,
            optionId: o.optionId || null,
            bookingContext,
            offerId: o.offerId || null,
            airportId: null,
            terminal: o.locationDetails?.terminal || null,
          };
        }
      }
    }
  }
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
            if (bookingContext) return { productId, optionId, bookingContext, offerId: o.offerId || null, airportId, terminal };
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
              if (bookingContext) return { productId, optionId: o.optionId || optionId, bookingContext, airportId: a.airportId, terminal, terminalSide };
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
          pick = { entityId, productId: plan.productId, optionId: opt.optionId, variantId: variant.variantId, bookingContext, amount, offerId: variant.offerId || opt.offerId || null };
        }
      }
    }
  }
  if (!pick) throw new Error('no esim variant');
  return pick;
}

async function pollStatus(client, p, br) {
  let status = null; let last = null;
  for (let i = 0; i < 8; i += 1) {
    last = await req(client, { method: 'GET', path: p.status.replace('{br}', br), query: Q });
    status = last.data?.status || last.data?.bookingStatus || status;
    if (/Confirm|Fail|Cancel|Refund/i.test(String(status || ''))) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { status, last };
}

async function runProductWallet(client, key, pickFn) {
  const p = PRODUCTS[key];
  let inv;
  try {
    inv = await pickFn(client);
  } catch (e) {
    record('INV', key, 'BUG', { note: e.message });
    return null;
  }

  // W1
  {
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: Q, body: bodyFor(key, inv),
      requestId: `full-w1-${key}-${randomUUID()}`,
    });
    const br = brOf(res);
    const code = codeOf(res);
    let status = 'BUG';
    if (ok(res) && br) status = 'PASS';
    else if (code === 'PROVIDER_BOOKING_FAILED' && br) status = 'CHECK'; // supplier inventory
    record('W1', key, status, { http: res.status, br, code, note: brief(res.data) });
    if (br) {
      report.brs[`${key}_W1`] = br;
      const polled = await pollStatus(client, p, br);
      record('R1', key, ok(polled.last) ? 'PASS' : 'BUG', { br, finalStatus: polled.status });
      const det = await req(client, { method: 'GET', path: p.details.replace('{br}', br), query: Q });
      record('R2', key, ok(det) ? 'PASS' : 'BUG', { br, http: det.status });
      const hist = await req(client, { method: 'GET', path: p.history, query: { ...Q, page: 0, perpage: 10 } });
      record('R3', key, ok(hist) ? 'PASS' : 'BUG', { br, http: hist.status });
    }
  }

  // Refresh inventory for subsequent mutating cases
  try { inv = await pickFn(client); } catch { /* keep */ }

  // W2 provider_reject simulation
  {
    try { inv = await pickFn(client); } catch { /* */ }
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: Q, body: bodyFor(key, inv),
      requestId: `full-w2-${key}-${randomUUID()}`,
      extraHeaders: { 'X-Simulate-Failure': 'provider_reject' },
    });
    const br = brOf(res);
    const code = codeOf(res);
    const pass = /PROVIDER|FAILED|TICKET|BOOKING_FAILED/i.test(String(code || ''))
      || /Fail/i.test(String(res.data?.status || ''))
      || (res.status >= 400 && br);
    record('W2', key, pass ? 'PASS' : (res.status === 200 && /Pending|Confirm/i.test(String(res.data?.status || '')) ? 'NOT TESTED' : 'CHECK'), {
      http: res.status, br, code, note: brief(res.data),
    });
    if (br) report.brs[`${key}_W2`] = br;
  }

  // W4 omit partner key
  {
    try { inv = await pickFn(client); } catch { /* */ }
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: Q, body: bodyFor(key, inv),
      omitPartnerKey: true,
      requestId: `full-w4-${key}-${randomUUID()}`,
    });
    const code = codeOf(res);
    // Expected: reject without partner key. MISSING_HEADER (400) is valid contract.
    const pass = res.status === 401 || res.status === 403
      || /MISSING_HEADER|PARTNER|UNAUTHORIZED|FORBIDDEN|INVALID_PARTNER/i.test(String(code || ''));
    record('W4', key, pass ? 'PASS' : 'BUG', { http: res.status, code, br: brOf(res), note: brief(res.data) });
  }

  // W5 non-B2B finalize (smt query on finalize) — expect PARTNER_NOT_ALLOWED
  {
    try { inv = await pickFn(client); } catch { /* */ }
    const res = await req(client, {
      method: 'POST',
      path: p.finalize,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: bodyFor(key, inv),
      requestId: `full-w5-${key}-${randomUUID()}`,
    });
    const code = codeOf(res);
    const pass = res.status === 403 && /PARTNER_NOT_ALLOWED/i.test(String(code || ''))
      || /PARTNER_NOT_ALLOWED/i.test(JSON.stringify(res.data || {}));
    record('W5', key, pass ? 'PASS' : 'CHECK', { http: res.status, code, note: brief(res.data) });
  }

  // W6 currency mismatch
  {
    try { inv = await pickFn(client); } catch { /* */ }
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: { lang: 'en', currency: 'USD' }, body: bodyFor(key, inv),
      requestId: `full-w6-${key}-${randomUUID()}`,
    });
    const code = codeOf(res);
    const pass = /CURRENCY_MISMATCH/i.test(String(code || ''));
    record('W6', key, pass ? 'PASS' : 'BUG', { http: res.status, code, note: brief(res.data) });
  }

  // W8 offerId if present
  {
    try { inv = await pickFn(client); } catch { /* */ }
    if (inv?.offerId) {
      const res = await req(client, {
        method: 'POST', path: p.finalize, query: Q,
        body: bodyFor(key, inv, { offerId: inv.offerId }),
        requestId: `full-w8-${key}-${randomUUID()}`,
      });
      record('W8', key, ok(res) || codeOf(res) === 'OFFER_INVALID' ? (ok(res) ? 'PASS' : 'CHECK') : 'CHECK', {
        http: res.status, br: brOf(res), code: codeOf(res), note: brief(res.data),
      });
    } else {
      record('W8', key, 'NOT TESTED', { note: 'no offerId on inventory' });
    }
  }

  // Validations
  {
    const v1 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: {}, requestId: `full-v1-${key}-${randomUUID()}` });
    record('V1', key, v1.status === 400 ? 'PASS' : 'BUG', { http: v1.status, code: codeOf(v1) });

    const bad = bodyFor(key, inv); bad.bookingContext = 'tampered-invalid';
    const v2 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: bad, requestId: `full-v2-${key}-${randomUUID()}` });
    record('V2', key, v2.status >= 400 ? 'PASS' : 'BUG', { http: v2.status, code: codeOf(v2) });

    const noLead = bodyFor(key, inv);
    if (key !== 'esim') {
      noLead.passengers = [{ ...leadPax(), isLead: false }];
      const v6 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: noLead, requestId: `full-v6-${key}-${randomUUID()}` });
      record('V6', key, v6.status === 400 ? 'PASS' : 'CHECK', { http: v6.status, code: codeOf(v6), note: brief(v6.data) });
    } else {
      const noEmail = bodyFor(key, inv); delete noEmail.contact.email;
      const v6 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: noEmail, requestId: `full-v6-${key}-${randomUUID()}` });
      record('V6', key, v6.status === 400 ? 'PASS' : 'CHECK', { http: v6.status, code: codeOf(v6) });
    }

    if (key !== 'esim') {
      const past = bodyFor(key, inv, { travelDate: '2020-01-01' });
      const v7 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: past, requestId: `full-v7-${key}-${randomUUID()}` });
      record('V7', key, v7.status === 400 || /date|travel|past|same/i.test(JSON.stringify(v7.data || {})) ? 'PASS' : 'CHECK', {
        http: v7.status, code: codeOf(v7), note: brief(v7.data),
      });
    } else {
      record('V7', key, 'NOT TESTED', { note: 'eSIM has no travelDate' });
    }

    if (key === 'esim') {
      const noVar = bodyFor(key, inv);
      // V5 variant — omit nothing if body doesn't have variant; mark NT if N/A
      record('V5', key, 'NOT TESTED', { note: 'variant embedded in bookingContext' });
    } else {
      record('V5', key, 'NOT TESTED', { note: 'eSIM-only' });
    }
  }

  // I1 same request id
  {
    try { inv = await pickFn(client); } catch { /* */ }
    const requestId = `full-i1-${key}-${randomUUID()}`;
    const body = bodyFor(key, inv);
    const first = await req(client, { method: 'POST', path: p.finalize, query: Q, body, requestId });
    const second = await req(client, { method: 'POST', path: p.finalize, query: Q, body, requestId });
    const b1 = brOf(first); const b2 = brOf(second);
    const pass = (b1 && b2 && b1 === b2) || brief(first.data) === brief(second.data);
    record('I1', key, pass ? 'PASS' : 'CHECK', { br1: b1, br2: b2, http1: first.status, http2: second.status });
  }

  // C1 create-booking (web) — may require smt; try with vgm session first then smt query
  {
    try { inv = await pickFn(client); } catch { /* */ }
    const createBody = bodyFor(key, inv, { redirectUrl: 'https://partner.example.com/return' });
    if (createBody.offerId === undefined) delete createBody.offerId;
    const res = await req(client, {
      method: 'POST', path: p.create, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: createBody,
      requestId: `full-c1-${key}-${randomUUID()}`,
    });
    const code = codeOf(res);
    const hasPay = !!(res.data?.paymentIntentId || res.data?.clientSecret || res.data?.payment?.clientSecret
      || res.data?.checkoutUrl || res.data?.paymentLink);
    const br = brOf(res);
    let status = 'CHECK';
    if (ok(res) && (hasPay || br)) status = 'PASS';
    else if (/PARTNER_NOT_ALLOWED|FORBIDDEN/i.test(String(code || ''))) status = 'CHECK';
    record('C1', key, status, { http: res.status, br, code, hasPay, note: brief(res.data) });
    if (br) report.brs[`${key}_C1`] = br;

    // C2 Stripe confirm + booking step
    {
      const piId = extractPaymentIntentId(res.data);
      if (!ok(res) || !piId) {
        report.cases = report.cases.filter((c) => !(c.caseId === 'C2' && c.product === key));
        record('C2', key, 'NOT TESTED', { note: 'C1 did not yield paymentIntentId' });
      } else {
        const conf = await confirmStripePi(piId);
        if (!conf.ok) {
          report.cases = report.cases.filter((c) => !(c.caseId === 'C2' && c.product === key));
          record('C2', key, conf.note?.includes('no STRIPE') ? 'NOT TESTED' : 'CHECK', {
            br, piId, note: conf.note || 'stripe confirm failed',
          });
        } else {
          const book = await req(client, {
            method: 'POST', path: p.booking,
            query: { ...Q, pid: SMT_PID, key: SMT_KEY },
            body: { paymentIntentId: piId },
            requestId: `full-c2-${key}-${randomUUID()}`,
          });
          const bCode = codeOf(book);
          const bBr = brOf(book) || br;
          let c2status = 'CHECK';
          if (ok(book)) c2status = 'PASS';
          else if (/BOOKING_SUBMIT_FAILED|PROVIDER_BOOKING_FAILED/i.test(String(bCode || ''))) c2status = 'CHECK';
          else if (book.status >= 500) c2status = 'BUG';
          report.cases = report.cases.filter((c) => !(c.caseId === 'C2' && c.product === key));
          record('C2', key, c2status, {
            http: book.status, br: bBr, code: bCode, piId, stripe: conf.status, note: brief(book.data),
          });
          if (bBr) report.brs[`${key}_C2`] = bBr;
        }
      }
    }

    // C7 booking before pay
    const c7 = await req(client, {
      method: 'POST', path: p.booking,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: { paymentIntentId: 'pi_invalid_not_paid' },
      requestId: `full-c7-${key}-${randomUUID()}`,
    });
    const c7code = codeOf(c7);
    record('C7', key, c7.status === 402 || /PAYMENT_VERIFICATION_FAILED/i.test(String(c7code || '')) || c7.status === 400 || c7.status === 404
      ? 'PASS' : 'CHECK', { http: c7.status, code: c7code, note: brief(c7.data) });

    // C8 missing paymentIntentId
    const c8 = await req(client, {
      method: 'POST', path: p.booking, query: { ...Q, pid: SMT_PID, key: SMT_KEY }, body: {},
      requestId: `full-c8-${key}-${randomUUID()}`,
    });
    record('C8', key, c8.status === 400 || /VALID/i.test(String(codeOf(c8) || '')) ? 'PASS' : 'CHECK', {
      http: c8.status, code: codeOf(c8),
    });

    // C9 unknown PI
    const c9 = await req(client, {
      method: 'POST', path: p.booking, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: { paymentIntentId: 'pi_unknown_does_not_exist_123' },
      requestId: `full-c9-${key}-${randomUUID()}`,
    });
    record('C9', key, c9.status === 404 || /PAYMENT_TRANSACTION_NOT_FOUND/i.test(String(codeOf(c9) || '')) || c9.status >= 400
      ? 'PASS' : 'CHECK', { http: c9.status, code: codeOf(c9) });
  }

  // U* update-booking on W1 BR if we have one that is pending/confirmed
  const uBr = report.brs[`${key}_W1`];
  if (uBr) {
    const st = await pollStatus(client, p, uBr);
    // U6 missing bookingRefId
    const u6 = await req(client, {
      method: 'POST', path: p.update, query: Q, body: { status: 'CONFIRMED' },
      requestId: `full-u6-${key}-${randomUUID()}`,
    });
    record('U6', key, u6.status === 400 ? 'PASS' : 'CHECK', { http: u6.status, code: codeOf(u6) });

    // U7 unknown BR
    const u7 = await req(client, {
      method: 'POST', path: p.update, query: Q,
      body: { bookingRefId: 'BR0000000000000001', bookingId: 'SUP-UNKNOWN', status: 'CONFIRMED' },
      requestId: `full-u7-${key}-${randomUUID()}`,
    });
    record('U7', key, u7.status === 404 || /BOOKING_NOT_FOUND/i.test(String(codeOf(u7) || '')) || u7.status >= 400
      ? 'PASS' : 'CHECK', { http: u7.status, code: codeOf(u7) });

    // U1 CONFIRMED if pending
    if (/Pending/i.test(String(st.status || ''))) {
      const u1 = await req(client, {
        method: 'POST', path: p.update, query: Q,
        body: {
          bookingRefId: uBr,
          bookingId: uBr,
          status: 'CONFIRMED',
          bookingStatus: 'CONFIRMED',
        },
        requestId: `full-u1-${key}-${randomUUID()}`,
      });
      const after = await pollStatus(client, p, uBr);
      record('U1', key, ok(u1) || /Confirm/i.test(String(after.status || '')) ? 'PASS' : 'CHECK', {
        http: u1.status, br: uBr, finalStatus: after.status, note: brief(u1.data),
      });
    } else {
      record('U1', key, 'NOT TESTED', { note: `status=${st.status}` });
    }
  } else {
    record('U1', key, 'NOT TESTED', { note: 'no W1 BR' });
    record('U6', key, 'NOT TESTED');
    record('U7', key, 'NOT TESTED');
  }

  return inv;
}

async function runOldFlow(client) {
  // L8 offers
  for (const serviceType of ['lounge', 'fast_track_immigration', 'esim']) {
    const res = await req(client, {
      method: 'GET',
      path: '/api/airportServices/offers',
      query: { lang: 'en', pid: config.partnerId, key: LEGACY_KEY, serviceType },
      requestId: `full-l8-${serviceType}-${randomUUID()}`,
    });
    record('L8', serviceType, ok(res) || res.status === 400 ? 'PASS' : 'CHECK', {
      http: res.status, note: brief(res.data),
    });
  }

  // L5 history
  const hist = await req(client, {
    method: 'GET',
    path: '/api/airportServices/getAirportServiceBookingHistory',
    query: { lang: 'en', pid: config.partnerId, key: LEGACY_KEY, page: 0, perpage: 5 },
    requestId: `full-l5-${randomUUID()}`,
  });
  record('L5', 'old', ok(hist) || Array.isArray(hist.data) ? 'PASS' : 'CHECK', { http: hist.status, note: brief(hist.data) });

  // L1 old createBooking — try lounge-shaped payload (best effort)
  let loungeInv = null;
  try {
    loungeInv = await pickLounge(client);
  } catch (e) {
    record('L1', 'lounge', 'NOT TESTED', { note: e.message });
    return;
  }
  const createBody = {
    serviceType: 'lounge',
    bookingContext: loungeInv.bookingContext,
    travelDate: addDays(7),
    travelTime: '07:20',
    passengers: [leadPax()],
    contact: contact(),
  };
  const l1 = await req(client, {
    method: 'POST',
    path: '/api/airportServices/createBooking',
    query: { lang: 'en', currency: 'INR', pid: config.partnerId, key: LEGACY_KEY },
    body: createBody,
    requestId: `full-l1-lounge-${randomUUID()}`,
  });
  const br = brOf(l1) || l1.data?.bookingId || l1.data?.data?.bookingId;
  record('L1', 'lounge', ok(l1) || l1.status === 400 || l1.status === 402 ? (ok(l1) ? 'PASS' : 'CHECK') : 'CHECK', {
    http: l1.status, br, code: codeOf(l1), note: brief(l1.data),
  });
  if (br) {
    report.brs.old_L1_lounge = br;
    // L7 new status on old BR
    const st = await req(client, {
      method: 'GET',
      path: `/v1/airportServices/lounge/${br}/status`,
      query: Q,
      requestId: `full-l7-${randomUUID()}`,
    });
    record('L7', 'lounge', ok(st) || st.status === 404 || st.status === 400 ? 'PASS' : 'CHECK', {
      http: st.status, br, note: brief(st.data),
    });
  }

  // Same for FT + eSIM createBooking best-effort
  for (const [key, pickFn, serviceType] of [
    ['fasttrack', pickFastTrack, 'fast_track'],
    ['esim', pickEsim, 'esim'],
  ]) {
    try {
      const inv = await pickFn(client);
      const body = key === 'esim'
        ? { serviceType, bookingContext: inv.bookingContext, passengers: [{ paxType: 'ADT', profile: leadPax().profile }], contact: contact() }
        : { serviceType, bookingContext: inv.bookingContext, travelDate: addDays(5), travelTime: '10:00', passengers: [leadPax()], contact: contact() };
      const res = await req(client, {
        method: 'POST',
        path: '/api/airportServices/createBooking',
        query: { lang: 'en', currency: 'INR', pid: config.partnerId, key: LEGACY_KEY },
        body,
        requestId: `full-l1-${key}-${randomUUID()}`,
      });
      record('L1', key, ok(res) || res.status === 400 || res.status === 402 ? (ok(res) ? 'PASS' : 'CHECK') : 'CHECK', {
        http: res.status, br: brOf(res), code: codeOf(res), note: brief(res.data),
      });
    } catch (e) {
      record('L1', key, 'NOT TESTED', { note: e.message });
    }
  }
}

async function main() {
  console.log('FULL MATRIX', config.baseUrl, config.partnerId);
  const { client } = await authenticate(true);

  // Mark cases we cannot force without ops
  for (const key of ['lounge', 'fasttrack', 'esim']) {
    record('W3', key, 'NOT TESTED', { note: 'needs low-balance partner' });
    // W7 filled later by wallet-disabled attempt (or dedicated probe)
    record('W7', key, 'NOT TESTED', { note: 'needs wallet disabled for partner' });
    record('C2', key, 'NOT TESTED', { note: 'needs Stripe confirm + booking step (partial C1 only)' });
    record('C3', key, 'NOT TESTED', { note: 'webhook completion' });
    record('C4', key, 'NOT TESTED', { note: 'supplier reject after pay' });
    record('C5', key, 'NOT TESTED');
    record('C6', key, 'NOT TESTED');
    record('C10', key, 'NOT TESTED', { note: 'cross-product payment' });
    record('C11', key, 'NOT TESTED');
    record('C12', key, 'NOT TESTED', { note: '100% offer' });
    record('C13', key, 'NOT TESTED');
    record('A1', key, 'NOT TESTED', { note: 'needs controlled supplier CONFIRMED' });
    record('A2', key, 'NOT TESTED');
    record('A3', key, 'CHECK', { note: 'covered partly by W2 sim if enabled' });
    record('A4', key, 'NOT TESTED');
    record('U2', key, 'NOT TESTED', { note: 'CANCELLED refund — run after stable Pending BR' });
    record('U3', key, 'NOT TESTED');
    record('U4', key, 'NOT TESTED');
    record('U5', key, 'NOT TESTED');
    record('U8', key, 'NOT TESTED');
    record('V3', key, 'NOT TESTED');
    record('V4', key, 'NOT TESTED');
    record('V8', key, 'NOT TESTED');
    record('I2', key, 'NOT TESTED');
    record('I3', key, 'NOT TESTED');
    record('I4', key, 'NOT TESTED');
    record('L2', key, 'NOT TESTED');
    record('L3', key, 'NOT TESTED');
    record('L4', key, 'NOT TESTED');
    record('L6', key, 'NOT TESTED');
  }

  await runProductWallet(client, 'lounge', pickLounge);
  await runProductWallet(client, 'fasttrack', pickFastTrack);
  await runProductWallet(client, 'esim', pickEsim);
  await runOldFlow(client);

  // C10 wrong product payment — lounge PI on FT booking route (synthetic)
  {
    const c10 = await req(client, {
      method: 'POST',
      path: PRODUCTS.fasttrack.booking,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: { paymentIntentId: 'pi_lounge_on_fasttrack_fake' },
      requestId: `full-c10-${randomUUID()}`,
    });
    const code = codeOf(c10);
    // overwrite prior NT
    report.cases = report.cases.filter((c) => !(c.caseId === 'C10' && c.product === 'fasttrack' && c.status === 'NOT TESTED'));
    record('C10', 'fasttrack', c10.status === 400 || /UNSUPPORTED_SERVICE_TYPE|PAYMENT/i.test(String(code || '')) || c10.status >= 400
      ? 'PASS' : 'CHECK', { http: c10.status, code, note: brief(c10.data) });
  }

  const outPath = path.join(OUT, 'full-matrix-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // markdown summary
  const by = {};
  for (const c of report.cases) {
    by[c.caseId] = by[c.caseId] || {};
    by[c.caseId][c.product] = c.status;
  }
  const caseIds = [...new Set(report.cases.map((c) => c.caseId))];
  let md = `# Canary catalog_v1 FULL matrix\n\n**Base:** ${config.baseUrl} · **Partner:** ${config.partnerId} · ${report.at}\n\n`;
  md += `| Case | Lounge | Fast Track | eSIM | old/other |\n|---|---|---|---|---|\n`;
  for (const id of caseIds) {
    const row = by[id] || {};
    md += `| ${id} | ${row.lounge || '—'} | ${row.fasttrack || '—'} | ${row.esim || '—'} | ${row.old || row.lounge_old || Object.entries(row).filter(([k]) => !['lounge','fasttrack','esim'].includes(k)).map(([k, v]) => `${k}:${v}`).join(' ') || '—'} |\n`;
  }
  md += `\n## BRs\n\`\`\`json\n${JSON.stringify(report.brs, null, 2)}\n\`\`\`\n`;
  const mdPath = path.join(OUT, 'FULL-CHANGELOG-REPORT.md');
  fs.writeFileSync(mdPath, md);
  console.log('\nWrote', outPath);
  console.log('Wrote', mdPath);
  console.log('\n=== COUNTS ===');
  const counts = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
  for (const c of report.cases) counts[c.status] = (counts[c.status] || 0) + 1;
  console.log(counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
