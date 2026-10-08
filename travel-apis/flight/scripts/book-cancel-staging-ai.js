/**
 * Staging book+cancel using AI only (only airline proven cancelable online).
 * Prior ref: BR1786015616687710 / PNR 8K7YV5 — CANCEL_WORKS on staging.
 *
 * 1) OW DEL-BOM AI — single PNR cancel (+ payload/response)
 * 2) RT DEL-BOM — prefer AI both legs; if 2 PNRs cancel each
 *
 * Run: node scripts/book-cancel-staging-ai.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  extractFirstSearchId,
  extractSearchIds,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-cancel-staging-ai.json');
const Q = { lang: 'en', currency: 'INR' };
const PRIOR_REF = {
  note: 'Previous successful online cancel on staging',
  bookingReference: 'BR1786015616687710',
  pnr: '8K7YV5',
  airline: 'AI',
  cancelStatus: 'Cancellation Requested',
};

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractPnrs(detailData) {
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

function airlineCode(opt) {
  return opt?.segments?.[0]?.airline?.code || null;
}

function classifyCancel(res) {
  const raw = JSON.stringify(res?.data || {});
  const st = String(res?.data?.data?.cancellationRequest?.status || res?.data?.cancellationRequest?.status || '');
  const msg = String(res?.data?.data?.cancellationRequest?.message || res?.data?.message || '');
  if (/unavailable online|offline cancellation/i.test(raw)) {
    return { ok: false, reason: 'VENDOR_OFFLINE_ONLY', status: st, message: msg };
  }
  if (/waiting for cancellation/i.test(raw)) {
    return { ok: false, reason: 'WAITING', status: st, message: msg };
  }
  if (/fail/i.test(st)) return { ok: false, reason: 'CANCEL_FAILED', status: st, message: msg };
  if (ok(res) && !/fail/i.test(st)) return { ok: true, reason: 'ACCEPTED', status: st || 'OK', message: msg };
  return { ok: false, reason: 'UNKNOWN', status: st, message: msg || brief(res.data, 200) };
}

async function waitConfirmed(flight, br, maxAttempts = 24) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', i + 1, st);
    if (isTerminalBookingStatus(st)) return { status: st, response: last };
    // if stuck Pending/InProgress too long, still return so we can try next fare
    await sleep(5000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function cancelCall(client, br, body) {
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
    responseBody: res.data,
    classified: classifyCancel(res),
  };
}

async function searchAiOw(flight, days) {
  const body = buildOneWaySearchBody(days, {
    origin: 'DEL', destination: 'BOM', maxStops: 0, fareType: 'NORMAL',
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  body.preferences = { airlines: ['AI'], maxStops: 0, refundableOnly: false };

  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.search(body);
    const opts = [];
    for (const block of last.data?.results || []) {
      for (const opt of block.options || []) opts.push(opt);
    }
    const ai = opts.filter((o) => airlineCode(o) === 'AI' && o.searchId);
    const st = String(last.data?.progress?.state || '').toUpperCase();
    console.log(`  OW poll ${i + 1} AI=${ai.length} state=${st}`);
    if (ai.length && (st === 'COMPLETE' || i >= 3)) {
      return ai.map((o) => ({
        searchId: o.searchId,
        flights: (o.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`),
      }));
    }
    if (!ok(last)) break;
    await sleep(3000);
  }
  const sid = extractFirstSearchId(last?.data);
  return sid ? [{ searchId: sid, flights: [] }] : [];
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Prior online-cancel ref:', PRIOR_REF);

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const report = {
    baseUrl: config.baseUrl,
    priorSuccessfulCancel: PRIOR_REF,
    generatedAt: new Date().toISOString(),
    ow: null,
    rt: null,
  };

  // ═══════ 1) OW AI ═══════
  console.log('\n=== OW AI DEL-BOM (online-cancelable) ===');
  let owDone = null;

  for (const days of [35, 42, 50, 28]) {
    console.log(`\nTry OW days=${days}`);
    const options = await searchAiOw(flight, days);
    if (!options.length) {
      console.log('no AI options');
      continue;
    }

    for (const opt of options.slice(0, 4)) {
      const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
      if (!ok(pricing) || !pricing.data?.priceId) {
        console.log('pricing fail', brief(pricing.data, 120));
        continue;
      }
      const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
      console.log('pricing', total, opt.flights);

      const issue = await flight.issueTicket({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [opt.searchId],
        journeyType: 'ONE_WAY',
      });
      console.log('issue', issue.status, brief(issue.data, 200));
      const br = issue.data?.bookingReference;
      if (!br) {
        if (/INSUFFICIENT|balance|wallet/i.test(brief(issue.data))) {
          report.ow = { error: 'wallet', snippet: brief(issue.data, 300) };
          break;
        }
        continue;
      }

      const wait = await waitConfirmed(flight, br, 20);
      if (!/confirm/i.test(String(wait.status))) {
        console.log('Not confirmed (skip — may be In Progress):', wait.status, br);
        // leave it; try next option
        continue;
      }

      const detail = await flight.getBookingDetail(br);
      const pnrs = extractPnrs(detail.data);
      console.log('Confirmed', br, 'PNRs', pnrs);

      const pnr = pnrs[0] || undefined;
      const penalty = await cancelCall(client, br, pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' });
      console.log('PENALTY', penalty.classified);
      const cancel = await cancelCall(client, br, pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' });
      console.log('CANCEL', cancel.classified);

      let statusAfter = await flight.getBookingStatus(br);
      for (let i = 0; i < 10; i += 1) {
        console.log('  after cancel', statusAfter.data?.status);
        if (/cancel/i.test(String(statusAfter.data?.status || ''))) break;
        if (!cancel.classified.ok) break;
        await sleep(4000);
        statusAfter = await flight.getBookingStatus(br);
      }

      owDone = {
        route: 'DEL→BOM',
        airline: 'AI',
        days,
        bookingReference: br,
        statusAfterBook: wait.status,
        pnrs,
        flights: opt.flights,
        pricedTotal: total,
        penalty: {
          endpoint: penalty.endpoint,
          payload: penalty.payload,
          http: penalty.http,
          response: penalty.responseBody,
          result: penalty.classified,
        },
        cancel: {
          endpoint: cancel.endpoint,
          payload: cancel.payload,
          http: cancel.http,
          response: cancel.responseBody,
          result: cancel.classified,
        },
        statusAfterCancel: statusAfter.data?.status,
      };
      break;
    }
    if (owDone?.cancel?.result?.ok || owDone?.bookingReference) break;
  }
  report.ow = owDone || { error: 'OW AI confirm+cancel not completed' };

  // ═══════ 2) RT prefer AI ═══════
  console.log('\n=== RT DEL-BOM prefer AI (dual PNR if available) ===');
  let rtDone = null;

  for (const [od, rd] of [[40, 47], [50, 57]]) {
    if (rtDone?.cancels?.some((c) => c.cancel?.result?.ok)) break;

    const body = buildRoundTripSearchBody(od, rd, {
      origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL',
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences = { airlines: ['AI'], maxStops: null, refundableOnly: false };
    delete body.preferences.maxStops;

    console.log(`\nRT search AI ${od}/${rd}`);
    let searchRes;
    try {
      searchRes = await flight.searchRoundTripUntilComplete(body);
    } catch (e) {
      console.log('RT search fail', e.message);
      // fallback without airline filter but pick AI
      body.preferences.airlines = [];
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e2) {
        console.log('RT fallback fail', e2.message);
        continue;
      }
    }

    const blocks = searchRes.response?.data?.results || [];
    let onward = (blocks.find((r) => /ONWARD/i.test(r.direction)) || {}).options || [];
    let ret = (blocks.find((r) => /RETURN/i.test(r.direction)) || {}).options || [];
    onward = onward.filter((o) => !body.preferences.airlines?.length || airlineCode(o) === 'AI' || true);
    // Prefer AI
    const onwardAi = onward.filter((o) => airlineCode(o) === 'AI');
    const returnAi = ret.filter((o) => airlineCode(o) === 'AI');
    const oList = (onwardAi.length ? onwardAi : onward).slice(0, 6);
    const rList = (returnAi.length ? returnAi : ret).slice(0, 6);
    console.log('AI onward/return', onwardAi.length, returnAi.length, 'using', oList.length, rList.length);

    for (const o of oList) {
      for (const r of rList) {
        if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
        const ao = airlineCode(o);
        const ar = airlineCode(r);
        // Prefer at least one AI; skip 6E/IX-only pairs (known bad for online cancel)
        if ([ao, ar].every((c) => c === '6E' || c === 'IX')) continue;
        if (!([ao, ar].includes('AI'))) continue;

        const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
        if (!ok(pricing) || !pricing.data?.priceId) continue;
        const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
        console.log('RT price', ao, ar, total);

        const issue = await flight.issueTicket({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [o.searchId, r.searchId],
          journeyType: 'ROUND_TRIP',
        });
        console.log('RT issue', issue.status, brief(issue.data, 200));
        const br = issue.data?.bookingReference;
        if (!br) {
          if (/INSUFFICIENT|balance|wallet/i.test(brief(issue.data))) {
            rtDone = { error: 'wallet', snippet: brief(issue.data, 300) };
            break;
          }
          continue;
        }

        const wait = await waitConfirmed(flight, br, 20);
        if (!/confirm/i.test(String(wait.status))) {
          console.log('RT not confirmed, skip', wait.status, br);
          continue;
        }

        const detail = await flight.getBookingDetail(br);
        const pnrs = extractPnrs(detail.data);
        console.log('RT Confirmed', br, 'PNRs', pnrs, 'airlines', ao, ar);

        const cancels = [];
        const targets = pnrs.length ? pnrs.slice(0, 2) : [null];
        for (const pnr of targets) {
          const penPayload = pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' };
          const canPayload = pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' };
          const penalty = await cancelCall(client, br, penPayload);
          console.log('RT PENALTY', pnr, penalty.classified);
          const cancel = await cancelCall(client, br, canPayload);
          console.log('RT CANCEL', pnr, cancel.classified);
          const st = await flight.getBookingStatus(br);
          cancels.push({
            pnr,
            penalty: {
              endpoint: penalty.endpoint,
              payload: penalty.payload,
              http: penalty.http,
              response: penalty.responseBody,
              result: penalty.classified,
            },
            cancel: {
              endpoint: cancel.endpoint,
              payload: cancel.payload,
              http: cancel.http,
              response: cancel.responseBody,
              result: cancel.classified,
            },
            statusAfter: st.data?.status,
          });
          await sleep(2500);
        }

        let statusAfter = await flight.getBookingStatus(br);
        for (let i = 0; i < 8; i += 1) {
          if (/cancel/i.test(String(statusAfter.data?.status || ''))) break;
          await sleep(4000);
          statusAfter = await flight.getBookingStatus(br);
          console.log('  RT after', statusAfter.data?.status);
        }

        rtDone = {
          route: 'DEL→BOM→DEL',
          airlines: [ao, ar],
          mixed: ao !== ar,
          bookingReference: br,
          statusAfterBook: wait.status,
          pnrs,
          pricedTotal: total,
          onward: (o.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`),
          return: (r.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`),
          cancels,
          statusAfterCancel: statusAfter.data?.status,
        };
        break;
      }
      if (rtDone?.bookingReference) break;
    }
    if (rtDone?.bookingReference) break;
  }
  report.rt = rtDone || { error: 'RT AI confirm+cancel not completed' };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify({
    priorRef: PRIOR_REF,
    ow: report.ow && !report.ow.error ? {
      br: report.ow.bookingReference,
      pnrs: report.ow.pnrs,
      cancelOk: report.ow.cancel?.result?.ok,
      cancelStatus: report.ow.cancel?.result?.status,
      cancelMsg: report.ow.cancel?.result?.message,
      statusAfter: report.ow.statusAfterCancel,
      cancelPayload: report.ow.cancel?.payload,
    } : report.ow,
    rt: report.rt && !report.rt.error ? {
      br: report.rt.bookingReference,
      pnrs: report.rt.pnrs,
      airlines: report.rt.airlines,
      cancels: report.rt.cancels?.map((c) => ({
        pnr: c.pnr,
        ok: c.cancel?.result?.ok,
        status: c.cancel?.result?.status,
        msg: c.cancel?.result?.message,
        payload: c.cancel?.payload,
      })),
      statusAfter: report.rt.statusAfterCancel,
    } : report.rt,
    report: OUT,
  }, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
