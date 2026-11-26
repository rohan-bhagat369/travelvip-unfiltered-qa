/**
 * Check BR with Postman "B2B Dev" / api-staging style creds against ak-api + api-staging.
 *   node travel-apis/flight/scripts/_tmp-curl-check-br.mjs BR1795608175873564
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

const BR = process.argv[2] || 'BR1795608175873564';

// Creds from user's Postman env screenshot (api-staging / B2B Dev)
const CREDS = {
  PARTNER_ID: 'vgm',
  PARTNER_SECRET: 'vgm_ojny1swtigd4as',
  SIGNING_KEY: 'stripe_secret_key_0uzb',
  TIER_ID: '10546901',
};

const BASES = ['https://ak-api.travelvip.ai', 'https://api-staging.travelvip.ai'];

async function checkOne(base) {
  for (const [k, v] of Object.entries(CREDS)) process.env[k] = v;
  process.env.BASE_URL = base;
  clearSession();
  console.log('\n===', base, 'partner', process.env.PARTNER_ID, 'signing', process.env.SIGNING_KEY.slice(0, 12) + '…');
  const { client } = await authenticate(true);
  const flight = new FlightService(client);

  const detail = await client.request({
    method: 'GET',
    path: `/v1/flights/booking/${BR}`,
    query: { lang: 'en', currency: 'INR' },
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const status = await flight.getBookingStatus(BR);

  function collect(data, pred, out = []) {
    if (!data || typeof data !== 'object') return out;
    if (Array.isArray(data)) {
      data.forEach((x) => collect(x, pred, out));
      return out;
    }
    for (const [k, v] of Object.entries(data)) {
      if (pred(k, v)) out.push({ k, v });
      if (v && typeof v === 'object') collect(v, pred, out);
    }
    return out;
  }
  const pnrs = [
    ...new Set(
      collect(
        detail.data,
        (k, v) => typeof v === 'string' && /pnr/i.test(k) && !String(v).startsWith('BR') && String(v).length <= 24,
      ).flatMap((x) =>
        String(x.v)
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ),
  ];

  return {
    base,
    httpDetail: detail.status,
    httpStatus: status.status,
    bookingStatus: detail.data?.status || status.data?.status || null,
    journeyType: detail.data?.journeyType || null,
    tripType: detail.data?.tripType || null,
    pax: (detail.data?.passengers || detail.data?.travellers || []).length || null,
    pnrs,
    pnrCount: pnrs.length,
    totalAmount: detail.data?.totalAmount ?? detail.data?.pricing?.totalAmount ?? null,
    convenienceFee: detail.data?.convenienceFee ?? detail.data?.pricing?.convenienceFee ?? null,
    error: detail.data?.error || status.data?.error || null,
    g3Match: /confirm/i.test(String(detail.data?.status || status.data?.status || '')) && pnrs.length >= 2,
    detailData: detail.data,
    statusData: status.data,
  };
}

const results = [];
for (const base of BASES) {
  try {
    results.push(await checkOne(base));
  } catch (e) {
    results.push({ base, error: e.message });
  }
}

const outPath = path.join(
  process.cwd(),
  'travel-apis/flight/reports/cancel-bundle-2026-11-20',
  `g3-curl-check-${BR}-staging-creds.json`,
);
fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), br: BR, credsNote: 'Postman screenshot signing_key=stripe_secret_key_0uzb', results }, null, 2));

for (const r of results) {
  const { detailData, statusData, ...summary } = r;
  console.log(JSON.stringify(summary, null, 2));
  if (detailData && !detailData.error) {
    console.log('detail keys', Object.keys(detailData));
    console.log(JSON.stringify(detailData, null, 2).slice(0, 5000));
  }
}
console.log('Wrote', outPath);
