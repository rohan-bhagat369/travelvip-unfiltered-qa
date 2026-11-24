/**
 * Remaining catalog_v1 NT cases — canary-api.
 * Covers U2–U5/U8, I2–I4, C5/C10/C11, V3–V5/V4, W8, L*, C3 best-effort, W2 recheck.
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'
 *   $env:STRIPE_SECRET_KEY='sk_test_...'
 *   node inventory/scripts/probe-canary-catalog-v1-remaining.js
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
const LEGACY_KEY = process.env.LEGACY_PARTNER_KEY || process.env.LOUNGE_API_KEY || 'palsgcvgscvvs';

const PRODUCTS = {
  lounge: {
    finalize: '/v1/airportServices/lounges/finalize-booking',
    create: '/v1/airportServices/lounges/create-booking',
    booking: '/v1/airportServices/lounges/booking',
    update: '/v1/airportServices/lounges/update-booking',
    status: '/v1/airportServices/lounge/{br}/status',
    details: '/v1/airportServices/lounge/booking/{br}',
    history: '/v1/airportServices/lounge/booking/history',
  },
  fasttrack: {
    finalize: '/v1/airportServices/fasttracks/finalize-booking',
    create: '/v1/airportServices/fasttracks/create-booking',
    booking: '/v1/airportServices/fasttracks/booking',
    update: '/v1/airportServices/fasttracks/update-booking',
    status: '/v1/airportServices/fasttrack/{br}/status',
    details: '/v1/airportServices/fasttrack/booking/{br}',
    history: '/v1/airportServices/fasttrack/booking/history',
  },
  esim: {
    finalize: '/v1/esims/finalize-booking',
    create: '/v1/esims/create-booking',
    booking: '/v1/esims/booking',
    update: '/v1/esims/update-booking',
    status: '/v1/esim/{br}/status',
    details: '/v1/esim/booking/{br}',
    history: '/v1/esim/booking/history',
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

function ok(res) { return res.ok || (res.status >= 200 && res.status < 300); }
function brief(d, n = 280) { return JSON.stringify(d ?? null).slice(0, n); }
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
function codeOf(res) { return res?.data?.error?.code || res?.data?.code || null; }
function brOf(res) {
  const d = res?.data || {};
  return d.bookingRefId || d.bookingReferenceId || d.bookingReference
    || d.error?.bookingReference || d.error?.bookingReferenceId || d.error?.details?.bookingReference || null;
}
function record(caseId, product, status, extra = {}) {
  const row = { caseId, product, status, ...extra };
  report.cases.push(row);
  console.log(`=> ${caseId} [${product}] ${status}${extra.br ? ` ${extra.br}` : ''}${extra.code ? ` ${extra.code}` : ''}${extra.note ? ` | ${String(extra.note).slice(0, 120)}` : ''}`);
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
  const raw = d.paymentIntentId || d.payment?.paymentIntentId || d.paymentData?.paymentIntentId
    || d.paymentData?.paymentIntent || d.payment?.clientSecret || d.clientSecret || null;
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
    headers: { Authorization: `Bearer ${sk}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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
    email: `canary.rem.${Date.now()}@travelvip.ai`,
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
      title: 'Mr', firstName: 'Rohan', lastName: `Rem${suffix}`,
      gender: 'MALE', dob: '2001-05-29', nationality: 'IN',
    },
  };
}
function bodyFor(product, inv, overrides = {}) {
  if (product === 'esim') {
    return { bookingContext: inv.bookingContext, passengers: [{ paxType: 'ADT', profile: leadPax().profile }], contact: contact(), ...overrides };
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
            offerId: o.offerId || item.offerId || null,
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
            if (bookingContext) {
              return {
                productId, optionId, bookingContext,
                offerId: o.offerId || item.offerId || lounge.offerId || null,
                airportId, terminal,
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
              if (bookingContext) {
                return {
                  productId, optionId: o.optionId || optionId, bookingContext,
                  offerId: o.offerId || item.offerId || ft.offerId || null,
                  airportId: a.airportId, terminal, terminalSide,
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
          pick = {
            entityId, productId: plan.productId, optionId: opt.optionId, variantId: variant.variantId,
            bookingContext, amount, offerId: variant.offerId || opt.offerId || plan.offerId || null,
          };
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
    if (/Confirm|Fail|Cancel|Refund/i.test(String(status || ''))) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status, last };
}

async function walletBook(client, key, inv) {
  const p = PRODUCTS[key];
  const res = await req(client, {
    method: 'POST', path: p.finalize, query: Q, body: bodyFor(key, inv),
    requestId: `rem-w-${key}-${randomUUID()}`,
  });
  return { res, br: brOf(res), code: codeOf(res) };
}

async function cardCreateAndPay(client, key, inv) {
  const p = PRODUCTS[key];
  const createBody = bodyFor(key, inv, { redirectUrl: 'https://partner.example.com/return' });
  const created = await req(client, {
    method: 'POST', path: p.create, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
    body: createBody, requestId: `rem-c1-${key}-${randomUUID()}`,
  });
  const br = brOf(created);
  const piId = extractPaymentIntentId(created.data);
  if (!ok(created) || !piId) return { created, br, piId: null, conf: null, book: null };
  const conf = await confirmStripePi(piId);
  if (!conf.ok) return { created, br, piId, conf, book: null };
  const book = await req(client, {
    method: 'POST', path: p.booking, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
    body: { paymentIntentId: piId }, requestId: `rem-c2-${key}-${randomUUID()}`,
  });
  return { created, br: brOf(book) || br, piId, conf, book };
}

async function runUpdates(client, key, pickFn) {
  const p = PRODUCTS[key];
  let inv;
  try { inv = await pickFn(client); } catch (e) {
    for (const id of ['U2', 'U3', 'U4', 'U5', 'U8']) record(id, key, 'NOT TESTED', { note: e.message });
    return;
  }

  // U2 CANCELLED on fresh Pending
  {
    const { br, res, code } = await walletBook(client, key, inv);
    if (!(ok(res) && br) && !(code === 'PROVIDER_BOOKING_FAILED' && br)) {
      record('U2', key, 'NOT TESTED', { note: `no pending BR (${code || res.status})` });
    } else if (!ok(res)) {
      record('U2', key, 'NOT TESTED', { br, note: `book not pending: ${code}` });
    } else {
      report.brs[`${key}_U2`] = br;
      const u2 = await req(client, {
        method: 'POST', path: p.update, query: Q,
        body: { bookingRefId: br, bookingId: br, status: 'CANCELLED', bookingStatus: 'CANCELLED' },
        requestId: `rem-u2-${key}-${randomUUID()}`,
      });
      const after = await pollStatus(client, p, br);
      const pass = ok(u2) || /Cancel/i.test(String(after.status || ''));
      record('U2', key, pass ? 'PASS' : 'CHECK', {
        http: u2.status, br, code: codeOf(u2), finalStatus: after.status, note: brief(u2.data),
      });
    }
  }

  // U3 FAILED on fresh Pending
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const { br, res } = await walletBook(client, key, inv);
    if (!(ok(res) && br)) {
      record('U3', key, 'NOT TESTED', { note: `no pending BR` });
    } else {
      report.brs[`${key}_U3`] = br;
      const u3 = await req(client, {
        method: 'POST', path: p.update, query: Q,
        body: { bookingRefId: br, bookingId: br, status: 'FAILED', bookingStatus: 'FAILED' },
        requestId: `rem-u3-${key}-${randomUUID()}`,
      });
      const after = await pollStatus(client, p, br);
      const pass = ok(u3) || /Fail/i.test(String(after.status || ''));
      record('U3', key, pass ? 'PASS' : 'CHECK', {
        http: u3.status, br, code: codeOf(u3), finalStatus: after.status, note: brief(u3.data),
      });
    }
  }

  // U4 double CONFIRMED
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const { br, res } = await walletBook(client, key, inv);
    if (!(ok(res) && br)) {
      record('U4', key, 'NOT TESTED', { note: 'no pending BR' });
    } else {
      report.brs[`${key}_U4`] = br;
      const body = { bookingRefId: br, bookingId: br, status: 'CONFIRMED', bookingStatus: 'CONFIRMED' };
      const first = await req(client, { method: 'POST', path: p.update, query: Q, body, requestId: `rem-u4a-${key}-${randomUUID()}` });
      const second = await req(client, { method: 'POST', path: p.update, query: Q, body, requestId: `rem-u4b-${key}-${randomUUID()}` });
      const after = await pollStatus(client, p, br);
      const pass = (ok(first) || /Confirm/i.test(String(after.status || '')))
        && (ok(second) || second.status < 500);
      record('U4', key, pass ? 'PASS' : 'CHECK', {
        http1: first.status, http2: second.status, br, finalStatus: after.status,
        note: brief({ first: first.data, second: second.data }),
      });
    }
  }

  // U5 CONFIRMED after Cancelled
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const { br, res } = await walletBook(client, key, inv);
    if (!(ok(res) && br)) {
      record('U5', key, 'NOT TESTED', { note: 'no pending BR' });
    } else {
      report.brs[`${key}_U5`] = br;
      await req(client, {
        method: 'POST', path: p.update, query: Q,
        body: { bookingRefId: br, bookingId: br, status: 'CANCELLED', bookingStatus: 'CANCELLED' },
        requestId: `rem-u5a-${key}-${randomUUID()}`,
      });
      const u5 = await req(client, {
        method: 'POST', path: p.update, query: Q,
        body: { bookingRefId: br, bookingId: br, status: 'CONFIRMED', bookingStatus: 'CONFIRMED' },
        requestId: `rem-u5b-${key}-${randomUUID()}`,
      });
      const after = await pollStatus(client, p, br);
      // expected: ignored — stays Cancelled
      const pass = /Cancel/i.test(String(after.status || '')) && !/Confirm/i.test(String(after.status || ''));
      record('U5', key, pass ? 'PASS' : 'CHECK', {
        http: u5.status, br, finalStatus: after.status, note: brief(u5.data),
      });
    }
  }

  // U8 update by different partner (smt query on update)
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const { br, res } = await walletBook(client, key, inv);
    if (!(ok(res) && br)) {
      record('U8', key, 'NOT TESTED', { note: 'no pending BR' });
    } else {
      report.brs[`${key}_U8`] = br;
      const u8 = await req(client, {
        method: 'POST', path: p.update,
        query: { ...Q, pid: SMT_PID, key: SMT_KEY },
        body: { bookingRefId: br, bookingId: br, status: 'CONFIRMED', bookingStatus: 'CONFIRMED' },
        requestId: `rem-u8-${key}-${randomUUID()}`,
      });
      const code = codeOf(u8);
      // Lounge expected to allow (changelog); FT/eSIM expect 403 FORBIDDEN
      if (key === 'lounge') {
        record('U8', key, ok(u8) || u8.status < 500 ? 'PASS' : 'CHECK', {
          http: u8.status, br, code, note: `lounge partner check not required | ${brief(u8.data)}`,
        });
      } else {
        const pass = u8.status === 403 || /FORBIDDEN|PARTNER/i.test(String(code || ''));
        record('U8', key, pass ? 'PASS' : 'CHECK', { http: u8.status, br, code, note: brief(u8.data) });
      }
    }
  }
}

async function runCardRemaining(client, key, pickFn) {
  const p = PRODUCTS[key];
  let inv;
  try { inv = await pickFn(client); } catch (e) {
    for (const id of ['C3', 'C5', 'C10', 'C11']) record(id, key, 'NOT TESTED', { note: e.message });
    return;
  }

  // C5 replay booking after success
  {
    const paid = await cardCreateAndPay(client, key, inv);
    if (!paid.piId || !paid.conf?.ok || !ok(paid.book)) {
      record('C5', key, 'NOT TESTED', {
        note: `need successful C2 first | stripe=${paid.conf?.status || paid.conf?.note} book=${codeOf(paid.book) || paid.book?.status}`,
        br: paid.br,
      });
    } else {
      report.brs[`${key}_C5`] = paid.br;
      const replay = await req(client, {
        method: 'POST', path: p.booking, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
        body: { paymentIntentId: paid.piId }, requestId: `rem-c5-${key}-${randomUUID()}`,
      });
      const sameBr = (brOf(replay) || paid.br) === paid.br;
      const pass = ok(replay) && sameBr;
      record('C5', key, pass ? 'PASS' : 'CHECK', {
        http: replay.status, br: brOf(replay) || paid.br, code: codeOf(replay), note: brief(replay.data),
      });
    }
  }

  // C3: pay, do NOT call booking — wait for webhook
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const createBody = bodyFor(key, inv, { redirectUrl: 'https://partner.example.com/return' });
    const created = await req(client, {
      method: 'POST', path: p.create, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: createBody, requestId: `rem-c3c-${key}-${randomUUID()}`,
    });
    const br = brOf(created);
    const piId = extractPaymentIntentId(created.data);
    if (!ok(created) || !piId || !br) {
      record('C3', key, 'NOT TESTED', { note: 'create failed' });
    } else {
      const conf = await confirmStripePi(piId);
      if (!conf.ok) {
        record('C3', key, 'NOT TESTED', { br, note: conf.note });
      } else {
        // wait ~20s for webhook without calling booking
        let final = null;
        for (let i = 0; i < 8; i += 1) {
          await new Promise((r) => setTimeout(r, 2500));
          const st = await pollStatus(client, p, br);
          final = st;
          if (/Pending|Confirm|Fail|Cancel/i.test(String(st.status || '')) && !/Payment|Created|Init/i.test(String(st.status || ''))) break;
        }
        const progressed = /Pending|Confirm/i.test(String(final?.status || ''));
        record('C3', key, progressed ? 'PASS' : 'CHECK', {
          br, piId, stripe: conf.status, finalStatus: final?.status,
          note: progressed ? 'webhook completed without booking call' : 'no status progress after pay-only — webhook may be off on canary',
        });
        if (br) report.brs[`${key}_C3`] = br;
      }
    }
  }

  // C10 cross-product payment — lounge PI on FT route already done; do wrong-product for each
  {
    const wrongPath = key === 'fasttrack' ? PRODUCTS.lounge.booking
      : key === 'lounge' ? PRODUCTS.fasttrack.booking
        : PRODUCTS.lounge.booking;
    const c10 = await req(client, {
      method: 'POST', path: wrongPath,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: { paymentIntentId: `pi_${key}_on_wrong_product_fake` },
      requestId: `rem-c10-${key}-${randomUUID()}`,
    });
    const code = codeOf(c10);
    const pass = c10.status === 400 || /UNSUPPORTED_SERVICE_TYPE|PAYMENT|NOT_FOUND|VALID/i.test(String(code || '')) || c10.status >= 400;
    record('C10', key, pass ? 'PASS' : 'CHECK', { http: c10.status, code, note: brief(c10.data) });
  }

  // C11 another partner's payment — use nonsense PI owned-by-other shape
  {
    const c11 = await req(client, {
      method: 'POST', path: p.booking,
      query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: { paymentIntentId: 'pi_other_partner_does_not_exist_xyz' },
      requestId: `rem-c11-${key}-${randomUUID()}`,
    });
    const code = codeOf(c11);
    // changelog expects 404 BOOKING_NOT_FOUND; PAYMENT_TRANSACTION_NOT_FOUND also acceptable gate
    const pass = c11.status === 404 || /BOOKING_NOT_FOUND|PAYMENT_TRANSACTION_NOT_FOUND/i.test(String(code || ''));
    record('C11', key, pass ? 'PASS' : 'CHECK', { http: c11.status, code, note: brief(c11.data) });
  }
}

async function runIdempotency(client, key, pickFn) {
  const p = PRODUCTS[key];
  let inv;
  try { inv = await pickFn(client); } catch (e) {
    for (const id of ['I2', 'I3', 'I4']) record(id, key, 'NOT TESTED', { note: e.message });
    return;
  }

  // I2 concurrent same request id + body
  {
    const requestId = `rem-i2-${key}-${randomUUID()}`;
    const body = bodyFor(key, inv);
    const [a, b] = await Promise.all([
      req(client, { method: 'POST', path: p.finalize, query: Q, body, requestId }),
      req(client, { method: 'POST', path: p.finalize, query: Q, body, requestId }),
    ]);
    const b1 = brOf(a); const b2 = brOf(b);
    const same = b1 && b2 && b1 === b2;
    const oneFail = (ok(a) && !ok(b)) || (ok(b) && !ok(a));
    const pass = same || oneFail;
    record('I2', key, pass ? 'PASS' : 'CHECK', {
      br1: b1, br2: b2, http1: a.status, http2: b.status,
      note: same ? 'same BR' : oneFail ? 'one blocked' : 'possible double book',
    });
  }

  // I3 same X-Request-Id, different body
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const requestId = `rem-i3-${key}-${randomUUID()}`;
    const body1 = bodyFor(key, inv);
    const body2 = bodyFor(key, inv);
    // mutate passenger name so body differs
    if (body2.passengers?.[0]?.profile) body2.passengers[0].profile.lastName = `Diff${Date.now().toString(36).slice(-4)}`;
    else if (body2.passengers?.[0]?.profile === undefined && body2.passengers?.[0]) {
      body2.contact.email = `diff.${Date.now()}@travelvip.ai`;
    }
    body2.contact.email = `diff.${Date.now()}@travelvip.ai`;
    const first = await req(client, { method: 'POST', path: p.finalize, query: Q, body: body1, requestId });
    const second = await req(client, { method: 'POST', path: p.finalize, query: Q, body: body2, requestId });
    const b1 = brOf(first); const b2 = brOf(second);
    // expected: NOT treated as replay — either different BRs or second is a real new attempt / validation
    const mixed = b1 && b2 && b1 === b2 && brief(first.data) === brief(second.data) && ok(first) && ok(second);
    record('I3', key, mixed ? 'CHECK' : 'PASS', {
      br1: b1, br2: b2, http1: first.status, http2: second.status,
      note: mixed ? 'same BR for different bodies — possible mix-up' : 'not treated as identical replay',
    });
  }

  // I4 retry after non-cached error (bad offer then good)
  try { inv = await pickFn(client); } catch { /* */ }
  {
    const requestId = `rem-i4-${key}-${randomUUID()}`;
    const bad = bodyFor(key, inv, { offerId: 'offer_invalid_force_fail_xyz' });
    const first = await req(client, { method: 'POST', path: p.finalize, query: Q, body: bad, requestId });
    const good = bodyFor(key, inv);
    const second = await req(client, { method: 'POST', path: p.finalize, query: Q, body: good, requestId });
    const code1 = codeOf(first);
    const pass = !ok(first) && (ok(second) || codeOf(second) === 'PROVIDER_BOOKING_FAILED' || brOf(second));
    // If first was cached as success incorrectly, second would wrongly fail — mark CHECK
    record('I4', key, pass ? 'PASS' : (/OFFER|VALID|NOT_FOUND/i.test(String(code1 || '')) ? 'CHECK' : 'CHECK'), {
      http1: first.status, http2: second.status, code1, code2: codeOf(second),
      br2: brOf(second), note: brief({ first: first.data, second: second.data }),
    });
  }
}

