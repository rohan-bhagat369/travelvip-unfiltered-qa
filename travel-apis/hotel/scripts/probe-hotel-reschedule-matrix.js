/**
 * Hotel cancel + reschedule matrix vs docs.
 *
 * Flow: book → cancel → search/prebook/finalize with reschedulingReferenceId
 * Also runs listed negative codes.
 *
 * Run: node scripts/probe-hotel-reschedule-matrix.js
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

const OUT = path.join('reports', 'hotel-reschedule-matrix-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 500) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
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
    if (row.http != null) console.log(' HTTP', row.http, row.code || '');
    if (row.message) console.log(' ', String(row.message).slice(0, 280));
    else if (row.snippet) console.log(' ', String(row.snippet).slice(0, 280));
    return row;
  };

  async function cancelGet(br) {
    return hotel.cancelBooking(br);
  }
  async function cancelPost(br, body = {}) {
    return client.request({
      method: 'POST',
      path: `/v1/hotels/bookings/${br}/cancel`,
      query: HOTEL_QUERY,
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  async function waitStatus(br, pred, maxAttempts = 36) {
    let last;
    for (let i = 0; i < maxAttempts; i += 1) {
      last = await hotel.getBookingStatus(br);
      const st = String(last.data?.status || last.data?.bookingStatus || '');
      if (ok(last) && pred(st, last.data)) return { status: st, response: last };
      await sleep(5000);
    }
    return { status: last?.data?.status, response: last, timedOut: true };
  }

  async function bookConfirmed() {
    // Prefer adult-only, rh-test rooms, multiple checkin candidates
    const entityIds = [
      config.hotel.defaultEntityId,
      '2869073',
    ];
    const dayCandidates = config.hotel.checkinDayCandidates?.length
      ? config.hotel.checkinDayCandidates
      : [14, 21, 30, 45];

    for (const entityId of entityIds) {
      for (const checkinDays of dayCandidates) {
        const searchBody = buildSearchBody({
          entityId,
          checkinDays,
          nights: config.hotel.nights || 2,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!ok(search)) continue;
        const details = await hotel.getDetails(searchBody);
        if (!ok(details)) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        let codes = extractBookingCodes(details.data);
        // prefer rh-test
        const testCodes = codes.filter((c) => String(c).includes('rh-test'));
        if (testCodes.length) codes = [...testCodes, ...codes.filter((c) => !String(c).includes('rh-test'))];
        if (!requestId || !codes.length) continue;

        for (const bookingCode of codes.slice(0, 6)) {
          const prebook = await hotel.prebook({ bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          const bookingContext = extractBookingContext(prebook.data);
          const finalize = await hotel.finalizeBooking(buildFinalizeBody({
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
          }));
          const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
          if (!ok(finalize) || !br) {
            console.log('finalize fail', brief(finalize.data, 200));
            continue;
          }
          const wait = await waitStatus(br, (s) => isTerminalHotelStatus(s), 40);
          return {
            br,
            status: wait.status,
            searchBody,
            bookingCode,
            requestId,
            finalize,
            wait,
          };
        }
      }
    }
    throw new Error('Could not book a confirmed hotel');
  }

  async function prepareNewStay(checkinDays = 30) {
    const searchBody = buildSearchBody({
      entityId: config.hotel.defaultEntityId,
      checkinDays,
      nights: 2,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    const search = await hotel.search(searchBody);
    if (!ok(search)) throw new Error(`search fail ${brief(search.data)}`);
    const details = await hotel.getDetails(searchBody);
    if (!ok(details)) throw new Error(`details fail ${brief(details.data)}`);
    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    let codes = extractBookingCodes(details.data);
    const testCodes = codes.filter((c) => String(c).includes('rh-test'));
    if (testCodes.length) codes = testCodes;
    if (!requestId || !codes.length) throw new Error('no booking codes for new stay');

    for (const bookingCode of codes.slice(0, 8)) {
      const prebook = await hotel.prebook({ bookingCode, requestId });
      if (!isPrebookSuccess(prebook)) continue;
      const bookingContext = extractBookingContext(prebook.data);
      return {
        searchBody,
        bookingCode,
        requestId,
        bookingContext,
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
    throw new Error('prebook failed for new stay');
  }

  // ---------- Book original ----------
  console.log('\n=== BOOK ORIGINAL HOTEL ===');
  let original;
  try {
    original = await bookConfirmed();
  } catch (e) {
    record('H0', 'Book original hotel', { passed: false, message: e.message });
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: e.message, cases }, null, 2));
    throw e;
  }
  record('H0', 'Book original hotel', {
    passed: /confirm/i.test(String(original.status)),
    br: original.br,
    status: original.status,
    checkin: original.searchBody.checkin,
  });
  if (!/confirm/i.test(String(original.status))) {
    throw new Error(`Original not confirmed: ${original.status}`);
  }

  // ---------- Negatives while still Confirmed ----------
  console.log('\n=== RESCHEDULE NEGATIVES (before cancel) ===');
  let stay;
  try {
    stay = await prepareNewStay(35);
  } catch (e) {
    record('Hprep', 'Prepare new stay pricing', { passed: false, message: e.message });
    throw e;
  }

  // empty string
  {
    const res = await hotel.finalizeBooking({
      ...stay.finalizeBase,
      reschedulingReferenceId: '',
    });
    record('R1', 'finalize empty reschedulingReferenceId → VALIDATION_ERROR', {
      passed: res.status === 400 && errCode(res) === 'VALIDATION_ERROR',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data, 350),
    });
  }

  // over 100 chars
  {
    const res = await hotel.finalizeBooking({
      ...stay.finalizeBase,
      reschedulingReferenceId: 'B'.repeat(101),
    });
    record('R2', 'finalize reschedulingReferenceId >100 chars → VALIDATION_ERROR', {
      passed: res.status === 400 && errCode(res) === 'VALIDATION_ERROR',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data, 350),
    });
  }

  // not found
  {
    const fresh = await prepareNewStay(36);
    const res = await hotel.finalizeBooking({
      ...fresh.finalizeBase,
      reschedulingReferenceId: 'BR0000000000000000',
    });
    record('R3', 'unknown BR → RESCHEDULING_BOOKING_NOT_FOUND', {
      passed: res.status === 404 && errCode(res) === 'RESCHEDULING_BOOKING_NOT_FOUND',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data, 350),
    });
  }

  // still confirmed / not cancelled
  {
    const fresh = await prepareNewStay(37);
    const res = await hotel.finalizeBooking({
      ...fresh.finalizeBase,
      reschedulingReferenceId: original.br,
    });
    const code = errCode(res);
    record('R4', 'reschedule while still Confirmed → NOT_ALLOWED / VALIDATION', {
      passed: [400, 422].includes(res.status) && /RESCHEDULING_NOT_ALLOWED|VALIDATION_ERROR/.test(String(code)),
      http: res.status,
      code,
      snippet: brief(res.data, 400),
      note: 'Docs conflict: flow says 400 VALIDATION_ERROR; error table says 422 RESCHEDULING_NOT_ALLOWED',
    });
  }

  // flight BR as hotel reschedule reference
  {
    const flightBr = 'BR1786017237353711'; // known flight BR from SG reschedule
    const fresh = await prepareNewStay(38);
    const res = await hotel.finalizeBooking({
      ...fresh.finalizeBase,
      reschedulingReferenceId: flightBr,
    });
    record('R5', 'flight BR as reschedulingReferenceId → RESCHEDULING_BOOKING_NOT_HOTEL', {
      passed: res.status === 422 && errCode(res) === 'RESCHEDULING_BOOKING_NOT_HOTEL',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data, 400),
      flightBr,
    });
  }

  // ---------- Cancel original ----------
  console.log('\n=== CANCEL ORIGINAL ===');
  // Cancel on non-existent
  {
    const res = await cancelGet('BR0000000000000000');
    record('C1', 'cancel unknown BR → BOOKING_NOT_FOUND', {
      passed: res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data, 300),
    });
  }

  const cancelRes = await cancelGet(original.br);
  record('C2', 'cancel confirmed hotel (GET)', {
    passed: ok(cancelRes),
    http: cancelRes.status,
    code: errCode(cancelRes),
    snippet: brief(cancelRes.data, 450),
  });

  // Also probe POST cancel shape if GET already cancelled
  {
    const res = await cancelPost(original.br, {});
    record('C3', 'cancel again via POST (observe already cancelled / method)', {
      passed: true,
      observational: true,
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data, 400),
    });
  }

  const afterCancel = await waitStatus(
    original.br,
    (s) => /cancel/i.test(s),
    36,
  );
  record('C4', 'status after cancel', {
    passed: /cancel/i.test(String(afterCancel.status)),
    status: afterCancel.status,
    timedOut: afterCancel.timedOut,
    snippet: brief(afterCancel.response?.data, 300),
  });

  // Double cancel
  {
    const res = await cancelGet(original.br);
    record('C5', 'cancel already cancelled → BOOKING_ALREADY_CANCELLED', {
      passed: res.status === 400 && errCode(res) === 'BOOKING_ALREADY_CANCELLED',
      http: res.status,
      code: errCode(res),
      refundStatus: res.data?.error?.refundStatus,
      snippet: brief(res.data, 400),
    });
  }

  // ---------- Happy path reschedule ----------
  console.log('\n=== HAPPY PATH RESCHEDULE ===');
  let newBr = null;
  if (/cancel/i.test(String(afterCancel.status))) {
    // may still be in progress with hotel — try finalize; if 409, poll and retry
    let last = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const fresh = await prepareNewStay(40 + attempt);
      last = await hotel.finalizeBooking({
        ...fresh.finalizeBase,
        reschedulingReferenceId: original.br,
      });
      const code = errCode(last);
      console.log('reschedule attempt', attempt + 1, last.status, code);
      if (ok(last) && (last.data?.bookingRefId || last.data?.bookingReferenceId)) {
        newBr = last.data.bookingRefId || last.data.bookingReferenceId;
        break;
      }
      if (code === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') {
        await sleep(10000);
        continue;
      }
      // other errors — stop
      break;
    }
    record('R6', 'finalize reschedule happy path', {
      passed: Boolean(newBr),
      http: last?.status,
      code: errCode(last),
      newBr,
      originalBr: original.br,
      snippet: brief(last?.data, 450),
    });

    if (newBr) {
      const w = await waitStatus(newBr, (s) => isTerminalHotelStatus(s), 40);
      record('R7', 'rescheduled hotel reaches Confirmed', {
        passed: /confirm/i.test(String(w.status)),
        newBr,
        status: w.status,
      });

      // reuse reference
      const fresh2 = await prepareNewStay(50);
      const reuse = await hotel.finalizeBooking({
        ...fresh2.finalizeBase,
        reschedulingReferenceId: original.br,
      });
      record('R8', 'reuse reschedulingReferenceId → ALREADY_USED', {
        passed: reuse.status === 409 && errCode(reuse) === 'RESCHEDULING_REFERENCE_ALREADY_USED',
        http: reuse.status,
        code: errCode(reuse),
        snippet: brief(reuse.data, 400),
      });
    }
  } else {
    record('R6', 'finalize reschedule happy path', {
      passed: false,
      message: 'Skipped — cancel did not reach Cancelled',
      status: afterCancel.status,
    });
  }

  const summary = {
    baseUrl: config.baseUrl,
    original: { br: original.br, status: original.status, afterCancel: afterCancel.status },
    reschedule: { newBr },
    totals: {
      total: cases.length,
      passed: cases.filter((c) => c.passed === true).length,
      failed: cases.filter((c) => c.passed === false).length,
    },
    cases,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log('Failed:', cases.filter((c) => c.passed === false).map((c) => `${c.id} ${c.title}`));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
