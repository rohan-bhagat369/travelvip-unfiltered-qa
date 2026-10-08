/**
 * Flight reschedule domain validations with full issue-ticket body.
 * Run: node scripts/probe-flight-reschedule-domain-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
} from '../src/helpers.js';

const OUT = path.join('reports', 'flight-reschedule-domain-validations-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function code(r) {
  return r?.data?.error?.code || null;
}
function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function extractPnrs(detailData) {
  const found = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === 'string'
        && v.trim()
        && !v.startsWith('BR')
        && v.length >= 5
        && v.length <= 12
        && /pnr/i.test(k)
      ) {
        found.add(v.trim());
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return [...found];
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const routes = [
    { from: 'BOM', to: 'DEL', airline: 'SG' },
    { from: 'DEL', to: 'BOM', airline: 'SG' },
    { from: 'BOM', to: 'BLR', airline: 'SG' },
    { from: 'DEL', to: 'HYD', airline: null },
  ];

  let basePayload = null;
  for (const route of routes) {
    for (const days of [10, 14, 21, 28]) {
      const body = buildOneWaySearchBody(days, {
        origin: route.from,
        destination: route.to,
      });
      if (route.airline) {
        body.preferences = body.preferences || {};
        body.preferences.airlines = [route.airline];
      }
      const search = await flight.search(body);
      if (!ok(search)) continue;
      const searchId = extractFirstSearchId(search.data);
      if (!searchId) continue;
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) {
        console.log('pricing fail', route, days);
        continue;
      }
      basePayload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
      });
      console.log('priced', route, days, searchId);
      break;
    }
    if (basePayload) break;
  }
  if (!basePayload) throw new Error('could not price');

  const confirmedBr = 'BR1786017237353711';
  const confirmedPnr = 'E3CY3G';
  const cancelledBr = 'BR1786017179800507';
  const cancelledPnr = 'B7SVXP';

  const issue = (extra) => client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: FLIGHT_QUERY,
    body: { ...basePayload, ...extra },
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const issueV2 = (extra) => client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: FLIGHT_QUERY,
    body: { ...basePayload, ...extra },
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const rows = [];
  const add = (name, expectedHttp, status, note, res) => {
    rows.push({
      code: name,
      expectedHttp,
      status,
      note,
      http: res?.status,
      actualCode: code(res),
      snippet: brief(res?.data),
    });
    console.log(`[${status}] ${name} => ${res?.status} ${code(res)} — ${note}`);
    if (res?.data) console.log(' ', brief(res.data, 300));
  };

  {
    const res = await issue({ reschedulingReferenceId: confirmedBr });
    add(
      'VALIDATION_ERROR (pair missing PNR)',
      400,
      res.status === 400 && code(res) === 'VALIDATION_ERROR' && /reschedulingPnr/i.test(JSON.stringify(res.data))
        ? 'PASS' : 'FAIL',
      'full body',
      res,
    );
  }
  {
    const res = await issue({ reschedulingPnr: confirmedPnr });
    add(
      'VALIDATION_ERROR (pair missing Ref)',
      400,
      res.status === 400 && code(res) === 'VALIDATION_ERROR' && /reschedulingReferenceId/i.test(JSON.stringify(res.data))
        ? 'PASS' : 'FAIL',
      'full body',
      res,
    );
  }
  {
    const fake = `BR8${Date.now().toString().slice(-15)}`;
    const res = await issue({ reschedulingReferenceId: fake, reschedulingPnr: 'ABCDEF' });
    add(
      'RESCHEDULING_BOOKING_NOT_FOUND',
      404,
      res.status === 404 && code(res) === 'RESCHEDULING_BOOKING_NOT_FOUND' ? 'PASS' : 'FAIL',
      '',
      res,
    );
  }
  {
    const res = await issue({ reschedulingReferenceId: confirmedBr, reschedulingPnr: confirmedPnr });
    add(
      'RESCHEDULING_NOT_ALLOWED',
      422,
      res.status === 422 && code(res) === 'RESCHEDULING_NOT_ALLOWED' ? 'PASS' : 'FAIL',
      'confirmed booking',
      res,
    );
  }
  {
    const res = await issue({ reschedulingReferenceId: cancelledBr, reschedulingPnr: 'ZZZZZZ' });
    add(
      'RESCHEDULING_PNR_NOT_FOUND',
      404,
      code(res) === 'RESCHEDULING_PNR_NOT_FOUND' ? 'PASS' : 'INFO',
      'cancelled BR + fake PNR',
      res,
    );
  }
  {
    const res = await issue({ reschedulingReferenceId: cancelledBr, reschedulingPnr: cancelledPnr });
    add(
      'RESCHEDULING_REFERENCE_ALREADY_USED',
      409,
      code(res) === 'RESCHEDULING_REFERENCE_ALREADY_USED' ? 'PASS' : 'INFO',
      'known SG already rescheduled',
      res,
    );
  }
  {
    const res = await issue({ reschedulingReferenceId: cancelledBr, reschedulingPnr: confirmedPnr });
    add(
      'RESCHEDULING_PNR_MISMATCH',
      422,
      code(res) === 'RESCHEDULING_PNR_MISMATCH' ? 'PASS' : 'INFO',
      'cancelled BR + other booking PNR',
      res,
    );
  }
  {
    const res = await issue({
      reschedulingReferenceId: 'BR1786026302970325',
      reschedulingPnr: 'ABCDEF',
    });
    add('hotel BR as reschedule ref', null, 'INFO', 'observe', res);
  }
  {
    const res = await issue({
      reschedulingReferenceId: 'BR1784272911936907',
      reschedulingPnr: 'ABCDEF',
    });
    add(
      'RESCHEDULING_BOOKING_PARTNER_MISMATCH',
      403,
      code(res) === 'RESCHEDULING_BOOKING_PARTNER_MISMATCH' ? 'PASS' : 'INFO',
      'other partner BR',
      res,
    );
  }
  {
    const res = await issueV2({ reschedulingReferenceId: confirmedBr, reschedulingPnr: confirmedPnr });
    add(
      'v2 issue RESCHEDULING_NOT_ALLOWED',
      422,
      res.status === 422 && code(res) === 'RESCHEDULING_NOT_ALLOWED' ? 'PASS' : 'INFO',
      'api/v2 path',
      res,
    );
  }

  const hist = await client.request({
    method: 'GET',
    path: '/v1/flights/bookings/history',
    query: { ...FLIGHT_QUERY, page: 1, perpage: 30, status: 'Cancelled' },
    correlation: true,
  });
  const list = hist.data?.bookings || [];
  console.log('cancelled flights', list.length);
  for (const b of list.slice(0, 10)) {
    const br = b.bookingId;
    const det = await flight.getBookingDetail(br);
    const pnrs = extractPnrs(det.data);
    const pnr = pnrs[0];
    if (!pnr) continue;
    const res = await issue({ reschedulingReferenceId: br, reschedulingPnr: pnr });
    const c = code(res);
    console.log('history probe', br, pnr, res.status, c);
    if ([
      'RESCHEDULING_FLIGHT_DEPARTED',
      'RESCHEDULING_CANCELLATION_IN_PROGRESS',
      'RESCHEDULING_REFERENCE_ALREADY_USED',
      'RESCHEDULING_NOT_ALLOWED',
      'RESCHEDULING_PNR_NOT_FOUND',
    ].includes(c)) {
      add(c, res.status, 'PASS', `from cancelled history ${br}`, res);
      if (c === 'RESCHEDULING_FLIGHT_DEPARTED' || c === 'RESCHEDULING_CANCELLATION_IN_PROGRESS') break;
    }
  }

  const summary = {
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      FAIL: rows.filter((r) => r.status === 'FAIL').length,
      INFO: rows.filter((r) => r.status === 'INFO').length,
    },
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\nSUMMARY', summary.counts);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
