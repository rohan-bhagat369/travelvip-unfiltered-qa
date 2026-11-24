import fs from 'fs';
import { authenticate } from '../../shared/lib/authService.js';

for (const line of fs.readFileSync('d:/Travel VIP API Automation/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
}
process.env.BASE_URL = process.env.ZETA_BASE_URL || 'https://zeta-api.travelvip.ai';

const Q = { lang: 'en', currency: 'INR' };
const OUT = 'd:/Travel VIP API Automation/inventory/reports/zeta-tier-ft-booking.json';
const tag = Date.now().toString(36).replace(/[0-9]/g, 'x').replace(/[^a-z]/gi, '').slice(-4) || 'qa';
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function brOf(d) {
  return d?.bookingRefId || d?.bookingReferenceId || d?.bookingReference || null;
}

const { client, authToken } = await authenticate(true);
let claims = null;
try {
  claims = JSON.parse(Buffer.from(String(authToken).split('.')[1], 'base64url').toString('utf8'));
} catch { /* ignore */ }

console.log('BASE', process.env.BASE_URL);
console.log('SESSION', { tierId: claims?.tierId, subscriptionId: claims?.subscriptionId });

async function req(opts) {
  return client.request({ ...opts, correlation: true, partnerKey: client.partnerKey });
}

let pick = null;
for (const q of ['dxb', 'hak', 'sin', 'del', 'bom']) {
  const s = await req({
    method: 'GET', path: '/v1/fasttracks/airports/search',
    query: { ...Q, page: 0, perpage: 8, q },
  });
  for (const a of s.data?.results || []) {
    const airportId = a.airportId;
    if (!airportId) continue;
    const terms = Array.isArray(a.terminals) && a.terminals.length
      ? a.terminals
      : ['Terminal 1', 'Terminal 2'];
    for (const terminal of terms) {
      for (const terminalSide of ['Departure', 'Arrival']) {
        const list = await req({
          method: 'GET', path: '/v1/fasttracks',
          query: { ...Q, page: 0, perpage: 10, airportId, terminal, terminalSide },
        });
        for (const ft of list.data?.results || []) {
          const productId = ft.productId;
          const optionId = ft.options?.[0]?.optionId || ft.availableOptions?.[0]?.optionId;
          if (!productId) continue;
          const detail = await req({
            method: 'GET', path: `/v1/fasttracks/${productId}`,
            query: { ...Q, ...(optionId ? { optionId } : {}) },
          });
          for (const item of detail.data?.results || []) {
            for (const o of item.options || item.availableOptions || []) {
              const bookingContext = o.bookingContext || o.bookingReference;
              if (bookingContext) {
                pick = {
                  airportId, airportCode: a.airportCode, terminal, terminalSide,
                  productId, optionId: o.optionId || optionId, bookingContext,
                };
                break;
              }
            }
            if (pick) break;
          }
          if (pick) break;
        }
        if (pick) break;
      }
      if (pick) break;
    }
    if (pick) break;
  }
  if (pick) break;
}

if (!pick) {
  console.log('NO_INVENTORY');
  process.exit(2);
}
console.log('PICK', { ...pick, bookingContext: String(pick.bookingContext).slice(0, 60) + '…' });

const profile = {
  title: 'Ms',
  firstName: 'Sharayu',
  lastName: `Meghare${tag}`,
  gender: 'FEMALE',
  dob: '2003-05-01',
  nationality: 'IN',
};
const body = {
  bookingContext: pick.bookingContext,
  travelDate: addDays(7),
  travelTime: '07:20',
  passengers: [{ paxType: 'ADT', isLead: true, profile }],
  contact: {
    email: `zeta.ft.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: '9876543210',
  },
};
const res = await req({
  method: 'POST',
  path: '/v1/airportServices/fasttracks/finalize-booking',
  query: Q,
  body,
});
const br = brOf(res.data);
const report = {
  at: new Date().toISOString(),
  base: process.env.BASE_URL,
  session: { tierId: claims?.tierId, subscriptionId: claims?.subscriptionId },
  pick: { ...pick, bookingContext: String(pick.bookingContext).slice(0, 80) + '…' },
  name: `${profile.firstName} ${profile.lastName}`,
  br,
  status: res.data?.status ?? null,
  http: res.status,
  correlation: res.data?._meta?.correlation_id || null,
  sample: JSON.stringify(res.data).slice(0, 500),
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!br) process.exit(1);
