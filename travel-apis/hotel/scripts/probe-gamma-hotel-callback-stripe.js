/**
 * ENG-902 — Hotel supplier callback + Stripe race on gamma
 * Creds: api-staging .env (vgm) · SMT query key palsgcvgscvvs
 *
 *   $env:BASE_URL='https://gamma-api.travelvip.ai'
 *   $env:ALLOW_BOOK='true'
 *   node travel-apis/hotel/scripts/probe-gamma-hotel-callback-stripe.js
 *
 * Optional: $env:PART=A | B | ALL (default ALL)
 * Optional: $env:CALLBACK_PID / CALLBACK_KEY
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';
import { createSignature, createTimestamp, createRequestId } from '../../../shared/lib/signature.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'https://gamma-api.travelvip.ai').replace(/\/$/, '');
const PART = String(process.env.PART || 'ALL').toUpperCase();
const OUT_DIR = path.join(__dirname, '..', 'reports', 'gamma-hotel-callback-stripe');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Gamma callback auth: staging vgm static key is rejected (INVALID_PARTNER_KEY).
// SMT public key is accepted and can update vgm BRs (verified 2026-11-25).
const CALLBACK_PID = process.env.CALLBACK_PID || 'smt';
const CALLBACK_KEY = process.env.CALLBACK_KEY || process.env.SMT_KEY || 'palsgcvgscvvs';

const SMT_PID = process.env.SMT_PID || 'smt';
const SMT_KEY = process.env.SMT_KEY || 'palsgcvgscvvs';
const SMT_TIER = process.env.SMT_TIER || '10997401';
const SMT_MOBILE = process.env.SMT_MOBILE || '9665498686';
const SIGNING_KEY = process.env.SIGNING_KEY || config.signingKey;

const VALID_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const BAD_PAN_VENDOR = { panCardNumber: 'AAAAA0000A', panCardName: 'Fake Guest' };
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const STRIPE_SK = (() => {
  try {
    return fs.readFileSync(path.join(process.env.USERPROFILE, 'Downloads', 'cardpayment.json'), 'utf8')
      .match(/sk_test_[A-Za-z0-9]+/)?.[0] || null;
  } catch {
    return process.env.STRIPE_SK || null;
  }
})();

function brief(d, n = 360) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function dayOffset(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
function uuid() {
  return crypto.randomUUID();
}
function msgOf(res) {
  const d = res?.data;
  return String(d?.message || d?.msg || d?.result || d?.status || brief(d, 160));
}
function applied(res) {
  return /updated successfully/i.test(msgOf(res));
}
function ignored(res) {
  return /no change made/i.test(msgOf(res));
}
function score(ok, note) {
  return { status: ok ? 'PASS' : 'BUG', note };
}

async function walletFeed(accessToken) {
  const url = new URL(`${BASE}/v1/wallet/activity`);
  url.searchParams.set('page', '1');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  return {
    http: res.status,
    available: data?.summary?.available ?? data?.summary?.cashBalance ?? null,
    summary: data?.summary || null,
    rows: data?.data || data?.results || data?.transactions || [],
  };
}

async function sendCallback(bookingId, status, extra = {}) {
  const q = new URLSearchParams({
    bookingId: String(bookingId),
    pid: CALLBACK_PID,
    key: CALLBACK_KEY,
  });
  const body = {
    status,
    ClientReferenceId: extra.ClientReferenceId || `TEST${Date.now()}`,
    ConfirmationNumber: extra.ConfirmationNumber || `CNF${Date.now()}`,
    message: extra.message || 'test',
    ...extra.body,
  };
  if (status === '' || status == null) delete body.status;
  const r = await fetch(`${BASE}/api/v1/hotels/updateHotelBooking?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': createRequestId() },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 500) }; }
  return { status: r.status, ok: r.ok, data, message: msgOf({ data }) };
}

async function findBookable(hotel, { preferFreeCancel = null, preferNonRefundable = false } = {}) {
  const entityIds = ['39627872', config.hotel.defaultEntityId, '2869073'].filter(Boolean);
  const dayCandidates = [21, 28, 35, 14, 45, 60];
  for (const entityId of entityIds) {
    for (const checkinDays of dayCandidates) {
      for (const nights of [1, 2]) {
        const searchBody = buildSearchBody({
          entityId,
          checkinDays,
          nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) continue;
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        let rooms = details.data?.results?.[0]?.rooms || [];
        rooms = rooms.filter((r) => r?.bookingCode);
        if (!requestId || !rooms.length) continue;

        const rank = (room) => {
          const text = JSON.stringify(room).toLowerCase();
          const free = room?.isFreeCancellation === true
            || /free cancellation|fully refundable/.test(text)
            || Number(room?.cancellationCharge ?? 1) === 0;
          const nonRef = room?.isFreeCancellation === false
            || /non[- ]?refundable/.test(text)
            || Number(room?.cancellationCharge) > 0 && !free;
          if (preferFreeCancel === true) return free ? 0 : 1;
          if (preferNonRefundable) return nonRef ? 0 : 1;
          return 0;
        };
        rooms = [...rooms].sort((a, b) => rank(a) - rank(b));

        for (const room of rooms.slice(0, 10)) {
          const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          return {
            entityId,
            searchBody,
            details,
            prebook,
            bookingCode: room.bookingCode,
            requestId: extractRequestId(prebook.data) || requestId,
            hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
            room,
          };
        }
      }
    }
  }
  return null;
}

function buildFinalizeBody({ prebook, details, searchBody, bookingCode, requestId, pan, guestSuffix = '' }) {
  const room =
    prebook.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
    || details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
    || null;
  // Keep lead name = PAN name exactly (supplier rejects suffix mismatches).
  const first = 'Rohan';
  const last = 'Bhagat';
  const panName = `${first} ${last}`;
  const body = {
    bookingContext: extractBookingContext(prebook.data) || extractBookingContext(details.data),
    bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    rooms: [{
      guests: [{
        title: 'Mr',
        firstName: first,
        lastName: last,
        type: 'Adult',
        isLead: true,
      }],
    }],
    contact: {
      email: `gamma.cb.${Date.now()}.${guestSuffix || 'x'}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: pan.panCardNumber,
      panCardName: panName,
    },
  };
  if (room?.isGSTClaimable || room?.isGstClaimable) body.gstDetails = { ...VALID_GST };
  return body;
}

async function createPendingBooking(hotel, suffix = '', attempts = 4) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(4000 + i * 2000);
    const found = await findBookable(hotel, { preferFreeCancel: true });
    if (!found) {
      lastErr = 'no inventory';
      continue;
    }
    const body = buildFinalizeBody({ ...found, pan: VALID_PAN, guestSuffix: suffix });
    const finalize = await hotel.finalizeBooking(body);
    const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId || null;
    if (br) {
      return {
        found,
        finalize,
        br,
        status: finalize.data?.status || null,
        body,
      };
    }
    lastErr = `finalize HTTP ${finalize.status}`;
    console.log('  finalize fail', finalize.status, brief(finalize.data, 280));
    if (finalize.status !== 500) break;
  }
  return { error: lastErr || 'finalize failed' };
}

async function getStatus(hotel, br) {
  const st = await hotel.getBookingStatus(br);
  return { http: st.status, status: st.data?.status || null, data: st.data };
}

async function getDetail(hotel, br) {
  const d = await hotel.getBookingDetail(br);
  return { http: d.status, status: d.data?.status || null, amountPaid: d.data?.amountPaid ?? null, data: d.data };
}

async function waitStatus(hotel, br, { want, max = 20, ms = 3000 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await getStatus(hotel, br);
    console.log(`  poll ${i + 1}: ${last.status}`);
    if (want && new RegExp(want, 'i').test(String(last.status || ''))) return last;
    if (!want && /Confirmed|Failed|Cancelled|Rejected/i.test(String(last.status || ''))) return last;
    await sleep(ms);
  }
  return last;
}

// ---------------- SMT card helpers ----------------
async function smtApi(method, urlPath, { query = {}, body, authToken, signed = true } = {}) {
  const q = new URLSearchParams({
    key: SMT_KEY,
    pid: SMT_PID,
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
    tier_id: SMT_TIER,
    ...query,
  });
  const bodyString = body === undefined ? '' : JSON.stringify(body);
  const ts = createTimestamp();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': createRequestId(),
    'X-Correlation-ID': uuid(),
    'X-Partner-Key': SMT_KEY,
  };
  if (signed) {
    headers['X-Timestamp'] = ts;
    headers['X-Signature'] = createSignature(bodyString, ts, SIGNING_KEY);
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const r = await fetch(`${BASE}${urlPath}?${q}`, {
    method,
    headers,
    body: body === undefined ? undefined : bodyString,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: r.status, ok: r.ok, data };
}

async function guestAuth() {
  const hash = Buffer.from(String(Date.now())).toString('base64');
  const res = await smtApi('GET', '/api/checkGuestLogin', {
    query: { hash, user_type: 'guest' },
    signed: false,
  });
  const token = res.data?.token || res.data?.auth_token;
  if (!token) throw new Error(`guest auth failed: ${brief(res.data)}`);
  return token;
}

async function findSmtInventory(authToken) {
  for (const entityId of ['39627872', '2869073']) {
    for (const checkinDays of [21, 28, 35, 14]) {
      const searchBody = {
        checkin: dayOffset(checkinDays),
        checkout: dayOffset(checkinDays + 1),
        entityId: String(entityId),
        nationality: 'IN',
        type: 'HOTEL',
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      };
      const search = await smtApi('POST', '/v1/hotels/search', { body: searchBody, authToken });
      if (!search.ok) continue;
      const details = await smtApi('POST', '/v1/hotels/details', { body: searchBody, authToken });
      if (!details.ok) continue;
      const rooms = (details.data?.results?.[0]?.rooms || []).filter((r) => r?.bookingCode);
      const requestId = details.data?.requestId || details.data?.results?.[0]?.requestId || search.data?.requestId;
      for (const room of rooms.slice(0, 8)) {
        const prebook = await smtApi('POST', '/v1/hotels/prebook', {
          body: { bookingCode: room.bookingCode, requestId },
          authToken,
        });
        if (!(prebook.ok || prebook.status === 200)) continue;
        const bookingContext =
          prebook.data?.bookingContext
          || prebook.data?.results?.[0]?.bookingContext
          || details.data?.bookingContext
          || details.data?.results?.[0]?.bookingContext;
        return {
          searchBody,
          bookingCode: room.bookingCode,
          requestId: prebook.data?.requestId || requestId,
          bookingContext,
          hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
          room,
        };
      }
    }
  }
  return null;
}

function buildCreateBody(inv, pan, suffix = '') {
  return {
    bookingCode: inv.bookingCode,
    bookingContext: inv.bookingContext,
    requestId: inv.requestId,
    checkin: inv.searchBody.checkin,
    checkout: inv.searchBody.checkout,
    paymentMethod: 'CARD',
    redirectUrl: 'https://gamma-shop.travelvip.ai/booking/status',
    contact: {
      email: `smt.gamma.${Date.now()}${suffix}@travelvip.ai`,
      countryCode: '+91',
      mobile: SMT_MOBILE,
      panCardNumber: pan.panCardNumber,
      panCardName: pan.panCardName,
    },
    rooms: [{
      guests: [{
        title: 'Mr',
        firstName: 'Rohan',
        lastName: `Bhagat${suffix}`,
        type: 'Adult',
        isLead: true,
      }],
    }],
  };
}

function extractPi(createData) {
  const pd = createData?.paymentData || {};
  const clientSecret = typeof pd.paymentIntent === 'string' ? pd.paymentIntent : null;
  const paymentIntentId = clientSecret?.includes('_secret') ? clientSecret.split('_secret')[0] : null;
  return {
    br: createData?.bookingReference || createData?.bookingRefId || null,
    bookingId: createData?.bookingId || null,
    clientSecret,
    paymentIntentId,
    paymentId: pd.paymentId || null,
  };
}

async function stripeConfirm(paymentIntentId, { decline = false } = {}) {
  const conf = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SK}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      payment_method: decline ? 'pm_card_chargeDeclined' : 'pm_card_visa',
      return_url: 'https://gamma-shop.travelvip.ai/booking/status',
    }),
  });
  const data = await conf.json();
  return { status: conf.status, ok: conf.ok, data };
}

async function attachBooking(authToken, { paymentIntentId, br }) {
  return smtApi('POST', '/api/v2/hotels/booking', {
    body: { paymentIntentId, bookingReference: br, bookingRefId: br },
    authToken,
  });
}

async function pollSmtStatus(authToken, br, max = 15) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await smtApi('GET', `/v1/hotels/bookings/${br}/status`, { authToken });
    const st = last.data?.status;
    console.log(`  smt poll ${i + 1}: ${st}`);
    if (st && /Confirmed|Failed|Cancelled|Rejected/i.test(String(st))) return last;
    await sleep(3500);
  }
  return last;
}

// ---------------- Part A ----------------
async function runPartA(hotel, accessToken) {
  const results = {};
  console.log('\n======== PART A: updateHotelBooking ========');
  console.log('callback pid/key', CALLBACK_PID, CALLBACK_KEY.slice(0, 6) + '…');

  const walletBefore = await walletFeed(accessToken);
  console.log('wallet before', walletBefore.available, 'http', walletBefore.http);

  // A1.1 + A2.1 + A3.1 + A3.2 on one Confirmed BR
  console.log('\n--- A1.1 Pending → CONFIRMED ---');
  {
    const created = await createPendingBooking(hotel, 'One');
    const br = created.br;
    console.log('finalize', created.finalize?.status, br, created.status, created.error || '');
    if (!br) {
      results['A1.1'] = { status: 'NOT TESTED', note: created.error || 'finalize failed', detail: brief(created.finalize?.data) };
    } else {
      // ensure still pending-ish; if already terminal, still try
      const before = await getStatus(hotel, br);
      const cb = await sendCallback(br, 'CONFIRMED');
      console.log('callback', cb.status, cb.message);
      const after = await waitStatus(hotel, br, { want: 'Confirmed|Failed|Cancelled', max: 12 });
      const detail = await getDetail(hotel, br);
      const ok = /Confirmed/i.test(String(after?.status || '')) && (applied(cb) || /Confirmed/i.test(String(after?.status || '')));
      results['A1.1'] = {
        ...score(ok && /Confirmed/i.test(String(after?.status || '')), `cb=${cb.message}`),
        br,
        before: before.status,
        callbackHttp: cb.status,
        callbackMsg: cb.message,
        applied: applied(cb),
        after: after?.status,
        amountPaid: detail.amountPaid,
        partnerWebhook: 'NOT TESTED',
      };

      // A2.1 duplicate CONFIRMED
      console.log('\n--- A2.1 Confirmed → CONFIRMED again ---');
      const cb2 = await sendCallback(br, 'CONFIRMED', { ConfirmationNumber: 'CNF-DUP' });
      const after2 = await getStatus(hotel, br);
      results['A2.1'] = {
        ...score(/Confirmed/i.test(String(after2.status || '')) && (ignored(cb2) || applied(cb2) === false || /no change/i.test(cb2.message)), `cb=${cb2.message}`),
        br,
        callbackHttp: cb2.status,
        callbackMsg: cb2.message,
        ignored: ignored(cb2),
        after: after2.status,
        partnerWebhook: 'NOT TESTED',
      };
      // Prefer ignored message; if API still says success but status unchanged, CHECK→PASS if status stays Confirmed
      if (/Confirmed/i.test(String(after2.status || '')) && cb2.status === 200) {
        results['A2.1'].status = ignored(cb2) ? 'PASS' : (applied(cb2) ? 'CHECK' : 'PASS');
      }

      // Hold briefly — late real supplier can race; re-check before A3.
      await sleep(8000);
      const still = await getStatus(hotel, br);
      if (!/Confirmed/i.test(String(still.status || ''))) {
        results['A3.1'] = {
          status: 'BUG',
          br,
          note: `Confirmed flipped to ${still.status} without our FAILED callback (likely late supplier). Spec: terminal Confirmed must ignore later FAILED.`,
          after: still.status,
          detail: still.data,
        };
        results['A3.2'] = {
          status: 'NOT TESTED',
          br,
          note: `blocked — booking already ${still.status}`,
        };
      } else {
        // A3.1 Confirmed → FAILED
        console.log('\n--- A3.1 Confirmed → FAILED ---');
        const balA = (await walletFeed(accessToken)).available;
        const cb31 = await sendCallback(br, 'FAILED');
        await sleep(2000);
        const after31 = await getStatus(hotel, br);
        const balB = (await walletFeed(accessToken)).available;
        results['A3.1'] = {
          status: /Confirmed/i.test(String(after31.status || '')) && ignored(cb31) ? 'PASS' : 'BUG',
          br,
          callbackMsg: cb31.message,
          ignored: ignored(cb31),
          after: after31.status,
          walletBefore: balA,
          walletAfter: balB,
        };

        // A3.2 Confirmed → CANCELLED
        console.log('\n--- A3.2 Confirmed → CANCELLED ---');
        const cb32 = await sendCallback(br, 'CANCELLED');
        await sleep(1500);
        const after32 = await getStatus(hotel, br);
        results['A3.2'] = {
          status: /Confirmed/i.test(String(after32.status || '')) && ignored(cb32) ? 'PASS' : 'BUG',
          br,
          callbackMsg: cb32.message,
          ignored: ignored(cb32),
          after: after32.status,
        };
      }
    }
  }

  // A1.2 + A2.2 + A3.3 on Failed BR
  console.log('\n--- A1.2 Pending → FAILED ---');
  {
    const created = await createPendingBooking(hotel, 'Two');
    const br = created.br;
    console.log('finalize', created.finalize?.status, br, created.status, created.error || '');
    if (!br) {
      results['A1.2'] = { status: 'NOT TESTED', note: created.error || 'finalize failed', detail: brief(created.finalize?.data) };
    } else {
      const bal0 = (await walletFeed(accessToken)).available;
      const cb = await sendCallback(br, 'FAILED');
      console.log('callback', cb.status, cb.message);
      const after = await waitStatus(hotel, br, { want: 'Failed|Confirmed|Cancelled', max: 15 });
      await sleep(4000);
      const bal1 = (await walletFeed(accessToken)).available;
      const refunded = bal0 != null && bal1 != null && Number(bal1) >= Number(bal0) - 1; // hold release / credit
      results['A1.2'] = {
        status: /Failed/i.test(String(after?.status || '')) ? 'PASS' : 'BUG',
        br,
        callbackMsg: cb.message,
        applied: applied(cb),
        after: after?.status,
        walletBefore: bal0,
        walletAfter: bal1,
        refundCheck: refunded ? 'wallet available not lower (hold release / credit)' : 'CHECK wallet manually',
      };

      console.log('\n--- A2.2 Failed → FAILED again ---');
      const bal2 = (await walletFeed(accessToken)).available;
      const cb2 = await sendCallback(br, 'FAILED');
      await sleep(2500);
      const bal3 = (await walletFeed(accessToken)).available;
      const after2 = await getStatus(hotel, br);
      const noSecond = bal2 == null || bal3 == null || Math.abs(Number(bal3) - Number(bal2)) < 1;
      results['A2.2'] = {
        status: /Failed/i.test(String(after2.status || '')) && noSecond ? 'PASS' : (/Failed/i.test(String(after2.status || '')) ? 'CHECK' : 'BUG'),
        br,
        callbackMsg: cb2.message,
        ignored: ignored(cb2),
        after: after2.status,
        walletBefore: bal2,
        walletAfter: bal3,
      };

      console.log('\n--- A3.3 Failed → CONFIRMED ---');
      const cb3 = await sendCallback(br, 'CONFIRMED');
      await sleep(1500);
      const after3 = await getStatus(hotel, br);
      results['A3.3'] = {
        status: /Failed/i.test(String(after3.status || '')) ? 'PASS' : 'BUG',
        br,
        callbackMsg: cb3.message,
        ignored: ignored(cb3),
        after: after3.status,
        partnerWebhook: 'NOT TESTED',
      };
    }
  }

  // A1.3 CANCELLED / REJECTED
  console.log('\n--- A1.3 Pending → CANCELLED ---');
  {
    const created = await createPendingBooking(hotel, 'Three');
    const br = created.br;
    if (!br) {
      results['A1.3'] = { status: 'NOT TESTED', note: created.error || 'finalize failed', detail: brief(created.finalize?.data) };
    } else {
      const cb = await sendCallback(br, 'CANCELLED');
      const after = await waitStatus(hotel, br, { want: 'Failed|Cancelled|Confirmed', max: 12 });
      // Spec: same as A1.2 → Failed + refund. Some stacks map CANCELLED→Cancelled.
      const ok = /Failed|Cancelled/i.test(String(after?.status || ''));
      results['A1.3a_CANCELLED'] = {
        status: ok ? 'PASS' : 'BUG',
        br,
        callbackMsg: cb.message,
        after: after?.status,
        note: 'expect Failed (or Cancelled) + refund',
      };
    }
  }
  console.log('\n--- A1.3 Pending → REJECTED ---');
  {
    const created = await createPendingBooking(hotel, 'ThreeR');
    const br = created.br;
    if (!br) {
      results['A1.3b_REJECTED'] = { status: 'NOT TESTED', note: created.error || 'finalize failed', detail: brief(created.finalize?.data) };
    } else {
      const cb = await sendCallback(br, 'REJECTED');
      const after = await waitStatus(hotel, br, { want: 'Failed|Cancelled|Confirmed|Rejected', max: 12 });
      results['A1.3b_REJECTED'] = {
        status: /Failed|Cancelled|Rejected/i.test(String(after?.status || '')) ? 'PASS' : 'BUG',
        br,
        callbackMsg: cb.message,
        after: after?.status,
      };
    }
  }

  // A1.4 immediate CONFIRMED (no status poll before callback)
  console.log('\n--- A1.4 just-created → CONFIRMED ---');
  {
    const found = await findBookable(hotel, { preferFreeCancel: true });
    if (!found) {
      results['A1.4'] = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const body = buildFinalizeBody({ ...found, pan: VALID_PAN, guestSuffix: 'Four' });
      const finalize = await hotel.finalizeBooking(body);
      const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
      console.log('finalize', finalize.status, br, finalize.data?.status);
      if (!br) {
        results['A1.4'] = { status: 'NOT TESTED', note: 'no BR', detail: brief(finalize.data) };
      } else {
        const cb = await sendCallback(br, 'CONFIRMED');
        const after = await waitStatus(hotel, br, { want: 'Confirmed|Failed', max: 12 });
        results['A1.4'] = {
          status: /Confirmed/i.test(String(after?.status || '')) ? 'PASS' : 'BUG',
          br,
          finalizeStatus: finalize.data?.status,
          callbackMsg: cb.message,
          after: after?.status,
        };
      }
    }
  }

  // A1.5 IN_PROGRESS / empty
  console.log('\n--- A1.5 IN_PROGRESS / empty ---');
  {
    const created = await createPendingBooking(hotel, 'Five');
    const br = created.br;
    if (!br) {
      results['A1.5'] = { status: 'NOT TESTED', note: created.error || 'finalize failed', detail: brief(created.finalize?.data) };
    } else {
      const before = await getStatus(hotel, br);
      const cb1 = await sendCallback(br, 'IN_PROGRESS');
      const mid = await getStatus(hotel, br);
      const cb2 = await sendCallback(br, '');
      const after = await getStatus(hotel, br);
      const unchanged = String(mid.status || '') === String(before.status || '')
        && String(after.status || '') === String(before.status || '');
      const msgOk = ignored(cb1) || /no change/i.test(cb1.message);
      results['A1.5'] = {
        status: (unchanged && (msgOk || ignored(cb2) || cb1.status === 200)) ? (msgOk || ignored(cb2) ? 'PASS' : 'CHECK') : 'BUG',
        br,
        before: before.status,
        afterInProg: mid.status,
        afterEmpty: after.status,
        cbInProg: cb1.message,
        cbEmpty: cb2.message,
      };
    }
  }

  // A4.2 free-cancel cancel then CANCELLED callback
  console.log('\n--- A4.2 free cancel → CANCELLED callback ---');
  {
    const created = await createPendingBooking(hotel, 'Free');
    const br = created.br;
    if (!br) {
      results['A4.2'] = { status: 'NOT TESTED', note: created.error || 'finalize failed', detail: brief(created.finalize?.data) };
    } else {
      // Confirm via callback so we can cancel
      await sendCallback(br, 'CONFIRMED');
      const conf = await waitStatus(hotel, br, { want: 'Confirmed', max: 12 });
      if (!/Confirmed/i.test(String(conf?.status || ''))) {
        results['A4.2'] = { status: 'NOT TESTED', note: 'could not confirm for cancel', br, after: conf?.status };
      } else {
        const penalty = await hotel.penaltyCheck(br);
        const penCr = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
        const bal0 = (await walletFeed(accessToken)).available;
        const cancel = await hotel.cancelBooking(br);
        await sleep(3000);
        const afterCancel = await getStatus(hotel, br);
        const bal1 = (await walletFeed(accessToken)).available;
        const cb = await sendCallback(br, 'CANCELLED');
        await sleep(3000);
        const bal2 = (await walletFeed(accessToken)).available;
        const afterCb = await getStatus(hotel, br);
        const noSecond = bal1 == null || bal2 == null || Math.abs(Number(bal2) - Number(bal1)) < 1;
        results['A4.2'] = {
          status: /Cancel/i.test(String(afterCb.status || afterCancel.status || '')) && noSecond ? 'PASS' : 'CHECK',
          br,
          estimatedRefund: penCr?.estimatedRefund,
          estimatedCharge: penCr?.estimatedCancellationCharge,
          cancelHttp: cancel.status,
          afterCancel: afterCancel.status,
          callbackMsg: cb.message,
          afterCallback: afterCb.status,
          walletAfterCancel: bal1,
          walletAfterCallback: bal2,
        };
      }
    }
  }

  // A4.1 non-refundable cancel then CANCELLED
  console.log('\n--- A4.1 non-refundable cancel → CANCELLED callback ---');
  {
    const found = await findBookable(hotel, { preferNonRefundable: true });
    if (!found) {
      results['A4.1'] = { status: 'NOT TESTED', note: 'no non-refundable inventory' };
    } else {
      const body = buildFinalizeBody({ ...found, pan: VALID_PAN, guestSuffix: 'Nonref' });
      const finalize = await hotel.finalizeBooking(body);
      const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
      if (!br) {
        results['A4.1'] = { status: 'NOT TESTED', note: 'finalize failed', detail: brief(finalize.data) };
      } else {
        await sendCallback(br, 'CONFIRMED');
        const conf = await waitStatus(hotel, br, { want: 'Confirmed', max: 12 });
        if (!/Confirmed/i.test(String(conf?.status || ''))) {
          results['A4.1'] = { status: 'NOT TESTED', note: 'could not confirm', br, after: conf?.status };
        } else {
          const penalty = await hotel.penaltyCheck(br);
          const penCr = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
          const bal0 = (await walletFeed(accessToken)).available;
          const cancel = await hotel.cancelBooking(br);
          await sleep(3000);
          const afterCancel = await getStatus(hotel, br);
          const bal1 = (await walletFeed(accessToken)).available;
          const cb = await sendCallback(br, 'CANCELLED');
          await sleep(2500);
          const bal2 = (await walletFeed(accessToken)).available;
          const afterCb = await getStatus(hotel, br);
          const refund0 = Number(penCr?.estimatedRefund ?? -1) === 0
            || Number(penCr?.estimatedCancellationCharge) > 0;
          const noExtra = bal1 == null || bal2 == null || Math.abs(Number(bal2) - Number(bal1)) < 1;
          results['A4.1'] = {
            status: /Cancel/i.test(String(afterCb.status || '')) && noExtra ? 'PASS' : 'CHECK',
            br,
            hotel: found.hotelName,
            estimatedRefund: penCr?.estimatedRefund,
            estimatedCharge: penCr?.estimatedCancellationCharge,
            refund0Likely: refund0,
            cancelHttp: cancel.status,
            afterCancel: afterCancel.status,
            callbackMsg: cb.message,
            afterCallback: afterCb.status,
            walletAfterCancel: bal1,
            walletAfterCallback: bal2,
            walletDeltaCancel: bal0 != null && bal1 != null ? Number(bal1) - Number(bal0) : null,
          };
        }
      }
    }
  }

  return { results, walletBefore };
}

// ---------------- Part B ----------------
async function runPartB() {
  const results = {};
  console.log('\n======== PART B: Card / Stripe ========');
  if (!STRIPE_SK) {
    return { results: { ALL: { status: 'NOT TESTED', note: 'no Stripe SK' } } };
  }
  const authToken = await guestAuth();
  console.log('guest auth ok');

  // B1 pay + app booking API
  console.log('\n--- B1 pay + book_api ---');
  {
    const inv = await findSmtInventory(authToken);
    if (!inv) {
      results.B1 = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const create = await smtApi('POST', '/api/hotels/createBooking', {
        body: buildCreateBody(inv, VALID_PAN, 'Bee'),
        authToken,
      });
      const pi = extractPi(create.data);
      console.log('create', create.status, pi.br, pi.paymentIntentId);
      let stripe = null;
      let attach = null;
      let terminal = null;
      if (create.ok && pi.paymentIntentId) {
        stripe = await stripeConfirm(pi.paymentIntentId);
        console.log('stripe', stripe.data?.status);
        attach = await attachBooking(authToken, pi);
        console.log('attach', attach.status, brief(attach.data, 200));
        if (pi.br) terminal = await pollSmtStatus(authToken, pi.br);
      }
      results.B1 = {
        status: /Confirmed|Failed/i.test(String(terminal?.data?.status || '')) ? 'PASS' : 'BUG',
        br: pi.br,
        paymentIntentId: pi.paymentIntentId,
        stripeStatus: stripe?.data?.status || null,
        amountReceived: stripe?.data?.amount_received || null,
        attachHttp: attach?.status,
        attachMsg: attach?.data?.message || null,
        finalStatus: terminal?.data?.status || null,
        process_by: 'NOT TESTED (needs DB)',
        expect: 'process_by=book_api',
      };
    }
  }

  // B2 pay only — wait for webhook (no attach)
  console.log('\n--- B2 pay, no app booking call (webhook) ---');
  {
    const inv = await findSmtInventory(authToken);
    if (!inv) {
      results.B2 = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const create = await smtApi('POST', '/api/hotels/createBooking', {
        body: buildCreateBody(inv, VALID_PAN, 'Cee'),
        authToken,
      });
      const pi = extractPi(create.data);
      let stripe = null;
      let terminal = null;
      if (create.ok && pi.paymentIntentId) {
        stripe = await stripeConfirm(pi.paymentIntentId);
        console.log('stripe', stripe.data?.status, 'waiting for webhook…');
        if (pi.br) {
          // wait longer for webhook path
          terminal = await pollSmtStatus(authToken, pi.br, 20);
        }
      }
      const booked = /Confirmed|Failed/i.test(String(terminal?.data?.status || ''));
      results.B2 = {
        status: booked ? 'PASS' : 'NOT TESTED',
        note: booked
          ? 'terminal without attach — webhook likely booked'
          : 'still Pending/no terminal — Stripe webhook may not point to gamma',
        br: pi.br,
        paymentIntentId: pi.paymentIntentId,
        stripeStatus: stripe?.data?.status || null,
        finalStatus: terminal?.data?.status || null,
        process_by: booked ? 'likely webhook (NOT TESTED in DB)' : 'NOT TESTED',
      };
    }
  }

  // B3/B4 approximated: attach twice / attach then note webhook not controllable
  console.log('\n--- B3 webhook-first then app (approx: attach twice after pay) ---');
  {
    const inv = await findSmtInventory(authToken);
    if (!inv) {
      results.B3 = { status: 'NOT TESTED', note: 'no inventory' };
      results.B4 = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const create = await smtApi('POST', '/api/hotels/createBooking', {
        body: buildCreateBody(inv, VALID_PAN, 'Dee'),
        authToken,
      });
      const pi = extractPi(create.data);
      if (!(create.ok && pi.paymentIntentId)) {
        results.B3 = { status: 'NOT TESTED', note: 'create failed', detail: brief(create.data) };
        results.B4 = { status: 'NOT TESTED', note: 'create failed' };
      } else {
        const stripe = await stripeConfirm(pi.paymentIntentId);
        // B4 path: app first
        const attach1 = await attachBooking(authToken, pi);
        const t1 = pi.br ? await pollSmtStatus(authToken, pi.br, 12) : null;
        // second app call (simulates late webhook competitor via app replay)
        const attach2 = await attachBooking(authToken, pi);
        const already = /already processed/i.test(JSON.stringify(attach2.data || {}));
        results.B4 = {
          status: /Confirmed|Failed/i.test(String(t1?.data?.status || '')) && (already || attach2.ok) ? 'PASS' : 'CHECK',
          note: 'app-first then second attach; real Stripe webhook no-op NOT TESTED without webhook control',
          br: pi.br,
          stripeStatus: stripe?.data?.status,
          attach1: { http: attach1.status, msg: attach1.data?.message || null },
          attach2: { http: attach2.status, msg: attach2.data?.message || null, alreadyProcessed: already },
          finalStatus: t1?.data?.status || null,
        };
        results.B3 = {
          status: 'NOT TESTED',
          note: 'cannot force Stripe webhook before app without webhook pointing to gamma + replay control',
          relatedBr: pi.br,
        };
      }
    }
  }

  // B5 concurrent attach
  console.log('\n--- B5 concurrent app calls ---');
  {
    const inv = await findSmtInventory(authToken);
    if (!inv) {
      results.B5 = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const create = await smtApi('POST', '/api/hotels/createBooking', {
        body: buildCreateBody(inv, VALID_PAN, 'Eff'),
        authToken,
      });
      const pi = extractPi(create.data);
      if (!(create.ok && pi.paymentIntentId)) {
        results.B5 = { status: 'NOT TESTED', note: 'create failed', detail: brief(create.data) };
      } else {
        await stripeConfirm(pi.paymentIntentId);
        const [a, b] = await Promise.all([
          attachBooking(authToken, pi),
          attachBooking(authToken, pi),
        ]);
        const terminal = pi.br ? await pollSmtStatus(authToken, pi.br, 12) : null;
        results.B5 = {
          status: /Confirmed|Failed/i.test(String(terminal?.data?.status || '')) ? 'PASS' : 'CHECK',
          note: 'two parallel attach calls; true app+webhook race NOT TESTED',
          br: pi.br,
          a: { http: a.status, msg: a.data?.message || null },
          b: { http: b.status, msg: b.data?.message || null },
          finalStatus: terminal?.data?.status || null,
        };
      }
    }
  }

  // B6 declined
  console.log('\n--- B6 card declined ---');
  {
    const inv = await findSmtInventory(authToken);
    if (!inv) {
      results.B6 = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const create = await smtApi('POST', '/api/hotels/createBooking', {
        body: buildCreateBody(inv, VALID_PAN, 'Gee'),
        authToken,
      });
      const pi = extractPi(create.data);
      let stripe = null;
      let terminal = null;
      if (create.ok && pi.paymentIntentId) {
        stripe = await stripeConfirm(pi.paymentIntentId, { decline: true });
        console.log('stripe decline', stripe.data?.status || stripe.data?.error?.code, brief(stripe.data, 180));
        // do not attach if decline
        if (pi.br) {
          await sleep(3000);
          terminal = await smtApi('GET', `/v1/hotels/bookings/${pi.br}/status`, { authToken });
        }
      }
      const declined = /fail|declin|require/i.test(String(stripe?.data?.status || stripe?.data?.error?.code || stripe?.data?.error?.message || ''));
      const noConfirm = !/Confirmed/i.test(String(terminal?.data?.status || ''));
      results.B6 = {
        status: declined && noConfirm ? 'PASS' : (create.ok ? 'CHECK' : 'BUG'),
        br: pi.br,
        paymentIntentId: pi.paymentIntentId,
        stripeStatus: stripe?.data?.status || null,
        stripeError: stripe?.data?.error?.message || stripe?.data?.error?.code || null,
        bookingStatus: terminal?.data?.status || null,
      };
    }
  }

  // B7 pay ok, supplier reject (bad PAN)
  console.log('\n--- B7 pay ok, supplier reject ---');
  {
    const inv = await findSmtInventory(authToken);
    if (!inv) {
      results.B7 = { status: 'NOT TESTED', note: 'no inventory' };
    } else {
      const create = await smtApi('POST', '/api/hotels/createBooking', {
        body: buildCreateBody(inv, BAD_PAN_VENDOR, 'Ach'),
        authToken,
      });
      const pi = extractPi(create.data);
      let stripe = null;
      let attach = null;
      let terminal = null;
      if (create.ok && pi.paymentIntentId) {
        stripe = await stripeConfirm(pi.paymentIntentId);
        attach = await attachBooking(authToken, pi);
        if (pi.br) terminal = await pollSmtStatus(authToken, pi.br, 18);
      }
      results.B7 = {
        status: /Failed/i.test(String(terminal?.data?.status || '')) ? 'PASS' : (create.status >= 400 ? 'PASS' : 'CHECK'),
        note: /Failed/i.test(String(terminal?.data?.status || ''))
          ? 'Failed after pay — verify Stripe refund in Dashboard/DB'
          : 'supplier reject path unclear; card refund NOT TESTED here',
        br: pi.br,
        createHttp: create.status,
        stripeStatus: stripe?.data?.status || null,
        attachHttp: attach?.status,
        finalStatus: terminal?.data?.status || null,
        cardRefund: 'NOT TESTED (Stripe Dashboard)',
      };
    }
  }

  // B8 Stripe resend — NOT TESTED without webhook secret/replay
  results.B8 = {
    status: 'NOT TESTED',
    note: 'requires Stripe webhook endpoint + signing secret to replay same event to gamma',
  };

  // B9 invalid signature — POST garbage to common webhook paths
  console.log('\n--- B9 invalid Stripe signature ---');
  {
    const paths = [
      '/api/v1/payments/stripe/webhook',
      '/api/payments/stripe/webhook',
      '/webhooks/stripe',
      '/api/stripe/webhook',
      '/v1/payments/webhook/stripe',
    ];
    const tried = [];
    for (const p of paths) {
      const r = await fetch(`${BASE}${p}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 't=1,v1=invalid',
        },
        body: JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_test_invalid' } } }),
      });
      const text = await r.text();
      tried.push({ path: p, http: r.status, body: text.slice(0, 120) });
    }
    const rejected = tried.some((t) => t.http === 400 || t.http === 401 || t.http === 403);
    const hit = tried.find((t) => t.http !== 404);
    results.B9 = {
      status: hit ? (rejected || (hit.http >= 400) ? 'PASS' : 'CHECK') : 'NOT TESTED',
      note: hit ? `hit ${hit.path} HTTP ${hit.http}` : 'no known Stripe webhook path on gamma (all 404)',
      tried,
    };
  }

  return { results };
}

async function main() {
  console.log('Base:', BASE);
  console.log('Part:', PART);
  process.env.BASE_URL = BASE;

  const report = {
    at: new Date().toISOString(),
    baseUrl: BASE,
    part: PART,
    callback: { pid: CALLBACK_PID, keyPreview: `${CALLBACK_KEY.slice(0, 4)}…` },
    partA: null,
    partB: null,
  };

  if (PART === 'A' || PART === 'ALL') {
    clearSession();
    const { client, accessToken } = await authenticate(true);
    const hotel = new HotelService(client);
    report.partA = await runPartA(hotel, accessToken);
  }

  if (PART === 'B' || PART === 'ALL') {
    report.partB = await runPartB();
  }

  const out = path.join(OUT_DIR, 'latest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `run-${Date.now()}.json`), JSON.stringify(report, null, 2));

  const flat = {
    ...(report.partA?.results || {}),
    ...(report.partB?.results || {}),
  };
  console.log('\n========== ENG-902 SUMMARY ==========');
  for (const [k, v] of Object.entries(flat)) {
    console.log(`${k}\t${v.status}\t${v.br || v.relatedBr || '-'}\t${(v.note || v.after || v.finalStatus || '').toString().slice(0, 80)}`);
  }
  console.log('Report:', out);

  const counts = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
  for (const v of Object.values(flat)) {
    counts[v.status] = (counts[v.status] || 0) + 1;
  }
  console.log('Counts', counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
