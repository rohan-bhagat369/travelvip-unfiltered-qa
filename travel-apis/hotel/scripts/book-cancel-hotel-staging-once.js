/**
 * One-shot: Hilltop Mumbai on api-staging → Confirmed → GET cancel.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { isPrebookSuccess } from '../src/helpers.js';
import {
  hilltopSearchDetails,
  prebookRoom,
  buildFinalizeBodyFromStay,
  waitTerminal,
  uniqueEmail,
} from '../src/regression/session.js';
import { HILLTOP } from '../src/regression/fixtures.js';
import { sleep } from '../../../shared/lib/testUtils.js';

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);
  console.log('Base:', process.env.BASE_URL);
  console.log('Hotel:', HILLTOP.name, HILLTOP.entityId);

  let booked = null;
  for (const days of [28, 35, 21, 42]) {
    console.log(`\n--- search checkin +${days}d`);
    const stay = await hilltopSearchDetails(hotel, { checkinDays: days, nights: 1 });
    const room = stay.rooms[0];
    console.log('  search', stay.search.status, 'details', stay.details.status, 'rooms', stay.rooms.length);
    if (!stay.details.ok || !room || !stay.requestId) continue;

    const pre = await prebookRoom(hotel, stay, room);
    console.log('  prebook', pre.status, isPrebookSuccess(pre) ? 'ok' : brief(pre.data));
    if (!isPrebookSuccess(pre)) continue;

    const body = buildFinalizeBodyFromStay({
      stay, room, requestId: stay.requestId, prebook: pre,
      email: uniqueEmail('hotel.bookcancel'),
    });
    const fin = await hotel.finalizeBooking(body);
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
    console.log('  finalize', fin.status, br || fin.data?.error?.code, brief(fin.data, 180));
    if (!fin.ok || !br) {
      if (fin.data?.error?.code === 'INSUFFICIENT_BALANCE') {
        console.error('Wallet exhausted — stop.');
        process.exit(1);
      }
      continue;
    }

    const st = await waitTerminal(hotel, br, { max: 16, intervalMs: 3500 });
    const status = String(st.data?.status || '');
    console.log('  status', status);
    if (/inprogress|in.progress/i.test(status)) {
      console.log('  Inprogress — leave BR, try next date');
      continue;
    }
    if (/confirm/i.test(status)) {
      booked = {
        br,
        status,
        checkin: stay.searchBody.checkin,
        checkout: stay.searchBody.checkout,
        hotelName: stay.hotelName,
        roomType: room.roomType || room.name,
        total: room.price?.totalAmount,
      };
      break;
    }
    console.log('  not Confirmed, next date');
  }

  if (!booked) {
    console.error('No Confirmed hotel booking — cannot cancel.');
    process.exit(1);
  }

  console.log('\n=== BOOKED', booked);
  const penalty = await hotel.penaltyCheck(booked.br);
  console.log('Penalty-check', penalty.status, brief(penalty.data, 220));

  const cancel = await hotel.cancelBooking(booked.br);
  console.log('Cancel GET', cancel.status, brief(cancel.data, 280));

  await sleep(3000);
  let after = await hotel.getBookingStatus(booked.br);
  for (let i = 0; i < 8 && !/cancel/i.test(String(after.data?.status || '')); i += 1) {
    await sleep(3000);
    after = await hotel.getBookingStatus(booked.br);
    console.log('  after-cancel poll', after.data?.status);
  }

  const again = await hotel.cancelBooking(booked.br);
  console.log('Repeat cancel', again.status, again.data?.error?.code || brief(again.data, 160));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    bookingRefId: booked.br,
    hotel: booked.hotelName,
    stay: `${booked.checkin} → ${booked.checkout}`,
    bookedStatus: booked.status,
    afterCancelStatus: after.data?.status,
    cancelHttp: cancel.status,
    repeatCancelHttp: again.status,
    repeatCode: again.data?.error?.code || null,
  }, null, 2));

  if (!/cancel/i.test(String(after.data?.status || ''))) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
