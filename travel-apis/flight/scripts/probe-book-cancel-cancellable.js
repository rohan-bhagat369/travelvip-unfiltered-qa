/**
 * Book OW + cancel probe: unique passenger each attempt, find online-cancellable inventory.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-book-cancel-cancellable.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-cancel-cancellable-canary.json';
const Q = { ...FLIGHT_QUERY };
const MAX_FARE = Number(process.env.MAX_FARE || 7500);
const STOP_ON_SUCCESS = process.env.STOP_ON_SUCCESS !== '0';

const AIRLINES = ['SG', 'IX', 'AI', 'QP', '6E'];
const ROUTES = [
  ['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'HYD'], ['HYD', 'DEL'],
  ['DEL', 'BLR'], ['BLR', 'DEL'], ['BOM', 'GOX'], ['GOX', 'BOM'],
  ['DEL', 'GOI'], ['AMD', 'DEL'], ['PNQ', 'BLR'], ['BLR', 'HYD'],
];
const DAYS = [20, 21, 22, 23, 24, 25];
const FIRST_NAMES = ['Arnav', 'Priya', 'Karan', 'Divya', 'Rahul', 'Neha', 'Vikram', 'Anita'];
const LAST_ROOTS = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Desai', 'Mehta'];

let attemptSeq = 0;

function brief(d, n = 350) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function letterTag(n) {
  let x = n % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

function nextPassenger() {
  attemptSeq += 1;
  const tag = letterTag(Date.now() + attemptSeq * 7919);
  const fn = FIRST_NAMES[attemptSeq % FIRST_NAMES.length];
  const ln = LAST_ROOTS[(attemptSeq * 3) % LAST_ROOTS.length];
  return {
    title: attemptSeq % 2 ? 'Mr' : 'Mrs',
    firstName: fn,
    lastName: `${ln} ${tag}`,
    gender: attemptSeq % 2 ? 'Male' : 'Female',
    dob: `198${attemptSeq % 9}-0${(attemptSeq % 8) + 1}-15`,
    tag,
  };
}

function extractPnrs(detail) {
  const pnrs = [];
  const seen = new Set();
  for (const leg of detail?.bookingResponse?.itinerary || []) {
    if (leg.pnr && !seen.has(leg.pnr)) {
      seen.add(leg.pnr);
      pnrs.push(leg.pnr);
    }
  }
  return pnrs;
}

function classifyCancel(res) {
  const st = res.data?.data?.cancellationRequest?.status
    || res.data?.cancellationRequest?.status
    || '';
  const msg = res.data?.data?.cancellationRequest?.message
    || res.data?.cancellationRequest?.message
    || '';
  const raw = brief(res.data);
  if (/unavailable online|offline cancellation/i.test(raw)) {
    return { ok: false, bucket: 'OFFLINE', status: st, message: msg };
  }
  if (/unable to get penalty|penalty check failed/i.test(raw)) {
    return { ok: false, bucket: 'PENALTY_FAIL', status: st, message: msg };
  }
  if (/waiting for cancellation/i.test(raw)) {
    return { ok: false, bucket: 'WAITING', status: st, message: msg };
  }
  if (/cancelled|cancellation requested|success/i.test(st) && !/fail/i.test(st)) {
    return { ok: true, bucket: 'CANCELLABLE', status: st, message: msg };
  }
  if (/fail/i.test(st)) return { ok: false, bucket: 'CANCEL_FAILED', status: st, message: msg };
  return { ok: false, bucket: 'UNKNOWN', status: st, message: msg || raw };
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function waitConfirmed(flight, br) {
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('    status', i + 1, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 3) return s;
    await sleep(2500);
  }
  return null;
}

async function searchOption(flight, { origin, destination, days, airline }) {
  const body = buildOneWaySearchBody(days, {
    origin, destination, fareType: 'NORMAL', maxStops: 0,
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  body.preferences = { ...(body.preferences || {}), airlines: [airline] };

  for (let i = 0; i < 8; i += 1) {
    const s = await flight.search(body);
    const sid = extractFirstSearchId(s.data);
    if (sid) return sid;
    if (isSearchProgressComplete(s.data)) break;
    await sleep(2000);
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'maxFare', MAX_FARE);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const attempts = [];
  let winner = null;

  outer:
  for (const airline of AIRLINES) {
    for (const [origin, destination] of ROUTES) {
      for (const days of DAYS) {
        const pax = nextPassenger();
        const label = `${airline} ${origin}-${destination} d${days} ${pax.firstName} ${pax.lastName}`;
        console.log('\nTRY', label);

        const row = {
          attempt: attemptSeq,
          airline,
          route: `${origin}-${destination}`,
          days,
          passenger: pax,
        };

        try {
          const sid = await searchOption(flight, { origin, destination, days, airline });
          if (!sid) {
            row.result = 'NO_SEARCH';
            attempts.push(row);
            continue;
          }

          const pricing = await flight.getPricing([sid], 'ONE_WAY');
          if (!pricing.data?.priceId) {
            row.result = 'PRICING_FAIL';
            row.detail = brief(pricing.data);
            attempts.push(row);
            continue;
          }

          const total = Number(pricing.data?.pricing?.totalAmount || 0);
          row.total = total;
          if (total > MAX_FARE) {
            row.result = 'FARE_TOO_HIGH';
            attempts.push(row);
            continue;
          }

          const issue = await flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [sid],
            journeyType: 'ONE_WAY',
            passengerProfile: pax,
          });
          const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
          row.issueHttp = issue.status;
          if (!br) {
            row.result = 'ISSUE_FAIL';
            row.detail = brief(issue.data);
            if (/INSUFFICIENT|balance/i.test(row.detail)) {
              attempts.push(row);
              winner = { error: 'INSUFFICIENT_BALANCE', last: row };
              break outer;
            }
            attempts.push(row);
            continue;
          }

          row.br = br;
          const bookStatus = await waitConfirmed(flight, br);
          row.bookStatus = bookStatus;
          if (!/confirm/i.test(String(bookStatus))) {
            row.result = 'NOT_CONFIRMED';
            attempts.push(row);
            continue;
          }

          const detail = await flight.getBookingDetail(br);
          const pnrs = extractPnrs(detail.data);
          const pnr = pnrs[0];
          row.pnr = pnr;
          row.pnrs = pnrs;
          if (!pnr || pnr === 'FVRVRV') {
            row.result = 'BAD_PNR';
            attempts.push(row);
            continue;
          }

          const pen = await cancelCall(client, br, { action: 'PENALTY', pnr });
          row.penalty = classifyCancel(pen);
          await sleep(1500);
          const can = await cancelCall(client, br, { action: 'CANCEL', pnr });
          row.cancel = classifyCancel(can);
          row.cancellable = row.cancel.ok;

          const after = await flight.getBookingStatus(br);
          row.statusAfterCancel = after.data?.status;

          row.result = row.cancel.ok ? 'CANCELLABLE' : row.cancel.bucket;
          attempts.push(row);

          console.log('  ->', br, pnr, row.result, row.cancel.status);

          if (row.cancel.ok) {
            winner = row;
            if (STOP_ON_SUCCESS) break outer;
          }
        } catch (e) {
          row.result = 'ERROR';
          row.error = e.message;
          attempts.push(row);
          console.log('  err', e.message);
        }
      }
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    maxFare: MAX_FARE,
    winner,
    summary: {
      attempts: attempts.length,
      confirmed: attempts.filter((a) => /confirm/i.test(String(a.bookStatus))).length,
      cancellable: attempts.filter((a) => a.cancellable).length,
      buckets: attempts.reduce((acc, a) => {
        const k = a.result || 'unknown';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    },
    attempts,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nWINNER', winner ? `${winner.br} ${winner.pnr} ${winner.result}` : 'none');
  console.log('SUMMARY', report.summary);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
