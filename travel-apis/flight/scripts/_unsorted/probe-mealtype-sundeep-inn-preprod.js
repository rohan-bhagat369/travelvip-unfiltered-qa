/**
 * Recheck Sundeep Inn (Delhi / Vasant Vihar) mealType vs inclusion on preprod.
 * BUG only: MealType=No Meal AND Inclusion has Breakfast.
 */
import fs from 'fs';

const BASE = process.env.SHOP_BASE || 'https://preprod-next-api.travelvip.ai';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const CHECKIN = '2026-09-23';
const CHECKOUT = '2026-09-24';
const ENTITY_FALLBACK = '39637795';

const hasBF = (s) => /breakfast|\bbb\b|\bcp\b/i.test(String(s || ''));
const isNoMeal = (s) => /^no\s*meal$/i.test(String(s || '').trim());

async function post(body, q = '', offset = 0) {
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs',
    pid: 'smt',
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
    offset: String(offset),
    page: '0',
  });
  if (q) qs.set('q', q);
  const res = await fetch(`${BASE}/api/hotelbooking/getHotelResults?${qs}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${BEARER}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function roomsOf(d) {
  const c0 = (d.content || [])[0];
  const rd = c0?.data?.roomDetail || {};
  const rooms = rd.Rooms || [];
  const info = d.roomsInfo || [];
  return rooms.map((r, i) => {
    const inf = info[i] || {};
    const nameRaw = inf.Title || inf.roomType || r.RoomType || r.Name || 'Room';
    const name = Array.isArray(nameRaw) ? nameRaw.join(' / ') : String(nameRaw);
    return {
      name,
      mealType: inf.MealType || r.MealType || '',
      inclusion: String(inf.Inclusion || r.Inclusion || ''),
      total: r.TotalFare ?? r.priceDetail?.totalPrice ?? inf.TotalFare ?? null,
    };
  });
}

function score(room) {
  if (isNoMeal(room.mealType) && hasBF(room.inclusion)) {
    return { verdict: 'BUG', note: 'MealType=No Meal but Inclusion has Breakfast' };
  }
  if (hasBF(room.mealType) && hasBF(room.inclusion)) {
    return { verdict: 'PASS', note: 'Breakfast MealType + Inclusion aligned' };
  }
  if (isNoMeal(room.mealType) && !hasBF(room.inclusion)) {
    return { verdict: 'PASS', note: 'Room Only consistent' };
  }
  return { verdict: 'PASS', note: `meal=${room.mealType}` };
}

async function main() {
  if (!BEARER) throw new Error('SHOP_BEARER required');

  const cityBody = {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'TBOCITY',
    entityId: '227760:IN',
    nationality: 'IN',
    nationalityLabel: 'Indian',
    entityLabel: 'New Delhi , India',
    requestId: '',
    pid: 'smt',
    rt: 'compact',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    fq: { df_long_star_rating: [] },
  };

  const search = await post(cityBody, 'sundeep', 0);
  const list = (search.data.content || []).map((x) => ({
    title: x.title || x.name,
    entityId: x.entityId || x.id,
    address: x.address || x.data?.address || null,
  }));
  console.log('search http', search.status, 'hits', list.length);
  for (const h of list) {
    console.log(' hit', h.title, '|', h.entityId, '|', h.address);
  }

  const target =
    list.find((h) => /sundeep\s*inn/i.test(String(h.title || ''))) || {
      title: 'Sundeep Inn',
      entityId: ENTITY_FALLBACK,
    };

  console.log('\n=== Sundeep Inn ===');
  console.log('using', target.title, target.entityId);

  const det = await post(
    {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      type: 'HOTEL',
      entityId: String(target.entityId),
      nationality: 'IN',
      nationalityLabel: 'Indian',
      entityLabel: 'New Delhi , India',
      requestId: search.data?.requestId || '',
      pid: 'smt',
      rt: 'detailed',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    },
    'delhi',
    0
  );

  const c0 = (det.data.content || [])[0];
  const hotelName = c0?.data?.name || c0?.title || target.title;
  const address = c0?.data?.address || c0?.address || target.address || null;
  const rooms = roomsOf(det.data);

  console.log('details http', det.status);
  console.log('hotel', hotelName);
  console.log('address', address);
  console.log('rates', rooms.length);

  let pass = 0;
  let bug = 0;
  const rows = [];
  for (const r of rooms) {
    const scored = score(r);
    if (scored.verdict === 'BUG') bug += 1;
    else pass += 1;
    const inclShort = String(r.inclusion).replace(/<br\s*\/?>/gi, ' | ').slice(0, 140);
    console.log(
      `  [${scored.verdict}] ${r.name.trim()} | meal=${r.mealType} | ₹${r.total} | ${inclShort}`
    );
    rows.push({ ...r, ...scored });
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    hotelName,
    hotelEntityId: String(target.entityId),
    address,
    counts: { PASS: pass, BUG: bug, total: rooms.length },
    rows,
  };
  fs.writeFileSync('reports/mealtype-sundeep-inn-preprod.json', JSON.stringify(out, null, 2));
  console.log('\nSCORE', out.counts);
  console.log('Report reports/mealtype-sundeep-inn-preprod.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
