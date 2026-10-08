/**
 * Paxwise cancel validations (section 4) on staging.
 * Books a fresh 1ADT OW for invalid-payload checks (should not succeed-cancel).
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-paxwise-cancel-validations-staging.js
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
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/paxwise-cancel-validations-staging.json';
const Q = { ...FLIGHT_QUERY };

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function cancelStatus(r) {
  return (
    r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || null
  );
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 14; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 2) return st;
    await sleep(3000);
  }
  return last?.data?.status;
}

async function book1adt(flight, client) {
  const routes = [
    { o: 'MAA', d: 'BOM', days: 95 },
    { o: 'AMD', d: 'DEL', days: 96 },
    { o: 'CCU', d: 'BLR', days: 97 },
    { o: 'PNQ', d: 'DEL', days: 98 },
    { o: 'GOI', d: 'BOM', days: 99 },
    { o: 'HYD', d: 'MAA', days: 100 },
  ];
  for (const r of routes) {
    console.log(`BOOK OW ${r.o}->${r.d}`);
    const body = buildOneWaySearchBody(r.days, {
      origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    const search = await flight.searchUntilComplete(body);
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
      passengerProfile: {
        title: 'Mr', firstName: 'Nilesh', lastName: 'Verma', gender: 'Male', dob: '1992-04-08',
      },
    });
    payload.data.passengers[0].profile.firstName = 'Nilesh';
    payload.data.passengers[0].profile.lastName = 'Verma';
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
    const status = await waitStatus(flight, br);
    const detail = await flight.getBookingDetail(br);
    const detailStatus = detail.data?.status || status;
    const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
    console.log('  ->', br, detailStatus, pnr);
    if (pnr && /confirm/i.test(String(detailStatus)) && pnr !== 'FVRVRV') {
      return { br, pnr, status: detailStatus, route: `${r.o}-${r.d}` };
    }
    if (pnr === 'FVRVRV') {
      console.log('  skip stub PNR FVRVRV (polluted)');
    }
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await book1adt(flight, client);
  if (!fixture) throw new Error('No Confirmed 1ADT fixture for validations');

  const cancelApi = (body) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${fixture.br}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const results = [];
  const add = (id, how, expected, actual, status, note = '') => {
    results.push({ id, how, expected, actual, status, note });
    console.log(`[${status}] ${id} ${actual}`);
  };
  const expect = (cond, id, how, expected, actual, note) => {
    add(id, how, expected, actual, cond ? 'PASS' : 'BUG', note || '');
  };

  const base = { action: 'CANCEL', pnr: fixture.pnr };

  const cases = [
    ['4.1a', 'PAX1', 'VALIDATION_ERROR', 400],
    ['4.1c', [['PAX1']], 'VALIDATION_ERROR', 400],
    ['4.2a', [null], 'VALIDATION_ERROR', 400],
    ['4.2b', [true], 'VALIDATION_ERROR', 400],
    ['4.2c', [{}], 'VALIDATION_ERROR', 400],
    ['4.3a', ['ABC'], 'VALIDATION_ERROR', 400],
    ['4.3b', [''], 'VALIDATION_ERROR', 400],
    ['4.3c', [' '], 'VALIDATION_ERROR', 400],
    ['4.3d', ['1.5'], 'VALIDATION_ERROR', 400],
    ['4.3e', [-1], 'VALIDATION_ERROR', 400],
    ['4.3f', [0], 'VALIDATION_ERROR', 400],
    ['4.3g', ['PAX0'], 'VALIDATION_ERROR', 400],
    ['4.3h', ['PAX01'], 'VALIDATION_ERROR', 400],
    ['4.3i', ['2PAX3'], 'VALIDATION_ERROR', 400],
    ['4.4', ['FOO9'], 'VALIDATION_ERROR', 400],
    ['4.6', ['PAX9', 'ABC'], 'VALIDATION_ERROR', 400],
    ['4.7a', ['PAX1', 'PAX1'], 'VALIDATION_ERROR', 400],
    ['4.7b', ['PAX1', '1'], 'VALIDATION_ERROR', 400],
    ['4.7c', ['PAX1', 'pax_1'], 'VALIDATION_ERROR', 400],
    ['4.7d', [1, 1], 'VALIDATION_ERROR', 400],
    ['4.7e', [' PAX1 ', 'PAX1'], 'VALIDATION_ERROR', 400],
    ['4.8', ['PAX1', 'PAX1', 'PAX2', 'PAX2'], 'VALIDATION_ERROR', 400],
    ['4.9', ['ABC', 'PAX1', 'PAX1'], 'VALIDATION_ERROR', 400],
  ];

  for (const [id, list, code, http] of cases) {
    const r = await cancelApi({ ...base, cancellationPaxList: list });
    expect(
      r.status === http && errCode(r) === code,
      id,
      `list=${JSON.stringify(list)}`,
      `${http} ${code}`,
      `${r.status} ${errCode(r) || cancelStatus(r)}`,
      brief(r.data?.error || r.data, 180),
    );
  }

  // 4.1b object
  {
    const r = await cancelApi({ ...base, cancellationPaxList: { 0: 'PAX1' } });
    expect(
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
      '4.1b',
      'object {0:"PAX1"}',
      '400 VALIDATION_ERROR',
      `${r.status} ${errCode(r) || cancelStatus(r)}`,
      brief(r.data, 220),
    );
  }

  // 4.5 whitespace via PENALTY — docs: accepted (trim), not VALIDATION_ERROR
  {
    const r = await cancelApi({
      action: 'PENALTY',
      pnr: fixture.pnr,
      cancellationPaxList: [' PAX1 '],
    });
    expect(
      errCode(r) !== 'VALIDATION_ERROR',
      '4.5',
      '[" PAX1 "] via PENALTY',
      'not VALIDATION_ERROR',
      `${r.status} ${errCode(r) || cancelStatus(r)}`,
      brief(r.data, 200),
    );
  }

  // 4.10 too large on 1-pax
  {
    const r = await cancelApi({
      ...base,
      cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
    });
    expect(
      r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
      '4.10',
      '3 entries on 1-pax',
      '400 PAX_LIST_TOO_LARGE',
      `${r.status} ${errCode(r)}`,
      brief(r.data?.error || r.data, 160),
    );
  }

  // 4.11
  {
    const list = Array.from({ length: 51 }, (_, i) => `PAX${i + 1}`);
    const r = await cancelApi({ ...base, cancellationPaxList: list });
    expect(
      r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
      '4.11',
      '51 entries',
      '400 PAX_LIST_TOO_LARGE',
      `${r.status} ${errCode(r)}`,
    );
  }

  // 4.12
  {
    const r = await cancelApi({
      ...base,
      cancellationPaxList: ['PAX1', 'PAX9'],
    });
    expect(
      r.status === 422 && errCode(r) === 'PAX_NOT_IN_BOOKING',
      '4.12',
      '["PAX1","PAX9"]',
      '422 PAX_NOT_IN_BOOKING',
      `${r.status} ${errCode(r)}`,
      brief(r.data?.error || r.data, 160),
    );
  }

  // extras
  {
    const r = await cancelApi({ action: 'CANCEL', pnr: 'ZZZZZZ', cancellationPaxList: ['PAX1'] });
    expect(
      r.status === 422 && (errCode(r) === 'PNR_INVALID' || errCode(r) === 'PNR_NOT_FOUND'),
      '4.pnr-invalid',
      'unknown pnr',
      '422 PNR_INVALID/NOT_FOUND',
      `${r.status} ${errCode(r)}`,
    );
  }
  {
    const r = await cancelApi({ action: 'NOPE', pnr: fixture.pnr });
    expect(
      r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
      '4.bad-action',
      'bad action',
      '400 VALIDATION_ERROR',
      `${r.status} ${errCode(r)}`,
    );
  }

  const score = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  for (const x of results) {
    if (score[x.status] != null) score[x.status] += 1;
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixture,
    results,
    score,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('SCORE', score);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
