import fs from 'fs';

const BEARER = process.env.SHOP_BEARER;
const BASE = 'https://api.travelvip.ai/api/hotelbooking/getHotelResults';

async function post(body, offset = 0) {
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs', pid: 'smt', platform: 'web', client: 'web',
    lang: 'en', currency: 'INR', offset: String(offset),
  });
  const res = await fetch(`${BASE}?${qs}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${BEARER}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch((e) => ({ err: String(e) }));
  return { status: res.status, data };
}

function findRooms(obj, path = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    if (
      obj.length
      && obj[0]
      && typeof obj[0] === 'object'
      && (obj[0].mealType != null || obj[0].priceDetail || obj[0].roomType || obj[0].Rooms)
    ) {
      out.push({ path, n: obj.length, sample: obj[0] });
    }
    obj.forEach((x, i) => findRooms(x, `${path}[${i}]`, out));
  } else {
    for (const [k, v] of Object.entries(obj)) findRooms(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

const cityBody = {
  checkin: '2026-09-25',
  checkout: '2026-09-26',
  type: 'TBOCITY',
  entityId: '357389:IN',
  nationality: 'IN',
  nationalityLabel: 'Indian',
  entityLabel: 'Mumbai , India',
  requestId: '',
  pid: 'smt',
  rt: 'compact',
  rooms: [{ adults: 2, children: 0, childrenAges: [] }],
  fq: { df_long_star_rating: ['5'] },
};

const s = await post(cityBody);
const content = s.data?.content || s.data?.results || [];
console.log('search', s.status, 'n=', content.length, 'topKeys=', Object.keys(s.data || {}));
console.log('requestId=', s.data?.requestId || s.data?.data?.requestId || null);
if (content[0]) {
  console.log('hotel0 keys', Object.keys(content[0]));
  console.log('hotel0', JSON.stringify({
    entityId: content[0].entityId,
    id: content[0].id,
    title: content[0].title,
    name: content[0].name,
    star: content[0].starRating || content[0].star,
  }));
}

const h = content[0];
const eid = h?.entityId || h?.id;
const rid = s.data?.requestId || '';
const d = await post({
  checkin: '2026-09-25',
  checkout: '2026-09-26',
  type: 'HOTEL',
  entityId: eid,
  nationality: 'IN',
  nationalityLabel: 'Indian',
  entityLabel: 'Mumbai , India',
  requestId: rid,
  pid: 'smt',
  rt: 'detailed',
  rooms: [{ adults: 2, children: 0, childrenAges: [] }],
});
console.log('details', d.status, 'topKeys=', Object.keys(d.data || {}));
fs.writeFileSync('reports/_probe-mumbai-details.json', JSON.stringify(d.data, null, 2));
const rooms = findRooms(d.data);
console.log('room arrays found', rooms.length);
for (const r of rooms.slice(0, 3)) {
  console.log(' at', r.path, 'n=', r.n, 'sampleKeys=', Object.keys(r.sample || {}));
  console.log(' sample', JSON.stringify(r.sample).slice(0, 600));
}
console.log('wrote reports/_probe-mumbai-details.json size', JSON.stringify(d.data || {}).length);
