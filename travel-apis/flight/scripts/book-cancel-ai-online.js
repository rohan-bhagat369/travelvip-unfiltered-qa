/**
 * Book + cancel using airlines that support online cancel on staging.
 * Prior matrix: AI works; 6E offline-only; IX "waiting for cancellation".
 *
 * 1) OW DEL-BOM Air India — single PNR cancel
 * 2) RT DEL-BOM mixed (prefer AI + other) — cancel each PNR
 *
 * Run: node scripts/book-cancel-ai-online.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  extractFirstSearchId,
  extractSearchIds,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-cancel-ai-online-staging.json');
const Q = { ...FLIGHT_QUERY };

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 600) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractPnrs(detailData) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 12) return;
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

function cancelMsg(body) {
  return body?.data?.cancellationRequest?.message
    || body?.cancellationRequest?.message
    || body?.error?.message
    || body?.message
    || null;
}
function cancelStatus(body) {
  return body?.data?.cancellationRequest?.status
    || body?.cancellationRequest?.status
    || null;
}
function cancelOk(body) {
  const st = String(cancelStatus(body) || '');
  const msg = String(cancelMsg(body) || '');
  if (/fail|waiting|unavailable|offline|customer care/i.test(st + ' ' + msg)) return false;
  if (/success|cancel/i.test(st) && !/fail/i.test(st)) return true;
  // some APIs return status 0 Success at top with nested cancellationRequest
  return !/waiting|unavailable online|customer care|Penalty Check Failed|Cancellation Failed/i.test(msg);
}

function airlineOf(opt) {
  return opt?.segments?.[0]?.airline?.code || null;
}

function optSummary(opt) {
  return (opt?.segments || []).map((s) => ({
    flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
    route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
    dep: s.departure?.time,
  }));
}

async function waitTerm(flight, br, max = 48) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', i + 1, st);
    if (isTerminalBookingStatus(st)) return { status: st, response: last };
    await sleep(5000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function cancelApi(client, br, body) {
  const payload = { retryCount: 2, ...body };
  const res = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  return {
    endpoint: `POST /v1/flights/booking/${br}/cancel`,
    payload,
    http: res.status,
    body: res.data,
    cancelStatus: cancelStatus(res.data),
    message: cancelMsg(res.data),
    ok: cancelOk(res.data),
  };
}

async function issueV2(client, payload) {
  return client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function bookOwAi(flight, client) {
  const attempts = [];
  for (const days of [30, 40, 50]) {
    const body = buildOneWaySearchBody(days, {
      origin: 'DEL', destination: 'BOM', maxStops: 0, fareType: 'NORMAL',
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences = { airlines: ['AI'], maxStops: 0, refundableOnly: false };

    console.log(`\nOW search AI DEL-BOM days=${days}`);
    let last;
    let sid = null;
    for (let i = 0; i < 14; i += 1) {
      last = await flight.search(body);
      const ids = extractSearchIds(last.data, 30);
      // prefer AI from options
      const opts = last.data?.results?.[0]?.options || last.data?.results?.flatMap?.((r) => r.options) || [];
      const ai = (opts || []).filter((o) => airlineOf(o) === 'AI');
      sid = ai[0]?.searchId || extractFirstSearchId(last.data);
      const st = String(last.data?.progress?.state || '').toUpperCase();
      console.log('  poll', i + 1, 'aiOpts', ai.length, 'sid', sid, st);
      if (ok(last) && sid && (st === 'COMPLETE' || ai.length)) break;
      await sleep(3000);
    }
    if (!sid) {
      attempts.push({ days, error: 'no searchId' });
      continue;
    }

    const pricing = await flight.getPricing([sid], 'ONE_WAY');
    if (!ok(pricing) || !pricing.data?.priceId) {
      attempts.push({ days, error: 'pricing', snippet: brief(pricing.data, 200) });
      continue;
    }
    const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
    console.log('OW pricing', total);

    const issue = await issueV2(client, buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [sid],
      journeyType: 'ONE_WAY',
    }));
    console.log('OW issue', issue.status, brief(issue.data, 220));
    const br = issue.data?.bookingReference;
    if (!br) {
      attempts.push({ days, error: 'issue', snippet: brief(issue.data, 300) });
      if (/INSUFFICIENT|wallet|balance/i.test(brief(issue.data))) break;
      continue;
    }

    const wait = await waitTerm(flight, br);
    const detail = await flight.getBookingDetail(br);
    const pnrs = extractPnrs(detail.data);
    return {
      days, br, status: wait.status, pnrs, total,
      searchId: sid, detailSnippet: brief(detail.data, 400),
    };
  }
  return { error: 'OW AI book failed', attempts };
}

async function bookRtPreferAi(flight, client) {
  for (const [od, rd] of [[36, 43], [45, 52]]) {
    const body = buildRoundTripSearchBody(od, rd, {
      origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL',
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences = { airlines: [], maxStops: null, refundableOnly: false };
    delete body.preferences.maxStops;

    console.log(`\nRT search DEL-BOM ${od}/${rd}`);
    const { response } = await flight.searchRoundTripUntilComplete(body);
    const blocks = response.data?.results || [];
    const onward = (blocks.find((r) => /ONWARD/i.test(r.direction)) || {}).options || [];
    const ret = (blocks.find((r) => /RETURN/i.test(r.direction)) || {}).options || [];
    console.log('options', onward.length, ret.length);

    // Prefer pairs involving AI (known online-cancelable)
    const scored = [];
    for (const o of onward.slice(0, 12)) {
      for (const r of ret.slice(0, 12)) {
        if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
        const ao = airlineOf(o);
        const ar = airlineOf(r);
        const hasAi = ao === 'AI' || ar === 'AI';
        const mixed = ao && ar && ao !== ar;
        scored.push({ o, r, ao, ar, hasAi, mixed, score: (hasAi ? 10 : 0) + (mixed ? 5 : 0) });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    for (const cand of scored.slice(0, 15)) {
      const pricing = await flight.getPricing([cand.o.searchId, cand.r.searchId], 'ROUND_TRIP');
      if (!ok(pricing) || !pricing.data?.priceId) continue;
      const total = Number(pricing.data?.pricing?.totalAmount || pricing.data?.totalAmount || 0);
      console.log('RT try', cand.ao, cand.ar, 'mixed', cand.mixed, 'hasAi', cand.hasAi, 'total', total);

      const issue = await issueV2(client, buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [cand.o.searchId, cand.r.searchId],
        journeyType: 'ROUND_TRIP',
      }));
      console.log('RT issue', issue.status, brief(issue.data, 220));
      const br = issue.data?.bookingReference;
      if (!br) {
        if (/INSUFFICIENT|wallet|balance/i.test(brief(issue.data))) {
          return { error: 'wallet', snippet: brief(issue.data, 300) };
        }
        continue;
      }

      const wait = await waitTerm(flight, br);
      if (!/confirm/i.test(String(wait.status))) {
        console.log('RT not confirmed', wait.status);
        continue;
      }
      const detail = await flight.getBookingDetail(br);
      const pnrs = extractPnrs(detail.data);
      return {
        br,
        status: wait.status,
        pnrs,
        total,
        airlines: [cand.ao, cand.ar],
        mixed: cand.mixed,
        hasAi: cand.hasAi,
        onward: optSummary(cand.o),
        return: optSummary(cand.r),
      };
    }
  }
  return { error: 'RT book failed' };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Strategy: prefer AI (online cancel works on staging)');
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const report = { baseUrl: config.baseUrl, generatedAt: new Date().toISOString() };

  // ─── OW AI ───
  console.log('\n========== OW AI SINGLE PNR ==========');
  const ow = await bookOwAi(flight, client);
  report.ow = { book: ow };

  if (ow.br && /confirm/i.test(String(ow.status)) && ow.pnrs?.[0]) {
    const pnr = ow.pnrs[0];
    const penalty = await cancelApi(client, ow.br, { action: 'PENALTY', pnr });
    console.log('OW PENALTY', penalty.cancelStatus, penalty.message);
    const cancel = await cancelApi(client, ow.br, { action: 'CANCEL', pnr });
    console.log('OW CANCEL', cancel.cancelStatus, cancel.message);

    let statusAfter = await flight.getBookingStatus(ow.br);
    for (let i = 0; i < 15 && !/cancel/i.test(String(statusAfter.data?.status || '')); i += 1) {
      await sleep(4000);
      statusAfter = await flight.getBookingStatus(ow.br);
      console.log('  OW post-cancel', statusAfter.data?.status);
      if (cancel.ok) break;
      if (i === 2 && !cancel.ok) break; // don't wait forever on failed cancel
    }

    report.ow.penalty = penalty;
    report.ow.cancel = cancel;
    report.ow.statusAfterCancel = statusAfter.data?.status;
  } else {
    console.log('OW skip cancel', brief(ow, 300));
  }

  // ─── RT ───
  console.log('\n========== RT (prefer AI / dual PNR) ==========');
  const rt = await bookRtPreferAi(flight, client);
  report.rt = { book: rt };

  if (rt.br && /confirm/i.test(String(rt.status))) {
    const cancels = [];
    const pnrs = rt.pnrs?.length ? rt.pnrs : [null];
    for (const pnr of pnrs.slice(0, 2)) {
      const bodyPen = pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' };
      const bodyCan = pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' };
      const penalty = await cancelApi(client, rt.br, bodyPen);
      console.log('RT PENALTY', pnr, penalty.cancelStatus, penalty.message);
      const cancel = await cancelApi(client, rt.br, bodyCan);
      console.log('RT CANCEL', pnr, cancel.cancelStatus, cancel.message);
      const st = await flight.getBookingStatus(rt.br);
      cancels.push({ pnr, penalty, cancel, statusAfter: st.data?.status });
      await sleep(3000);
      if (!cancel.ok && pnrs.length === 1) break;
    }

    let statusAfter = await flight.getBookingStatus(rt.br);
    for (let i = 0; i < 12; i += 1) {
      if (/cancel/i.test(String(statusAfter.data?.status || ''))) break;
      await sleep(4000);
      statusAfter = await flight.getBookingStatus(rt.br);
      console.log('  RT post-cancel', statusAfter.data?.status);
    }
    report.rt.cancels = cancels;
    report.rt.statusAfterCancel = statusAfter.data?.status;
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== DONE ===');
  console.log(JSON.stringify({
    ow: {
      br: report.ow?.book?.br,
      pnrs: report.ow?.book?.pnrs,
      cancelOk: report.ow?.cancel?.ok,
      cancelMsg: report.ow?.cancel?.message,
      statusAfter: report.ow?.statusAfterCancel,
    },
    rt: {
      br: report.rt?.book?.br,
      pnrs: report.rt?.book?.pnrs,
      airlines: report.rt?.book?.airlines,
      cancels: (report.rt?.cancels || []).map((c) => ({
        pnr: c.pnr, ok: c.cancel?.ok, msg: c.cancel?.message, statusAfter: c.statusAfter,
      })),
      statusAfter: report.rt?.statusAfterCancel,
    },
    report: OUT,
  }, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
