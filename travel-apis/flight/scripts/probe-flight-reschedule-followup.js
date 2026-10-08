/**
 * Follow-up: clean cancel→wait→reschedule + precise validation bugs.
 * Run: node scripts/probe-flight-reschedule-followup.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join('reports', 'flight-reschedule-followup-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 600) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function extractAirlinePnrs(detailData) {
  const found = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === 'string'
        && v.trim()
        && !v.startsWith('BR')
        && v.length <= 20
        && /(^pnr$|pnr$)/i.test(k)
      ) {
        String(v).split('|').map((x) => x.trim()).filter(Boolean).forEach((p) => found.add(p));
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return [...found];
}

async function waitStatus(flight, br, predicate, maxAttempts = 36) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (ok(last) && predicate(st, last.data)) return { status: st, response: last };
    await sleep(5000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function priceFresh(flight, daysOffset) {
  const routes = [
    ['DEL', 'BOM'],
    ['BOM', 'DEL'],
    ['DEL', 'HYD'],
    ['BLR', 'HYD'],
  ];
  let lastErr = null;
  for (const [origin, destination] of routes) {
    try {
      const body = buildOneWaySearchBody(daysOffset, {
        origin, destination, maxStops: 0, fareType: 'NORMAL',
      });
      const { response: search, searchIds } = await flight.searchUntilComplete(body);
      const ids = (searchIds || []).slice(0, 5);
      if (!ids.length) continue;

      // Prefer cheapest among first few options via sequential pricing until totalAmount <= wallet-ish
      let best = null;
      for (const searchId of ids) {
        const pricing = await flight.getPricing([searchId], 'ONE_WAY');
        if (!ok(pricing)) continue;
        const total = Number(
          pricing.data?.pricing?.totalAmount
          ?? pricing.data?.totalAmount
          ?? Infinity,
        );
        if (!best || total < best.total) {
          best = {
            searchId,
            searchIds: [searchId],
            priceId: pricing.data?.priceId,
            bookingContext: pricing.data?.bookingContext || pricing.data?.requestReference,
            travelDate: body.itinerary[0].date,
            total,
            origin,
            destination,
          };
        }
        if (total <= 5000) break;
      }
      if (best && best.total <= 15000) return best;
      if (best) lastErr = new Error(`cheapest ${origin}-${destination}=${best.total}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no priced flight');
}

async function bookConfirmed(flight, daysOffset) {
  const priced = await priceFresh(flight, daysOffset);
  const issue = await flight.issueTicket({
    bookingContext: priced.bookingContext,
    priceId: priced.priceId,
    searchIds: priced.searchIds,
    journeyType: 'ONE_WAY',
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  const msg = JSON.stringify(issue.data || {});
  if (!ok(issue) || !br || /insufficient wallet/i.test(msg)) {
    throw new Error(`issue fail http=${issue.status} ${brief(issue.data)}`);
  }
  const wait = await waitStatus(flight, br, (s) => isTerminalBookingStatus(s));
  if (String(wait.status).toLowerCase() === 'failed') {
    throw new Error(`booking failed ${br} ${brief(wait.response?.data)}`);
  }
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractAirlinePnrs(detail.data);
  return { br, pnr: pnrs[0], pnrs, wait, detail, priced };
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function issueRaw(client, body) {
  return client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...Q, count: 10, page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const findings = [];
  const note = (id, severity, title, detail) => {
    const row = { id, severity, title, detail };
    findings.push(row);
    console.log(`\n[${severity}] ${id} ${title}`);
    console.log(' ', typeof detail === 'string' ? detail.slice(0, 400) : brief(detail, 400));
  };

  // ---- Validation booking (do NOT cancel) ----
  console.log('\n=== VALIDATION BOOKING ===');
  const vBook = await bookConfirmed(flight, 19);
  console.log('V-BR', vBook.br, vBook.wait.status, vBook.pnr);
  if (String(vBook.wait.status).toLowerCase() !== 'confirmed' || !vBook.pnr) {
    throw new Error('validation booking not ready');
  }

  const missPnr = await cancelCall(client, vBook.br, { action: 'PENALTY' });
  const missPnrUsesAuto = ok(missPnr) && String(missPnr.data?.data?.pnr || '').length > 0;
  note(
    'BUG-1',
    missPnr.status === 400 ? 'OK' : 'BUG',
    'PENALTY without pnr should be 400 VALIDATION (docs: pnr required)',
    { http: missPnr.status, body: missPnr.data },
  );

  const emptyPnr = await cancelCall(client, vBook.br, { action: 'PENALTY', pnr: '' });
  note(
    'BUG-2',
    emptyPnr.status === 400 || emptyPnr.status === 422 ? 'OK' : 'BUG',
    'PENALTY with empty pnr should be validation error',
    { http: emptyPnr.status, body: emptyPnr.data },
  );

  const validPenalty = await cancelCall(client, vBook.br, { action: 'PENALTY', pnr: vBook.pnr });
  const hasEst = validPenalty.data?.data?.cancellationRequest?.estimatedCancellationCharge != null
    || validPenalty.data?.estimatedCancellationCharge != null
    || validPenalty.data?.data?.totalPenalityAmount != null
    || validPenalty.data?.data?.cancellationRequest?.estimatedRefund != null;
  note(
    'CHK-1',
    ok(validPenalty) && (validPenalty.data?.data?.cancellationRequest?.status || '').toLowerCase().includes('fail')
      ? 'GAP'
      : (ok(validPenalty) ? 'OK' : 'BUG'),
    'PENALTY with valid pnr',
    { http: validPenalty.status, hasEstimatedFields: hasEst, body: validPenalty.data },
  );

  // missing only one reschedule field while booking still confirmed
  const pricedA = await priceFresh(flight, 21);
  const onlyRef = await issueRaw(client, {
    ...buildIssueTicketPayload({
      bookingContext: pricedA.bookingContext,
      priceId: pricedA.priceId,
      searchIds: pricedA.searchIds,
    }),
    reschedulingReferenceId: vBook.br,
  });
  note(
    'BUG-3',
    onlyRef.data?.error?.code === 'VALIDATION_ERROR' ? 'OK' : 'BUG',
    'issue-ticket with only reschedulingReferenceId (missing reschedulingPnr) should VALIDATION_ERROR',
    { http: onlyRef.status, code: onlyRef.data?.error?.code, body: onlyRef.data },
  );

  const pricedB = await priceFresh(flight, 22);
  const onlyPnr = await issueRaw(client, {
    ...buildIssueTicketPayload({
      bookingContext: pricedB.bookingContext,
      priceId: pricedB.priceId,
      searchIds: pricedB.searchIds,
    }),
    reschedulingPnr: vBook.pnr,
  });
  const treatedAsNormalBook = ok(onlyPnr) || /wallet|insufficient|booking is processing|pending/i.test(JSON.stringify(onlyPnr.data));
  note(
    'BUG-4',
    onlyPnr.data?.error?.code === 'VALIDATION_ERROR' ? 'OK' : 'BUG',
    'issue-ticket with only reschedulingPnr (missing referenceId) should VALIDATION_ERROR, not normal book',
    { http: onlyPnr.status, treatedAsNormalBook, code: onlyPnr.data?.error?.code, message: onlyPnr.data?.message || onlyPnr.data?.error?.message, body: onlyPnr.data },
  );

  // ---- Happy-path booking ----
  console.log('\n=== HAPPY PATH BOOKING ===');
  let hBook;
  try {
    hBook = await bookConfirmed(flight, 33);
  } catch (e) {
    console.warn('book retry', e.message);
    hBook = await bookConfirmed(flight, 40);
  }
  console.log('H-BR', hBook.br, hBook.wait.status, hBook.pnr);
  if (String(hBook.wait.status).toLowerCase() !== 'confirmed' || !hBook.pnr) {
    throw new Error('happy booking not ready');
  }

  const pen = await cancelCall(client, hBook.br, { action: 'PENALTY', pnr: hBook.pnr });
  console.log('PENALTY', pen.status, brief(pen.data, 300));

  const cancel = await cancelCall(client, hBook.br, { action: 'CANCEL', pnr: hBook.pnr });
  console.log('CANCEL', cancel.status, brief(cancel.data, 300));
  note(
    'CHK-2',
    ok(cancel) ? 'INFO' : 'BUG',
    'CANCEL response',
    cancel.data,
  );

  // poll until cancelled / cancellation_requested
  const cancelWait = await waitStatus(
    flight,
    hBook.br,
    (s) => /cancel/i.test(s),
    48,
  );
  note(
    'BUG-5',
    /cancel/i.test(String(cancelWait.status)) ? 'OK' : 'BUG',
    'After CANCEL, booking status should become Cancelled or Cancellation_Requested',
    { status: cancelWait.status, timedOut: cancelWait.timedOut, body: cancelWait.response?.data },
  );

  // try reschedule if eligible
  const pricedH = await priceFresh(flight, 35);
  const reschedule = await issueRaw(client, {
    ...buildIssueTicketPayload({
      bookingContext: pricedH.bookingContext,
      priceId: pricedH.priceId,
      searchIds: pricedH.searchIds,
    }),
    reschedulingReferenceId: hBook.br,
    reschedulingPnr: hBook.pnr,
  });
  const newBr = reschedule.data?.bookingReference || reschedule.data?.bookingReferenceId || null;
  note(
    'CHK-3',
    ok(reschedule) && newBr ? 'OK' : 'BUG',
    'Reschedule issue-ticket happy path',
    { http: reschedule.status, newBr, code: reschedule.data?.error?.code, body: reschedule.data },
  );

  let newStatus = null;
  if (newBr) {
    const w = await waitStatus(flight, newBr, (s) => isTerminalBookingStatus(s), 40);
    newStatus = w.status;
    note(
      'CHK-4',
      String(newStatus).toLowerCase() === 'confirmed' ? 'OK' : 'BUG',
      'Rescheduled booking terminal status',
      { newBr, newStatus, body: w.response?.data },
    );
  }

  // wrong pnr on eligible/cancelled booking if we got there
  if (/cancel/i.test(String(cancelWait.status))) {
    const pricedW = await priceFresh(flight, 36);
    const badPnr = await issueRaw(client, {
      ...buildIssueTicketPayload({
        bookingContext: pricedW.bookingContext,
        priceId: pricedW.priceId,
        searchIds: pricedW.searchIds,
      }),
      reschedulingReferenceId: hBook.br,
      reschedulingPnr: 'XXXXXX',
    });
    note(
      'CHK-5',
      badPnr.status === 422 || badPnr.status === 400 || badPnr.status === 404 ? 'OK' : 'GAP',
      'Reschedule with wrong pnr after cancel',
      { http: badPnr.status, code: badPnr.data?.error?.code, body: badPnr.data },
    );
  }

  const report = {
    baseUrl: config.baseUrl,
    validationBooking: { br: vBook.br, pnr: vBook.pnr, status: vBook.wait.status },
    happyBooking: { br: hBook.br, pnr: hBook.pnr, statusAfterCancel: cancelWait.status, newBr, newStatus },
    findings,
    bugs: findings.filter((f) => f.severity === 'BUG'),
    gaps: findings.filter((f) => f.severity === 'GAP'),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`${f.severity}\t${f.id}\t${f.title}`);
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
