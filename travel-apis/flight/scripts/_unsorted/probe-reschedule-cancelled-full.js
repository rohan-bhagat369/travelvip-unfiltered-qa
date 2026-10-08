/**
 * Reschedule from fully cancelled OW bookings (issue-ticket + reschedule refs).
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-reschedule-cancelled-full.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/reschedule-cancelled-full.json';
const Q = { ...FLIGHT_QUERY };

const CANCELLED_FIXTURES = [
  { label: 'SG happy path source', br: 'BR1786017179800507', pnr: 'B7SVXP' },
  { label: 'SG DEL-BOM cancel', br: 'BR1786361308728715', pnr: 'KCIE7A' },
  { label: 'SG cancel scan', br: 'BR1786361337462087', pnr: 'FEG3NK' },
  { label: 'Canary 2ADT full cancel', br: 'BR1786450253892994', pnr: 'CQRUVC', canaryOnly: true },
];

const SEARCH_MATRIX = [
  { origin: 'DEL', destination: 'BOM', airlines: ['SG'], days: [28, 35, 42, 49, 56] },
  { origin: 'BOM', destination: 'DEL', airlines: ['SG'], days: [28, 35, 42, 49] },
  { origin: 'DEL', destination: 'BOM', airlines: [], days: [30, 40, 50] },
  { origin: 'BOM', destination: 'BLR', airlines: ['SG', '6E'], days: [35, 45] },
  { origin: 'HYD', destination: 'DEL', airlines: ['IX', '6E'], days: [40, 50] },
];

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function waitStatus(flight, br, max = 12) {
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress|pending/i.test(s) && i >= 4) return s;
    await sleep(2500);
  }
  return null;
}

async function findPricing(flight, matrix) {
  for (const row of matrix) {
    for (const days of row.days) {
      for (const airlines of [row.airlines].flat().length ? [row.airlines] : [[]]) {
        const body = buildOneWaySearchBody(days, {
          origin: row.origin,
          destination: row.destination,
          fareType: 'NORMAL',
          maxStops: 0,
        });
        body.travellers = { adults: 1, children: 0, infants: 0 };
        if (airlines.length) {
          body.preferences = { ...(body.preferences || {}), airlines };
        }

        let sid = null;
        for (let i = 0; i < 8; i += 1) {
          const s = await flight.search(body);
          sid = extractFirstSearchId(s.data);
          if (sid) break;
          if (isSearchProgressComplete(s.data)) break;
          await sleep(2000);
        }
        if (!sid) continue;

        const pricing = await flight.getPricing([sid], 'ONE_WAY');
        if (!pricing.data?.priceId) continue;

        return {
          route: `${row.origin}-${row.destination}`,
          days,
          airlines: airlines.join(',') || 'any',
          searchId: sid,
          priceId: pricing.data.priceId,
          bookingContext: pricing.data.bookingContext,
          total: pricing.data?.pricing?.totalAmount,
        };
      }
    }
  }
  return null;
}

async function issueReschedule(client, flight, priced, { br, pnr, path }) {
  const payload = buildIssueTicketPayload({
    bookingContext: priced.bookingContext,
    priceId: priced.priceId,
    searchIds: [priced.searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      title: 'Mr', firstName: 'Amit', lastName: 'Resched rs', gender: 'Male', dob: '1989-06-15',
    },
  });
  payload.reschedulingReferenceId = br;
  payload.reschedulingPnr = pnr;

  const iss = await client.request({
    method: 'POST',
    path,
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const newBr = iss.data?.bookingReference || iss.data?.bookingReferenceId || null;
  let newStatus = iss.data?.status || null;
  if (newBr) newStatus = await waitStatus(flight, newBr);

  return {
    path,
    http: iss.status,
    code: iss.data?.error?.code || null,
    newBr,
    newStatus,
    ok: Boolean(newBr) && /confirm/i.test(String(newStatus || '')),
    body: brief(iss.data, 700),
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  const isCanary = /canary/i.test(config.baseUrl);
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixtures = CANCELLED_FIXTURES.filter((f) => (isCanary ? true : !f.canaryOnly));
  const results = [];

  for (const fix of fixtures) {
    console.log('\n===', fix.label, fix.br, fix.pnr, '===');
    let status = null;
    let legs = [];
    try {
      const st = await flight.getBookingStatus(fix.br);
      status = st.data?.status || null;
      const detail = await flight.getBookingDetail(fix.br);
      status = detail.data?.status || status;
      legs = (detail.data?.bookingResponse?.itinerary || []).map((l) => ({
        direction: l.direction,
        pnr: l.pnr,
      }));
    } catch (e) {
      results.push({ ...fix, error: e.message });
      continue;
    }

    console.log('status', status, legs);
    if (!/cancel/i.test(String(status))) {
      results.push({ ...fix, status, legs, skipped: 'not_cancelled' });
      continue;
    }

    console.log('searching replacement flight…');
    const priced = await findPricing(flight, SEARCH_MATRIX);
    if (!priced) {
      results.push({ ...fix, status, legs, error: 'no_pricing' });
      console.log('no pricing');
      continue;
    }
    console.log('priced', priced.route, priced.days, priced.airlines, 'total', priced.total);

    const v2 = await issueReschedule(client, flight, priced, {
      br: fix.br,
      pnr: fix.pnr,
      path: '/api/v2/flights/booking/issue-ticket',
    });
    console.log('v2', v2.http, v2.code, v2.newBr, v2.newStatus);

    let v1 = null;
    if (!v2.ok) {
      v1 = await issueReschedule(client, flight, priced, {
        br: fix.br,
        pnr: fix.pnr,
        path: '/v1/flights/booking/issue-ticket',
      });
      console.log('v1', v1.http, v1.code, v1.newBr, v1.newStatus);
    }

    const win = v2.ok ? v2 : v1?.ok ? v1 : v2;
    results.push({
      ...fix,
      status,
      legs,
      priced,
      reschedule: { v2, v1 },
      outcome: win.ok ? 'PASS' : 'FAIL',
      newBr: win.newBr,
      newStatus: win.newStatus,
    });
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    results,
    summary: {
      tried: results.length,
      pass: results.filter((r) => r.outcome === 'PASS').length,
      fail: results.filter((r) => r.outcome === 'FAIL').length,
      skipped: results.filter((r) => r.skipped || r.error).length,
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSUMMARY', report.summary);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
