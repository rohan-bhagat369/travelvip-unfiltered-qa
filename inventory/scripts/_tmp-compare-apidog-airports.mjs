/**
 * Compare Apidog airports/search curl shape vs our TravelVipClient call on zeta-api.travelvip.ai
 */
import fs from 'fs';
import { authenticate } from '../../shared/lib/authService.js';
import { createRequestId, createSignature, createTimestamp } from '../../shared/lib/signature.js';

for (const line of fs.readFileSync('d:/Travel VIP API Automation/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
}
process.env.BASE_URL = 'https://zeta-api.travelvip.ai';

function decodeJwt(token) {
  try {
    const mid = String(token).split('.')[1];
    return JSON.parse(Buffer.from(mid, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const APIDOG_AUTH = process.env.APIDOG_AUTH
  || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2YTBkOWNiOTM0OTNiMS44MjQ3MzEyNiIsInRva2VuRGF0ZSI6IjIwMjYtMTEtMjAgMTA6Mjk6MzYiLCJrZXkiOiJvam55MXN3dGlnZDRhcyIsInBpZCI6InZnbSIsInRpZXJJZCI6MTA1NDY5MDEsInN1YnNjcmlwdGlvbklkIjoiNDYzMDM4NjYxNmFmNmJiNSIsInR5cGUiOiJndWVzdCIsImlhdCI6MTc5NTE3MDU3NiwiZXhwIjoxNzk1MjU2OTc2fQ.CbhvN61NDY4Mf5FKIrj77roXanPcl6VoaDpPu94sgs00V2';

const apidogClaims = decodeJwt(APIDOG_AUTH);
console.log('=== APIDOG curl ===');
console.log({
  method: 'GET',
  url: 'https://zeta-api.travelvip.ai/v1/airports/search?lang=en&currency=INR&page=0&perpage=20&q=dxb',
  headersPresent: [
    'Authorization: Bearer <auth_token>',
    'X-Request-Id',
    'X-Timestamp',
    'X-Signature',
    'X-Correlation-ID',
    'User-Agent: Apidog',
    'Accept: /',
  ],
  headersMissingVsUs: ['X-Partner-Key', 'Content-Type'],
  jwt: {
    pid: apidogClaims?.pid,
    tierId: apidogClaims?.tierId,
    subscriptionId: apidogClaims?.subscriptionId,
    type: apidogClaims?.type,
    userId: apidogClaims?.userId,
    iat: apidogClaims?.iat,
    exp: apidogClaims?.exp,
  },
});

const { client, authToken } = await authenticate(true);
const ourClaims = decodeJwt(authToken);

// Capture what client would send by monkey-patching via a logged request
const captured = {};
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  captured.url = String(url);
  captured.method = init?.method;
  captured.headers = { ...(init?.headers || {}) };
  // redact secrets in print later
  return origFetch(url, init);
};

const res = await client.request({
  method: 'GET',
  path: '/v1/airports/search',
  query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, q: 'dxb' },
  correlation: true,
  partnerKey: client.partnerKey,
});
globalThis.fetch = origFetch;

console.log('\n=== OUR client (bookings used this shape) ===');
console.log({
  method: captured.method,
  url: captured.url,
  headersPresent: Object.keys(captured.headers || {}),
  hasPartnerKey: Boolean(captured.headers?.['X-Partner-Key']),
  hasAuth: Boolean(captured.headers?.Authorization),
  hasSignature: Boolean(captured.headers?.['X-Signature']),
  hasTimestamp: Boolean(captured.headers?.['X-Timestamp']),
  hasCorrelation: Boolean(captured.headers?.['X-Correlation-ID']),
  jwt: {
    pid: ourClaims?.pid,
    tierId: ourClaims?.tierId,
    subscriptionId: ourClaims?.subscriptionId,
    type: ourClaims?.type,
    userId: ourClaims?.userId,
  },
  http: res.status,
  ok: res.ok,
  totalCount: res.data?.totalCount,
  sampleCodes: (res.data?.results || []).slice(0, 3).map((r) => r.airportCode),
});

// Also try Apidog-like call WITHOUT X-Partner-Key, using fresh tokens + same signing as client
const ts = createTimestamp();
const rid = createRequestId();
const sig = createSignature('', ts, process.env.SIGNING_KEY);
const url = 'https://zeta-api.travelvip.ai/v1/airports/search?lang=en&currency=INR&page=0&perpage=20&q=dxb';
const apidogLike = await fetch(url, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${authToken}`,
    'X-Request-Id': rid,
    'X-Timestamp': ts,
    'X-Signature': sig,
    'X-Correlation-ID': client.correlationId,
    Accept: '*/*',
  },
});
const apidogLikeBody = await apidogLike.text();
console.log('\n=== Same URL + auth WITHOUT X-Partner-Key (Apidog-like) ===');
console.log({
  http: apidogLike.status,
  sample: apidogLikeBody.slice(0, 250),
});

const withPk = await fetch(url, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${authToken}`,
    'X-Partner-Key': client.partnerKey,
    'X-Request-Id': createRequestId(),
    'X-Timestamp': ts,
    'X-Signature': createSignature('', ts, process.env.SIGNING_KEY),
    'X-Correlation-ID': client.correlationId,
    Accept: '*/*',
    'Content-Type': 'application/json',
  },
});
const withPkBody = await withPk.text();
console.log('\n=== Same + X-Partner-Key (our bookings) ===');
console.log({
  http: withPk.status,
  sample: withPkBody.slice(0, 250),
});
