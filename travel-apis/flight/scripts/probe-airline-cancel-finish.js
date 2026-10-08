/**
 * Finish remaining airlines + AI reschedule check.
 * Run: node scripts/probe-airline-cancel-finish.js
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
  extractFirstSearchId,
  extractSearchIds,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { fetchRecentAlertPosts } from './lib/mattermostVendorAlerts.js';

const Q = { lang: 'en', currency: 'INR' };

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 350) {
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

function classify(res) {
  const raw = JSON.stringify(res?.data || {});
  const st = String(res?.data?.data?.cancellationRequest?.status || '');
  const msg = String(res?.data?.data?.cancellationRequest?.message || '');
  if (/unavailable online|offline cancellation/i.test(raw)) {
    return { ok: false, reason: 'VENDOR_OFFLINE_ONLY', status: st, message: msg };
  }
  if (/waiting for cancellation/i.test(raw)) {
    return { ok: false, reason: 'WAITING', status: st, message: msg };
  }
  if (/fail/i.test(st)) return { ok: false, reason: 'CANCEL_FAILED', status: st, message: msg };
  if (ok(res) && !/fail/i.test(st)) return { ok: true, reason: 'ACCEPTED', status: st || 'OK', message: msg };
  return { ok: false, reason: 'UNKNOWN', status: st, message: msg || brief(res.data) };
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  async function cancel(br, body) {
    return client.request({
      method: 'POST',
      path: `/v1/flights/booking/${br}/cancel`,
      query: Q,
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  async function waitTerm(br) {
    let last;
    for (let i = 0; i < 30; i += 1) {
      last = await flight.getBookingStatus(br);
      const st = String(last.data?.status || '');
      if (isTerminalBookingStatus(st)) return st;
      await sleep(4000);
    }
    return last?.data?.status;
  }

  async function tryAirline(code, maxFare = 12000) {
    console.log('\n##', code);
    const routes = [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'BLR']];
    let priced = null;
    for (const days of [30, 40, 55]) {
      for (const [o, d] of routes) {
        const body = buildOneWaySearchBody(days, {
          origin: o, destination: d, maxStops: 0, fareType: 'NORMAL',
        });
        body.preferences.airlines = [code];
        let sid = null;
        let data = null;
        for (let i = 0; i < 6; i += 1) {
          const s = await flight.search(body);
          data = s.data;
          sid = extractFirstSearchId(s.data);
          if (ok(s) && sid && (String(s.data?.progress?.state).toUpperCase() === 'COMPLETE' || i >= 3)) break;
          await sleep(2500);
        }
        if (!sid) continue;
        for (const searchId of extractSearchIds(data, 3)) {
          const p = await flight.getPricing([searchId], 'ONE_WAY');
          if (!ok(p)) continue;
          const total = Number(p.data?.pricing?.totalAmount || 999999);
          if (total > maxFare) continue;
          priced = {
            o, d, days, searchId, total,
            priceId: p.data.priceId,
            ctx: p.data.bookingContext,
          };
          break;
        }
        if (priced) break;
      }
      if (priced) break;
    }
    if (!priced) {
      console.log('no inventory');
      return { airline: code, result: 'NO_INVENTORY' };
    }
    console.log('priced', priced);
    const issue = await flight.issueTicket({
      bookingContext: priced.ctx,
      priceId: priced.priceId,
      searchIds: [priced.searchId],
      journeyType: 'ONE_WAY',
    });
    const br = issue.data?.bookingReference;
    if (!br) {
      console.log('issue fail', brief(issue.data));
      return { airline: code, result: 'ISSUE_FAILED', issue: issue.data };
    }
    const bookStatus = await waitTerm(br);
    const detail = await flight.getBookingDetail(br);
    const pnrs = extractPnrs(detail.data);
    console.log('booked', br, bookStatus, pnrs);
    if (String(bookStatus).toLowerCase() !== 'confirmed' || !pnrs[0]) {
      return { airline: code, result: 'NOT_CONFIRMED', br, bookStatus, pnrs };
    }
    const pen = await cancel(br, { action: 'PENALTY', pnr: pnrs[0] });
    const can = await cancel(br, { action: 'CANCEL', pnr: pnrs[0] });
    const c = classify(can);
    let statusAfter = null;
    for (let i = 0; i < 12; i += 1) {
      const s = await flight.getBookingStatus(br);
      statusAfter = s.data?.status;
      if (/cancel/i.test(String(statusAfter || ''))) break;
      await sleep(4000);
    }
    const works = c.ok || /cancel/i.test(String(statusAfter || ''));
    console.log('cancel', c, 'statusAfter', statusAfter);
    return {
      airline: code,
      result: works ? 'CANCEL_WORKS' : `CANCEL_FAIL:${c.reason}`,
      br,
      pnr: pnrs[0],
      bookStatus,
      statusAfter,
      cancel: c,
      penalty: classify(pen),
      priced,
    };
  }

  const rows = [];
  for (const code of ['QP', 'I5', 'SG']) {
    try {
      rows.push(await tryAirline(code, code === 'SG' ? 15000 : 12000));
    } catch (e) {
      rows.push({ airline: code, result: 'ERROR', error: e.message });
      console.log('err', e.message);
    }
  }

  const aiBr = 'BR1786015616687710';
  console.log('\n## AI follow-up', aiBr);
  const aiSt = await flight.getBookingStatus(aiBr);
  const aiDet = await flight.getBookingDetail(aiBr);
  const aiPnrs = extractPnrs(aiDet.data);
  console.log('AI status now', aiSt.data?.status, 'pnrs', aiPnrs);

  let aiReschedule = null;
  if (/cancel/i.test(String(aiSt.data?.status || '')) && aiPnrs[0]) {
    const body = buildOneWaySearchBody(50, {
      origin: 'DEL', destination: 'BOM', maxStops: 0, fareType: 'NORMAL',
    });
    let sid = null;
    for (let i = 0; i < 8; i += 1) {
      const s = await flight.search(body);
      sid = extractFirstSearchId(s.data);
      if (sid && String(s.data?.progress?.state).toUpperCase() === 'COMPLETE') break;
      await sleep(2500);
    }
    const p = await flight.getPricing([sid], 'ONE_WAY');
    const payload = buildIssueTicketPayload({
      bookingContext: p.data.bookingContext,
      priceId: p.data.priceId,
      searchIds: [sid],
    });
    payload.reschedulingReferenceId = aiBr;
    payload.reschedulingPnr = aiPnrs[0];
    const rs = await client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: { ...config.flight.issueTicketQuery, ...Q, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    console.log('AI RESCHEDULE', rs.status, brief(rs.data, 400));
    aiReschedule = { http: rs.status, body: rs.data, newBr: rs.data?.bookingReference || null };
    if (aiReschedule.newBr) {
      const ns = await waitTerm(aiReschedule.newBr);
      aiReschedule.newStatus = ns;
    }
  }

  const posts = await fetchRecentAlertPosts({ perPage: 50 });
  const aiWh = posts
    .filter((p) => (p.message || '').includes(aiBr))
    .slice(0, 8)
    .map((p) => ({
      created: new Date(p.create_at).toISOString(),
      status: (p.message || '').match(/status `([^`]+)`/)?.[1] || null,
    }));

  const prior = [
    { airline: 'SG', result: 'NO_INVENTORY_UNDER_8K' },
    {
      airline: '6E',
      result: 'CANCEL_FAIL:VENDOR_OFFLINE_ONLY',
      br: 'BR1786015377524920',
      message: 'Requested PNR cancellation is unavailable online...',
    },
    {
      airline: 'IX',
      result: 'CANCEL_FAIL:WAITING',
      br: 'BR1786015490629561',
      message: 'Your requested PNR is waiting for cancellation...',
    },
    {
      airline: 'AI',
      result: 'CANCEL_WORKS',
      br: aiBr,
      pnr: '8K7YV5',
      statusNow: aiSt.data?.status,
      webhooks: aiWh,
      reschedule: aiReschedule,
    },
    { airline: 'UK', result: 'NO_INVENTORY_UNDER_8K' },
  ];

  const all = [...prior, ...rows];
  const works = all.filter((r) => r.result === 'CANCEL_WORKS').map((r) => r.airline);
  const out = path.join('reports', 'airline-cancel-matrix-staging.json');
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ works, all, aiReschedule }, null, 2));
  console.log('\n=== FINAL ===');
  console.log('WORKS:', works);
  console.log(JSON.stringify(all.map((r) => ({
    airline: r.airline,
    result: r.result,
    statusAfter: r.statusAfter || r.statusNow || null,
    br: r.br || null,
  })), null, 2));
  console.log('Report:', out);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