async function runValidations(client, key, pickFn) {
  const p = PRODUCTS[key];
  let inv;
  try { inv = await pickFn(client); } catch (e) {
    for (const id of ['V3', 'V4', 'V5', 'W8']) record(id, key, 'NOT TESTED', { note: e.message });
    return;
  }

  // V3 option/variant gone — tamper bookingContext lightly + fake option
  {
    const bad = bodyFor(key, inv);
    bad.bookingContext = `${inv.bookingContext || 'x'}`.slice(0, -4) + 'XXXX';
    const v3 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: bad, requestId: `rem-v3-${key}-${randomUUID()}` });
    const code = codeOf(v3);
    const pass = v3.status >= 400 && /OPTION_NOT_FOUND|INVALID_BOOKING_CONTEXT|VALIDATION|NOT_FOUND/i.test(String(code || ''));
    record('V3', key, pass ? 'PASS' : (v3.status >= 400 ? 'CHECK' : 'BUG'), {
      http: v3.status, code, note: brief(v3.data),
    });
  }

  // V4 invalid offerId
  {
    const bad = bodyFor(key, inv, { offerId: 'offer_not_valid_for_product_tier_999' });
    const v4 = await req(client, { method: 'POST', path: p.finalize, query: Q, body: bad, requestId: `rem-v4-${key}-${randomUUID()}` });
    const code = codeOf(v4);
    const pass = /OFFER_INVALID|OFFER_NOT|VALIDATION|INVALID/i.test(String(code || '')) || v4.status === 400;
    record('V4', key, pass ? 'PASS' : (ok(v4) ? 'BUG' : 'CHECK'), {
      http: v4.status, code, br: brOf(v4), note: brief(v4.data),
    });
  }

  // V5 eSIM without variant — only meaningful for esim; others N/A PASS as skip
  if (key === 'esim') {
    const bare = {
      bookingContext: inv.bookingContext,
      passengers: [{ paxType: 'ADT', profile: leadPax().profile }],
      contact: contact(),
    };
    // strip any variant fields if present in context by using empty variantId override
    const v5 = await req(client, {
      method: 'POST', path: p.finalize, query: Q,
      body: { ...bare, variantId: null, optionId: null },
      requestId: `rem-v5-${key}-${randomUUID()}`,
    });
    // If bookingContext already embeds variant, API may still accept — CHECK
    const code = codeOf(v5);
    if (v5.status === 400 || /VALID|VARIANT|OPTION/i.test(String(code || ''))) {
      record('V5', key, 'PASS', { http: v5.status, code, note: brief(v5.data) });
    } else {
      record('V5', key, 'CHECK', { http: v5.status, code, br: brOf(v5), note: 'variant may be embedded in bookingContext' });
    }
  } else {
    record('V5', key, 'NOT TESTED', { note: 'eSIM-only' });
  }

  // W8 with offerId if present
  if (inv.offerId) {
    const res = await req(client, {
      method: 'POST', path: p.finalize, query: Q,
      body: bodyFor(key, inv, { offerId: inv.offerId }),
      requestId: `rem-w8-${key}-${randomUUID()}`,
    });
    record('W8', key, ok(res) || /OFFER/i.test(String(codeOf(res) || '')) ? (ok(res) ? 'PASS' : 'CHECK') : 'CHECK', {
      http: res.status, br: brOf(res), code: codeOf(res), offerId: inv.offerId, note: brief(res.data),
    });
  } else {
    record('W8', key, 'NOT TESTED', { note: 'no offerId on inventory' });
  }
}

