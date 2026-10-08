/**
 * Book SpiceJet (SG) OW on staging and cancel.
 * Run: node scripts/book-cancel-spicejet.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  extractFirstSearchId,
  extractSearchIds,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-cancel-spicejet-staging.json');
const Q = { lang: 'en', currency: 'INR' };

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

function airlineOf(opt) {
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

async function waitConfirmed(flight, br, max = 36) {
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
    response: res.data,
    result: classifyCancel(res),
  };
}

async function findSgOption(flight) {
  const routes = [
    ['DEL', 'BOM'],
    ['BOM', 'DEL'],
    ['DEL', 'HYD'],
    ['BLR', 'DEL'],
    ['DEL', 'GOI'],
    ['BOM', 'MAA'],
  ];
  const dayList = [35, 42, 50, 28, 60];

  for (const [origin, destination] of routes) {
    for (const days of dayList) {
      const body = buildOneWaySearchBody(days, {
        origin, destination, maxStops: 0, fareType: 'NORMAL',
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      body.preferences = { airlines: ['SG'], maxStops: 0, refundableOnly: false };

      console.log(`\nSearch SG ${origin}-${destination} days=${days}`);
      let last;
      let sgOpts = [];
      for (let i = 0; i < 12; i += 1) {
        last = await flight.search(body);
        const opts = [];
        for (const block of last.data?.results || []) {
          for (const opt of block.options || []) opts.push(opt);
        }
        sgOpts = opts.filter((o) => airlineOf(o) === 'SG' && o.searchId);
        const st = String(last.data?.progress?.state || '').toUpperCase();
        console.log('  poll', i + 1, 'SG', sgOpts.length, st);
        if (sgOpts.length && (st === 'COMPLETE' || i >= 4)) break;
        if (!ok(last) && i > 2) break;
        await sleep(3000);
      }

      // fallback: no airline filter, pick SG from results
      if (!sgOpts.length) {
        body.preferences.airlines = [];
        for (let i = 0; i < 8; i += 1) {
          last = await flight.search(body);
          const opts = [];
          for (const block of last.data?.results || []) {
            for (const opt of block.options || []) opts.push(opt);
          }
          sgOpts = opts.filter((o) => airlineOf(o) === 'SG' && o.searchId);
          const st = String(last.data?.progress?.state || '').toUpperCase();
          console.log('  fallback poll', i + 1, 'SG', sgOpts.length, st);
          if (sgOpts.length) break;
          await sleep(2500);
        }
      }

      for (const opt of sgOpts.slice(0, 5)) {
        const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
        if (!ok(pricing) || !pricing.data?.priceId) {
          console.log('pricing fail', brief(pricing.data, 120));
          continue;
        }
        const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
        console.log('SG priced', total, opt.searchId);
        return {
          origin,
          destination,
          days,
          searchId: opt.searchId,
          total,
          pricing: pricing.data,
          flights: (opt.segments || []).map((s) => ({
            flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
            dep: s.departure?.time,
          })),
        };
      }
    }
  }
  return null;
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: Book SpiceJet (SG) + cancel');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const picked = await findSgOption(flight);
  if (!picked) {
    const summary = { baseUrl: config.baseUrl, error: 'No SG inventory/pricing found' };
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log('\nIssuing SG ticket...', picked.origin, picked.destination, picked.total);
  const issue = await flight.issueTicket({
    bookingContext: picked.pricing.bookingContext,
    priceId: picked.pricing.priceId,
    searchIds: [picked.searchId],
    journeyType: 'ONE_WAY',
  });
  console.log('Issue', issue.status, brief(issue.data, 250));
  const br = issue.data?.bookingReference;
  if (!br) {
    const summary = {
      baseUrl: config.baseUrl,
      error: 'issue failed',
      snippet: brief(issue.data, 400),
      picked,
    };
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }

  const wait = await waitConfirmed(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  console.log('Booked', br, wait.status, 'PNRs', pnrs);

  let penalty = null;
  let cancel = null;
  let statusAfter = wait.status;

  if (/confirm/i.test(String(wait.status))) {
    const pnr = pnrs[0];
    penalty = await cancelCall(client, br, pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' });
    console.log('PENALTY', penalty.result);
    cancel = await cancelCall(client, br, pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' });
    console.log('CANCEL', cancel.result);

    let st = await flight.getBookingStatus(br);
    for (let i = 0; i < 10; i += 1) {
      statusAfter = st.data?.status;
      console.log('  after cancel', statusAfter);
      if (/cancel/i.test(String(statusAfter || ''))) break;
      if (!cancel.result.ok) break;
      await sleep(4000);
      st = await flight.getBookingStatus(br);
    }
  }

  const summary = {
    baseUrl: config.baseUrl,
    airline: 'SG',
    route: `${picked.origin}→${picked.destination}`,
    days: picked.days,
    pricedTotal: picked.total,
    flights: picked.flights,
    bookingReference: br,
    statusAfterBook: wait.status,
    pnrs,
    penalty,
    cancel,
    statusAfterCancel: statusAfter,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    bookingReference: br,
    pnrs,
    statusAfterBook: wait.status,
    cancelOk: cancel?.result?.ok,
    cancelStatus: cancel?.result?.status,
    cancelMessage: cancel?.result?.message,
    cancelPayload: cancel?.payload,
    cancelResponse: cancel?.response,
    statusAfterCancel: statusAfter,
    report: OUT,
  }, null, 2));

  if (!/confirm/i.test(String(wait.status)) || !cancel?.result?.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
