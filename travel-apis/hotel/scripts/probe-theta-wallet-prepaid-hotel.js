/**
 * theta-api hotel prepaid-wallet charge-before-supplier matrix (staging vgm).
 * Cases: A happy, C provider_reject, D provider_no_response, E wallet_commit_fail,
 *        F commit+release fail, G reject+refund_fail, H debit_record_fail,
 *        I reject+debit_record_fail, J cancel happy BR.
 *
 *   $env:BASE_URL='https://theta-api.travelvip.ai'
 *   $env:ALLOW_BOOK='true'
 *   node travel-apis/hotel/scripts/probe-theta-wallet-prepaid-hotel.js
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
const OUT = path.join(__dirname, '..', 'reports', 'theta-wallet-prepaid');
fs.mkdirSync(OUT, { recursive: true });

const VALID_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

function pickRefund(data) {
  return data?.refund || data?.data?.refund || data?.error?.details?.refund || data?.error?.refund || null;
}

function pickBr(data) {
  return data?.bookingRefId || data?.bookingReferenceId || data?.bookingReference
    || data?.data?.bookingRefId || data?.error?.details?.bookingReference || null;
}

async function waitStatus(hotel, br, maxAttempts = 20) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status ${i + 1}: ${st}`);
    if (last.ok && isTerminalHotelStatus(st)) return { status: st, response: last };
    if (/Failed|FAILED/i.test(st)) return { status: st, response: last };
    await sleep(3000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function findBookable(hotel) {
  const entityIds = ['39627872', config.hotel.defaultEntityId, '2869073'].filter(Boolean);
  for (const entityId of entityIds) {
    for (const checkinDays of [21, 28, 35, 14, 45]) {
      for (const nights of [1, 2]) {
        const searchBody = buildSearchBody({
          entityId, checkinDays, nights,
          rooms: [{ adults: 1, children: 0, childrenAges: [] }],
        });
        const search = await hotel.search(searchBody);
        if (!search.ok) continue;
        const details = await hotel.getDetails(searchBody);
        if (!details.ok) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        const codes = extractBookingCodes(details.data, 12);
        if (!requestId || !codes.length) continue;
        for (const bookingCode of codes) {
          const prebook = await hotel.prebook({ bookingCode, requestId });
          if (!isPrebookSuccess(prebook)) continue;
          return {
            searchBody, details, prebook, bookingCode, requestId,
            hotelName: prebook.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
          };
        }
      }
    }
  }
  return null;
}

function buildBody(found, suffix = '') {
  const room = found.details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === found.bookingCode)
    || found.prebook.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === found.bookingCode);
  const first = config.hotel.guestFirstName;
  const last = config.hotel.guestLastName;
  const body = {
    bookingContext: extractBookingContext(found.prebook.data),
    bookingCode: found.bookingCode,
    requestId: found.requestId,
    checkin: found.searchBody.checkin,
    checkout: found.searchBody.checkout,
    rooms: [{ guests: [{ title: 'Mr', firstName: first, lastName: last, type: 'Adult', isLead: true }] }],
    contact: {
      email: `theta.wallet.${Date.now()}${suffix}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
      panCardNumber: VALID_PAN.panCardNumber,
      panCardName: `${first} ${last}`,
    },
  };
  if (room?.isGSTClaimable || room?.isGstClaimable) body.gstDetails = { ...VALID_GST };
  return body;
}

async function finalize(client, body, simulate) {
  return client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: simulate ? { 'X-Simulate-Failure': simulate } : {},
  });
}

async function freshInventory(hotel) {
  const found = await findBookable(hotel);
  if (!found) throw new Error('no hotel inventory');
  return found;
}

const report = {
  at: new Date().toISOString(),
  base: config.baseUrl,
  partner: config.partnerId,
  product: 'hotel',
  cases: {},
};

console.log('Base', config.baseUrl, 'partner', config.partnerId);
const { client } = await authenticate(true);
const hotel = new HotelService(client);

async function runCase(code, simulate, label, judge) {
  console.log(`\n########## HOTEL ${code}: ${label} ##########`);
  const found = await freshInventory(hotel);
  console.log('inventory', found.hotelName, found.searchBody.checkin);
  const body = buildBody(found, code);
  const res = await finalize(client, body, simulate);
  const br = pickBr(res.data);
  const refund = pickRefund(res.data);
  console.log('finalize', res.status, 'br', br, brief(res.data, 450));
  let status = null;
  let detail = null;
  if (br) {
    const polled = await waitStatus(hotel, br, /no_response/i.test(String(simulate || '')) ? 8 : 15);
    status = polled.status;
    detail = await hotel.getBookingDetail(br);
    console.log('detail', detail.status, brief(detail.data, 220));
  }
  const verdict = judge({ res, br, refund, status, detail, found });
  report.cases[code] = {
    ...verdict,
    simulate: simulate || null,
    http: res.status,
    br,
    refund,
    finalStatus: status,
    errorCode: res.data?.error?.code || res.data?.code || null,
    responseBrief: brief(res.data, 600),
    hotel: found.hotelName,
    checkin: found.searchBody.checkin,
    amountPaid: detail?.data?.amountPaid ?? null,
  };
  console.log('VERDICT', code, verdict.status);
  return report.cases[code];
}

// A happy
const caseA = await runCase('A', null, 'Happy path', ({ res, br, status }) => {
  const okHttp = res.ok || res.status === 200;
  const okStatus = /Confirmed|Pending/i.test(String(status || res.data?.status || ''));
  const noRefund = !pickRefund(res.data);
  return {
    status: okHttp && br && okStatus && noRefund ? 'PASS' : 'BUG',
    expect: 'PENDING/Confirmed, no refund section, wallet charged',
  };
});

// C provider_reject
await runCase('C', 'provider_reject', 'Supplier rejects', ({ res, br, refund, status }) => {
  const failed = /Failed|FAILED/i.test(String(status || res.data?.status || ''))
    || res.status === 400
    || /Hotel booking failed/i.test(JSON.stringify(res.data || {}));
  const refundOk = refund
    && String(refund.status).toUpperCase() === 'SUCCESS'
    && refund.amount != null
    && (refund.referenceId === br || !refund.referenceId || String(refund.referenceId).includes(String(br || '')))
    && refund.walletTransactionId;
  return {
    status: failed && refundOk ? 'PASS' : 'BUG',
    expect: 'FAILED + refund.status=SUCCESS + walletTransactionId',
    checks: { failed, refundOk, refund },
  };
});

// D provider_no_response
await runCase('D', 'provider_no_response', 'Supplier no answer', ({ res, br, refund, status }) => {
  const pending = /Pending/i.test(String(status || res.data?.status || ''));
  const notFailed = !/Failed/i.test(String(status || ''));
  const noRefund = !refund;
  return {
    status: br && pending && notFailed && noRefund ? 'PASS' : 'CHECK',
    expect: 'stays PENDING, charged, no refund section',
    checks: { pending, notFailed, noRefund },
  };
});

// E wallet_commit_fail
await runCase('E', 'wallet_commit_fail', 'Wallet commit fail', ({ res, br, status }) => {
  const code = res.data?.error?.code || res.data?.code;
  const ok = res.status === 502 && code === 'WALLET_COMMIT_FAILED';
  const noSupplier = !br || /Failed/i.test(String(status || ''));
  return {
    status: ok ? 'PASS' : 'BUG',
    expect: 'HTTP 502 WALLET_COMMIT_FAILED; no supplier booking',
    checks: { code, noSupplier, message: res.data?.error?.message || res.data?.message },
  };
});

// F commit + release fail
await runCase('F', 'wallet_commit_fail,wallet_release_fail', 'Commit+release fail', ({ res }) => {
  const code = res.data?.error?.code || res.data?.code;
  const ok = res.status === 502 && code === 'WALLET_COMMIT_FAILED';
  return {
    status: ok ? 'PASS' : 'BUG',
    expect: 'same as E + critical commit+release alert',
    checks: { code, message: res.data?.error?.message || res.data?.message },
  };
});

// G reject + refund fail
await runCase('G', 'provider_reject,wallet_refund_fail', 'Reject + refund fail', ({ res, br, refund, status }) => {
  const failed = /Failed|FAILED/i.test(String(status || res.data?.status || '')) || res.status === 400;
  const refundFailed = refund && String(refund.status).toUpperCase() === 'FAILED'
    && (!refund.walletTransactionId || refund.walletTransactionId === '');
  return {
    status: failed && refundFailed ? 'PASS' : 'BUG',
    expect: 'FAILED + refund.status=FAILED + empty walletTransactionId',
    checks: { failed, refundFailed, refund },
    note: 'Wallet stays charged — top up after',
  };
});

// H debit record fail
await runCase('H', 'wallet_debit_record_fail', 'Payment record missing', ({ res, br, refund, status }) => {
  const okStatus = /Confirmed|Pending/i.test(String(status || res.data?.status || ''));
  const noRefund = !refund;
  return {
    status: br && okStatus && noRefund ? 'PASS' : 'CHECK',
    expect: 'booking continues; alert Wallet Payment Record Missing',
  };
});

// I reject + debit record fail
await runCase('I', 'provider_reject,wallet_debit_record_fail', 'Missing record + reject', ({ res, br, refund, status }) => {
  const failed = /Failed|FAILED/i.test(String(status || res.data?.status || '')) || res.status === 400;
  const refundFailed = refund && String(refund.status).toUpperCase() === 'FAILED';
  return {
    status: failed && refundFailed ? 'PASS' : 'BUG',
    expect: 'FAILED + refund FAILED; alerts Missing + Refund Skipped',
    checks: { failed, refundFailed, refund },
    note: 'Wallet stays charged — top up after',
  };
});

// J cancel happy path from Case A if Confirmed/Pending→Confirmed
console.log('\n########## HOTEL J: Cancel Case A ##########');
{
  const br = caseA.br;
  if (!br) {
    report.cases.J = { status: 'NOT TESTED', error: 'no Case A BR' };
  } else {
    // poll until confirmed if still pending
    const polled = await waitStatus(hotel, br, 25);
    if (!/Confirmed/i.test(String(polled.status || ''))) {
      report.cases.J = {
        status: 'NOT TESTED',
        br,
        reason: `Case A status=${polled.status}`,
      };
    } else {
      const penalty = await hotel.penaltyCheck(br);
      const cancel = await hotel.cancelBooking(br);
      const after = await waitStatus(hotel, br, 12);
      const cancelled = /Cancel/i.test(String(after.status || ''));
      report.cases.J = {
        status: cancel.ok && cancelled ? 'PASS' : 'BUG',
        br,
        expect: 'wallet refund on cancel still works',
        penaltyBrief: brief(penalty.data, 250),
        cancelBrief: brief(cancel.data, 250),
        finalStatus: after.status,
      };
    }
  }
  console.log('VERDICT J', report.cases.J.status);
}

fs.writeFileSync(path.join(OUT, 'hotel-latest.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, `hotel-${Date.now()}.json`), JSON.stringify(report, null, 2));
console.log('\n===== HOTEL SUMMARY =====');
for (const [k, v] of Object.entries(report.cases)) {
  console.log(k, v.status, v.br || '', v.finalStatus || v.errorCode || '');
}
console.log('WROTE', path.join(OUT, 'hotel-latest.json'));
