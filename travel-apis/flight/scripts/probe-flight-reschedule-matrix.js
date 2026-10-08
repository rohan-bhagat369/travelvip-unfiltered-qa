/**
 * Flight reschedule + cancel(pnr) validation matrix on staging.
 *
 * Flow (docs):
 *  1) Book OW → Confirmed
 *  2) PENALTY/CANCEL with required `pnr` (one PNR per call)
 *  3) Search/price new flight
 *  4) issue-ticket with reschedulingReferenceId + reschedulingPnr
 *
 * Also runs negative/validation cases for the new fields.
 *
 * Run:
 *   node scripts/probe-flight-reschedule-matrix.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join('reports', 'flight-reschedule-matrix-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}

function brief(data, n = 500) {
  try {
    return JSON.stringify(data).slice(0, n);
  } catch {
    return String(data).slice(0, n);
  }
}

function extractAirlinePnrs(detailData) {
  const found = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      if (
        typeof v === 'string'
        && v.trim()
        && v.length >= 5
        && v.length <= 12
        && !v.startsWith('BR')
        && /^(pnr|airlinepnr|airline_pnr|bookingpnr|gdsPnr|providerPnr)$/i.test(k)
      ) {
        found.add(v.trim());
      }
      if (
        (key === 'pnr' || key.endsWith('pnr'))
        && typeof v === 'string'
        && v.trim()
        && !v.startsWith('BR')
        && v.length <= 20
      ) {
        // skip pipe-joined multi if present as single field for now; still record
        String(v)
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((p) => found.add(p));
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return [...found];
}

function isValidationLike(res) {
  const d = res?.data || {};
  const msg = JSON.stringify(d).toLowerCase();
  return (
    res?.status === 400
    || d?.title === 'Method argument not valid'
    || Array.isArray(d?.fieldErrors)
    || /required|must not|invalid|missing|validation/.test(msg)
  );
}

function isBusinessReject(res) {
  const d = res?.data || {};
  const msg = JSON.stringify(d).toLowerCase();
  return (
    !ok(res)
    || d?.requestStatus === 'Failed'
    || d?.status === -1
    || /failed|error|cannot|not allowed|already|invalid/.test(msg)
  );
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitConfirmed(flight, br, maxAttempts = 40) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = last.data?.status;
    if (ok(last) && isTerminalBookingStatus(st)) {
      return { status: st, response: last };
    }
    await sleep(5000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function priceFresh(flight, daysOffset = 20) {
  const body = buildOneWaySearchBody(daysOffset, {
    origin: 'DEL',
    destination: 'BOM',
    maxStops: 0,
    fareType: 'NORMAL',
  });
  const { response: search, searchId } = await flight.searchUntilComplete(body);
  if (!searchId) throw new Error(`No searchId: ${brief(search.data)}`);
  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!ok(pricing)) throw new Error(`Pricing failed: ${brief(pricing.data)}`);
  return {
    searchId,
    searchIds: [searchId],
    priceId: pricing.data?.priceId,
    bookingContext: pricing.data?.bookingContext || pricing.data?.requestReference,
    pricing,
    travelDate: body.itinerary[0].date,
  };
}

async function bookConfirmed(flight, daysOffset) {
  const priced = await priceFresh(flight, daysOffset);
  const issue = await flight.issueTicket({
    bookingContext: priced.bookingContext,
    priceId: priced.priceId,
    searchIds: priced.searchIds,
    journeyType: 'ONE_WAY',
  });
  if (!ok(issue)) throw new Error(`Issue failed: ${brief(issue.data)}`);
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
  if (!br) throw new Error(`No BR in issue: ${brief(issue.data)}`);
  const wait = await waitConfirmed(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractAirlinePnrs(detail.data);
  return {
    br,
    pnrs,
    pnr: pnrs[0] || null,
    issue,
    wait,
    detail,
    priced,
  };
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

  const cases = [];
  const record = (id, title, res, expect, extra = {}) => {
    const http = res?.status;
    const validation = isValidationLike(res);
    const rejected = isBusinessReject(res);
    const passed = typeof expect === 'function'
      ? expect({ res, http, validation, rejected, ok: ok(res) })
      : Boolean(expect);
    const row = {
      id,
      title,
      http,
      ok: ok(res),
      validation,
      rejected,
      passed,
      message: res?.data?.message || res?.data?.title || res?.data?.errors?.[0]?.error || null,
      snippet: brief(res?.data, 350),
      ...extra,
    };
    cases.push(row);
    console.log(`\n[${row.passed ? 'PASS' : 'FAIL'}] ${id} ${title} HTTP ${http}`);
    if (row.message) console.log(' ', row.message);
    else console.log(' ', row.snippet);
    return row;
  };

  // ---------- Book original ----------
  console.log('\n=== BOOK ORIGINAL OW ===');
  let booking;
  try {
    booking = await bookConfirmed(flight, 18);
  } catch (e) {
    // retry alternate date
    console.warn('Book attempt 1 failed:', e.message);
    booking = await bookConfirmed(flight, 25);
  }
  console.log('BR:', booking.br, 'status:', booking.wait.status, 'pnrs:', booking.pnrs);

  if (String(booking.wait.status).toLowerCase() !== 'confirmed') {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: 'original not confirmed', booking, cases }, null, 2));
    throw new Error(`Original booking not confirmed: ${booking.wait.status}`);
  }
  if (!booking.pnr) {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ error: 'no pnr extracted', bookingDetail: booking.detail.data, cases }, null, 2));
    throw new Error('Could not extract airline PNR from booking detail');
  }

  const br = booking.br;
  const pnr = booking.pnr;

  // ---------- Cancel validations (before real cancel) ----------
  console.log('\n=== CANCEL FIELD VALIDATIONS ===');

  record(
    'C1',
    'CANCEL missing pnr',
    await cancelCall(client, br, { action: 'CANCEL' }),
    ({ validation, rejected }) => validation || rejected,
  );

  record(
    'C2',
    'PENALTY missing pnr',
    await cancelCall(client, br, { action: 'PENALTY' }),
    ({ validation, rejected }) => validation || rejected,
  );

  record(
    'C3',
    'CANCEL empty pnr',
    await cancelCall(client, br, { action: 'CANCEL', pnr: '' }),
    ({ validation, rejected }) => validation || rejected,
  );

  record(
    'C4',
    'CANCEL invalid pnr',
    await cancelCall(client, br, { action: 'CANCEL', pnr: 'ZZZZZZ' }),
    ({ validation, rejected }) => validation || rejected,
  );

  record(
    'C5',
    'CANCEL missing action',
    await cancelCall(client, br, { pnr }),
    ({ validation, rejected }) => validation || rejected,
  );

  record(
    'C6',
    'CANCEL invalid action',
    await cancelCall(client, br, { action: 'RESCHEDULE', pnr }),
    ({ validation, rejected }) => validation || rejected,
  );

  record(
    'C7',
    'PENALTY_AND_CANCEL without pnr (legacy)',
    await cancelCall(client, br, { action: 'PENALTY_AND_CANCEL', retryCount: 2 }),
    ({ res }) => true, // observational — pass always, note behaviour
    { observational: true },
  );

  // ---------- Valid PENALTY ----------
  const penalty = await cancelCall(client, br, { action: 'PENALTY', pnr });
  record(
    'C8',
    'PENALTY with valid pnr',
    penalty,
    ({ ok: isOk }) => isOk,
    {
      estimatedCancellationCharge: penalty.data?.estimatedCancellationCharge,
      estimatedRefund: penalty.data?.estimatedRefund,
      totalPenalityAmount: penalty.data?.data?.totalPenalityAmount,
    },
  );

  // ---------- Price new flight for reschedule negatives + happy ----------
  console.log('\n=== PRICE NEW FLIGHT (reschedule target) ===');
  const newPriced = await priceFresh(flight, 22);
  console.log('New travelDate:', newPriced.travelDate, 'searchId:', newPriced.searchId);

  const baseIssue = buildIssueTicketPayload({
    bookingContext: newPriced.bookingContext,
    priceId: newPriced.priceId,
    searchIds: newPriced.searchIds,
    journeyType: 'ONE_WAY',
  });

  // Reschedule BEFORE cancel — should fail
  record(
    'R1',
    'issue-ticket reschedule while original PNR still active',
    await issueRaw(client, {
      ...baseIssue,
      reschedulingReferenceId: br,
      reschedulingPnr: pnr,
    }),
    ({ rejected, ok: isOk }) => rejected || !isOk,
  );

  // Need a fresh pricing context after R1 may have consumed it — reprice
  const newPriced2 = await priceFresh(flight, 23);
  const baseIssue2 = buildIssueTicketPayload({
    bookingContext: newPriced2.bookingContext,
    priceId: newPriced2.priceId,
    searchIds: newPriced2.searchIds,
    journeyType: 'ONE_WAY',
  });

  // ---------- Real CANCEL ----------
  console.log('\n=== CANCEL ORIGINAL PNR ===');
  const cancel = await cancelCall(client, br, { action: 'CANCEL', pnr });
  record(
    'C9',
    'CANCEL with valid pnr',
    cancel,
    ({ ok: isOk, res }) => isOk && String(res?.data?.requestStatus || '').toLowerCase() !== 'failed'
      && !(res?.data?.data?.failedCount > 0 && res?.data?.data?.successCount === 0),
  );

  // Double cancel
  record(
    'C10',
    'CANCEL same pnr again (double cancel)',
    await cancelCall(client, br, { action: 'CANCEL', pnr }),
    ({ rejected, ok: isOk }) => rejected || !isOk,
  );

  // ---------- Reschedule field validations ----------
  console.log('\n=== RESCHEDULE FIELD VALIDATIONS ===');

  record(
    'R2',
    'issue-ticket missing reschedulingPnr (only referenceId)',
    await issueRaw(client, {
      ...baseIssue2,
      reschedulingReferenceId: br,
    }),
    ({ rejected, validation, ok: isOk }) => validation || rejected || !isOk,
  );

  const newPriced3 = await priceFresh(flight, 24);
  const baseIssue3 = buildIssueTicketPayload({
    bookingContext: newPriced3.bookingContext,
    priceId: newPriced3.priceId,
    searchIds: newPriced3.searchIds,
    journeyType: 'ONE_WAY',
  });

  record(
    'R3',
    'issue-ticket missing reschedulingReferenceId (only pnr)',
    await issueRaw(client, {
      ...baseIssue3,
      reschedulingPnr: pnr,
    }),
    ({ rejected, validation, ok: isOk }) => validation || rejected || !isOk,
  );

  const newPriced4 = await priceFresh(flight, 26);
  const baseIssue4 = buildIssueTicketPayload({
    bookingContext: newPriced4.bookingContext,
    priceId: newPriced4.priceId,
    searchIds: newPriced4.searchIds,
    journeyType: 'ONE_WAY',
  });

  record(
    'R4',
    'issue-ticket wrong reschedulingReferenceId',
    await issueRaw(client, {
      ...baseIssue4,
      reschedulingReferenceId: 'BR0000000000000000',
      reschedulingPnr: pnr,
    }),
    ({ rejected, validation, ok: isOk }) => validation || rejected || !isOk,
  );

  const newPriced5 = await priceFresh(flight, 27);
  const baseIssue5 = buildIssueTicketPayload({
    bookingContext: newPriced5.bookingContext,
    priceId: newPriced5.priceId,
    searchIds: newPriced5.searchIds,
    journeyType: 'ONE_WAY',
  });

  record(
    'R5',
    'issue-ticket wrong reschedulingPnr',
    await issueRaw(client, {
      ...baseIssue5,
      reschedulingReferenceId: br,
      reschedulingPnr: 'XXXXXX',
    }),
    ({ rejected, validation, ok: isOk }) => validation || rejected || !isOk,
  );

  const newPriced6 = await priceFresh(flight, 28);
  const baseIssue6 = buildIssueTicketPayload({
    bookingContext: newPriced6.bookingContext,
    priceId: newPriced6.priceId,
    searchIds: newPriced6.searchIds,
    journeyType: 'ONE_WAY',
  });

  record(
    'R6',
    'issue-ticket empty rescheduling fields',
    await issueRaw(client, {
      ...baseIssue6,
      reschedulingReferenceId: '',
      reschedulingPnr: '',
    }),
    ({ rejected, validation, ok: isOk }) => {
      // empty may be treated as normal new booking — flag as gap if it succeeds as normal book
      return true;
    },
    {
      observational: true,
      note: 'If HTTP 200, empty strings were ignored (treated as normal book) — document as gap/bug',
    },
  );

  // ---------- Happy path reschedule ----------
  console.log('\n=== HAPPY PATH RESCHEDULE ===');
  const happyPriced = await priceFresh(flight, 30);
  const happyBody = buildIssueTicketPayload({
    bookingContext: happyPriced.bookingContext,
    priceId: happyPriced.priceId,
    searchIds: happyPriced.searchIds,
    journeyType: 'ONE_WAY',
  });
  const happyIssue = await issueRaw(client, {
    ...happyBody,
    reschedulingReferenceId: br,
    reschedulingPnr: pnr,
  });
  const newBr = happyIssue.data?.bookingReference
    || happyIssue.data?.bookingReferenceId
    || happyIssue.data?.bookingRefId
    || null;
  record(
    'R7',
    'issue-ticket reschedule happy path',
    happyIssue,
    ({ ok: isOk }) => isOk && Boolean(newBr),
    { newBr, travelDate: happyPriced.travelDate },
  );

  let newStatus = null;
  let newDetail = null;
  let newPnrs = [];
  if (newBr) {
    const waitNew = await waitConfirmed(flight, newBr);
    newStatus = waitNew.status;
    newDetail = await flight.getBookingDetail(newBr);
    newPnrs = extractAirlinePnrs(newDetail.data);
    record(
      'R8',
      'rescheduled booking reaches Confirmed',
      waitNew.response,
      () => String(newStatus).toLowerCase() === 'confirmed',
      { newStatus, newPnrs },
    );
  }

  const oldStatus = await flight.getBookingStatus(br);
  record(
    'R9',
    'original booking status after reschedule',
    oldStatus,
    () => true,
    {
      observational: true,
      oldStatus: oldStatus.data?.status,
      note: 'Expect Cancelled / Rescheduled / similar terminal state',
    },
  );

  // Replay same reschedule refs against another priced flight
  const replayPriced = await priceFresh(flight, 32);
  const replayBody = buildIssueTicketPayload({
    bookingContext: replayPriced.bookingContext,
    priceId: replayPriced.priceId,
    searchIds: replayPriced.searchIds,
    journeyType: 'ONE_WAY',
  });
  record(
    'R10',
    'reuse same reschedulingPnr after successful reschedule',
    await issueRaw(client, {
      ...replayBody,
      reschedulingReferenceId: br,
      reschedulingPnr: pnr,
    }),
    ({ rejected, ok: isOk }) => rejected || !isOk,
  );

  const summary = {
    baseUrl: config.baseUrl,
    original: { br, pnr, pnrs: booking.pnrs, status: booking.wait.status },
    reschedule: { newBr, newStatus, newPnrs, travelDate: happyPriced.travelDate },
    totals: {
      total: cases.length,
      passed: cases.filter((c) => c.passed).length,
      failed: cases.filter((c) => !c.passed).length,
      observational: cases.filter((c) => c.observational).length,
    },
    cases,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log('Report:', OUT);
  console.log('Failed:', cases.filter((c) => !c.passed).map((c) => c.id + ' ' + c.title));
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exitCode = 1;
});
