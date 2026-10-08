/**
 * Recheck meal-type mapping on preprod.
 * Same room title with multiple rate plans = EXPECTED (not a bug).
 * BUG only when MealType=No Meal AND Inclusion contains Breakfast.
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.SHOP_BASE || 'https://preprod-next-api.travelvip.ai';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const CHECKIN = '2026-09-23';
const CHECKOUT = '2026-09-24';

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN', entityLabel: 'Mumbai , India', q: 'mumbai' },
  { key: 'Delhi', entityId: '227760:IN', entityLabel: 'New Delhi , India', q: 'delhi' },
  { key: 'Bengaluru', entityId: '341153:IN', entityLabel: 'Bengaluru , India', q: 'bangalore' },
  { key: 'Hyderabad', entityId: '227706:IN', entityLabel: 'Hyderabad , India', q: 'hyderabad' },
  { key: 'Chennai', entityId: '228269:IN', entityLabel: 'Chennai , India', q: 'chennai' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasBF = (s) => /breakfast|\bbb\b|\bcp\b/i.test(String(s || ''));
const isNoMeal = (s) => /^no\s*meal$/i.test(String(s || '').trim());

async function post(body, q = '', offset = 0) {
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs', pid: 'smt', platform: 'web', client: 'web',
    lang: 'en', currency: 'INR', offset: String(offset), page: '0',
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

function groupByName(rooms) {
  const m = new Map();
  for (const r of rooms) {
    const k = r.name.trim().toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function citySearchBody(city) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'TBOCITY',
    entityId: city.entityId,
    nationality: 'IN',
    nationalityLabel: 'Indian',
    entityLabel: city.entityLabel,
    requestId: '',
    pid: 'smt',
    rt: 'compact',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    fq: { df_long_star_rating: [] },
  };
}

function hotelDetailsBody(city, entityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'HOTEL',
    entityId,
    nationality: 'IN',
    nationalityLabel: 'Indian',
    entityLabel: city.entityLabel,
    requestId: '',
    pid: 'smt',
    rt: 'detailed',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

async function findBloom(blr) {
  for (let page = 0; page < 20; page += 1) {
    const s = await post(citySearchBody(blr), 'bloom hsr', page * 5);
    for (const h of s.data.content || []) {
      const t = String(h.title || '');
      if (/bloom.*hsr/i.test(t)) return { title: t, entityId: h.entityId || h.id };
    }
    if (!(s.data.content || []).length) break;
    await sleep(200);
  }
  for (let page = 0; page < 15; page += 1) {
    const s = await post(citySearchBody(blr), 'bangalore', page * 5);
    for (const h of s.data.content || []) {
      if (/bloom.*hsr/i.test(String(h.title || ''))) {
        return { title: h.title, entityId: h.entityId || h.id };
      }
    }
    if (!(s.data.content || []).length) break;
    await sleep(200);
  }
  return null;
}

async function main() {
  if (!BEARER) throw new Error('SHOP_BEARER required');
  const blr = CITIES.find((c) => c.key === 'Bengaluru');

  console.log('=== Bloom Hotel - Hsr Layout Sec 6 ===');
  console.log('Rule: same room title + multiple rate plans = EXPECTED');
  console.log('BUG only: MealType=No Meal + Inclusion has Breakfast');

  const bloom = await findBloom(blr);
  console.log('found', bloom);
  const bloomRows = [];
  if (bloom) {
    const d = await post(hotelDetailsBody(blr, bloom.entityId), 'bangalore', 0);
    const rooms = roomsOf(d.data);
    const byName = groupByName(rooms);
    console.log(`rates=${rooms.length} uniqueRoomTitles=${byName.size}`);
    for (const [name, rates] of byName) {
      console.log(`  "${name}" → ${rates.length} rate plan(s)`, rates.map((r) => ({
        meal: r.mealType, total: r.total, inclHasBF: hasBF(r.inclusion),
      })));
    }
    for (const r of rooms) {
      const sc = score(r);
      bloomRows.push({ hotel: bloom.title, entityId: bloom.entityId, ...r, ...sc });
      console.log(`  [${sc.verdict}] ${r.name} | meal=${r.mealType} | ₹${r.total} | ${sc.note}`);
    }
  }

  const cityRows = [];
  for (const city of CITIES) {
    console.log(`\n=== ${city.key} ===`);
    const hotels = [];
    for (let page = 0; page < 8 && hotels.length < 5; page += 1) {
      const s = await post(citySearchBody(city), city.q, page * 5);
      for (const h of s.data.content || []) {
        const id = h.entityId || h.id;
        if (!id || hotels.some((x) => x.entityId === id)) continue;
        hotels.push({ title: h.title, entityId: id });
        if (hotels.length >= 5) break;
      }
      if (!(s.data.content || []).length) break;
      await sleep(200);
    }

    for (const h of hotels) {
      await sleep(200);
      const d = await post(hotelDetailsBody(city, h.entityId), city.q, 0);
      const rooms = roomsOf(d.data);
      const byName = groupByName(rooms);
      const multiRateTitles = [...byName.entries()]
        .filter(([, arr]) => arr.length > 1)
        .map(([n, arr]) => ({ title: n, rates: arr.length }));
      const mismatches = rooms.filter((r) => isNoMeal(r.mealType) && hasBF(r.inclusion));
      const row = {
        city: city.key,
        hotel: h.title,
        entityId: h.entityId,
        totalRates: rooms.length,
        uniqueRoomTitles: byName.size,
        multiRateSameTitle: multiRateTitles,
        mismatchCount: mismatches.length,
        mismatches: mismatches.map((r) => ({
          name: r.name,
          mealType: r.mealType,
          inclusion: r.inclusion.slice(0, 140),
          total: r.total,
        })),
        verdict: mismatches.length ? 'BUG' : 'PASS',
        note: mismatches.length
          ? `MealType No Meal + Inclusion Breakfast on ${mismatches.length} rate(s)`
          : (multiRateTitles.length
            ? 'OK — same title with multiple rate plans is expected'
            : 'OK'),
      };
      cityRows.push(row);
      console.log(
        `  [${row.verdict}] ${String(h.title).slice(0, 45)} | rates=${rooms.length} uniqueTitles=${byName.size} multiRateTitles=${multiRateTitles.length} mismatches=${mismatches.length}`,
      );
    }
  }

  const out = {
    ranAt: new Date().toISOString(),
    clarification: 'Same room title with multiple rate plans (RO vs BF vs max occupancy) is EXPECTED. BUG only = MealType No Meal + Inclusion Breakfast.',
    bloom: {
      hotel: bloom,
      rows: bloomRows,
      bugCount: bloomRows.filter((r) => r.verdict === 'BUG').length,
      passCount: bloomRows.filter((r) => r.verdict === 'PASS').length,
      uniqueTitles: bloom ? groupByName(bloomRows).size : 0,
      totalRates: bloomRows.length,
    },
    cities: cityRows,
    counts: {
      cityHotelsPASS: cityRows.filter((r) => r.verdict === 'PASS').length,
      cityHotelsBUG: cityRows.filter((r) => r.verdict === 'BUG').length,
      bloomRateBUG: bloomRows.filter((r) => r.verdict === 'BUG').length,
      bloomRatePASS: bloomRows.filter((r) => r.verdict === 'PASS').length,
    },
  };

  fs.mkdirSync('reports', { recursive: true });
  const outPath = path.join('reports', 'mealtype-recheck-bloom-preprod.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\nCOUNTS', JSON.stringify(out.counts, null, 2));
  console.log('Report', outPath);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
