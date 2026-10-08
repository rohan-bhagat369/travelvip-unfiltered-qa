/**
 * Prod: check checkInTime / checkOutTime on hotel details + prebook.
 * Search → details → prebook only. NEVER finalize / book.
 *
 *   5 popular cities × 10 hotels
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { extractRequestId } from '../src/helpers.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const PID = 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || futureDate(28);
const CHECKOUT = process.env.HOTEL_CHECKOUT || futureDate(29);
const PER_CITY = Number(process.env.PER_CITY || 10);

const MODE = String(process.env.HOTEL_CITIES || 'india').toLowerCase();
const CITIES_INDIA = [
  { key: 'Mumbai', q: 'mumbai', entityId: '357389:IN' },
  { key: 'Delhi', q: 'delhi', entityId: '227760:IN' },
  { key: 'Bengaluru', q: 'bangalore', entityId: null },
  { key: 'Hyderabad', q: 'hyderabad', entityId: null },
  { key: 'Pune', q: 'pune', entityId: '328605:IN' },
];
const CITIES_INTL = [
  { key: 'Dubai', q: 'dubai', entityId: null },
  { key: 'Singapore', q: 'singapore', entityId: null },
  { key: 'Bangkok', q: 'bangkok', entityId: null },
];
const CITIES_PUNE = [
  { key: 'Pune', q: 'pune', entityId: '328605:IN' },
];
const CITIES = MODE === 'intl' ? CITIES_INTL : MODE === 'pune' ? CITIES_PUNE : CITIES_INDIA;
const OUT_SLUG = MODE === 'intl'
  ? 'hotel-checkin-checkout-times-prod-intl'
  : MODE === 'pune'
    ? 'hotel-checkin-checkout-times-prod-pune'
    : 'hotel-checkin-checkout-times-prod';
const OUT_JSON = path.join('reports', `${OUT_SLUG}.json`);
const OUT_MD = path.join('reports', `${OUT_SLUG}.md`);

function isPresent(v) {
  if (v == null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

function collectTimes(node, acc = [], pathStr = '') {
  if (!node || typeof node !== 'object') return acc;
  const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
  for (const k of keys) {
    const v = node[k];
    const p = pathStr ? `${pathStr}.${k}` : String(k);
    const kn = String(k);
    if (/checkInTime|checkOutTime|checkinTime|checkoutTime/i.test(kn)) {
      acc.push({ path: p, key: kn, value: v, present: isPresent(v) });
    }
    if (v && typeof v === 'object') collectTimes(v, acc, p);
  }
  return acc;
}

function summarizeTimes(hits) {
  const inHits = hits.filter((h) => /checkin/i.test(h.key));
  const outHits = hits.filter((h) => /checkout/i.test(h.key));
  const presentIn = inHits.find((h) => h.present);
  const presentOut = outHits.find((h) => h.present);
  const anyIn = inHits[0] || null;
  const anyOut = outHits[0] || null;
  return {
    keysFound: [...new Set(hits.map((h) => h.key))],
    checkInTime: presentIn?.value ?? anyIn?.value ?? '(field missing)',
    checkOutTime: presentOut?.value ?? anyOut?.value ?? '(field missing)',
    checkInPresent: Boolean(presentIn),
    checkOutPresent: Boolean(presentOut),
    bothPresent: Boolean(presentIn && presentOut),
    hits: hits.slice(0, 12),
  };
}

function citySearchBody(entityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
}

function hotelSearchBody(entityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    type: 'HOTEL',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

async function resolveCity(hotel, city) {
  if (city.entityId) return city.entityId;
  const auto = await hotel.autocomplete(city.q, 0, 20);
  const content = Array.isArray(auto.data?.content) ? auto.data.content : [];
  const hit = content.find((x) => String(x.type || '').toUpperCase() === 'CITY')
    || content.find((x) => /CITY/i.test(String(x.title || x.name || '')))
    || content[0];
  return hit?.entityId ? String(hit.entityId) : null;
}

async function main() {
  console.log('=== Prod hotel checkIn/checkOut times (details + prebook, NO BOOK) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  const rows = [];
  const citySummaries = [];

  for (const city of CITIES) {
    const entityId = await resolveCity(hotel, city);
    console.log(`\n## ${city.key} entityId=${entityId}`);
    if (!entityId) {
      citySummaries.push({ city: city.key, entityId: null, hotelsTried: 0, note: 'CITY autocomplete miss' });
      continue;
    }

    const search = await hotel.search(citySearchBody(entityId), { pid: PID, page: 0, perpage: 20 });
    const hotels = (search.data?.results || [])
      .filter((h) => h?.id && h.available !== false)
      .slice(0, PER_CITY);

    console.log(`  city search http=${search.status} n=${hotels.length}`);

    for (const h of hotels) {
      const row = {
        city: city.key,
        cityEntityId: entityId,
        hotelId: String(h.id),
        hotelName: h.name || '',
        searchCheckInTime: h.checkInTime ?? h.checkinTime ?? null,
        searchCheckOutTime: h.checkOutTime ?? h.checkoutTime ?? null,
        detailsHttp: null,
        detailsOk: false,
        detailsCheckInTime: null,
        detailsCheckOutTime: null,
        detailsHotelLevel: null,
        detailsRoomLevel: null,
        detailsTimes: null,
        prebookHttp: null,
        prebookOk: false,
        prebookCheckInTime: null,
        prebookCheckOutTime: null,
        prebookTimes: null,
        note: '',
      };

      try {
        const det = await hotel.getDetails(hotelSearchBody(h.id));
        row.detailsHttp = det.status;
        row.detailsOk = Boolean(det.ok);
        const hotelObj = det.data?.results?.[0] || {};
        row.detailsHotelLevel = {
          checkInTime: hotelObj.checkInTime ?? hotelObj.checkinTime ?? null,
          checkOutTime: hotelObj.checkOutTime ?? hotelObj.checkoutTime ?? null,
        };
        const rooms = Array.isArray(hotelObj.rooms) ? hotelObj.rooms : [];
        const roomHits = rooms.flatMap((r, i) => {
          const hits = [];
          if ('checkInTime' in r || 'checkinTime' in r) {
            hits.push({ room: i, key: 'checkInTime', value: r.checkInTime ?? r.checkinTime ?? null });
          }
          if ('checkOutTime' in r || 'checkoutTime' in r) {
            hits.push({ room: i, key: 'checkOutTime', value: r.checkOutTime ?? r.checkoutTime ?? null });
          }
          return hits;
        });
        row.detailsRoomLevel = {
          rooms: rooms.length,
          timeFieldsOnRooms: roomHits.slice(0, 6),
        };
        const detSum = summarizeTimes(collectTimes(det.data));
        row.detailsTimes = detSum;
        row.detailsCheckInTime = detSum.checkInTime;
        row.detailsCheckOutTime = detSum.checkOutTime;

        const requestId = extractRequestId(det.data);
        const room = rooms.find((r) => r?.bookingCode && r.available !== false);
        if (!det.ok) {
          row.note = `details http=${det.status} code=${det.data?.error?.code || ''}`;
        } else if (!requestId || !room?.bookingCode) {
          row.note = !requestId ? 'details missing requestId' : 'no bookable room';
        } else {
          const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
          row.prebookHttp = pre.status;
          row.prebookOk = Boolean(pre.ok);
          const preSum = summarizeTimes(collectTimes(pre.data));
          row.prebookTimes = preSum;
          row.prebookCheckInTime = preSum.checkInTime;
          row.prebookCheckOutTime = preSum.checkOutTime;
          if (!pre.ok) {
            row.note = `prebook http=${pre.status} code=${pre.data?.error?.code || ''}`.slice(0, 180);
          }
        }
      } catch (e) {
        row.note = String(e?.message || e).slice(0, 200);
      }

      const dIn = row.detailsTimes?.checkInPresent ? 'Y' : 'N';
      const dOut = row.detailsTimes?.checkOutPresent ? 'Y' : 'N';
      const pIn = row.prebookTimes?.checkInPresent ? 'Y' : (row.prebookHttp == null ? '-' : 'N');
      const pOut = row.prebookTimes?.checkOutPresent ? 'Y' : (row.prebookHttp == null ? '-' : 'N');
      console.log(
        `  ${String(h.name || '').slice(0, 40).padEnd(40)} details in/out=${dIn}/${dOut}  prebook in/out=${pIn}/${pOut}  ${row.note}`,
      );
      rows.push(row);
    }

    const cityRows = rows.filter((r) => r.city === city.key);
    citySummaries.push({
      city: city.key,
      entityId,
      hotelsTried: cityRows.length,
      detailsBothPresent: cityRows.filter((r) => r.detailsTimes?.bothPresent).length,
      detailsNullOrMissing: cityRows.filter((r) => r.detailsOk && !r.detailsTimes?.bothPresent).length,
      prebookBothPresent: cityRows.filter((r) => r.prebookTimes?.bothPresent).length,
      prebookNullOrMissing: cityRows.filter((r) => r.prebookOk && !r.prebookTimes?.bothPresent).length,
      prebookFailed: cityRows.filter((r) => r.prebookHttp != null && !r.prebookOk).length,
    });
  }

  const detailsOk = rows.filter((r) => r.detailsOk);
  const prebookOk = rows.filter((r) => r.prebookOk);
  const summary = {
    noBook: true,
    base: process.env.BASE_URL,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    hotels: rows.length,
    detailsOk: detailsOk.length,
    detailsBothTimesPresent: detailsOk.filter((r) => r.detailsTimes?.bothPresent).length,
    detailsTimesNullOrEmpty: detailsOk.filter((r) => !r.detailsTimes?.bothPresent).length,
    prebookOk: prebookOk.length,
    prebookBothTimesPresent: prebookOk.filter((r) => r.prebookTimes?.bothPresent).length,
    prebookTimesNullOrEmpty: prebookOk.filter((r) => !r.prebookTimes?.bothPresent).length,
    citySummaries,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));

  const md = [];
  md.push(MODE === 'intl'
    ? '# Prod hotel check-in / check-out times — international cities'
    : '# Prod hotel check-in / check-out times (details + prebook)');
  md.push('');
  md.push(`- Base: \`${process.env.BASE_URL}\``);
  md.push(`- Cities: **${MODE === 'intl' ? 'international (Dubai, Singapore, Bangkok)' : 'India'}**`);
  md.push(`- Stay: **${CHECKIN} → ${CHECKOUT}** (1 night)`);
  md.push('- Flow: CITY search → HOTEL details → prebook. **No book / no finalize.**');
  md.push(`- Hotels checked: **${summary.hotels}**`);
  md.push('');
  md.push('## Score');
  md.push('');
  md.push('| API | Calls OK | Both times present | Times null / empty / missing |');
  md.push('|-----|----------|--------------------|------------------------------|');
  md.push(`| Details | ${summary.detailsOk} | **${summary.detailsBothTimesPresent}** | **${summary.detailsTimesNullOrEmpty}** |`);
  md.push(`| Prebook | ${summary.prebookOk} | **${summary.prebookBothTimesPresent}** | **${summary.prebookTimesNullOrEmpty}** |`);
  md.push('');
  md.push('## Per city');
  md.push('');
  md.push('| City | Hotels | Details both times | Details null | Prebook both times | Prebook null | Prebook fail |');
  md.push('|------|--------|--------------------|--------------|--------------------|--------------|--------------|');
  for (const c of citySummaries) {
    md.push(
      `| ${c.city} | ${c.hotelsTried} | ${c.detailsBothPresent} | ${c.detailsNullOrMissing} | ${c.prebookBothPresent} | ${c.prebookNullOrMissing} | ${c.prebookFailed} |`,
    );
  }
  md.push('');
  md.push('## Hotels');
  md.push('');
  md.push('| # | City | Hotel | Details checkInTime | Details checkOutTime | Prebook checkInTime | Prebook checkOutTime | Note |');
  md.push('|---|------|-------|---------------------|----------------------|---------------------|----------------------|------|');
  rows.forEach((r, i) => {
    const cell = (v) => {
      if (v == null) return '`null`';
      if (v === '(field missing)') return '_missing_';
      return String(v);
    };
    md.push(
      `| ${i + 1} | ${r.city} | ${String(r.hotelName).replace(/\|/g, '/')} | ${cell(r.detailsCheckInTime)} | ${cell(r.detailsCheckOutTime)} | ${cell(r.prebookCheckInTime)} | ${cell(r.prebookCheckOutTime)} | ${String(r.note || '').replace(/\|/g, '/')} |`,
    );
  });
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Wrote', OUT_MD, OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
