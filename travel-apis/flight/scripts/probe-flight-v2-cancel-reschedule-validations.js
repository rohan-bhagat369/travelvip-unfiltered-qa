/**
 * Flight v2 cancel + issue-ticket reschedule validation matrix vs docs.
 * Run: node scripts/probe-flight-v2-cancel-reschedule-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { FLIGHT_QUERY } from '../src/helpers.js';

const OUT = path.join('reports', 'flight-v2-cancel-reschedule-validations-staging.json');

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(data, n = 450) {
  try { return JSON.stringify(data).slice(0, n); } catch { return String(data).slice(0, n); }
}
function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}
function hasEnvelope(res) {
  return Boolean(res?.data?.error?.code);
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const rows = [];

  const add = (area, code, expectedHttp, status, note, evidence = {}) => {
    const row = { area, code, expectedHttp, status, note, ...evidence, at: new Date().toISOString() };
    rows.push(row);
    console.log(`[${status}] ${area} | ${code} — ${note}`);
    if (evidence.snippet) console.log(' ', String(evidence.snippet).slice(0, 280));
  };

  // Discover v2 cancel path
  const pathCandidates = [
    '/api/v2/flight/cancel',
    '/api/v2/flights/cancel',
    '/api/v2/flights/booking/cancel',
    '/v2/flights/booking/cancel',
    '/v1/flights/booking/cancel',
  ];
  let cancelPath = null;
  for (const p of pathCandidates) {
    const res = await client.request({
      method: 'POST',
      path: p,
      query: FLIGHT_QUERY,
      body: {},
      correlation: true,
      partnerKey: client.partnerKey,
    });
    console.log('path probe', p, res.status, errCode(res) || brief(res.data, 80));
    // Prefer path that returns VALIDATION_ERROR bookingId rather than 404 page
    if (res.status !== 404 || errCode(res) === 'BOOKING_NOT_FOUND' || errCode(res) === 'VALIDATION_ERROR') {
      if (res.data?.info !== 'Page not found' && res.data?.status !== 404 || errCode(res)) {
        if (errCode(res) === 'VALIDATION_ERROR' || errCode(res) === 'BOOKING_NOT_FOUND' || hasEnvelope(res)) {
          cancelPath = p;
          break;
        }
      }
      if (errCode(res) === 'VALIDATION_ERROR') {
        cancelPath = p;
        break;
      }
    }
    // body status 400 with message also counts for legacy
    if (res.status === 400 || res.data?.error?.code === 'VALIDATION_ERROR') {
      cancelPath = p;
      break;
    }
  }
  // fallback: pick first non page-not-found
  if (!cancelPath) {
    for (const p of pathCandidates) {
      const res = await client.request({
        method: 'POST', path: p, query: FLIGHT_QUERY, body: { bookingId: 'x' },
        correlation: true, partnerKey: client.partnerKey,
      });
      if (res.data?.info !== 'Page not found') {
        cancelPath = p;
        break;
      }
    }
  }
  add('Setup', 'CANCEL_PATH', null, cancelPath ? 'PASS' : 'FAIL',
    cancelPath ? `Using ${cancelPath}` : 'No v2 cancel path found',
    { cancelPath });

  const cancelV2 = (body) => client.request({
    method: 'POST',
    path: cancelPath || '/api/v2/flight/cancel',
    query: FLIGHT_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // Also keep v1 path-with-BR for comparison
  const cancelV1 = (br, body) => client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: FLIGHT_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  // Pull flight history for real BRs (confirmed + cancelled)
  const bookings = [];
  for (const status of ['Confirmed', 'Cancelled', '']) {
    const hist = await client.request({
      method: 'GET',
      path: '/v1/flights/bookings/history',
      query: { ...FLIGHT_QUERY, page: 1, perpage: 20, ...(status ? { status } : {}) },
      correlation: true,
    });
    const list = hist.data?.bookings || hist.data?.content || [];
    if (Array.isArray(list)) bookings.push(...list);
  }
  console.log('flight history count', bookings.length);

  const pick = (pred) => bookings.find(pred);
  const confirmed = pick((b) => /confirm/i.test(String(b.status || '')));
  const cancelled = pick((b) => /cancel/i.test(String(b.status || '')));

  // Extract PNR helpers from booking detail
  async function getPnrs(br) {
    const det = await flight.getBookingDetail(br);
    const data = det.data || {};
    const pnrs = new Set();
    const push = (v) => { if (v && typeof v === 'string' && v.trim()) pnrs.add(v.trim()); };
    push(data.pnr);
    push(data.onwardPnr);
    push(data.returnPnr);
    push(data.bookingResponse?.pnr);
    const journeys = data.bookingResponse?.itinerary || data.itinerary || [];
    for (const j of journeys) {
      push(j.pnr);
      push(j.onwardPnr);
      for (const s of j.segments || []) push(s.pnr);
    }
    for (const m of data.pnrMappings || data.bookingResponse?.pnrMappings || []) {
      push(m.airlinePnr);
      push(m.pnr);
    }
    // nested scan
    const raw = JSON.stringify(data);
    const m = raw.match(/"pnr"\s*:\s*"([A-Z0-9]{5,8})"/gi) || [];
    for (const x of m) {
      const mm = x.match(/"([A-Z0-9]{5,8})"/i);
      if (mm) push(mm[1]);
    }
    return { detail: det, pnrs: [...pnrs] };
  }

  const confirmedBr = confirmed?.bookingId || confirmed?.bookingReferenceId || null;
  const cancelledBr = cancelled?.bookingId || cancelled?.bookingReferenceId || null;
  console.log('confirmedBr', confirmedBr, 'cancelledBr', cancelledBr);

  let confirmedPnr = null;
  if (confirmedBr) {
    const { pnrs } = await getPnrs(confirmedBr);
    confirmedPnr = pnrs[0] || null;
    console.log('confirmed PNRs', pnrs);
  }

  // ========== CANCEL V2 ==========
  console.log('\n=== CANCEL V2 ===');

  // VALIDATION_ERROR bookingId
  {
    const res = await cancelV2({});
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
      && /bookingId/i.test(JSON.stringify(res.data));
    add('Cancel', 'VALIDATION_ERROR (bookingId)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'missing bookingId OK' : 'mismatch',
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data), path: cancelPath });
  }

  // VALIDATION_ERROR action
  {
    const res = await cancelV2({ bookingId: confirmedBr || 'BR0000000000000001' });
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
      && /action/i.test(JSON.stringify(res.data));
    add('Cancel', 'VALIDATION_ERROR (action)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'missing/invalid action OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }
  {
    const res = await cancelV2({ bookingId: confirmedBr || 'BR0000000000000001', action: 'DELETE' });
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
    add('Cancel', 'VALIDATION_ERROR (action invalid)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'invalid action OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // BOOKING_NOT_FOUND
  {
    const fake = `BR9${Date.now().toString().slice(-15)}`;
    const res = await cancelV2({ bookingId: fake, action: 'CANCEL', pnr: 'ABCDEF' });
    const pass = res.status === 404 && errCode(res) === 'BOOKING_NOT_FOUND';
    add('Cancel', 'BOOKING_NOT_FOUND', 404, pass ? 'PASS' : 'FAIL',
      pass ? 'unknown BR OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  add('Cancel', 'BOOKING_PARTNER_MISMATCH', 403, 'NOT_TESTED',
    'Need other-partner flight BR + working partner auth (prior hotel other-BR returned NOT_FOUND)');

  // FLIGHT_BOOKING_ITEM_NOT_FOUND — use hotel BR
  {
    const hotelBr = 'BR1786026302970325'; // known hotel from earlier
    const res = await cancelV2({ bookingId: hotelBr, action: 'CANCEL', pnr: 'ABCDEF' });
    const pass = res.status === 400 && errCode(res) === 'FLIGHT_BOOKING_ITEM_NOT_FOUND';
    add('Cancel', 'FLIGHT_BOOKING_ITEM_NOT_FOUND (not a flight)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'hotel BR on flight cancel OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), hotelBr, snippet: brief(res.data) });
  }

  add('Cancel', 'FLIGHT_BOOKING_ITEM_NOT_FOUND (row missing 404)', 404, 'NOT_TESTED',
    'Needs DB seed: flight booking missing BookingItemFlight row');

  // PNR validations — need a real booking
  if (confirmedBr) {
    // missing pnr
    {
      const res = await cancelV2({ bookingId: confirmedBr, action: 'CANCEL' });
      const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
        && /pnr/i.test(JSON.stringify(res.data));
      add('Cancel', 'VALIDATION_ERROR (pnr missing)', 400, pass ? 'PASS' : 'FAIL',
        pass ? 'pnr required OK' : `got ${res.status} ${errCode(res)} — may still auto-fill`,
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data), confirmedBr });
    }
    // pnr not string
    {
      const res = await cancelV2({ bookingId: confirmedBr, action: 'CANCEL', pnr: 12345 });
      const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
        && /string/i.test(JSON.stringify(res.data));
      add('Cancel', 'VALIDATION_ERROR (pnr not a string)', 400, pass ? 'PASS' : 'FAIL',
        pass ? 'pnr type OK' : `got ${res.status} ${errCode(res)}`,
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
    }
    // pnr blank
    {
      const res = await cancelV2({ bookingId: confirmedBr, action: 'CANCEL', pnr: '   ' });
      const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
        && /non-empty|pnr/i.test(JSON.stringify(res.data));
      add('Cancel', 'VALIDATION_ERROR (pnr blank)', 400, pass ? 'PASS' : 'FAIL',
        pass ? 'blank pnr OK' : `got ${res.status} ${errCode(res)}`,
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
    }
    // PNR_INVALID
    {
      const res = await cancelV2({ bookingId: confirmedBr, action: 'CANCEL', pnr: 'ZZZZZZ' });
      const pass = res.status === 422 && errCode(res) === 'PNR_INVALID';
      add('Cancel', 'PNR_INVALID', 422, pass ? 'PASS' : 'FAIL',
        pass ? 'wrong pnr OK' : `got ${res.status} ${errCode(res)}`,
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
    }
    // cancelledBy invalid
    {
      const res = await cancelV2({
        bookingId: confirmedBr,
        action: 'CANCEL',
        pnr: confirmedPnr || 'ZZZZZZ',
        cancelledBy: 'HACKER',
      });
      const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
        && /cancelledBy/i.test(JSON.stringify(res.data));
      add('Cancel', 'VALIDATION_ERROR (cancelledBy)', 400, pass ? 'PASS' : 'FAIL',
        pass ? 'cancelledBy OK' : `got ${res.status} ${errCode(res)}`,
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
    }
  } else {
    for (const c of [
      'VALIDATION_ERROR (pnr missing)',
      'VALIDATION_ERROR (pnr not a string)',
      'VALIDATION_ERROR (pnr blank)',
      'PNR_INVALID',
      'VALIDATION_ERROR (cancelledBy)',
    ]) {
      add('Cancel', c, 400, 'NOT_TESTED', 'No confirmed flight BR in history');
    }
  }

  // BOOKING_ALREADY_CANCELLED
  if (cancelledBr) {
    const { pnrs } = await getPnrs(cancelledBr);
    const res = await cancelV2({
      bookingId: cancelledBr,
      action: 'CANCEL',
      pnr: pnrs[0] || 'ZZZZZZ',
    });
    const pass = res.status === 409 && errCode(res) === 'BOOKING_ALREADY_CANCELLED';
    add('Cancel', 'BOOKING_ALREADY_CANCELLED', 409, pass ? 'PASS' : 'FAIL',
      pass ? 'already cancelled OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), cancelledBr, snippet: brief(res.data) });
  } else {
    add('Cancel', 'BOOKING_ALREADY_CANCELLED', 409, 'NOT_TESTED', 'No cancelled flight in history');
  }

  add('Cancel', 'PNR_ALREADY_CANCELLED', 409, 'NOT_TESTED',
    'Doc says unreachable until findBlockingByPnr includes COMPLETED');
  add('Cancel', 'CANCELLATION_ALREADY_IN_PROGRESS', 409, 'NOT_TESTED',
    'Needs PNR with PENDING airline cancellation');
  add('Cancel', 'FLIGHT_ALREADY_DEPARTED', 422, 'NOT_TESTED',
    'Needs confirmed booking whose departure is in the past');
  add('Cancel', 'PNR_NOT_FOUND', 422, 'NOT_TESTED',
    'Needs flight booking with no PNR at all');
  add('Cancel', 'PROVIDER_BOOKING_ID_NOT_FOUND', 400, 'NOT_TESTED',
    'Server-side data gap — needs seeded booking');
  add('Cancel', 'BOOKING_CONTEXT_NOT_FOUND', 400, 'NOT_TESTED',
    'Server-side data gap — needs seeded booking');

  // ========== RESCHEDULE issue-ticket ==========
  console.log('\n=== RESCHEDULE issue-ticket ===');

  // Build a minimal issue payload — for validation we only need the reschedule fields;
  // API may fail earlier on missing fare fields. Prefer cloning from a prior report if present.
  async function issueTicket(extra = {}) {
    // Minimal body: enough to reach reschedule validators when possible
    const body = {
      type: 'ticket',
      currency: 'INR',
      language: 'en',
      ...extra,
    };
    return client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: FLIGHT_QUERY,
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  // Also try v2 path from docs
  async function issueTicketV2(extra = {}) {
    const body = { type: 'ticket', currency: 'INR', language: 'en', ...extra };
    return client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: FLIGHT_QUERY,
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
  }

  // Probe v2 issue path
  {
    const res = await issueTicketV2({});
    add('Setup', 'ISSUE_PATH_V2', null,
      res.data?.info === 'Page not found' ? 'INFO' : 'PASS',
      `POST /api/v2/flights/booking/issue-ticket → HTTP ${res.status} ${errCode(res) || ''}`,
      { http: res.status, snippet: brief(res.data, 200) });
  }

  // Need a fuller issue body for pair validation — load from existing report if any
  let sampleIssueBody = null;
  const sampleFiles = [
    'reports/sg-reschedule-happy.json',
    'reports/repro-reschedulingPnr-alone.json',
    'reports/flight-reschedule-matrix-staging.json',
  ];
  for (const f of sampleFiles) {
    try {
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const body = j.issueBody || j.payload || j.lastIssueBody
        || j.cases?.find?.((c) => c.issueBody)?.issueBody
        || null;
      if (body && typeof body === 'object') {
        sampleIssueBody = body;
        console.log('loaded sample issue body from', f);
        break;
      }
    } catch { /* ignore */ }
  }

  // If no sample, try building via search (expensive) — skip to history-based partial tests
  const withSample = async (extra) => {
    if (sampleIssueBody) {
      const body = { ...sampleIssueBody, ...extra };
      // strip prior reschedule fields then apply
      delete body.reschedulingReferenceId;
      delete body.reschedulingPnr;
      Object.assign(body, extra);
      return client.request({
        method: 'POST',
        path: '/v1/flights/booking/issue-ticket',
        query: FLIGHT_QUERY,
        body,
        correlation: true,
        partnerKey: client.partnerKey,
      });
    }
    return issueTicket(extra);
  };

  // Pair incomplete — only reschedulingReferenceId
  {
    const res = await withSample({
      reschedulingReferenceId: confirmedBr || 'BR1785923766217865',
    });
    const details = res.data?.error?.details;
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
      && (Array.isArray(details)
        ? details.some((d) => /reschedulingPnr/i.test(String(d)))
        : /reschedulingPnr/i.test(JSON.stringify(res.data)));
    add('Reschedule', 'VALIDATION_ERROR (pair: missing PNR)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'ref without pnr OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // Pair incomplete — only reschedulingPnr
  {
    const res = await withSample({
      reschedulingPnr: confirmedPnr || 'ABCDEF',
    });
    const details = res.data?.error?.details;
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR'
      && (Array.isArray(details)
        ? details.some((d) => /reschedulingReferenceId/i.test(String(d)))
        : /reschedulingReferenceId/i.test(JSON.stringify(res.data)));
    add('Reschedule', 'VALIDATION_ERROR (pair: missing Ref)', 400, pass ? 'PASS' : 'FAIL',
      pass ? 'pnr without ref OK' : `got ${res.status} ${errCode(res)} — may still normal-book`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  // RESCHEDULING_BOOKING_NOT_FOUND
  {
    const fake = `BR8${Date.now().toString().slice(-15)}`;
    const res = await withSample({
      reschedulingReferenceId: fake,
      reschedulingPnr: 'ABCDEF',
    });
    const pass = res.status === 404 && errCode(res) === 'RESCHEDULING_BOOKING_NOT_FOUND';
    add('Reschedule', 'RESCHEDULING_BOOKING_NOT_FOUND', 404, pass ? 'PASS' : 'FAIL',
      pass ? 'unknown ref OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  add('Reschedule', 'RESCHEDULING_BOOKING_PARTNER_MISMATCH', 403, 'NOT_TESTED',
    'Need other-partner flight BR');

  // RESCHEDULING_NOT_ALLOWED — confirmed booking
  if (confirmedBr && confirmedPnr) {
    const res = await withSample({
      reschedulingReferenceId: confirmedBr,
      reschedulingPnr: confirmedPnr,
    });
    const pass = res.status === 422 && errCode(res) === 'RESCHEDULING_NOT_ALLOWED';
    add('Reschedule', 'RESCHEDULING_NOT_ALLOWED', 422, pass ? 'PASS' : 'FAIL',
      pass ? 'confirmed not eligible OK' : `got ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), confirmedBr, confirmedPnr, snippet: brief(res.data) });
  } else {
    add('Reschedule', 'RESCHEDULING_NOT_ALLOWED', 422, 'NOT_TESTED', 'No confirmed BR+PNR');
  }

  // RESCHEDULING_PNR_NOT_FOUND — valid cancelled BR with wrong pnr if available
  if (cancelledBr) {
    const res = await withSample({
      reschedulingReferenceId: cancelledBr,
      reschedulingPnr: 'ZZZZZZ',
    });
    const pass = [404, 422].includes(res.status)
      && /RESCHEDULING_PNR_NOT_FOUND|PNR_INVALID|RESCHEDULING_PNR_MISMATCH|RESCHEDULING_NOT_ALLOWED|RESCHEDULING_CANCELLATION_IN_PROGRESS|RESCHEDULING_FLIGHT_DEPARTED|RESCHEDULING_REFERENCE_ALREADY_USED/.test(String(errCode(res)));
    add('Reschedule', 'RESCHEDULING_PNR_NOT_FOUND (probe)', 404,
      errCode(res) === 'RESCHEDULING_PNR_NOT_FOUND' ? 'PASS'
        : (pass ? 'INFO' : 'FAIL'),
      `cancelled BR + fake PNR → ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), cancelledBr, snippet: brief(res.data) });
  }

  // Known SG happy path BR from prior runs
  const knownRescheduled = 'BR1786017179800507'; // was rescheduled to BR1786017237353711
  {
    const res = await withSample({
      reschedulingReferenceId: knownRescheduled,
      reschedulingPnr: 'B7SVXP',
    });
    if (errCode(res) === 'RESCHEDULING_REFERENCE_ALREADY_USED') {
      add('Reschedule', 'RESCHEDULING_REFERENCE_ALREADY_USED', 409, 'PASS',
        'known already-rescheduled SG BR OK',
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
    } else {
      add('Reschedule', 'RESCHEDULING_REFERENCE_ALREADY_USED', 409,
        errCode(res) ? 'INFO' : 'FAIL',
        `probe ${knownRescheduled} → ${res.status} ${errCode(res)}`,
        { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
    }
  }

  // PNR mismatch — use cancelled BR + PNR from another booking
  if (cancelledBr && confirmedPnr) {
    const res = await withSample({
      reschedulingReferenceId: cancelledBr,
      reschedulingPnr: confirmedPnr,
    });
    add('Reschedule', 'RESCHEDULING_PNR_MISMATCH', 422,
      errCode(res) === 'RESCHEDULING_PNR_MISMATCH' ? 'PASS' : 'INFO',
      `cancelled BR + other booking PNR → ${res.status} ${errCode(res)}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  } else {
    add('Reschedule', 'RESCHEDULING_PNR_MISMATCH', 422, 'NOT_TESTED', 'Need cancelled BR + foreign PNR');
  }

  add('Reschedule', 'RESCHEDULING_CANCELLATION_IN_PROGRESS', 409, 'NOT_TESTED',
    'Needs Cancellation Requested / pending airline cancel');
  add('Reschedule', 'RESCHEDULING_FLIGHT_DEPARTED', 422, 'NOT_TESTED',
    'Needs cancelled/eligible booking with past departure');

  // Compare v1 cancel missing pnr (known old bug)
  if (confirmedBr) {
    const res = await cancelV1(confirmedBr, { action: 'CANCEL' });
    add('Cancel-v1', 'VALIDATION_ERROR (pnr missing) on v1', 400,
      res.status === 400 && errCode(res) === 'VALIDATION_ERROR' ? 'PASS' : 'INFO',
      `v1 cancel without pnr → ${res.status} ${errCode(res) || 'ok?'}`,
      { http: res.status, actualCode: errCode(res), snippet: brief(res.data) });
  }

  const summary = {
    baseUrl: config.baseUrl,
    cancelPath,
    confirmedBr,
    confirmedPnr,
    cancelledBr,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      FAIL: rows.filter((r) => r.status === 'FAIL').length,
      NOT_TESTED: rows.filter((r) => r.status === 'NOT_TESTED').length,
      INFO: rows.filter((r) => r.status === 'INFO').length,
    },
    failed: rows.filter((r) => r.status === 'FAIL'),
    notTested: rows.filter((r) => r.status === 'NOT_TESTED').map((r) => r.code),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log('FAIL:', summary.failed.map((f) => `${f.code}: ${f.note}`));
  console.log('NOT_TESTED:', summary.notTested);
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});
