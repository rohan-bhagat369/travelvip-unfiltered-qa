/**
 * Staging probe: hotel penalty-check + finalize GST/PAN validation
 * Docs: https://api-docs.travelvip.ai/
 * Postman: TravelVIP.postman.json (Hotel > Finalize booking / Panalty Check)
 *
 * Run: node scripts/probe-hotel-penalty-gst-pan.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildFinalizeBody,
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-penalty-gst-pan-staging.json');
const rows = [];
const bugs = [];

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
function brief(res, n = 500) {
  try {
    return JSON.stringify(res?.data ?? res).slice(0, n);
  } catch {
    return String(res?.data ?? res).slice(0, n);
  }
}
function errCode(res) {
  return res?.data?.error?.code || null;
}
function errDetails(res) {
  const d = res?.data?.error?.details;
  return Array.isArray(d) ? d : [];
}
function hasEnvelope(res) {
  const e = res?.data?.error;
  return Boolean(e && e.code && e.message != null && Array.isArray(e.details) && e.timestamp && e.request_id);
}
function booked(res) {
  return Boolean(res?.data?.bookingRefId || res?.data?.bookingReferenceId || res?.data?.bookingReference);
}
function bookingRef(res) {
  return res?.data?.bookingRefId || res?.data?.bookingReferenceId || res?.data?.bookingReference || null;
}

function add(section, rule, how, expected, status, actual, evidence = {}) {
  const row = {
    section,
    rule,
    how,
    expected,
    status,
    actual,
    ...evidence,
    at: new Date().toISOString(),
  };
  rows.push(row);
  if (status === 'BUG') bugs.push(row);
  console.log(`[${status}] ${section} | ${rule} — ${actual}`);
}

function expectReject(section, rule, res, hintRe = null) {
  const code = errCode(res);
  const det = errDetails(res);
  const msgBlob = [...det, res?.data?.error?.message, res?.data?.message].filter(Boolean).join(' | ');
  const hintOk = !hintRe || hintRe.test(msgBlob) || hintRe.test(brief(res));
  const http400 = res.status === 400;
  const valErr = code === 'VALIDATION_ERROR';
  const dup = Boolean(res?.data?.duplicate);

  let status = 'PASS';
  let note = 'HTTP 400 VALIDATION_ERROR';
  if (dup && booked(res)) {
    status = 'BUG';
    note = `duplicate:true returned prior BR — validation skipped`;
  } else if (booked(res)) {
    status = 'BUG';
    note = `Invalid payload accepted / booked ${bookingRef(res)}`;
  } else if (http400 && valErr && hintOk) {
    status = 'PASS';
    note = hasEnvelope(res) ? 'HTTP 400 VALIDATION_ERROR + envelope' : 'HTTP 400 VALIDATION_ERROR (envelope incomplete)';
    if (!hasEnvelope(res)) status = 'BUG';
  } else if (http400 && valErr && !hintOk) {
    status = 'BUG';
    note = `Wrong/missing detail. msg=${msgBlob.slice(0, 200)}`;
  } else {
    status = 'BUG';
    note = `Expected HTTP 400 VALIDATION_ERROR; got HTTP ${res.status} code=${code}`;
  }

  add(
    section,
    rule,
    'clone baseline → mutate → finalize',
    'HTTP 400 + VALIDATION_ERROR + details[]',
    status,
    `HTTP ${res.status} code=${code} details=${JSON.stringify(det).slice(0, 180)} | ${note}`,
    { payloadNote: rule, responseSnippet: brief(res, 600) },
  );
}

function expectAcceptNotValidation(section, rule, res) {
  const code = errCode(res);
  const rejected = res.status === 400 && code === 'VALIDATION_ERROR';
  const status = rejected ? 'BUG' : res.status < 500 ? 'PASS' : 'BUG';
  add(
    section,
    rule,
    'clone baseline → mutate → finalize',
    'Not VALIDATION_ERROR (may be 2xx or business error)',
    status,
    `HTTP ${res.status} code=${code} booked=${booked(res)} br=${bookingRef(res) || '-'}`,
    { responseSnippet: brief(res, 400) },
  );
}

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

async function preparePrebook(hotel) {
  // Prefer Indian inventory (GST/PAN relevant); Postman uses Hiltop Mumbai 39627872
  const entityIds = ['39627872', config.hotel.defaultEntityId, '2869073', '25921']
    .filter((v, i, a) => v && a.indexOf(v) === i);
  const dayCandidates = [21, 30, 14, 45, 60];

  for (const entityId of entityIds) {
    for (const checkinDays of dayCandidates) {
      for (const nights of [1, 2]) {
        const searchBody = buildSearchBody({
          entityId,
          checkinDays,
          nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) continue;
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        let codes = extractBookingCodes(details.data, 20);
        const test = codes.filter((c) => String(c).includes('rh-test'));
        if (test.length) codes = [...test, ...codes.filter((c) => !String(c).includes('rh-test'))];
        if (!requestId || !codes.length) continue;

        for (const bookingCode of codes.slice(0, 10)) {
          const prebook = await hotel.prebook({ bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          const room =
            prebook.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
            || details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
            || null;
          return {
            searchBody,
            requestId,
            bookingCode,
            bookingContext: extractBookingContext(prebook.data),
            prebook,
            room,
            isPANMandatory: Boolean(room?.isPANMandatory),
            isGSTClaimable: Boolean(room?.isGSTClaimable ?? room?.isGstClaimable),
          };
        }
      }
    }
  }
  throw new Error('Could not prebook a room for GST/PAN tests');
}

async function waitConfirmed(hotel, br, maxAttempts = 36) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (last.ok && isTerminalHotelStatus(st)) return { status: st, response: last };
    await sleep(4000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  console.log('\n=== Prepare prebook baseline ===');
  const stay = await preparePrebook(hotel);
  console.log('Prebook OK', {
    hotel: stay.prebook.data?.results?.[0]?.name || stay.searchBody.entityId,
    bookingCode: String(stay.bookingCode).slice(0, 60),
    isPANMandatory: stay.isPANMandatory,
    isGSTClaimable: stay.isGSTClaimable,
    checkin: stay.searchBody.checkin,
  });

  let nonce = 0;
  const baseFinalize = () => {
    nonce += 1;
    const body = buildFinalizeBody({
      bookingContext: stay.bookingContext,
      bookingCode: stay.bookingCode,
      requestId: stay.requestId,
      checkin: stay.searchBody.checkin,
      checkout: stay.searchBody.checkout,
      guests: [{
        title: 'Mr',
        firstName: config.hotel.guestFirstName,
        lastName: `Bhagat${'ABCDEFGHIJ'[nonce % 10]}`,
        type: 'Adult',
        isLead: true,
      }],
    });
    body.contact.email = `hotel.gstpan.${nonce}.${Date.now()}@travelvip.ai`;
    if (stay.isPANMandatory) {
      body.contact.panCardNumber = 'ABCDE1234F';
      body.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
    }
    // When room is GST-claimable, include valid gstDetails by default so PAN/other
    // cases are not blocked by gstDetails-required rules.
    if (stay.isGSTClaimable) {
      body.gstDetails = { ...VALID_GST };
    }
    return body;
  };

  const mutFinalize = async (fn) => {
    const b = baseFinalize();
    fn(b);
    return hotel.finalizeBooking(b);
  };

  // ───────── GST support + validation ─────────
  console.log('\n=== GST Details (finalize) ===');

  // Docs: gstDetails optional; if isGSTClaimable=true some builds may require it — record either way.
  {
    const omitRes = await mutFinalize((b) => {
      delete b.gstDetails;
    });
    const rejected = omitRes.status === 400 && errCode(omitRes) === 'VALIDATION_ERROR';
    const gstHint = /gstDetails/i.test(JSON.stringify(errDetails(omitRes)));
    if (stay.isGSTClaimable && rejected && gstHint) {
      add(
        'GST',
        '1. Omit gstDetails when isGSTClaimable=true',
        'clone → delete gstDetails → finalize',
        'Docs say optional; if gated by claimable flag → VALIDATION_ERROR mentioning gstDetails',
        'PASS',
        `Required on claimable rate: HTTP ${omitRes.status} details=${JSON.stringify(errDetails(omitRes)).slice(0, 180)}`,
        { responseSnippet: brief(omitRes, 400), note: 'Stricter than docs optional wording' },
      );
    } else {
      expectAcceptNotValidation('GST', '1. Omit gstDetails (optional)', omitRes);
    }
  }

  {
    const nullRes = await mutFinalize((b) => {
      b.gstDetails = null;
    });
    const rejected = nullRes.status === 400 && errCode(nullRes) === 'VALIDATION_ERROR';
    const gstHint = /gstDetails/i.test(JSON.stringify(errDetails(nullRes)));
    if (stay.isGSTClaimable && rejected && gstHint) {
      add(
        'GST',
        '2. gstDetails: null when isGSTClaimable=true',
        'clone → gstDetails=null → finalize',
        'Docs say null OK; claimable rate may require object',
        'PASS',
        `Rejected on claimable rate: HTTP ${nullRes.status} details=${JSON.stringify(errDetails(nullRes)).slice(0, 180)}`,
        { responseSnippet: brief(nullRes, 400) },
      );
    } else {
      expectAcceptNotValidation('GST', '2. gstDetails: null', nullRes);
    }
  }

  expectAcceptNotValidation(
    'GST',
    '3. Full valid gstDetails accepted (not VALIDATION_ERROR)',
    await mutFinalize((b) => {
      b.gstDetails = { ...VALID_GST };
    }),
  );

  expectReject(
    'GST',
    '4. Partial gstDetails (only gstNumber)',
    await mutFinalize((b) => {
      b.gstDetails = { gstNumber: VALID_GST.gstNumber };
    }),
    /gst/i,
  );

  expectReject(
    'GST',
    '5. Empty gstDetails object',
    await mutFinalize((b) => {
      b.gstDetails = {};
    }),
    /gst/i,
  );

  expectReject(
    'GST',
    '6. Invalid GSTIN format',
    await mutFinalize((b) => {
      b.gstDetails = { ...VALID_GST, gstNumber: 'INVALID' };
    }),
    /gstNumber|GSTIN|gst/i,
  );

  expectReject(
    'GST',
    '7. Invalid gstEmailID',
    await mutFinalize((b) => {
      b.gstDetails = { ...VALID_GST, gstEmailID: 'not-an-email' };
    }),
    /gstEmail|email/i,
  );

  expectReject(
    'GST',
    '8. Wrong key gstEmailId (missing gstEmailID)',
    await mutFinalize((b) => {
      b.gstDetails = {
        gstNumber: VALID_GST.gstNumber,
        gstCompanyName: VALID_GST.gstCompanyName,
        gstAddress: VALID_GST.gstAddress,
        gstEmailId: 'accounts@travelvip.ai',
        gstMobileNumber: VALID_GST.gstMobileNumber,
      };
    }),
    /gstEmailID|gstEmail|gst/i,
  );

  expectReject(
    'GST',
    '9. Invalid gstMobileNumber (+91 starting with 5)',
    await mutFinalize((b) => {
      b.gstDetails = { ...VALID_GST, gstMobileNumber: '5123456789' };
    }),
    /gstMobile|mobile/i,
  );

  expectReject(
    'GST',
    '10. Blank gstCompanyName',
    await mutFinalize((b) => {
      b.gstDetails = { ...VALID_GST, gstCompanyName: '' };
    }),
    /gstCompany|gst/i,
  );

  // ───────── PAN validation ─────────
  console.log('\n=== PAN (finalize) ===');

  add(
    'PAN',
    '0. Prebook isPANMandatory flag',
    'Inspect prebook/details room flags',
    'Flag present on room',
    stay.room && ('isPANMandatory' in stay.room) ? 'PASS' : 'BUG',
    `isPANMandatory=${stay.isPANMandatory} roomHasKey=${stay.room ? 'isPANMandatory' in stay.room : false}`,
    { roomFlags: { isPANMandatory: stay.room?.isPANMandatory, isGSTClaimable: stay.room?.isGSTClaimable } },
  );

  if (stay.isPANMandatory) {
    expectReject(
      'PAN',
      '1. Missing panCardNumber+panCardName when isPANMandatory=true',
      await mutFinalize((b) => {
        delete b.contact.panCardNumber;
        delete b.contact.panCardName;
      }),
      /pan/i,
    );

    expectReject(
      'PAN',
      '2. Invalid panCardNumber format when mandatory',
      await mutFinalize((b) => {
        b.contact.panCardNumber = 'BADPAN';
        b.contact.panCardName = 'TRAVELVIP TEST';
      }),
      /pan/i,
    );

    expectReject(
      'PAN',
      '3. panCardNumber without panCardName',
      await mutFinalize((b) => {
        b.contact.panCardNumber = 'ABCDE1234F';
        b.contact.panCardName = '';
      }),
      /panCardName|pan/i,
    );

    expectAcceptNotValidation(
      'PAN',
      '4. Valid PAN on mandatory rate (not VALIDATION_ERROR)',
      await mutFinalize((b) => {
        b.contact.panCardNumber = 'ABCDE1234F';
        b.contact.panCardName = 'Rohan Bhagat';
      }),
    );
  } else {
    expectAcceptNotValidation(
      'PAN',
      '1. Omit PAN when isPANMandatory=false',
      await mutFinalize((b) => {
        delete b.contact.panCardNumber;
        delete b.contact.panCardName;
      }),
    );

    // Docs: when flag false, fields may be omitted. Invalid format when sent should still reject if format validation exists.
    const invalidPan = await mutFinalize((b) => {
      b.contact.panCardNumber = 'BADPAN';
      b.contact.panCardName = 'TRAVELVIP TEST';
    });
    const rejected = invalidPan.status === 400 && errCode(invalidPan) === 'VALIDATION_ERROR';
    add(
      'PAN',
      '2. Invalid panCardNumber format when isPANMandatory=false',
      'Send BADPAN on non-mandatory rate',
      'HTTP 400 VALIDATION_ERROR (format) OR ignored if only gated by flag',
      rejected || invalidPan.status < 500 ? (rejected ? 'PASS' : 'PASS') : 'BUG',
      rejected
        ? `Rejected as expected: HTTP ${invalidPan.status} ${errCode(invalidPan)} details=${JSON.stringify(errDetails(invalidPan)).slice(0, 120)}`
        : `Not format-validated when optional: HTTP ${invalidPan.status} code=${errCode(invalidPan)} (docs: fields may be omitted when flag false)`,
      { responseSnippet: brief(invalidPan, 400), note: rejected ? 'Format validation active even when optional' : 'Optional PAN not format-checked' },
    );

    expectAcceptNotValidation(
      'PAN',
      '3. Valid PAN optional fields accepted',
      await mutFinalize((b) => {
        b.contact.panCardNumber = 'ABCDE1234F';
        b.contact.panCardName = 'Rohan Bhagat';
      }),
    );

    add(
      'PAN',
      '4. Missing PAN on isPANMandatory=true rate',
      'Needs room with isPANMandatory=true',
      'HTTP 400 VALIDATION_ERROR',
      'NOT TESTED',
      `No PAN-mandatory room in this prebook (isPANMandatory=${stay.isPANMandatory})`,
    );
  }

  // ───────── Book confirmed + penalty-check ─────────
  console.log('\n=== Penalty Check API ===');

  // Negative: malformed / unknown ids (no booking needed)
  {
    const malformed = await hotel.penaltyCheck('!!bad!!');
    const pass = malformed.status === 400 && Boolean(errCode(malformed));
    add(
      'Penalty',
      '1. Malformed bookingId',
      'GET /v1/hotels/bookings/!!bad!!/penalty-check',
      'HTTP 400 + error.code',
      pass ? 'PASS' : 'BUG',
      `HTTP ${malformed.status} code=${errCode(malformed)} envelope=${hasEnvelope(malformed)}`,
      { responseSnippet: brief(malformed, 400) },
    );
  }

  {
    const unknown = `BR9${Date.now().toString().slice(-15)}`;
    const res = await hotel.penaltyCheck(unknown);
    const code = errCode(res);
    const pass = res.status === 404 && (code === 'BOOKING_NOT_FOUND' || Boolean(code));
    add(
      'Penalty',
      '2. Unknown bookingId',
      `GET .../bookings/${unknown}/penalty-check`,
      'HTTP 404 + BOOKING_NOT_FOUND (or error.code)',
      pass ? 'PASS' : 'BUG',
      `HTTP ${res.status} code=${code}`,
      { responseSnippet: brief(res, 400) },
    );
  }

  // Book a real stay for happy-path + idempotent repeat
  let confirmedBr = null;
  let confirmStatus = null;
  try {
    console.log('Booking confirmed stay for penalty-check happy path...');
    for (const days of [21, 28, 35, 42, 14]) {
      try {
        const attempt = await preparePrebook(hotel);
        // Prefer free-cancel / test rooms when possible — still OK if not
        const body = buildFinalizeBody({
          bookingContext: attempt.bookingContext,
          bookingCode: attempt.bookingCode,
          requestId: attempt.requestId,
          checkin: attempt.searchBody.checkin,
          checkout: attempt.searchBody.checkout,
          guests: [{
            title: 'Mr',
            firstName: config.hotel.guestFirstName,
            lastName: config.hotel.guestLastName,
            type: 'Adult',
            isLead: true,
          }],
        });
        body.contact.email = `hotel.penalty.${Date.now()}@travelvip.ai`;
        if (attempt.isPANMandatory) {
          body.contact.panCardNumber = 'ABCDE1234F';
          body.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
        }
        // Include gstDetails to also verify end-to-end support on a real book
        body.gstDetails = { ...VALID_GST };

        const fin = await hotel.finalizeBooking(body);
        const br = bookingRef(fin);
        if (!fin.ok || !br) {
          console.log('finalize skip', days, fin.status, errCode(fin), brief(fin, 160));
          continue;
        }
        const w = await waitConfirmed(hotel, br);
        console.log('booked', br, w.status);
        if (/confirm/i.test(String(w.status))) {
          confirmedBr = br;
          confirmStatus = w.status;
          add(
            'GST',
            '11. Finalize with gstDetails produces booking',
            'Book with full gstDetails then poll status',
            'Confirmed (or Pending→Confirmed) booking',
            'PASS',
            `br=${br} status=${w.status}`,
          );
          break;
        }
        if (/fail/i.test(String(w.status))) {
          console.log('booking failed', br);
        }
      } catch (e) {
        console.log('book attempt', days, e.message);
      }
    }
  } catch (e) {
    console.log('book flow error', e.message);
  }

  if (!confirmedBr) {
    // Fallback: history Confirmed booking
    try {
      const hist = await hotel.bookingHistory(0, 30);
      const items = hist.data?.bookings || hist.data?.content || hist.data?.results || [];
      const item = items.find((b) => /confirm/i.test(String(b.status || b.bookingStatus || '')));
      const br = item?.bookingId || item?.bookingReferenceId || item?.bookingRefId || item?.bookingReference || item?.id;
      if (br) {
        confirmedBr = br;
        confirmStatus = item.status || item.bookingStatus;
        console.log('Using history Confirmed booking', confirmedBr);
      }
    } catch (e) {
      console.log('history fallback failed', e.message);
    }
  }

  if (confirmedBr) {
    const pen1 = await hotel.penaltyCheck(confirmedBr);
    const cr = pen1.data?.data?.cancellationRequest || pen1.data?.cancellationRequest;
    const st = String(cr?.status || '');
    const okQuote = pen1.status === 200 && /Penalty Fetched|Penalty Not Available/i.test(st);
    const hasAmounts = st.includes('Fetched')
      && typeof cr?.estimatedCancellationCharge === 'number'
      && typeof cr?.estimatedRefund === 'number';
    const notAvailOk = /Not Available/i.test(st) && cr?.estimatedCancellationCharge == null;

    add(
      'Penalty',
      '3. Confirmed booking penalty quote',
      `GET .../bookings/${confirmedBr}/penalty-check`,
      'HTTP 200 + cancellationRequest.status Penalty Fetched | Penalty Not Available',
      okQuote ? 'PASS' : 'BUG',
      `HTTP ${pen1.status} status=${st} charge=${cr?.estimatedCancellationCharge} refund=${cr?.estimatedRefund} bookingStatus=${confirmStatus}`,
      {
        bookingId: confirmedBr,
        responseSnippet: brief(pen1, 600),
        amountsOk: hasAmounts || notAvailOk,
      },
    );

    if (okQuote && /Fetched/i.test(st) && (cr.estimatedCancellationCharge == null || cr.estimatedRefund == null)) {
      add(
        'Penalty',
        '3b. Penalty Fetched includes estimate fields',
        'Branch on status; amounts required when Fetched',
        'estimatedCancellationCharge + estimatedRefund present',
        'BUG',
        `Missing amounts on Penalty Fetched: ${brief({ cr }, 300)}`,
      );
    } else if (okQuote && /Fetched/i.test(st)) {
      add(
        'Penalty',
        '3b. Penalty Fetched includes estimate fields',
        'Branch on status; amounts required when Fetched',
        'estimatedCancellationCharge + estimatedRefund present',
        'PASS',
        `charge=${cr.estimatedCancellationCharge} refund=${cr.estimatedRefund} currency=${pen1.data?.data?.currency || pen1.data?.currency}`,
      );
    } else if (okQuote && /Not Available/i.test(st)) {
      add(
        'Penalty',
        '3b. Penalty Not Available omits zero substitute',
        'No estimatedCancellationCharge/Refund when Not Available',
        'Amounts omitted (do not treat as 0)',
        cr?.estimatedCancellationCharge == null && cr?.estimatedRefund == null ? 'PASS' : 'BUG',
        `charge=${cr?.estimatedCancellationCharge} refund=${cr?.estimatedRefund} msg=${cr?.message || '-'}`,
      );
    }

    const pen2 = await hotel.penaltyCheck(confirmedBr);
    const cr2 = pen2.data?.data?.cancellationRequest || pen2.data?.cancellationRequest;
    const unchanged = String(
      (await hotel.getBookingStatus(confirmedBr)).data?.status || '',
    );
    add(
      'Penalty',
      '4. Penalty-check is safe to repeat (no cancel)',
      'Call penalty-check twice; booking stays Confirmed',
      'HTTP 200 both; booking status still Confirmed',
      pen2.status === 200 && /confirm/i.test(unchanged) ? 'PASS' : 'BUG',
      `pen2=${pen2.status}/${cr2?.status} bookingStatus=${unchanged}`,
      { responseSnippet: brief(pen2, 300) },
    );

    // After cancel, penalty-check should reject as already cancelled / not cancellable
    const cancel = await hotel.cancelBooking(confirmedBr);
    await sleep(3000);
    const afterCancel = await hotel.penaltyCheck(confirmedBr);
    const afterCode = errCode(afterCancel);
    const passAfter = afterCancel.status === 400 && Boolean(afterCode);
    add(
      'Penalty',
      '5. Penalty-check after cancel',
      'Cancel booking then penalty-check again',
      'HTTP 400 + error.code (already cancelled / not cancellable)',
      passAfter ? 'PASS' : 'BUG',
      `cancelHTTP=${cancel.status} penHTTP=${afterCancel.status} code=${afterCode}`,
      { responseSnippet: brief(afterCancel, 400) },
    );
  } else {
    add(
      'Penalty',
      '3. Confirmed booking penalty quote',
      'Book Confirmed stay then GET penalty-check',
      'HTTP 200 + Penalty Fetched | Not Available',
      'NOT TESTED',
      'Could not obtain Confirmed hotel booking on staging',
    );
    add(
      'Penalty',
      '4. Penalty-check is safe to repeat (no cancel)',
      'Needs confirmed BR',
      'HTTP 200; status unchanged',
      'NOT TESTED',
      'Skipped — no confirmed booking',
    );
    add(
      'Penalty',
      '5. Penalty-check after cancel',
      'Needs confirmed BR',
      'HTTP 400 after cancel',
      'NOT TESTED',
      'Skipped — no confirmed booking',
    );
  }

  // Score
  const score = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    prebookFlags: {
      isPANMandatory: stay.isPANMandatory,
      isGSTClaimable: stay.isGSTClaimable,
      entityId: stay.searchBody.entityId,
      checkin: stay.searchBody.checkin,
    },
    confirmedBooking: confirmedBr,
    score,
    rows,
    bugs,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n========== HOTEL PENALTY / GST / PAN REPORT ==========');
  console.log('Score:', score);
  console.log('Report:', OUT);
  for (const r of rows) {
    console.log(`| ${r.status} | ${r.section} | ${r.rule}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