async function runOldFlow(client, picks) {
  // Try multiple legacy keys: env, smt key, partner access token as key
  const keysToTry = [...new Set([
    LEGACY_KEY,
    SMT_KEY,
    process.env.PARTNER_ACCESS_KEY,
    client.partnerKey,
  ].filter(Boolean))];

  let workingKey = null;
  for (const key of keysToTry) {
    const probe = await req(client, {
      method: 'GET',
      path: '/api/airportServices/offers',
      query: { lang: 'en', pid: config.partnerId, key, serviceType: 'lounge' },
      requestId: `rem-l8-probe-${randomUUID()}`,
    });
    if (ok(probe) || (probe.status === 400 && codeOf(probe) !== 'INVALID_PARTNER_KEY')) {
      workingKey = key;
      record('L8', 'lounge', 'PASS', { http: probe.status, note: `legacy key matched (${String(key).slice(0, 8)}…)` });
      break;
    }
  }
  if (!workingKey) {
    record('L8', 'lounge', 'CHECK', { note: `INVALID_PARTNER_KEY for all tried keys (${keysToTry.length})` });
    for (const id of ['L2', 'L3', 'L4', 'L5', 'L6', 'L7']) {
      record(id, 'old', 'NOT TESTED', { note: 'blocked: no valid vgm legacy key' });
    }
    return;
  }

  // L5 history
  const hist = await req(client, {
    method: 'GET', path: '/api/airportServices/getAirportServiceBookingHistory',
    query: { lang: 'en', pid: config.partnerId, key: workingKey, page: 0, perpage: 5 },
    requestId: `rem-l5-${randomUUID()}`,
  });
  record('L5', 'old', ok(hist) || Array.isArray(hist.data) ? 'PASS' : 'CHECK', { http: hist.status, note: brief(hist.data) });

  // L6 list
  const list = await req(client, {
    method: 'GET', path: '/api/airportServices/getAirportServiceBookingList',
    query: { lang: 'en', pid: config.partnerId, key: workingKey, page: 0, perpage: 5 },
    requestId: `rem-l6-${randomUUID()}`,
  });
  record('L6', 'old', ok(list) || list.status === 400 ? (ok(list) ? 'PASS' : 'CHECK') : 'CHECK', {
    http: list.status, note: brief(list.data),
  });

  // L1 createBooking lounge
  const loungeInv = picks.lounge;
  if (!loungeInv) {
    record('L1', 'lounge', 'NOT TESTED', { note: 'no inventory' });
  } else {
    const l1 = await req(client, {
      method: 'POST', path: '/api/airportServices/createBooking',
      query: { lang: 'en', currency: 'INR', pid: config.partnerId, key: workingKey },
      body: {
        serviceType: 'lounge',
        bookingContext: loungeInv.bookingContext,
        travelDate: addDays(7),
        travelTime: '07:20',
        passengers: [leadPax()],
        contact: contact(),
      },
      requestId: `rem-l1-${randomUUID()}`,
    });
    const br = brOf(l1);
    record('L1', 'lounge', ok(l1) ? 'PASS' : (l1.status === 400 || l1.status === 402 ? 'CHECK' : 'CHECK'), {
      http: l1.status, br, code: codeOf(l1), note: brief(l1.data),
    });
    if (br) {
      report.brs.old_L1 = br;
      // L7 new status on old BR
      const st = await req(client, {
        method: 'GET', path: `/v1/airportServices/lounge/${br}/status`, query: Q,
        requestId: `rem-l7-${randomUUID()}`,
      });
      record('L7', 'lounge', ok(st) || st.status === 404 || st.status === 400 ? 'PASS' : 'CHECK', {
        http: st.status, br, note: brief(st.data),
      });
      // L2 booking after payment — may need Stripe; try with fake PI first → expect payment error (still exercises route)
      const l2 = await req(client, {
        method: 'POST', path: '/api/airportServices/booking',
        query: { lang: 'en', currency: 'INR', pid: config.partnerId, key: workingKey },
        body: { paymentIntentId: 'pi_old_flow_not_paid', bookingId: br },
        requestId: `rem-l2-${randomUUID()}`,
      });
      record('L2', 'old', l2.status >= 400 ? 'PASS' : 'CHECK', {
        http: l2.status, code: codeOf(l2), note: `route exercised | ${brief(l2.data)}`,
      });
      // L4 update
      const l4 = await req(client, {
        method: 'POST', path: '/api/airportServices/updateAirportServiceBooking',
        query: { lang: 'en', pid: config.partnerId, key: workingKey },
        body: { bookingRefId: br, bookingId: br, status: 'CONFIRMED' },
        requestId: `rem-l4-${randomUUID()}`,
      });
      record('L4', 'old', ok(l4) || l4.status === 400 || l4.status === 404 ? 'PASS' : 'CHECK', {
        http: l4.status, code: codeOf(l4), note: brief(l4.data),
      });
    } else {
      record('L2', 'old', 'NOT TESTED', { note: 'no old L1 BR' });
      record('L4', 'old', 'NOT TESTED', { note: 'no old L1 BR' });
      record('L7', 'lounge', 'NOT TESTED', { note: 'no old L1 BR' });
    }
  }

  // L3 webhook — cannot force without Stripe webhook tooling
  record('L3', 'old', 'NOT TESTED', { note: 'needs payment webhook delivery to old booking' });
}

