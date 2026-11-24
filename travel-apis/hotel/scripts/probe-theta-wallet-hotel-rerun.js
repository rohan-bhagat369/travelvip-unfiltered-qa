import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'theta-wallet-prepaid');
fs.mkdirSync(OUT, { recursive: true });

const { client } = await authenticate(true);
const hotel = new HotelService(client);

async function one(sim) {
  const day = 20 + Math.floor(Math.random() * 40);
  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays: day,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  const search = await hotel.search(searchBody);
  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const codes = extractBookingCodes(details.data, 8);
  let prebook = null;
  let bookingCode = null;
  for (const c of codes) {
    const pb = await hotel.prebook({ bookingCode: c, requestId });
    if (isPrebookSuccess(pb)) {
      prebook = pb;
      bookingCode = c;
      break;
    }
  }
  if (!prebook) return { sim, error: 'no prebook' };
  const last = `Bhagat${Date.now().toString().slice(-5)}`;
  const body = {
    bookingContext: extractBookingContext(prebook.data),
    bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    rooms: [{ guests: [{ title: 'Mr', firstName: 'Rohan', lastName: last, type: 'Adult', isLead: true }] }],
    contact: {
      email: `theta.${String(sim || 'happy').replace(/[^a-z0-9]+/gi, '')}.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: '9876543210',
      panCardNumber: 'EUIPB1672M',
      panCardName: `Rohan ${last}`,
    },
  };
  const res = await client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: sim ? { 'X-Simulate-Failure': sim } : {},
  });
  return { sim, http: res.status, data: res.data, checkin: searchBody.checkin };
}

function judge(row) {
  const d = row.data || {};
  const br = d.bookingRefId || d.bookingReference || null;
  const refund = d.refund || null;
  const sim = row.sim;
  if (row.error) return { status: 'NOT TESTED', ...row };
  if (!sim) {
    return {
      status: (row.http === 200 && br && /Pending|Confirmed/i.test(String(d.status || ''))) ? 'PASS' : 'BUG',
      br, http: row.http, apiStatus: d.status, refund,
    };
  }
  if (sim === 'provider_reject') {
    const ok = String(d.status).toUpperCase() === 'FAILED'
      && refund?.status === 'SUCCESS'
      && refund?.walletTransactionId;
    return { status: ok ? 'PASS' : 'BUG', br, http: row.http, apiStatus: d.status, refund, message: d.message };
  }
  if (sim === 'provider_no_response') {
    const ok = br && /Pending/i.test(String(d.status || '')) && !refund;
    return { status: ok ? 'PASS' : 'CHECK', br, http: row.http, apiStatus: d.status, refund };
  }
  if (sim === 'wallet_commit_fail' || sim === 'wallet_commit_fail,wallet_release_fail') {
    const code = d?.error?.code || d?.code;
    const ok = row.http === 502 && code === 'WALLET_COMMIT_FAILED';
    return {
      status: ok ? 'PASS' : 'BUG',
      br, http: row.http, code, message: d?.error?.message || d?.message, rawNull: d === null,
    };
  }
  if (sim === 'provider_reject,wallet_refund_fail') {
    const ok = String(d.status).toUpperCase() === 'FAILED'
      && refund?.status === 'FAILED'
      && !refund?.walletTransactionId;
    return { status: ok ? 'PASS' : 'BUG', br, http: row.http, apiStatus: d.status, refund, message: d.message };
  }
  if (sim === 'wallet_debit_record_fail') {
    const ok = br && /Pending|Confirmed/i.test(String(d.status || '')) && !refund;
    return { status: ok ? 'PASS' : 'CHECK', br, http: row.http, apiStatus: d.status, refund };
  }
  if (sim === 'provider_reject,wallet_debit_record_fail') {
    const ok = String(d.status).toUpperCase() === 'FAILED' && refund?.status === 'FAILED';
    return { status: ok ? 'PASS' : 'BUG', br, http: row.http, apiStatus: d.status, refund, message: d.message };
  }
  return { status: 'CHECK', ...row };
}

const sims = [
  null,
  'provider_reject',
  'provider_no_response',
  'wallet_commit_fail',
  'wallet_commit_fail,wallet_release_fail',
  'provider_reject,wallet_refund_fail',
  'wallet_debit_record_fail',
  'provider_reject,wallet_debit_record_fail',
];

const cases = {};
for (const s of sims) {
  const key = s || 'A_happy';
  console.log('\n==', key, '==');
  const row = await one(s);
  const verdict = judge(row);
  cases[key] = verdict;
  console.log(JSON.stringify(verdict).slice(0, 450));
  await new Promise((r) => setTimeout(r, 2000));
}

const report = { at: new Date().toISOString(), base: process.env.BASE_URL, product: 'hotel', cases };
fs.writeFileSync(path.join(OUT, 'hotel-rerun-latest.json'), JSON.stringify(report, null, 2));
console.log('\nSUMMARY');
for (const [k, v] of Object.entries(cases)) console.log(k, v.status, v.br || '', v.code || v.apiStatus || '');
