/**
 * Book hotel room with 100% cancellation charge (non-refundable / full penalty now).
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

function applicableCancelCharge(room, now = new Date()) {
  const policies = room?.cancelPolicies || [];
  if (!policies.length) {
    if (room?.refundable === false) return 100;
    const notes = (room?.refundableNotes || []).join(' ').toLowerCase();
    if (/non.?refund|no refund|100%|not refundable/.test(notes)) return 100;
    return null;
  }

  const sorted = [...policies].sort((a, b) => {
    const da = parsePolicyDate(a.fromDate)?.getTime() ?? 0;
    const db = parsePolicyDate(b.fromDate)?.getTime() ?? 0;
    return db - da;
  });

  const active = sorted.find((p) => {
    const from = parsePolicyDate(p.fromDate);
    return from && from <= now;
  }) || sorted[sorted.length - 1];

  const charge = Number(active?.cancellationCharge);
  return Number.isFinite(charge) ? charge : null;
}

function roomSummary(room) {
  return {
    bookingCode: room.bookingCode,
    roomName: room.name || room.roomType,
    refundable: room.refundable,
    refundableNotes: room.refundableNotes,
    cancelPolicies: room.cancelPolicies,
    applicableCharge: applicableCancelCharge(room),
    totalAmount: room?.price?.totalAmount ?? room?.totalAmount ?? room?.fare?.totalAmount,
    currency: room?.price?.currency ?? room?.currency ?? 'INR',
  };
}

function findFullPenaltyRooms(detailsData) {
  const hotel = detailsData?.results?.[0];
  const rooms = hotel?.rooms || [];
  return rooms
    .filter((room) => room.available !== false && room.bookingCode)
    .map((room) => ({ room, summary: roomSummary(room) }))
    .filter(({ summary }) => summary.applicableCharge === 100);
}

async function tryBookRoom(hotel, searchBody, room, requestId) {
  const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  if (!isPrebookSuccess(prebook)) {
    throw new Error(`Prebook failed: ${JSON.stringify(prebook.data).slice(0, 200)}`);
  }

  const bookingContext = extractBookingContext(prebook.data);
  const finalize = await hotel.finalizeBooking(buildFinalizeBody({
    bookingContext,
    bookingCode: room.bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    guests: buildGuests(),
  }));

  const bookingRefId = finalize.data?.bookingRefId;
  if (!finalize.ok || !bookingRefId) {
    throw new Error(`Finalize failed: ${JSON.stringify(finalize.data).slice(0, 200)}`);
  }

  const { status, timedOut } = await hotel.waitForBookingStatus(bookingRefId, 36);
  const detail = await hotel.getBookingDetail(bookingRefId);

  return {
    bookingRefId,
    bookingStatus: status,
    pendingTimedOut: timedOut,
    prebook,
    finalize,
    detail: detail.data,
  };
}

async function main() {
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);
  console.log('Base URL:', config.baseUrl);

  const entityIds = [
    config.hotel.defaultEntityId,
  ];
  const autocomplete = await hotel.autocomplete();
  if (autocomplete.ok) {
    const extra = (autocomplete.data?.content || [])
      .filter((x) => String(x.type).toUpperCase() === 'HOTEL')
      .slice(0, 8)
      .map((x) => String(x.entityId));
    for (const id of extra) if (!entityIds.includes(id)) entityIds.push(id);
  }

  const checkinCandidates = [3, 7, 14, 21, 30, 45, 60, 90];
  let lastError;

  for (const entityId of entityIds) {
    for (const checkinDays of checkinCandidates) {
      const searchBody = buildSearchBody({ entityId, checkinDays, nights: config.hotel.nights });
      console.log(`\nScanning entity ${entityId}, check-in +${checkinDays}d...`);

      const { searchResponse, detailsResponse, requestId } = await hotel.searchWithDetails(searchBody);
      if (!searchResponse.ok || !detailsResponse?.ok || !requestId) {
        console.log('  search/details unavailable');
        continue;
      }

      const matches = findFullPenaltyRooms(detailsResponse.data);
      console.log(`  rooms with 100% applicable cancel charge: ${matches.length}`);
      if (!matches.length) continue;

      for (const { room, summary } of matches.slice(0, 5)) {
        try {
          console.log('Trying room:', JSON.stringify(summary, null, 2));
          const booking = await tryBookRoom(hotel, searchBody, room, requestId);
          const normalized = String(booking.bookingStatus || '').toLowerCase();
          if (normalized !== 'confirmed' && normalized !== 'pending') {
            lastError = new Error(`${booking.bookingRefId} ended as ${booking.bookingStatus}`);
            continue;
          }

          console.log('\n=== HOTEL BOOKING RESULT (100% CANCEL CHARGE) ===');
          console.log(JSON.stringify({
            bookingRefId: booking.bookingRefId,
            bookingStatus: booking.bookingStatus,
            pendingTimedOut: booking.pendingTimedOut,
            hotelName: detailsResponse.data?.results?.[0]?.name,
            entityId,
            checkin: searchBody.checkin,
            checkout: searchBody.checkout,
            room: summary,
            detailCancelPolicies: booking.detail?.roomDetails?.cancelPolicies,
            detailRefundableNotes: booking.detail?.roomDetails?.refundable_notes,
            confirmationNumber: booking.detail?.confirmationNumber,
            salesSummary: booking.detail?.salesSummary,
          }, null, 2));
          console.log('\nLeft active (not cancelled).');
          return;
        } catch (e) {
          lastError = e;
          console.warn('  room failed:', e.message);
        }
      }
    }
  }

  throw lastError || new Error('No bookable hotel room with 100% cancellation charge found');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
