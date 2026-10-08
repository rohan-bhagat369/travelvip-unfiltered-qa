/**
 * Book ROUND_TRIP on canary and wait until Confirmed.
 * If Pending/InProgress too long → try different route/date.
 *
 * Run: BASE_URL=https://canary-api.travelvip.ai node scripts/book-rt-canary-confirm.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-rt-canary-confirm.json');
const Q = { ...FLIGHT_QUERY };

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
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

async function waitConfirmed(flight, br, max = 8) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', i + 1, st);
    if (isTerminalBookingStatus(st)) return { status: st };
    await sleep(5000);
  }
  return { status: last?.data?.status, timedOut: true, inProgress: true };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: RT book → Confirmed on canary');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const routes = [
    ['DEL', 'BOM'],
    ['BOM', 'DEL'],
    ['DEL', 'HYD'],
    ['DEL', 'BLR'],
    ['BOM', 'BLR'],
  ];
  const windows = [[21, 28], [28, 35], [35, 42], [40, 47]];
  const skipped = [];
  let booked = null;

  outer:
  for (const [origin, destination] of routes) {
    for (const [od, rd] of windows) {
      console.log(`\n=== Search RT ${origin}-${destination} days ${od}/${rd} ===`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin, destination, maxStops: null, fareType: 'NORMAL',
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };
      delete body.preferences.maxStops;

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('search fail', e.message);
        skipped.push({ origin, destination, od, rd, error: e.message });
        continue;
      }

      const blocks = searchRes.response?.data?.results || [];
      const onward = (blocks.find((r) => /ONWARD/i.test(r.direction)) || {}).options || [];
      const ret = (blocks.find((r) => /RETURN/i.test(r.direction)) || {}).options || [];
      console.log('options onward/return', onward.length, ret.length);
      if (!onward.length || !ret.length) continue;

      // Prefer same-airline cheap pairs first (often confirms); try a few
      const pairs = [];
      for (const o of onward.slice(0, 6)) {
        for (const r of ret.slice(0, 6)) {
          if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
          const ao = airlineOf(o);
          const ar = airlineOf(r);
          pairs.push({
            o, r, ao, ar,
            same: ao && ar && ao === ar,
            score: (ao && ar && ao === ar ? 10 : 0),
          });
        }
      }
      pairs.sort((a, b) => b.score - a.score);

      for (const cand of pairs.slice(0, 4)) {
        const pricing = await flight.getPricing([cand.o.searchId, cand.r.searchId], 'ROUND_TRIP');
        if (!ok(pricing) || !pricing.data?.priceId || !pricing.data?.bookingContext) {
          console.log('pricing skip', brief(pricing.data, 100));
          continue;
        }
        const total = pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount;
        console.log('price', cand.ao, cand.ar, total);

        const payload = buildIssueTicketPayload({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [cand.o.searchId, cand.r.searchId],
          journeyType: 'ROUND_TRIP',
        });

        let issue = await client.request({
          method: 'POST',
          path: '/api/v2/flights/booking/issue-ticket',
          query: { ...Q, count: 10, page: 0, perpage: 20 },
          body: payload,
          correlation: true,
          partnerKey: client.partnerKey,
        });
        console.log('issue v2', issue.status, brief(issue.data, 200));
        if (!ok(issue) || !issue.data?.bookingReference) {
          issue = await flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [cand.o.searchId, cand.r.searchId],
            journeyType: 'ROUND_TRIP',
          });
          console.log('issue v1', issue.status, brief(issue.data, 200));
        }

        const br = issue.data?.bookingReference;
        if (!br) {
          if (/INSUFFICIENT|wallet|balance/i.test(brief(issue.data))) {
            booked = { error: 'wallet', snippet: brief(issue.data, 300) };
            break outer;
          }
          continue;
        }

        const wait = await waitConfirmed(flight, br, 8);
        if (!/confirm/i.test(String(wait.status))) {
          console.log('LEAVE in-progress — try different route/date:', wait.status, br);
          skipped.push({
            br,
            status: wait.status,
            route: `${origin}-${destination}`,
            days: [od, rd],
            airlines: [cand.ao, cand.ar],
          });
          // next date window / route
          break;
        }

        const detail = await flight.getBookingDetail(br);
        const pnrs = extractPnrs(detail.data);
        booked = {
          bookingReference: br,
          status: wait.status,
          route: `${origin}-${destination}-${origin}`,
          days: [od, rd],
          airlines: [cand.ao, cand.ar],
          pnrs,
          pricedTotal: total,
          onward: (cand.o.segments || []).map((s) => ({
            flight: `${s.airline?.code} ${s.flightNumber}`,
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
            dep: s.departure?.time,
          })),
          return: (cand.r.segments || []).map((s) => ({
            flight: `${s.airline?.code} ${s.flightNumber}`,
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
            dep: s.departure?.time,
          })),
        };
        break outer;
      }
    }
  }

  const summary = {
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    booked,
    skipped,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    bookingReference: booked?.bookingReference,
    status: booked?.status,
    route: booked?.route,
    airlines: booked?.airlines,
    pnrs: booked?.pnrs,
    pricedTotal: booked?.pricedTotal,
    onward: booked?.onward,
    return: booked?.return,
    skippedCount: skipped.length,
    report: OUT,
  }, null, 2));

  if (!booked?.bookingReference || !/confirm/i.test(String(booked.status))) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
