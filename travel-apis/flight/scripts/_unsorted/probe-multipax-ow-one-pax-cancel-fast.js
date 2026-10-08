/**
 * Multipax OW canary — few routes only, fail fast, cancel PAX2.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-multipax-ow-one-pax-cancel-fast.js
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

const OUT = 'reports/multipax-ow-one-pax-cancel-fast-canary.json';
const Q = { ...FLIGHT_QUERY };
const ROUTES = [
  { o: 'DEL', d: 'BOM', days: 45 },
  { o: 'BLR', d: 'HYD', days: 50 },
  { o: 'BOM', d: 'GOI', days: 52 },
];

// Unique name pairs per booking attempt (letters only — API rejects digits in names)
const NAME_PAIRS = [
  [['Rohan', 'Deshmukh'], ['Amit', 'Kulkarni']],
  [['Vikram', 'Joshi'], ['Sneha', 'Iyer']],
  [['Imran', 'Sheikh'], ['Pooja', 'Nair']],
];

function letterTag() {
  // map time → letters only e.g. "xqkm"
  const n = Date.now() % 456976; // 26^4
  let s = '';
  let x = n;
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

function brief(d, n = 300) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function searchOnce(flight, body) {
  let last;
  for (let i = 0; i < 8; i += 1) {
    last = await flight.search(body);
    const done = isSearchProgressComplete(last.data);
    const sid = extractFirstSearchId(last.data);
    console.log('  search poll', i + 1, last.status, last.data?.progress?.state, 'sid?', Boolean(sid));
    if (sid) return { ok: true, searchId: sid, data: last.data };
    if (done) break;
    await sleep(2000);
  }
  return { ok: false, data: last?.data };
}

async function waitConfirm(flight, br) {
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', i + 1, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 2) return s;
    await sleep(2500);
  }
  return null;
}

function passengers2(pairIndex) {
  const pair = NAME_PAIRS[pairIndex % NAME_PAIRS.length];
  const tag = letterTag();
  const city = { cityCode: 'Pune', cityName: 'Pune' };
  const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  const ssr = { baggage: [], meals: [], seats: [] };
  const female = new Set(['Sneha', 'Pooja']);
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true, city, passport, ssr,
      profile: {
        title: 'Mr',
        firstName: pair[0][0],
        lastName: `${pair[0][1]} ${tag}`,
        gender: 'Male',
        dob: '1990-01-15',
        nationality: 'IN',
      },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false, city, passport, ssr,
      profile: {
        title: female.has(pair[1][0]) ? 'Mrs' : 'Mr',
        firstName: pair[1][0],
        lastName: `${pair[1][1]} ${tag}`,
        gender: female.has(pair[1][0]) ? 'Female' : 'Male',
        dob: '1991-06-20',
        nationality: 'IN',
      },
    },
  ];
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  let fixture = null;

  for (let i = 0; i < ROUTES.length; i += 1) {
    const r = ROUTES[i];
    const paxList = passengers2(i);
    console.log(
      `TRY ${r.o}->${r.d} +${r.days} names=${paxList.map((p) => `${p.profile.firstName} ${p.profile.lastName}`).join(' + ')}`,
    );
    try {
      const body = buildOneWaySearchBody(r.days, {
        origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      const search = await searchOnce(flight, body);
      if (!search.ok) {
        console.log('  no searchId — next route');
        continue;
      }
      const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [search.searchId],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = paxList;
      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        console.log('  issue fail', brief(issue.data));
        continue;
      }
      const status = await waitConfirm(flight, br);
      const detail = await flight.getBookingDetail(br);
      const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr;
      const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => ({
        paxId: p.paxId,
        name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
      }));
      console.log('  ->', br, status, pnr, pax.map((x) => `${x.paxId}:${x.name}`).join(','));
      if (pnr && /confirm/i.test(String(status || detail.data?.status)) && pnr !== 'FVRVRV' && pax.length >= 2) {
        fixture = {
          br,
          pnr,
          status: detail.data?.status || status,
          route: `${r.o}-${r.d}`,
          pax,
          adults: 2,
          namesUsed: paxList.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
        };
        break;
      }
      console.log('  not usable — next route');
    } catch (e) {
      console.log('  error — next route:', e.message);
    }
  }

  if (!fixture) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'no fixture', routesTried: ROUTES }, null, 2));
    throw new Error('No Confirmed 2ADT after 3 routes');
  }

  const cancelPayload = {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationPaxList: ['PAX2'],
  };
  console.log('CANCEL', cancelPayload);
  const cancel = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body: cancelPayload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixture,
    cancelPayload,
    cancel: {
      http: cancel.status,
      cancelStatus: cancel.data?.cancellationRequest?.status
        || cancel.data?.data?.cancellationRequest?.status,
      paxScope: cancel.data?.paxScope || cancel.data?.data?.paxScope,
      body: cancel.data,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('RESULT', report.cancel.http, report.cancel.cancelStatus, report.cancel.paxScope);
  console.log('BR', fixture.br, 'PNR', fixture.pnr);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
