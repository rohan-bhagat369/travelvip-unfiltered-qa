/**
 * Check one BR on ak-api using staging .env creds.
 *   node travel-apis/flight/scripts/_tmp-check-br-g3.mjs BR1795608175873564
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

// Force staging .env only (ignore nova-api_dev overrides)
const envPath = path.join(process.cwd(), '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.BASE_URL = 'https://ak-api.travelvip.ai';
// staging partner from .env
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.TIER_ID = process.env.TIER_ID || '10546901';

const BR = process.argv[2] || 'BR1795608175873564';

function walkCollect(data, pred, out = []) {
  if (!data || typeof data !== 'object') return out;
  if (Array.isArray(data)) {
    data.forEach((x) => walkCollect(x, pred, out));
    return out;
  }
  for (const [k, v] of Object.entries(data)) {
    if (pred(k, v)) out.push({ k, v });
    if (v && typeof v === 'object') walkCollect(v, pred, out);
  }
  return out;
}

clearSession();
console.log('BASE', process.env.BASE_URL, 'partner', process.env.PARTNER_ID, 'tier', process.env.TIER_ID);
const { client } = await authenticate(true);
const flight = new FlightService(client);

const st = await flight.getBookingStatus(BR);
let detail = null;
try {
  detail = await flight.getBookingDetail(BR);
} catch (e) {
  detail = { status: 'ERR', data: { error: { message: e.message } } };
}

const blob = { status: st.data, detail: detail?.data };
const pnrs = [
  ...new Set(
    walkCollect(
      blob,
      (k, v) =>
        typeof v === 'string' && /pnr/i.test(k) && !String(v).startsWith('BR') && String(v).length <= 24,
    ).flatMap((x) =>
      String(x.v)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ),
];
const airlines = [
  ...new Set(
    walkCollect(
      blob,
      (k, v) => typeof v === 'string' && /airline|carrier|marketingCarrier|operatingCarrier/i.test(k) && v.length <= 8,
    ).map((x) => x.v),
  ),
];
const flights = walkCollect(
  blob,
  (k, v) => typeof v === 'string' && /flightNumber|flightNo|flightCode/i.test(k),
).map((x) => x.v);
const money = {};
for (const { k, v } of walkCollect(
  blob,
  (k, v) => typeof v === 'number' && /total|fare|tax|convenience|amount|price|penalty/i.test(k),
)) {
  if (!(k in money)) money[k] = v;
}
const pax =
  st.data?.passengers ||
  detail?.data?.passengers ||
  detail?.data?.travellers ||
  detail?.data?.pax ||
  [];
const legs =
  detail?.data?.journeys ||
  detail?.data?.segments ||
  detail?.data?.flights ||
  st.data?.journeys ||
  [];

const bookingStatus = st.data?.status || detail?.data?.status;
const journeyType =
  st.data?.journeyType || detail?.data?.journeyType || detail?.data?.trip?.journeyType || null;

const out = {
  br: BR,
  base: process.env.BASE_URL,
  partner: process.env.PARTNER_ID,
  http: { status: st.status, detail: detail?.status },
  error: st.data?.error || detail?.data?.error || null,
  bookingStatus,
  journeyType,
  tripType: st.data?.tripType || detail?.data?.tripType || null,
  paxCount: Array.isArray(pax) ? pax.length : null,
  pnrs,
  pnrCount: pnrs.length,
  airlines,
  flights: [...new Set(flights)].slice(0, 10),
  money,
  g3Need: {
    confirmed: /confirm/i.test(String(bookingStatus)),
    multiPnr: pnrs.length >= 2,
    roundTripHint: /round|rt/i.test(String(journeyType || '')) || pnrs.length >= 2,
    usableForOnlineCancelDashboard: /confirm/i.test(String(bookingStatus)) && pnrs.length >= 2,
  },
};

const outPath = path.join(
  process.cwd(),
  'travel-apis/flight/reports/cancel-bundle-2026-11-20',
  `g3-check-${BR}.json`,
);
fs.writeFileSync(
  outPath,
  JSON.stringify({ at: new Date().toISOString(), out, statusFull: st.data, detailFull: detail?.data }, null, 2),
);
console.log(JSON.stringify(out, null, 2));
console.log('Wrote', outPath);
