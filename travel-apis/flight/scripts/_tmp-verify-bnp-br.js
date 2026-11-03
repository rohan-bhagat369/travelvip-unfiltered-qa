import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';

const BR = process.env.BR || 'BR1793694191425078';
const pid = process.env.PARTNER_ID || config.partnerId;
const tierId = Number(process.env.TIER_ID || config.tierId);

const session = await authenticate(true);
const client = session.client;
const query = { pid, tierId };
console.log(JSON.stringify({ baseUrl: config.baseUrl, pid, tierId, BR }, null, 2));

for (const path of [`/v1/flights/booking/${BR}/status`, `/v1/flights/booking/${BR}`]) {
  const res = await client.request({ method: 'GET', path, query, correlation: true });
  const d = res.data || {};
  const slim = {
    path,
    http: res.status,
    ok: res.ok,
    status: d.status || d.bookingStatus || d.bookingResponse?.status,
    error: d.error || null,
    partner: d.partnerId || d.pid || d.partner || null,
    pnr: d.pnr || d.bookingResponse?.pnr || d.items?.[0]?.pnr,
    payment: d.payment || d.payments || d.paymentSummary || null,
    keys: Object.keys(d).slice(0, 40),
    preview: JSON.stringify(d).slice(0, 3500),
  };
  console.log(JSON.stringify(slim, null, 2));
}
