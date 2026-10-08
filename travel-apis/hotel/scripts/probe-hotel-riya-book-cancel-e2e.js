/**
 * Riya hotel E2E: search → details → prebook → finalize → status → penalty → cancel
 * Run: $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/probe-hotel-riya-book-cancel-e2e.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-riya-book-cancel-e2e.json');
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function supplier(code) {
  return String(code || '').split('!TB!')[1] || null;
}
function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitTerminal(hotel, br, max = 40) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status poll ${i + 1}: ${st} message=${JSON.stringify(last.data?.message)}`);
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(4000);
  }
  return last;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const entities = [
    { id: '39627872', name: 'Hiltop Mumbai' },
    { id: '15237042', name: 'Keys Prima Pune' },
    { id: '39604638', name: 'Treebo Diamond' },
  ];
  const daysList = [28, 35, 45, 21, 60, 14];

  let booked = null;

  outer:
  for (const ent of entities) {
    for (const days of daysList) {
      console.log(`\n=== Search ${ent.name} (${ent.id}) +${days}d ===`);
      const searchBody = buildSearchBody({
        entityId: ent.id,
        checkinDays: days,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      searchBody.type = 'HOTEL';
      searchBody.nationality = 'IN';

      const search = await hotel.search(searchBody);
      if (!search.ok) {
        console.log('search fail', search.status);
        continue;
      }
      const details = await hotel.getDetails(searchBody);
      if (!details.ok) {
        console.log('details fail', details.status);
        continue;
      }
      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      const hotelName = details.data?.results?.[0]?.name || ent.name;
      const rooms = (details.data?.results?.[0]?.rooms || [])
        .filter((r) => supplier(r.bookingCode) === 'RIYA');
      console.log('hotel', hotelName, 'RIYA rooms', rooms.length, 'checkin', searchBody.checkin);
      if (!requestId || !rooms.length) continue;

      // Prefer free-cancel / cheaper first
      const ordered = [...rooms].sort((a, b) => {
        const ap = a.price?.totalAmount ?? a.totalFare ?? 999999;
        const bp = b.price?.totalAmount ?? b.totalFare ?? 999999;
        return ap - bp;
      });

      for (const room of ordered.slice(0, 5)) {
        console.log('prebook', String(room.bookingCode).slice(0, 70));
        const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
        if (!isPrebookSuccess(pre)) {
          console.log('  prebook fail', brief(pre.data, 120));
          continue;
        }

        const body = {
          bookingContext: extractBookingContext(pre.data),
          bookingCode: room.bookingCode,
          requestId,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          rooms: [{
            guests: [{
              title: 'Mr',
              firstName: config.hotel.guestFirstName,
              lastName: config.hotel.guestLastName,
              type: 'Adult',
              isLead: true,
            }],
          }],
          contact: {
            email: `hotel.riya.e2e.${Date.now()}@travelvip.ai`,
            countryCode: '+91',
            mobile: config.hotel.contactMobile,
            panCardNumber: 'ABCDE1234F',
            panCardName: `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`,
          },
        };
        if (room.isGSTClaimable) body.gstDetails = { ...VALID_GST };

        console.log('finalize pan=', !!body.contact.panCardNumber, 'gst=', !!body.gstDetails);
        const fin = await hotel.finalizeBooking(body);
        const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
        console.log('finalize HTTP', fin.status, 'br', br, fin.data?.error?.code || '-');
        if (!fin.ok || !br) {
          console.log(' ', brief(fin.data, 200));
          continue;
        }

        const stRes = await waitTerminal(hotel, br);
        const status = stRes?.data?.status;
        console.log('terminal', status);

        if (/confirm/i.test(String(status))) {
          booked = {
            br,
            hotelName,
            entityId: ent.id,
            bookingCode: room.bookingCode,
            supplier: 'RIYA',
            checkin: searchBody.checkin,
            checkout: searchBody.checkout,
            finalize: fin.data,
            statusBefore: stRes.data,
          };
          break outer;
        }
        console.log('not confirmed — try next room');
      }
    }
  }

  if (!booked) {
    const report = {
      ok: false,
      baseUrl: config.baseUrl,
      at: new Date().toISOString(),
      error: 'Could not get Confirmed Riya booking',
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.error('FAILED: no Confirmed Riya booking');
    process.exit(1);
  }

  console.log(`\n=== Confirmed ${booked.br} — penalty then cancel ===`);

  const detailBefore = await hotel.getBookingDetail(booked.br);
  const penalty = await hotel.penaltyCheck(booked.br);
  const penCr = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
  console.log('Penalty-check:', penalty.status, penCr?.status, {
    charge: penCr?.estimatedCancellationCharge,
    refund: penCr?.estimatedRefund,
  });

  const cancel = await hotel.cancelBooking(booked.br);
  const cancelCr = cancel.data?.data?.cancellationRequest || cancel.data?.cancellationRequest;
  console.log('Cancel:', cancel.status, cancelCr?.status, brief(cancel.data, 350));

  await sleep(4000);
  const statusAfter = await hotel.getBookingStatus(booked.br);
  const detailAfter = await hotel.getBookingDetail(booked.br);
  console.log('After cancel status:', statusAfter.data?.status);

  const penAfter = await hotel.penaltyCheck(booked.br);
  console.log(
    'Penalty after cancel:',
    penAfter.status,
    penAfter.data?.error?.code || (penAfter.data?.data?.cancellationRequest || penAfter.data?.cancellationRequest)?.status,
  );

  const cancelledOk = /cancel/i.test(String(statusAfter.data?.status || ''))
    || /cancel/i.test(String(cancelCr?.status || ''));

  const report = {
    ok: cancelledOk,
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    flow: ['search', 'details', 'prebook', 'finalize', 'status=Confirmed', 'penalty-check', 'cancel', 'status-after'],
    booking: {
      bookingId: booked.br,
      hotelName: booked.hotelName,
      entityId: booked.entityId,
      supplier: 'RIYA',
      bookingCode: booked.bookingCode,
      checkin: booked.checkin,
      checkout: booked.checkout,
      statusBeforeCancel: booked.statusBefore?.status,
      statusAfterCancel: statusAfter.data?.status,
      salesSummary: detailBefore.data?.salesSummary || booked.statusBefore?.salesSummary,
      messageBefore: booked.statusBefore?.message,
      messageAfter: statusAfter.data?.message,
    },
    penaltyBefore: {
      http: penalty.status,
      status: penCr?.status,
      charge: penCr?.estimatedCancellationCharge,
      refund: penCr?.estimatedRefund,
      body: penalty.data,
    },
    cancel: {
      http: cancel.status,
      status: cancelCr?.status,
      charge: cancelCr?.cancellationCharge,
      refund: cancelCr?.refund,
      duplicate: Boolean(cancel.data?.duplicate),
      body: cancel.data,
    },
    penaltyAfter: {
      http: penAfter.status,
      code: penAfter.data?.error?.code || null,
      body: penAfter.data,
    },
    detailAfterStatus: detailAfter.data?.status,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n========== RIYA BOOK+CANCEL E2E ==========');
  console.log(cancelledOk ? 'SUCCESS' : 'PARTIAL/FAIL — see report');
  console.log(JSON.stringify({
    br: booked.br,
    hotel: booked.hotelName,
    before: booked.statusBefore?.status,
    cancelStatus: cancelCr?.status,
    after: statusAfter.data?.status,
    penalty: `${penCr?.status} charge=${penCr?.estimatedCancellationCharge} refund=${penCr?.estimatedRefund}`,
  }, null, 2));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
