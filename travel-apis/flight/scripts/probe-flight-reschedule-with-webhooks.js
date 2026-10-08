/**
 * Continue reschedule test using known Confirmed BR + backend-alerts-dev webhooks.
 * Prefer BR1786003631906129 (confirmed, no cancel yet). Falls back to new cheap book.
 *
 * Run: node scripts/probe-flight-reschedule-with-webhooks.js
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
  isTerminalBookingStatus,
} from '../src/helpers.js';
import {
  fetchRecentAlertPosts,
  mattermostConfigured,
} from './lib/mattermostVendorAlerts.js';

const Q = { lang: 'en', currency: 'INR' };
const OUT = path.join('reports', 'flight-reschedule-webhooks-staging.json');
const PREFERRED_BR = process.env.RESCHEDULE_BR || 'BR1786003631906129';

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 500) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function extractAirlinePnrs(detailData) {
  const found = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && v.trim() && !v.startsWith('BR') && v.length <= 20 && /pnr/i.test(k)) {
        String(v).split('|').map((x) => x.trim()).filter(Boolean).forEach((p) => found.add(p));
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return [...found];
}

async function webhookEventsFor(br, sinceMs) {
  if (!mattermostConfigured()) return [];
  const posts = await fetchRecentAlertPosts({ perPage: 80 });
  return posts
    .filter((p) => (p.message || '').includes(br) && (!sinceMs || (p.create_at || 0) >= sinceMs))
    .map((p) => {
      const m = p.message || '';
      const status = (m.match(/status `([^`]+)`/i) || [])[1] || null;
      return {
        created: new Date(p.create_at).toISOString(),
        status,
        message: m.replace(/\n/g, ' | ').slice(0, 300),
      };
    });
}

async function waitWebhookStatus(br, wantRegex, sinceMs, timeoutMs = 120000) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < timeoutMs) {
    last = await webhookEventsFor(br, sinceMs);
    const hit = last.find((e) => wantRegex.test(String(e.status || '')));
    if (hit) return { hit, events: last };
    await sleep(5000);
  }
  return { hit: null, events: last, timedOut: true };
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

async function priceCheap(flight, daysOffset = 40) {
  const routes = [['DEL', 'BOM'], ['BOM', 'DEL'], ['BLR', 'HYD'], ['DEL', 'HYD']];
  let best = null;
  for (const [origin, destination] of routes) {
    const body = buildOneWaySearchBody(daysOffset, {
      origin, destination, maxStops: 0, fareType: 'NORMAL',
    });
    const { searchIds } = await flight.searchUntilComplete(body);
    for (const searchId of (searchIds || []).slice(0, 4)) {
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!ok(pricing)) continue;
      const total = Number(pricing.data?.pricing?.totalAmount ?? Infinity);
      if (!best || total < best.total) {
        best = {
          origin, destination, total, searchId, searchIds: [searchId],
          priceId: pricing.data?.priceId,
          bookingContext: pricing.data?.bookingContext || pricing.data?.requestReference,
          travelDate: body.itinerary[0].date,
        };
      }
      if (total <= 4000) return best;
    }
  }
  if (!best) throw new Error('no cheap flight');
  return best;
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Mattermost channel: backend-alerts-dev | configured:', mattermostConfigured());

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const findings = [];
  const note = (id, severity, title, detail) => {
    findings.push({ id, severity, title, detail });
    console.log(`\n[${severity}] ${id} ${title}`);
    console.log(' ', typeof detail === 'string' ? detail.slice(0, 450) : brief(detail, 450));
  };

  // Resolve booking
  let br = PREFERRED_BR;
  let statusRes = await flight.getBookingStatus(br);
  let status = statusRes.data?.status;
  console.log('Preferred BR', br, 'API status', status);

  if (String(status).toLowerCase() !== 'confirmed') {
    console.log('Preferred not Confirmed — booking cheap OW');
    const priced = await priceCheap(flight, 42);
    console.log('Priced', priced.origin, priced.destination, priced.total);
    if (priced.total > 20000) throw new Error(`fare too high for wallet: ${priced.total}`);
    const issue = await flight.issueTicket({
      bookingContext: priced.bookingContext,
      priceId: priced.priceId,
      searchIds: priced.searchIds,
    });
    br = issue.data?.bookingReference;
    if (!br) throw new Error(`issue failed ${brief(issue.data)}`);
    const sinceBook = Date.now() - 5000;
    const wh = await waitWebhookStatus(br, /booking\.confirmed|Confirmed/i, sinceBook, 180000);
    statusRes = await flight.getBookingStatus(br);
    status = statusRes.data?.status;
    note('WH-1', wh.hit ? 'OK' : 'GAP', 'Webhook booking.confirmed after issue', {
      apiStatus: status, webhook: wh.hit, events: wh.events,
    });
  }

  const detail = await flight.getBookingDetail(br);
  const pnrs = extractAirlinePnrs(detail.data);
  const pnr = pnrs[0];
  console.log('Using', br, 'pnr', pnr, 'apiStatus', status);
  if (!pnr) throw new Error('no pnr');

  // ---- validations (read-only-ish) ----
  const miss = await cancelCall(client, br, { action: 'PENALTY' });
  note(
    'BUG-1',
    miss.status === 400 && miss.data?.error?.code === 'VALIDATION_ERROR' ? 'OK' : 'BUG',
    'PENALTY without pnr must be VALIDATION_ERROR (docs: pnr required)',
    { http: miss.status, body: miss.data },
  );

  const empty = await cancelCall(client, br, { action: 'PENALTY', pnr: '' });
  note(
    'BUG-2',
    empty.status === 400 || empty.status === 422 ? 'OK' : 'BUG',
    'PENALTY empty pnr must validate',
    { http: empty.status, body: empty.data },
  );

  const badPnr = await cancelCall(client, br, { action: 'CANCEL', pnr: 'ZZZZZZ' });
  note(
    'OK-1',
    badPnr.status === 422 && badPnr.data?.error?.code === 'PNR_INVALID' ? 'OK' : 'GAP',
    'CANCEL invalid pnr → PNR_INVALID',
    { http: badPnr.status, body: badPnr.data },
  );

  // Reschedule field validation before cancel
  const pricedVal = await priceCheap(flight, 44);
  const onlyRef = await issueRaw(client, {
    ...buildIssueTicketPayload({
      bookingContext: pricedVal.bookingContext,
      priceId: pricedVal.priceId,
      searchIds: pricedVal.searchIds,
    }),
    reschedulingReferenceId: br,
  });
  note(
    'BUG-3',
    onlyRef.data?.error?.code === 'VALIDATION_ERROR' ? 'OK' : 'BUG',
    'Only reschedulingReferenceId (no reschedulingPnr) should VALIDATION_ERROR',
    { http: onlyRef.status, code: onlyRef.data?.error?.code, body: onlyRef.data },
  );

  const pricedVal2 = await priceCheap(flight, 45);
  const onlyPnr = await issueRaw(client, {
    ...buildIssueTicketPayload({
      bookingContext: pricedVal2.bookingContext,
      priceId: pricedVal2.priceId,
      searchIds: pricedVal2.searchIds,
    }),
    reschedulingPnr: pnr,
  });
  const normalBookLeak = ok(onlyPnr) || /wallet|pending|processing|insufficient/i.test(JSON.stringify(onlyPnr.data || {}));
  note(
    'BUG-4',
    onlyPnr.data?.error?.code === 'VALIDATION_ERROR' ? 'OK' : 'BUG',
    'Only reschedulingPnr (no referenceId) should VALIDATION_ERROR, not normal book',
    { http: onlyPnr.status, normalBookLeak, code: onlyPnr.data?.error?.code, body: onlyPnr.data },
  );

  // ---- real cancel ----
  const sinceCancel = Date.now() - 2000;
  const penalty = await cancelCall(client, br, { action: 'PENALTY', pnr });
  note('CHK-PENALTY', ok(penalty) ? 'INFO' : 'BUG', 'PENALTY valid pnr', penalty.data);

  const cancel = await cancelCall(client, br, { action: 'CANCEL', pnr });
  note('CHK-CANCEL', 'INFO', 'CANCEL valid pnr API response', cancel.data);

  const whCancel = await waitWebhookStatus(
    br,
    /cancellation_requested|cancelled|cancellation_failed/i,
    sinceCancel,
    150000,
  );
  note(
    'WH-2',
    whCancel.hit ? 'OK' : 'BUG',
    'Webhook after CANCEL',
    { hit: whCancel.hit, events: whCancel.events, timedOut: whCancel.timedOut },
  );

  // poll API status
  let apiAfter = null;
  for (let i = 0; i < 24; i += 1) {
    const s = await flight.getBookingStatus(br);
    apiAfter = s.data?.status;
    if (/cancel/i.test(String(apiAfter))) break;
    await sleep(5000);
  }
  note('CHK-API-STATUS', /cancel/i.test(String(apiAfter)) ? 'OK' : 'BUG', 'API status after cancel', {
    apiAfter,
    webhookStatus: whCancel.hit?.status,
  });

  // ---- reschedule if eligible ----
  const eligible = /cancel/i.test(String(apiAfter))
    || /cancellation_requested|cancelled/i.test(String(whCancel.hit?.status || ''));

  let newBr = null;
  let whNew = null;
  if (eligible) {
    const priced = await priceCheap(flight, 48);
    console.log('Reschedule target fare', priced.total, priced.origin, priced.destination, priced.travelDate);
    const sinceRes = Date.now() - 2000;
    const reschedule = await issueRaw(client, {
      ...buildIssueTicketPayload({
        bookingContext: priced.bookingContext,
        priceId: priced.priceId,
        searchIds: priced.searchIds,
      }),
      reschedulingReferenceId: br,
      reschedulingPnr: pnr,
    });
    newBr = reschedule.data?.bookingReference || reschedule.data?.bookingReferenceId || null;
    note(
      'CHK-RESCHEDULE',
      ok(reschedule) && newBr ? 'OK' : 'BUG',
      'Reschedule issue-ticket',
      { http: reschedule.status, newBr, body: reschedule.data },
    );

    if (newBr) {
      whNew = await waitWebhookStatus(newBr, /booking\.confirmed|Confirmed/i, sinceRes, 180000);
      const st = await flight.getBookingStatus(newBr);
      note('WH-3', whNew.hit ? 'OK' : 'GAP', 'Webhook for rescheduled booking', {
        newBr,
        apiStatus: st.data?.status,
        webhook: whNew.hit,
        events: whNew.events,
      });
    }

    // wrong pnr after eligible
    const pricedBad = await priceCheap(flight, 50);
    const bad = await issueRaw(client, {
      ...buildIssueTicketPayload({
        bookingContext: pricedBad.bookingContext,
        priceId: pricedBad.priceId,
        searchIds: pricedBad.searchIds,
      }),
      reschedulingReferenceId: br,
      reschedulingPnr: 'XXXXXX',
    });
    note(
      'CHK-BAD-PNR',
      bad.status >= 400 ? 'OK' : 'BUG',
      'Reschedule wrong pnr after cancel',
      { http: bad.status, code: bad.data?.error?.code, body: bad.data },
    );
  } else {
    note('BLOCKED', 'BUG', 'Cannot reschedule — cancel did not reach requested/cancelled', {
      apiAfter,
      webhook: whCancel.hit,
    });
  }

  const report = {
    baseUrl: config.baseUrl,
    channel: 'backend-alerts-dev',
    original: { br, pnr, apiStatusBefore: status, apiStatusAfterCancel: apiAfter },
    reschedule: { newBr, webhookNew: whNew?.hit || null },
    findings,
    bugs: findings.filter((f) => f.severity === 'BUG'),
    gaps: findings.filter((f) => f.severity === 'GAP'),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`${f.severity}\t${f.id}\t${f.title}`);
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
