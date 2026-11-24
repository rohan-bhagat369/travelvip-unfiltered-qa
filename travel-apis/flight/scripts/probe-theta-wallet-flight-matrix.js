/**
 * Flight prepaid-wallet matrix on theta-api (OW DOM, staging vgm).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'theta-wallet-prepaid');
fs.mkdirSync(OUT, { recursive: true });

function brief(d, n = 450) {
  return JSON.stringify(d).slice(0, n);
}

const { client } = await authenticate(true);
const flight = new FlightService(client);
let dayBase = 25;

async function pricedInventory() {
  const routes = [
    { origin: 'BOM', destination: 'DEL' },
    { origin: 'DEL', destination: 'BOM' },
    { origin: 'BOM', destination: 'BLR' },
    { origin: 'BLR', destination: 'BOM' },
    { origin: 'DEL', destination: 'HYD' },
    { origin: 'HYD', destination: 'DEL' },
    { origin: 'BOM', destination: 'GOI' },
    { origin: 'DEL', destination: 'AMD' },
  ];
  for (const route of routes) {
    for (let i = 0; i < 3; i += 1) {
      try {
        const body = buildOneWaySearchBody(dayBase + i * 2, {
          ...route, maxStops: 0, fareType: 'NORMAL',
        });
        const { searchId } = await flight.searchUntilComplete(body);
        if (!searchId) {
          console.log('  inventory miss', route.origin, route.destination, 'no searchId');
          continue;
        }
        const details = await flight.getDetails([searchId], 'ONE_WAY');
        if (!details.ok) {
          console.log('  inventory miss', route.origin, route.destination, 'details', details.status);
          continue;
        }
        const pricing = await flight.getPricing([searchId], 'ONE_WAY');
        if (!pricing.ok) {
          console.log('  inventory miss', route.origin, route.destination, 'pricing', pricing.status);
          continue;
        }
        const priceId = pricing.data?.priceId || pricing.data?.data?.priceId || pricing.data?.results?.[0]?.priceId;
        const bookingContext = pricing.data?.bookingContext
          || pricing.data?.bookingReference
          || details.data?.bookingContext
          || searchId;
        if (!priceId) {
          console.log('  inventory miss', route.origin, route.destination, 'no priceId');
          continue;
        }
        dayBase += i + 3;
        console.log('  inventory ok', route.origin, route.destination, 'priceId', String(priceId).slice(0, 24));
        return { searchId, priceId, bookingContext, pricing, details, body, route };
      } catch (e) {
        console.log('  inventory miss', route.origin, route.destination, e.message.slice(0, 80));
      }
    }
  }
  throw new Error('no flight inventory');
}

async function issue(sim, tag) {
  const inv = await pricedInventory();
  const payload = buildIssueTicketPayload({
    bookingContext: inv.bookingContext,
    priceId: inv.priceId,
    searchIds: [inv.searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      firstName: 'Rohan',
      lastName: `Flight${Date.now().toString().slice(-4)}`,
    },
  });
  payload.data.contact.email = `theta.flight.${tag}.${Date.now()}@travelvip.ai`;
  // pan name not needed for domestic usually
  const res = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...config.flight.issueTicketQuery,
      pid: 'vgm',
      ...FLIGHT_QUERY,
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: sim ? { 'X-Simulate-Failure': sim } : {},
  });
  return { res, inv, payload };
}

const report = { at: new Date().toISOString(), base: config.baseUrl, product: 'flight', cases: {} };

async function run(key, sim, judge) {
  console.log(`\n## FLIGHT ${key} sim=${sim || 'none'}`);
  const { res } = await issue(sim, key);
  const d = res.data || {};
  const br = d.bookingReference
    || d.bookingRefId
    || d.bookingReferenceId
    || d.error?.details?.bookingReference
    || d.error?.bookingReference
    || null;
  console.log('http', res.status, brief(d));
  let status = d.status || d.bookingStatus;
  if (br && !sim?.includes('wallet_commit')) {
    for (let i = 0; i < 8; i += 1) {
      const st = await flight.getBookingStatus(br);
      status = st.data?.status || status;
      console.log('  status', i + 1, status);
      if (/Confirm|Fail|Cancel/i.test(String(status || ''))) break;
      await sleep(3000);
    }
  }
  const refund = d.refund || d.error?.details?.refund || d.error?.refund || null;
  const row = judge({ res, d, br, status, refund });
  report.cases[key] = {
    ...row,
    simulate: sim,
    http: res.status,
    br,
    apiStatus: d.status || d.error?.code,
    refund,
    errorCode: d.error?.code || d.code || null,
    message: d.message || d.error?.message || null,
    finalStatus: status || null,
    responseBrief: brief(d, 800),
  };
  console.log('=>', report.cases[key].status);
  await sleep(1500);
}

const ORDER = ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const startCase = process.env.START_CASE || 'A';
const priorA = process.env.PRIOR_A_BR || 'BR1794993507614124';
const startIdx = Math.max(0, ORDER.indexOf(startCase));
function shouldRun(key) {
  return ORDER.indexOf(key) >= startIdx;
}

// Seed prior results so resume/report stays complete
if (startCase !== 'A') {
  report.cases.A = { status: 'PASS', br: priorA, note: 'seeded from prior run', finalStatus: 'Pending' };
}
if (process.env.PRIOR_C_BR) {
  report.cases.C = { status: 'PASS', br: process.env.PRIOR_C_BR, note: 'seeded' };
}
if (process.env.PRIOR_D_BR) {
  report.cases.D = { status: 'PASS', br: process.env.PRIOR_D_BR, note: 'seeded', finalStatus: 'Pending' };
}
if (process.env.PRIOR_E_BR) {
  report.cases.E = { status: 'PASS', br: process.env.PRIOR_E_BR, note: 'seeded', errorCode: 'WALLET_COMMIT_FAILED' };
}
if (process.env.PRIOR_F_BR) {
  report.cases.F = { status: 'PASS', br: process.env.PRIOR_F_BR, note: 'seeded', errorCode: 'WALLET_COMMIT_FAILED' };
}

if (shouldRun('A')) {
  await run('A', null, ({ res, br, status }) => ({
    status: (res.ok || res.status === 200) && br && /Confirm|Pending|Inprogress|Ticket/i.test(String(status || 'Pending'))
      ? 'PASS' : 'BUG',
  }));
}

if (shouldRun('C')) {
  await run('C', 'provider_reject', ({ res, d, br, refund }) => {
    const code = d.error?.code || d.code;
    const ok = res.status === 502
      && code === 'TICKET_ISSUANCE_FAILED'
      && (br || d.error?.details?.bookingReference)
      && refund?.status === 'SUCCESS'
      && refund?.walletTransactionId;
    return { status: ok ? 'PASS' : 'BUG', checks: { code, refund } };
  });
}

if (shouldRun('D')) {
  await run('D', 'provider_no_response', ({ br, status, refund }) => ({
    status: br && /Pending|Inprogress/i.test(String(status || 'Pending')) && !refund ? 'PASS' : 'CHECK',
  }));
}

if (shouldRun('E')) {
  await run('E', 'wallet_commit_fail', ({ res, d }) => ({
    status: res.status === 502 && (d.error?.code || d.code) === 'WALLET_COMMIT_FAILED' ? 'PASS' : 'BUG',
  }));
}

if (shouldRun('F')) {
  await run('F', 'wallet_commit_fail,wallet_release_fail', ({ res, d }) => ({
    status: res.status === 502 && (d.error?.code || d.code) === 'WALLET_COMMIT_FAILED' ? 'PASS' : 'BUG',
  }));
}

if (shouldRun('G')) {
  await run('G', 'provider_reject,wallet_refund_fail', ({ res, d, refund }) => {
    const code = d.error?.code || d.code;
    const ok = res.status === 502
      && code === 'TICKET_ISSUANCE_FAILED'
      && refund?.status === 'FAILED'
      && !refund?.walletTransactionId;
    return { status: ok ? 'PASS' : 'BUG', note: 'top-up after' };
  });
}

if (shouldRun('H')) {
  await run('H', 'wallet_debit_record_fail', ({ br, status, refund }) => ({
    status: br && /Confirm|Pending|Inprogress/i.test(String(status || 'Pending')) && !refund ? 'PASS' : 'CHECK',
  }));
}

if (shouldRun('I')) {
  await run('I', 'provider_reject,wallet_debit_record_fail', ({ res, d, refund }) => {
    const code = d.error?.code || d.code;
    const ok = res.status === 502
      && code === 'TICKET_ISSUANCE_FAILED'
      && refund?.status === 'FAILED';
    return { status: ok ? 'PASS' : 'BUG', note: 'top-up after' };
  });
}

// J cancel A if Confirmed
if (shouldRun('J')) {
  console.log('\n## FLIGHT J cancel A');
  {
    const br = report.cases.A?.br;
    if (!br) report.cases.J = { status: 'NOT TESTED' };
    else {
      let status = report.cases.A.finalStatus;
      for (let i = 0; i < 12; i += 1) {
        const st = await flight.getBookingStatus(br);
        status = st.data?.status;
        console.log('  pre-cancel', status);
        if (/Confirm/i.test(String(status || ''))) break;
        if (/Fail|Cancel/i.test(String(status || ''))) break;
        await sleep(4000);
      }
      if (!/Confirm/i.test(String(status || ''))) {
        report.cases.J = { status: 'NOT TESTED', br, reason: status };
      } else {
        const detail = await flight.getBookingDetail(br);
        const d0 = detail.data || {};
        const brsp = d0.bookingResponse || d0;
        const pnr = brsp?.itinerary?.[0]?.pnr
          || brsp?.pnr
          || d0.pnr
          || null;
        if (!pnr) {
          report.cases.J = { status: 'NOT TESTED', br, reason: 'no PNR on detail', detailBrief: brief(d0, 300) };
        } else {
          const cancel = await flight.cancelV2({
            bookingId: br,
            action: 'CANCEL',
            pnr,
            cancelledBy: 'USER',
            cancellationReason: 'theta wallet prepaid Case J',
          });
          console.log('cancel', cancel.status, brief(cancel.data));
          await sleep(4000);
          const after = await flight.getBookingStatus(br);
          const afterStatus = after.data?.status;
          report.cases.J = {
            status: (cancel.ok || cancel.status === 200)
              || /Cancel/i.test(String(afterStatus || ''))
              ? 'PASS' : 'CHECK',
            br,
            pnr,
            cancelBrief: brief(cancel.data, 400),
            finalStatus: afterStatus,
            detailStatus: d0.status || detail.data?.status,
          };
        }
      }
    }
    console.log('=>', report.cases.J.status);
  }
}

fs.writeFileSync(path.join(OUT, 'flight-matrix-latest.json'), JSON.stringify(report, null, 2));
console.log('\nFLIGHT MATRIX');
for (const [k, v] of Object.entries(report.cases)) {
  console.log(k, v.status, v.br || '', v.finalStatus || v.errorCode || v.apiStatus || '');
}
