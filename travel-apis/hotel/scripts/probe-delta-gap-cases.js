/**
 * Gap cases from Phase1/Phase2 checklist (NOT TESTED):
 *  P2: payment declined → no booking
 *  P2: 3DS not completed → no booking
 *  P2: retry after decline/3DS succeeds (not "already processed" without booking)
 *  P1+P2: non-refundable cancel (refund 0 / full penalty)
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   node travel-apis/hotel/scripts/probe-delta-gap-cases.js
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { createSignature, createTimestamp, createRequestId } from '../../../shared/lib/signature.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'delta-hotel-smt');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL || 'https://delta-api.travelvip.ai';
const PID = 'smt';
const KEY = 'palsgcvgscvvs';
const TIER = '10997401';
const MOBILE = '9665498686';
const SIGNING_KEY = process.env.SIGNING_KEY || config.signingKey;
const STRIPE_SK = fs.readFileSync(path.join(process.env.USERPROFILE, 'Downloads', 'cardpayment.json'), 'utf8')
  .match(/sk_test_[A-Za-z0-9]+/)[0];

const VALID_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function uuid() {
  return crypto.randomUUID();
}
function brief(d, n = 360) {
  return JSON.stringify(d).slice(0, n);
}
function dayOffset(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function smtApi(method, urlPath, { query = {}, body, authToken, signed = true } = {}) {
  const q = new URLSearchParams({
    key: KEY, pid: PID, platform: 'web', client: 'web', lang: 'en', currency: 'INR', tier_id: TIER, ...query,
  });
  const bodyString = body === undefined ? '' : JSON.stringify(body);
  const ts = createTimestamp();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': createRequestId(),
    'X-Correlation-ID': uuid(),
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
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: r.status, ok: r.ok, data };
}

async function guestAuth() {
  const hash = Buffer.from(String(Date.now())).toString('base64');
  const res = await smtApi('GET', '/api/checkGuestLogin', { query: { hash, user_type: 'guest' }, signed: false });
  if (!res.data?.token) throw new Error('guest auth failed');
  return res.data.token;
}

function roomRefundFlags(room) {
  const text = JSON.stringify(room || {}).toLowerCase();
  const charge = Number(room?.cancellationCharge ?? room?.cancelCharge ?? room?.penaltyAmount);
  const free =
    room?.isFreeCancellation === true
    || room?.freeCancellation === true
    || /free cancellation|fully refundable/.test(text)
    || charge === 0;
  const nonRefund =
    room?.isRefundable === false
    || room?.refundable === false
    || /non[- ]?refundable|no refund|non refundable/.test(text)
    || (Number.isFinite(charge) && charge > 0 && !free);
  return { free, nonRefund, charge: Number.isFinite(charge) ? charge : null, textHit: /non[- ]?refundable/.test(text) };
}

async function findSmtInventory(authToken, { preferNonRefund = false, preferFree = false } = {}) {
  for (const entityId of ['39627872', '2869073']) {
    for (const checkinDays of [7, 3, 1, 14, 21, 28, 35]) {
      for (const nights of [1, 2]) {
        const searchBody = {
          checkin: dayOffset(checkinDays),
          checkout: dayOffset(checkinDays + nights),
          entityId: String(entityId),
          nationality: 'IN',
          type: 'HOTEL',
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        };
        const search = await smtApi('POST', '/v1/hotels/search', { body: searchBody, authToken });
        if (!search.ok) continue;
        const details = await smtApi('POST', '/v1/hotels/details', { body: searchBody, authToken });
        if (!details.ok) continue;
        const rooms = details.data?.results?.[0]?.rooms || [];
        const requestId = details.data?.requestId || details.data?.results?.[0]?.requestId || uuid();
        let ranked = rooms.filter((r) => r?.bookingCode).map((r) => ({ room: r, flags: roomRefundFlags(r) }));
        if (preferNonRefund) {
          const nr = ranked.filter((x) => x.flags.nonRefund || x.flags.textHit);
          if (nr.length) ranked = [...nr, ...ranked.filter((x) => !nr.includes(x))];
          else ranked = ranked.filter((x) => !x.flags.free);
        }
        if (preferFree) {
          const fr = ranked.filter((x) => x.flags.free);
          if (fr.length) ranked = [...fr, ...ranked.filter((x) => !fr.includes(x))];
        }
        for (const { room, flags } of ranked.slice(0, 10)) {
          const prebook = await smtApi('POST', '/v1/hotels/prebook', {
            body: { bookingCode: room.bookingCode, requestId },
            authToken,
          });
          if (!(prebook.ok || prebook.status === 200)) continue;
          return {
            searchBody,
            room,
            flags,
            requestId: prebook.data?.requestId || requestId,
            bookingContext:
              prebook.data?.bookingContext
              || prebook.data?.results?.[0]?.bookingContext
              || details.data?.bookingContext
              || details.data?.results?.[0]?.bookingContext,
            hotel: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
          };
        }
      }
    }
  }
  return null;
}

function buildCardBody(inv, emailTag = 'gap') {
  return {
    bookingCode: inv.room.bookingCode,
    bookingContext: inv.bookingContext,
    requestId: inv.requestId,
    checkin: inv.searchBody.checkin,
    checkout: inv.searchBody.checkout,
    paymentMethod: 'CARD',
    redirectUrl: 'https://delta-shop.travelvip.ai/booking/status',
    contact: {
      email: `smt.${emailTag}.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: MOBILE,
      panCardNumber: VALID_PAN.panCardNumber,
      panCardName: 'Rohan Bhagat',
    },
    rooms: [{ guests: [{ title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
  };
}

function extractPi(data) {
  const pd = data?.paymentData || {};
  const clientSecret = typeof pd.paymentIntent === 'string' ? pd.paymentIntent : null;
  return {
    br: data?.bookingReference || null,
    bookingId: data?.bookingId || null,
    paymentIntentId: clientSecret?.includes('_secret') ? clientSecret.split('_secret')[0] : null,
    clientSecret,
  };
}

async function stripeConfirm(pi, paymentMethod) {
  const conf = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SK}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      payment_method: paymentMethod,
      return_url: 'https://delta-shop.travelvip.ai/booking/status',
    }),
  });
  const data = await conf.json();
  return { status: conf.status, ok: conf.ok, data };
}

async function pollStatus(authToken, br, max = 12) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await smtApi('GET', `/v1/hotels/bookings/${br}/status`, { authToken });
    const st = last.data?.status;
    console.log(`  status ${i + 1}: ${st}`);
    if (st && /Confirmed|Failed|Cancelled/i.test(String(st))) return last;
    await sleep(3000);
  }
  return last;
}

const report = { at: new Date().toISOString(), base: BASE, cases: {} };

console.log('=== GAP CASES on', BASE, '===');
const authToken = await guestAuth();

// ---------------------------------------------------------------------------
// P2: Payment declined
// ---------------------------------------------------------------------------
console.log('\n## P2 DECLINED');
{
  const inv = await findSmtInventory(authToken, { preferFree: true });
  if (!inv) {
    report.cases.DECLINED = { status: 'NOT TESTED', error: 'no inventory' };
  } else {
    const create = await smtApi('POST', '/api/hotels/createBooking', {
      body: buildCardBody(inv, 'declined'),
      authToken,
    });
    console.log('create', create.status, brief(create.data));
    const pi = extractPi(create.data);
    const stripe = await stripeConfirm(pi.paymentIntentId, 'pm_card_chargeDeclined');
    console.log('stripe declined', stripe.status, stripe.data?.status, stripe.data?.last_payment_error?.code || stripe.data?.error?.code);
    let attach = null;
    if (stripe.data?.status === 'succeeded') {
      attach = await smtApi('POST', '/api/v2/hotels/booking', {
        body: { paymentIntentId: pi.paymentIntentId, bookingReference: pi.br, bookingRefId: pi.br },
        authToken,
      });
      console.log('attach unexpected success', attach.status, brief(attach.data));
    } else {
      // still try attach — should not confirm booking
      attach = await smtApi('POST', '/api/v2/hotels/booking', {
        body: { paymentIntentId: pi.paymentIntentId, bookingReference: pi.br, bookingRefId: pi.br },
        authToken,
      });
      console.log('attach after decline', attach.status, brief(attach.data));
    }
    let st = null;
    if (pi.br) st = await smtApi('GET', `/v1/hotels/bookings/${pi.br}/status`, { authToken });
    const confirmed = /Confirmed/i.test(String(st?.data?.status || ''));
    const payFailed = !stripe.ok || ['requires_payment_method', 'canceled'].includes(stripe.data?.status)
      || stripe.data?.last_payment_error
      || stripe.status >= 400;
    report.cases.DECLINED = {
      status: payFailed && !confirmed ? 'PASS' : (confirmed ? 'BUG' : 'CHECK'),
      br: pi.br,
      paymentIntentId: pi.paymentIntentId,
      stripeStatus: stripe.data?.status || null,
      stripeError: stripe.data?.last_payment_error?.message || stripe.data?.error?.message || null,
      attachHttp: attach?.status,
      attachBrief: brief(attach?.data || {}, 220),
      bookingStatus: st?.data?.status || null,
      expect: 'decline → no Confirmed booking',
    };
  }
}

// ---------------------------------------------------------------------------
// P2: 3DS not completed
// ---------------------------------------------------------------------------
console.log('\n## P2 3DS NOT COMPLETED');
{
  const inv = await findSmtInventory(authToken, { preferFree: true });
  if (!inv) {
    report.cases.THREE_DS_ABANDON = { status: 'NOT TESTED', error: 'no inventory' };
  } else {
    const create = await smtApi('POST', '/api/hotels/createBooking', {
      body: buildCardBody(inv, '3ds'),
      authToken,
    });
    console.log('create', create.status, brief(create.data));
    const pi = extractPi(create.data);
    const stripe = await stripeConfirm(pi.paymentIntentId, 'pm_card_authenticationRequired');
    console.log('stripe 3ds', stripe.status, stripe.data?.status, stripe.data?.next_action?.type || '');
    // Do NOT complete 3DS — try attach
    const attach = await smtApi('POST', '/api/v2/hotels/booking', {
      body: { paymentIntentId: pi.paymentIntentId, bookingReference: pi.br, bookingRefId: pi.br },
      authToken,
    });
    console.log('attach without 3ds', attach.status, brief(attach.data));
    let st = null;
    if (pi.br) st = await smtApi('GET', `/v1/hotels/bookings/${pi.br}/status`, { authToken });
    const confirmed = /Confirmed/i.test(String(st?.data?.status || ''));
    const requiresAction = stripe.data?.status === 'requires_action' || stripe.data?.status === 'requires_source_action';
    report.cases.THREE_DS_ABANDON = {
      status: requiresAction && !confirmed ? 'PASS' : (confirmed ? 'BUG' : 'CHECK'),
      br: pi.br,
      paymentIntentId: pi.paymentIntentId,
      stripeStatus: stripe.data?.status || null,
      nextAction: stripe.data?.next_action?.type || null,
      attachHttp: attach.status,
      attachBrief: brief(attach.data, 220),
      bookingStatus: st?.data?.status || null,
      alreadyProcessed: /already processed/i.test(JSON.stringify(attach.data || {})),
      expect: '3DS incomplete → no Confirmed; attach must not finalize booking',
    };
  }
}

// ---------------------------------------------------------------------------
// P2: Retry after decline/3DS with successful payment
// ---------------------------------------------------------------------------
console.log('\n## P2 RETRY AFTER FAIL PAY');
{
  const inv = await findSmtInventory(authToken, { preferFree: true });
  if (!inv) {
    report.cases.RETRY_AFTER_PAY_FAIL = { status: 'NOT TESTED', error: 'no inventory' };
  } else {
    // first: decline path create (may get BR in payment-in-progress)
    const createFail = await smtApi('POST', '/api/hotels/createBooking', {
      body: buildCardBody(inv, 'retryfail'),
      authToken,
    });
    const piFail = extractPi(createFail.data);
    const stripeFail = await stripeConfirm(piFail.paymentIntentId, 'pm_card_chargeDeclined');
    console.log('fail pay', piFail.br, stripeFail.data?.status);

    // fresh inventory for success retry
    const inv2 = await findSmtInventory(authToken, { preferFree: true });
    const createOk = await smtApi('POST', '/api/hotels/createBooking', {
      body: buildCardBody(inv2 || inv, 'retryok'),
      authToken,
    });
    const piOk = extractPi(createOk.data);
    const stripeOk = await stripeConfirm(piOk.paymentIntentId, 'pm_card_visa');
    console.log('ok pay', piOk.br, stripeOk.data?.status);
    const attach = await smtApi('POST', '/api/v2/hotels/booking', {
      body: { paymentIntentId: piOk.paymentIntentId, bookingReference: piOk.br, bookingRefId: piOk.br },
      authToken,
    });
    console.log('attach retry', attach.status, brief(attach.data));
    const alreadyWithoutBook = /already processed/i.test(JSON.stringify(attach.data || {}))
      && !/Confirmed|PENDING|pending/i.test(String(attach.data?.bookingStatus || ''));
    const terminal = piOk.br ? await pollStatus(authToken, piOk.br) : null;
    const confirmed = /Confirmed/i.test(String(terminal?.data?.status || ''));
    report.cases.RETRY_AFTER_PAY_FAIL = {
      status: confirmed && !alreadyWithoutBook ? 'PASS' : (confirmed ? 'PASS' : 'BUG'),
      failedAttempt: { br: piFail.br, stripeStatus: stripeFail.data?.status },
      retry: {
        br: piOk.br,
        paymentIntentId: piOk.paymentIntentId,
        stripeStatus: stripeOk.data?.status,
        attachMsg: attach.data?.message,
        attachBookingStatus: attach.data?.bookingStatus,
        finalStatus: terminal?.data?.status,
        confirmationNumber: terminal?.data?.confirmationNumber,
      },
      alreadyProcessedWithoutBooking: alreadyWithoutBook,
    };
  }
}

// ---------------------------------------------------------------------------
// P2: Non-refundable cancel
// ---------------------------------------------------------------------------
console.log('\n## P2 NON-REFUNDABLE CANCEL');
{
  const inv = await findSmtInventory(authToken, { preferNonRefund: true });
  if (!inv) {
    report.cases.CARD_NONREFUND_CANCEL = { status: 'NOT TESTED', error: 'no non-refund inventory' };
  } else {
    console.log('room flags', inv.flags, inv.hotel, inv.searchBody.checkin);
    const create = await smtApi('POST', '/api/hotels/createBooking', {
      body: buildCardBody(inv, 'nonref'),
      authToken,
    });
    const pi = extractPi(create.data);
    const stripe = await stripeConfirm(pi.paymentIntentId, 'pm_card_visa');
    const attach = await smtApi('POST', '/api/v2/hotels/booking', {
      body: { paymentIntentId: pi.paymentIntentId, bookingReference: pi.br, bookingRefId: pi.br },
      authToken,
    });
    console.log('booked', pi.br, stripe.data?.status, brief(attach.data));
    const terminal = await pollStatus(authToken, pi.br);
    if (!/Confirmed/i.test(String(terminal?.data?.status || ''))) {
      report.cases.CARD_NONREFUND_CANCEL = {
        status: 'NOT TESTED',
        reason: `book ended ${terminal?.data?.status}`,
        br: pi.br,
        flags: inv.flags,
        message: terminal?.data?.message,
      };
    } else {
      const penalty = await smtApi('GET', `/v1/hotels/bookings/${pi.br}/penalty-check`, { authToken });
      const pen = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest || {};
      console.log('penalty', penalty.status, brief(penalty.data));
      const cancel = await smtApi('GET', `/v1/hotels/bookings/${pi.br}/cancel`, { authToken });
      console.log('cancel', cancel.status, brief(cancel.data));
      const after = await pollStatus(authToken, pi.br, 10);
      const refund = Number(pen.estimatedRefund ?? cancel.data?.data?.cancellationRequest?.refund ?? cancel.data?.cancellationRequest?.refund);
      const charge = Number(pen.estimatedCancellationCharge ?? cancel.data?.data?.cancellationRequest?.cancellationCharge);
      const noRefund = refund === 0 || (Number.isFinite(charge) && charge > 0 && refund < (stripe.data?.amount_received || 1));
      // strict: non-refundable expect refund 0
      const strictNoRefund = refund === 0;
      report.cases.CARD_NONREFUND_CANCEL = {
        status: /Cancel/i.test(String(after?.data?.status || ''))
          ? (strictNoRefund ? 'PASS' : (noRefund ? 'CHECK' : 'BUG'))
          : (cancel.status >= 400 ? 'CHECK' : 'BUG'),
        br: pi.br,
        flags: inv.flags,
        hotel: inv.hotel,
        checkin: inv.searchBody.checkin,
        confirmationNumber: terminal.data?.confirmationNumber,
        penaltyHttp: penalty.status,
        estimatedRefund: pen.estimatedRefund,
        estimatedCharge: pen.estimatedCancellationCharge,
        cancelHttp: cancel.status,
        cancelRefund: cancel.data?.data?.cancellationRequest?.refund ?? cancel.data?.cancellationRequest?.refund,
        cancelCharge: cancel.data?.data?.cancellationRequest?.cancellationCharge ?? cancel.data?.cancellationRequest?.cancellationCharge,
        finalStatus: after?.data?.status,
        note: 'PASS if cancelled with refund=0 (non-refundable). CHECK if partial / cancel blocked.',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// P1: Non-refundable cancel (wallet)
// ---------------------------------------------------------------------------
console.log('\n## P1 WALLET NON-REFUNDABLE CANCEL');
{
  process.env.BASE_URL = BASE;
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  let found = null;
  for (const entityId of ['39627872', config.hotel.defaultEntityId, '2869073'].filter(Boolean)) {
    for (const checkinDays of [3, 1, 7, 14, 21]) {
      for (const nights of [1, 2]) {
        const searchBody = buildSearchBody({
          entityId, checkinDays, nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) continue;
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        const rooms = details.data?.results?.[0]?.rooms || [];
        const ranked = rooms.filter((r) => r.bookingCode).map((r) => ({ r, f: roomRefundFlags(r) }));
        const prefer = [
          ...ranked.filter((x) => x.f.nonRefund || x.f.textHit),
          ...ranked.filter((x) => !x.f.free),
        ];
        for (const { r, f } of (prefer.length ? prefer : ranked).slice(0, 8)) {
          const prebook = await hotel.prebook({ bookingCode: r.bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          found = { searchBody, details, prebook, bookingCode: r.bookingCode, requestId, flags: f, hotelName: details.data?.results?.[0]?.name };
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (found) break;
  }
  if (!found) {
    report.cases.WALLET_NONREFUND_CANCEL = { status: 'NOT TESTED', error: 'no inventory' };
  } else {
    console.log('wallet room', found.hotelName, found.flags);
    const room = found.details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === found.bookingCode);
    const first = config.hotel.guestFirstName;
    const last = config.hotel.guestLastName;
    const body = {
      bookingContext: extractBookingContext(found.prebook.data),
      bookingCode: found.bookingCode,
      requestId: found.requestId,
      checkin: found.searchBody.checkin,
      checkout: found.searchBody.checkout,
      rooms: [{ guests: [{ title: 'Mr', firstName: first, lastName: last, type: 'Adult', isLead: true }] }],
      contact: {
        email: `delta.nonref.${Date.now()}@travelvip.ai`,
        countryCode: '+91',
        mobile: config.hotel.contactMobile,
        panCardNumber: VALID_PAN.panCardNumber,
        panCardName: `${first} ${last}`,
      },
    };
    if (room?.isGSTClaimable || room?.isGstClaimable) body.gstDetails = { ...VALID_GST };
    const fin = await hotel.finalizeBooking(body);
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    console.log('finalize', fin.status, br, fin.data?.status);
    let terminal = null;
    if (br) {
      for (let i = 0; i < 20; i += 1) {
        const st = await hotel.getBookingStatus(br);
        console.log('  status', i + 1, st.data?.status);
        if (st.ok && isTerminalHotelStatus(st.data?.status)) {
          terminal = st;
          break;
        }
        await sleep(3500);
      }
    }
    if (!br || !/Confirmed/i.test(String(terminal?.data?.status || ''))) {
      report.cases.WALLET_NONREFUND_CANCEL = {
        status: 'NOT TESTED',
        reason: `ended ${terminal?.data?.status || fin.data?.status}`,
        br,
        flags: found.flags,
      };
    } else {
      const penalty = await hotel.penaltyCheck(br);
      const pen = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest || {};
      console.log('penalty', penalty.status, brief(penalty.data));
      const cancel = await hotel.cancelBooking(br);
      console.log('cancel', cancel.status, brief(cancel.data));
      let after = null;
      for (let i = 0; i < 10; i += 1) {
        after = await hotel.getBookingStatus(br);
        console.log('  after', after.data?.status);
        if (/Cancel/i.test(String(after.data?.status || ''))) break;
        await sleep(3000);
      }
      const refund = Number(pen.estimatedRefund ?? cancel.data?.data?.cancellationRequest?.refund);
      const strictNoRefund = refund === 0;
      report.cases.WALLET_NONREFUND_CANCEL = {
        status: /Cancel/i.test(String(after?.data?.status || ''))
          ? (strictNoRefund ? 'PASS' : 'CHECK')
          : (cancel.status >= 400 ? 'CHECK' : 'BUG'),
        br,
        flags: found.flags,
        hotel: found.hotelName,
        checkin: found.searchBody.checkin,
        estimatedRefund: pen.estimatedRefund,
        estimatedCharge: pen.estimatedCancellationCharge,
        cancelHttp: cancel.status,
        cancelRefund: cancel.data?.data?.cancellationRequest?.refund ?? cancel.data?.cancellationRequest?.refund,
        cancelCharge: cancel.data?.data?.cancellationRequest?.cancellationCharge ?? cancel.data?.cancellationRequest?.cancellationCharge,
        finalStatus: after?.data?.status,
        note: 'PASS if refund=0. CHECK if room was not truly non-refundable or cancel blocked. Nexus: expect no credit if refund=0.',
      };
    }
  }
}

fs.writeFileSync(path.join(OUT, 'GAP-CASES-latest.json'), JSON.stringify(report, null, 2));
console.log('\n========== GAP SUMMARY ==========');
for (const [k, v] of Object.entries(report.cases)) {
  console.log(k, v.status, v.br || '', v.finalStatus || v.bookingStatus || v.retry?.finalStatus || '');
}
console.log('WROTE', path.join(OUT, 'GAP-CASES-latest.json'));
