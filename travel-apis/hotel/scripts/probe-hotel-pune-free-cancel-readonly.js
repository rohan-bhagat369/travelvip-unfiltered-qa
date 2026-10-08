/**
 * READ-ONLY: Pune cheapest fully-refundable (0% cancel charge now) hotel on preprod.
 * NO prebook / finalize / cancel.
 *
 *   BASE_URL=https://api-preprod.travelvip.ai PARTNER_ID=smt TIER_ID=8 node scripts/probe-hotel-pune-free-cancel-readonly.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-pune-free-cancel-preprod-readonly.json');
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
    (x) => /CITY/i.test(String(x.type || ''))
      && /^pune$/i.test(String(x.title || '').trim())
      && /india/i.test(String(x.country || '')),
  );
  return exact
    || content.find((x) => /CITY/i.test(String(x.type || '')) && /pune/i.test(x.title || ''))
    || null;
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl);
  console.log('Partner:', config.partnerId, '| Tier:', config.tierId);
  console.log('Mode: READ-ONLY — search + details only. NO booking.');

  if (!/preprod/i.test(config.baseUrl)) {
    console.warn('WARNING: BASE_URL does not look like preprod:', config.baseUrl);
  }

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);
  const client = session.client;

  const ac = await hotel.autocomplete('Pune');
  if (!ac.ok) throw new Error(`autocomplete failed: ${JSON.stringify(ac.data).slice(0, 300)}`);
  const city = pickPuneCity(ac.data?.content || []);
  if (!city?.entityId) throw new Error('Pune CITY entity not found');
  console.log('Pune city', city.entityId, city.title, city.type);

  const dayCandidates = (process.env.HOTEL_CHECKIN_CANDIDATES || '21,30,45').split(',').map(Number);
  const nights = Number(process.env.HOTEL_NIGHTS || 2);
  const roomsOcc = [{ adults: 1, children: 0, childrenAges: [] }];

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    mode: 'READ-ONLY',
    city: { entityId: city.entityId, title: city.title, type: city.type },
    picks: [],
    best: null,
  };

  for (const days of dayCandidates) {
    const checkin = futureDate(days);
    const checkout = futureDate(days + nights);
    console.log(`\n=== Pune +${days}d ${checkin} → ${checkout} ===`);

    const search = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...Q, page: 0, perpage: 50, sortby: 'price,asc' },
      body: {
        checkin,
        checkout,
        entityId: String(city.entityId),
        nationality: 'IN',
        type: 'CITY',
        rooms: roomsOcc,
      },
      correlation: true,
      partnerKey: session.accessToken,
    });

    if (!search.ok) {
      console.log('search fail', search.status, JSON.stringify(search.data).slice(0, 200));
      report.picks.push({ checkin, checkout, error: `search ${search.status}` });
      continue;
    }

    const results = [...(search.data?.results || [])]
      .filter((h) => h?.available !== false)
      .sort((a, b) => (money(a.price?.totalAmount) ?? 1e12) - (money(b.price?.totalAmount) ?? 1e12));

    const cancellable = results.filter(isCancellableFromSearch);
    console.log('hotels', results.length, 'refundable-ish', cancellable.length);
    if (cancellable[0]) {
      console.log('cheapest search refundable:', cancellable[0].name, cancellable[0].price?.totalAmount);
    }

    let bestForDate = null;

    for (const h of cancellable.slice(0, 12)) {
      // hotel-level search then details (no prebook)
      await client.request({
        method: 'POST',
        path: '/v1/hotels/search',
        query: { ...Q, page: 0, perpage: 20 },
        body: {
          checkin,
          checkout,
          entityId: String(h.id),
          nationality: 'IN',
          type: 'HOTEL',
          rooms: roomsOcc,
        },
        correlation: true,
        partnerKey: session.accessToken,
      });

      const details = await hotel.getDetails({
        checkin,
        checkout,
        entityId: String(h.id),
        nationality: 'IN',
        rooms: roomsOcc,
      });

      const hotelResult = details.data?.results?.[0];
      const rooms = (hotelResult?.rooms || [])
        .filter((r) => r.available !== false)
        .map((r) => {
          const charge = applicableCharge(r);
          const active = applicablePolicy(r);
          return {
            roomName: r.name || r.roomType,
            mealType: r.mealType,
            totalAmount: money(r.price?.totalAmount),
            currency: r.price?.currency || 'INR',
            refundable: r.refundable,
            refundableNotes: r.refundableNotes,
            cancellationChargeNow: charge,
            freeCancelNow: charge === 0,
            activePolicy: active,
            cancelPolicies: r.cancelPolicies || [],
            bookingCode: r.bookingCode ? '[present]' : null, // do not leak for booking
          };
        })
        .sort((a, b) => (a.totalAmount ?? 1e12) - (b.totalAmount ?? 1e12));

      const freeRooms = rooms.filter((r) => r.freeCancelNow === true);
      if (!freeRooms.length) {
        console.log('  no 0% room:', h.name);
        continue;
      }

      const cheapestFree = freeRooms[0];
      console.log('  0% cancel room:', h.name, cheapestFree.roomName, cheapestFree.totalAmount);

      const candidate = {
        checkin,
        checkout,
        hotelId: h.id,
        hotelName: h.name || hotelResult?.name,
        starRating: h.starRating ?? hotelResult?.starRating,
        address: hotelResult?.address || h.address,
        searchRefundableNotes: h.refundableNotes || [],
        room: cheapestFree,
        detailsHttp: details.status,
        requestId: details.data?.requestId || null,
      };

      if (!bestForDate || (cheapestFree.totalAmount ?? 1e12) < (bestForDate.room.totalAmount ?? 1e12)) {
        bestForDate = candidate;
      }
      if (!report.best || (cheapestFree.totalAmount ?? 1e12) < (report.best.room.totalAmount ?? 1e12)) {
        report.best = candidate;
      }
    }

    report.picks.push({
      checkin,
      checkout,
      searchCount: results.length,
      refundableSearchCount: cancellable.length,
      cheapestFreeCancel: bestForDate,
    });

    // stop early once we have a solid 0% pick
    if (report.best) break;
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== BEST (cheapest fully refundable / 0% cancel now) ===');
  console.log(JSON.stringify(report.best, null, 2));
  console.log('\nReport:', OUT);
  console.log('NO BOOKING performed.');

  if (!report.best) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
