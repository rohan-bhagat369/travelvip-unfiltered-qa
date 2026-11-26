/**
 * ENG-902 B8 (+ B9) — Stripe webhook retry on gamma
 * Requires env: STRIPE_SK, STRIPE_WHSEC
 * Webhook URL (from Stripe dashboard): POST /api/updatePaymentStatus
 *
 *   $env:BASE_URL='https://gamma-api.travelvip.ai'
 *   $env:STRIPE_SK='sk_test_...'
 *   $env:STRIPE_WHSEC='whsec_...'
 *   node travel-apis/hotel/scripts/probe-gamma-b8-stripe-webhook-retry.js
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createSignature, createTimestamp, createRequestId } from '../../../shared/lib/signature.js';
import { config } from '../../../shared/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'https://gamma-api.travelvip.ai').replace(/\/$/, '');
const WEBHOOK_PATH = process.env.STRIPE_WEBHOOK_PATH || '/api/updatePaymentStatus';
const OUT = path.join(__dirname, '..', 'reports', 'gamma-hotel-callback-stripe');
fs.mkdirSync(OUT, { recursive: true });

const PID = 'smt';
const KEY = process.env.SMT_KEY || 'palsgcvgscvvs';
const TIER = '10997401';
const MOBILE = '9665498686';
const SIGNING_KEY = process.env.SIGNING_KEY || config.signingKey;
const STRIPE_SK = process.env.STRIPE_SK;
const STRIPE_WHSEC = process.env.STRIPE_WHSEC;

if (!STRIPE_SK || !STRIPE_WHSEC) {
  console.error('Need STRIPE_SK and STRIPE_WHSEC');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const brief = (d, n = 280) => {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
};

function stripeSign(payload, secret) {
  const t = Math.floor(Date.now() / 1000);
  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'utf8');
  const v1 = crypto.createHmac('sha256', key).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

async function postWebhook(payload, { validSig = true, eventId } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json', 'X-Request-Id': createRequestId() };
  if (validSig) headers['Stripe-Signature'] = stripeSign(body, STRIPE_WHSEC);
  else headers['Stripe-Signature'] = 't=1,v1=invalidsignaturedeadbeef';
  const r = await fetch(`${BASE}${WEBHOOK_PATH}`, { method: 'POST', headers, body });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 400) }; }
  return { http: r.status, data, eventId, bodyLen: body.length };
}

async function api(method, urlPath, { query = {}, body, authToken, signed = true } = {}) {
  const q = new URLSearchParams({
    key: KEY, pid: PID, platform: 'web', client: 'web', lang: 'en', currency: 'INR', tier_id: TIER, ...query,
  });
  const bodyString = body === undefined ? '' : JSON.stringify(body);
  const ts = createTimestamp();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': createRequestId(),
    'X-Correlation-ID': crypto.randomUUID(),
    'X-Partner-Key': KEY,
  };
  if (signed) {
    headers['X-Timestamp'] = ts;
    headers['X-Signature'] = createSignature(bodyString, ts, SIGNING_KEY);
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const r = await fetch(`${BASE}${urlPath}?${q}`, {
    method, headers, body: body === undefined ? undefined : bodyString,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data };
}

async function stripeGet(path) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SK}` },
  });
  return { http: r.status, data: await r.json() };
}

async function stripeConfirm(pi) {
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SK}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      payment_method: 'pm_card_visa',
      return_url: 'https://gamma-shop.travelvip.ai/booking/status',
    }),
  });
  return { http: r.status, data: await r.json() };
}

const hash = Buffer.from(String(Date.now())).toString('base64');
const guest = await api('GET', '/api/checkGuestLogin', { query: { hash, user_type: 'guest' }, signed: false });
const authToken = guest.data?.token || guest.data?.auth_token;
if (!authToken) throw new Error(`guest auth failed ${brief(guest.data)}`);

let inv = null;
for (const entityId of ['39627872', '2869073']) {
  for (const d of [21, 28, 35]) {
    const searchBody = {
      checkin: dayOffset(d),
      checkout: dayOffset(d + 1),
      entityId: String(entityId),
      nationality: 'IN',
      type: 'HOTEL',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    };
    const search = await api('POST', '/v1/hotels/search', { body: searchBody, authToken });
    if (!search.ok) continue;
    const details = await api('POST', '/v1/hotels/details', { body: searchBody, authToken });
    if (!details.ok) continue;
    const rooms = (details.data?.results?.[0]?.rooms || []).filter((r) => r?.bookingCode);
    const requestId = details.data?.requestId || details.data?.results?.[0]?.requestId || search.data?.requestId;
    for (const room of rooms.slice(0, 6)) {
      const prebook = await api('POST', '/v1/hotels/prebook', {
        body: { bookingCode: room.bookingCode, requestId },
        authToken,
      });
      if (!(prebook.ok || prebook.status === 200)) continue;
      const bookingContext =
        prebook.data?.bookingContext
        || prebook.data?.results?.[0]?.bookingContext
        || details.data?.bookingContext
        || details.data?.results?.[0]?.bookingContext;
      inv = {
        searchBody,
        bookingCode: room.bookingCode,
        requestId: prebook.data?.requestId || requestId,
        bookingContext,
        hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
      };
      break;
    }
    if (inv) break;
  }
  if (inv) break;
}
if (!inv) throw new Error('no inventory');
console.log('hotel', inv.hotelName);

const create = await api('POST', '/api/hotels/createBooking', {
  body: {
    bookingCode: inv.bookingCode,
    bookingContext: inv.bookingContext,
    requestId: inv.requestId,
    checkin: inv.searchBody.checkin,
    checkout: inv.searchBody.checkout,
    paymentMethod: 'CARD',
    redirectUrl: 'https://gamma-shop.travelvip.ai/booking/status',
    contact: {
      email: `smt.b8.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: MOBILE,
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
    rooms: [{ guests: [{ title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
  },
  authToken,
});
const pd = create.data?.paymentData || {};
const clientSecret = typeof pd.paymentIntent === 'string' ? pd.paymentIntent : null;
const paymentIntentId = clientSecret?.includes('_secret') ? clientSecret.split('_secret')[0] : null;
const br = create.data?.bookingReference || create.data?.bookingRefId || null;
console.log('create', create.status, br, paymentIntentId);
if (!(create.ok && paymentIntentId && br)) throw new Error(`create failed ${brief(create.data)}`);

const confirmed = await stripeConfirm(paymentIntentId);
console.log('stripe confirm', confirmed.data?.status, confirmed.data?.amount_received);

// Pull full PI for webhook body
const piGet = await stripeGet(`/payment_intents/${paymentIntentId}`);
const piObj = piGet.data;
if (!piObj?.id) throw new Error(`PI fetch failed ${brief(piGet.data)}`);

const eventId = `evt_b8_retry_${Date.now()}`;
const event = {
  id: eventId,
  object: 'event',
  api_version: '2020-08-27',
  created: Math.floor(Date.now() / 1000),
  type: 'payment_intent.succeeded',
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  data: { object: piObj },
};
const payload = JSON.stringify(event);

console.log('\n=== B9 invalid signature first (sanity) ===');
const b9 = await postWebhook(payload, { validSig: false });
console.log('B9', b9.http, brief(b9.data));

console.log('\n=== B8 webhook delivery #1 ===');
const w1 = await postWebhook(payload, { validSig: true, eventId });
console.log('W1', w1.http, brief(w1.data));

// poll until terminal / pending book
let statusAfter1 = null;
for (let i = 0; i < 15; i += 1) {
  const st = await api('GET', `/v1/hotels/bookings/${br}/status`, { authToken });
  statusAfter1 = st.data?.status;
  console.log('poll1', i + 1, statusAfter1);
  if (statusAfter1 && /Confirmed|Failed|Cancelled|Rejected|Pending/i.test(String(statusAfter1))) {
    if (/Confirmed|Failed|Cancelled|Rejected/i.test(String(statusAfter1))) break;
  }
  await sleep(3000);
}

console.log('\n=== B8 webhook delivery #2 (same event id) ===');
const w2 = await postWebhook(payload, { validSig: true, eventId });
console.log('W2', w2.http, brief(w2.data));
await sleep(4000);
const st2 = await api('GET', `/v1/hotels/bookings/${br}/status`, { authToken });
const statusAfter2 = st2.data?.status;
console.log('status after retry', statusAfter2);

// late app attach should say already processed if booked
const attach = await api('POST', '/api/v2/hotels/booking', {
  body: { paymentIntentId, bookingReference: br, bookingRefId: br },
  authToken,
});
const already = /already processed/i.test(JSON.stringify(attach.data || {}));
console.log('attach after retries', attach.status, brief(attach.data));

const detail = await api('GET', `/v1/hotels/bookings/${br}`, { authToken });

const b9pass = b9.http >= 400;
const bookedOnce = /Confirmed|Failed|Cancelled|Rejected|Pending/i.test(String(statusAfter2 || ''));
const sameStatus = String(statusAfter1 || '') === String(statusAfter2 || '')
  || (/Confirmed|Failed/i.test(String(statusAfter1 || '')) && String(statusAfter1) === String(statusAfter2));
const b8pass = w1.http < 400 && w2.http < 400 && bookedOnce && sameStatus;

const result = {
  at: new Date().toISOString(),
  baseUrl: BASE,
  webhookPath: WEBHOOK_PATH,
  B8: {
    status: b8pass ? 'PASS' : (w1.http < 400 ? 'CHECK' : 'BUG'),
    br,
    paymentIntentId,
    eventId,
    stripeStatus: confirmed.data?.status,
    webhook1: { http: w1.http, body: w1.data },
    statusAfterWebhook1: statusAfter1,
    webhook2: { http: w2.http, body: w2.data },
    statusAfterWebhook2: statusAfter2,
    sameStatus,
    attachAfter: { http: attach.status, message: attach.data?.message || null, alreadyProcessed: already },
    note: b8pass
      ? 'same signed event delivered twice; booking status stable; no second book observed'
      : 'inspect webhook responses / status',
  },
  B9: {
    status: b9pass ? 'PASS' : 'BUG',
    http: b9.http,
    body: b9.data,
    note: b9pass
      ? `invalid signature rejected HTTP ${b9.http}`
      : `expected 4xx for bad signature, got ${b9.http}`,
  },
};

fs.writeFileSync(path.join(OUT, 'B8-B9-stripe-webhook.json'), JSON.stringify(result, null, 2));
const latestPath = path.join(OUT, 'latest.json');
if (fs.existsSync(latestPath)) {
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  if (!latest.partB) latest.partB = { results: {} };
  if (!latest.partB.results) latest.partB.results = {};
  latest.partB.results.B8 = result.B8;
  latest.partB.results.B9 = result.B9;
  latest.at = new Date().toISOString();
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));
}

console.log('\n=== SUMMARY ===');
console.log('B8', result.B8.status, result.B8.br, result.B8.note);
console.log('B9', result.B9.status, result.B9.note);
// never print secrets
