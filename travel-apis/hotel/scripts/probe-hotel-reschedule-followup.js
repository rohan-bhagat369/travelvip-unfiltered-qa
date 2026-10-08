/**
 * Hotel cancel/reschedule follow-up — remaining docs cases + POST cancel path.
 * Run: node scripts/probe-hotel-reschedule-followup.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  HOTEL_QUERY,
  buildFinalizeBody,
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-reschedule-followup-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 500) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}
function bodyStatus(res) {
  return res?.data?.status;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);
  const cases = [];

  const record = (id, title, extra = {}) => {
    const row = { id, title, ...extra, at: new Date().toISOString() };
    cases.push(row);
    const mark = row.passed === true ? 'PASS' : row.passed === false ? 'FAIL' : 'INFO';
    console.log(`\n[${mark}] ${id} ${title}`);
    if (row.http != null) console.log(' HTTP', row.http, 'bodyStatus', row.bodyStatus, row.code || '');
    if (row.snippet) console.log(' ', String(row.snippet).slice(0, 320));
    return row;
  };

  const cancelGet = (br) => hotel.cancelBooking(br);
  const cancelPostV1 = (br, body = {}) => client.request({
    method: 'POST',
    path: `/v1/hotels/bookings/${br}/cancel`,
    query: HOTEL_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const cancelPostApi = (body) => client.request({
    method: 'POST',
    path: '/api/hotels/cancelBooking',
    query: HOTEL_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  // docs also list this shape
  const cancelPostApiAlt = (body) => client.request({
    method: 'POST',
    path: '/v1/hotels/cancelBooking',
    query: HOTEL_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  async function waitStatus(br, pred, maxAttempts = 36) {
    let last;
    for (let i = 0; i < maxAttempts; i += 1) {
      last = await hotel.getBookingStatus(br);
      const st = String(last.data?.status || last.data?.bookingStatus || '');
      if (ok(last) && pred(st, last.data)) return { status: st, response: last };
      await sleep(4000);
    }
    return { status: last?.data?.status, response: last, timedOut: true };
  }

  async function prepareStay(checkinDays) {
    const searchBody = buildSearchBody({
      entityId: config.hotel.defaultEntityId,
      checkinDays,
      nights: 2,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    const search = await hotel.search(searchBody);
    if (!ok(search)) throw new Error(`search ${brief(search.data)}`);
    const details = await hotel.getDetails(searchBody);
    if (!ok(details)) throw new Error(`details ${brief(details.data)}`);
    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    let codes = extractBookingCodes(details.data);
    const test = codes.filter((c) => String(c).includes('rh-test'));
    if (test.length) codes = test;
    if (!requestId || !codes.length) throw new Error('no codes');
    for (const bookingCode of codes.slice(0, 8)) {
      const prebook = await hotel.prebook({ bookingCode, requestId });
      if (!isPrebookSuccess(prebook)) continue;
      const bookingContext = extractBookingContext(prebook.data);
      return {
        searchBody,
        bookingCode,
        requestId,
        finalizeBase: buildFinalizeBody({
          bookingContext,
          bookingCode,
          requestId,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          guests: [{
            title: 'Mr.',
            firstName: config.hotel.guestFirstName,
            lastName: config.hotel.guestLastName,
            type: 'Adult',
            isLead: true,
          }],
        }),
      };
    }
    throw new Error('prebook fail');
  }

  async function bookConfirmed(checkinDays = 21) {
    const stay = await prepareStay(checkinDays);
    const finalize = await hotel.finalizeBooking(stay.finalizeBase);
    const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
    if (!ok(finalize) || !br) throw new Error(`finalize ${brief(finalize.data)}`);
    const wait = await waitStatus(br, (s) => isTerminalHotelStatus(s), 40);
    return { br, status: wait.status, stay, finalize };
  }

  // ===== F1: POST cancel missing bookingId =====
  {
    const res = await cancelPostApi({});
    record('F1a', 'POST /api/hotels/cancelBooking missing bookingId', {
      passed: null,
      observational: true,
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 400),
    });
  }
  {
    const res = await cancelPostApiAlt({});
    record('F1b', 'POST /v1/hotels/cancelBooking missing bookingId (alt path)', {
      passed: null,
      observational: true,
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 400),
    });
  }

  // ===== F2: POST cancel unknown =====
  {
    const res = await cancelPostV1('BR0000000000000000', {});
    record('F2', 'POST v1 cancel unknown BR → BOOKING_NOT_FOUND envelope?', {
      expected: 'HTTP 404 + error.code BOOKING_NOT_FOUND',
      passed: res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND',
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 400),
    });
  }
  {
    const res = await cancelPostApi({ bookingId: 'BR0000000000000000' });
    record('F2b', 'POST /api/hotels/cancelBooking unknown BR', {
      passed: res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND',
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 400),
    });
  }

  // ===== Book + POST cancel primary path =====
  console.log('\n=== BOOK + POST CANCEL FLOW ===');
  let original;
  try {
    original = await bookConfirmed(22);
  } catch (e) {
    record('F0', 'Book original', { passed: false, message: e.message });
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: e.message, cases }, null, 2));
    throw e;
  }
  record('F0', 'Book original (POST-cancel flow)', {
    passed: /confirm/i.test(String(original.status)),
    br: original.br,
    status: original.status,
  });

  // null reschedulingReferenceId should be normal book (not validation error)
  {
    const stay = await prepareStay(28);
    const res = await hotel.finalizeBooking({
      ...stay.finalizeBase,
      reschedulingReferenceId: null,
    });
    const br = res.data?.bookingRefId || res.data?.bookingReferenceId;
    record('F3', 'finalize with reschedulingReferenceId:null → normal book OK', {
      passed: ok(res) && Boolean(br),
      http: res.status,
      code: errCode(res),
      newBr: br,
      snippet: brief(res.data, 300),
    });
    // cancel the accidental book to avoid wallet clutter
    if (br) await cancelGet(br).catch(() => {});
  }

  // non-string type
  {
    const stay = await prepareStay(29);
    const res = await hotel.finalizeBooking({
      ...stay.finalizeBase,
      reschedulingReferenceId: 12345,
    });
    record('F4', 'finalize reschedulingReferenceId as number → VALIDATION_ERROR?', {
      expected: 'HTTP 400 + VALIDATION_ERROR',
      passed: (res.status === 400 && errCode(res) === 'VALIDATION_ERROR')
        || (bodyStatus(res) === 400),
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 400),
      note: 'Docs: blank, not a string, or over 100 chars → VALIDATION_ERROR',
    });
  }

  // POST cancel confirmed booking
  {
    const res = await cancelPostV1(original.br, {});
    record('F5', 'POST v1 cancel Confirmed booking', {
      passed: ok(res) || bodyStatus(res) === 0,
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 450),
    });
  }

  const afterCancel = await waitStatus(original.br, (s) => /cancel/i.test(s), 30);
  record('F6', 'status after POST cancel', {
    passed: /cancel/i.test(String(afterCancel.status)),
    status: afterCancel.status,
    snippet: brief(afterCancel.response?.data, 250),
  });

  // Second POST cancel → should be BOOKING_ALREADY_CANCELLED per docs
  {
    const res = await cancelPostV1(original.br, {});
    record('F7', '2nd POST cancel → BOOKING_ALREADY_CANCELLED?', {
      expected: 'HTTP 400 + BOOKING_ALREADY_CANCELLED',
      passed: res.status === 400 && errCode(res) === 'BOOKING_ALREADY_CANCELLED',
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      refundStatus: res.data?.error?.refundStatus || res.data?.refundStatus,
      currentStatus: res.data?.error?.currentStatus || res.data?.currentStatus,
      snippet: brief(res.data, 450),
    });
  }

  // GET cancel after POST cancel
  {
    const res = await cancelGet(original.br);
    record('F8', 'GET cancel after already cancelled (POST path)', {
      expected: 'HTTP 400 + BOOKING_ALREADY_CANCELLED OR at least not success',
      passed: (res.status === 400 && errCode(res) === 'BOOKING_ALREADY_CANCELLED')
        || (bodyStatus(res) === 400),
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      duplicate: res.data?.duplicate,
      snippet: brief(res.data, 450),
    });
  }

  // api/hotels/cancelBooking body with bookingId
  {
    const res = await cancelPostApi({ bookingId: original.br });
    record('F9', 'POST /api/hotels/cancelBooking already cancelled', {
      expected: 'HTTP 400 + BOOKING_ALREADY_CANCELLED',
      passed: res.status === 400 && errCode(res) === 'BOOKING_ALREADY_CANCELLED',
      http: res.status,
      bodyStatus: bodyStatus(res),
      code: errCode(res),
      snippet: brief(res.data, 450),
    });
  }

  // Happy path reschedule via POST-cancelled BR
  console.log('\n=== RESCHEDULE AFTER POST CANCEL ===');
  let newBr = null;
  let last = null;
  if (/cancel/i.test(String(afterCancel.status))) {
    for (let i = 0; i < 6; i += 1) {
      const stay = await prepareStay(41 + i);
      last = await hotel.finalizeBooking({
        ...stay.finalizeBase,
        reschedulingReferenceId: original.br,
      });
      console.log('attempt', i + 1, last.status, errCode(last), bodyStatus(last));
      newBr = last.data?.bookingRefId || last.data?.bookingReferenceId;
      if (ok(last) && newBr) break;
      if (errCode(last) === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') {
        await sleep(8000);
        continue;
      }
      break;
    }
    record('F10', 'reschedule after POST cancel', {
      passed: Boolean(newBr),
      http: last?.status,
      code: errCode(last),
      newBr,
      originalBr: original.br,
      snippet: brief(last?.data, 400),
    });
    if (newBr) {
      const w = await waitStatus(newBr, (s) => isTerminalHotelStatus(s), 36);
      record('F11', 'rescheduled booking terminal status', {
        passed: /confirm/i.test(String(w.status)),
        newBr,
        status: w.status,
      });
    }
  }

  // Try past stay: finalize with a known old cancelled hotel if we have one from prior run
  // Use original BR after reschedule already used — already covered. Try inventing nothing.
  // Probe RESCHEDULING_STAY_COMPLETED only if we can find a cancelled hotel with past checkin in history
  {
    const hist = await hotel.bookingHistory(0, 20);
    const items = hist.data?.content || hist.data?.data || hist.data?.bookings || [];
    const list = Array.isArray(items) ? items : [];
    const past = list.find((b) => {
      const checkin = b.checkin || b.checkIn || b.hotelDetails?.checkin;
      const st = String(b.status || b.bookingStatus || '');
      return checkin && new Date(checkin) < new Date() && /cancel/i.test(st);
    });
    if (past) {
      const pastBr = past.bookingReferenceId || past.bookingRefId || past.bookingReference;
      const stay = await prepareStay(45);
      const res = await hotel.finalizeBooking({
        ...stay.finalizeBase,
        reschedulingReferenceId: pastBr,
      });
      record('F12', 'past checkin cancelled BR → RESCHEDULING_STAY_COMPLETED?', {
        pastBr,
        checkin: past.checkin || past.checkIn,
        passed: res.status === 422 && errCode(res) === 'RESCHEDULING_STAY_COMPLETED',
        http: res.status,
        code: errCode(res),
        snippet: brief(res.data, 400),
      });
    } else {
      record('F12', 'past stay RESCHEDULING_STAY_COMPLETED', {
        passed: null,
        observational: true,
        message: 'No past-checkin cancelled hotel found in recent history — skipped',
      });
    }
  }

  // BOOKING_NOT_CANCELLABLE — Pending booking cancel (book and cancel before Confirmed if possible)
  console.log('\n=== CANCEL WHILE PENDING ===');
  try {
    const stay = await prepareStay(50);
    const finalize = await hotel.finalizeBooking(stay.finalizeBase);
    const pendingBr = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
    if (pendingBr) {
      // cancel immediately without waiting for Confirmed
      const resGet = await cancelGet(pendingBr);
      record('F13a', 'GET cancel while Pending (if still Pending)', {
        expected: 'HTTP 400 + BOOKING_NOT_CANCELLABLE + currentStatus',
        passed: (resGet.status === 400 && errCode(resGet) === 'BOOKING_NOT_CANCELLABLE')
          || (bodyStatus(resGet) === 400 && /only be cancelled when status is Confirmed/i.test(JSON.stringify(resGet.data))),
        http: resGet.status,
        bodyStatus: bodyStatus(resGet),
        code: errCode(resGet),
        currentStatus: resGet.data?.error?.currentStatus || resGet.data?.currentStatus,
        snippet: brief(resGet.data, 400),
        pendingBr,
      });
      const resPost = await cancelPostV1(pendingBr, {});
      record('F13b', 'POST cancel while Pending/non-Confirmed', {
        expected: 'HTTP 400 + BOOKING_NOT_CANCELLABLE',
        passed: (resPost.status === 400 && errCode(resPost) === 'BOOKING_NOT_CANCELLABLE')
          || (bodyStatus(resPost) === 400),
        http: resPost.status,
        bodyStatus: bodyStatus(resPost),
        code: errCode(resPost),
        currentStatus: resPost.data?.error?.currentStatus || resPost.data?.currentStatus,
        snippet: brief(resPost.data, 400),
      });
      // wait and cancel if still open
      const w = await waitStatus(pendingBr, (s) => isTerminalHotelStatus(s), 30);
      if (/confirm/i.test(String(w.status))) await cancelGet(pendingBr);
    }
  } catch (e) {
    record('F13', 'Pending cancel probe', { passed: false, message: e.message });
  }

  const summary = {
    baseUrl: config.baseUrl,
    original: { br: original?.br, afterCancel: afterCancel?.status },
    reschedule: { newBr },
    bugs: cases.filter((c) => c.passed === false).map((c) => ({
      id: c.id,
      title: c.title,
      http: c.http,
      bodyStatus: c.bodyStatus,
      code: c.code,
      snippet: c.snippet,
    })),
    totals: {
      total: cases.length,
      passed: cases.filter((c) => c.passed === true).length,
      failed: cases.filter((c) => c.passed === false).length,
      observational: cases.filter((c) => c.passed == null).length,
    },
    cases,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log('Failed:', summary.bugs.map((b) => `${b.id} ${b.title}`));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
