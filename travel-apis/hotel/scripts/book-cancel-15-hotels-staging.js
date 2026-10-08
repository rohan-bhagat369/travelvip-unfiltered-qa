/**
 * Book 15 hotels on api-staging. After each Confirmed → cancel once → ONE status check.
 * Expect after cancel: status = "Cancellation Requested" (no post-cancel polling).
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/book-cancel-15-hotels-staging.js
 *
 * Report: reports/book-cancel-15-hotels-staging.json
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { isPrebookSuccess, buildSearchBody, extractRequestId, extractBookingCodes } from '../src/helpers.js';
import {
  hilltopSearchDetails,
  prebookRoom,
  buildFinalizeBodyFromStay,
  waitTerminal,
  uniqueEmail,
  availableRooms,
} from '../src/regression/session.js';
import { HILLTOP, RIYA_HOTELS, PAN_ROHAN } from '../src/regression/fixtures.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const TARGET = Number(process.env.HOTEL_BOOK_COUNT || 15);
const OUT = path.join('reports', 'book-cancel-15-hotels-staging.json');

function brief(d, n = 200) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

function isCancellationRequested(statusRes) {
  const status = String(statusRes?.data?.status || '');
  const nested = String(
    statusRes?.data?.cancellationRequest?.status
    || statusRes?.data?.cancellationStatus
    || '',
  );
  return /cancellation\s*requested/i.test(status) || /cancellation\s*requested/i.test(nested);
}

async function searchDetailsForEntity(hotel, entityId, checkinDays, nights = 1) {
  const searchBody = buildSearchBody({
    entityId,
    checkinDays,
    nights,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.type = 'HOTEL';
  searchBody.nationality = 'IN';
  const search = await hotel.search(searchBody, { pid: process.env.HOTEL_PID || 'vgm' });
  if (!search.ok) {
    return { ok: false, search, details: null, requestId: null, rooms: [], searchBody, hotelName: null };
  }
  const details = await hotel.getDetails(searchBody);
  const requestId = details.ok
    ? (extractRequestId(details.data) || extractRequestId(search.data))
    : null;
  const rooms = availableRooms(details);
  return {
    ok: Boolean(details.ok && requestId && rooms.length),
    search,
    details,
    requestId,
    rooms,
    searchBody,
    hotelName: details.data?.results?.[0]?.name || null,
  };
}

async function attemptOneBook(hotel, { entityId, name, checkinDays, nights = 1 }) {
  const stay = entityId === HILLTOP.entityId
    ? await hilltopSearchDetails(hotel, { checkinDays, nights })
    : await searchDetailsForEntity(hotel, entityId, checkinDays, nights);

  const room = stay.rooms?.[0];
  if (!stay.details?.ok || !room || !stay.requestId) {
    return { ok: false, stage: 'search', hotelName: name, checkinDays, detail: 'no rooms' };
  }

  const pre = await prebookRoom(hotel, stay, room);
  if (!isPrebookSuccess(pre)) {
    return {
      ok: false,
      stage: 'prebook',
      hotelName: stay.hotelName || name,
      checkinDays,
      detail: brief(pre.data),
    };
  }

  const body = buildFinalizeBodyFromStay({
    stay,
    room,
    requestId: stay.requestId,
    prebook: pre,
    firstName: 'Rohan',
    lastName: 'Bhagat',
    pan: PAN_ROHAN,
    email: uniqueEmail(`hotel.x15.${checkinDays}.${Date.now() % 10000}`),
  });

  const fin = await hotel.finalizeBooking(body);
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
  if (!fin.ok || !br) {
    return {
      ok: false,
      stage: 'finalize',
      hotelName: stay.hotelName || name,
      checkinDays,
      code: fin.data?.error?.code || null,
      detail: brief(fin.data),
      insufficient: fin.data?.error?.code === 'INSUFFICIENT_BALANCE',
    };
  }

  // Poll only until book settles (Confirmed / Failed / Inprogress) — NOT after cancel
  const st = await waitTerminal(hotel, br, { max: 18, intervalMs: 3500 });
  const status = String(st.data?.status || '');
  return {
    ok: /confirm/i.test(status),
    stage: 'status',
    br,
    status,
    hotelName: stay.hotelName || name,
    entityId,
    checkin: stay.searchBody.checkin,
    checkout: stay.searchBody.checkout,
    checkinDays,
    roomType: room.roomType || room.name || null,
    total: room.price?.totalAmount ?? null,
    inprogress: /inprogress|in.progress/i.test(status),
    failed: /fail|reject/i.test(status),
  };
}

/** Cancel once, then ONE status GET. No polling. */
async function cancelOnceCheck(hotel, br) {
  const cancel = await hotel.cancelBooking(br);
  const after = await hotel.getBookingStatus(br);
  const afterStatus = String(after.data?.status || '');
  const cancelReqStatus = after.data?.cancellationRequest?.status
    || after.data?.cancellationStatus
    || null;
  const pass = isCancellationRequested(after);
  return {
    cancelHttp: cancel.status,
    cancelOk: cancel.ok,
    cancelCode: cancel.data?.error?.code || null,
    afterStatus,
    cancelReqStatus,
    expected: 'Cancellation Requested',
    pass,
    afterBrief: brief(after.data, 240),
  };
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);

  const hotels = RIYA_HOTELS.length ? RIYA_HOTELS : [HILLTOP];
  const dayPool = [25, 28, 32, 35, 39, 42, 46, 49, 53, 56, 60, 63, 67, 70, 74, 77, 81, 84, 88, 91];

  const rows = [];
  let dayIdx = 0;
  let hotelIdx = 0;
  let walletEmpty = false;
  let done = 0;

  console.log(`BASE_URL=${process.env.BASE_URL} target=${TARGET}`);
  console.log('Rule: after cancel, ONE status check → expect "Cancellation Requested" (no poll)');

  while (done < TARGET && !walletEmpty && dayIdx < dayPool.length * hotels.length + 40) {
    const h = hotels[hotelIdx % hotels.length];
    const days = dayPool[Math.floor(dayIdx / hotels.length) % dayPool.length] + (hotelIdx % 3);
    hotelIdx += 1;
    dayIdx += 1;

    const n = done + 1;
    console.log(`\n[${n}/${TARGET}] book ${h.name} (${h.entityId}) +${days}d`);
    let book;
    try {
      book = await attemptOneBook(hotel, {
        entityId: h.entityId,
        name: h.name,
        checkinDays: days,
        nights: 1,
      });
    } catch (e) {
      book = {
        ok: false,
        stage: 'exception',
        hotelName: h.name,
        checkinDays: days,
        detail: String(e.message || e),
      };
    }

    if (book.insufficient) {
      console.log('  INSUFFICIENT_BALANCE — stop');
      walletEmpty = true;
      rows.push({ ...book, verdict: 'NOT TESTED', actual: 'wallet empty' });
      break;
    }
    if (book.inprogress) {
      console.log(`  Inprogress BR=${book.br} — leave, next`);
      rows.push({
        ...book,
        verdict: 'NOT TESTED',
        actual: `Inprogress left ${book.br}`,
      });
      continue;
    }
    if (!book.ok || !book.br) {
      console.log(`  skip stage=${book.stage} ${book.status || ''} ${book.code || ''} ${book.detail || ''}`);
      continue;
    }

    console.log(`  Confirmed BR=${book.br} → cancel (no poll)`);
    const c = await cancelOnceCheck(hotel, book.br);
    const verdict = c.pass ? 'PASS' : 'BUG';
    const actual = c.pass
      ? `afterStatus="${c.afterStatus}" cancelReq=${c.cancelReqStatus || 'n/a'}`
      : `expected Cancellation Requested; got status="${c.afterStatus}" cancelReq=${JSON.stringify(c.cancelReqStatus)} cancelHttp=${c.cancelHttp}`;

    console.log(`  [${verdict}] cancel http=${c.cancelHttp} status=${c.afterStatus}`);
    rows.push({
      id: n,
      br: book.br,
      hotelName: book.hotelName,
      entityId: book.entityId,
      stay: `${book.checkin}→${book.checkout}`,
      bookStatus: book.status,
      ...c,
      verdict,
      actual,
    });
    done += 1;
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    target: TARGET,
    completed: done,
    walletEmpty,
    counts: {
      PASS: rows.filter((r) => r.verdict === 'PASS').length,
      BUG: rows.filter((r) => r.verdict === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.verdict === 'NOT TESTED').length,
    },
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nReport: ${OUT}`);
  console.log(JSON.stringify({ completed: out.completed, ...out.counts, walletEmpty }, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
