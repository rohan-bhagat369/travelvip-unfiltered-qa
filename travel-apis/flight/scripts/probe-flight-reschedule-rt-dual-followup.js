/**
 * Follow-up: mixed-airline RT for 2 PNRs + SG OW cancel/reschedule path.
 * Run: node scripts/probe-flight-reschedule-rt-dual-followup.js
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
process.env.MATTERMOST_CHANNEL = 'backend-alerts-dev';

import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  extractFirstSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { fetchRecentAlertPosts } from './lib/mattermostVendorAlerts.js';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join('reports', 'flight-reschedule-rt-dual-followup.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 500) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  return opt?.segments?.[0]?.airline?.code
    || opt?.segments?.[0]?.operatingCarrier?.code
    || null;
}

async function waitTerm(flight, br, maxAttempts = 40) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (isTerminalBookingStatus(st)) return { status: st, response: last };
    await sleep(5000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
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

async function priceOW(flight, { origin = 'DEL', destination = 'BOM', days = 55, airlines = [] } = {}) {
  const body = buildOneWaySearchBody(days, {
    origin, destination, maxStops: 0, fareType: 'NORMAL',
  });
  if (airlines.length) body.preferences.airlines = airlines;
  let sid = null;
  for (let i = 0; i < 12; i += 1) {
    const s = await flight.search(body);
    sid = extractFirstSearchId(s.data);
    const st = String(s.data?.progress?.state || '').toUpperCase();
    if (ok(s) && sid && (st === 'COMPLETE' || i >= 4)) break;
    await sleep(3500);
  }
  if (!sid) throw new Error(`no OW searchId ${origin}-${destination}`);
  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  if (!ok(pricing)) throw new Error(`OW pricing fail ${brief(pricing.data)}`);
  return {
    searchId: sid,
    searchIds: [sid],
    priceId: pricing.data.priceId,
    bookingContext: pricing.data.bookingContext,
    total: Number(pricing.data?.pricing?.totalAmount || 0),
    pricing,
  };
}

async function findMixedRt(flight) {
  const body = buildRoundTripSearchBody(40, 47, {
    origin: 'DEL', destination: 'BOM', fareType: 'NORMAL',
  });
  delete body.preferences.maxStops;
  const { response } = await flight.searchRoundTripUntilComplete(body);
  const resultsBlock = response.data?.results || [];
  const onwardOpts = (resultsBlock.find((r) => String(r.direction).toUpperCase() === 'ONWARD') || {}).options || [];
  const returnOpts = (resultsBlock.find((r) => String(r.direction).toUpperCase() === 'RETURN') || {}).options || [];
  console.log('RT options onward', onwardOpts.length, 'return', returnOpts.length);

  let best = null;
  for (const o of onwardOpts.slice(0, 8)) {
    for (const r of returnOpts.slice(0, 8)) {
      if (!o.searchId || !r.searchId) continue;
      const ao = airlineCode(o);
      const ar = airlineCode(r);
      const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
      if (!ok(pricing)) continue;
      const total = Number(pricing.data?.pricing?.totalAmount || 999999);
      const mixed = Boolean(ao && ar && ao !== ar);
      const cand = {
        ao, ar, mixed, total, pricing,
        searchIds: [o.searchId, r.searchId],
      };
      if (mixed && total <= 18000) return cand;
      if (!best || (mixed && !best.mixed) || total < best.total) best = cand;
    }
  }
  return best;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const results = [];

  console.log('\n=== MIXED / RT DUAL PNR ===');
  const picked = await findMixedRt(flight);
  if (!picked) throw new Error('no RT combo');
  console.log('picked', {
    airlines: [picked.ao, picked.ar],
    mixed: picked.mixed,
    total: picked.total,
  });

  const issueRt = await flight.issueTicket({
    bookingContext: picked.pricing.data.bookingContext,
    priceId: picked.pricing.data.priceId,
    searchIds: picked.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  const rtBr = issueRt.data?.bookingReference;
  console.log('RT issue', issueRt.status, brief(issueRt.data, 280));
  if (!rtBr) throw new Error('RT issue failed');

  const waitRt = await waitTerm(flight, rtBr, 48);
  const detailRt = await flight.getBookingDetail(rtBr);
  const rtPnrs = extractPnrs(detailRt.data);
  console.log('RT status', waitRt.status, 'pnrs', rtPnrs);
  results.push({
    id: 'RTM1',
    title: 'RT book',
    br: rtBr,
    status: waitRt.status,
    pnrs: rtPnrs,
    airlines: [picked.ao, picked.ar],
    mixed: picked.mixed,
    total: picked.total,
  });

  if (String(waitRt.status).toLowerCase() === 'confirmed' && rtPnrs.length >= 2) {
    const [p1, p2] = rtPnrs;
    const c1 = await cancelCall(client, rtBr, { action: 'CANCEL', pnr: p1 });
    console.log('CANCEL p1', p1, brief(c1.data, 350));
    results.push({ id: 'RTM3', title: 'Cancel PNR1', pnr: p1, http: c1.status, body: c1.data });

    const st1 = await flight.getBookingStatus(rtBr);
    results.push({ id: 'RTM3b', title: 'Status after PNR1 cancel', status: st1.data?.status });

    const c2 = await cancelCall(client, rtBr, { action: 'CANCEL', pnr: p2 });
    console.log('CANCEL p2', p2, brief(c2.data, 350));
    results.push({ id: 'RTM4', title: 'Cancel PNR2', pnr: p2, http: c2.status, body: c2.data });

    let st2;
    for (let i = 0; i < 18; i += 1) {
      st2 = await flight.getBookingStatus(rtBr);
      console.log('poll', i, st2.data?.status);
      if (/cancel/i.test(String(st2.data?.status || ''))) break;
      await sleep(5000);
    }
    results.push({ id: 'RTM5', title: 'Status after both PNR cancels', status: st2?.data?.status });

    for (const [label, pnr] of [['p1', p1], ['p2', p2]]) {
      const ow = await priceOW(flight, { days: 56 + (label === 'p2' ? 2 : 0) });
      const body = buildIssueTicketPayload({
        bookingContext: ow.bookingContext,
        priceId: ow.priceId,
        searchIds: ow.searchIds,
      });
      body.reschedulingReferenceId = rtBr;
      body.reschedulingPnr = pnr;
      const rs = await issueRaw(client, body);
      console.log('Reschedule', label, rs.status, brief(rs.data, 300));
      results.push({
        id: `RTM6-${label}`,
        title: `Reschedule ${label}`,
        pnr,
        http: rs.status,
        code: rs.data?.error?.code,
        body: rs.data,
      });
    }
  } else {
    results.push({
      id: 'RTM2',
      title: 'Dual PNR cancel skipped',
      reason: `status=${waitRt.status} pnrCount=${rtPnrs.length}`,
      pnrs: rtPnrs,
    });
  }

  console.log('\n=== SG OW CANCEL → RESCHEDULE ===');
  try {
    const sg = await priceOW(flight, { days: 44, airlines: ['SG'] });
    console.log('SG total', sg.total);
    if (sg.total <= 9000) {
      const iss = await flight.issueTicket({
        bookingContext: sg.bookingContext,
        priceId: sg.priceId,
        searchIds: sg.searchIds,
        journeyType: 'ONE_WAY',
      });
      const sgBr = iss.data?.bookingReference;
      console.log('SG issue', iss.status, sgBr, brief(iss.data, 200));
      if (sgBr) {
        const w = await waitTerm(flight, sgBr);
        const d = await flight.getBookingDetail(sgBr);
        const pnrs = extractPnrs(d.data);
        console.log('SG status', w.status, pnrs);
        results.push({ id: 'SG1', br: sgBr, status: w.status, pnrs, total: sg.total });

        if (String(w.status).toLowerCase() === 'confirmed' && pnrs[0]) {
          const since = Date.now() - 2000;
          const pen = await cancelCall(client, sgBr, { action: 'PENALTY', pnr: pnrs[0] });
          const can = await cancelCall(client, sgBr, { action: 'CANCEL', pnr: pnrs[0] });
          console.log('SG PENALTY', brief(pen.data, 280));
          console.log('SG CANCEL', brief(can.data, 280));
          let st;
          for (let i = 0; i < 24; i += 1) {
            st = await flight.getBookingStatus(sgBr);
            if (/cancel/i.test(String(st.data?.status || ''))) break;
            await sleep(5000);
          }
          const posts = await fetchRecentAlertPosts({ perPage: 40 });
          const hits = posts
            .filter((p) => (p.message || '').includes(sgBr) && (p.create_at || 0) >= since)
            .map((p) => ({
              created: new Date(p.create_at).toISOString(),
              status: (p.message || '').match(/status `([^`]+)`/)?.[1] || null,
            }));
          console.log('SG after cancel', st.data?.status, 'webhooks', hits);
          results.push({
            id: 'SG2',
            title: 'SG cancel outcome',
            statusAfter: st.data?.status,
            penalty: pen.data,
            cancel: can.data,
            webhooks: hits,
          });

          if (/cancel/i.test(String(st.data?.status || ''))) {
            const ow2 = await priceOW(flight, { origin: 'BOM', destination: 'DEL', days: 60 });
            const body = buildIssueTicketPayload({
              bookingContext: ow2.bookingContext,
              priceId: ow2.priceId,
              searchIds: ow2.searchIds,
            });
            body.reschedulingReferenceId = sgBr;
            body.reschedulingPnr = pnrs[0];
            const rs = await issueRaw(client, body);
            console.log('SG RESCHEDULE', rs.status, brief(rs.data, 350));
            const newBr = rs.data?.bookingReference || null;
            let newStatus = null;
            if (newBr) {
              const nw = await waitTerm(flight, newBr);
              newStatus = nw.status;
            }
            results.push({
              id: 'SG3',
              title: 'SG reschedule happy path',
              http: rs.status,
              newBr,
              newStatus,
              body: rs.data,
              passed: Boolean(newBr) && String(newStatus).toLowerCase() === 'confirmed',
            });
          }
        }
      }
    } else {
      results.push({ id: 'SG0', title: 'SG fare too high', total: sg.total });
    }
  } catch (e) {
    console.warn('SG path failed', e.message);
    results.push({ id: 'SGERR', message: e.message });
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ baseUrl: config.baseUrl, results }, null, 2));
  console.log('\nSaved', OUT);
  console.log(results.map((r) => `${r.id} ${r.title || ''} ${r.status || r.statusAfter || r.http || ''} ${JSON.stringify(r.pnrs || r.newBr || r.reason || '').slice(0, 80)}`).join('\n'));
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
