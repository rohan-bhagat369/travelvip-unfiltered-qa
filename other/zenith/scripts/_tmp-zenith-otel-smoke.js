import { config } from '../../../shared/config/env.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import { createRequestId } from '../../../shared/lib/signature.js';

const BASE = process.env.BASE_URL || 'https://zenith-api.travelvip.ai';
const PREFIX = process.env.CORR_PREFIX || `qa-otel-zenith-${Date.now()}`;

async function call(label, corr, opts) {
  const client = new TravelVipClient({
    baseUrl: BASE,
    correlationId: corr,
    authToken: opts.authToken || null,
    partnerKey: opts.partnerKey || null,
  });
  const t0 = Date.now();
  const res = await client.request({
    ...opts,
    extraHeaders: { 'X-Request-Id': createRequestId(), ...(opts.extraHeaders || {}) },
  });
  const ms = Date.now() - t0;
  const body = JSON.stringify(res.data);
  console.log(
    JSON.stringify({
      label,
      corr,
      method: opts.method || 'GET',
      path: opts.path,
      http: res.status,
      ok: res.ok,
      clientMs: ms,
      bodyPreview: body.slice(0, 220),
    })
  );
  return res;
}

(async () => {
  console.log(JSON.stringify({ baseUrl: BASE, prefix: PREFIX, partnerId: config.partnerId, tierId: config.tierId }));

  const tokenCorr = `${PREFIX}-token`;
  const token = await call('partner-token', tokenCorr, {
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: config.partnerId, partner_secret: config.partnerSecret },
    signed: false,
    auth: false,
  });
  if (!token.ok) process.exit(1);
  const access = token.data.access_token;

  const sessCorr = `${PREFIX}-session`;
  const sess = await call('session', sessCorr, {
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: config.tierId },
    signed: false,
    auth: false,
    partnerKey: access,
  });
  if (!sess.ok) process.exit(1);
  const authToken = sess.data.auth_token;

  await call('hotel-autocomplete', `${PREFIX}-hotel-ac`, {
    method: 'GET',
    path: '/v1/hotels/autocomplete',
    query: { q: 'pune', page: 1, perpage: 5 },
    signed: true,
    auth: true,
    authToken,
    partnerKey: access,
  });

  const hotelClient = new TravelVipClient({
    baseUrl: BASE,
    correlationId: `${PREFIX}-hotel-ac`,
    authToken,
    partnerKey: access,
  });
  // authenticate-style client already used above; airports:
  const airClient = new TravelVipClient({
    baseUrl: BASE,
    correlationId: `${PREFIX}-airports`,
    authToken,
    partnerKey: access,
  });
  const t0 = Date.now();
  const air = await airClient.request({
    method: 'GET',
    path: '/v1/flights/airports',
    query: { airport: 'BOM' },
    signed: true,
    auth: true,
  });
  console.log(
    JSON.stringify({
      label: 'flight-airports',
      corr: `${PREFIX}-airports`,
      method: 'GET',
      path: '/v1/flights/airports',
      http: air.status,
      ok: air.ok,
      clientMs: Date.now() - t0,
      bodyPreview: JSON.stringify(air.data).slice(0, 220),
    })
  );
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
