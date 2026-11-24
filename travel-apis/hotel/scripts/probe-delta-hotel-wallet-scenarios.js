/**
 * delta-api hotel B2B wallet scenarios (staging vgm creds).
 * 1) Successful book → Pending → Confirmed (leave confirmed for Nexus wallet check)
 * 2) Invalid PAN finalize (prefer PAN-mandatory rate)
 * 3) Double finalize of the successful payload
 * 4) Cancel confirmed booking (optional via RUN_CANCEL=1)
 *
 *   $env:BASE_URL='https://delta-api.travelvip.ai'
 *   $env:ALLOW_BOOK='true'
 *   node travel-apis/hotel/scripts/probe-delta-hotel-wallet-scenarios.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports', 'delta-hotel-wallet');
const RUN_CANCEL = /^(1|true|yes)$/i.test(String(process.env.RUN_CANCEL || ''));

const VALID_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
// Format-valid but wrong PAN — for vendor reject path (not API schema reject)
const INVALID_PAN = { panCardNumber: 'AAAAA0000A', panCardName: 'Fake Guest' };
const INVALID_PAN_FORMAT = { panCardNumber: 'INVALIDPAN', panCardName: 'Rohan Bhagat' };
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

function amountFrom(obj) {
  const r = obj?.results?.[0] || obj;
  const room = r?.rooms?.[0] || r?.room;
  return (
    room?.price?.totalAmount
    ?? room?.totalFare
    ?? r?.price?.totalAmount
    ?? obj?.totalAmount
    ?? obj?.amountPaid
    ?? null
  );
}

async function waitStatus(hotel, br, maxAttempts = 45) {
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

function buildFinalizeBody({ prebook, details, searchBody, bookingCode, requestId, pan, guestSuffix = '' }) {
  const room =
    prebook.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
    || details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
    || null;
  const isGSTClaimable = Boolean(room?.isGSTClaimable ?? room?.isGstClaimable);
  const first = config.hotel.guestFirstName;
  const last = `${config.hotel.guestLastName}${guestSuffix}`;
  const body = {
    bookingContext: extractBookingContext(prebook.data),
    bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    rooms: [{
      guests: [{
        title: 'Mr',
        firstName: first,
        lastName: last,
        type: 'Adult',
        isLead: true,
      }],
    }],
    contact: {
      email: `delta.wallet.${Date.now()}${guestSuffix}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: pan.panCardNumber,
      panCardName: pan.panCardName.includes(' ')
        ? `${first} ${last}`.trim()
        : pan.panCardName,
    },
  };
  if (isGSTClaimable) body.gstDetails = { ...VALID_GST };
  return { body, room, isPANMandatory: Boolean(room?.isPANMandatory), isGSTClaimable };
}

async function findBookable(hotel) {
  const entityIds = ['39627872', config.hotel.defaultEntityId, '2869073'].filter(Boolean);
  const dayCandidates = [21, 28, 35, 14, 45, 60];
  for (const entityId of entityIds) {
    for (const checkinDays of dayCandidates) {
      for (const nights of [1, 2]) {
        console.log(`\nTry entity=${entityId} +${checkinDays}d nights=${nights}`);
        const searchBody = buildSearchBody({
          entityId,
          checkinDays,
          nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) {
          console.log('  search fail', search.status, brief(search.data, 120));
          continue;
        }
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) {
          console.log('  details fail', details.status);
          continue;
        }
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        let codes = extractBookingCodes(details.data, 16);
        const test = codes.filter((c) => String(c).includes('rh-test'));
        if (test.length) codes = [...test, ...codes.filter((c) => !String(c).includes('rh-test'))];
        if (!requestId || !codes.length) {
          console.log('  no rooms');
          continue;
        }

        // Prefer PAN-mandatory for reject scenario later; still bookable with valid PAN
        const ranked = codes.slice(0, 10).map((bookingCode) => {
          const room = details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode);
          return { bookingCode, room, pan: Boolean(room?.isPANMandatory) };
        }).sort((a, b) => Number(b.pan) - Number(a.pan));

        for (const { bookingCode } of ranked) {
          const prebook = await hotel.prebook({ bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          return {
            entityId,
            searchBody,
            search,
            details,
            prebook,
            bookingCode,
            requestId,
            hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
          };
        }
      }
    }
  }
  return null;
}

async function main() {
  console.log('Base:', config.baseUrl);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const found = await findBookable(hotel);
  if (!found) {
    const report = { ok: false, error: 'No bookable inventory', at: new Date().toISOString(), baseUrl: config.baseUrl };
    fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
    console.error('FAILED: no inventory');
    process.exit(1);
  }

  const { searchBody, details, prebook, bookingCode, requestId, hotelName, entityId } = found;
  console.log(`\n=== Inventory OK: ${hotelName} code=${String(bookingCode).slice(0, 24)}... ===`);

  // --- Scenario 1: successful booking ---
  const okBuild = buildFinalizeBody({
    prebook, details, searchBody, bookingCode, requestId, pan: VALID_PAN, guestSuffix: '',
  });
  console.log(`\n[S1] Finalize success panMandatory=${okBuild.isPANMandatory} gst=${okBuild.isGSTClaimable}`);
  const finalize1 = await hotel.finalizeBooking(okBuild.body);
  const br = finalize1.data?.bookingRefId || finalize1.data?.bookingReferenceId;
  console.log(`  finalize1 HTTP ${finalize1.status} br=${br || '-'} status=${finalize1.data?.status || '-'} code=${finalize1.data?.error?.code || '-'}`);
  console.log(' ', brief(finalize1.data, 280));

  let terminal = null;
  let detail = null;
  if (br) {
    terminal = await waitStatus(hotel, br);
    detail = await hotel.getBookingDetail(br);
    console.log(`  detail status=${detail.data?.status} amountPaid=${detail.data?.amountPaid ?? amountFrom(detail.data)}`);
  }

  // --- Scenario 3: double finalize (same payload) ---
  console.log('\n[S3] Double finalize — replay identical body');
  const finalize2 = await hotel.finalizeBooking(okBuild.body);
  const br2 = finalize2.data?.bookingRefId || finalize2.data?.bookingReferenceId;
  console.log(`  finalize2 HTTP ${finalize2.status} br=${br2 || '-'} status=${finalize2.data?.status || '-'} dup=${finalize2.data?.duplicate || false} code=${finalize2.data?.error?.code || '-'}`);
  console.log(' ', brief(finalize2.data, 280));

  // --- Scenario 2: invalid PAN (fresh prebook preferred) ---
  console.log('\n[S2] Invalid PAN finalize');
  let invalidPan = { attempted: false };
  // New search/prebook so we don't reuse spent bookingCode when possible
  const found2 = await findBookable(hotel);
  if (found2) {
    const inv = buildFinalizeBody({
      prebook: found2.prebook,
      details: found2.details,
      searchBody: found2.searchBody,
      bookingCode: found2.bookingCode,
      requestId: found2.requestId,
      pan: INVALID_PAN,
      guestSuffix: 'X',
    });
    // Force invalid format even if name mapping overwrote
    inv.body.contact.panCardNumber = 'INVALIDPAN';
    inv.body.contact.panCardName = 'FAKE NAME';
    console.log(`  hotel=${found2.hotelName} panMandatory=${inv.isPANMandatory}`);
    const finInv = await hotel.finalizeBooking(inv.body);
    const brInv = finInv.data?.bookingRefId || finInv.data?.bookingReferenceId;
    let invTerminal = null;
    if (brInv) invTerminal = await waitStatus(hotel, brInv, 20);
    invalidPan = {
      attempted: true,
      hotelName: found2.hotelName,
      isPANMandatory: inv.isPANMandatory,
      http: finInv.status,
      br: brInv || null,
      status: finInv.data?.status || invTerminal?.status || null,
      errorCode: finInv.data?.error?.code || null,
      body: finInv.data,
      terminal: invTerminal,
    };
    console.log(`  invalidPAN HTTP ${finInv.status} br=${brInv || '-'} code=${invalidPan.errorCode || '-'} terminal=${invTerminal?.status || '-'}`);
    console.log(' ', brief(finInv.data, 280));
  } else {
    console.log('  skipped — no second inventory');
  }

  // --- Scenario 4: cancel (optional) ---
  let cancelBlock = null;
  if (RUN_CANCEL && br && /confirm/i.test(String(terminal?.status || ''))) {
    console.log(`\n[S4] Cancel ${br}`);
    const penalty = await hotel.penaltyCheck(br);
    const penCr = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
    const cancel = await hotel.cancelBooking(br);
    const cancelCr = cancel.data?.data?.cancellationRequest || cancel.data?.cancellationRequest;
    await sleep(3000);
    const after = await hotel.getBookingStatus(br);
    cancelBlock = {
      penaltyHttp: penalty.status,
      estimatedCharge: penCr?.estimatedCancellationCharge,
      estimatedRefund: penCr?.estimatedRefund,
      cancelHttp: cancel.status,
      cancelStatus: cancelCr?.status,
      charge: cancelCr?.cancellationCharge,
      refund: cancelCr?.refund,
      afterStatus: after.data?.status,
      cancelBody: cancel.data,
    };
    console.log('  cancel', cancelBlock.cancelHttp, cancelBlock.afterStatus, {
      charge: cancelBlock.charge,
      refund: cancelBlock.refund,
    });
  } else {
    console.log('\n[S4] Cancel skipped (set RUN_CANCEL=1 after Nexus wallet debit check)');
  }

  const report = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partner: process.env.PARTNER_ID || 'vgm',
    scenarios: {
      S1_successfulBook: {
        hotelName,
        entityId,
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        bookingCodePreview: String(bookingCode).slice(0, 28),
        finalizeHttp: finalize1.status,
        finalizeStatus: finalize1.data?.status || null,
        br: br || null,
        terminalStatus: terminal?.status || null,
        amountHint: amountFrom(finalize1.data) ?? amountFrom(detail?.data),
        detailStatus: detail?.data?.status || null,
        amountPaid: detail?.data?.amountPaid ?? null,
        finalizeBody: finalize1.data,
        detailBody: detail?.data || null,
      },
      S2_invalidPan: invalidPan,
      S3_doubleFinalize: {
        http: finalize2.status,
        br: br2 || null,
        status: finalize2.data?.status || null,
        duplicate: finalize2.data?.duplicate || false,
        errorCode: finalize2.data?.error?.code || null,
        sameBrAsFirst: Boolean(br && br2 && br === br2),
        body: finalize2.data,
      },
      S4_cancel: cancelBlock,
    },
  };

  const outFile = path.join(OUT_DIR, 'latest.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `run-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log('\nReport:', outFile);
  console.log('\nNEXUS CHECK: open wallet activity for partner vgm and look for BR', br);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
