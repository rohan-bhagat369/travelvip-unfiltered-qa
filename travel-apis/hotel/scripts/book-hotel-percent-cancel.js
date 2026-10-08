/**
 * Book one hotel room that has percentage-based cancellation policies.
 * Leaves booking active (no cancel).
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import {
  buildSearchBody,
  buildFinalizeBody,
  buildGuests,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';

function parsePolicyDate(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
}

function hasPercentPolicy(room) {
  const policies = room?.cancelPolicies || [];
  return policies.some(
    (p) => /percent/i.test(String(p.chargeType || '')) && Number(p.cancellationCharge) > 0,
  );
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
    }) || policies[policies.length - 1] || null
  );
}

async function main() {
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);
  console.log('Base URL:', config.baseUrl);
  console.log('Entity:', config.hotel.defaultEntityId);

  const dayCandidates = [14, 21, 30, 45, 60, 7, 3, 1];
  let booked = null;

  for (const days of dayCandidates) {
    const searchBody = buildSearchBody({
      entityId: config.hotel.defaultEntityId,
      checkinDaysFromNow: days,
      nights: config.hotel.nights || 1,
    });
    console.log(`\nTrying checkin +${days}d ${searchBody.checkin} -> ${searchBody.checkout}`);

    const search = await hotel.search(searchBody);
    if (!search.ok) {
      console.log('search fail', search.status);
      continue;
    }

    const details = await hotel.getDetails(searchBody);
    if (!details.ok) {
      console.log('details fail', details.status);
      continue;
    }

    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    const hotelResult = details.data?.results?.[0];
    const rooms = hotelResult?.rooms || [];
    const percentRooms = rooms.filter(
      (r) => r.available !== false && r.bookingCode && hasPercentPolicy(r),
    );
    console.log('rooms', rooms.length, 'with Percent cancel', percentRooms.length);

    const ranked = percentRooms
      .map((room) => {
        const active = applicablePolicy(room);
        return { room, active, charge: Number(active?.cancellationCharge) };
      })
      .sort((a, b) => {
        const score = (x) => {
          if (x.charge === 50) return 0;
          if (x.charge > 0 && x.charge < 100) return 1;
          if (x.charge === 100) return 2;
          return 3;
        };
        return score(a) - score(b);
      });

    for (const { room, active, charge } of ranked.slice(0, 6)) {
      console.log(
        'Trying room',
        JSON.stringify(room.name || room.roomType),
        'chargeType=',
        active?.chargeType,
        'charge=',
        charge,
      );

      const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
      if (!isPrebookSuccess(prebook)) {
        console.log('prebook fail', JSON.stringify(prebook.data).slice(0, 200));
        continue;
      }

      const bookingContext = extractBookingContext(prebook.data);
      const finalize = await hotel.finalizeBooking(
        buildFinalizeBody({
          bookingContext,
          bookingCode: room.bookingCode,
          requestId,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          guests: buildGuests(),
        }),
      );

      const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
      if (!finalize.ok || !br) {
        console.log('finalize fail', JSON.stringify(finalize.data).slice(0, 250));
        continue;
      }

      const { status, timedOut } = await hotel.waitForBookingStatus(br, 36);
      const detail = await hotel.getBookingDetail(br);

      booked = {
        bookingRefId: br,
        bookingStatus: status,
        timedOut,
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        hotelName: hotelResult?.name || detail.data?.hotelDetails?.hotelName,
        roomName: room.name || room.roomType,
        mealType: room.mealType,
        cancelPolicies: room.cancelPolicies,
        activePolicyNow: active,
        pricing: room.price,
        salesSummary: detail.data?.salesSummary || detail.data?.pricing,
        confirmationNumber: detail.data?.confirmationNumber,
      };
      break;
    }

    if (booked) break;
  }

  if (!booked) {
    throw new Error('Could not book a percent-cancellation hotel room');
  }

  console.log('\n=== HOTEL BOOKING (PERCENT CANCELLATION) ===');
  console.log(JSON.stringify(booked, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
