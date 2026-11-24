/**
 * Use Downloads "Web Dev smt_env.json" creds against delta-api.
 *   node travel-apis/hotel/scripts/probe-delta-smt-env-creds.js
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
const envDoc = JSON.parse(fs.readFileSync(ENV_PATH, 'utf8'));
const vars = Object.fromEntries(
  (envDoc.environments?.[0]?.variables || []).map((v) => [v.name, v.value]),
);

const BASE = process.env.BASE_URL || 'https://delta-api.travelvip.ai';
const PID = vars.partner_id || 'smt';
const KEY = vars.partner_key || 'palsgcvgscvvs';
const TIER = vars.tier_id || '10997401';
const MOBILE = vars.mobile_number || '9665498686';
const OTP = vars.otp || '4343';
const CALLING = vars.calling_code || '+91';
// staging signing key from repo .env (needed for signed hotel APIs)
const SIGNING_KEY = process.env.SIGNING_KEY || 'sk_test_a8f5f167f44f4964e6c998dee827110c';

function uuid() {
  return crypto.randomUUID();
}
function dayOffset(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
function brief(d, n = 350) {
  return JSON.stringify(d).slice(0, n);
}

async function api(method, urlPath, { query = {}, body, authToken, partnerKey, signed = false } = {}) {
  const q = new URLSearchParams({
    key: KEY,
    pid: PID,
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
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
    data = { _raw: text.slice(0, 400) };
  }
  return { status: r.status, ok: r.ok, data };
}

const report = {
  at: new Date().toISOString(),
  base: BASE,
  fromEnv: { file: 'Web Dev smt_env.json', partner_id: PID, partner_key: KEY, tier_id: TIER, mobile: MOBILE },
  steps: [],
};

function step(name, res) {
  const row = { name, status: res.status, brief: brief(res.data) };
  report.steps.push(row);
  console.log(`\n== ${name} == ${res.status}`);
  console.log(row.brief);
  return res;
}

function pickToken(data) {
  return (
    data?.auth_token
    || data?.authToken
    || data?.token
    || data?.avpt
    || data?.data?.auth_token
    || data?.data?.token
    || data?.result?.auth_token
    || data?.result?.token
    || null
  );
}

let authToken = null;

// 1) Guest / OTP auth paths with SMT key+pid
const hash = Buffer.from(String(Date.now())).toString('base64');
const authAttempts = [
  ['GET', '/api/checkGuestLogin', { hash, user_type: 'guest' }, undefined, false],
  ['GET', '/api/checkGuestLogin', { hash, user_type: 'smt' }, undefined, false],
  ['POST', '/api/verifyOtp', {}, { mobile: MOBILE, otp: OTP, callingCode: CALLING, countryCode: CALLING }, false],
  ['POST', '/api/verifyOtp', {}, { mobileNumber: MOBILE, otp: OTP, calling_code: CALLING }, false],
  ['POST', '/api/loginWithOtp', {}, { mobile: MOBILE, otp: OTP, callingCode: CALLING }, false],
  ['POST', '/v1/auth/otp/verify', {}, { mobile: MOBILE, otp: OTP, callingCode: CALLING }, false],
  ['POST', '/v1/auth/session', {}, { tierId: Number(TIER) }, false],
  ['POST', '/auth/partner/token', {}, { partner_id: PID, partner_secret: KEY }, false],
];

for (const [method, p, query, body, signed] of authAttempts) {
  const res = await api(method, p, { query, body, signed });
  step(`${method} ${p}`, res);
  const tok = pickToken(res.data);
  if (tok) {
    authToken = tok;
    console.log('GOT token via', p);
    break;
  }
}

// 2) If still no token: staging vgm partner token → session with SMT tier 10997401
if (!authToken) {
  const tokenRes = await api('POST', '/auth/partner/token', {
    body: { partner_id: 'vgm', partner_secret: 'vgm_ojny1swtigd4as' },
  });
  step('fallback vgm partner token', tokenRes);
  if (tokenRes.data?.access_token) {
    const sess = await api('POST', '/v1/auth/session', {
      body: { tierId: Number(TIER) },
      partnerKey: tokenRes.data.access_token,
    });
    step(`session tierId=${TIER} via vgm access`, sess);
    authToken = pickToken(sess.data);
    report.partnerAccess = tokenRes.data.access_token.slice(0, 20) + '…';
    report.accessToken = tokenRes.data.access_token;
  }
}

if (!authToken) {
  report.error = 'No auth_token with SMT env creds';
  fs.writeFileSync(path.join(OUT, 'env-creds-latest.json'), JSON.stringify(report, null, 2));
  console.error('BLOCKED: no auth');
  process.exit(1);
}

// Bind SMT tier onto guest session when possible
{
  const sess = await api('POST', '/v1/auth/session', {
    body: { tierId: Number(TIER) },
    authToken,
    partnerKey: KEY,
  });
  step(`bind session tierId=${TIER} with guest token`, sess);
  const tok2 = pickToken(sess.data);
  if (tok2) authToken = tok2;
}

try {
  const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64url').toString());
  report.jwt = { pid: payload.pid, key: payload.key, tierId: payload.tierId, type: payload.type };
  console.log('JWT', report.jwt);
} catch {}

const accessToken = report.accessToken || KEY;

// 3) Signed hotel flow + createBooking CARD
const checkin = dayOffset(28);
const checkout = dayOffset(29);
const searchBody = {
  checkin,
  checkout,
  entityId: '39627872',
  nationality: 'IN',
  type: 'HOTEL',
  rooms: [{ adults: 1, children: 0, childrenAges: [] }],
};

const search = await api('POST', '/v1/hotels/search', {
  query: { page: '0', perpage: '10', tier_id: TIER },
  body: searchBody,
  authToken,
  partnerKey: accessToken,
  signed: true,
});
step('search', search);

if (!search.ok) {
  report.error = 'search failed';
  fs.writeFileSync(path.join(OUT, 'env-creds-latest.json'), JSON.stringify(report, null, 2));
  process.exit(2);
}

const details = await api('POST', '/v1/hotels/details', {
  query: { page: '0', perpage: '20', tier_id: TIER },
  body: searchBody,
  authToken,
  partnerKey: accessToken,
  signed: true,
});
step('details', details);

const rooms = details.data?.results?.[0]?.rooms || [];
const room = rooms.find((r) => r.bookingCode) || rooms[0];
const requestId =
  details.data?.requestId
  || details.data?.results?.[0]?.requestId
  || search.data?.requestId
  || uuid();
const bookingCode = room?.bookingCode;

if (!bookingCode) {
  report.error = 'no bookingCode';
  fs.writeFileSync(path.join(OUT, 'env-creds-latest.json'), JSON.stringify(report, null, 2));
  process.exit(3);
}

const prebook = await api('POST', '/v1/hotels/prebook', {
  query: { tier_id: TIER },
  body: { bookingCode, requestId },
  authToken,
  partnerKey: accessToken,
  signed: true,
});
step('prebook', prebook);

const bookingContext =
  prebook.data?.bookingContext
  || prebook.data?.results?.[0]?.bookingContext
  || details.data?.bookingContext
  || details.data?.results?.[0]?.bookingContext;

const createBody = {
  bookingCode,
  bookingContext,
  requestId: prebook.data?.requestId || requestId,
  checkin,
  checkout,
  paymentMethod: 'CARD',
  redirectUrl: 'https://delta-shop.travelvip.ai/booking/status',
  contact: {
    email: `smt.env.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: MOBILE,
    panCardNumber: 'EUIPB1672M',
    panCardName: 'Rohan Bhagat',
  },
  rooms: [
    {
      guests: [
        {
          title: 'Mr',
          firstName: 'Rohan',
          lastName: 'Bhagat',
          type: 'Adult',
          isLead: true,
        },
      ],
    },
  ],
};

const createRes = await api('POST', '/api/hotels/createBooking', {
  query: { tier_id: TIER },
  body: createBody,
  authToken,
  partnerKey: accessToken,
  signed: true,
});
step('createBooking CARD', createRes);

report.createBooking = { status: createRes.status, data: createRes.data };

const pd = createRes.data?.paymentData || {};
const clientSecret = typeof pd.paymentIntent === 'string' ? pd.paymentIntent : null;
const paymentIntentId = clientSecret?.includes('_secret') ? clientSecret.split('_secret')[0] : null;
const br = createRes.data?.bookingReference;

if (createRes.ok && paymentIntentId) {
  const cardRaw = fs.readFileSync(path.join(process.env.USERPROFILE, 'Downloads', 'cardpayment.json'), 'utf8');
  const stripeSk = cardRaw.match(/sk_test_[A-Za-z0-9]+/)?.[0];
  const conf = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSk}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      payment_method: 'pm_card_visa',
      return_url: 'https://delta-shop.travelvip.ai/booking/status',
    }),
  });
  const confData = await conf.json();
  step('Stripe confirm', { status: conf.status, ok: conf.ok, data: confData });
  report.stripe = { status: conf.status, stripeStatus: confData.status, id: confData.id };

  const book = await api('POST', '/api/v2/hotels/booking', {
    query: { tier_id: TIER },
    body: { paymentIntentId, bookingReference: br, bookingRefId: br },
    authToken,
    partnerKey: accessToken,
    signed: true,
  });
  step('v2 hotels/booking', book);
  report.v2Booking = { status: book.status, data: book.data };

  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await api('GET', `/v1/hotels/bookings/${br}/status`, {
      query: { tier_id: TIER },
      authToken,
      partnerKey: accessToken,
      signed: true,
    });
    console.log(`  status poll ${i + 1}: ${st.data?.status}`);
    if (st.data?.status && /Confirmed|Failed|Cancelled/i.test(String(st.data.status))) {
      report.finalStatus = st.data;
      step('final status', st);
      break;
    }
  }
}

fs.writeFileSync(path.join(OUT, 'env-creds-latest.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, `env-creds-${Date.now()}.json`), JSON.stringify(report, null, 2));
console.log('\nWROTE', path.join(OUT, 'env-creds-latest.json'));
console.log('BR', br || '-', 'final', report.finalStatus?.status || report.createBooking?.status);
