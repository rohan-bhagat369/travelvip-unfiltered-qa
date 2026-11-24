/**
 * delta-api flight booking sanity (staging vgm creds):
 *   1) ONE_WAY  PNQ→DEL  → confirm → v2 PENALTY → v2 CANCEL
 *   2) ROUND_TRIP PNQ↔DXB → confirm → v2 PENALTY → v2 CANCEL
 *      (PNQ↔DEL RT has mandatory ONWARD meal but SSR only returns RETURN meals → issue 400)
 *
 * NOTE: delta Riya flight is SIMULATOR-only. Vendor only replays
 * PNQ-DEL, PNQ-DXB, DXB-LHR (OW or RT). DEL-BOM etc → VENDOR_ERROR / SIM-NO-RECORDING.
 *
 * Inprogress: leave BR, retry once with new names + dates, then stop.
 * INSUFFICIENT_BALANCE: abort remaining cases.
 *
 * Run:
 *   BASE_URL=https://delta-api.travelvip.ai node travel-apis/flight/scripts/probe-delta-flight-ow-rt-book-cancel.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
} from '../src/helpers.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports', 'delta-flight-sanity');
const Q = { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 };

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function okHttp(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}

function classifyStatus(raw) {
  const s = String(raw || '');
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  if (/pending/i.test(s)) return 'Pending';
  return s || 'Unknown';
}

function isSettled(classified) {
  return ['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classified);
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
  return opt?.segments?.[0]?.airline?.code || null;
}

function scoreRow(rule, how, status, evidence = {}) {
  const { status: _ignored, ...rest } = evidence;
  return { rule, how, status, bookingStatus: evidence.status, ...rest };
}

function firstMeal(ssrData) {
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      if (!pref) continue;
      return { m, pref, seg };
    }
  }
  return null;
}

function mealsForItinerary(pricingData, raw) {
  const meals = [];
  for (const leg of pricingData?.itinerary || []) {
    const seg0 = (leg.segments || [])[0] || {};
    const dir = String(leg.direction || '').toUpperCase() === 'RETURN' ? 'RETURN' : 'ONWARD';
    meals.push({
      ssrId: String(raw.m.ssrId || raw.m.mealId || ''),
      mealId: String(raw.m.ssrId || raw.m.mealId || ''),
      direction: dir,
      segmentId: seg0.segmentId || 'SEG_1',
      paxType: 'ADT',
      code: raw.m.code,
      title: raw.m.title || 'Meal',
      description: raw.m.description || raw.m.title || 'Meal',
      priceReference: raw.pref,
      origin: seg0.departure?.airportCode,
      destination: seg0.arrival?.airportCode,
    });
  }
  return meals;
}

async function attachMandatoryMeals(flight, pricingData, payload) {
  // Sim PNQ-DEL often marks meal mandatory; always try SSR attach when we have priceId
  if (!pricingData?.priceId) return payload;
  const ssr = await flight.getSsr(pricingData.priceId);
  const raw = firstMeal(ssr.data);
  if (!raw) {
    console.log('  no meal in SSR catalog');
    return payload;
  }
  const meals = mealsForItinerary(pricingData, raw);
  if (!payload.data.passengers?.[0]?.ssr) {
    payload.data.passengers[0].ssr = { meals: [], seats: [], baggage: [] };
  }
  payload.data.passengers[0].ssr.meals = meals;
  console.log('  attached meals', meals.map((m) => `${m.direction}:${m.origin}-${m.destination}`).join(', '));
  return payload;
}

async function waitSettled(flight, br, { max = 48, intervalMs = 5000 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const classified = classifyStatus(last.data?.status);
    console.log(`  status ${i + 1}/${max}`, last.data?.status, `→ ${classified}`);
    if (isSettled(classified)) {
      return { status: last.data?.status, classified, response: last, polls: i + 1 };
    }
    await sleep(intervalMs);
  }
  return {
    status: last?.data?.status,
    classified: classifyStatus(last?.data?.status),
    response: last,
    polls: max,
    timedOut: true,
  };
}

async function issueV2(client, payload) {
  return client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function cancelV2(flight, br, { action, pnr }) {
  const body = {
    bookingId: br,
    action,
    ...(pnr ? { pnr } : {}),
    cancelledBy: 'USER',
  };
  const res = await flight.cancelV2(body);
  return { request: body, http: res.status, ok: okHttp(res), body: res.data };
}

async function cancelFlow(flight, br, pnrs) {
  const steps = [];
  const targets = pnrs.length ? pnrs.slice(0, 2) : [null];
  for (const pnr of targets) {
    const penalty = await cancelV2(flight, br, { action: 'PENALTY', pnr });
    console.log('  PENALTY', pnr || '(none)', penalty.http, brief(penalty.body, 220));
    const cancel = await cancelV2(flight, br, { action: 'CANCEL', pnr });
    console.log('  CANCEL', pnr || '(none)', cancel.http, brief(cancel.body, 220));
    const st = await flight.getBookingStatus(br);
    steps.push({
      pnr,
      penalty,
      cancel,
      statusAfterThisCancel: st.data?.status,
      cancelRequestStatus: st.data?.cancellationRequest?.status || null,
    });
    await sleep(3000);
  }

  let after = await flight.getBookingStatus(br);
  for (let i = 0; i < 15; i += 1) {
    const classified = classifyStatus(after.data?.status);
    const req = after.data?.cancellationRequest?.status;
    if (classified === 'Cancelled' || /cancellation requested/i.test(String(req || ''))) break;
    await sleep(4000);
    after = await flight.getBookingStatus(br);
    console.log('  after-cancel poll', after.data?.status, after.data?.cancellationRequest?.status || '');
  }

  return {
    steps,
    statusAfterCancel: after.data?.status,
    cancellationRequest: after.data?.cancellationRequest || null,
  };
}

function cancelVerdict(bookStatus, cancelResult) {
  if (bookStatus !== 'Confirmed') {
    return { status: 'NOT TESTED', note: `book was ${bookStatus}` };
  }
  const final = classifyStatus(cancelResult.statusAfterCancel);
  const req = String(cancelResult.cancellationRequest?.status || '');
  // Product: booking status may stay Confirmed while cancellationRequest is
  // Cancellation Requested (or Cancelled) — that is expected PASS.
  if (
    final === 'Cancelled'
    || /cancellation requested/i.test(req)
    || (/confirm/i.test(String(cancelResult.statusAfterCancel || '')) && /cancel/i.test(req))
  ) {
    return {
      status: 'PASS',
      note: `bookingStatus=${cancelResult.statusAfterCancel}${req ? ` cancellationRequest=${req}` : ''}`,
    };
  }
  const last = cancelResult.steps?.[cancelResult.steps.length - 1];
  const http = last?.cancel?.http;
  const cancelReq = last?.cancel?.body?.data?.cancellationRequest?.status
    || last?.cancel?.body?.cancellationRequest?.status;
  if (okHttp({ status: http }) && /cancel/i.test(String(cancelReq || ''))) {
    return {
      status: 'PASS',
      note: `cancel API ok; bookingStatus=${cancelResult.statusAfterCancel || 'Confirmed'} cancellationRequest=${cancelReq} (Confirmed+cancel-req expected)`,
    };
  }
  const code = last?.cancel?.body?.error?.code;
  if (http && http >= 500) return { status: 'BUG', note: `cancel HTTP ${http} ${code || brief(last.cancel.body, 120)}` };
  return {
    status: 'BUG',
    note: `expected Cancelled or Confirmed+Cancellation Requested; got bookingStatus=${cancelResult.statusAfterCancel} req=${req || 'none'}`,
  };
}

async function bookOwAttempt(flight, client, { onwardDays, nameIndex }) {
  const body = buildOneWaySearchBody(onwardDays, {
    origin: 'PNQ', destination: 'DEL', maxStops: null, fareType: 'NORMAL',
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  delete body.preferences.maxStops;

  console.log(`\nOW search PNQ→DEL d+${onwardDays}`);
  const search = await flight.searchUntilComplete(body);
  const sid = search.searchId;
  if (!sid) return { ok: false, error: 'no OW searchId', searchBrief: brief(search.data) };

  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  if (!okHttp(pricing) || !pricing.data?.priceId || !pricing.data?.bookingContext) {
    return { ok: false, error: 'OW pricing failed', pricing: brief(pricing.data) };
  }

  const passengers = buildPassengers({
    adults: 1, children: 0, infants: 0, uniqueNames: true, nameIndex,
  });
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [sid],
    journeyType: 'ONE_WAY',
    passengerProfile: passengers[0]?.profile,
  });
  payload.data.passengers = passengers;
  payload.data.passportType = pricing.data.passportType || 'NONE';
  await attachMandatoryMeals(flight, pricing.data, payload);

  const issue = await issueV2(client, payload);
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  console.log('OW issue', issue.status, br || brief(issue.data, 250));
  if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
    return { ok: false, abort: true, error: 'INSUFFICIENT_BALANCE', issue: issue.data };
  }
  if (!br) return { ok: false, error: 'OW issue no BR', issue: issue.data };

  const wait = await waitSettled(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  return {
    ok: wait.classified === 'Confirmed',
    journeyType: 'ONE_WAY',
    route: 'PNQ→DEL',
    onwardDays,
    searchId: sid,
    priceId: pricing.data.priceId,
    pricedTotal: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
    br,
    status: wait.status,
    classified: wait.classified,
    polls: wait.polls,
    timedOut: wait.timedOut || false,
    pnrs,
    passengers: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
    detailBrief: brief(detail.data, 500),
  };
}

async function bookRtAttempt(flight, client, { onwardDays, returnDays, nameIndex }) {
  const body = buildRoundTripSearchBody(onwardDays, returnDays, {
    origin: 'PNQ', destination: 'DXB', maxStops: null, fareType: 'NORMAL',
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  delete body.preferences.maxStops;

  console.log(`\nRT search PNQ↔DXB d+${onwardDays}/+${returnDays}`);
  const { response: rtSearch } = await flight.searchRoundTripUntilComplete(body);
  const blocks = rtSearch.data?.results || [];
  const onward = (blocks.find((r) => String(r.direction).toUpperCase() === 'ONWARD') || {}).options || [];
  const ret = (blocks.find((r) => String(r.direction).toUpperCase() === 'RETURN') || {}).options || [];
  console.log('RT options', onward.length, ret.length);

  let picked = null;
  for (const o of onward.slice(0, 12)) {
    for (const r of ret.slice(0, 12)) {
      if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
      const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
      if (!okHttp(pricing) || !pricing.data?.priceId || !pricing.data?.bookingContext) continue;
      const total = Number(pricing.data?.pricing?.totalAmount || pricing.data?.totalAmount || 0);
      const ao = airlineCode(o);
      const ar = airlineCode(r);
      const mixed = Boolean(ao && ar && ao !== ar);
      const cand = {
        ao, ar, mixed, total, pricing,
        searchIds: [o.searchId, r.searchId],
        oLabel: `${ao} ${(o.segments || []).map((s) => s.flightNumber).join('/')}`,
        rLabel: `${ar} ${(r.segments || []).map((s) => s.flightNumber).join('/')}`,
      };
      if (!picked || (mixed && !picked.mixed) || (total && total < (picked.total || Infinity))) {
        picked = cand;
      }
      if (picked?.mixed) break;
    }
    if (picked?.mixed) break;
  }
  if (!picked) return { ok: false, error: 'no RT priced pair' };

  console.log('RT picked', picked.ao, picked.ar, 'mixed', picked.mixed, 'total', picked.total);

  const withPassport = true; // PNQ-DXB is international
  const passengers = buildPassengers({
    adults: 1, children: 0, infants: 0, uniqueNames: true, nameIndex, withPassport,
  });
  const payload = buildIssueTicketPayload({
    bookingContext: picked.pricing.data.bookingContext,
    priceId: picked.pricing.data.priceId,
    searchIds: picked.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = passengers;
  payload.data.passportType = picked.pricing.data.passportType || 'REGULAR';
  await attachMandatoryMeals(flight, picked.pricing.data, payload);

  const issue = await issueV2(client, payload);
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  console.log('RT issue', issue.status, br || brief(issue.data, 250));
  if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
    return { ok: false, abort: true, error: 'INSUFFICIENT_BALANCE', issue: issue.data };
  }
  if (!br) return { ok: false, error: 'RT issue no BR', issue: issue.data };

  const wait = await waitSettled(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  return {
    ok: wait.classified === 'Confirmed',
    journeyType: 'ROUND_TRIP',
    route: 'PNQ→DXB→PNQ',
    onwardDays,
    returnDays,
    airlines: [picked.ao, picked.ar],
    mixedAirline: picked.mixed,
    pricedTotal: picked.total,
    priceId: picked.pricing.data.priceId,
    searchIds: picked.searchIds,
    flights: { onward: picked.oLabel, return: picked.rLabel },
    br,
    status: wait.status,
    classified: wait.classified,
    polls: wait.polls,
    timedOut: wait.timedOut || false,
    pnrs,
    passengers: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
    detailBrief: brief(detail.data, 500),
  };
}

async function bookWithInprogressRetry(label, attemptFn, datePairs) {
  const attempts = [];
  for (let i = 0; i < datePairs.length; i += 1) {
    const attempt = await attemptFn({ ...datePairs[i], nameIndex: i + Date.now() % 97 });
    attempts.push(attempt);
    if (attempt.abort) return { book: attempt, attempts, aborted: true };
    if (attempt.ok && attempt.classified === 'Confirmed') {
      return { book: attempt, attempts, aborted: false };
    }
    if (attempt.classified === 'Inprogress') {
      console.log(`${label}: Inprogress on ${attempt.br} — leave BR; ${i === 0 ? 'retry once with new names+dates' : 'stop'}`);
      if (i === 0) continue;
      return { book: attempt, attempts, aborted: false, stoppedAfterInprogressRetry: true };
    }
    if (attempt.classified === 'Failed') {
      console.log(`${label}: Failed on ${attempt.br || 'no-br'} — ${i === 0 ? 'retry once' : 'stop'}`);
      if (i === 0) continue;
      return { book: attempt, attempts, aborted: false };
    }
    // other errors: try next date once
    if (i === 0) continue;
    return { book: attempt, attempts, aborted: false };
  }
  return { book: attempts[attempts.length - 1] || { ok: false, error: 'no attempts' }, attempts, aborted: false };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Partner:', config.partnerId, 'tier:', config.tierId);
  console.log('Tag:', uniqueTag());

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const rows = [];
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    cases: {},
    rows: [],
  };

  // Auth sanity
  rows.push(scoreRow(
    'AUTH',
    'partner token + session on delta-api with staging vgm creds',
    session?.client?.partnerKey ? 'PASS' : 'BUG',
    { baseUrl: config.baseUrl },
  ));

  // ─── OW ───────────────────────────────────────────────
  console.log('\n========== OW BOOK + CANCEL ==========');
  const owPack = await bookWithInprogressRetry('OW', (args) => bookOwAttempt(flight, client, args), [
    { onwardDays: 28 },
    { onwardDays: 35 },
  ]);

  if (owPack.aborted) {
    rows.push(scoreRow('OW.BOOK', 'issue-ticket ONE_WAY PNQ→DEL', 'BUG', { note: 'INSUFFICIENT_BALANCE', br: owPack.book.br }));
    rows.push(scoreRow('OW.CANCEL', 'v2 cancel after OW confirm', 'NOT TESTED', { note: 'aborted on INSUFFICIENT_BALANCE' }));
    report.cases.ow = owPack;
    report.rows = rows;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outAbort = path.join(OUT_DIR, `delta-ow-rt-book-cancel-${Date.now()}.json`);
    fs.writeFileSync(outAbort, JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
    console.log('\nABORTED — INSUFFICIENT_BALANCE. Report:', outAbort);
    process.exitCode = 1;
    return;
  }

  const owBook = owPack.book;
  rows.push(scoreRow(
    'OW.BOOK',
    'search→price→issue-ticket→poll Confirmed (Inprogress → 1 retry)',
    owBook.classified === 'Confirmed' ? 'PASS'
      : owBook.classified === 'Inprogress' ? 'NOT TESTED'
        : owBook.classified === 'Failed' ? 'BUG' : 'BUG',
    {
      br: owBook.br,
      status: owBook.status,
      classified: owBook.classified,
      pnrs: owBook.pnrs,
      pricedTotal: owBook.pricedTotal,
      attempts: owPack.attempts.map((a) => ({ br: a.br, status: a.status, classified: a.classified, error: a.error })),
    },
  ));

  let owCancel = null;
  if (owBook.classified === 'Confirmed' && owBook.br) {
    console.log('\nOW cancel flow on', owBook.br, 'pnrs', owBook.pnrs);
    owCancel = await cancelFlow(flight, owBook.br, owBook.pnrs || []);
    const verdict = cancelVerdict('Confirmed', owCancel);
    rows.push(scoreRow('OW.CANCEL', 'v2 PENALTY + CANCEL; status Cancelled or Cancellation Requested', verdict.status, {
      br: owBook.br,
      pnrs: owBook.pnrs,
      ...verdict,
      statusAfterCancel: owCancel.statusAfterCancel,
      cancellationRequest: owCancel.cancellationRequest,
    }));
  } else {
    rows.push(scoreRow('OW.CANCEL', 'v2 PENALTY + CANCEL', 'NOT TESTED', {
      note: `book ${owBook.classified || owBook.error}`,
      br: owBook.br,
    }));
  }
  report.cases.ow = { ...owPack, cancel: owCancel };

  // ─── RT ───────────────────────────────────────────────
  console.log('\n========== RT BOOK + CANCEL ==========');
  const rtPack = await bookWithInprogressRetry('RT', (args) => bookRtAttempt(flight, client, args), [
    { onwardDays: 35, returnDays: 42 },
    { onwardDays: 42, returnDays: 49 },
  ]);

  if (rtPack.aborted) {
    rows.push(scoreRow('RT.BOOK', 'issue-ticket ROUND_TRIP PNQ↔DXB', 'BUG', { note: 'INSUFFICIENT_BALANCE', br: rtPack.book.br }));
    rows.push(scoreRow('RT.CANCEL', 'v2 cancel after RT confirm', 'NOT TESTED', { note: 'aborted on INSUFFICIENT_BALANCE' }));
  } else {
    const rtBook = rtPack.book;
    rows.push(scoreRow(
      'RT.BOOK',
      'search→price→issue-ticket→poll Confirmed (Inprogress → 1 retry)',
      rtBook.classified === 'Confirmed' ? 'PASS'
        : rtBook.classified === 'Inprogress' ? 'NOT TESTED'
          : rtBook.classified === 'Failed' ? 'BUG' : 'BUG',
      {
        br: rtBook.br,
        status: rtBook.status,
        classified: rtBook.classified,
        pnrs: rtBook.pnrs,
        airlines: rtBook.airlines,
        mixedAirline: rtBook.mixedAirline,
        pricedTotal: rtBook.pricedTotal,
        attempts: rtPack.attempts.map((a) => ({ br: a.br, status: a.status, classified: a.classified, error: a.error })),
      },
    ));

    let rtCancel = null;
    if (rtBook.classified === 'Confirmed' && rtBook.br) {
      console.log('\nRT cancel flow on', rtBook.br, 'pnrs', rtBook.pnrs);
      rtCancel = await cancelFlow(flight, rtBook.br, rtBook.pnrs || []);
      const verdict = cancelVerdict('Confirmed', rtCancel);
      rows.push(scoreRow('RT.CANCEL', 'v2 PENALTY + CANCEL per PNR; Cancelled or Cancellation Requested', verdict.status, {
        br: rtBook.br,
        pnrs: rtBook.pnrs,
        ...verdict,
        statusAfterCancel: rtCancel.statusAfterCancel,
        cancellationRequest: rtCancel.cancellationRequest,
      }));
    } else {
      rows.push(scoreRow('RT.CANCEL', 'v2 PENALTY + CANCEL', 'NOT TESTED', {
        note: `book ${rtBook.classified || rtBook.error}`,
        br: rtBook.br,
      }));
    }
    report.cases.rt = { ...rtPack, cancel: rtCancel };
  }

  report.rows = rows;
  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  report.summary = counts;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `delta-ow-rt-book-cancel-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), JSON.stringify(report, null, 2));

  const md = [
    '# delta-api flight OW/RT book + cancel sanity',
    '',
    `- ranAt: ${report.ranAt}`,
    `- base: ${report.baseUrl}`,
    `- partner: ${report.partnerId} · tier ${report.tierId}`,
    `- summary: ${JSON.stringify(counts)}`,
    '',
    '| # | Rule | How tested | Status | Evidence |',
    '|---|------|------------|--------|----------|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.rule} | ${r.how} | **${r.status}** | ${r.br || r.note || r.classified || ''} |`),
    '',
    '## Booking references',
    '',
    `- OW: ${report.cases.ow?.book?.br || '—'} (${report.cases.ow?.book?.classified || report.cases.ow?.book?.error || '—'})`,
    `- RT: ${report.cases.rt?.book?.br || '—'} (${report.cases.rt?.book?.classified || report.cases.rt?.book?.error || '—'})`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'latest.md'), md);

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({ summary: counts, rows: rows.map((r) => ({ rule: r.rule, status: r.status, br: r.br, note: r.note })), report: outPath }, null, 2));

  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
