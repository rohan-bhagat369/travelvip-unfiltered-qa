/**
 * Probe SpiceJet (SG) across routes/dates; book+cancel first that confirms.
 * Run: node scripts/book-cancel-spicejet-scan.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-cancel-spicejet-scan-staging.json');
const Q = { lang: 'en', currency: 'INR' };

const ROUTES = [
  ['DEL', 'BOM'], ['BOM', 'DEL'],
  ['DEL', 'HYD'], ['HYD', 'DEL'],
  ['DEL', 'BLR'], ['BLR', 'DEL'],
  ['DEL', 'MAA'], ['BOM', 'MAA'],
  ['DEL', 'GOI'], ['BOM', 'GOI'],
  ['DEL', 'AMD'], ['BOM', 'AMD'],
  ['DEL', 'CCU'], ['BOM', 'BLR'],
  ['DEL', 'PNQ'], ['BOM', 'HYD'],
];
const DAYS = [21, 28, 35, 42, 49, 56, 63];

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function airlineOf(opt) {
  return opt?.segments?.[0]?.airline?.code || null;
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

async function waitConfirmed(flight, br, max = 30) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', i + 1, st);
    if (isTerminalBookingStatus(st)) return { status: st };
    await sleep(5000);
  }
  return { status: last?.data?.status, timedOut: true };
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

async function searchSg(flight, origin, destination, days) {
  const body = buildOneWaySearchBody(days, {
    origin, destination, maxStops: null, fareType: 'NORMAL',
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  body.preferences = { airlines: ['SG'], maxStops: null, refundableOnly: false };

  let last;
  for (let i = 0; i < 8; i += 1) {
    last = await flight.search(body);
    const opts = [];
    for (const block of last.data?.results || []) {
      for (const opt of block.options || []) opts.push(opt);
    }
    const sg = opts.filter((o) => airlineOf(o) === 'SG' && o.searchId);
    const st = String(last.data?.progress?.state || '').toUpperCase();
    if (sg.length && (st === 'COMPLETE' || i >= 3)) return sg;
    if (!ok(last)) return [];
    await sleep(2000);
  }
  return [];
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Scan SpiceJet routes/dates…');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const scan = [];
  let booked = null;

  outer:
  for (const [origin, destination] of ROUTES) {
    for (const days of DAYS) {
      if (booked) break outer;
      try {
        const sgOpts = await searchSg(flight, origin, destination, days);
        const entry = {
          route: `${origin}-${destination}`,
          days,
          sgCount: sgOpts.length,
        };
        console.log(`SG ${entry.route} d${days} => ${sgOpts.length}`);
        if (!sgOpts.length) {
          scan.push(entry);
          continue;
        }

        // try price first 2
        for (const opt of sgOpts.slice(0, 2)) {
          const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
          if (!ok(pricing) || !pricing.data?.priceId) {
            entry.priceFail = brief(pricing.data, 120);
            continue;
          }
          const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
          entry.priced = total;
          entry.flights = (opt.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`);
          console.log('  priced', total, entry.flights);

          console.log('  issuing…');
          const issue = await flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [opt.searchId],
            journeyType: 'ONE_WAY',
          });
          console.log('  issue', issue.status, brief(issue.data, 180));
          const br = issue.data?.bookingReference;
          if (!br) {
            entry.issueFail = brief(issue.data, 250);
            if (/INSUFFICIENT|wallet|balance/i.test(entry.issueFail)) {
              scan.push(entry);
              booked = { error: 'wallet', snippet: entry.issueFail };
              break outer;
            }
            continue;
          }

          const wait = await waitConfirmed(flight, br);
          entry.br = br;
          entry.bookStatus = wait.status;
          if (!/confirm/i.test(String(wait.status))) {
            console.log('  not confirmed', wait.status);
            scan.push(entry);
            continue;
          }

          const detail = await flight.getBookingDetail(br);
          const pnrs = extractPnrs(detail.data);
          const pnr = pnrs[0];
          const penalty = await cancelCall(client, br, pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' });
          console.log('  PENALTY', penalty.result);
          const cancel = await cancelCall(client, br, pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' });
          console.log('  CANCEL', cancel.result);

          booked = {
            route: entry.route,
            days,
            pricedTotal: total,
            flights: entry.flights,
            bookingReference: br,
            statusAfterBook: wait.status,
            pnrs,
            penalty,
            cancel,
          };
          scan.push({ ...entry, pnrs, cancelOk: cancel.result.ok, cancelMsg: cancel.result.message });
          break outer;
        }
        scan.push(entry);
      } catch (e) {
        scan.push({ route: `${origin}-${destination}`, days, error: e.message });
        console.log('err', origin, destination, days, e.message);
      }
    }
  }

  const summary = {
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    scanHits: scan.filter((s) => s.sgCount > 0),
    scanEmptySample: scan.filter((s) => !s.sgCount).slice(0, 20),
    scanTotal: scan.length,
    booked,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== SG HITS ===');
  summary.scanHits.forEach((h) => console.log(h.route, 'd' + h.days, 'count', h.sgCount, 'priced', h.priced || '-', h.br || ''));
  console.log('\n=== BOOKED ===');
  console.log(JSON.stringify(booked, null, 2));
  console.log('Report', OUT);

  if (!booked?.bookingReference || !booked?.cancel?.result?.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
