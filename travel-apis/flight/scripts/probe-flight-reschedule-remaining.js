/**
 * Remaining flight reschedule cases + Round Trip dual-PNR matrix.
 * Skips deep re-runs of already-filed BUG-1/2/3/5 (light control only).
 *
 * Run: node scripts/probe-flight-reschedule-remaining.js
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
process.env.MATTERMOST_CHANNEL = process.env.MATTERMOST_CHANNEL || 'backend-alerts-dev';

import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  extractFirstSearchId,
  extractOnwardSearchId,
  extractReturnSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import {
  fetchRecentAlertPosts,
  mattermostConfigured,
} from './lib/mattermostVendorAlerts.js';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join('reports', 'flight-reschedule-remaining-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 600) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function extractAirlinePnrs(detailData) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /pnr/i.test(k) && !v.startsWith('BR') && v.length <= 24) {
        for (const p of String(v).split('|').map((x) => x.trim()).filter(Boolean)) {
          if (!seen.has(p)) { seen.add(p); found.push(p); }
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return found;
}

async function waitStatus(flight, br, pred, maxAttempts = 40) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (ok(last) && pred(st, last.data)) return { status: st, response: last };
    await sleep(5000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function webhookFor(br, sinceMs = Date.now() - 120000) {
  if (!mattermostConfigured()) return [];
  const posts = await fetchRecentAlertPosts({ perPage: 50 });
  return posts
    .filter((p) => (p.message || '').includes(br) && (p.create_at || 0) >= sinceMs)
    .map((p) => {
      const m = p.message || '';
      return {
        created: new Date(p.create_at).toISOString(),
        status: (m.match(/status `([^`]+)`/i) || [])[1] || null,
        preview: m.replace(/\n/g, ' | ').slice(0, 220),
      };
    });
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

async function priceOW(flight, days = 40) {
  const routes = [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'HYD'], ['BLR', 'HYD']];
  let best = null;
  for (const [origin, destination] of routes) {
    const body = buildOneWaySearchBody(days, {
      origin, destination, maxStops: 0, fareType: 'NORMAL',
    });
    let sid = null;
    for (let i = 0; i < 12; i += 1) {
      const search = await flight.search(body);
      sid = extractFirstSearchId(search.data);
      const st = String(search.data?.progress?.state || '').toUpperCase();
      if (ok(search) && sid && (st === 'COMPLETE' || i >= 3)) break;
      await sleep(3500);
    }
    if (!sid) continue;
    // try a few options for cheapest
    const { searchIds } = await flight.searchUntilComplete(body).catch(async () => {
      const s = await flight.search(body);
      return { searchIds: [extractFirstSearchId(s.data)].filter(Boolean) };
    });
    for (const searchId of (searchIds || [sid]).slice(0, 4)) {
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!ok(pricing)) continue;
      const total = Number(pricing.data?.pricing?.totalAmount ?? Infinity);
      if (!best || total < best.total) {
        best = {
          journeyType: 'ONE_WAY',
          origin, destination, total, searchId, searchIds: [searchId],
          priceId: pricing.data.priceId,
          bookingContext: pricing.data.bookingContext || pricing.data.requestReference,
          travelDate: body.itinerary[0].date,
        };
      }
      if (total <= 3500) return best;
    }
  }
  if (!best) throw new Error('OW pricing failed');
  return best;
}

async function priceRT(flight, onwardDays = 35, returnDays = 42) {
  const pairs = [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'BLR']];
  for (const [origin, destination] of pairs) {
    const body = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin, destination, maxStops: 0, fareType: 'NORMAL',
    });
    let search;
    try {
      const r = await flight.searchRoundTripUntilComplete(body);
      search = r.response;
    } catch {
      continue;
    }
    const onward = extractOnwardSearchId(search.data);
    const ret = extractReturnSearchId(search.data);
    if (!onward || !ret) continue;
    const pricing = await flight.getPricing([onward, ret], 'ROUND_TRIP');
    if (!ok(pricing)) continue;
    const total = Number(pricing.data?.pricing?.totalAmount ?? Infinity);
    return {
      journeyType: 'ROUND_TRIP',
      origin, destination, total,
      searchIds: [onward, ret],
      priceId: pricing.data.priceId,
      bookingContext: pricing.data.bookingContext || pricing.data.requestReference,
      travelDate: body.itinerary[0].date,
      returnDate: body.itinerary[1].date,
    };
  }
  throw new Error('RT pricing failed');
}

async function bookAndConfirm(flight, priced) {
  const issue = await flight.issueTicket({
    bookingContext: priced.bookingContext,
    priceId: priced.priceId,
    searchIds: priced.searchIds,
    journeyType: priced.journeyType,
  });
  const msg = JSON.stringify(issue.data || {});
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!ok(issue) || !br || /insufficient wallet/i.test(msg)) {
    throw new Error(`issue failed ${issue.status} ${brief(issue.data)}`);
  }
  const wait = await waitStatus(flight, br, (s) => isTerminalBookingStatus(s), 48);
  if (String(wait.status).toLowerCase() === 'failed') {
    throw new Error(`booking failed ${br} ${brief(wait.response?.data)}`);
  }
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractAirlinePnrs(detail.data);
  return { br, pnrs, status: wait.status, issue, detail, priced };
}

function cancelLooksSuccess(res) {
  const d = res?.data || {};
  const st = String(
    d?.data?.cancellationRequest?.status
    || d?.cancellationRequest?.status
    || d?.data?.requestStatus
    || d?.requestStatus
    || '',
  ).toLowerCase();
  if (/fail/.test(st)) return false;
  if (d?.data?.failedCount > 0 && !(d?.data?.successCount > 0)) return false;
  if (/unavailable online|offline cancellation|waiting for cancellation/i.test(JSON.stringify(d))) {
    return false;
  }
  return ok(res);
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Mattermost:', process.env.MATTERMOST_CHANNEL, mattermostConfigured());

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const cases = [];
  const record = (id, title, extra = {}) => {
    const row = { id, title, ...extra, at: new Date().toISOString() };
    cases.push(row);
    const mark = row.passed === true ? 'PASS' : row.passed === false ? 'FAIL' : 'INFO';
    console.log(`\n[${mark}] ${id} ${title}`);
    if (row.http != null) console.log(' HTTP', row.http);
    if (row.message) console.log(' ', String(row.message).slice(0, 250));
    else if (row.snippet) console.log(' ', String(row.snippet).slice(0, 250));
    return row;
  };

  // ---------- Wallet smoke ----------
  console.log('\n=== WALLET / OW BOOK SMOKE ===');
  let owBook;
  try {
    const owPriced = await priceOW(flight, 38);
    record('W1', 'OW priced', { passed: true, total: owPriced.total, route: `${owPriced.origin}-${owPriced.destination}` });
    owBook = await bookAndConfirm(flight, owPriced);
    record('W2', 'OW booked Confirmed', {
      passed: String(owBook.status).toLowerCase() === 'confirmed' && owBook.pnrs.length > 0,
      br: owBook.br,
      status: owBook.status,
      pnrs: owBook.pnrs,
    });
  } catch (e) {
    record('W2', 'OW booked Confirmed', { passed: false, message: e.message });
    throw e;
  }

  // ---------- OW remaining: valid PENALTY → CANCEL → wait → reschedule ----------
  console.log('\n=== OW HAPPY PATH RESCHEDULE ===');
  const owPnr = owBook.pnrs[0];
  const pen = await cancelCall(client, owBook.br, { action: 'PENALTY', pnr: owPnr });
  record('OW1', 'PENALTY with valid pnr', {
    passed: ok(pen),
    http: pen.status,
    snippet: brief(pen.data, 350),
    cancelStatus: pen.data?.data?.cancellationRequest?.status,
  });

  const sinceCancel = Date.now() - 3000;
  const cancel = await cancelCall(client, owBook.br, { action: 'CANCEL', pnr: owPnr });
  const cancelOk = cancelLooksSuccess(cancel);
  record('OW2', 'CANCEL with valid pnr', {
    passed: cancelOk,
    http: cancel.status,
    snippet: brief(cancel.data, 400),
    cancelStatus: cancel.data?.data?.cancellationRequest?.status,
  });

  const after = await waitStatus(
    flight,
    owBook.br,
    (s) => /cancel/i.test(s),
    36,
  );
  const wh = await webhookFor(owBook.br, sinceCancel);
  record('OW3', 'OW status after cancel (API + webhook)', {
    passed: /cancel/i.test(String(after.status)) || wh.some((w) => /cancel/i.test(String(w.status || ''))),
    apiStatus: after.status,
    webhooks: wh,
    timedOut: after.timedOut,
  });

  let owRescheduleBr = null;
  if (/cancel/i.test(String(after.status)) || wh.some((w) => /cancellation_requested|cancelled/i.test(String(w.status || '')))) {
    const newPriced = await priceOW(flight, 45);
    const body = buildIssueTicketPayload({
      bookingContext: newPriced.bookingContext,
      priceId: newPriced.priceId,
      searchIds: newPriced.searchIds,
      journeyType: 'ONE_WAY',
    });
    const reschedule = await issueRaw(client, {
      ...body,
      reschedulingReferenceId: owBook.br,
      reschedulingPnr: owPnr,
    });
    owRescheduleBr = reschedule.data?.bookingReference || reschedule.data?.bookingReferenceId || null;
    record('OW4', 'OW reschedule issue-ticket', {
      passed: ok(reschedule) && Boolean(owRescheduleBr),
      http: reschedule.status,
      newBr: owRescheduleBr,
      code: reschedule.data?.error?.code || reschedule.data?.code,
      snippet: brief(reschedule.data, 400),
      newTotal: newPriced.total,
      newDate: newPriced.travelDate,
    });
    if (owRescheduleBr) {
      const w = await waitStatus(flight, owRescheduleBr, (s) => isTerminalBookingStatus(s), 40);
      record('OW5', 'OW rescheduled booking terminal', {
        passed: String(w.status).toLowerCase() === 'confirmed',
        newBr: owRescheduleBr,
        status: w.status,
      });
    }
  } else {
    record('OW4', 'OW reschedule issue-ticket', {
      passed: false,
      message: 'Skipped — cancel did not reach cancellable state',
      apiStatus: after.status,
      webhooks: wh,
    });
  }

  // ---------- RT dual PNR ----------
  console.log('\n=== ROUND TRIP DUAL PNR ===');
  let rtBook;
  try {
    const rtPriced = await priceRT(flight, 36, 43);
    record('RT0', 'RT priced', {
      passed: true,
      total: rtPriced.total,
      route: `${rtPriced.origin}-${rtPriced.destination}`,
      dates: [rtPriced.travelDate, rtPriced.returnDate],
    });
    rtBook = await bookAndConfirm(flight, rtPriced);
    record('RT1', 'RT booked Confirmed with PNRs', {
      passed: String(rtBook.status).toLowerCase() === 'confirmed',
      br: rtBook.br,
      status: rtBook.status,
      pnrs: rtBook.pnrs,
      pnrCount: rtBook.pnrs.length,
    });
  } catch (e) {
    record('RT1', 'RT booked Confirmed with PNRs', { passed: false, message: e.message });
  }

  if (rtBook?.br && rtBook.pnrs?.length) {
    const pnrs = rtBook.pnrs;
    const pnr1 = pnrs[0];
    const pnr2 = pnrs[1] || null;

    record('RT2', 'RT has two distinct PNRs', {
      passed: pnrs.length >= 2 && pnr1 !== pnr2,
      pnrs,
      note: pnrs.length < 2 ? 'Only one PNR returned — same-airline RT may share PNR' : 'OK',
    });

    // Cancel wrong PNR
    const bad = await cancelCall(client, rtBook.br, { action: 'CANCEL', pnr: 'ZZZZZZ' });
    record('RT3', 'RT CANCEL invalid pnr → PNR_INVALID', {
      passed: bad.status === 422 && bad.data?.error?.code === 'PNR_INVALID',
      http: bad.status,
      code: bad.data?.error?.code,
      snippet: brief(bad.data, 300),
    });

    // Pipe-joined both PNRs in one call (docs: one PNR per call)
    if (pnr2) {
      const both = await cancelCall(client, rtBook.br, {
        action: 'PENALTY',
        pnr: `${pnr1}|${pnr2}`,
      });
      record('RT4', 'RT PENALTY with pipe-joined two PNRs (should reject or only one)', {
        passed: true,
        observational: true,
        http: both.status,
        snippet: brief(both.data, 400),
        note: 'Docs say one PNR per call — observe behavior',
      });
    }

    // Cancel first PNR only
    const pen1 = await cancelCall(client, rtBook.br, { action: 'PENALTY', pnr: pnr1 });
    record('RT5', 'RT PENALTY pnr1 only', {
      passed: ok(pen1),
      http: pen1.status,
      snippet: brief(pen1.data, 350),
    });

    const sinceRt = Date.now() - 3000;
    const cancel1 = await cancelCall(client, rtBook.br, { action: 'CANCEL', pnr: pnr1 });
    const c1ok = cancelLooksSuccess(cancel1);
    record('RT6', 'RT CANCEL pnr1 only', {
      passed: c1ok,
      http: cancel1.status,
      snippet: brief(cancel1.data, 400),
      pnr: pnr1,
    });

    const stAfter1 = await waitStatus(flight, rtBook.br, () => true, 8);
    const detailAfter1 = await flight.getBookingDetail(rtBook.br);
    const pnrsAfter1 = extractAirlinePnrs(detailAfter1.data);
    record('RT7', 'RT status/detail after cancelling only pnr1', {
      passed: true,
      observational: true,
      apiStatus: stAfter1.status,
      pnrsAfter: pnrsAfter1,
      webhooks: await webhookFor(rtBook.br, sinceRt),
    });

    // Reschedule using cancelled pnr1 (if cancel worked) OR attempt and capture error
    const rtNew = await priceOW(flight, 47);
    const rsBody = buildIssueTicketPayload({
      bookingContext: rtNew.bookingContext,
      priceId: rtNew.priceId,
      searchIds: rtNew.searchIds,
      journeyType: 'ONE_WAY',
    });
    const rs1 = await issueRaw(client, {
      ...rsBody,
      reschedulingReferenceId: rtBook.br,
      reschedulingPnr: pnr1,
    });
    record('RT8', 'RT reschedule with pnr1 after cancel-one', {
      passed: true,
      observational: true,
      http: rs1.status,
      code: rs1.data?.error?.code || rs1.data?.code,
      newBr: rs1.data?.bookingReference || null,
      snippet: brief(rs1.data, 400),
    });

    // If second PNR exists and still active, cancel it
    if (pnr2) {
      const cancel2 = await cancelCall(client, rtBook.br, { action: 'CANCEL', pnr: pnr2 });
      record('RT9', 'RT CANCEL pnr2 (second PNR)', {
        passed: cancelLooksSuccess(cancel2) || ok(cancel2),
        http: cancel2.status,
        snippet: brief(cancel2.data, 400),
        pnr: pnr2,
      });

      const stAfter2 = await waitStatus(
        flight,
        rtBook.br,
        (s) => /cancel/i.test(s),
        24,
      );
      record('RT10', 'RT status after both PNRs cancel attempted', {
        passed: true,
        observational: true,
        apiStatus: stAfter2.status,
        webhooks: await webhookFor(rtBook.br, sinceRt),
      });

      // Reschedule with pnr2
      const rtNew2 = await priceOW(flight, 49);
      const rs2 = await issueRaw(client, {
        ...buildIssueTicketPayload({
          bookingContext: rtNew2.bookingContext,
          priceId: rtNew2.priceId,
          searchIds: rtNew2.searchIds,
        }),
        reschedulingReferenceId: rtBook.br,
        reschedulingPnr: pnr2,
      });
      record('RT11', 'RT reschedule with pnr2', {
        passed: true,
        observational: true,
        http: rs2.status,
        code: rs2.data?.error?.code || rs2.data?.code,
        newBr: rs2.data?.bookingReference || null,
        snippet: brief(rs2.data, 400),
      });

      // Reschedule reuse / mismatch after pnr2 cancel
      const misPriced = await priceOW(flight, 52);
      const mis = await issueRaw(client, {
        ...buildIssueTicketPayload({
          bookingContext: misPriced.bookingContext,
          priceId: misPriced.priceId,
          searchIds: misPriced.searchIds,
        }),
        reschedulingReferenceId: rtBook.br,
        reschedulingPnr: pnr1,
      });
      record('RT12', 'RT reschedule reuse pnr1 after actions', {
        passed: true,
        observational: true,
        http: mis.status,
        code: mis.data?.error?.code,
        snippet: brief(mis.data, 350),
      });
    }
  }

  // Light controls (already known bugs — confirm still present, don't deep dive)
  console.log('\n=== LIGHT CONTROLS (known bugs) ===');
  if (owBook?.br && owBook?.pnrs?.[0]) {
    // only if still confirmed somehow use another confirmed; else skip
  }
  const ctrlBr = rtBook?.status && String(rtBook.status).toLowerCase() === 'confirmed'
    ? rtBook
    : owBook;
  // Use a known confirmed if available via quick status
  let ctrl = null;
  for (const br of [owBook?.br, rtBook?.br, 'BR1786003631906129'].filter(Boolean)) {
    const s = await flight.getBookingStatus(br);
    if (/confirmed/i.test(String(s.data?.status || ''))) {
      const d = await flight.getBookingDetail(br);
      const pnrs = extractAirlinePnrs(d.data);
      if (pnrs[0]) { ctrl = { br, pnr: pnrs[0] }; break; }
    }
  }
  if (ctrl) {
    const missPnr = await cancelCall(client, ctrl.br, { action: 'PENALTY' });
    record('CTRL1', 'Known BUG-1 still: PENALTY missing pnr auto-fills', {
      passed: true,
      observational: true,
      stillBuggy: missPnr.status === 200 && Boolean(missPnr.data?.data?.pnr),
      http: missPnr.status,
      snippet: brief(missPnr.data, 250),
    });
  }

  const summary = {
    baseUrl: config.baseUrl,
    ow: { br: owBook?.br, pnrs: owBook?.pnrs, rescheduleBr: owRescheduleBr },
    rt: { br: rtBook?.br, pnrs: rtBook?.pnrs, status: rtBook?.status },
    totals: {
      total: cases.length,
      passed: cases.filter((c) => c.passed === true).length,
      failed: cases.filter((c) => c.passed === false).length,
      info: cases.filter((c) => c.passed == null || c.observational).length,
    },
    cases,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log('Failed:', cases.filter((c) => c.passed === false).map((c) => c.id + ' ' + c.title));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
