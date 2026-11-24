/**
 * Hotel prepaid-wallet matrix on theta-api (unique email each case; fixed guest names).
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

const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 400) {
  return JSON.stringify(d).slice(0, n);
}

const { client } = await authenticate(true);
const hotel = new HotelService(client);
let dayOffset = 21;

async function inventory() {
  for (let i = 0; i < 12; i += 1) {
    const checkinDays = dayOffset + i * 3;
    const searchBody = buildSearchBody({
      entityId: '39627872',
      checkinDays,
      nights: 1,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    const search = await hotel.search(searchBody);
    if (!search.ok) continue;
    const details = await hotel.getDetails(searchBody);
    if (!details.ok) continue;
    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    for (const bookingCode of extractBookingCodes(details.data, 10)) {
      const prebook = await hotel.prebook({ bookingCode, requestId });
      if (!isPrebookSuccess(prebook)) continue;
      const room = details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode);
      dayOffset = checkinDays + 2;
      return { searchBody, details, prebook, bookingCode, requestId, room };
    }
  }
  throw new Error('no inventory');
}

async function finalize(sim, tag) {
  const inv = await inventory();
  const body = {
    bookingContext: extractBookingContext(inv.prebook.data),
    bookingCode: inv.bookingCode,
    requestId: inv.requestId,
    checkin: inv.searchBody.checkin,
    checkout: inv.searchBody.checkout,
    rooms: [{ guests: [{ title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
    contact: {
      email: `theta.hotel.${tag}.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile || '9876543210',
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
  };
  if (inv.room?.isGSTClaimable || inv.room?.isGstClaimable) body.gstDetails = { ...GST };
  const res = await client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: sim ? { 'X-Simulate-Failure': sim } : {},
  });
  return { res, inv, body };
}

async function poll(br, max = 18) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = last.data?.status;
    console.log('  status', i + 1, st);
    if (isTerminalHotelStatus(st) || /Failed/i.test(String(st || ''))) return last;
    await sleep(3000);
  }
  return last;
}

const report = { at: new Date().toISOString(), base: config.baseUrl, product: 'hotel', cases: {} };

async function run(key, sim, label, judge) {
  console.log(`\n## ${key} ${label}`);
  const { res, inv } = await finalize(sim, key);
  const d = res.data || {};
  const br = d.bookingRefId || d.bookingReference || null;
  console.log('http', res.status, brief(d, 420));
  let statusResp = null;
  if (br) statusResp = await poll(br, sim === 'provider_no_response' ? 6 : 15);
  const row = judge({ res, d, br, status: statusResp?.data?.status, inv });
  report.cases[key] = {
    ...row,
    simulate: sim,
    http: res.status,
    br,
    apiStatus: d.status,
    refund: d.refund || null,
    errorCode: d.error?.code || d.code || null,
    message: d.message || d.error?.message || null,
    finalStatus: statusResp?.data?.status || null,
    checkin: inv.searchBody.checkin,
    responseBrief: brief(d, 700),
  };
  console.log('=>', report.cases[key].status);
  await sleep(1500);
}

await run('A', null, 'Happy', ({ res, br, status, d }) => ({
  status: res.status === 200 && br && /Pending|Confirmed/i.test(String(status || d.status || '')) ? 'PASS' : 'BUG',
}));

await run('C', 'provider_reject', 'Supplier reject', ({ d, br }) => ({
  status: String(d.status).toUpperCase() === 'FAILED'
    && d.refund?.status === 'SUCCESS'
    && d.refund?.walletTransactionId
    && (d.refund?.referenceId === br || !br)
    ? 'PASS' : 'BUG',
}));

await run('D', 'provider_no_response', 'No supplier answer', ({ br, status, d }) => ({
  status: br && /Pending/i.test(String(status || d.status || '')) && !d.refund ? 'PASS' : 'CHECK',
}));

await run('E', 'wallet_commit_fail', 'Wallet commit fail', ({ res, d }) => ({
  status: res.status === 502 && (d.error?.code || d.code) === 'WALLET_COMMIT_FAILED' ? 'PASS' : 'BUG',
}));

await run('F', 'wallet_commit_fail,wallet_release_fail', 'Commit+release fail', ({ res, d }) => ({
  status: res.status === 502 && (d.error?.code || d.code) === 'WALLET_COMMIT_FAILED' ? 'PASS' : 'BUG',
}));

await run('G', 'provider_reject,wallet_refund_fail', 'Reject+refund fail', ({ d }) => ({
  status: String(d.status).toUpperCase() === 'FAILED'
    && d.refund?.status === 'FAILED'
    && !d.refund?.walletTransactionId
    ? 'PASS' : 'BUG',
  note: 'top-up wallet after',
}));

await run('H', 'wallet_debit_record_fail', 'Debit record fail', ({ br, status, d }) => ({
  status: br && /Pending|Confirmed/i.test(String(status || d.status || '')) && !d.refund ? 'PASS' : 'CHECK',
}));

await run('I', 'provider_reject,wallet_debit_record_fail', 'Missing record+reject', ({ d }) => ({
  status: String(d.status).toUpperCase() === 'FAILED' && d.refund?.status === 'FAILED' ? 'PASS' : 'BUG',
  note: 'top-up wallet after',
}));

// J cancel A if confirmed
console.log('\n## J Cancel A');
{
  const br = report.cases.A?.br;
  if (!br) report.cases.J = { status: 'NOT TESTED' };
  else {
    let st = await poll(br, 20);
    if (!/Confirmed/i.test(String(st?.data?.status || ''))) {
      report.cases.J = { status: 'NOT TESTED', br, reason: st?.data?.status };
    } else {
      const penalty = await hotel.penaltyCheck(br);
      const cancel = await hotel.cancelBooking(br);
      st = await poll(br, 10);
      report.cases.J = {
        status: cancel.ok && /Cancel/i.test(String(st?.data?.status || '')) ? 'PASS' : 'BUG',
        br,
        penalty: brief(penalty.data, 200),
        cancel: brief(cancel.data, 200),
        finalStatus: st?.data?.status,
      };
    }
  }
  console.log('=>', report.cases.J.status);
}

fs.writeFileSync(path.join(OUT, 'hotel-matrix-latest.json'), JSON.stringify(report, null, 2));
console.log('\nHOTEL MATRIX');
for (const [k, v] of Object.entries(report.cases)) {
  console.log(k, v.status, v.br || '', v.finalStatus || v.errorCode || v.apiStatus || '');
}
