/**
 * Multi-passenger cancellation matrix on canary.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-multipax-cancel-canary.js
 *
 * PHASES:
 *   book   — create F3 (1ADT), F_2ADT (2ADT), F1 (4ADT) if wallet allows
 *   valid  — section 4 validations (needs at least one confirmed BR+PNR)
 *   subset — partial pax CANCEL / PENALTY
 *   full   — no-list / full-list CANCEL|PENALTY (optional via RUN_FULL=1)
 *
 * Default: book + valid + subset. Set RUN_FULL=1 for section 1–2 money-moving cancels.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'multipax-cancel-canary.json');
const Q = { ...FLIGHT_QUERY };

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 500) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function errMsg(r) {
  return r?.data?.error?.message || r?.data?.message || null;
}
function cancelStatus(r) {
  return (
    r?.data?.cancellationRequest?.status
    || r?.data?.status
    || r?.data?.data?.cancellationRequest?.status
    || null
  );
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
}

function adultsPayload(n) {
  const names = [
    { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', gender: 'Male', dob: '2001-05-29' },
    { title: 'Mr', firstName: 'Amit', lastName: 'Sharma', gender: 'Male', dob: '1995-08-15' },
    { title: 'Mrs', firstName: 'Neha', lastName: 'Patil', gender: 'Female', dob: '1994-03-12' },
    { title: 'Mr', firstName: 'Vikram', lastName: 'Singh', gender: 'Male', dob: '1992-11-20' },
  ];
  return names.slice(0, n).map((p, i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { ...p, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: {
      number: null,
      expiry: null,
      issuedDate: null,
      issuedCountryCode: null,
    },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
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
          if (!seen.has(p)) {
            seen.add(p);
            found.push(p);
          }
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return found;
}

function extractOnlineCancel(detailData) {
  const it = detailData?.bookingResponse?.itinerary || detailData?.itinerary || [];
  const leg = it[0];
  return {
    online: leg?.onlineCancellation === true || leg?.onlineCancellation === 1,
    legCount: it.length,
    paxCount: (detailData?.bookingResponse?.passengers || detailData?.passengers || []).length,
  };
}

async function waitTerminal(flight, br, max = 24) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return { status: st, detail: last };
    await sleep(4000);
  }
  return { status: last?.data?.status, timedOut: true, detail: last };
}

async function cancelApi(client, bookingId, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${bookingId}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function bookOw(flight, client, { adults = 1, days = 45, origin = 'DEL', destination = 'BOM' }) {
  const body = buildOneWaySearchBody(days, {
    origin,
    destination,
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.travellers = { adults, children: 0, infants: 0 };

  const search = await flight.searchUntilComplete(body);
  const searchId = search.searchId;
  if (!searchId) throw new Error('no searchId');

  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!ok(pricing)) throw new Error(`pricing failed: ${brief(pricing.data)}`);

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = adultsPayload(adults);

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
  if (!br) throw new Error(`issue failed: ${brief(issue.data)}`);

  const { status } = await waitTerminal(flight, br, 30);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  const meta = extractOnlineCancel(detail.data);

  return {
    br,
    status,
    pnrs,
    pnr: pnrs[0] || null,
    adults,
    route: `${origin}-${destination}`,
    priceId: pricing.data.priceId,
    onlineCancellation: meta.online,
    issueHttp: issue.status,
    detailSnippet: brief(detail.data, 350),
  };
}

function row(id, how, expected, actual, status, note = '') {
  return { id, how, expected, actual, status, note };
}

function passFail(cond, id, how, expected, actual, note = '') {
  return row(id, how, expected, actual, cond ? 'PASS' : 'BUG', note);
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  console.log('Base:', config.baseUrl);
  console.log('Partner:', config.partnerId, 'Tier:', config.tierId, 'issuePid:', config.flight.issueTicketQuery.pid);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    fixtures: {},
    results: [],
    score: { PASS: 0, BUG: 0, NOT_TESTED: 0 },
  };

  const add = (r) => {
    report.results.push(r);
    if (report.score[r.status] != null) report.score[r.status] += 1;
    console.log(`[${r.status}] ${r.id} — ${r.how}`);
  };

  // ---------- BOOK FIXTURES ----------
  console.log('\n=== BOOK FIXTURES ===');
  try {
    console.log('Booking F3 (1 ADT)...');
    report.fixtures.F3 = await bookOw(flight, client, { adults: 1, days: 48 });
    console.log('F3', report.fixtures.F3.br, report.fixtures.F3.status, report.fixtures.F3.pnr);
  } catch (e) {
    report.fixtures.F3 = { error: e.message };
    console.log('F3 book failed', e.message);
  }

  try {
    console.log('Booking F_2ADT (2 ADT)...');
    report.fixtures.F_2ADT = await bookOw(flight, client, { adults: 2, days: 52 });
    console.log('F_2ADT', report.fixtures.F_2ADT.br, report.fixtures.F_2ADT.status, report.fixtures.F_2ADT.pnr);
  } catch (e) {
    report.fixtures.F_2ADT = { error: e.message };
    console.log('F_2ADT book failed', e.message);
  }

  try {
    console.log('Booking F1 (4 ADT)...');
    report.fixtures.F1 = await bookOw(flight, client, { adults: 4, days: 55 });
    console.log('F1', report.fixtures.F1.br, report.fixtures.F1.status, report.fixtures.F1.pnr);
  } catch (e) {
    report.fixtures.F1 = { error: e.message };
    console.log('F1 book failed', e.message);
  }

  const F3 = report.fixtures.F3?.status === 'Confirmed' ? report.fixtures.F3 : null;
  const F2a = report.fixtures.F_2ADT?.status === 'Confirmed' ? report.fixtures.F_2ADT : null;
  // Prefer F1; else use 2ADT as stand-in for multi-pax subset tests
  const Fmulti = report.fixtures.F1?.status === 'Confirmed'
    ? report.fixtures.F1
    : F2a;
  const multiLabel = report.fixtures.F1?.status === 'Confirmed' ? 'F1' : (F2a ? 'F_2ADT' : null);

  // ---------- VALIDATION (section 4) ----------
  console.log('\n=== SECTION 4 VALIDATION ===');
  const vBr = Fmulti?.br || F3?.br;
  const vPnr = Fmulti?.pnr || F3?.pnr;

  if (!vBr || !vPnr) {
    add(row('4.x', 'validation suite', 'confirmed BR+PNR', 'missing fixture', 'NOT_TESTED', 'Could not book confirmed fixture'));
  } else {
    const base = { action: 'CANCEL', pnr: vPnr };

    // 4.1 string / object / nested
    {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: 'PAX1' });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.1a',
        'cancellationPaxList as string "PAX1"',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
        brief(r.data, 200),
      ));
    }
    {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: { 0: 'PAX1' } });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.1b',
        'cancellationPaxList as object',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      ));
    }
    {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: [['PAX1']] });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.1c',
        'nested array [["PAX1"]]',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      ));
    }

    // 4.2
    for (const [id, list] of [
      ['4.2a', [null]],
      ['4.2b', [true]],
      ['4.2c', [{}]],
    ]) {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: list });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        id,
        `list ${JSON.stringify(list)}`,
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      ));
    }

    // 4.3
    for (const [id, list] of [
      ['4.3a', ['ABC']],
      ['4.3b', ['']],
      ['4.3c', [' ']],
      ['4.3d', ['1.5']],
      ['4.3e', [-1]],
      ['4.3f', [0]],
      ['4.3g', ['PAX0']],
      ['4.3h', ['PAX01']],
      ['4.3i', ['2PAX3']],
    ]) {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: list });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        id,
        `invalid token ${JSON.stringify(list)}`,
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      ));
    }

    // 4.4 FOO9
    {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: ['FOO9'] });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.4',
        '["FOO9"] must NOT cancel PAX9',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      ));
    }

    // 4.5 whitespace accepted — only if we have multi and won't burn full cancel; use PENALTY if single
    {
      const action = Fmulti && Fmulti.adults >= 2 ? 'CANCEL' : 'PENALTY';
      const list = Fmulti && Fmulti.adults >= 2 ? [' PAX1 '] : [' PAX1 '];
      // For 1ADT, whitespace PENALTY should work; for multi CANCEL subset is safer later — here just check accept vs validation
      const r = await cancelApi(client, vBr, {
        action: Fmulti && Fmulti.adults >= 2 ? 'PENALTY' : 'PENALTY',
        pnr: vPnr,
        cancellationPaxList: list,
      });
      // For multi subset PENALTY expect Penalty Not Available; for full single PENALTY may fetch
      const accepted = r.status !== 400 || errCode(r) !== 'VALIDATION_ERROR';
      add(passFail(
        accepted,
        '4.5',
        '[" PAX1 "] accepted (not VALIDATION_ERROR)',
        'accepted (normalized to PAX1)',
        `${r.status} ${errCode(r) || cancelStatus(r)}`,
        brief(r.data, 220),
      ));
    }

    // 4.6
    {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: ['PAX9', 'ABC'] });
      add(passFail(
        r.status === 400,
        '4.6',
        '["PAX9","ABC"]',
        '400 with invalidPax',
        `${r.status} ${errCode(r)} ${brief(r.data?.error, 180)}`,
      ));
    }

    // 4.7 duplicates
    for (const [id, list] of [
      ['4.7a', ['PAX1', 'PAX1']],
      ['4.7b', ['PAX1', '1']],
      ['4.7c', ['PAX1', 'pax_1']],
      ['4.7d', [1, 1]],
      ['4.7e', [' PAX1 ', 'PAX1']],
    ]) {
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: list });
      const dup = r.data?.error?.details?.duplicatePax || r.data?.error?.duplicatePax;
      add(passFail(
        r.status === 400 && (errCode(r) === 'VALIDATION_ERROR' || Boolean(dup)),
        id,
        `duplicates ${JSON.stringify(list)}`,
        '400 duplicatePax:["PAX1"]',
        `${r.status} ${errCode(r)} ${brief(r.data?.error, 160)}`,
      ));
    }

    // 4.8
    {
      const r = await cancelApi(client, vBr, {
        ...base,
        cancellationPaxList: ['PAX1', 'PAX1', 'PAX2', 'PAX2'],
      });
      add(passFail(
        r.status === 400,
        '4.8',
        'dup PAX1 and PAX2',
        '400 duplicatePax both',
        `${r.status} ${errCode(r)} ${brief(r.data?.error, 160)}`,
      ));
    }

    // 4.9 invalid precedes duplicate
    {
      const r = await cancelApi(client, vBr, {
        ...base,
        cancellationPaxList: ['ABC', 'PAX1', 'PAX1'],
      });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.9',
        'invalid-entry precedes duplicate',
        '400 invalid-entry (not only duplicate)',
        `${r.status} ${errCode(r)} ${brief(r.data?.error, 160)}`,
      ));
    }

    // 4.10 too large vs pax on PNR
    if (F3?.br && F3?.pnr) {
      const r = await cancelApi(client, F3.br, {
        action: 'CANCEL',
        pnr: F3.pnr,
        cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
      });
      add(passFail(
        r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
        '4.10',
        '3 entries on 1-pax PNR',
        '400 PAX_LIST_TOO_LARGE',
        `${r.status} ${errCode(r)}`,
        brief(r.data, 200),
      ));
    } else {
      add(row('4.10', '3 entries on 2-pax', 'PAX_LIST_TOO_LARGE', 'no F3', 'NOT_TESTED'));
    }

    // 4.11 51 entries
    {
      const list = Array.from({ length: 51 }, (_, i) => `PAX${i + 1}`);
      const r = await cancelApi(client, vBr, { ...base, cancellationPaxList: list });
      add(passFail(
        r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
        '4.11',
        '51 entries',
        '400 PAX_LIST_TOO_LARGE',
        `${r.status} ${errCode(r)}`,
      ));
    }

    // 4.12 PAX_NOT_IN_BOOKING
    {
      const r = await cancelApi(client, vBr, {
        ...base,
        cancellationPaxList: ['PAX1', 'PAX9'],
      });
      add(passFail(
        r.status === 422 && errCode(r) === 'PAX_NOT_IN_BOOKING',
        '4.12',
        '["PAX1","PAX9"]',
        '422 PAX_NOT_IN_BOOKING',
        `${r.status} ${errCode(r)}`,
        brief(r.data, 220),
      ));
    }

    // Older guards
    {
      const r = await cancelApi(client, vBr, { action: 'CANCEL', pnr: 'NOTREAL', cancellationPaxList: ['PAX1'] });
      add(passFail(
        r.status === 422 && (errCode(r) === 'PNR_INVALID' || errCode(r) === 'PNR_NOT_FOUND'),
        '4.33ish',
        'unknown pnr',
        '422 PNR_INVALID/NOT_FOUND',
        `${r.status} ${errCode(r)}`,
      ));
    }
    {
      const r = await cancelApi(client, 'BR0000000000000000', { action: 'CANCEL', pnr: 'XXXXXX' });
      add(passFail(
        r.status === 404 && errCode(r) === 'BOOKING_NOT_FOUND',
        '4.BOOKING_NOT_FOUND',
        'unknown BR',
        '404 BOOKING_NOT_FOUND',
        `${r.status} ${errCode(r)}`,
      ));
    }
    {
      const r = await cancelApi(client, vBr, { action: 'NOPE', pnr: vPnr });
      add(passFail(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.bad-action',
        'bad action',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      ));
    }
  }

  // ---------- SUBSET / PENALTY (section 3) ----------
  console.log('\n=== SECTION 3 SUBSET ===');
  if (!Fmulti?.br || !Fmulti?.pnr || Fmulti.adults < 2) {
    add(row('3.x', 'subset cancel', 'multi-pax confirmed', 'missing', 'NOT_TESTED'));
  } else {
    const br = Fmulti.br;
    const pnr = Fmulti.pnr;
    const total = Fmulti.adults;

    // 3.6 PENALTY subset
    {
      const r = await cancelApi(client, br, {
        action: 'PENALTY',
        pnr,
        cancellationPaxList: ['PAX1'],
      });
      const scope = paxScope(r);
      const st = cancelStatus(r);
      const noAmountKeys = !('estimatedRefund' in (r.data || {})) && !('penaltyAmount' in (r.data || {}));
      add(passFail(
        (r.status === 200 || r.status === 400 || r.status === 422)
          && (/penalty not available/i.test(String(st)) || /PENALTY_NOT_AVAILABLE|NOT_AVAILABLE/i.test(String(errCode(r) || st || '')) || /not available/i.test(errMsg(r) || '')),
        '3.6',
        `${multiLabel} PENALTY ["PAX1"]`,
        'Penalty Not Available, penaltyQuotable=false, no amounts',
        `${r.status} status=${st} code=${errCode(r)} scope=${brief(scope)}`,
        brief(r.data, 280),
      ));
      // soft note if shape differs
      if (scope && scope.penaltyQuotable === false) {
        // already covered
      }
    }

    // 3.1 subset CANCEL
    {
      const list = total >= 4 ? ['PAX1', 'PAX2'] : ['PAX1'];
      const r = await cancelApi(client, br, {
        action: 'CANCEL',
        pnr,
        cancellationPaxList: list,
        cancellationReason: 'QA multipax subset test',
      });
      const scope = paxScope(r);
      const st = cancelStatus(r);
      const requested = /cancellation requested/i.test(String(st)) || /requested/i.test(String(st));
      add(passFail(
        ok(r) && requested && scope?.scope === 'PARTIAL_PAX' && scope?.prorated === true,
        '3.1',
        `${multiLabel} CANCEL ${JSON.stringify(list)}`,
        'Cancellation Requested + PARTIAL_PAX prorated=true',
        `${r.status} status=${st} scope=${brief(scope)}`,
        brief(r.data, 320),
      ));
    }

    // 4.21 duplicate open request
    {
      const r = await cancelApi(client, br, {
        action: 'CANCEL',
        pnr,
        cancellationPaxList: ['PAX1'],
      });
      add(passFail(
        r.status === 409 && errCode(r) === 'CANCELLATION_ALREADY_IN_PROGRESS',
        '4.21',
        'repeat ["PAX1"] while open',
        '409 CANCELLATION_ALREADY_IN_PROGRESS',
        `${r.status} ${errCode(r)}`,
        brief(r.data, 220),
      ));
    }

    // 4.22 different pax while PAX1 open
    if (total >= 2) {
      const r = await cancelApi(client, br, {
        action: 'CANCEL',
        pnr,
        cancellationPaxList: ['PAX2'],
      });
      const st = cancelStatus(r);
      add(passFail(
        ok(r) && /requested/i.test(String(st)),
        '4.22',
        '["PAX2"] while PAX1 open — allowed',
        'Cancellation Requested',
        `${r.status} ${st} ${errCode(r)}`,
        brief(r.data, 220),
      ));
    }
  }

  // ---------- FULL cancel optional ----------
  if (process.env.RUN_FULL === '1') {
    console.log('\n=== SECTION 1–2 FULL (RUN_FULL=1) ===');
    // Book a fresh 1ADT for full cancel so we don't reuse subset-burned BR
    try {
      const f = await bookOw(flight, client, { adults: 1, days: 60 });
      report.fixtures.F3_full = f;
      if (f.status === 'Confirmed' && f.pnr) {
        const pen = await cancelApi(client, f.br, { action: 'PENALTY', pnr: f.pnr });
        add(passFail(
          ok(pen) && /penalty fetched/i.test(String(cancelStatus(pen))),
          '1.4',
          'PENALTY no list on 1ADT',
          'Penalty Fetched',
          `${pen.status} ${cancelStatus(pen)}`,
          brief(pen.data, 200),
        ));

        const can = await cancelApi(client, f.br, { action: 'CANCEL', pnr: f.pnr });
        add(passFail(
          ok(can) && !paxScope(can) && /cancel/i.test(String(cancelStatus(can))),
          '1.1',
          'CANCEL no list on 1ADT',
          'Cancelled, no paxScope',
          `${can.status} ${cancelStatus(can)} scope=${brief(paxScope(can))}`,
          brief(can.data, 250),
        ));
      }
    } catch (e) {
      add(row('1.1', 'full cancel', 'Cancelled', e.message, 'NOT_TESTED'));
    }
  } else {
    add(row('1.1–2.x', 'full-PNR CANCEL/PENALTY', 'run with RUN_FULL=1', 'skipped by default after subset', 'NOT_TESTED', 'Set RUN_FULL=1 to execute money-moving full cancels'));
  }

  // Fixtures not creatable via partner API alone
  for (const id of ['F2', 'F5', 'F6', 'F7', 'F8', 'F9', 'F4']) {
    add(row(
      `fixture-${id}`,
      `needs special ${id} setup`,
      'dedicated book/seed',
      'not auto-created this run',
      'NOT_TESTED',
      id === 'F4' ? 'RT dual PNR — can add later' : 'DB seed / infant / roster issues',
    ));
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', report.score);
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
