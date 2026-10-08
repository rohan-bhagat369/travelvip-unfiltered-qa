/**
 * Hotel full flow: search → details → prebook → finalize → status → penalty-check → cancel
 * Run: node scripts/probe-hotel-book-cancel-now.js
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

const OUT = path.join('reports', 'hotel-book-cancel-now.json');

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 400) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

async function waitStatus(hotel, br, maxAttempts = 40) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status poll ${i + 1}: ${st}`);
    if (last.ok && isTerminalHotelStatus(st)) return { status: st, response: last };
    await sleep(4000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function main() {
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const entityIds = ['39627872', config.hotel.defaultEntityId, '2869073'].filter(Boolean);
  const dayCandidates = [21, 28, 35, 14, 45];
  let booked = null;

  for (const entityId of entityIds) {
    for (const checkinDays of dayCandidates) {
      for (const nights of [1, 2]) {
        console.log(`\nTrying entity=${entityId} +${checkinDays}d nights=${nights}`);
        const searchBody = buildSearchBody({
          entityId,
          checkinDays,
          nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) {
          console.log('  search fail', search.status);
          continue;
        }
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) {
          console.log('  details fail', details.status);
          continue;
        }
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        let codes = extractBookingCodes(details.data, 12);
        const test = codes.filter((c) => String(c).includes('rh-test'));
        if (test.length) codes = [...test, ...codes.filter((c) => !String(c).includes('rh-test'))];
        if (!requestId || !codes.length) {
          console.log('  no rooms');
          continue;
        }

        for (const bookingCode of codes.slice(0, 6)) {
          const prebook = await hotel.prebook({ bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;

          const room =
            prebook.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
            || details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
            || null;
          const isPANMandatory = Boolean(room?.isPANMandatory);
          const isGSTClaimable = Boolean(room?.isGSTClaimable ?? room?.isGstClaimable);
          const hotelName = prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name;

          const body = {
            bookingContext: extractBookingContext(prebook.data),
            bookingCode,
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
              email: `hotel.bookcancel.${Date.now()}@travelvip.ai`,
              countryCode: '+91',
              mobile: config.hotel.contactMobile,
            },
          };
          if (isPANMandatory || true) {
            // include PAN when mandatory; safe to send when optional
            body.contact.panCardNumber = 'ABCDE1234F';
            body.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
          }
          if (isGSTClaimable) {
            body.gstDetails = { ...VALID_GST };
          }

          console.log(`  finalize hotel=${hotelName} pan=${isPANMandatory} gst=${isGSTClaimable}`);
          const finalize = await hotel.finalizeBooking(body);
          const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
          console.log(`  finalize HTTP ${finalize.status} br=${br || '-'} code=${finalize.data?.error?.code || '-'}`);
          if (!finalize.ok || !br) {
            console.log('  ', brief(finalize.data, 220));
            continue;
          }

          const w = await waitStatus(hotel, br);
          console.log(`  terminal status=${w.status}`);
          if (/confirm/i.test(String(w.status))) {
            booked = {
              br,
              status: w.status,
              hotelName,
              entityId,
              checkin: searchBody.checkin,
              checkout: searchBody.checkout,
              isPANMandatory,
              isGSTClaimable,
              finalize,
              statusResponse: w.response,
            };
            break;
          }
          console.log('  not confirmed, try next room/date');
        }
        if (booked) break;
      }
      if (booked) break;
    }
    if (booked) break;
  }

  if (!booked) {
    const report = { ok: false, error: 'Could not get Confirmed hotel booking', at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.error('FAILED: no confirmed booking');
    process.exit(1);
  }

  console.log(`\n=== Confirmed ${booked.br} ===`);

  const penalty = await hotel.penaltyCheck(booked.br);
  const penCr = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
  console.log('Penalty-check:', penalty.status, penCr?.status, {
    charge: penCr?.estimatedCancellationCharge,
    refund: penCr?.estimatedRefund,
  });

  const cancel = await hotel.cancelBooking(booked.br);
  const cancelCr = cancel.data?.data?.cancellationRequest || cancel.data?.cancellationRequest;
  console.log('Cancel:', cancel.status, cancelCr?.status, brief(cancel.data, 300));

  await sleep(3000);
  const after = await hotel.getBookingStatus(booked.br);
  console.log('After cancel status:', after.data?.status);

  const penAfter = await hotel.penaltyCheck(booked.br);
  console.log(
    'Penalty after cancel:',
    penAfter.status,
    penAfter.data?.error?.code || (penAfter.data?.data?.cancellationRequest || penAfter.data?.cancellationRequest)?.status,
  );

  const report = {
    ok: /cancel/i.test(String(after.data?.status || cancelCr?.status || '')),
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    booking: {
      bookingId: booked.br,
      hotelName: booked.hotelName,
      entityId: booked.entityId,
      checkin: booked.checkin,
      checkout: booked.checkout,
      isPANMandatory: booked.isPANMandatory,
      isGSTClaimable: booked.isGSTClaimable,
      confirmedStatus: booked.status,
      afterCancelStatus: after.data?.status,
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
      duplicate: cancel.data?.duplicate || false,
      body: cancel.data,
    },
    penaltyAfter: {
      http: penAfter.status,
      code: penAfter.data?.error?.code || null,
      body: penAfter.data,
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nReport:', OUT);
  console.log(report.ok ? 'SUCCESS: booked + cancelled' : 'DONE with non-cancelled end state — see report');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
