/**
 * Multi-passenger cancellation matrix on canary.
 * POST /v1/flights/booking/{bookingId}/cancel + cancellationPaxList
 *
 * WARNING: full-PNR CANCEL on online legs moves real wallet money.
 * Default SKIP_FULL_REFUND_CANCEL=1 skips money-moving full cancels unless set to 0.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-flight-multipax-cancel-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'flight-multipax-cancel-canary.json');
const SKIP_FULL_REFUND = String(process.env.SKIP_FULL_REFUND_CANCEL || '1') !== '0';

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
function statusText(r) {
  return (
    r?.data?.status
    || r?.data?.cancellationRequest?.status
    || r?.data?.data?.status
    || r?.data?.message
    || null
  );
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
}

function extractPnrs(detail) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /pnr/i.test(k) && !/^BR/i.test(v) && v.length <= 24) {
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
  walk(detail);
  return found;
}

function extractOnlineCancel(detail) {
  const itin = detail?.bookingResponse?.itinerary || detail?.itinerary || [];
  const leg = Array.isArray(itin) ? itin[0] : null;
  if (leg?.onlineCancellation != null) return Boolean(leg.onlineCancellation);
  if (detail?.bookingResponse?.onlineCancellation != null) {
    return Boolean(detail.bookingResponse.onlineCancellation);
  }
  return null;
}

function extractPaxIds(detail) {
  const pax = detail?.bookingResponse?.passengers || detail?.passengers || [];
  return pax.map((p, i) => String(p.paxId || `PAX${i + 1}`));
}

async function cancelApi(client, bookingId, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${bookingId}/cancel`,
    query: FLIGHT_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

function adultsPayload(n) {
  const names = [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
    ['Vikram', 'Patil', 'Mr', 'Male', '1992-03-10'],
    ['Suresh', 'Nair', 'Mr', 'Male', '1988-11-22'],
  ];
  return Array.from({ length: n }, (_, i) => {
    const [firstName, lastName, title, gender, dob] = names[i];
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title,
        firstName,
        lastName,
        gender,
        dob,
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: {
        number: null,
        expiry: null,
        issuedDate: null,
        issuedCountryCode: null,
      },
      ssr: { baggage: [], meals: [], seats: [] },
    };
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
  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  if (!ok(pricing)) {
    return { error: 'pricing', detail: brief(pricing.data) };
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = adultsPayload(adults);

  const issue = await flight.issueTicket({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });
  // rebuild with multi pax — issueTicket helper uses 1 pax; call raw
  const issueRaw = await client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const br =
    issueRaw.data?.bookingReference
    || issueRaw.data?.bookingReferenceId
    || issueRaw.data?.bookingRefId;
  if (!br) {
    return { error: 'issue', detail: brief(issueRaw.data), http: issueRaw.status };
  }

  let status = issueRaw.data?.status;
  for (let i = 0; i < 36; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = st.data?.status;
    if (ok(st) && isTerminalBookingStatus(status)) break;
    await sleep(4000);
  }

  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  return {
    bookingReference: br,
    status,
    pnr: pnrs[0] || null,
    pnrs,
    onlineCancellation: extractOnlineCancel(detail.data),
    paxIds: extractPaxIds(detail.data),
    adults,
    totalAmount: detail.data?.bookingResponse?.salesSummary?.totalAmount
      || pricing.data?.pricing?.totalAmount
      || pricing.data?.totalAmount,
    detailSnippet: brief(detail.data, 350),
  };
}

function row(id, how, expected, actual, status, notes = '') {
  return { id, how, expected, actual, status, notes };
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl);
  console.log('Partner:', config.partnerId, 'Tier:', config.tierId);
  console.log('Issue pid:', config.flight.issueTicketQuery.pid);
  console.log('SKIP_FULL_REFUND_CANCEL:', SKIP_FULL_REFUND);

  if (!/canary/i.test(config.baseUrl)) {
    console.warn('WARNING: BASE_URL is not canary');
  }

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const results = [];
  const fixtures = {};

  // ---- Book fixtures ----
  console.log('\n=== Book F3 (1 ADT) ===');
  fixtures.F3 = await bookOw(flight, client, { adults: 1, days: 48 });
  console.log(brief(fixtures.F3, 400));

  console.log('\n=== Book F1-like (2 ADT first; 4 if wallet ok) ===');
  fixtures.F2ADT = await bookOw(flight, client, { adults: 2, days: 52 });
  console.log(brief(fixtures.F2ADT, 400));

  let f4adt = null;
  if (/confirm/i.test(String(fixtures.F2ADT?.status))) {
    console.log('\n=== Book F1 (4 ADT) ===');
    f4adt = await bookOw(flight, client, { adults: 4, days: 55 });
    console.log(brief(f4adt, 400));
    if (/confirm/i.test(String(f4adt?.status)) && f4adt.pnr) {
      fixtures.F1 = f4adt;
    }
  }
  if (!fixtures.F1 && /confirm/i.test(String(fixtures.F2ADT?.status)) && fixtures.F2ADT.pnr) {
    fixtures.F1 = { ...fixtures.F2ADT, note: 'Using 2ADT as F1 stand-in (4ADT unavailable)' };
  }

  const F3 = fixtures.F3;
  const F1 = fixtures.F1;

  // ---- 4. Validation (need booking id + pnr) ----
  const valBr = F3?.bookingReference || F1?.bookingReference;
  const valPnr = F3?.pnr || F1?.pnr;

  async function expectValidation(id, body, expectCode, expectHttp = 400) {
    if (!valBr || !valPnr) {
      results.push(row(id, 'skip', expectCode, null, 'NOT TESTED', 'no fixture BR/PNR'));
      return;
    }
    const r = await cancelApi(client, valBr, { action: 'CANCEL', pnr: valPnr, ...body });
    const code = errCode(r);
    const pass = r.status === expectHttp && code === expectCode;
    results.push(
      row(
        id,
        JSON.stringify(body),
        `${expectHttp} ${expectCode}`,
        { http: r.status, code, snippet: brief(r.data, 280) },
        pass ? 'PASS' : 'BUG',
      ),
    );
    console.log(id, pass ? 'PASS' : 'BUG', r.status, code);
  }

  console.log('\n=== Section 4 validations ===');
  // 4.1 string instead of list
  await expectValidation('4.1a', { cancellationPaxList: 'PAX1' }, 'VALIDATION_ERROR', 400);
  await expectValidation('4.1b', { cancellationPaxList: { 0: 'PAX1' } }, 'VALIDATION_ERROR', 400);
  await expectValidation('4.1c', { cancellationPaxList: [['PAX1']] }, 'VALIDATION_ERROR', 400);

  // 4.2
  await expectValidation('4.2a', { cancellationPaxList: [null] }, 'VALIDATION_ERROR', 400);
  await expectValidation('4.2b', { cancellationPaxList: [true] }, 'VALIDATION_ERROR', 400);
  await expectValidation('4.2c', { cancellationPaxList: [{}] }, 'VALIDATION_ERROR', 400);

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
    await expectValidation(id, { cancellationPaxList: list }, 'VALIDATION_ERROR', 400);
  }

  // 4.4
  await expectValidation('4.4', { cancellationPaxList: ['FOO9'] }, 'VALIDATION_ERROR', 400);

  // 4.5 whitespace accepted — only assert not VALIDATION_ERROR on format; may be 422 if only 1 pax and ok
  if (valBr && valPnr) {
    const r = await cancelApi(client, valBr, {
      action: 'PENALTY',
      pnr: valPnr,
      cancellationPaxList: [' PAX1 '],
    });
    const code = errCode(r);
    // Accepted format: should NOT be VALIDATION_ERROR for whitespace
    const pass = code !== 'VALIDATION_ERROR';
    results.push(
      row(
        '4.5',
        '[" PAX1 "] via PENALTY',
        'accepted (not VALIDATION_ERROR)',
        { http: r.status, code, status: statusText(r), paxScope: paxScope(r), snippet: brief(r.data, 300) },
        pass ? 'PASS' : 'BUG',
      ),
    );
    console.log('4.5', pass ? 'PASS' : 'BUG', r.status, code);
  }

  // 4.6
  if (valBr && valPnr) {
    const r = await cancelApi(client, valBr, {
      action: 'CANCEL',
      pnr: valPnr,
      cancellationPaxList: ['PAX9', 'ABC'],
    });
    const code = errCode(r);
    const invalid = r.data?.error?.details?.invalidPax || r.data?.invalidPax;
    const pass = r.status === 400 && code === 'VALIDATION_ERROR';
    results.push(
      row('4.6', '["PAX9","ABC"]', '400 VALIDATION_ERROR + invalidPax', {
        http: r.status,
        code,
        invalid,
        snippet: brief(r.data, 300),
      }, pass ? 'PASS' : (code ? 'BUG' : 'BUG')),
    );
    console.log('4.6', r.status, code, brief(r.data, 200));
  }

  // 4.7 duplicates
  for (const [id, list] of [
    ['4.7a', ['PAX1', 'PAX1']],
    ['4.7b', ['PAX1', '1']],
    ['4.7c', ['PAX1', 'pax_1']],
    ['4.7d', [1, 1]],
    ['4.7e', [' PAX1 ', 'PAX1']],
  ]) {
    if (!valBr || !valPnr) {
      results.push(row(id, JSON.stringify(list), '400 duplicatePax', null, 'NOT TESTED'));
      continue;
    }
    const r = await cancelApi(client, valBr, {
      action: 'CANCEL',
      pnr: valPnr,
      cancellationPaxList: list,
    });
    const code = errCode(r);
    const dup = r.data?.error?.details?.duplicatePax || r.data?.duplicatePax;
    const pass = r.status === 400 && (code === 'VALIDATION_ERROR' || Boolean(dup));
    results.push(
      row(id, JSON.stringify(list), '400 + duplicatePax:["PAX1"]', {
        http: r.status,
        code,
        dup,
        snippet: brief(r.data, 280),
      }, pass ? 'PASS' : 'BUG'),
    );
    console.log(id, r.status, code, dup);
  }

  // 4.10 too large for 1-pax booking
  if (F3?.bookingReference && F3?.pnr) {
    const r = await cancelApi(client, F3.bookingReference, {
      action: 'CANCEL',
      pnr: F3.pnr,
      cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
    });
    const code = errCode(r);
    const pass = r.status === 400 && code === 'PAX_LIST_TOO_LARGE';
    results.push(
      row('4.10', '3 entries on 1-pax PNR', '400 PAX_LIST_TOO_LARGE', {
        http: r.status,
        code,
        snippet: brief(r.data, 280),
      }, pass ? 'PASS' : 'BUG'),
    );
    console.log('4.10', r.status, code);
  }

  // 4.11 51 entries
  if (valBr && valPnr) {
    const list = Array.from({ length: 51 }, (_, i) => `PAX${i + 1}`);
    const r = await cancelApi(client, valBr, {
      action: 'CANCEL',
      pnr: valPnr,
      cancellationPaxList: list,
    });
    const code = errCode(r);
    const pass = r.status === 400 && code === 'PAX_LIST_TOO_LARGE';
    results.push(
      row('4.11', '51 entries', '400 PAX_LIST_TOO_LARGE', {
        http: r.status,
        code,
        snippet: brief(r.data, 280),
      }, pass ? 'PASS' : 'BUG'),
    );
    console.log('4.11', r.status, code);
  }

  // 4.12 PAX not in booking
  if (F1?.bookingReference && F1?.pnr) {
    const r = await cancelApi(client, F1.bookingReference, {
      action: 'CANCEL',
      pnr: F1.pnr,
      cancellationPaxList: ['PAX1', 'PAX9'],
    });
    const code = errCode(r);
    const pass = r.status === 422 && code === 'PAX_NOT_IN_BOOKING';
    results.push(
      row('4.12', '["PAX1","PAX9"]', '422 PAX_NOT_IN_BOOKING', {
        http: r.status,
        code,
        snippet: brief(r.data, 300),
      }, pass ? 'PASS' : 'BUG'),
    );
    console.log('4.12', r.status, code);
  } else {
    results.push(row('4.12', 'needs multi-pax', '422 PAX_NOT_IN_BOOKING', null, 'NOT TESTED'));
  }

  // ---- Section 3 subset (safer — no provider / no refund) ----
  console.log('\n=== Section 3 subset CANCEL / PENALTY ===');
  if (F1?.bookingReference && F1?.pnr && (F1.paxIds?.length || 0) >= 2) {
    const subset = ['PAX1'];
    const r = await cancelApi(client, F1.bookingReference, {
      action: 'CANCEL',
      pnr: F1.pnr,
      cancellationPaxList: subset,
      cancellationReason: 'QA multipax subset probe',
    });
    const st = statusText(r);
    const scope = paxScope(r);
    const pass = /request/i.test(String(st)) || (ok(r) && scope?.scope === 'PARTIAL_PAX');
    results.push(
      row('3.2', `CANCEL subset ${JSON.stringify(subset)} on ${F1.bookingReference}`, 'Cancellation Requested + PARTIAL_PAX', {
        http: r.status,
        status: st,
        scope,
        snippet: brief(r.data, 400),
      }, pass ? 'PASS' : 'BUG', F1.note || ''),
    );
    console.log('3.2', r.status, st, brief(scope || r.data, 250));

    // 3.6 PENALTY subset
    const remaining = (F1.paxIds || ['PAX1', 'PAX2']).filter((p) => p !== 'PAX1').slice(0, 1);
    const target = remaining[0] || 'PAX2';
    const p = await cancelApi(client, F1.bookingReference, {
      action: 'PENALTY',
      pnr: F1.pnr,
      cancellationPaxList: [target],
    });
    const pCode = errCode(p);
    const pStatus = statusText(p);
    const pScope = paxScope(p);
    const pPass =
      /Penalty Not Available/i.test(String(pStatus))
      || pScope?.penaltyQuotable === false
      || pCode === 'PENALTY_NOT_AVAILABLE';
    results.push(
      row('3.6', `PENALTY [${target}]`, 'Penalty Not Available / penaltyQuotable=false', {
        http: p.status,
        status: pStatus,
        code: pCode,
        scope: pScope,
        snippet: brief(p.data, 400),
      }, pPass ? 'PASS' : 'BUG'),
    );
    console.log('3.6', p.status, pStatus, pCode);
  } else {
    results.push(row('3.2', 'subset cancel', 'Cancellation Requested', null, 'NOT TESTED', 'need confirmed multi-pax'));
    results.push(row('3.6', 'subset penalty', 'Penalty Not Available', null, 'NOT TESTED'));
  }

  // ---- Section 2.4 / 1.4 PENALTY full on F3 ----
  if (F3?.bookingReference && F3?.pnr) {
    const pen = await cancelApi(client, F3.bookingReference, {
      action: 'PENALTY',
      pnr: F3.pnr,
    });
    const st = statusText(pen);
    const pass = /Penalty Fetched/i.test(String(st)) || (ok(pen) && !errCode(pen));
    results.push(
      row('1.4', 'PENALTY no list F3', 'Penalty Fetched', {
        http: pen.status,
        status: st,
        snippet: brief(pen.data, 350),
      }, pass ? 'PASS' : 'BUG'),
    );
    console.log('1.4', pen.status, st);

    const pen1 = await cancelApi(client, F3.bookingReference, {
      action: 'PENALTY',
      pnr: F3.pnr,
      cancellationPaxList: ['PAX1'],
    });
    const st1 = statusText(pen1);
    const pass1 = /Penalty Fetched/i.test(String(st1)) && !/Not Available/i.test(String(st1));
    results.push(
      row('2.7', 'PENALTY ["PAX1"] F3', 'Penalty Fetched (not Not Available)', {
        http: pen1.status,
        status: st1,
        scope: paxScope(pen1),
        snippet: brief(pen1.data, 350),
      }, pass1 ? 'PASS' : 'BUG'),
    );
    console.log('2.7', pen1.status, st1);
  }

  // ---- Full refund cancels (optional) ----
  if (!SKIP_FULL_REFUND) {
    console.log('\n=== Full CANCEL (money moves) ===');
    if (F3?.bookingReference && F3?.pnr && F3.onlineCancellation) {
      const r = await cancelApi(client, F3.bookingReference, {
        action: 'CANCEL',
        pnr: F3.pnr,
        cancellationPaxList: ['PAX1'],
      });
      results.push(
        row('2.4', 'CANCEL ["PAX1"] F3 online', 'Cancelled', {
          http: r.status,
          status: statusText(r),
          scope: paxScope(r),
          snippet: brief(r.data, 400),
        }, /cancel/i.test(String(statusText(r))) ? 'PASS' : 'BUG'),
      );
    }
  } else {
    results.push(
      row(
        '1.1/2.x full CANCEL',
        'skipped by default',
        'Cancelled + refund',
        null,
        'NOT TESTED',
        'Set SKIP_FULL_REFUND_CANCEL=0 to run money-moving cancels',
      ),
    );
  }

  // Fixtures we cannot create via API alone
  for (const id of ['F7', 'F8', 'F9', 'F5', 'F6', 'F4', '1.5', '3.4', '3.5', '4.13', '4.14', '4.17', '4.18', '4.19', '5.1']) {
    if (!results.find((x) => x.id === id)) {
      results.push(row(id, 'needs special fixture/DB seed or concurrent harness', 'per docs', null, 'NOT TESTED'));
    }
  }

  const summary = {
    PASS: results.filter((r) => r.status === 'PASS').length,
    BUG: results.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: results.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    skipFullRefundCancel: SKIP_FULL_REFUND,
    fixtures,
    summary,
    results,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===', summary);
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