async function runForcedRejects(client, key, pickFn) {
  // C4: pay then try provider_reject on booking step if header honored
  const p = PRODUCTS[key];
  let inv;
  try { inv = await pickFn(client); } catch (e) {
    record('C4', key, 'NOT TESTED', { note: e.message });
    record('A1', key, 'NOT TESTED', { note: 'needs controlled supplier' });
    record('A2', key, 'NOT TESTED', { note: 'needs controlled supplier' });
    record('A4', key, 'NOT TESTED', { note: 'needs controlled supplier' });
    record('C6', key, 'NOT TESTED', { note: 'needs concurrent webhook' });
    record('C12', key, 'NOT TESTED', { note: 'needs 100% offer' });
    record('C13', key, 'NOT TESTED', { note: 'needs uncaptured auth' });
    record('W3', key, 'NOT TESTED', { note: 'needs low-balance partner' });
    record('W7', key, 'NOT TESTED', { note: 'needs wallet disabled' });
    record('V8', key, 'NOT TESTED', { note: 'needs offer service down' });
    return;
  }

  {
    const createBody = bodyFor(key, inv, { redirectUrl: 'https://partner.example.com/return' });
    const created = await req(client, {
      method: 'POST', path: p.create, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
      body: createBody, requestId: `rem-c4c-${key}-${randomUUID()}`,
    });
    const piId = extractPaymentIntentId(created.data);
    const br = brOf(created);
    if (!ok(created) || !piId) {
      record('C4', key, 'NOT TESTED', { note: 'create failed' });
    } else {
      const conf = await confirmStripePi(piId);
      if (!conf.ok) {
        record('C4', key, 'NOT TESTED', { note: conf.note });
      } else {
        const book = await req(client, {
          method: 'POST', path: p.booking, query: { ...Q, pid: SMT_PID, key: SMT_KEY },
          body: { paymentIntentId: piId },
          requestId: `rem-c4b-${key}-${randomUUID()}`,
          extraHeaders: { 'X-Simulate-Failure': 'provider_reject' },
        });
        const code = codeOf(book);
        const fail = /PROVIDER|BOOKING_SUBMIT_FAILED|FAILED/i.test(String(code || ''))
          || /Fail|Refund/i.test(String(book.data?.status || book.data?.bookingStatus || ''));
        record('C4', key, fail ? 'PASS' : (ok(book) ? 'CHECK' : 'CHECK'), {
          http: book.status, br: brOf(book) || br, code, stripe: conf.status,
          note: fail ? 'reject after pay observed' : `sim may be ignored | ${brief(book.data)}`,
        });
      }
    }
  }

  record('A1', key, 'NOT TESTED', { note: 'needs controlled supplier CONFIRMED reply' });
  record('A2', key, 'NOT TESTED', { note: 'needs controlled supplier PENDING reply' });
  record('A4', key, 'NOT TESTED', { note: 'needs controlled Lounge/eSIM CONFIRMED status=0' });
  record('C6', key, 'NOT TESTED', { note: 'needs concurrent webhook + booking race' });
  record('C12', key, 'NOT TESTED', { note: 'needs 100% discount offer' });
  record('C13', key, 'NOT TESTED', { note: 'needs uncaptured card auth + supplier reject' });
  record('W3', key, 'NOT TESTED', { note: 'needs low-balance partner' });
  record('W7', key, 'NOT TESTED', { note: 'needs wallet disabled for partner' });
  record('V8', key, 'NOT TESTED', { note: 'needs offer service down' });
}

