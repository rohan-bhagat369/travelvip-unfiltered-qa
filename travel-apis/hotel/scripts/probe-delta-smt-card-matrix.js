/**
 * SMT card matrix on delta-api (API-only) — for DB one-by-one checks after.
 * Scenarios: FAIL | CONFIRM | DOUBLE BOOK | CANCEL
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   node travel-apis/hotel/scripts/probe-delta-smt-card-matrix.js
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createSignature, createTimestamp, createRequestId } from '../../../shared/lib/signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'delta-hotel-smt');
fs.mkdirSync(OUT, { recursive: true });

const ENV_PATH = path.join(process.env.USERPROFILE, 'Downloads', 'Web Dev smt_env.json');
const vars = Object.fromEntries(
  (JSON.parse(fs.readFileSync(ENV_PATH, 'utf8')).environments?.[0]?.variables || [])
    .map((v) => [v.name, v.value]),
);

const BASE = process.env.BASE_URL || 'https://delta-api.travelvip.ai';
const PID = vars.partner_id || 'smt';
const KEY = vars.partner_key || 'palsgcvgscvvs';
const TIER = vars.tier_id || '10997401';
const MOBILE = vars.mobile_number || '9665498686';
const SIGNING_KEY = process.env.SIGNING_KEY || 'sk_test_a8f5f167f44f4964e6c998dee827110c';
const STRIPE_SK = (() => {
  try {
    return fs.readFileSync(path.join(process.env.USERPROFILE, 'Downloads', 'cardpayment.json'), 'utf8')
      .match(/sk_test_[A-Za-z0-9]+/)?.[0];
  } catch {
    return null;
  }
})();

const VALID_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const BAD_PAN_FORMAT = { panCardNumber: 'INVALIDPAN', panCardName: 'Rohan Bhagat' };
const BAD_PAN_VENDOR = { panCardNumber: 'AAAAA0000A', panCardName: 'Fake Guest' };

function uuid() {
  return crypto.randomUUID();
}
function dayOffset(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
function brief(d, n = 320) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, urlPath, { query = {}, body, authToken, partnerKey = KEY, signed = true } = {}) {
  const q = new URLSearchParams({
    key: KEY,
    pid: PID,
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
    tier_id: TIER,
    ...query,
  });
  const bodyString = body === undefined ? '' : JSON.stringify(body);
  const timestamp = createTimestamp();
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': createRequestId(),
    'X-Correlation-ID': uuid(),
  };
  if (signed) {
    headers['X-Timestamp'] = timestamp;
    headers['X-Signature'] = createSignature(bodyString, timestamp, SIGNING_KEY);
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (partnerKey) headers['X-Partner-Key'] = partnerKey;

  const r = await fetch(`${BASE}${urlPath}?${q}`, {
    method,
    headers,
    body: body === undefined ? undefined : bodyString,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text.slice(0, 500) };
  }
  return { status: r.status, ok: r.ok, data };
}

function log(title, res) {
  console.log(`\n== ${title} == HTTP ${res.status}`);
  console.log(brief(res.data, 400));
  return res;
}

async function guestAuth() {
  const hash = Buffer.from(String(Date.now())).toString('base64');
  const res = await api('GET', '/api/checkGuestLogin', {
    query: { hash, user_type: 'guest' },
    signed: false,
    partnerKey: null,
  });
  log('checkGuestLogin', res);
  const token = res.data?.token || res.data?.auth_token;
  if (!token) throw new Error('No guest token');
  return token;
}

async function findInventory(authToken, { preferFreeCancel = true } = {}) {
  const entityIds = ['39627872', '2869073'];
  for (const entityId of entityIds) {
    for (const checkinDays of [21, 28, 35, 14, 45]) {
      for (const nights of [1, 2]) {
        const searchBody = {
          checkin: dayOffset(checkinDays),
          checkout: dayOffset(checkinDays + nights),
          entityId: String(entityId),
          nationality: 'IN',
          type: 'HOTEL',
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        };
        const search = await api('POST', '/v1/hotels/search', { body: searchBody, authToken });
        if (!search.ok) continue;
        const details = await api('POST', '/v1/hotels/details', { body: searchBody, authToken });
        if (!details.ok) continue;
        const rooms = details.data?.results?.[0]?.rooms || [];
        const requestId = details.data?.requestId || details.data?.results?.[0]?.requestId || search.data?.requestId || uuid();
        let ranked = rooms.filter((r) => r?.bookingCode);
        if (preferFreeCancel) {
          const free = ranked.filter((r) => /free/i.test(String(r?.cancellationPolicy || r?.cancelPolicy || ''))
            || r?.isFreeCancellation === true
            || Number(r?.cancellationCharge ?? 1) === 0);
          if (free.length) ranked = [...free, ...ranked.filter((r) => !free.includes(r))];
        }
        for (const room of ranked.slice(0, 8)) {
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
          return {
            searchBody,
            details,
            prebook,
            bookingCode: room.bookingCode,
            requestId: prebook.data?.requestId || requestId,
            bookingContext,
            hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
            room,
          };
        }
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
    redirectUrl: 'https://delta-shop.travelvip.ai/booking/status',
    contact: {
      email: `smt.matrix.${Date.now()}${suffix}@travelvip.ai`,
      countryCode: '+91',
      mobile: MOBILE,
      panCardNumber: pan.panCardNumber,
      panCardName: pan.panCardName,
    },
    rooms: [
      {
        guests: [
          {
            title: 'Mr',
            firstName: 'Rohan',
            lastName: `Bhagat${suffix}`,
            type: 'Adult',
            isLead: true,
          },
        ],
      },
    ],
  };
}

function extractPi(createData) {
  const pd = createData?.paymentData || {};
  const clientSecret = typeof pd.paymentIntent === 'string' ? pd.paymentIntent : null;
  const paymentIntentId = clientSecret?.includes('_secret') ? clientSecret.split('_secret')[0] : null;
  return {
    br: createData?.bookingReference || null,
    bookingId: createData?.bookingId || null,
    clientSecret,
    paymentIntentId,
    paymentId: pd.paymentId || null,
  };
}

async function stripeConfirm(paymentIntentId) {
  const conf = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SK}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      payment_method: 'pm_card_visa',
      return_url: 'https://delta-shop.travelvip.ai/booking/status',
    }),
  });
  const data = await conf.json();
  return { status: conf.status, ok: conf.ok, data };
}

async function attachBooking(authToken, { paymentIntentId, br }) {
  return api('POST', '/api/v2/hotels/booking', {
    body: { paymentIntentId, bookingReference: br, bookingRefId: br },
    authToken,
  });
}

async function pollStatus(authToken, br, max = 15) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await api('GET', `/v1/hotels/bookings/${br}/status`, { authToken });
    const st = last.data?.status;
    console.log(`  status poll ${i + 1}: ${st}`);
    if (st && /Confirmed|Failed|Cancelled|Rejected/i.test(String(st))) return last;
    await sleep(3500);
  }
  return last;
}

function dbSqlForBr(br, label) {
  return `-- ${label}
-- BR: ${br}
USE travelx;
SET @br := '${br}';

-- 1) Booking
SELECT b.id, b.booking_reference, b.partner, b.confirmed_at, b.cancelled_at,
       bi.id AS booking_item_id, bi.current_status_mapping_id,
       bsm.status_code, bsm.user_status, bsm.backend_status
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference = @br;

-- 2) Payment deduction
SELECT p.id, p.booking_id, p.booking_item_id, p.provider, p.status, p.total_amount
FROM payment p JOIN booking b ON b.id = p.booking_id WHERE b.booking_reference = @br;

SELECT pt.id, pt.payment_id, pt.transaction_type, pt.status, pt.amount, pt.payment_status,
       pt.provider_reference, pt.payment_intent
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br
ORDER BY pt.id;

SELECT bis.booking_item_id, bis.total_amount, bis.paid_amount, bis.due_amount
FROM booking_item_sales_summary bis
JOIN booking_item bi ON bi.id = bis.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

-- 3) Cancellation
SELECT cr.*
FROM cancellation_request cr
JOIN booking_item bi ON bi.id = cr.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

-- 4) Refund
SELECT rt.id, rt.booking_item_id, rt.payment_transaction_id, rt.amount, rt.status,
       rt.destination_type, rt.wallet_ledger_id, rt.completed_at
FROM refund_transaction rt
JOIN booking_item bi ON bi.id = rt.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

SELECT pt.id, pt.transaction_type, pt.status, pt.amount, pt.provider_reference
FROM payment_transaction pt
JOIN payment p ON p.id = pt.payment_id
JOIN booking b ON b.id = p.booking_id
WHERE b.booking_reference = @br AND pt.transaction_type = 'REFUND';

-- 5) Status trail
SELECT his.booking_item_id, his.status_mapping_id, bsm.status_code, bsm.user_status, bsm.backend_status, his.created_at
FROM booking_item_status_history his
JOIN booking_item bi ON bi.id = his.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = his.status_mapping_id
WHERE b.booking_reference = @br
ORDER BY his.created_at;

SELECT action_id, action_name, created_at
FROM user_actions WHERE action_id = @br ORDER BY created_at;
`;
}

const report = {
  at: new Date().toISOString(),
  base: BASE,
  partner: { pid: PID, key: KEY, tier: TIER },
  scenarios: {},
};

console.log('Base', BASE, 'pid', PID, 'tier', TIER);
const authToken = await guestAuth();

// ---------------------------------------------------------------------------
// S2 FAIL — invalid PAN format (API gate) + vendor-bad PAN full card path
// ---------------------------------------------------------------------------
console.log('\n########## S2 FAIL ##########');
{
  const inv = await findInventory(authToken, { preferFreeCancel: false });
  if (!inv) {
    report.scenarios.FAIL = { status: 'NOT TESTED', error: 'no inventory' };
  } else {
    const formatBody = buildCreateBody(inv, BAD_PAN_FORMAT, 'Fmt');
    const formatRes = log('createBooking invalid PAN format', await api('POST', '/api/hotels/createBooking', {
      body: formatBody,
      authToken,
    }));

    // fresh prebook for vendor-bad PAN path
    const inv2 = await findInventory(authToken, { preferFreeCancel: false });
    const vendorBody = buildCreateBody(inv2 || inv, BAD_PAN_VENDOR, 'Bad');
    const vendorCreate = log('createBooking vendor-bad PAN', await api('POST', '/api/hotels/createBooking', {
      body: vendorBody,
      authToken,
    }));
    const pi = extractPi(vendorCreate.data);
    let stripe = null;
    let attach = null;
    let terminal = null;
    if (vendorCreate.ok && pi.paymentIntentId && STRIPE_SK) {
      stripe = log('Stripe confirm (fail path)', await stripeConfirm(pi.paymentIntentId));
      if (stripe.ok || stripe.data?.status === 'succeeded') {
        attach = log('v2 booking (fail path)', await attachBooking(authToken, pi));
        if (pi.br) terminal = await pollStatus(authToken, pi.br);
      }
    }
    report.scenarios.FAIL = {
      status: /Failed|Rejected/i.test(String(terminal?.data?.status || ''))
        ? 'PASS'
        : (formatRes.status >= 400 && !formatRes.data?.bookingReference ? 'PARTIAL' : 'CHECK'),
      formatGate: { http: formatRes.status, code: formatRes.data?.error?.code, br: formatRes.data?.bookingReference || null },
      vendorPath: {
        http: vendorCreate.status,
        br: pi.br,
        bookingId: pi.bookingId,
        paymentIntentId: pi.paymentIntentId,
        stripeStatus: stripe?.data?.status || null,
        attach: attach ? { http: attach.status, data: attach.data } : null,
        finalStatus: terminal?.data?.status || null,
        confirmationNumber: terminal?.data?.confirmationNumber || null,
      },
    };
    if (pi.br) {
      fs.writeFileSync(path.join(OUT, `db-${pi.br}-FAIL.sql`), dbSqlForBr(pi.br, 'S2 FAIL'));
    }
  }
}

// ---------------------------------------------------------------------------
// S1 CONFIRM — success path (kept for cancel)
// ---------------------------------------------------------------------------
console.log('\n########## S1 CONFIRM ##########');
let confirmInv = null;
let confirmBody = null;
let confirmPi = null;
{
  confirmInv = await findInventory(authToken, { preferFreeCancel: true });
  if (!confirmInv) {
    report.scenarios.CONFIRM = { status: 'NOT TESTED', error: 'no inventory' };
  } else {
    confirmBody = buildCreateBody(confirmInv, VALID_PAN, 'Ok');
    const create1 = log('createBooking success', await api('POST', '/api/hotels/createBooking', {
      body: confirmBody,
      authToken,
    }));
    confirmPi = extractPi(create1.data);
    let stripe = null;
    let attach = null;
    let terminal = null;
    if (create1.ok && confirmPi.paymentIntentId) {
      stripe = log('Stripe confirm success', await stripeConfirm(confirmPi.paymentIntentId));
      attach = log('v2 booking success', await attachBooking(authToken, confirmPi));
      terminal = await pollStatus(authToken, confirmPi.br);
    }
    const st = terminal?.data?.status;
    report.scenarios.CONFIRM = {
      status: /Confirmed/i.test(String(st || '')) ? 'PASS' : 'BUG',
      br: confirmPi.br,
      bookingId: confirmPi.bookingId,
      hotel: confirmInv.hotelName,
      checkin: confirmInv.searchBody.checkin,
      checkout: confirmInv.searchBody.checkout,
      paymentIntentId: confirmPi.paymentIntentId,
      stripeStatus: stripe?.data?.status || null,
      amountReceived: stripe?.data?.amount_received || null,
      attachHttp: attach?.status,
      finalStatus: st,
      confirmationNumber: terminal?.data?.confirmationNumber || null,
      createBodySaved: true,
    };
    if (confirmPi.br) {
      fs.writeFileSync(path.join(OUT, `db-${confirmPi.br}-CONFIRM.sql`), dbSqlForBr(confirmPi.br, 'S1 CONFIRM'));
    }
  }
}

// ---------------------------------------------------------------------------
// S3 DOUBLE BOOK — replay createBooking same body + replay v2 booking
// ---------------------------------------------------------------------------
console.log('\n########## S3 DOUBLE BOOK ##########');
{
  if (!confirmBody || !confirmPi?.br) {
    report.scenarios.DOUBLE = { status: 'NOT TESTED', error: 'no confirmed payload' };
  } else {
    const create2 = log('createBooking REPLAY same body', await api('POST', '/api/hotels/createBooking', {
      body: confirmBody,
      authToken,
    }));
    const pi2 = extractPi(create2.data);
    const attach2 = log('v2 booking REPLAY same PI+BR', await attachBooking(authToken, confirmPi));
    const sameBr = !pi2.br || pi2.br === confirmPi.br;
    const already = /already processed/i.test(JSON.stringify(attach2.data || {}));
    const newPi = pi2.paymentIntentId && pi2.paymentIntentId !== confirmPi.paymentIntentId;

    report.scenarios.DOUBLE = {
      status: sameBr && !newPi && (already || attach2.ok) ? 'PASS' : (sameBr ? 'CHECK' : 'BUG'),
      originalBr: confirmPi.br,
      originalPi: confirmPi.paymentIntentId,
      replayCreate: {
        http: create2.status,
        br: pi2.br,
        paymentIntentId: pi2.paymentIntentId,
        sameBr,
        newPaymentIntent: Boolean(newPi),
      },
      replayAttach: {
        http: attach2.status,
        message: attach2.data?.message || null,
        bookingSuccess: attach2.data?.bookingSuccess,
        alreadyProcessed: already,
        brief: brief(attach2.data, 280),
      },
      note: 'PASS if same BR, no second PI charge intent, attach says already processed / no second booking',
    };
    fs.writeFileSync(
      path.join(OUT, `db-${confirmPi.br}-DOUBLE.sql`),
      `${dbSqlForBr(confirmPi.br, 'S3 DOUBLE — same BR; expect ONE stripe payment / ONE CAPTURE')}\n-- Also compare payment_transaction count for this BR (expect no duplicate CAPTURE).`,
    );
  }
}

// ---------------------------------------------------------------------------
// S4 CANCEL — penalty-check + cancel confirmed BR
// ---------------------------------------------------------------------------
console.log('\n########## S4 CANCEL ##########');
{
  const br = report.scenarios.CONFIRM?.br;
  if (!br) {
    report.scenarios.CANCEL = { status: 'NOT TESTED', error: 'no confirmed BR' };
  } else {
    const penalty = log('penalty-check', await api('GET', `/v1/hotels/bookings/${br}/penalty-check`, { authToken }));
    const cancel = log('cancel', await api('GET', `/v1/hotels/bookings/${br}/cancel`, { authToken }));
    const terminal = await pollStatus(authToken, br, 12);
    const detail = log('detail after cancel', await api('GET', `/v1/hotels/bookings/${br}`, { authToken }));
    report.scenarios.CANCEL = {
      status: /Cancel/i.test(String(terminal?.data?.status || detail?.data?.status || '')) ? 'PASS' : 'BUG',
      br,
      penalty: {
        http: penalty.status,
        data: penalty.data,
      },
      cancel: {
        http: cancel.status,
        data: cancel.data,
      },
      finalStatus: terminal?.data?.status || detail?.data?.status,
      detailBrief: brief(detail.data, 300),
    };
    fs.writeFileSync(path.join(OUT, `db-${br}-CANCEL.sql`), dbSqlForBr(br, 'S4 CANCEL — expect cancellation_request + REFUND txn + Stripe refund'));
  }
}

// Master index + combined SQL
const index = {
  at: report.at,
  base: report.base,
  scenarios: Object.fromEntries(
    Object.entries(report.scenarios).map(([k, v]) => [k, {
      status: v.status,
      br: v.br || v.vendorPath?.br || v.originalBr || null,
      finalStatus: v.finalStatus || v.vendorPath?.finalStatus || null,
      paymentIntentId: v.paymentIntentId || v.vendorPath?.paymentIntentId || v.originalPi || null,
    }]),
  ),
  dbFiles: fs.readdirSync(OUT).filter((f) => f.startsWith('db-') && f.endsWith('.sql')),
};

fs.writeFileSync(path.join(OUT, 'MATRIX-latest.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'MATRIX-index.json'), JSON.stringify(index, null, 2));

const combined = Object.entries(report.scenarios).map(([name, s]) => {
  const br = s.br || s.vendorPath?.br || s.originalBr;
  return br ? dbSqlForBr(br, `MATRIX ${name}`) : `-- ${name}: no BR\n`;
}).join('\n\n');
fs.writeFileSync(path.join(OUT, 'db-MATRIX-all.sql'), combined);

console.log('\n========== MATRIX SUMMARY ==========');
console.log(JSON.stringify(index.scenarios, null, 2));
console.log('WROTE', path.join(OUT, 'MATRIX-latest.json'));
console.log('DB packs:', index.dbFiles.join(', '));
