/**
 * Sigma retest of two known validation bugs:
 * 1) Lounge — missing bookingContext returns Duplicate instead of validation
 * 2) Hotel — guest firstName "Test123" creates booking instead of validation
 *
 *   BASE_URL=https://sigma-api.travelvip.ai node scripts/probe-sigma-lounge-hotel-validation-bugs.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../../../travel-apis/hotel/src/service.js';
import { config } from '../../../shared/config/env.js';

const Q = { lang: 'en', currency: 'INR' };

function ok(res) {
  return res?.ok || (res?.status >= 200 && res?.status < 300);
}

function brOf(data) {
  return (
    data?.bookingRefId
    || data?.bookingReferenceId
    || data?.bookingReference
    || data?.bookingId
    || data?.data?.bookingRefId
    || data?.data?.bookingReferenceId
    || null
  );
}

function textOf(data) {
  return JSON.stringify(data || {}).toLowerCase();
}

function isDup(data) {
  const t = textOf(data);
  return (
    data?.duplicate === true
    || t.includes('duplicate payload')
    || t.includes('previously processed')
    || t.includes('duplicate request')
  );
}

function isValidation(data, status) {
  const t = textOf(data);
  return (
    status === 400
    || status === 422
    || t.includes('validation')
    || t.includes('invalid')
    || t.includes('required')
    || data?.error?.code === 'VALIDATION_ERROR'
  );
}

function findFirstStringByKey(obj, re, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && typeof v === 'string' && v.length > 5) return v;
    if (v && typeof v === 'object') {
      const found = findFirstStringByKey(v, re, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function loungeBuild(client) {
  const airportSearch = await client.request({
    method: 'GET',
    path: '/v1/airports/search',
    query: { ...Q, page: 0, perpage: 20, q: 'bom' },
    correlation: true,
  });
  const airports = airportSearch.data?.results || [];
  for (const a of airports) {
    const airportId = a?.airportId || a?.id;
    for (const terminal of ['Terminal 1', 'Terminal 2', 'Terminal 3']) {
      const list = await client.request({
        method: 'GET',
        path: '/v1/lounges',
        query: { ...Q, page: 0, perpage: 5, airportId, terminal },
        correlation: true,
      });
      const lounge = (list.data?.results || [])[0];
      if (!lounge?.productId) continue;
      const optionId = lounge.availableOptions?.[0]?.optionId || lounge.options?.[0]?.optionId;
      if (!optionId) continue;
      const detail = await client.request({
        method: 'GET',
        path: `/v1/lounges/${lounge.productId}`,
        query: { ...Q, optionId },
        correlation: true,
      });
      const bookingContext =
        findFirstStringByKey(detail.data, /bookingcontext/i)
        || findFirstStringByKey(detail.data, /bookingreference/i);
      if (!bookingContext) continue;
      return {
        bookingContext,
        travelDate: addDays(7),
        travelTime: '07:20',
        passengers: [{
          paxType: 'ADT',
          isLead: true,
          profile: {
            title: 'Mr',
            firstName: 'Rohan',
            lastName: 'Bhagat',
            gender: 'MALE',
            dob: '2001-05-29',
            nationality: 'IN',
          },
        }],
        contact: {
          email: config.flight?.contactEmail || 'rohan@travelvip.ai',
          countryCode: config.flight?.contactCountryCode || '+91',
          mobile: config.flight?.contactMobile || '9876543210',
        },
      };
    }
  }
  throw new Error('lounge: no bookingContext found');
}

async function hotelBuild(client) {
  const hotel = new HotelService(client);
  const { buildSearchBody, buildFinalizeBody, buildGuests, extractRequestId, extractBookingContext } =
    await import('../src/hotel/helpers.js');

  const searchBody = buildSearchBody({
    entityId: config.hotel.defaultEntityId,
    checkinDays: 21,
    nights: config.hotel.nights || 1,
  });
  const search = await hotel.search(searchBody);
  if (!ok(search)) throw new Error(`hotel search failed: ${JSON.stringify(search.data).slice(0, 200)}`);
  const details = await hotel.getDetails(searchBody);
  if (!ok(details)) throw new Error(`hotel details failed: ${JSON.stringify(details.data).slice(0, 200)}`);

  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const rooms = (details.data?.results?.[0]?.rooms || []).filter((r) => r.available !== false && r.bookingCode);

  for (const room of rooms.slice(0, 8)) {
    const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    if (!ok(prebook)) continue;
    const bookingContext = extractBookingContext(prebook.data);
    if (!bookingContext) continue;
    const finalizeBody = buildFinalizeBody({
      bookingContext,
      bookingCode: room.bookingCode,
      requestId,
      checkin: searchBody.checkin,
      checkout: searchBody.checkout,
      guests: buildGuests(),
    });
    finalizeBody.contact = {
      ...finalizeBody.contact,
      email: `qa.sigma.val.${Date.now()}@travelvip.ai`,
    };
    finalizeBody._meta = {
      hotelName: details.data?.results?.[0]?.name || null,
      bookingCode: room.bookingCode,
    };
    return finalizeBody;
  }
  throw new Error('hotel: could not build finalize payload');
}

function summarize(label, res) {
  return {
    label,
    http: res.status,
    ok: ok(res),
    br: brOf(res.data),
    status: res.data?.status || null,
    duplicate: isDup(res.data),
    validation: isValidation(res.data, res.status),
    message:
      res.data?.message
      || res.data?.error?.message
      || res.data?.duplicateMessage
      || null,
    code: res.data?.error?.code || res.data?.code || null,
    details: res.data?.error?.details || res.data?.details || null,
    snippet: JSON.stringify(res.data || {}).slice(0, 900),
  };
}

async function testLounge(client) {
  console.log('\n########## LOUNGE: missing bookingContext ##########');
  const validBody = await loungeBuild(client);

  const book = (body) => client.request({
    method: 'POST',
    path: '/v1/airportServices/lounges/finalize-booking',
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // Optional: book once valid first (mirrors original matrix flow that exposed the bug)
  const valid = await book(validBody);
  const sValid = summarize('valid#1', valid);
  console.log('valid#1', JSON.stringify({
    http: sValid.http, br: sValid.br, status: sValid.status, msg: sValid.message,
  }));

  const invalidBody = { ...validBody };
  delete invalidBody.bookingContext;

  const invalid = await book(invalidBody);
  const sInvalid = summarize('missing-bookingContext', invalid);

  const pass = sInvalid.validation && !sInvalid.duplicate;
  const bugStillOpen = sInvalid.duplicate && !sInvalid.validation;

  return {
    service: 'Lounge',
    bug: 'Missing bookingContext should return validation, not Duplicate',
    validBooking: sValid,
    invalidHit: sInvalid,
    verdict: pass ? 'PASS' : (bugStillOpen ? 'FAIL (still masked as Duplicate)' : 'FAIL'),
    pass,
  };
}

async function testHotel(client) {
  console.log('\n########## HOTEL: invalid guest name Test123 ##########');
  const hotel = new HotelService(client);

  // Fresh invalid-name attempt on a NEW prebook context (true validation test)
  const freshBody = await hotelBuild(client);
  const invalidBody = JSON.parse(JSON.stringify(freshBody));
  delete invalidBody._meta;
  invalidBody.rooms[0].guests[0].firstName = 'Test123';

  const invalid = await hotel.finalizeBooking(invalidBody);
  const sInvalid = summarize('guest-Test123-fresh', invalid);

  // Valid booking then Test123 mutation of same payload shape on a NEW context
  const validBody2 = await hotelBuild(client);
  const validPayload = JSON.parse(JSON.stringify(validBody2));
  delete validPayload._meta;
  const valid = await hotel.finalizeBooking(validPayload);
  const sValid = summarize('valid#1', valid);

  // New context + Test123 (cannot reuse consumed bookingContext)
  const invalidBody2 = await hotelBuild(client);
  const invalidAfterPayload = JSON.parse(JSON.stringify(invalidBody2));
  delete invalidAfterPayload._meta;
  invalidAfterPayload.rooms[0].guests[0].firstName = 'Test123';
  const invalidAfter = await hotel.finalizeBooking(invalidAfterPayload);
  const sInvalidAfter = summarize('Test123-second-fresh-context', invalidAfter);

  const createdNew = !!sInvalid.br && ok(invalid) && !sInvalid.validation;
  const createdNewAfter = !!sInvalidAfter.br && ok(invalidAfter) && !sInvalidAfter.validation;

  const passFresh = sInvalid.validation && !createdNew;
  const passSecond = sInvalidAfter.validation && !createdNewAfter;

  return {
    service: 'Hotel',
    bug: 'Guest firstName "Test123" should fail validation, not create a booking',
    hotelMeta: freshBody._meta || invalidBody2._meta || null,
    freshInvalidHit: sInvalid,
    validBooking: sValid,
    secondInvalidHit: sInvalidAfter,
    verdict: {
      freshTest123: passFresh ? 'PASS' : (createdNew ? 'FAIL (created booking)' : 'FAIL'),
      secondFreshTest123: passSecond ? 'PASS' : (createdNewAfter ? 'FAIL (created booking)' : 'FAIL'),
    },
    pass: passFresh && passSecond,
    createdNewBookingOnFresh: createdNew,
    createdNewBookingOnSecond: createdNewAfter,
  };
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  // ensure partner key attached for sigma
  if (session.accessToken) session.client.setPartnerKey(session.accessToken);

  const lounge = await testLounge(session.client);
  const hotel = await testHotel(session.client);

  const report = {
    ranAt: new Date().toISOString(),
    environment: config.baseUrl,
    results: [lounge, hotel],
    summary: {
      loungeMissingBookingContext: lounge.verdict,
      hotelTest123: hotel.verdict,
    },
  };

  const outPath = path.join('reports', 'security', 'sigma-lounge-hotel-validation-bugs.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n==================== SIGMA VALIDATION BUG RETEST ====================');
  console.log('Lounge missing bookingContext:', lounge.verdict);
  console.log('  http=', lounge.invalidHit.http, 'dup=', lounge.invalidHit.duplicate, 'validation=', lounge.invalidHit.validation);
  console.log('  msg=', lounge.invalidHit.message);
  console.log('  br=', lounge.invalidHit.br, '| validBR=', lounge.validBooking.br);
  console.log('Hotel Test123 (fresh):', hotel.verdict.freshTest123);
  console.log('  http=', hotel.freshInvalidHit.http, 'br=', hotel.freshInvalidHit.br, 'validation=', hotel.freshInvalidHit.validation, 'msg=', hotel.freshInvalidHit.message);
  console.log('Hotel Test123 (second fresh):', hotel.verdict.secondFreshTest123);
  console.log('  http=', hotel.secondInvalidHit.http, 'br=', hotel.secondInvalidHit.br, 'validBR=', hotel.validBooking.br);
  console.log('wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
