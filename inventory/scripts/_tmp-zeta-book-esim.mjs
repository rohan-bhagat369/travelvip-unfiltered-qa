import fs from 'fs';
import path from 'path';
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
const OUT = 'd:/Travel VIP API Automation/inventory/reports/zeta-tier-esim-booking.json';
const tag = Date.now().toString(36).replace(/[0-9]/g, 'x').replace(/[^a-z]/gi, '').slice(-4) || 'qa';

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
for (const q of ['singapore', 'united states', 'japan']) {
  const search = await req({ method: 'GET', path: '/v1/esim/search', query: { ...Q, page: 1, perpage: 20, q } });
  for (const country of search.data?.results || []) {
    const entityId = country.entityId || country.id || country.productId;
    if (!entityId) continue;
    const listing = await req({ method: 'GET', path: `/v1/esims/${entityId}`, query: Q });
    for (const plan of listing.data?.results || []) {
      for (const opt of plan.options || plan.availableOptions || []) {
        for (const variant of opt.variants || []) {
          const bookingContext = variant.bookingContext || variant.bookingReference;
          if (!bookingContext) continue;
          const amount = Number(variant.pricing?.totalAmount ?? variant.totalAmount ?? 999999);
          if (!pick || amount < pick.amount) {
            pick = {
              title: country.title, entityId, productId: plan.productId,
              optionId: opt.optionId, variantId: variant.variantId, bookingContext, amount,
            };
          }
        }
      }
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
  firstName: 'Saurabhi',
  lastName: `Chawda${tag}`,
  gender: 'FEMALE',
  dob: '2003-05-01',
  nationality: 'IN',
};
const body = {
  bookingContext: pick.bookingContext,
  passengers: [{ paxType: 'ADT', profile }],
  contact: {
    email: `zeta.esim.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: '9876543210',
  },
};
const res = await req({
  method: 'POST',
  path: '/v1/esims/finalize-booking',
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
