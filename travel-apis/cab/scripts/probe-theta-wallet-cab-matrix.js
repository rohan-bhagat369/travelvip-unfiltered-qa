/**
 * Cab prepaid-wallet matrix on theta-api (staging vgm).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { CabService } from '../src/service.js';
import { buildFinalizeBody, pickCab, searchBodyForJourney } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'theta-wallet-prepaid');
fs.mkdirSync(OUT, { recursive: true });

function brief(d, n = 420) {
  return JSON.stringify(d).slice(0, n);
}

const { client } = await authenticate(true);
const cab = new CabService(client);
let pickupDays = 9;

async function fareReady() {
  for (let i = 0; i < 8; i += 1) {
    const body = searchBodyForJourney('AIRPORT');
    // bump pickup each attempt
    const d = new Date(Date.now() + (pickupDays + i) * 86400000);
    d.setUTCHours(18, 35, 58, 0);
    body.pickupDatetime = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const search = await cab.search(body);
    const picked = pickCab(search.data?.cabs);
    if (!picked?.searchId) continue;
    const fare = await cab.fare(picked.searchId);
    const bookingReference = fare.data?.bookingReference;
    const priceId = fare.data?.priceId;
    if (bookingReference && priceId) {
      pickupDays += i + 1;
      return { search, fare, bookingReference, priceId, pickupDatetime: body.pickupDatetime };
    }
  }
  throw new Error('no cab fare');
}

async function finalize(sim) {
  const ready = await fareReady();
  const payload = buildFinalizeBody({
    bookingReference: ready.bookingReference,
    priceId: ready.priceId,
  });
  // unique-ish contact email if present in helper payload
  if (payload.contact) payload.contact.email = `theta.cab.${Date.now()}@travelvip.ai`;
  const res = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: sim ? { 'X-Simulate-Failure': sim } : {},
  });
  return { res, ready, payload };
}

const report = { at: new Date().toISOString(), base: config.baseUrl, product: 'cab', cases: {} };

async function run(key, sim, judge) {
  console.log(`\n## CAB ${key} sim=${sim || 'none'}`);
  const { res } = await finalize(sim);
  const d = res.data || {};
  const br = d.bookingRefId || d.bookingReferenceId || d.bookingReference || d.error?.bookingReference || null;
  console.log('http', res.status, brief(d));
  let status = d.status;
  if (br && !/Failed|FAILED/i.test(String(status || ''))) {
    for (let i = 0; i < 6; i += 1) {
      const st = await cab.getBookingStatus(br);
      status = st.data?.status || status;
      console.log('  status', i + 1, status);
      if (status && !/pending/i.test(String(status))) break;
      await sleep(2500);
    }
  }
  const row = judge({ res, d, br, status });
  report.cases[key] = {
    ...row,
    simulate: sim,
    http: res.status,
    br,
    apiStatus: d.status,
    refund: d.refund || null,
    errorCode: d.error?.code || d.code || null,
    message: d.message || d.error?.message || null,
    finalStatus: status || null,
    responseBrief: brief(d, 700),
  };
  console.log('=>', report.cases[key].status);
  await sleep(1200);
}

await run('A', null, ({ res, d, br, status }) => ({
  status: (res.status === 200 || res.ok)
    && br
    && /Pending|Confirmed|Booked|SUCCESS/i.test(String(status || d.status || ''))
    ? 'PASS' : 'BUG',
}));

await run('C', 'provider_reject', ({ res, d, br }) => ({
  status: (res.status === 200 || String(d.status).toUpperCase() === 'FAILED')
    && (br || d.bookingRefId || d.bookingReference)
    && d.refund?.status === 'SUCCESS'
    && d.refund?.walletTransactionId
    ? 'PASS' : 'BUG',
}));

await run('D', 'provider_no_response', ({ br, status, d }) => ({
  status: br && /Pending/i.test(String(status || d.status || '')) && !d.refund ? 'PASS' : 'CHECK',
}));

await run('E', 'wallet_commit_fail', ({ res, d }) => ({
  status: res.status === 502 && (d.error?.code || d.code) === 'WALLET_COMMIT_FAILED' ? 'PASS' : 'BUG',
}));

await run('F', 'wallet_commit_fail,wallet_release_fail', ({ res, d }) => ({
  status: res.status === 502 && (d.error?.code || d.code) === 'WALLET_COMMIT_FAILED' ? 'PASS' : 'BUG',
}));

await run('G', 'provider_reject,wallet_refund_fail', ({ d }) => ({
  status: String(d.status).toUpperCase() === 'FAILED'
    && d.refund?.status === 'FAILED'
    && !d.refund?.walletTransactionId
    ? 'PASS' : 'BUG',
  note: 'top-up after',
}));

await run('H', 'wallet_debit_record_fail', ({ br, status, d }) => ({
  status: br && /Pending|Confirmed|Booked/i.test(String(status || d.status || '')) && !d.refund ? 'PASS' : 'CHECK',
}));

await run('I', 'provider_reject,wallet_debit_record_fail', ({ d }) => ({
  status: String(d.status).toUpperCase() === 'FAILED' && d.refund?.status === 'FAILED' ? 'PASS' : 'BUG',
  note: 'top-up after',
}));

// J cancel A
console.log('\n## CAB J cancel A');
{
  const br = report.cases.A?.br;
  if (!br) report.cases.J = { status: 'NOT TESTED' };
  else {
    const cancel = await cab.cancelBooking(br);
    await sleep(2000);
    const st = await cab.getBookingStatus(br);
    report.cases.J = {
      status: cancel.ok || /Cancel/i.test(String(st.data?.status || cancel.data?.status || '')) ? 'PASS' : 'CHECK',
      br,
      cancelBrief: brief(cancel.data, 250),
      finalStatus: st.data?.status,
    };
  }
  console.log('=>', report.cases.J.status);
}

fs.writeFileSync(path.join(OUT, 'cab-matrix-latest.json'), JSON.stringify(report, null, 2));
console.log('\nCAB MATRIX');
for (const [k, v] of Object.entries(report.cases)) {
  console.log(k, v.status, v.br || '', v.finalStatus || v.errorCode || v.apiStatus || '');
}