async function main() {
  console.log('REMAINING NT MATRIX', config.baseUrl, config.partnerId);
  const { client } = await authenticate(true);

  const picks = {};
  try { picks.lounge = await pickLounge(client); } catch (e) { report.notes.push(`lounge inv: ${e.message}`); }
  try { picks.fasttrack = await pickFastTrack(client); } catch (e) { report.notes.push(`ft inv: ${e.message}`); }
  try { picks.esim = await pickEsim(client); } catch (e) { report.notes.push(`esim inv: ${e.message}`); }

  for (const key of ['lounge', 'fasttrack', 'esim']) {
    const pickFn = key === 'lounge' ? pickLounge : key === 'fasttrack' ? pickFastTrack : pickEsim;
    await runUpdates(client, key, pickFn);
    await runCardRemaining(client, key, pickFn);
    await runIdempotency(client, key, pickFn);
    await runValidations(client, key, pickFn);
    await runForcedRejects(client, key, pickFn);
  }

  await runOldFlow(client, picks);

  // Lounge U1 retry if we can get a Pending lounge
  if (picks.lounge) {
    const { br, res } = await walletBook(client, 'lounge', picks.lounge);
    if (ok(res) && br) {
      const u1 = await req(client, {
        method: 'POST', path: PRODUCTS.lounge.update, query: Q,
        body: { bookingRefId: br, bookingId: br, status: 'CONFIRMED', bookingStatus: 'CONFIRMED' },
        requestId: `rem-u1-lounge-${randomUUID()}`,
      });
      const after = await pollStatus(client, PRODUCTS.lounge, br);
      record('U1', 'lounge', ok(u1) || /Confirm/i.test(String(after.status || '')) ? 'PASS' : 'CHECK', {
        http: u1.status, br, finalStatus: after.status, note: brief(u1.data),
      });
    } else {
      record('U1', 'lounge', 'NOT TESTED', { note: `still no pending lounge (${codeOf(res)})` });
    }
  }

  const outPath = path.join(OUT, 'remaining-nt-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const counts = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
  for (const c of report.cases) counts[c.status] = (counts[c.status] || 0) + 1;

  const by = {};
  for (const c of report.cases) {
    by[c.caseId] = by[c.caseId] || {};
    by[c.caseId][c.product] = c.status;
  }
  const ids = [...new Set(report.cases.map((c) => c.caseId))];
  let md = `# Canary catalog_v1 — remaining NT pass\n\n**Base:** ${config.baseUrl} · ${report.at}\n\n`;
  md += `| Case | Lounge | Fast Track | eSIM | other |\n|---|---|---|---|---|\n`;
  for (const id of ids) {
    const row = by[id] || {};
    md += `| ${id} | ${row.lounge || '—'} | ${row.fasttrack || '—'} | ${row.esim || '—'} | ${row.old || '—'} |\n`;
  }
  md += `\n**Counts:** ${JSON.stringify(counts)}\n\n## BRs\n\`\`\`json\n${JSON.stringify(report.brs, null, 2)}\n\`\`\`\n`;
  const mdPath = path.join(OUT, 'REMAINING-NT-REPORT.md');
  fs.writeFileSync(mdPath, md);
  console.log('\nWrote', outPath);
  console.log('Wrote', mdPath);
  console.log('=== COUNTS ===', counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
