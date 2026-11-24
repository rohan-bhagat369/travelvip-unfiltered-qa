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
const OUT = 'd:/Travel VIP API Automation/inventory/reports/zeta-tier-attr-booking.json';
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
const queries = ['dubai', 'singapore', 'paris', 'bangkok', 'london', 'rome'];
for (const q of queries) {
  const search = await req({
    method: 'GET', path: '/v1/attractions/search',
    query: { ...Q, page: 0, perpage: 20, q },
  });
  console.log('search', q, 'n', (search.data?.results || []).length, search.data?.status || search.status);

  const candidates = (search.data?.results || [])
    .map((r) => ({
      cityId: r?.cityId || r?.entityId || r?.id,
      title: r?.title,
      country: r?.country,
      entityType: r?.entityType,
    }))
    .filter((x) => x.cityId);

  // Prefer CITY entities
  candidates.sort((a, b) => {
    const as = String(a.entityType).toUpperCase() === 'CITY' ? 0 : 1;
    const bs = String(b.entityType).toUpperCase() === 'CITY' ? 0 : 1;
    return as - bs;
  });

  for (const c of candidates.slice(0, 8)) {
    const list = await req({
      method: 'GET', path: '/v1/attractions',
      query: { ...Q, page: 0, perpage: 10, cityId: c.cityId },
    });
    if (list.data?.status === 500 || /Category not found/i.test(JSON.stringify(list.data || {}))) {
      console.log('list blocked', c.cityId, list.data?.detail || list.data?.title);
      // keep trying others; if all blocked same way, exit later
      continue;
    }
    const resultsArr = Array.isArray(list.data?.results)
      ? list.data.results
      : Object.values(list.data?.results || {});
    if (!resultsArr.length) continue;

    const productId = resultsArr[0]?.productId;
    if (!productId) continue;
    const detail = await req({
      method: 'GET', path: `/v1/attractions/${productId}`,
      query: Q,
    });
    if (detail.data?.status === 500 || /Category not found/i.test(JSON.stringify(detail.data || {}))) {
      console.log('detail blocked', productId, detail.data?.detail);
      continue;
    }
    const productDetailsArr = Array.isArray(detail.data?.results)
      ? detail.data.results
      : Object.values(detail.data?.results || {});
    const firstProduct = productDetailsArr[0];
    const optionId = firstProduct?.options?.[0]?.optionId;
    const variantId = firstProduct?.options?.[0]?.variants?.[0]?.variantId;
    if (!optionId || !variantId) continue;

    for (let attempt = 0; attempt < 5; attempt++) {
      const visitDate = addDays(7 + attempt * 2);
      const availability = await req({
        method: 'POST', path: '/v1/attractions/availability',
        query: { ...Q, optionId },
        body: {
          dateFrom: visitDate,
          dateTo: visitDate,
          productId,
          variants: [{ variantId, quantity: 1 }],
        },
      });
      const bookingReference = availability.data?.bookingReference || availability.data?.bookingRef;
      const slots = availability.data?.slots || [];
      console.log('avail', productId, visitDate, availability.status, !!bookingReference, slots.length, availability.data?.error?.code || availability.data?.status);
      if (!bookingReference || !slots.length) continue;
      pick = {
        q, cityId: c.cityId, title: c.title || resultsArr[0]?.title,
        productId, optionId, variantId, bookingReference, visitDate, slot: slots[0],
      };
      break;
    }
    if (pick) break;
  }
  if (pick) break;
}

if (!pick) {
  const probe = await req({
    method: 'GET', path: '/v1/attractions',
    query: { ...Q, page: 0, perpage: 5, cityId: 32 },
  });
  const report = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    session: { tierId: claims?.tierId, subscriptionId: claims?.subscriptionId },
    ok: false,
    error: 'NO_INVENTORY_OR_CATEGORY_BLOCKED',
    probe: JSON.stringify(probe.data).slice(0, 400),
    correlation: probe.data?._meta?.correlation_id || null,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

console.log('PICK', { ...pick, bookingReference: String(pick.bookingReference).slice(0, 60) + '…' });

const fullName = `Sharayu Attr${tag}`;
const body = {
  productId: pick.productId,
  optionId: pick.optionId,
  bookingReference: pick.bookingReference,
  variants: [{
    variantId: pick.variantId,
    quantity: 1,
    visitDate: pick.visitDate,
    questionList: [],
    slot: [pick.slot],
  }],
  contact: {
    fullName,
    email: `zeta.attr.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: '7410015224',
  },
};
const res = await req({
  method: 'POST',
  path: '/v1/airportServices/attractions/finalize-booking',
  query: { ...Q, optionId: pick.optionId },
  body,
});
const br = brOf(res.data);
const report = {
  at: new Date().toISOString(),
  base: process.env.BASE_URL,
  session: { tierId: claims?.tierId, subscriptionId: claims?.subscriptionId },
  pick: { ...pick, bookingReference: String(pick.bookingReference).slice(0, 80) + '…' },
  name: fullName,
  br,
  status: res.data?.status ?? null,
  http: res.status,
  correlation: res.data?._meta?.correlation_id || null,
  sample: JSON.stringify(res.data).slice(0, 500),
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!br) process.exit(1);
