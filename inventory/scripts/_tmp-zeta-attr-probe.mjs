import fs from 'fs';
import path from 'path';
import { authenticate } from '../../shared/lib/authService.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
for (const line of fs.readFileSync(path.join('d:/Travel VIP API Automation', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
}
process.env.BASE_URL = 'https://zeta-api.travelx.ai';
const { client } = await authenticate(true);
const Q = { lang: 'en', currency: 'INR' };
for (const q of ['paris', 'singapore', 'dubai']) {
  const s = await client.request({
    method: 'GET', path: '/v1/attractions/search',
    query: { ...Q, page: 0, perpage: 10, q },
    correlation: true, partnerKey: client.partnerKey,
  });
  console.log('\nQ', q, 'http', s.status, 'n', (s.data?.results || []).length);
  console.log(JSON.stringify((s.data?.results || []).slice(0, 3), null, 2).slice(0, 500));
  for (const r of (s.data?.results || []).slice(0, 5)) {
    const cityId = r.cityId || r.entityId || r.id;
    const list = await client.request({
      method: 'GET', path: '/v1/attractions',
      query: { ...Q, page: 0, perpage: 5, cityId },
      correlation: true, partnerKey: client.partnerKey,
    });
    const arr = Array.isArray(list.data?.results) ? list.data.results : Object.values(list.data?.results || {});
    console.log(' cityId', cityId, 'type', r.entityType, 'list', list.status, 'products', arr.length, arr[0]?.productId || list.data?.info || list.data?.status);
  }
}
