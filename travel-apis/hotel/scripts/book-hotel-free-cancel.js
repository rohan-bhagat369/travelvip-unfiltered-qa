/**
 * Find & book cheapest FREE-cancellation / 0% penalty hotel in Pune (full refund now).
 * Leaves booking active (does not cancel).
 *
 * Prefer running probe-hotel-cancel-policies.js first (read-only).
 *
 *   BASE_URL=<prod-url> node scripts/book-hotel-free-cancel.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import { futureDate } from '../../../shared/lib/testUtils.js';
import {
  extractBookingContext,
  isPrebookSuccess,
} from '../src/helpers.js';

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

function applicableCancelCharge(room) {
  const active = applicablePolicy(room);
  if (active) {
    const charge = Number(active.cancellationCharge);
    return Number.isFinite(charge) ? charge : null;
  }
  if (room?.refundable === true) return 0;
  if (room?.refundable === false) return 100;
  return null;
}

function isFreeCancelNow(room) {
  return applicableCancelCharge(room) === 0;
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
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);
  const client = session.client;

  const ac = await hotel.autocomplete('Pune');
  if (!ac.ok) throw new Error(`autocomplete failed: ${JSON.stringify(ac.data).slice(0, 250)}`);
  const city = pickPuneCity(ac.data?.content || []);
  if (!city?.entityId) throw new Error('Pune CITY not found');
  console.log('City', city.entityId, city.title);

  const dayCandidates = config.hotel.checkinDayCandidates?.length
    ? config.hotel.checkinDayCandidates
    : [21, 30, 45, 60];
  const nights = config.hotel.nights || 2;
  const roomsOcc = [{ adults: 1, children: 0, childrenAges: [] }];
  const adultOnlyGuests = [{
    title: 'Mr.',
    firstName: config.hotel.guestFirstName,
    lastName: config.hotel.guestLastName,
    type: 'Adult',
    isLead: true,
  }];

  let booked = null;
  const scanned = [];

  for (const days of dayCandidates) {
    const checkin = futureDate(days);
    const checkout = futureDate(days + nights);
    console.log(`\n--- Pune +${days}d ${checkin} -> ${checkout} ---`);

    const citySearch = await client.request({
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
    if (!citySearch.ok) {
      console.log('city search fail', citySearch.status);
      continue;
    }

    const cancellable = [...(citySearch.data?.results || [])]
      .filter((h) => h.available !== false && isCancellableFromSearch(h))
      .sort((a, b) => (money(a.price?.totalAmount) ?? 1e12) - (money(b.price?.totalAmount) ?? 1e12));

    console.log(
      'cancellable hotels',
      cancellable.length,
      'cheapest',
      cancellable[0]?.name,
      cancellable[0]?.price?.totalAmount,
    );
    scanned.push({
      checkin,
      checkout,
      cheapestCancellableSearch: cancellable.slice(0, 5).map((h) => ({
        id: h.id,
        name: h.name,
        amount: h.price?.totalAmount,
        notes: h.refundableNotes,
      })),
    });

    for (const h of cancellable.slice(0, 10)) {
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
      const requestId = details.data?.requestId;
      const hotelResult = details.data?.results?.[0];
      const freeRooms = (hotelResult?.rooms || [])
        .filter((r) => r.available !== false && r.bookingCode && isFreeCancelNow(r))
        .sort((a, b) => (money(a.price?.totalAmount) ?? 1e12) - (money(b.price?.totalAmount) ?? 1e12));

      console.log(h.name, 'free0% rooms', freeRooms.length);
      if (!freeRooms.length || !requestId) continue;

      for (const room of freeRooms.slice(0, 3)) {
        const charge = applicableCancelCharge(room);
        console.log('Trying', room.name || room.roomType, 'amt', room.price?.totalAmount, 'charge', charge);

        const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
        if (!isPrebookSuccess(prebook)) {
          console.log('prebook fail', JSON.stringify(prebook.data).slice(0, 200));
          continue;
        }

        const bookingContext = extractBookingContext(prebook.data);
        const finalize = await hotel.finalizeBooking({
          bookingContext,
          bookingCode: room.bookingCode,
          requestId,
          checkin,
          checkout,
          rooms: [{ guests: adultOnlyGuests }],
          contact: {
            email: config.hotel.contactEmail,
            countryCode: config.hotel.contactCountryCode,
            mobile: config.hotel.contactMobile,
          },
        });

        const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
        console.log('finalize', finalize.status, br, finalize.data?.message || '');
        if (!finalize.ok || !br) continue;

        const { status, timedOut } = await hotel.waitForBookingStatus(br, 40);
        const detail = await hotel.getBookingDetail(br);
        booked = {
          ranAt: new Date().toISOString(),
          env: config.baseUrl,
          bookingRefId: br,
          bookingStatus: status,
          timedOut,
          checkin,
          checkout,
          hotelName: hotelResult?.name || h.name,
          roomName: room.name || room.roomType,
          amount: room.price?.totalAmount,
          cancelPolicies: room.cancelPolicies,
          applicableChargeNow: charge,
          salesSummary: detail.data?.salesSummary || detail.data?.pricing,
          confirmationNumber: detail.data?.confirmationNumber,
        };
        break;
      }
      if (booked) break;
    }
    if (booked) break;
  }

  fs.mkdirSync('reports/hotel', { recursive: true });
  const reportPath = path.join('reports/hotel', 'pune-free-cancel-booking.json');
  fs.writeFileSync(reportPath, JSON.stringify({ booked, scanned }, null, 2));

  if (!booked) {
    console.log('Scan:', JSON.stringify(scanned, null, 2));
    throw new Error('Could not book a free-cancellation Pune hotel (0% penalty now)');
  }

  console.log('\n=== PUNE FREE-CANCEL HOTEL BOOKED ===');
  console.log(JSON.stringify(booked, null, 2));
  console.log('Report:', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
