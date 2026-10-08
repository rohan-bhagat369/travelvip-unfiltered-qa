/**
 * Re-verify Cab API issues from Partner API Testing - Cab API Testing issues.csv
 * Run: node scripts/verify-cab-issues-sheet.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildRentalSearchBody,
  buildOutstationSearchBody,
  buildFinalizeBody,
  pickCab,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

function summarize(data) {
  if (!data) return null;
  return {
    code: data.code || data.error?.code || data.statusCode,
    message: data.message || data.error?.message || data.detail || data.title,
    status: data.status,
    bookingRefId: data.bookingRefId || data.bookingReferenceId,
    fareId: data.fareId,
    cabCount: Array.isArray(data.cabs) ? data.cabs.length : undefined,
  };
}

async function main() {
  const { client } = await authenticate(true);
  const cab = new CabService(client);
  const results = [];

  const record = (id, title, expected, actual, status, extra = {}) => {
    results.push({ id, title, expected, actual, status, ...extra });
  };

  console.log('Base URL:', config.baseUrl);
  console.log('=== CAB ISSUE RE-VERIFICATION ===\n');

  // --- Issue 1: INVALID_SIGNATURE on invalid search inputs ---
  const invalidSearchCases = [
    { label: 'missing journeyType', body: (() => { const b = buildAirportSearchBody(); delete b.journeyType; return b; })() },
    { label: 'invalid journeyType', body: { ...buildAirportSearchBody(), journeyType: 'INVALID' } },
    { label: 'missing pickup', body: (() => { const b = buildAirportSearchBody(); delete b.pickup; return b; })() },
    { label: 'malformed pickupDatetime', body: { ...buildAirportSearchBody(), pickupDatetime: 'not-a-date' } },
    { label: 'empty body', body: {} },
  ];

  const sigErrors = [];
  const sigCaseDetails = [];
  for (const c of invalidSearchCases) {
    const res = await cab.search(c.body);
    const code = res.data?.code || res.data?.error?.code;
    if (code === 'INVALID_SIGNATURE') sigErrors.push(c.label);
    sigCaseDetails.push({ case: c.label, http: res.status, code, ...summarize(res.data) });
  }
  record(
    1,
    'Invalid search returns INVALID_SIGNATURE instead of validation error',
    'HTTP 400 with field-specific validation errors',
    `${sigErrors.length}/${invalidSearchCases.length} invalid cases returned INVALID_SIGNATURE: ${sigErrors.join(', ') || 'none'}`,
    sigErrors.length === invalidSearchCases.length ? 'Not Fixed' : sigErrors.length > 0 ? 'Partially Fixed' : 'Fixed',
    { cases: sigCaseDetails },
  );

  // --- Issue 2: Invalid city/place returns success ---
  {
    const body = buildRentalSearchBody();
    body.pickup = { name: 'InvalidCityXYZ123', city: 'NowhereLand', latitude: 28.5201, longitude: 77.1591 };
    body.drop = { name: 'FakePlaceABC999', city: 'InvalidCity', latitude: 28.5588, longitude: 77.0814 };
    const res = await cab.search(body);
    const hasCabs = Array.isArray(res.data?.cabs) && res.data.cabs.length > 0;
    record(
      2,
      'Invalid city/place name returns successful response with cabs',
      'HTTP 400 or empty results with clear validation error',
      `HTTP ${res.status} ok=${res.ok} cabs=${res.data?.cabs?.length ?? 0}`,
      hasCabs ? 'Not Fixed' : res.ok && !hasCabs ? 'Partially Fixed' : 'Fixed',
      { body: summarize(res.data) },
    );
  }

  // --- Issue 3: Invalid airport code returns 500 ---
  {
    const body = { ...buildAirportSearchBody(), airportCode: 'XXX' };
    const res = await cab.search(body);
    record(
      3,
      'Invalid airport code returns 500 instead of clear error',
      'HTTP 400 with message like invalid airport code',
      `HTTP ${res.status} ok=${res.ok} code=${res.data?.code || res.data?.error?.code || 'n/a'} message=${res.data?.message || res.data?.error?.message || 'n/a'}`,
      res.status === 500 ? 'Not Fixed' : res.status >= 400 && res.status < 500 ? 'Fixed' : 'Needs Review',
      { body: summarize(res.data) },
    );
  }

  // --- Happy path for downstream tests ---
  const goodSearch = await cab.search(buildAirportSearchBody());
  const selected = pickCab(goodSearch.data?.cabs);
  const apiBlocked = !goodSearch.ok || goodSearch.status === 404;
  if (apiBlocked) {
    record(
      'BLOCKER',
      'Cab API unavailable — cannot run E2E or book probes',
      'HTTP 200 with cab search results',
      `HTTP ${goodSearch.status} ${JSON.stringify(summarize(goodSearch.data))}`,
      'Blocked',
    );
  }
  if (!selected?.searchId) {
    console.warn('WARNING: No cab from airport search — continuing validation-only probes');
  }

  // --- Issue 10 / DATA: fareId Unknown ---
  if (selected) {
    {
      const unknown = (goodSearch.data?.cabs || []).filter((c) => c.fareId === 'Unknown');
      const total = goodSearch.data?.cabs?.length || 0;
      record(
        10,
        'fareId "Unknown" in search response',
        'Real fareId or null/omit — not string "Unknown"',
        `${unknown.length}/${total} cabs have fareId=Unknown`,
        unknown.length > 0 ? 'Open (Provider/Data)' : 'Fixed',
        {
          operators: unknown.map((c) => c.operator?.name),
          sample: unknown[0] ? { searchId: unknown[0].searchId, operator: unknown[0].operator?.name } : null,
        },
      );
    }
  } else {
    record(10, 'fareId "Unknown" in search response', 'Real fareId or null/omit', 'Not testable — search blocked', 'Blocked');
  }

  const goodFare = selected ? await cab.fare(selected.searchId) : { ok: false, data: null };
  const bookingReference = goodFare.data?.bookingReference;
  const priceId = goodFare.data?.priceId;

  if (!bookingReference || !priceId) {
    if (!apiBlocked) {
      record('SETUP', 'Could not obtain fare tokens', 'bookingReference + priceId', summarize(goodFare.data), 'Blocked');
    }
    for (const id of [4, 5, 6, 7, 8, 9]) {
      record(id, `Issue #${id} (book/status probes)`, 'Requires live fare/book API', 'Blocked — no fare tokens', 'Blocked');
    }
  } else {
    // --- Issue 4: Invalid priceId creates booking ---
    {
      const payload = buildFinalizeBody({ bookingReference, priceId: 'invalid-price-id-xyz' });
      const res = await cab.finalizeBooking(payload);
      const created = res.ok && res.data?.bookingRefId;
      record(
        4,
        'Invalid priceId still creates booking (200 + Pending + new BR)',
        'HTTP 400 — priceId invalid or expired',
        `HTTP ${res.status} ok=${res.ok} bookingRefId=${res.data?.bookingRefId || 'none'} status=${res.data?.status || 'n/a'}`,
        created ? 'Not Fixed' : 'Fixed',
        { body: summarize(res.data) },
      );
      if (created) await cab.cancelBooking(res.data.bookingRefId).catch(() => {});
    }

    // --- Issue 5: Same fare tokens reused ---
    {
      const book1 = await cab.finalizeBooking(buildFinalizeBody({ bookingReference, priceId }));
      const br1 = book1.data?.bookingRefId;
      const book2 = await cab.finalizeBooking(buildFinalizeBody({ bookingReference, priceId }));
      const br2 = book2.data?.bookingRefId;
      const doubleBook = book1.ok && book2.ok && br1 && br2;
      record(
        5,
        'Same fare tokens reused → multiple bookings',
        'HTTP 400 — fare already used or expired',
        `book1: ${book1.status} br=${br1 || 'none'} | book2: ${book2.status} br=${br2 || 'none'}`,
        doubleBook ? 'Not Fixed' : book2.ok ? 'Needs Review' : 'Fixed',
        { book1: summarize(book1.data), book2: summarize(book2.data) },
      );
      if (br1) await cab.cancelBooking(br1).catch(() => {});
      if (br2 && br2 !== br1) await cab.cancelBooking(br2).catch(() => {});
    }

    // --- Issue 6: Digits in firstName (sheet says fixed) ---
    {
      const freshFare = await cab.fare(selected.searchId);
      const payload = buildFinalizeBody({
        bookingReference: freshFare.data.bookingReference,
        priceId: freshFare.data.priceId,
      });
      payload.passengers[0].profile.firstName = 'Test123';
      const res = await cab.finalizeBooking(payload);
      const created = res.ok && res.data?.bookingRefId;
      record(
        6,
        'Digits in firstName (Test123) accepted',
        'HTTP 400 — firstName alphabetic only',
        `HTTP ${res.status} ok=${res.ok} bookingRefId=${res.data?.bookingRefId || 'none'}`,
        created ? 'Not Fixed' : 'Fixed',
        { body: summarize(res.data) },
      );
      if (created) await cab.cancelBooking(res.data.bookingRefId).catch(() => {});
    }

    // --- Issue 7: Mobile "123" (sheet says fixed) ---
    {
      const freshFare = await cab.fare(selected.searchId);
      const payload = buildFinalizeBody({
        bookingReference: freshFare.data.bookingReference,
        priceId: freshFare.data.priceId,
      });
      payload.contact.mobile = '123';
      const res = await cab.finalizeBooking(payload);
      const created = res.ok && res.data?.bookingRefId;
      record(
        7,
        'Mobile "123" accepted',
        'HTTP 400 — invalid mobile format',
        `HTTP ${res.status} ok=${res.ok} bookingRefId=${res.data?.bookingRefId || 'none'}`,
        created ? 'Not Fixed' : 'Fixed',
        { body: summarize(res.data) },
      );
      if (created) await cab.cancelBooking(res.data.bookingRefId).catch(() => {});
    }

    // --- Issue 8: Invalid paxType XYZ (sheet says fixed) ---
    {
      const freshFare = await cab.fare(selected.searchId);
      const payload = buildFinalizeBody({
        bookingReference: freshFare.data.bookingReference,
        priceId: freshFare.data.priceId,
      });
      payload.passengers[0].paxType = 'XYZ';
      const res = await cab.finalizeBooking(payload);
      const created = res.ok && res.data?.bookingRefId;
      record(
        8,
        'Invalid paxType (XYZ) accepted',
        'HTTP 400 — invalid paxType',
        `HTTP ${res.status} ok=${res.ok} bookingRefId=${res.data?.bookingRefId || 'none'}`,
        created ? 'Not Fixed' : 'Fixed',
        { body: summarize(res.data) },
      );
      if (created) await cab.cancelBooking(res.data.bookingRefId).catch(() => {});
    }

    // --- Issue 9: Field naming bookingRefId vs bookingReferenceId ---
    {
      const freshFare = await cab.fare(selected.searchId);
      const book = await cab.finalizeBooking(buildFinalizeBody({
        bookingReference: freshFare.data.bookingReference,
        priceId: freshFare.data.priceId,
      }));
      const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
      const status = br ? await cab.getBookingStatus(br) : null;
      const bookFields = book.data ? Object.keys(book.data).filter((k) => /book/i.test(k)) : [];
      const statusFields = status?.data ? Object.keys(status.data).filter((k) => /book/i.test(k)) : [];
      record(
        9,
        'Field naming: book returns bookingRefId, status uses bookingReferenceId',
        'Consistent field name across book and status',
        `book fields: [${bookFields.join(', ')}] br=${book.data?.bookingRefId || book.data?.bookingReferenceId} | status fields: [${statusFields.join(', ')}] ref=${status?.data?.bookingReferenceId || status?.data?.bookingRefId}`,
        book.data?.bookingRefId && status?.data?.bookingReferenceId && !status?.data?.bookingRefId
          ? 'Not Fixed'
          : 'Fixed',
        { bookStatus: book.data?.status, bookingStatus: status?.data?.status },
      );
      if (br) await cab.cancelBooking(br).catch(() => {});
    }
  }

  // --- E2E flows ---
  const e2eResults = [];
  if (apiBlocked) {
    for (const journeyType of ['AIRPORT', 'RENTAL', 'OUTSTATION']) {
      e2eResults.push({ journeyType, pass: false, error: `Cab API blocked HTTP ${goodSearch.status}` });
    }
  } else {
    for (const journeyType of ['AIRPORT', 'RENTAL', 'OUTSTATION']) {
    try {
      const flow = await cab.runBookingFlow(journeyType, { statusPollMs: 3000, statusAttempts: 20 });
      const steps = {
        search: flow.searchResponse.ok,
        fare: flow.fareResponse.ok,
        book: flow.finalizeResponse.ok,
        status: flow.statusResponse?.ok,
        cancel: flow.cancelResponse?.ok,
      };
      e2eResults.push({
        journeyType,
        pass: Object.values(steps).every(Boolean),
        bookingRefId: flow.bookingRefId,
        bookingStatus: flow.bookingStatus,
        steps,
        operator: flow.selectedCab?.operator?.name,
        fareId: flow.selectedCab?.fareId,
      });
    } catch (e) {
      e2eResults.push({ journeyType, pass: false, error: e.message });
    }
    }
  }

  // --- Doubts answered from testing ---
  const doubts = [];
  {
    const pastBody = { ...buildAirportSearchBody(), pickupDatetime: '2020-01-01T10:00:00Z' };
    const pastRes = await cab.search(pastBody);
    doubts.push({
      q: 'Is past pickup time allowed?',
      answer: `HTTP ${pastRes.status} ok=${pastRes.ok} cabs=${pastRes.data?.cabs?.length ?? 0} code=${pastRes.data?.code || 'n/a'}`,
    });
  }
  {
    const garbageStatus = await cab.getBookingStatus('BR_NOT_REAL_000');
    doubts.push({
      q: 'Bad bookingRefId on status',
      answer: `HTTP ${garbageStatus.status} ok=${garbageStatus.ok} code=${garbageStatus.data?.code || garbageStatus.data?.error?.code || 'n/a'}`,
    });
  }

  // --- Output ---
  console.log('\n=== ISSUE STATUS (from sheet) ===\n');
  for (const r of results) {
    console.log(`[${r.status}] #${r.id} — ${r.title}`);
    console.log(`  Expected: ${r.expected}`);
    console.log(`  Actual:   ${r.actual}`);
    if (r.operators) console.log(`  Operators with Unknown fareId: ${r.operators.join(', ')}`);
    console.log('');
  }

  console.log('\n=== E2E RESULTS ===\n');
  for (const e of e2eResults) {
    console.log(`${e.journeyType}: ${e.pass ? 'PASS' : 'FAIL'}`);
    console.log(`  BR: ${e.bookingRefId || 'n/a'} status: ${e.bookingStatus || e.error || 'n/a'}`);
    if (e.steps) console.log(`  steps: ${JSON.stringify(e.steps)}`);
    console.log('');
  }

  console.log('\n=== DOUBTS (observed) ===\n');
  doubts.forEach((d) => console.log(`Q: ${d.q}\nA: ${d.answer}\n`));

  const summary = {
    baseUrl: config.baseUrl,
    testedAt: new Date().toISOString(),
    issues: results,
    e2e: e2eResults,
    doubts,
  };

  console.log('\n=== JSON SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const notFixed = results.filter((r) => r.status === 'Not Fixed').length;
  const e2ePass = e2eResults.filter((e) => e.pass).length;
  process.exit(notFixed > 0 || e2ePass < 3 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
