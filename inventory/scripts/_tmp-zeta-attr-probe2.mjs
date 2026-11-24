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
process.env.BASE_URL = 'https://zeta-api.travelx.ai';
const { client } = await authenticate(true);
const Q = { lang: 'en', currency: 'INR' };

async function tryList(cityId, label) {
  const list = await client.request({
    method: 'GET', path: '/v1/attractions',
    query: { ...Q, page: 0, perpage: 10, cityId },
    correlation: true, partnerKey: client.partnerKey,
  });
  console.log('list', label, cityId, list.status, JSON.stringify(list.data).slice(0, 400));
}

await tryList('44856', 'collection-paris');
await tryList(44856, 'collection-paris-num');

const s = await client.request({
  method: 'GET', path: '/v1/attractions/search',
  query: { ...Q, page: 0, perpage: 20, q: 'dubai' },
  correlation: true, partnerKey: client.partnerKey,
});
for (const r of (s.data?.results || []).filter((x) => x.entityType === 'PRODUCT').slice(0, 3)) {
  const productId = r.entityId;
  const detail = await client.request({
    method: 'GET', path: `/v1/attractions/${productId}`,
    query: Q,
    correlation: true, partnerKey: client.partnerKey,
  });
  console.log('\nproduct', productId, detail.status, JSON.stringify(detail.data).slice(0, 500));
}
