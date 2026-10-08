/**
 * Prod web RateHawk (RHK) hotel samples: city search + 5/4/3★ detail + room details
 * Mumbai / Dubai / Delhi (entityIds from shop autocomplete / RHK curl).
 *
 *   $env:SHOP_BEARER='...'; node scripts/fetch-prod-rhk-city-hotel-samples.js
 */
import fs from 'fs';
import path from 'path';

const RESULTS = 'https://api.travelvip.ai/api/hotelbooking/getHotelResults';
const ROOM = 'https://api.travelvip.ai/api/hotelbooking/getRoomDetails';
const BEARER = (process.env.SHOP_BEARER || '').trim().replace(/0V2$/, '');
const CHECKIN = process.env.CHECKIN || '2026-09-29';
const CHECKOUT = process.env.CHECKOUT || '2026-09-30';
const OUT_DIR = 'reports/hotel-prod-rhk-city-samples';

// RateHawk / worldota-style city entityIds (from /api/hotelbooking/search + user Delhi curl)
const CITIES = [
  { key: 'Mumbai', q: 'mumbai', entityId: '133024', entityLabel: 'Mumbai , India' },
  { key: 'Dubai', q: 'dubai', entityId: '32', entityLabel: 'Dubai , United Arab Emirates' },
  { key: 'Delhi', q: 'delhi', entityId: '131679', entityLabel: 'Delhi , India' },
];
const STARS = ['5', '4', '3'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function qsBase(extra = {}) {
  return new URLSearchParams({
    key: 'palsgcvgscvvs',
    pid: 'smt',
    platform: 'web',
    client: 'web',
    lang: 'en',
    currency: 'INR',
    page: '0',
    offset: '0',
    ...extra,
  });
}

async function postResults(body, q) {
  const qs = qsBase({ q: q || '' });
  const res = await fetch(`${RESULTS}?${qs}`, {
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

async function getRoomDetails({ bookingCode, requestId, q }) {
  const qs = qsBase({ q: q || '' });
  qs.set('bookingCode', bookingCode);
  qs.set('requestId', requestId);
  const res = await fetch(`${ROOM}?${qs}`, {
    method: 'GET',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
      origin: 'https://shop.travelvip.ai',
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function listing(data) {
  const list = data?.content || data?.results || [];
  return Array.isArray(list) ? list : [];
}

function starOf(h) {
  const rd = h?.data?.roomDetail || {};
  const hd = rd.HotelDetails || {};
  const s = hd.Rating || hd.StarRating || h.starRating || h.rating || null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function entityOf(h) {
  return String(h.entityId || h.id || '');
}

function nameOf(h) {
  const rd = h?.data?.roomDetail || {};
  const hd = rd.HotelDetails || {};
  return String(h.title || hd.HotelName || h.name || '');
}

function requestIdOf(data) {
  return data?.requestId
    || data?.content?.[0]?.requestId
    || data?.content?.[0]?.data?.requestId
    || data?._meta?.requestId
    || '';
}

function bookingCodesFromDetail(detailData) {
  const codes = [];
  const c0 = (detailData?.content || [])[0];
  const rooms = c0?.data?.roomDetail?.Rooms || detailData?.data?.roomDetail?.Rooms || [];
  const info = detailData?.roomsInfo || [];
  for (const r of rooms) {
    const c = r?.BookingCode || r?.bookingCode;
    if (c) codes.push(String(c));
  }
  for (const r of info) {
    const c = r?.BookingCode || r?.bookingCode;
    if (c) codes.push(String(c));
  }
  if (c0?.bookingCode) codes.push(String(c0.bookingCode));
  return [...new Set(codes)];
}

function pickRhkCode(codes) {
  return codes.find((c) => /!TB!RHK!TB!/i.test(c)) || codes[0] || null;
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log('wrote', file);
}

async function citySearch(city, stars = ['3', '4', '5']) {
  const body = {
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
    fq: { df_long_star_rating: stars },
  };
  return postResults(body, city.q);
}

async function citySearchStar(city, star) {
  return citySearch(city, [String(star)]);
}

async function hotelDetailed(city, entityId, requestId, entityLabel) {
  const body = {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'HOTEL',
    entityId,
    nationality: 'IN',
    nationalityLabel: 'Indian',
    entityLabel: entityLabel || city.entityLabel,
    requestId: requestId || '',
    pid: 'smt',
    rt: 'detailed',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
  return postResults(body, city.q);
}

async function main() {
  if (!BEARER) {
    console.error('Set SHOP_BEARER');
    process.exit(1);
  }
  console.log('RHK dates', CHECKIN, CHECKOUT, 'out', OUT_DIR);
  const index = {
    ranAt: new Date().toISOString(),
    vendor: 'RHK / RateHawk',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    cities: {},
  };

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} RHK city search entityId=${city.entityId} ===`);
    const search = await citySearch(city);
    const searchFile = path.join(OUT_DIR, city.key.toLowerCase(), '01-city-search.json');
    writeJson(searchFile, {
      http: search.status,
      vendor: 'RHK',
      request: { city, checkin: CHECKIN, checkout: CHECKOUT },
      response: search.data,
    });
    const rid = requestIdOf(search.data);
    const hotels = listing(search.data);
    console.log('  http', search.status, 'hotels', hotels.length, 'requestId', rid || '(none)');

    index.cities[city.key] = {
      entityId: city.entityId,
      searchHttp: search.status,
      hotelCount: hotels.length,
      requestId: rid,
      searchFile,
      samples: [],
    };

    for (const star of STARS) {
      console.log(`  --- ${star}★ ---`);
      let pick = hotels.find((h) => starOf(h) === Number(star));
      let starSearch = null;
      if (!pick) {
        starSearch = await citySearchStar(city, star);
        await sleep(400);
        const starList = listing(starSearch.data);
        pick = starList.find((h) => starOf(h) === Number(star)) || starList[0] || null;
        writeJson(
          path.join(OUT_DIR, city.key.toLowerCase(), `01b-city-search-${star}star.json`),
          { http: starSearch.status, response: starSearch.data },
        );
      }
      if (!pick) {
        console.log('    no hotel found');
        index.cities[city.key].samples.push({ star, status: 'NOT FOUND' });
        continue;
      }

      const entityId = entityOf(pick);
      const name = nameOf(pick);
      const useRid = requestIdOf(starSearch?.data) || rid;
      console.log('    pick', name, entityId, 'star', starOf(pick));

      const detail = await hotelDetailed(city, entityId, useRid, name);
      await sleep(500);
      const detailFile = path.join(OUT_DIR, city.key.toLowerCase(), `02-hotel-detail-${star}star.json`);
      writeJson(detailFile, {
        http: detail.status,
        vendor: 'RHK',
        hotel: { name, entityId, star: starOf(pick) || Number(star) },
        requestId: useRid,
        response: detail.data,
      });

      const codes = bookingCodesFromDetail(detail.data);
      const bookingCode = pickRhkCode(codes);
      const detailRid = requestIdOf(detail.data) || useRid;
      let roomFile = null;
      let roomHttp = null;
      let isRhk = bookingCode ? /!TB!RHK!TB!/i.test(bookingCode) : false;

      if (!bookingCode) {
        console.log('    no bookingCode on detail; codes=', codes.length);
      } else {
        console.log('    bookingCode vendor', isRhk ? 'RHK' : 'OTHER', bookingCode.slice(0, 60));
        const room = await getRoomDetails({ bookingCode, requestId: detailRid, q: city.q });
        await sleep(400);
        roomHttp = room.status;
        roomFile = path.join(OUT_DIR, city.key.toLowerCase(), `03-room-details-${star}star.json`);
        writeJson(roomFile, {
          http: room.status,
          vendor: isRhk ? 'RHK' : 'UNKNOWN',
          hotel: { name, entityId, star: starOf(pick) || Number(star) },
          bookingCode,
          requestId: detailRid,
          response: room.data,
        });
        console.log('    room http', room.status);
      }

      index.cities[city.key].samples.push({
        star: Number(star),
        name,
        entityId,
        detailHttp: detail.status,
        roomHttp,
        detailFile,
        roomFile,
        hasBookingCode: Boolean(bookingCode),
        isRhk,
      });
    }
  }

  writeJson(path.join(OUT_DIR, 'index.json'), index);
  console.log('\n=== DONE ===');
  console.log(JSON.stringify(index, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
