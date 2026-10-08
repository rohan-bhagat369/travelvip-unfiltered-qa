/**
 * READ-ONLY: Pune city hotel scan — lowest prices + cheapest cancellable rooms.
 * No prebook / finalize / cancel.
 *
 * Flow:
 *  1) autocomplete "Pune" → CITY entity
 *  2) city search (sorted by price)
 *  3) rank cheapest overall + cheapest refundable/free-cancel
 *  4) for top cancellable hotels, pull details cancelPolicies when rooms are available
 *
 *   BASE_URL=https://api.travelvip.ai node scripts/probe-hotel-cancel-policies.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const Q = { lang: 'en', currency: 'INR' };

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePolicyDate(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
}

function applicablePolicy(room, now = new Date()) {
  const policies = [...(room?.cancelPolicies || [])].sort((a, b) => {
    const da = parsePolicyDate(a.fromDate)?.getTime() ?? 0;
    const db = parsePolicyDate(b.fromDate)?.getTime() ?? 0;
    return db - da;
  });
  return (
    policies.find((p) => {
      const from = parsePolicyDate(p.fromDate);
      return from && from <= now;
    })
    || policies[policies.length - 1]
    || null
  );
}

function applicableCharge(room) {
  const active = applicablePolicy(room);
  if (active) {
    const c = Number(active.cancellationCharge);
    return Number.isFinite(c) ? c : null;
  }
  if (room?.refundable === false) return 100;
  if (room?.refundable === true) return 0;
  return null;
}

function isCancellableFromSearch(hotel) {
  if (hotel?.refundable === true) return true;
  const notes = (hotel?.refundableNotes || []).join(' ').toLowerCase();
  return /free\s*cancel|fully\s*refund|refundable/.test(notes) && !/non.?refund/.test(notes);
}

function pickPuneCity(content = []) {
  const exact = content.find(
    (x) => /CITY/i.test(String(x.type || '')) && /^pune$/i.test(String(x.title || '').trim()) && /india/i.test(String(x.country || '')),
  );
  if (exact) return exact;
  return content.find((x) => /CITY/i.test(String(x.type || '')) && /pune/i.test(x.title || '')) || null;
}

function hotelPrice(h) {
  return money(h?.price?.totalAmount ?? h?.minPrice ?? h?.startingPrice);
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  console.log('Mode: READ-ONLY Pune cheapest + cheapest cancellable (no booking)');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);
  const client = session.client;

  const ac = await hotel.autocomplete('Pune');
  if (!ac.ok) throw new Error(`autocomplete failed: ${JSON.stringify(ac.data).slice(0, 300)}`);
  const city = pickPuneCity(ac.data?.content || []);
  if (!city?.entityId) throw new Error('Pune CITY entity not found in autocomplete');
  console.log('Pune city entity', city.entityId, city.title, city.type);

  const dayCandidates = (process.env.HOTEL_CHECKIN_CANDIDATES || '21,30,45,60')
    .split(',')
    .map(Number);
  const nights = Number(process.env.HOTEL_NIGHTS || 2);
  const roomsOcc = [{ adults: 1, children: 0, childrenAges: [] }];

  const report = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    city: { entityId: city.entityId, title: city.title, type: city.type },
    note: 'READ-ONLY: city search + selective hotel details. No prebook/finalize.',
    dates: [],
  };

  for (const days of dayCandidates) {
    const checkin = futureDate(days);
    const checkout = futureDate(days + nights);
    console.log(`\n=== Pune +${days}d ${checkin} -> ${checkout} ===`);

    const searchBody = {
      checkin,
      checkout,
      entityId: String(city.entityId),
      nationality: config.hotel.nationality || 'IN',
      type: 'CITY',
      rooms: roomsOcc,
    };

    const search = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...Q, page: 0, perpage: 50, sortby: 'price,asc' },
      body: searchBody,
      correlation: true,
      partnerKey: session.accessToken,
    });

    if (!search.ok) {
      console.log('city search fail', search.status, JSON.stringify(search.data).slice(0, 200));
      report.dates.push({ days, checkin, checkout, error: `search ${search.status}` });
      continue;
    }

    const results = [...(search.data?.results || [])]
      .filter((h) => h?.available !== false)
      .sort((a, b) => (hotelPrice(a) ?? 1e12) - (hotelPrice(b) ?? 1e12));

    const cheapestOverall = results.slice(0, 10).map((h) => ({
      id: h.id,
      name: h.name,
      starRating: h.starRating,
      totalAmount: hotelPrice(h),
      currency: h.price?.currency || 'INR',
      refundable: h.refundable,
      refundableNotes: h.refundableNotes || [],
      cancellable: isCancellableFromSearch(h),
    }));

    const cancellable = results
      .filter(isCancellableFromSearch)
      .sort((a, b) => (hotelPrice(a) ?? 1e12) - (hotelPrice(b) ?? 1e12));

    const cheapestCancellable = cancellable.slice(0, 10).map((h) => ({
      id: h.id,
      name: h.name,
      starRating: h.starRating,
      totalAmount: hotelPrice(h),
      currency: h.price?.currency || 'INR',
      refundable: h.refundable,
      refundableNotes: h.refundableNotes || [],
    }));

    console.log('hotels', results.length, 'cancellable', cancellable.length);
    console.log('cheapest overall:', cheapestOverall[0]?.name, cheapestOverall[0]?.totalAmount);
    console.log('cheapest cancellable:', cheapestCancellable[0]?.name, cheapestCancellable[0]?.totalAmount, cheapestCancellable[0]?.refundableNotes);

    // Pull room-level cancelPolicies for top cancellable hotels (when details has rooms)
    const policyDetails = [];
    for (const h of cancellable.slice(0, 8)) {
      const hotelSearchBody = {
        checkin,
        checkout,
        entityId: String(h.id),
        nationality: config.hotel.nationality || 'IN',
        type: 'HOTEL',
        rooms: roomsOcc,
      };
      await client.request({
        method: 'POST',
        path: '/v1/hotels/search',
        query: { ...Q, page: 0, perpage: 20 },
        body: hotelSearchBody,
        correlation: true,
        partnerKey: session.accessToken,
      });
      const details = await hotel.getDetails({
        checkin,
        checkout,
        entityId: String(h.id),
        nationality: config.hotel.nationality || 'IN',
        rooms: roomsOcc,
      });
      const hotelResult = details.data?.results?.[0];
      const roomList = Array.isArray(hotelResult?.rooms) ? hotelResult.rooms : [];
      const roomPolicies = roomList
        .filter((r) => r.available !== false)
        .map((r) => {
          const active = applicablePolicy(r);
          const charge = applicableCharge(r);
          return {
            roomName: r.name || r.roomType,
            mealType: r.mealType,
            totalAmount: money(r.price?.totalAmount),
            currency: r.price?.currency || 'INR',
            refundable: r.refundable,
            refundableNotes: r.refundableNotes,
            applicableChargeNow: charge,
            freeCancelNow: charge === 0,
            activePolicy: active,
            cancelPolicies: r.cancelPolicies || [],
          };
        })
        .sort((a, b) => (a.totalAmount ?? 1e12) - (b.totalAmount ?? 1e12));

      const freeNow = roomPolicies.filter((r) => r.freeCancelNow);
      const entry = {
        hotelId: h.id,
        hotelName: h.name || hotelResult?.name,
        searchAmount: hotelPrice(h),
        searchRefundableNotes: h.refundableNotes || [],
        detailsHttp: details.status,
        roomCount: roomList.length,
        cheapestRoom: roomPolicies[0] || null,
        freeCancelRooms: freeNow,
        cheapestFreeCancelRoom: freeNow[0] || null,
        rooms: roomPolicies.slice(0, 8),
      };
      policyDetails.push(entry);
      console.log(
        ' details',
        entry.hotelName,
        'rooms',
        entry.roomCount,
        'free0%',
        freeNow.length,
        freeNow[0] ? `cheapestFree=${freeNow[0].totalAmount}` : '',
      );
    }

    const freeAcrossHotels = policyDetails
      .flatMap((p) =>
        (p.freeCancelRooms || []).map((r) => ({
          hotelId: p.hotelId,
          hotelName: p.hotelName,
          ...r,
        })),
      )
      .sort((a, b) => (a.totalAmount ?? 1e12) - (b.totalAmount ?? 1e12));

    report.dates.push({
      days,
      checkin,
      checkout,
      nights,
      cityResultCount: results.length,
      cancellableCount: cancellable.length,
      cheapestOverall,
      cheapestCancellable,
      policyDetails,
      cheapestFullyRefundableRoomNow: freeAcrossHotels[0] || null,
      fullyRefundableRoomsSorted: freeAcrossHotels.slice(0, 15),
    });
  }

  fs.mkdirSync('reports/hotel', { recursive: true });
  const outPath = path.join('reports/hotel', 'pune-cheapest-cancellable.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n========== SUMMARY ==========');
  for (const d of report.dates) {
    if (d.error) {
      console.log(d.checkin, 'ERROR', d.error);
      continue;
    }
    console.log(
      d.checkin,
      '| cheapest overall:',
      d.cheapestOverall?.[0]?.name,
      d.cheapestOverall?.[0]?.totalAmount,
      '| cheapest cancellable:',
      d.cheapestCancellable?.[0]?.name,
      d.cheapestCancellable?.[0]?.totalAmount,
      '| cheapest 0% room:',
      d.cheapestFullyRefundableRoomNow
        ? `${d.cheapestFullyRefundableRoomNow.hotelName} / ${d.cheapestFullyRefundableRoomNow.roomName} @ ${d.cheapestFullyRefundableRoomNow.totalAmount}`
        : '(details rooms unavailable — use search-level free-cancel notes)',
    );
  }
  console.log('\nReport:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
