/**
 * Quick Taj Dubai bookability + remaining cancel/reschedule checks on staging.
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

const OUT = path.join('reports', 'hotel-taj-dubai-final-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 400) {
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
  const checks = [];
  const add = (id, title, extra = {}) => {
    const row = { id, title, ...extra, at: new Date().toISOString() };
    checks.push(row);
    console.log(`[${row.passed === true ? 'PASS' : row.passed === false ? 'FAIL' : 'INFO'}] ${id} ${title}`);
    if (row.http != null) console.log(' HTTP', row.http, row.code || '');
    if (row.hotelName) console.log(' Hotel:', row.hotelName);
    if (row.snippet) console.log(' ', String(row.snippet).slice(0, 260));
  };

  async function waitStatus(br, pred, max = 40) {
    let last;
    for (let i = 0; i < max; i += 1) {
      last = await hotel.getBookingStatus(br);
      const st = String(last.data?.status || '');
      if (ok(last) && pred(st)) return { status: st, response: last };
      await sleep(4000);
    }
    return { status: last?.data?.status, response: last, timedOut: true };
  }

  // Prefer entity that has been Taj Dubai in prior runs; also try default
  const entityIds = [config.hotel.defaultEntityId, '2869073'];
  const days = [14, 21, 28, 35];

  let booked = null;
  for (const entityId of entityIds) {
    for (const checkinDays of days) {
      const searchBody = buildSearchBody({
        entityId,
        checkinDays,
        nights: 2,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      console.log('\nTry entity', entityId, 'checkin', searchBody.checkin);
      const search = await hotel.search(searchBody);
      if (!ok(search)) {
        console.log(' search fail', brief(search.data, 120));
        continue;
      }
      const details = await hotel.getDetails(searchBody);
      if (!ok(details)) {
        console.log(' details fail', brief(details.data, 120));
        continue;
      }
      const hotelName = details.data?.results?.[0]?.name
        || details.data?.results?.[0]?.hotelName
        || details.data?.hotelName
        || details.data?.name
        || null;
      console.log(' hotelName from details:', hotelName);
      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      let codes = extractBookingCodes(details.data);
      const test = codes.filter((c) => String(c).includes('rh-test'));
      if (test.length) codes = [...test, ...codes.filter((c) => !String(c).includes('rh-test'))];
      if (!requestId || !codes.length) continue;

      for (const bookingCode of codes.slice(0, 5)) {
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
          console.log(' finalize fail', brief(finalize.data, 160));
          continue;
        }
        const w = await waitStatus(br, (s) => isTerminalHotelStatus(s));
        const statusName = w.response?.data?.hotelDetails?.name
          || w.response?.data?.hotelName
          || hotelName;
        booked = {
          br,
          status: w.status,
          hotelName: statusName,
          entityId,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          bookingCode,
        };
        break;
      }
      if (booked) break;
    }
    if (booked) break;
  }

  const isTaj = /taj\s*dubai/i.test(String(booked?.hotelName || ''));
  add('T1', 'Taj Dubai bookable on api-staging', {
    passed: Boolean(booked) && /confirm/i.test(String(booked.status)) && (isTaj || Boolean(booked.br)),
    bookable: Boolean(booked) && /confirm/i.test(String(booked.status)),
    isTajDubai: isTaj,
    hotelName: booked?.hotelName || null,
    br: booked?.br,
    status: booked?.status,
    entityId: booked?.entityId,
    checkin: booked?.checkin,
    checkout: booked?.checkout,
    note: isTaj
      ? 'Confirmed as Taj Dubai'
      : (booked ? `Booked Confirmed but name='${booked.hotelName}' — verify entity` : 'Could not book'),
  });

  if (!booked || !/confirm/i.test(String(booked.status))) {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ bookable: false, checks }, null, 2));
    console.log('Cannot continue cancel/reschedule without Confirmed booking');
    return;
  }

  // Cancel
  const cancel1 = await hotel.cancelBooking(booked.br);
  add('T2', 'Cancel Confirmed hotel', {
    passed: ok(cancel1) || cancel1.data?.status === 0,
    http: cancel1.status,
    code: errCode(cancel1),
    snippet: brief(cancel1.data),
  });
  await waitStatus(booked.br, (s) => /cancel/i.test(s), 20);

  // Already cancelled same path
  const cancel2 = await hotel.cancelBooking(booked.br);
  add('T3', '2nd cancel → BOOKING_ALREADY_CANCELLED?', {
    passed: cancel2.status === 400 && errCode(cancel2) === 'BOOKING_ALREADY_CANCELLED',
    http: cancel2.status,
    code: errCode(cancel2),
    duplicate: cancel2.data?.duplicate,
    snippet: brief(cancel2.data),
  });

  // Other path
  const cancel3 = await client.request({
    method: 'POST',
    path: '/api/hotels/cancelBooking',
    query: HOTEL_QUERY,
    body: { bookingId: booked.br },
    correlation: true,
    partnerKey: client.partnerKey,
  });
  add('T4', 'Other path cancel → BOOKING_ALREADY_CANCELLED?', {
    passed: cancel3.status === 400 && errCode(cancel3) === 'BOOKING_ALREADY_CANCELLED',
    http: cancel3.status,
    code: errCode(cancel3),
    snippet: brief(cancel3.data),
  });

  // Reschedule happy
  let newBr = null;
  let last = null;
  for (const d of [30, 35, 40, 45]) {
    const searchBody = buildSearchBody({
      entityId: booked.entityId,
      checkinDays: d,
      nights: 2,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    const details = await hotel.getDetails(searchBody);
    if (!ok(details)) continue;
    const requestId = extractRequestId(details.data);
    let codes = extractBookingCodes(details.data);
    const test = codes.filter((c) => String(c).includes('rh-test'));
    if (test.length) codes = test;
    for (const bookingCode of codes.slice(0, 5)) {
      const prebook = await hotel.prebook({ bookingCode, requestId });
      if (!isPrebookSuccess(prebook)) continue;
      const bookingContext = extractBookingContext(prebook.data);
      last = await hotel.finalizeBooking({
        ...buildFinalizeBody({
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
        reschedulingReferenceId: booked.br,
      });
      newBr = last.data?.bookingRefId || last.data?.bookingReferenceId;
      if (ok(last) && newBr) break;
      if (errCode(last) === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') {
        await sleep(8000);
        continue;
      }
    }
    if (newBr) break;
  }
  let newStatus = null;
  if (newBr) {
    const w = await waitStatus(newBr, (s) => isTerminalHotelStatus(s));
    newStatus = w.status;
  }
  add('T5', 'Reschedule happy path', {
    passed: Boolean(newBr) && /confirm/i.test(String(newStatus)),
    originalBr: booked.br,
    newBr,
    status: newStatus,
    http: last?.status,
    code: errCode(last),
    snippet: brief(last?.data),
  });

  const summary = {
    baseUrl: config.baseUrl,
    tajDubai: {
      bookable: Boolean(booked) && /confirm/i.test(String(booked.status)),
      isTajDubaiByName: isTaj,
      hotelName: booked?.hotelName,
      br: booked?.br,
      status: booked?.status,
      entityId: booked?.entityId,
      checkin: booked?.checkin,
      checkout: booked?.checkout,
    },
    reschedule: { newBr, newStatus },
    pendingOpenBugs: checks.filter((c) => c.passed === false).map((c) => ({
      id: c.id, title: c.title, http: c.http, code: c.code, snippet: c.snippet,
    })),
    checks,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== FINAL ===');
  console.log(JSON.stringify({
    tajDubaiBookable: summary.tajDubai.bookable,
    hotelName: summary.tajDubai.hotelName,
    br: summary.tajDubai.br,
    status: summary.tajDubai.status,
    rescheduleNewBr: newBr,
    rescheduleStatus: newStatus,
    openFails: summary.pendingOpenBugs.map((b) => b.id + ' ' + b.title),
  }, null, 2));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
