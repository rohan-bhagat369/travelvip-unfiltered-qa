/**
 * Probe which airlines support online PENALTY/CANCEL on staging.
 * Books cheap OW per airline preference, cancels, records outcome.
 *
 * Run: node scripts/probe-airline-cancel-matrix.js
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
  buildOneWaySearchBody,
  extractFirstSearchId,
  extractSearchIds,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { fetchRecentAlertPosts } from './lib/mattermostVendorAlerts.js';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join('reports', 'airline-cancel-matrix-staging.json');
const AIRLINES = (process.env.CANCEL_AIRLINES || 'SG,6E,IX,AI,UK,QP,I5').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_FARE = Number(process.env.CANCEL_MAX_FARE || '8000');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 400) {
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

function airlineFromDetail(detailData) {
  const codes = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    if (node.airline?.code) codes.add(node.airline.code);
    if (node.operatingCarrier?.code) codes.add(node.operatingCarrier.code);
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(detailData);
  return [...codes];
}

function classifyCancel(res) {
  const raw = JSON.stringify(res?.data || {});
  const st = String(
    res?.data?.data?.cancellationRequest?.status
    || res?.data?.cancellationRequest?.status
    || '',
  );
  const msg = String(
    res?.data?.data?.cancellationRequest?.message
    || res?.data?.message
    || '',
  );
  if (/unavailable online|offline cancellation/i.test(raw)) {
    return { ok: false, reason: 'VENDOR_OFFLINE_ONLY', status: st, message: msg };
  }
  if (/waiting for cancellation/i.test(raw)) {
    return { ok: false, reason: 'WAITING', status: st, message: msg };
  }
  if (/fail/i.test(st)) {
    return { ok: false, reason: 'CANCEL_FAILED', status: st, message: msg };
  }
  if (res?.status === 422 || res?.status === 400) {
    return { ok: false, reason: 'HTTP_ERROR', status: st, message: brief(res.data, 200) };
  }
  if (ok(res) && !/fail/i.test(st)) {
    return { ok: true, reason: 'ACCEPTED', status: st || 'OK', message: msg };
  }
  return { ok: false, reason: 'UNKNOWN', status: st, message: msg || brief(res.data, 200) };
}

async function waitTerm(flight, br, maxAttempts = 36) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (isTerminalBookingStatus(st)) return { status: st, response: last };
    await sleep(4500);
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

async function priceAirline(flight, code, days) {
  const routes = [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'HYD'], ['BLR', 'HYD'], ['DEL', 'GOI']];
  for (const [origin, destination] of routes) {
    const body = buildOneWaySearchBody(days, {
      origin, destination, maxStops: 0, fareType: 'NORMAL',
    });
    body.preferences.airlines = [code];
    let sid = null;
    let searchData = null;
    for (let i = 0; i < 10; i += 1) {
      const s = await flight.search(body);
      searchData = s.data;
      sid = extractFirstSearchId(s.data);
      const st = String(s.data?.progress?.state || '').toUpperCase();
      if (ok(s) && sid && (st === 'COMPLETE' || i >= 4)) break;
      await sleep(3000);
    }
    if (!sid) continue;

    // verify option airline matches preference when possible
    const ids = extractSearchIds(searchData, 5);
    for (const searchId of ids.length ? ids : [sid]) {
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!ok(pricing)) continue;
      const total = Number(pricing.data?.pricing?.totalAmount || Infinity);
      if (total > MAX_FARE) continue;
      const itinAirline = pricing.data?.itinerary?.[0]?.segments?.[0]?.airline?.code;
      return {
        origin, destination, searchId, total,
        priceId: pricing.data.priceId,
        bookingContext: pricing.data.bookingContext,
        itinAirline: itinAirline || code,
        days,
      };
    }
  }
  return null;
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Airlines:', AIRLINES.join(','), '| maxFare', MAX_FARE);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const rows = [];

  for (const code of AIRLINES) {
    console.log(`\n########## ${code} ##########`);
    const row = { airlinePref: code, searched: false, booked: false };
    try {
      let priced = null;
      for (const days of [35, 42, 50, 60]) {
        priced = await priceAirline(flight, code, days);
        if (priced) break;
      }
      if (!priced) {
        row.result = 'NO_INVENTORY';
        rows.push(row);
        console.log('No inventory/fare under cap');
        continue;
      }
      row.searched = true;
      row.priced = {
        route: `${priced.origin}-${priced.destination}`,
        total: priced.total,
        itinAirline: priced.itinAirline,
        days: priced.days,
      };
      console.log('Priced', row.priced);

      const issue = await flight.issueTicket({
        bookingContext: priced.bookingContext,
        priceId: priced.priceId,
        searchIds: [priced.searchId],
        journeyType: 'ONE_WAY',
      });
      const br = issue.data?.bookingReference;
      const issueMsg = JSON.stringify(issue.data || {});
      if (!ok(issue) || !br || /insufficient wallet/i.test(issueMsg)) {
        row.result = 'ISSUE_FAILED';
        row.issue = brief(issue.data, 250);
        rows.push(row);
        console.log('Issue failed', brief(issue.data, 200));
        continue;
      }
      row.br = br;
      const wait = await waitTerm(flight, br);
      row.bookStatus = wait.status;
      if (String(wait.status).toLowerCase() !== 'confirmed') {
        row.result = 'NOT_CONFIRMED';
        rows.push(row);
        console.log('Not confirmed', wait.status);
        continue;
      }
      row.booked = true;
      const detail = await flight.getBookingDetail(br);
      row.pnrs = extractPnrs(detail.data);
      row.airlinesOnTicket = airlineFromDetail(detail.data);
      const pnr = row.pnrs[0];
      console.log('Confirmed', br, 'pnr', pnr, 'airlines', row.airlinesOnTicket);
      if (!pnr) {
        row.result = 'NO_PNR';
        rows.push(row);
        continue;
      }

      const since = Date.now() - 2000;
      const penalty = await cancelCall(client, br, { action: 'PENALTY', pnr });
      const cancel = await cancelCall(client, br, { action: 'CANCEL', pnr });
      row.penalty = classifyCancel(penalty);
      row.cancel = classifyCancel(cancel);
      row.penaltyRaw = brief(penalty.data, 280);
      row.cancelRaw = brief(cancel.data, 280);

      let statusAfter = null;
      for (let i = 0; i < 18; i += 1) {
        const s = await flight.getBookingStatus(br);
        statusAfter = s.data?.status;
        if (/cancel/i.test(String(statusAfter || ''))) break;
        await sleep(5000);
      }
      row.statusAfterCancel = statusAfter;

      try {
        const posts = await fetchRecentAlertPosts({ perPage: 40 });
        row.webhooks = posts
          .filter((p) => (p.message || '').includes(br) && (p.create_at || 0) >= since)
          .map((p) => ({
            created: new Date(p.create_at).toISOString(),
            status: (p.message || '').match(/status `([^`]+)`/)?.[1] || null,
          }));
      } catch {
        row.webhooks = [];
      }

      const cancelable = /cancel/i.test(String(statusAfter || ''))
        || row.cancel.ok
        || (row.webhooks || []).some((w) => /cancellation_requested|cancelled/i.test(String(w.status || '')));

      row.cancelableOnline = cancelable;
      row.result = cancelable ? 'CANCEL_WORKS' : `CANCEL_FAIL:${row.cancel.reason}`;
      console.log('RESULT', row.result, 'statusAfter', statusAfter, 'cancel', row.cancel);
    } catch (e) {
      row.result = 'ERROR';
      row.error = e.message;
      console.log('ERROR', e.message);
    }
    rows.push(row);
  }

  const works = rows.filter((r) => r.result === 'CANCEL_WORKS').map((r) => r.airlinePref);
  const fails = rows.filter((r) => String(r.result).startsWith('CANCEL_FAIL')).map((r) => ({
    airline: r.airlinePref,
    reason: r.cancel?.reason,
    message: r.cancel?.message,
  }));

  const report = {
    baseUrl: config.baseUrl,
    maxFare: MAX_FARE,
    airlinesTried: AIRLINES,
    works,
    fails,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log('Cancel WORKS:', works.length ? works.join(', ') : '(none)');
  console.log('Cancel FAILS:', JSON.stringify(fails, null, 2));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
