/**
 * Re-verify hotel cancel/reschedule bugs after backend fix.
 * Run: node scripts/probe-hotel-bugs-reverify.js
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

const OUT = path.join('reports', 'hotel-bugs-reverify-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 450) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
function errCode(res) {
  return res?.data?.error?.code || null;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);
  const results = [];

  const add = (id, title, extra = {}) => {
    const row = { id, title, ...extra, at: new Date().toISOString() };
    results.push(row);
    const mark = row.passed === true ? 'PASS' : row.passed === false ? 'FAIL' : 'INFO';
    console.log(`\n[${mark}] ${id} ${title}`);
    if (row.http != null) console.log(' HTTP', row.http, row.code || '');
    if (row.snippet) console.log(' ', String(row.snippet).slice(0, 320));
  };

  async function waitStatus(br, pred, maxAttempts = 40) {
    let last;
    for (let i = 0; i < maxAttempts; i += 1) {
      last = await hotel.getBookingStatus(br);
      const st = String(last.data?.status || '');
      if (ok(last) && pred(st, last.data)) return { status: st, response: last };
      await sleep(4000);
    }
    return { status: last?.data?.status, response: last, timedOut: true };
  }

  async function prepareStay(checkinDays) {
    const entityIds = [config.hotel.defaultEntityId, '2869073', '25921'];
    for (const entityId of entityIds) {
      const searchBody = buildSearchBody({
        entityId,
        checkinDays,
        nights: 2,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      const search = await hotel.search(searchBody);
      if (!ok(search)) continue;
      const details = await hotel.getDetails(searchBody);
      if (!ok(details)) continue;
      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      let codes = extractBookingCodes(details.data);
      const test = codes.filter((c) => String(c).includes('rh-test'));
      if (test.length) codes = [...test, ...codes.filter((c) => !String(c).includes('rh-test'))];
      if (!requestId || !codes.length) continue;
      for (const bookingCode of codes.slice(0, 8)) {
        const prebook = await hotel.prebook({ bookingCode, requestId });
        if (!isPrebookSuccess(prebook)) continue;
        const bookingContext = extractBookingContext(prebook.data);
        return {
          searchBody,
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
    }
    throw new Error(`prepareStay failed days=${checkinDays}`);
  }

  async function bookConfirmed() {
    const days = config.hotel.checkinDayCandidates?.length
      ? config.hotel.checkinDayCandidates
      : [14, 21, 28, 35, 42];
    for (const d of days) {
      try {
        const stay = await prepareStay(d);
        const finalize = await hotel.finalizeBooking(stay.finalizeBase);
        const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
        if (!ok(finalize) || !br) continue;
        const w = await waitStatus(br, (s) => isTerminalHotelStatus(s));
        if (/confirm/i.test(String(w.status))) return { br, status: w.status };
        console.log('non-confirmed', br, w.status);
      } catch (e) {
        console.log('book try', d, e.message);
      }
    }
    throw new Error('Could not book confirmed hotel');
  }

  const cancelPostV1 = (br) => client.request({
    method: 'POST',
    path: `/v1/hotels/bookings/${br}/cancel`,
    query: HOTEL_QUERY,
    body: {},
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const cancelPostApi = (br) => client.request({
    method: 'POST',
    path: '/api/hotels/cancelBooking',
    query: HOTEL_QUERY,
    body: { bookingId: br },
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // --- previously failing validations ---
  {
    const stay = await prepareStay(30);
    const empty = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: '' });
    add('B1', 'empty reschedulingReferenceId → VALIDATION_ERROR', {
      passed: empty.status === 400 && errCode(empty) === 'VALIDATION_ERROR',
      http: empty.status,
      code: errCode(empty),
      snippet: brief(empty.data),
    });
  }
  {
    const stay = await prepareStay(31);
    const long = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: 'B'.repeat(101) });
    add('B2', '>100 char reschedulingReferenceId → VALIDATION_ERROR', {
      passed: long.status === 400 && errCode(long) === 'VALIDATION_ERROR',
      http: long.status,
      code: errCode(long),
      snippet: brief(long.data),
    });
  }
  {
    const stay = await prepareStay(32);
    const num = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: 12345 });
    add('B3', 'number reschedulingReferenceId → VALIDATION_ERROR', {
      passed: num.status === 400 && errCode(num) === 'VALIDATION_ERROR',
      http: num.status,
      code: errCode(num),
      snippet: brief(num.data),
    });
  }

  // cancel unknown
  {
    const res = await hotel.cancelBooking('BR0000000000000000');
    add('B4', 'GET cancel unknown → BOOKING_NOT_FOUND', {
      passed: res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data),
    });
  }
  {
    const res = await cancelPostApi('BR0000000000000000');
    add('B5', 'POST /api cancel unknown → BOOKING_NOT_FOUND', {
      passed: res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data),
    });
  }
  {
    const res = await cancelPostApi(null);
    // body { bookingId: null } — also try missing
  }
  {
    const res = await client.request({
      method: 'POST',
      path: '/api/hotels/cancelBooking',
      query: HOTEL_QUERY,
      body: {},
      correlation: true,
      partnerKey: client.partnerKey,
    });
    add('B6', 'POST /api cancel missing bookingId → VALIDATION_ERROR', {
      passed: res.status === 400 && errCode(res) === 'VALIDATION_ERROR',
      http: res.status,
      code: errCode(res),
      snippet: brief(res.data),
    });
  }

  console.log('\n=== BOOK + CANCEL MATRIX ===');
  const original = await bookConfirmed();
  add('B0', 'Book confirmed hotel', {
    passed: true,
    br: original.br,
    status: original.status,
  });

  const firstCancel = await cancelPostV1(original.br);
  add('B7', 'POST cancel confirmed', {
    passed: ok(firstCancel) || firstCancel.data?.status === 0,
    http: firstCancel.status,
    code: errCode(firstCancel),
    snippet: brief(firstCancel.data),
  });
  await waitStatus(original.br, (s) => /cancel/i.test(s), 20);

  const secondSame = await cancelPostV1(original.br);
  add('B8', '2nd POST same path → BOOKING_ALREADY_CANCELLED?', {
    expected: 'HTTP 400 + BOOKING_ALREADY_CANCELLED',
    passed: secondSame.status === 400 && errCode(secondSame) === 'BOOKING_ALREADY_CANCELLED',
    http: secondSame.status,
    code: errCode(secondSame),
    duplicate: secondSame.data?.duplicate,
    snippet: brief(secondSame.data),
  });

  const getAfter = await hotel.cancelBooking(original.br);
  add('B9', 'GET after POST cancel → BOOKING_ALREADY_CANCELLED?', {
    expected: 'HTTP 400 + BOOKING_ALREADY_CANCELLED',
    passed: getAfter.status === 400 && errCode(getAfter) === 'BOOKING_ALREADY_CANCELLED',
    http: getAfter.status,
    code: errCode(getAfter),
    snippet: brief(getAfter.data),
  });

  const apiAfter = await cancelPostApi(original.br);
  add('B10', 'POST /api after POST cancel → BOOKING_ALREADY_CANCELLED?', {
    expected: 'HTTP 400 + BOOKING_ALREADY_CANCELLED',
    passed: apiAfter.status === 400 && errCode(apiAfter) === 'BOOKING_ALREADY_CANCELLED',
    http: apiAfter.status,
    code: errCode(apiAfter),
    snippet: brief(apiAfter.data),
  });

  // Pending cancel
  console.log('\n=== PENDING CANCEL ===');
  {
    const stay = await prepareStay(48);
    const fin = await hotel.finalizeBooking(stay.finalizeBase);
    const pbr = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    if (pbr) {
      const res = await cancelPostV1(pbr);
      add('B11', 'cancel while Pending → BOOKING_NOT_CANCELLABLE', {
        passed: res.status === 400 && errCode(res) === 'BOOKING_NOT_CANCELLABLE',
        http: res.status,
        code: errCode(res),
        snippet: brief(res.data),
        pendingBr: pbr,
      });
      const w = await waitStatus(pbr, (s) => isTerminalHotelStatus(s), 30);
      if (/confirm/i.test(String(w.status))) await hotel.cancelBooking(pbr);
    }
  }

  // Happy reschedule
  console.log('\n=== RESCHEDULE ===');
  let newBr = null;
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      const stay = await prepareStay(50 + i);
      last = await hotel.finalizeBooking({
        ...stay.finalizeBase,
        reschedulingReferenceId: original.br,
      });
      console.log('attempt', i + 1, last.status, errCode(last));
      newBr = last.data?.bookingRefId || last.data?.bookingReferenceId;
      if (ok(last) && newBr) break;
      if (errCode(last) === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') {
        await sleep(8000);
        continue;
      }
      break;
    } catch (e) {
      console.log('prepare fail', e.message);
    }
  }
  add('B12', 'reschedule happy path', {
    passed: Boolean(newBr),
    http: last?.status,
    code: errCode(last),
    newBr,
    originalBr: original.br,
    snippet: brief(last?.data),
  });

  const summary = {
    baseUrl: config.baseUrl,
    original: original.br,
    newBr,
    totals: {
      total: results.length,
      passed: results.filter((r) => r.passed === true).length,
      failed: results.filter((r) => r.passed === false).length,
    },
    failed: results.filter((r) => r.passed === false),
    results,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log('Still FAIL:', summary.failed.map((f) => `${f.id} ${f.title} => ${f.http} ${f.code}`));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
