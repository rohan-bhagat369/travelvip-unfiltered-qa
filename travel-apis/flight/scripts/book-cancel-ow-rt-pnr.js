/**
 * Book + cancel:
 * 1) ONE_WAY — single PNR
 * 2) ROUND_TRIP — prefer 2 PNRs (mixed airline), cancel each PNR
 *
 * Run: node scripts/book-cancel-ow-rt-pnr.js
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
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-cancel-ow-rt-pnr-staging.json');
const Q = { ...FLIGHT_QUERY };

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(d, n = 800) {
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

function flightLegs(detailData) {
  const legs = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    if (node.departure && node.arrival && (node.flightNumber || node.airline)) {
      legs.push({
        flight: `${node.airline?.code || node.airline || ''} ${node.flightNumber || ''}`.trim(),
        route: `${node.departure?.airportCode || node.departure?.code}→${node.arrival?.airportCode || node.arrival?.code}`,
        dep: node.departure?.time || node.departure?.dateTime,
        arr: node.arrival?.time || node.arrival?.dateTime,
      });
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(detailData);
  // dedupe
  const seen = new Set();
  return legs.filter((l) => {
    const k = JSON.stringify(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
}

function airlineCode(opt) {
  return opt?.segments?.[0]?.airline?.code || null;
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

async function cancelCall(client, br, body, useV2 = false) {
  const pathCancel = useV2
    ? '/api/v2/flight/cancel'
    : `/v1/flights/booking/${br}/cancel`;
  const payload = useV2
    ? { bookingReference: br, ...body }
    : body;
  const res = await client.request({
    method: 'POST',
    path: pathCancel,
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  return { path: pathCancel, payload, response: { http: res.status, body: res.data } };
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const report = { baseUrl: config.baseUrl, generatedAt: new Date().toISOString(), ow: null, rt: null };

  // ═══════════════ 1) ONE WAY — single PNR ═══════════════
  console.log('\n=== 1) ONE_WAY book + cancel (single PNR) ===');
  const owBody = buildOneWaySearchBody(28, {
    origin: 'DEL', destination: 'BOM', maxStops: 0, fareType: 'NORMAL',
  });
  owBody.travellers = { adults: 1, children: 0, infants: 0 };
  const owSearch = await flight.searchUntilComplete(owBody);
  const owSid = owSearch.searchId;
  console.log('OW searchId', owSid);

  const owPrice = await flight.getPricing([owSid], 'ONE_WAY');
  if (!ok(owPrice)) throw new Error(`OW pricing fail ${brief(owPrice.data)}`);
  const owTotal = owPrice.data?.pricing?.totalAmount ?? owPrice.data?.totalAmount;
  console.log('OW total', owTotal);

  const owIssue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, count: 10, page: 0, perpage: 20 },
    body: buildIssueTicketPayload({
      bookingContext: owPrice.data.bookingContext,
      priceId: owPrice.data.priceId,
      searchIds: [owSid],
      journeyType: 'ONE_WAY',
    }),
    correlation: true,
    partnerKey: client.partnerKey,
  });
  console.log('OW issue', owIssue.status, brief(owIssue.data, 250));
  const owBr = owIssue.data?.bookingReference;
  if (!owBr) throw new Error(`OW issue failed: ${brief(owIssue.data)}`);

  const owWait = await waitTerm(flight, owBr);
  const owDetail = await flight.getBookingDetail(owBr);
  const owPnrs = extractPnrs(owDetail.data);
  console.log('OW confirmed PNRs', owPnrs);

  let owPenalty = null;
  let owCancel = null;
  if (/confirm/i.test(String(owWait.status)) && owPnrs[0]) {
    const pnr = owPnrs[0];
    owPenalty = await cancelCall(client, owBr, { action: 'PENALTY', pnr, retryCount: 2 });
    console.log('OW PENALTY', brief(owPenalty.response.body, 300));
    owCancel = await cancelCall(client, owBr, { action: 'CANCEL', pnr, retryCount: 2 });
    console.log('OW CANCEL', brief(owCancel.response.body, 300));
  } else if (/confirm/i.test(String(owWait.status))) {
    owPenalty = await cancelCall(client, owBr, { action: 'PENALTY', retryCount: 2 });
    owCancel = await cancelCall(client, owBr, { action: 'CANCEL', retryCount: 2 });
  }

  let owStatusAfter = await flight.getBookingStatus(owBr);
  for (let i = 0; i < 12 && !/cancel/i.test(String(owStatusAfter.data?.status || '')); i += 1) {
    await sleep(4000);
    owStatusAfter = await flight.getBookingStatus(owBr);
    console.log('  OW after cancel', owStatusAfter.data?.status);
  }

  report.ow = {
    journeyType: 'ONE_WAY',
    route: 'DEL→BOM',
    bookingReference: owBr,
    statusAfterBook: owWait.status,
    pnrs: owPnrs,
    pricedTotal: owTotal,
    flights: flightLegs(owDetail.data),
    penalty: owPenalty,
    cancel: owCancel,
    statusAfterCancel: owStatusAfter.data?.status,
  };

  // ═══════════════ 2) ROUND TRIP — two PNRs ═══════════════
  console.log('\n=== 2) ROUND_TRIP book + cancel (two PNRs) ===');
  const rtBody = buildRoundTripSearchBody(35, 42, {
    origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL',
  });
  rtBody.travellers = { adults: 1, children: 0, infants: 0 };
  delete rtBody.preferences.maxStops;

  const { response: rtSearch } = await flight.searchRoundTripUntilComplete(rtBody);
  const blocks = rtSearch.data?.results || [];
  const onward = (blocks.find((r) => String(r.direction).toUpperCase() === 'ONWARD') || {}).options || [];
  const ret = (blocks.find((r) => String(r.direction).toUpperCase() === 'RETURN') || {}).options || [];
  console.log('RT options', onward.length, ret.length);

  let picked = null;
  for (const o of onward.slice(0, 10)) {
    for (const r of ret.slice(0, 10)) {
      if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
      const ao = airlineCode(o);
      const ar = airlineCode(r);
      const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
      if (!ok(pricing) || !pricing.data?.priceId) continue;
      const total = Number(pricing.data?.pricing?.totalAmount || pricing.data?.totalAmount || 0);
      const mixed = Boolean(ao && ar && ao !== ar);
      const cand = {
        ao, ar, mixed, total, pricing,
        searchIds: [o.searchId, r.searchId],
        oFlights: (o.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`),
        rFlights: (r.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber} ${s.departure?.airportCode}→${s.arrival?.airportCode}`),
      };
      if (mixed) {
        picked = cand;
        break;
      }
      if (!picked || (mixed && !picked.mixed) || (total && total < (picked.total || Infinity))) {
        picked = cand;
      }
    }
    if (picked?.mixed) break;
  }
  if (!picked) throw new Error('No RT pair found');
  console.log('RT picked', { airlines: [picked.ao, picked.ar], mixed: picked.mixed, total: picked.total });

  const rtIssue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, count: 10, page: 0, perpage: 20 },
    body: buildIssueTicketPayload({
      bookingContext: picked.pricing.data.bookingContext,
      priceId: picked.pricing.data.priceId,
      searchIds: picked.searchIds,
      journeyType: 'ROUND_TRIP',
    }),
    correlation: true,
    partnerKey: client.partnerKey,
  });
  console.log('RT issue', rtIssue.status, brief(rtIssue.data, 250));
  const rtBr = rtIssue.data?.bookingReference;
  if (!rtBr) throw new Error(`RT issue failed: ${brief(rtIssue.data)}`);

  const rtWait = await waitTerm(flight, rtBr);
  const rtDetail = await flight.getBookingDetail(rtBr);
  const rtPnrs = extractPnrs(rtDetail.data);
  console.log('RT PNRs', rtPnrs);

  const rtCancels = [];
  if (/confirm/i.test(String(rtWait.status)) && rtPnrs.length >= 2) {
    for (const pnr of rtPnrs.slice(0, 2)) {
      const pen = await cancelCall(client, rtBr, { action: 'PENALTY', pnr, retryCount: 2 });
      console.log('RT PENALTY', pnr, brief(pen.response.body, 250));
      const can = await cancelCall(client, rtBr, { action: 'CANCEL', pnr, retryCount: 2 });
      console.log('RT CANCEL', pnr, brief(can.response.body, 250));
      const st = await flight.getBookingStatus(rtBr);
      rtCancels.push({
        pnr,
        penalty: pen,
        cancel: can,
        statusAfterThisCancel: st.data?.status,
      });
      await sleep(3000);
    }
  } else if (/confirm/i.test(String(rtWait.status)) && rtPnrs.length === 1) {
    console.log('Only 1 PNR on RT — cancelling that single PNR');
    const pnr = rtPnrs[0];
    const pen = await cancelCall(client, rtBr, { action: 'PENALTY', pnr, retryCount: 2 });
    const can = await cancelCall(client, rtBr, { action: 'CANCEL', pnr, retryCount: 2 });
    rtCancels.push({ pnr, penalty: pen, cancel: can, note: 'single PNR on RT' });
  } else if (/confirm/i.test(String(rtWait.status))) {
    const pen = await cancelCall(client, rtBr, { action: 'PENALTY', retryCount: 2 });
    const can = await cancelCall(client, rtBr, { action: 'CANCEL', retryCount: 2 });
    rtCancels.push({ pnr: null, penalty: pen, cancel: can, note: 'no PNR extracted — full cancel' });
  }

  let rtStatusAfter = await flight.getBookingStatus(rtBr);
  for (let i = 0; i < 15 && !/cancel/i.test(String(rtStatusAfter.data?.status || '')); i += 1) {
    await sleep(4000);
    rtStatusAfter = await flight.getBookingStatus(rtBr);
    console.log('  RT after cancel', rtStatusAfter.data?.status);
  }

  report.rt = {
    journeyType: 'ROUND_TRIP',
    route: 'DEL→BOM→DEL',
    bookingReference: rtBr,
    statusAfterBook: rtWait.status,
    airlines: [picked.ao, picked.ar],
    mixedAirline: picked.mixed,
    pnrs: rtPnrs,
    pricedTotal: picked.total,
    onwardFlights: picked.oFlights,
    returnFlights: picked.rFlights,
    flightsFromDetail: flightLegs(rtDetail.data),
    cancels: rtCancels,
    statusAfterCancel: rtStatusAfter.data?.status,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    ow: {
      br: report.ow.bookingReference,
      pnrs: report.ow.pnrs,
      statusAfterBook: report.ow.statusAfterBook,
      statusAfterCancel: report.ow.statusAfterCancel,
      cancelPayload: report.ow.cancel?.payload,
      cancelHttp: report.ow.cancel?.response?.http,
    },
    rt: {
      br: report.rt.bookingReference,
      pnrs: report.rt.pnrs,
      mixed: report.rt.mixedAirline,
      statusAfterBook: report.rt.statusAfterBook,
      statusAfterCancel: report.rt.statusAfterCancel,
      cancelCount: report.rt.cancels?.length,
    },
    report: OUT,
  }, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
