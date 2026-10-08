/**
 * Client hotel rates: city search (list) + hotel details (rooms/inclusions/rates).
 * Check-in 2026-09-25 → 26, 2 adults, breakfast rooms preferred.
 * ~30 hotels/city across 3/4/5★.
 *
 *   $env:SHOP_BEARER='...'; node scripts/extract-client-hotel-rates-prod.js
 */
import fs from 'fs';
import path from 'path';

const BASE = 'https://api.travelvip.ai/api/hotelbooking/getHotelResults';
const BEARER = (process.env.SHOP_BEARER || '').trim();
const CHECKIN = process.env.CHECKIN || '2026-09-25';
const CHECKOUT = process.env.CHECKOUT || '2026-09-26';
const ADULTS = Number(process.env.ADULTS || 2);
const PER_CITY = Number(process.env.PER_CITY || 30);
const PER_STAR = Number(process.env.PER_STAR || 10);
const PAGE_SIZE = 5; // prod listing returns 5/page
const SLEEP_MS = Number(process.env.SLEEP_MS || 200);

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN', entityLabel: 'Mumbai , India', q: 'mumbai' },
  { key: 'Delhi', entityId: '227760:IN', entityLabel: 'New Delhi , India', q: 'delhi' },
  { key: 'Bengaluru', entityId: '341153:IN', entityLabel: 'Bengaluru , India', q: 'bangalore' },
  { key: 'Hyderabad', entityId: '227706:IN', entityLabel: 'Hyderabad , India', q: 'hyderabad' },
  { key: 'Chennai', entityId: '228269:IN', entityLabel: 'Chennai , India', q: 'chennai' },
];
const STARS = ['5', '4', '3'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function postResults(body, { offset = 0, q = '' } = {}) {
  const qs = new URLSearchParams({
    key: 'palsgcvgscvvs',
    pid: 'smt',
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
    offset: String(offset),
  });
  if (q) qs.set('q', q);
  const res = await fetch(`${BASE}?${qs}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      origin: 'https://shop.travelvip.ai',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function listingHotels(data) {
  const list = data?.content || data?.results || [];
  return Array.isArray(list) ? list : [];
}

function hotelFromListing(h) {
  const rd = h?.data?.roomDetail || {};
  const hd = rd.HotelDetails || {};
  return {
    entityId: String(h.entityId || h.id || ''),
    name: String(h.title || hd.HotelName || h.name || ''),
    star: hd.Rating || hd.StarRating || h.starRating || null,
    address: h.address || hd.Address || '',
    city: hd.City || h.city || '',
    listingMeal: (rd.Rooms || [])[0]?.MealType || null,
    listingTotal: money((rd.Rooms || [])[0]?.TotalFare ?? (rd.Rooms || [])[0]?.priceDetail?.totalPrice),
  };
}

function isBreakfastMeal(meal) {
  const s = String(meal || '');
  return /breakfast|full\s*board|half\s*board|\bbb\b|\bcp\b|all\s*inclusive/i.test(s)
    && !/^no\s*meal$/i.test(s.trim());
}

function normalizeRooms(detailsData) {
  const content0 = (detailsData?.content || [])[0];
  const rd = content0?.data?.roomDetail || detailsData?.data?.roomDetail || {};
  const rooms = rd.Rooms || rd.rooms || [];
  const info = detailsData?.roomsInfo || [];
  const out = [];

  if (Array.isArray(rooms)) {
    for (let i = 0; i < rooms.length; i += 1) {
      const r = rooms[i];
      const inf = info[i] || {};
      const nameRaw = inf.Title || inf.roomType || r.RoomType || r.Name || r.name || r.title;
      const name = Array.isArray(nameRaw) ? nameRaw.filter(Boolean).join(' / ') : String(nameRaw || 'Room');
      const meal = inf.MealType || r.MealType || r.mealType || '';
      const inclusion = inf.Inclusion || r.Inclusion || r.inclusion || null;
      const pd = r.priceDetail || inf.priceDetail || {};
      out.push({
        name: name === 'No Meal' ? (r.RoomType || inf.roomType || name) : name,
        mealType: meal,
        inclusion: inclusion == null ? '' : (Array.isArray(inclusion) ? inclusion.join(' | ') : String(inclusion)),
        breakfast: isBreakfastMeal(meal) || isBreakfastMeal(inclusion),
        baseFare: money(r.BaseFare ?? r.BasePrice ?? pd.baseFare),
        tax: money(r.TotalTax ?? r.FinalTax ?? pd.tax),
        totalFare: money(r.TotalFare ?? r.FinalFare ?? pd.totalPrice ?? pd.payablePrice ?? inf.TotalFare),
        currency: r.Currency || pd.currency || 'INR',
        refundable: r.IsRefundable ?? r.refundable ?? null,
        freeCancel: r.isFreeCancellation ?? r.freeCancellable ?? inf.freeCancellable ?? null,
      });
    }
  }
  return out;
}

function hotelDetailsMeta(detailsData, fallback) {
  const content0 = (detailsData?.content || [])[0];
  const rd = content0?.data?.roomDetail || {};
  const hd = rd.HotelDetails || {};
  const map = detailsData?.hotelDetailMap || {};
  return {
    name: hd.HotelName || content0?.title || fallback.name,
    star: hd.Rating || hd.StarRating || map.starRating || fallback.star,
    address: hd.Address || content0?.address || fallback.address,
    city: hd.City || fallback.city,
  };
}

function pickBestBreakfastRoom(rooms) {
  const bf = rooms.filter((r) => r.breakfast && r.totalFare != null).sort((a, b) => a.totalFare - b.totalFare);
  if (bf.length) return bf[0];
  return null;
}

async function searchCityStar(city, star) {
  const hotels = [];
  let type = 'TBOCITY';
  for (let page = 0; page < 12 && hotels.length < PER_STAR * 3; page += 1) {
    const offset = page * PAGE_SIZE;
    const body = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      type,
      entityId: city.entityId,
      nationality: 'IN',
      nationalityLabel: 'Indian',
      entityLabel: city.entityLabel,
      requestId: '',
      pid: 'smt',
      rt: 'compact',
      rooms: [{ adults: ADULTS, children: 0, childrenAges: [] }],
      fq: { df_long_star_rating: [String(star)] },
    };
    let res = await postResults(body, { offset, q: city.q });
    if (page === 0 && listingHotels(res.data).length === 0) {
      type = 'CITY';
      res = await postResults({ ...body, type }, { offset, q: city.q });
    }
    if (res.status === 401 || res.status === 403) {
      return { hotels, authFailed: true, status: res.status };
    }
    const batch = listingHotels(res.data).map(hotelFromListing).filter((h) => h.entityId && h.name);
    hotels.push(...batch);
    if (res.data?.last === true || batch.length === 0) break;
    await sleep(SLEEP_MS);
  }
  const seen = new Set();
  return {
    hotels: hotels.filter((h) => {
      if (seen.has(h.entityId)) return false;
      seen.add(h.entityId);
      return true;
    }),
  };
}

async function fetchDetails(city, hotel) {
  const body = {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'HOTEL',
    entityId: hotel.entityId,
    nationality: 'IN',
    nationalityLabel: 'Indian',
    entityLabel: city.entityLabel,
    requestId: '',
    pid: 'smt',
    rt: 'detailed',
    rooms: [{ adults: ADULTS, children: 0, childrenAges: [] }],
  };
  return postResults(body, { offset: 0, q: city.q });
}

async function collectCity(city) {
  const rows = [];
  const seen = new Set();

  for (const star of STARS) {
    console.log(`  list ${city.key} ${star}★`);
    const { hotels, authFailed, status } = await searchCityStar(city, star);
    if (authFailed) return { rows, authFailed: true, status };
    console.log(`    listing=${hotels.length}`);

    let got = 0;
    for (const h of hotels) {
      if (got >= PER_STAR || rows.length >= PER_CITY) break;
      if (seen.has(h.entityId)) continue;

      await sleep(SLEEP_MS);
      const det = await fetchDetails(city, h);
      if (det.status === 401 || det.status === 403) {
        return { rows, authFailed: true, status: det.status };
      }

      const meta = hotelDetailsMeta(det.data, h);
      const rooms = normalizeRooms(det.data);
      const picked = pickBestBreakfastRoom(rooms);

      // Prefer breakfast; if none, still keep best room but flag breakfast=false (client asked breakfast)
      if (!picked) {
        const any = rooms.filter((r) => r.totalFare != null).sort((a, b) => a.totalFare - b.totalFare)[0];
        if (!any) {
          console.log(`    skip(no rooms) ${h.name.slice(0, 40)}`);
          continue;
        }
        // skip non-breakfast for client breakfast sheet
        console.log(`    skip(no BF) ${h.name.slice(0, 40)} meal=${any.mealType}`);
        continue;
      }

      seen.add(h.entityId);
      got += 1;
      rows.push({
        city: city.key,
        cityEntityId: city.entityId,
        hotelEntityId: h.entityId,
        hotelName: meta.name,
        star: meta.star || star,
        starFilter: star,
        address: meta.address,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        adults: ADULTS,
        roomName: picked.name,
        mealType: picked.mealType,
        inclusions: picked.inclusion || picked.mealType,
        breakfast: true,
        baseFare: picked.baseFare,
        tax: picked.tax,
        totalAmount: picked.totalFare,
        currency: picked.currency || 'INR',
        refundable: picked.refundable,
        freeCancel: picked.freeCancel,
        roomsInDetails: rooms.length,
        breakfastRoomsInDetails: rooms.filter((r) => r.breakfast).length,
        listingMeal: h.listingMeal,
        listingTotal: h.listingTotal,
        allBreakfastRooms: rooms.filter((r) => r.breakfast).map((r) => ({
          roomName: r.name,
          mealType: r.mealType,
          inclusions: r.inclusion,
          baseFare: r.baseFare,
          tax: r.tax,
          totalAmount: r.totalFare,
        })),
      });
      console.log(`    +${got}/${PER_STAR} (${star}★) ${meta.name.slice(0, 45)} | ${picked.mealType} | ₹${picked.totalFare}`);
    }
  }

  return { rows };
}

async function main() {
  if (!BEARER) {
    console.error('Set SHOP_BEARER');
    process.exit(1);
  }

  const all = [];
  const summary = [];

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} (${city.entityId}) ===`);
    const { rows, authFailed, status } = await collectCity(city);
    if (authFailed) {
      console.error(`Auth failed HTTP ${status}`);
      process.exit(1);
    }
    all.push(...rows);
    summary.push({
      city: city.key,
      hotels: rows.length,
      byStarFilter: {
        '5': rows.filter((r) => r.starFilter === '5').length,
        '4': rows.filter((r) => r.starFilter === '4').length,
        '3': rows.filter((r) => r.starFilter === '3').length,
      },
      withBreakfast: rows.filter((r) => r.breakfast).length,
    });
    console.log(`  done ${rows.length} hotels with breakfast`);
  }

  fs.mkdirSync('reports', { recursive: true });
  const outJson = path.join('reports', 'client-hotel-rates-sep25-2026.json');
  const outCsv = path.join('reports', 'client-hotel-rates-sep25-2026.csv');

  fs.writeFileSync(outJson, JSON.stringify({
    ranAt: new Date().toISOString(),
    source: 'prod getHotelResults: city compact list + hotel detailed rooms',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    adults: ADULTS,
    currency: 'INR',
    note: 'Base breakfast room = cheapest details room with Breakfast/Half Board/Full Board meal',
    summary,
    hotels: all,
  }, null, 2));

  const headers = [
    'City', 'Hotel Name', 'Star', 'Hotel EntityId', 'Check-in', 'Check-out', 'Adults',
    'Room Name', 'Meal Type', 'Inclusions', 'Breakfast',
    'Base Fare', 'Tax', 'Total Amount', 'Currency',
    'Refundable', 'Free Cancel', 'Rooms In Details', 'Breakfast Rooms Count',
  ];
  const lines = [headers.join(',')];
  for (const r of all) {
    lines.push([
      r.city, r.hotelName, r.star, r.hotelEntityId, r.checkin, r.checkout, r.adults,
      r.roomName, r.mealType, r.inclusions, r.breakfast ? 'Yes' : 'No',
      r.baseFare ?? '', r.tax ?? '', r.totalAmount ?? '', r.currency,
      r.refundable ?? '', r.freeCancel ?? '', r.roomsInDetails, r.breakfastRoomsInDetails,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(outCsv, lines.join('\n'));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`JSON: ${outJson}`);
  console.log(`CSV:  ${outCsv}`);
  console.log(`Total: ${all.length}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
