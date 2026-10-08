/**
 * Preprod meal-type fix verification.
 * Looks for MealType=No Meal while Inclusion contains Breakfast (old bug),
 * plus boardBasis type=Other + description Breakfast if present.
 *
 *   $env:SHOP_BEARER='...'; node scripts/probe-mealtype-breakfast-mismatch-preprod.js
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.SHOP_BASE || 'https://preprod-next-api.travelvip.ai';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const CHECKIN = process.env.CHECKIN || '2026-09-23';
const CHECKOUT = process.env.CHECKOUT || '2026-09-24';
const PER_CITY = Number(process.env.PER_CITY || 5);
const SLEEP_MS = Number(process.env.SLEEP_MS || 250);

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN', entityLabel: 'Mumbai , India', q: 'mumbai' },
  { key: 'Delhi', entityId: '227760:IN', entityLabel: 'New Delhi , India', q: 'delhi' },
  { key: 'Bengaluru', entityId: '341153:IN', entityLabel: 'Bengaluru , India', q: 'bangalore' },
  { key: 'Hyderabad', entityId: '227706:IN', entityLabel: 'Hyderabad , India', q: 'hyderabad' },
  { key: 'Chennai', entityId: '228269:IN', entityLabel: 'Chennai , India', q: 'chennai' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasBreakfastText(s) {
  return /breakfast|\bbb\b|\bcp\b/i.test(String(s || ''));
}

function isNoMeal(s) {
  return /^no\s*meal$/i.test(String(s || '').trim()) || String(s || '').trim() === '';
}

async function postResults(body, { q = '', offset = 0 } = {}) {
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
  const url = `${BASE}/api/hotelbooking/getHotelResults?${qs}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function listingHotels(data) {
  return Array.isArray(data?.content) ? data.content : [];
}

function extractRooms(detailsData) {
  const content0 = (detailsData?.content || [])[0];
  const rd = content0?.data?.roomDetail || {};
  const rooms = rd.Rooms || rd.rooms || [];
  const info = detailsData?.roomsInfo || [];
  const out = [];
  for (let i = 0; i < rooms.length; i += 1) {
    const r = rooms[i];
    const inf = info[i] || {};
    const nameRaw = inf.Title || inf.roomType || r.RoomType || r.Name || r.name;
    const name = Array.isArray(nameRaw) ? nameRaw.filter(Boolean).join(' / ') : String(nameRaw || 'Room');
    const mealType = inf.MealType || r.MealType || r.mealType || '';
    const inclusion = inf.Inclusion || r.Inclusion || r.inclusion || '';
    const inclusionStr = Array.isArray(inclusion) ? inclusion.join(' | ') : String(inclusion || '');
    const board = r.boardBasis || r.BoardBasis || inf.boardBasis || null;
    out.push({
      name,
      mealType,
      inclusion: inclusionStr,
      boardBasis: board,
      bookingCode: r.BookingCode || inf.BookingCode || null,
    });
  }
  return out;
}

function scoreRoom(room) {
  const meal = String(room.mealType || '');
  const incl = String(room.inclusion || '');
  const boardType = room.boardBasis?.type || room.boardBasis?.Type || null;
  const boardDesc = room.boardBasis?.description || room.boardBasis?.Description || null;

  const mismatch = isNoMeal(meal) && hasBreakfastText(incl);
  const otherBreakfast = /other/i.test(String(boardType || '')) && hasBreakfastText(boardDesc);
  const fixedLike = hasBreakfastText(meal) && hasBreakfastText(incl);
  const cleanNoMeal = isNoMeal(meal) && !hasBreakfastText(incl);

  let verdict = 'OK';
  let note = '';
  if (mismatch) {
    verdict = 'BUG';
    note = 'MealType=No Meal but Inclusion has Breakfast (old bug still present)';
  } else if (otherBreakfast && isNoMeal(meal)) {
    verdict = 'BUG';
    note = 'boardBasis.type=Other + description Breakfast but MealType still No Meal';
  } else if (otherBreakfast && hasBreakfastText(meal)) {
    verdict = 'PASS';
    note = 'Other+Breakfast description correctly mapped to breakfast MealType';
  } else if (fixedLike) {
    verdict = 'PASS';
    note = 'MealType and Inclusion both indicate breakfast';
  } else if (cleanNoMeal) {
    verdict = 'PASS';
    note = 'Consistent No Meal (no breakfast in inclusion)';
  } else {
    verdict = 'PASS';
    note = `meal=${meal || '(empty)'}; inclusion has breakfast=${hasBreakfastText(incl)}`;
  }
  return { verdict, note, boardType, boardDesc, mismatch, otherBreakfast };
}

async function huntSundeepInn() {
  console.log('\n=== HUNT: Sundeep Inn (Delhi) ===');
  const city = CITIES.find((c) => c.key === 'Delhi');
  const hits = [];
  for (let page = 0; page < 15; page += 1) {
    const offset = page * 5;
    const res = await postResults({
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
    }, { q: city.q, offset });
    if (!res.ok) {
      console.log('  search http', res.status);
      break;
    }
    const list = listingHotels(res.data);
    for (const h of list) {
      const title = String(h.title || h.name || '');
      if (/sundeep\s*inn/i.test(title)) {
        hits.push({
          title,
          entityId: h.entityId || h.id,
          requestId: res.data?.requestId || null,
        });
      }
    }
    if (res.data?.last || list.length === 0) break;
    await sleep(SLEEP_MS);
  }

  // also try direct autocomplete-style by searching with q=sundeep
  const qRes = await postResults({
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
  }, { q: 'sundeep', offset: 0 });
  for (const h of listingHotels(qRes.data)) {
    const title = String(h.title || '');
    if (/sundeep/i.test(title)) {
      hits.push({ title, entityId: h.entityId || h.id, requestId: qRes.data?.requestId || null });
    }
  }

  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    if (!h.entityId || seen.has(h.entityId)) continue;
    seen.add(h.entityId);
    uniq.push(h);
  }
  console.log(`  found ${uniq.length} Sundeep hit(s)`);

  const rows = [];
  for (const h of uniq) {
    const det = await postResults({
      checkin: CHECKIN,
      checkout: CHECKOUT,
      type: 'HOTEL',
      entityId: h.entityId,
      nationality: 'IN',
      nationalityLabel: 'Indian',
      entityLabel: city.entityLabel,
      requestId: h.requestId || '',
      pid: 'smt',
      rt: 'detailed',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    }, { q: 'delhi', offset: 0 });
    const rooms = extractRooms(det.data);
    for (const room of rooms) {
      const scored = scoreRoom(room);
      rows.push({
        city: 'Delhi',
        hotelName: h.title,
        hotelEntityId: h.entityId,
        focus: 'Sundeep Inn',
        ...room,
        ...scored,
      });
      console.log(`  [${scored.verdict}] ${h.title} | ${room.name} | meal=${room.mealType} | incl=${String(room.inclusion).slice(0, 80)} | board=${scored.boardType}/${scored.boardDesc}`);
    }
  }
  return rows;
}

async function sampleCity(city) {
  console.log(`\n=== ${city.key}: sample ${PER_CITY} hotels ===`);
  const hotels = [];
  for (let page = 0; page < 8 && hotels.length < PER_CITY * 2; page += 1) {
    const res = await postResults({
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
    }, { q: city.q, offset: page * 5 });
    if (res.status === 401 || res.status === 403) {
      return { rows: [], authFailed: true, status: res.status };
    }
    const list = listingHotels(res.data).map((h) => ({
      title: h.title || h.name,
      entityId: h.entityId || h.id,
      requestId: res.data?.requestId || null,
    })).filter((h) => h.entityId);
    hotels.push(...list);
    if (res.data?.last || list.length === 0) break;
    await sleep(SLEEP_MS);
  }

  const seen = new Set();
  const pick = [];
  for (const h of hotels) {
    if (seen.has(h.entityId)) continue;
    seen.add(h.entityId);
    pick.push(h);
    if (pick.length >= PER_CITY) break;
  }

  const rows = [];
  for (const h of pick) {
    await sleep(SLEEP_MS);
    const det = await postResults({
      checkin: CHECKIN,
      checkout: CHECKOUT,
      type: 'HOTEL',
      entityId: h.entityId,
      nationality: 'IN',
      nationalityLabel: 'Indian',
      entityLabel: city.entityLabel,
      requestId: h.requestId || '',
      pid: 'smt',
      rt: 'detailed',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    }, { q: city.q, offset: 0 });

    const rooms = extractRooms(det.data);
    if (!rooms.length) {
      console.log(`  [NOT_TESTED] ${h.title} — no rooms in details`);
      rows.push({
        city: city.key,
        hotelName: h.title,
        hotelEntityId: h.entityId,
        verdict: 'NOT_TESTED',
        note: 'no rooms in details',
      });
      continue;
    }

    // Prefer mismatch rooms if any; else score cheapest / first few
    const scoredRooms = rooms.map((r) => ({ room: r, scored: scoreRoom(r) }));
    const bugs = scoredRooms.filter((x) => x.scored.verdict === 'BUG');
    const sample = bugs.length ? bugs : scoredRooms.slice(0, Math.min(3, scoredRooms.length));

    for (const { room, scored } of sample) {
      rows.push({
        city: city.key,
        hotelName: h.title,
        hotelEntityId: h.entityId,
        ...room,
        ...scored,
      });
      console.log(`  [${scored.verdict}] ${String(h.title).slice(0, 40)} | ${String(room.name).slice(0, 30)} | meal=${room.mealType} | incl=${String(room.inclusion).slice(0, 60)}`);
    }
  }
  return { rows };
}

async function main() {
  if (!BEARER) {
    console.error('Set SHOP_BEARER');
    process.exit(1);
  }
  console.log(`BASE=${BASE}`);
  console.log(`Stay ${CHECKIN} → ${CHECKOUT}`);

  const all = [];
  const sundeep = await huntSundeepInn();
  all.push(...sundeep);

  for (const city of CITIES) {
    const { rows, authFailed, status } = await sampleCity(city);
    if (authFailed) {
      console.error('Auth failed', status);
      process.exit(1);
    }
    all.push(...rows);
  }

  const counts = {
    PASS: all.filter((r) => r.verdict === 'PASS').length,
    BUG: all.filter((r) => r.verdict === 'BUG').length,
    'NOT TESTED': all.filter((r) => r.verdict === 'NOT_TESTED').length,
    total: all.length,
  };
  const bugs = all.filter((r) => r.verdict === 'BUG');
  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    counts,
    bugs,
    rows: all,
  };
  fs.mkdirSync('reports', { recursive: true });
  const outPath = path.join('reports', 'mealtype-breakfast-mismatch-preprod.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n=== COUNTS ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`Bugs: ${bugs.length}`);
  console.log(`Report: ${outPath}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
