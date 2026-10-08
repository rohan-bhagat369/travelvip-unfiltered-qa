/**
 * Full hotel cancel + reschedule validation matrix vs docs.
 * Run: node scripts/probe-hotel-doc-validation-matrix.js
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

const OUT = path.join('reports', 'hotel-doc-validation-matrix-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 500) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
function errCode(res) {
  return res?.data?.error?.code || null;
}
function hasEnvelope(res) {
  return Boolean(res?.data?.error?.code && res?.data?.error?.message != null);
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);
  const rows = [];

  const add = (area, code, expectedHttp, status, note, evidence = {}) => {
    const row = {
      area, code, expectedHttp, status, note, ...evidence, at: new Date().toISOString(),
    };
    rows.push(row);
    console.log(`[${status}] ${area} ${code} — ${note}`);
    if (evidence.snippet) console.log(' ', String(evidence.snippet).slice(0, 280));
  };

  async function waitStatus(br, pred, maxAttempts = 36) {
    let last;
    for (let i = 0; i < maxAttempts; i += 1) {
      last = await hotel.getBookingStatus(br);
      const st = String(last.data?.status || '');
      if (ok(last) && pred(st)) return { status: st, response: last };
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
    const days = [14, 21, 28, 35, 42];
    for (const d of days) {
      try {
        const stay = await prepareStay(d);
        const finalize = await hotel.finalizeBooking(stay.finalizeBase);
        const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
        if (!ok(finalize) || !br) continue;
        const w = await waitStatus(br, (s) => isTerminalHotelStatus(s));
        if (/confirm/i.test(String(w.status))) return { br, status: w.status };
      } catch (e) {
        console.log('book try', d, e.message);
      }
    }
    throw new Error('book confirmed failed');
  }

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

  // Use unique unknown id to avoid duplicate cache from prior runs
  const unknownBr = `BR9${Date.now().toString().slice(-15)}`;

  // ========== CANCELLATION ==========
  console.log('\n=== CANCELLATION ===');

  // VALIDATION_ERROR — missing bookingId
  {
    const res = await cancelPostApi({});
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR' && hasEnvelope(res);
    add('Cancellation', 'VALIDATION_ERROR', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'missing bookingId OK' : 'missing bookingId mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // BOOKING_NOT_FOUND
  {
    const res = await cancelPostV1(unknownBr);
    const pass = res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND' && hasEnvelope(res);
    add('Cancellation', 'BOOKING_NOT_FOUND', 404, pass ? 'PASS' : 'FAIL',
      pass ? 'unknown BR OK' : 'unknown BR mismatch',
      { http: res.status, actualCode: errCode(res), bookingId: unknownBr, snippet: brief(res.data) });
  }

  // BOOKING_PARTNER_MISMATCH
  add('Cancellation', 'BOOKING_PARTNER_MISMATCH', 403, 'NOT_TESTED',
    'Needs another partner credentials to cancel a booking owned by different partner');

  // HOTEL_BOOKING_ITEM_NOT_FOUND
  add('Cancellation', 'HOTEL_BOOKING_ITEM_NOT_FOUND', 400, 'NOT_TESTED',
    'Needs a booking with no hotel item (e.g. non-hotel BR on cancel hotel API)');

  // BOOKING_NOT_CANCELLABLE — Pending
  let pendingBr = null;
  {
    const stay = await prepareStay(40);
    const fin = await hotel.finalizeBooking(stay.finalizeBase);
    pendingBr = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    if (pendingBr) {
      const res = await cancelPostV1(pendingBr);
      const pass = res.status === 400 && errCode(res) === 'BOOKING_NOT_CANCELLABLE'
        && hasEnvelope(res) && res.data?.error?.currentStatus;
      add('Cancellation', 'BOOKING_NOT_CANCELLABLE', 400, pass ? 'PASS' : 'FAIL',
        pass ? 'Pending cancel OK' : 'Pending cancel mismatch',
        {
          http: res.status,
          actualCode: errCode(res),
          currentStatus: res.data?.error?.currentStatus,
          bookingId: pendingBr,
          snippet: brief(res.data),
        });
      const w = await waitStatus(pendingBr, (s) => isTerminalHotelStatus(s), 30);
      if (/confirm/i.test(String(w.status))) {
        // will cancel later or use for other tests
      }
    } else {
      add('Cancellation', 'BOOKING_NOT_CANCELLABLE', 400, 'NOT_TESTED', 'Could not create Pending booking');
    }
  }

  // HOTEL_DETAILS_NOT_FOUND
  add('Cancellation', 'HOTEL_DETAILS_NOT_FOUND', 404, 'NOT_TESTED',
    'Needs booking missing booking_item_hotel row');

  // Book confirmed for already-cancelled tests
  console.log('\n=== BOOK CONFIRMED FOR CANCEL ===');
  const original = await bookConfirmed();
  console.log('Confirmed', original.br);

  // First cancel success
  const cancel1 = await cancelPostV1(original.br);
  const cancelOk = ok(cancel1) || cancel1.data?.status === 0;
  add('Cancellation', 'SUCCESS_CANCEL', 200, cancelOk ? 'PASS' : 'FAIL',
    cancelOk ? 'Confirmed cancel works' : 'Confirmed cancel failed',
    { http: cancel1.status, bookingId: original.br, snippet: brief(cancel1.data) });
  await waitStatus(original.br, (s) => /cancel/i.test(s), 20);

  // BOOKING_ALREADY_CANCELLED — same path 2nd call
  {
    const res = await cancelPostV1(original.br);
    const pass = res.status === 400 && errCode(res) === 'BOOKING_ALREADY_CANCELLED' && hasEnvelope(res);
    add('Cancellation', 'BOOKING_ALREADY_CANCELLED', 400, pass ? 'PASS' : 'FAIL',
      pass
        ? '2nd same-path cancel OK'
        : `Expected BOOKING_ALREADY_CANCELLED; got HTTP ${res.status} code=${errCode(res)} duplicate=${res.data?.duplicate}`,
      {
        http: res.status,
        actualCode: errCode(res),
        duplicate: res.data?.duplicate,
        refundStatus: res.data?.error?.refundStatus,
        snippet: brief(res.data),
      });
  }

  // Already cancelled other path — should also be BOOKING_ALREADY_CANCELLED per docs
  {
    const res = await cancelPostApi({ bookingId: original.br });
    const pass = res.status === 400 && errCode(res) === 'BOOKING_ALREADY_CANCELLED' && hasEnvelope(res);
    add('Cancellation', 'BOOKING_ALREADY_CANCELLED (other path)', 400, pass ? 'PASS' : 'FAIL',
      pass
        ? 'other-path already cancelled OK'
        : `Expected BOOKING_ALREADY_CANCELLED; got HTTP ${res.status} code=${errCode(res)}`,
      {
        http: res.status,
        actualCode: errCode(res),
        currentStatus: res.data?.error?.currentStatus,
        snippet: brief(res.data),
      });
  }

  // ========== RESCHEDULING ==========
  console.log('\n=== RESCHEDULING ===');

  // VALIDATION_ERROR blank
  {
    const stay = await prepareStay(41);
    const res = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: '' });
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR' && hasEnvelope(res);
    add('Rescheduling', 'VALIDATION_ERROR (blank)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'blank OK' : 'blank mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // VALIDATION_ERROR length
  {
    const stay = await prepareStay(42);
    const res = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: 'B'.repeat(101) });
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR' && hasEnvelope(res);
    add('Rescheduling', 'VALIDATION_ERROR (length)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'length OK' : 'length mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // VALIDATION_ERROR not a string
  {
    const stay = await prepareStay(43);
    const res = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: 12345 });
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR' && hasEnvelope(res);
    add('Rescheduling', 'VALIDATION_ERROR (not string)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'non-string OK' : 'non-string mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // RESCHEDULING_BOOKING_NOT_FOUND
  {
    const stay = await prepareStay(44);
    const fake = `BR8${Date.now().toString().slice(-15)}`;
    const res = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: fake });
    const pass = res.status === 404 && errCode(res) === 'RESCHEDULING_BOOKING_NOT_FOUND' && hasEnvelope(res);
    add('Rescheduling', 'RESCHEDULING_BOOKING_NOT_FOUND', 404, pass ? 'PASS' : 'FAIL',
      pass ? 'unknown ref OK' : 'unknown ref mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  add('Rescheduling', 'RESCHEDULING_BOOKING_PARTNER_MISMATCH', 403, 'NOT_TESTED',
    'Needs other partner credentials');

  // RESCHEDULING_BOOKING_NOT_HOTEL — use known flight BR from prior SG test if available
  {
    const stay = await prepareStay(45);
    const flightBr = 'BR1786017237353711';
    const res = await hotel.finalizeBooking({ ...stay.finalizeBase, reschedulingReferenceId: flightBr });
    const pass = res.status === 422 && errCode(res) === 'RESCHEDULING_BOOKING_NOT_HOTEL' && hasEnvelope(res);
    add('Rescheduling', 'RESCHEDULING_BOOKING_NOT_HOTEL', 422, pass ? 'PASS' : 'FAIL',
      pass ? 'flight BR OK' : 'flight BR mismatch',
      { http: res.status, actualCode: errCode(res), flightBr, snippet: brief(res.data) });
  }

  // RESCHEDULING_CANCELLATION_IN_PROGRESS — hard to hit if cancel settles instantly
  add('Rescheduling', 'RESCHEDULING_CANCELLATION_IN_PROGRESS', 409, 'NOT_TESTED',
    'Cancel settles immediately on staging; no open hotel PENDING cancel window observed');

  // RESCHEDULING_NOT_ALLOWED — need Confirmed booking without cancel
  {
    const confirmed2 = await bookConfirmed();
    const stay = await prepareStay(46);
    const res = await hotel.finalizeBooking({
      ...stay.finalizeBase,
      reschedulingReferenceId: confirmed2.br,
    });
    const pass = res.status === 422 && errCode(res) === 'RESCHEDULING_NOT_ALLOWED' && hasEnvelope(res);
    add('Rescheduling', 'RESCHEDULING_NOT_ALLOWED', 422, pass ? 'PASS' : 'FAIL',
      pass ? 'still Confirmed OK' : 'still Confirmed mismatch',
      {
        http: res.status,
        actualCode: errCode(res),
        bookingId: confirmed2.br,
        snippet: brief(res.data),
      });
    // cleanup
    await cancelPostV1(confirmed2.br).catch(() => {});
  }

  add('Rescheduling', 'RESCHEDULING_STAY_COMPLETED', 422, 'NOT_TESTED',
    'Needs cancelled hotel whose checkin is in the past');

  // Happy path + ALREADY_USED using original cancelled BR
  let newBr = null;
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      const stay = await prepareStay(50 + i);
      last = await hotel.finalizeBooking({
        ...stay.finalizeBase,
        reschedulingReferenceId: original.br,
      });
      console.log('reschedule', i + 1, last.status, errCode(last));
      newBr = last.data?.bookingRefId || last.data?.bookingReferenceId;
      if (ok(last) && newBr) break;
      if (errCode(last) === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') {
        add('Rescheduling', 'RESCHEDULING_CANCELLATION_IN_PROGRESS', 409, 'PASS',
          'Observed during happy-path wait',
          { http: last.status, actualCode: errCode(last), snippet: brief(last.data) });
        await sleep(8000);
        continue;
      }
      break;
    } catch (e) {
      console.log('prepare', e.message);
    }
  }
  add('Rescheduling', 'HAPPY_PATH', 200, newBr ? 'PASS' : 'FAIL',
    newBr ? `reschedule OK → ${newBr}` : 'reschedule failed',
    { http: last?.status, actualCode: errCode(last), newBr, originalBr: original.br, snippet: brief(last?.data) });

  if (newBr) {
    const stay = await prepareStay(60);
    const res = await hotel.finalizeBooking({
      ...stay.finalizeBase,
      reschedulingReferenceId: original.br,
    });
    const pass = res.status === 409 && errCode(res) === 'RESCHEDULING_REFERENCE_ALREADY_USED' && hasEnvelope(res);
    add('Rescheduling', 'RESCHEDULING_REFERENCE_ALREADY_USED', 409, pass ? 'PASS' : 'FAIL',
      pass ? 'reuse OK' : 'reuse mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  } else {
    add('Rescheduling', 'RESCHEDULING_REFERENCE_ALREADY_USED', 409, 'NOT_TESTED',
      'Skipped — happy path failed');
  }

  // Note doc route: POST /api/v2/hotels/finalize-booking — we use /v1/hotels/finalize-booking
  {
    const stay = await prepareStay(61);
    const res = await client.request({
      method: 'POST',
      path: '/api/v2/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body: { ...stay.finalizeBase, reschedulingReferenceId: original.br },
      correlation: true,
      partnerKey: client.partnerKey,
    });
    add('Rescheduling', 'DOC_ROUTE /api/v2/hotels/finalize-booking', null,
      (ok(res) || res.status < 500) ? 'INFO' : 'FAIL',
      `Doc lists /api/v2/...; automation uses /v1/hotels/finalize-booking. Probe HTTP ${res.status}`,
      { http: res.status, snippet: brief(res.data, 250) });
  }

  const summary = {
    baseUrl: config.baseUrl,
    original: original.br,
    newBr,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      FAIL: rows.filter((r) => r.status === 'FAIL').length,
      NOT_TESTED: rows.filter((r) => r.status === 'NOT_TESTED').length,
      INFO: rows.filter((r) => r.status === 'INFO').length,
    },
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log('FAIL:', rows.filter((r) => r.status === 'FAIL').map((r) => `${r.code}: ${r.note}`));
  console.log('NOT_TESTED:', rows.filter((r) => r.status === 'NOT_TESTED').map((r) => r.code));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
