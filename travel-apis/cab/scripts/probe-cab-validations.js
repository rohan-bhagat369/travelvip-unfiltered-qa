/**
 * Probe Cab APIs for missing/weak validations. Prints a bug table for the API team.
 * Run: node scripts/probe-cab-validations.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
} from '../src/helpers.js';

function summarize(data) {
  if (data == null) return null;
  if (typeof data === 'string') return data.slice(0, 200);
  const pick = {
    status: data.status,
    statusCode: data.statusCode,
    code: data.code,
    error: data.error,
    message: data.message,
    title: data.title,
    detail: data.detail,
    errors: data.errors,
    bookingRefId: data.bookingRefId,
    fareId: data.fareId,
    cabCount: Array.isArray(data.cabs) ? data.cabs.length : undefined,
  };
  return Object.fromEntries(Object.entries(pick).filter(([, v]) => v !== undefined));
}

function expectRejected(label, response, notes = '') {
  const bug = response.ok;
  return {
    id: label,
    expected: '4xx / structured validation error',
    actual: `${response.status} ok=${response.ok}`,
    bug: bug ? 'YES — accepted invalid input' : 'no (rejected)',
    notes,
    body: summarize(response.data),
  };
}

function expectRejectedOrEmpty(label, response, notes = '') {
  const hasCabs = Array.isArray(response.data?.cabs) && response.data.cabs.length > 0;
  const bug = response.ok && hasCabs;
  return {
    id: label,
    expected: '4xx OR empty results (no fake availability)',
    actual: `${response.status} ok=${response.ok} cabs=${response.data?.cabs?.length ?? 'n/a'}`,
    bug: bug ? 'YES — returned cab options for invalid search' : 'no',
    notes,
    body: summarize(response.data),
  };
}

async function main() {
  const { client } = await authenticate();
  const cab = new CabService(client);
  const findings = [];

  // --- SEARCH ---
  {
    const body = buildAirportSearchBody();
    delete body.journeyType;
    findings.push(expectRejected('SEARCH-001 missing journeyType', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.journeyType = 'INVALID_TYPE';
    findings.push(expectRejected('SEARCH-002 invalid journeyType', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.airportCode = 'XXX';
    findings.push(expectRejectedOrEmpty('SEARCH-003 invalid airportCode XXX', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    delete body.airportCode;
    findings.push(expectRejectedOrEmpty('SEARCH-004 AIRPORT without airportCode', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.pickupDatetime = '2020-01-01T10:00:00Z';
    findings.push(expectRejected('SEARCH-005 past pickupDatetime', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.pickupDatetime = 'not-a-date';
    findings.push(expectRejected('SEARCH-006 malformed pickupDatetime', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.pickup = { name: 'Nowhere', city: 'X', latitude: 999, longitude: 999 };
    findings.push(expectRejectedOrEmpty('SEARCH-007 invalid lat/long 999', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    delete body.pickup;
    findings.push(expectRejected('SEARCH-008 missing pickup', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    delete body.drop;
    findings.push(expectRejected('SEARCH-009 missing drop', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.distanceKm = -5;
    findings.push(expectRejectedOrEmpty('SEARCH-010 negative distanceKm', await cab.search(body)));
  }
  {
    const body = buildAirportSearchBody();
    body.travelType = 'INVALID_TRAVEL';
    findings.push(expectRejected('SEARCH-011 invalid travelType', await cab.search(body)));
  }
  {
    findings.push(
      expectRejected(
        'SEARCH-012 empty body',
        await cab.search({}),
      ),
    );
  }

  // Happy path to get real tokens for fare/book probes
  const goodSearch = await cab.search(buildAirportSearchBody());
  const selected = pickCab(goodSearch.data?.cabs);
  if (!selected?.searchId) {
    console.error('Could not get a valid airport cab for downstream probes', goodSearch.status, goodSearch.data);
    process.exit(1);
  }

  const goodFare = await cab.fare(selected.searchId);
  const bookingReference = goodFare.data?.bookingReference;
  const priceId = goodFare.data?.priceId;

  // --- FARE ---
  findings.push(expectRejected('FARE-001 missing searchId', await cab.fare(undefined)));
  findings.push(expectRejected('FARE-002 empty searchId', await cab.fare('')));
  findings.push(expectRejected('FARE-003 garbage searchId', await cab.fare('not-a-real-search-id')));
  findings.push(
    expectRejected(
      'FARE-004 malformed UUID searchId',
      await cab.fare('00000000-0000-0000-0000-000000000000|deadbeef'),
    ),
  );

  // --- BOOK ---
  if (bookingReference && priceId) {
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.bookingReference = 'invalid-booking-ref';
      findings.push(expectRejected('BOOK-001 invalid bookingReference', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.priceId = 'invalid-price-id';
      findings.push(expectRejected('BOOK-002 invalid priceId', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      delete payload.passengers;
      findings.push(expectRejected('BOOK-003 missing passengers', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.passengers = [];
      findings.push(expectRejected('BOOK-004 empty passengers[]', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.passengers[0].profile.firstName = '';
      payload.passengers[0].profile.lastName = '';
      findings.push(expectRejected('BOOK-005 empty passenger names', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.passengers[0].profile.firstName = 'Test123';
      findings.push(expectRejected('BOOK-006 digits in firstName', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.contact.email = 'not-an-email';
      findings.push(expectRejected('BOOK-007 invalid email', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      payload.contact.mobile = '123';
      findings.push(expectRejected('BOOK-008 invalid mobile (too short)', await cab.finalizeBooking(payload)));
    }
    {
      const payload = buildFinalizeBody({ bookingReference, priceId });
      delete payload.contact;
      findings.push(expectRejected('BOOK-009 missing contact', await cab.finalizeBooking(payload)));
    }
    {
      findings.push(
        expectRejected(
          'BOOK-010 empty body',
          await cab.finalizeBooking({}),
        ),
      );
    }

    // Valid book once for status/cancel probes
    const book = await cab.finalizeBooking(buildFinalizeBody({ bookingReference, priceId }));
    const bookingRefId = book.data?.bookingRefId;

    // Reuse same fare tokens for double-book attempt
    {
      const again = await cab.finalizeBooking(buildFinalizeBody({ bookingReference, priceId }));
      findings.push({
        id: 'BOOK-011 reuse same fare tokens twice',
        expected: '4xx / fare already used / expired',
        actual: `${again.status} ok=${again.ok} bookingRefId=${again.data?.bookingRefId || 'n/a'}`,
        bug: again.ok
          ? 'YES — same fare tokens created another booking'
          : 'no (rejected reuse)',
        notes: 'Idempotency / fare consumption',
        body: summarize(again.data),
      });
      if (again.ok && again.data?.bookingRefId) {
        await cab.cancelBooking(again.data.bookingRefId).catch(() => {});
      }
    }

    // --- STATUS ---
    findings.push(
      expectRejected('STATUS-001 garbage bookingRefId', await cab.getBookingStatus('BR_NOT_REAL_000')),
    );
    findings.push(
      expectRejected('STATUS-002 empty-looking id', await cab.getBookingStatus('BR')),
    );
    if (bookingRefId) {
      const status = await cab.getBookingStatus(bookingRefId);
      findings.push({
        id: 'STATUS-003 valid booking status shape',
        expected: '200 with status + bookingReferenceId',
        actual: `${status.status} status=${status.data?.status} ref=${status.data?.bookingReferenceId || status.data?.bookingRefId}`,
        bug: status.ok ? 'no' : 'YES — status failed for fresh booking',
        notes: 'Observe field naming consistency bookingRefId vs bookingReferenceId',
        body: summarize(status.data),
      });
    }

    // --- CANCEL ---
    findings.push(
      expectRejected('CANCEL-001 garbage bookingRefId', await cab.cancelBooking('BR_NOT_REAL_000')),
    );
    if (bookingRefId) {
      const cancel1 = await cab.cancelBooking(bookingRefId);
      findings.push({
        id: 'CANCEL-002 cancel fresh booking',
        expected: '200 cancel success',
        actual: `${cancel1.status} ok=${cancel1.ok}`,
        bug: cancel1.ok ? 'no' : 'YES — could not cancel',
        body: summarize(cancel1.data),
      });

      const cancel2 = await cab.cancelBooking(bookingRefId);
      findings.push({
        id: 'CANCEL-003 cancel already-cancelled booking',
        expected: '4xx / already cancelled',
        actual: `${cancel2.status} ok=${cancel2.ok}`,
        bug: cancel2.ok ? 'YES — double cancel succeeds (or soft-ok without clear error)' : 'no (rejected)',
        notes: 'Should be idempotent OK with explicit already-cancelled OR 4xx',
        body: summarize(cancel2.data),
      });
    }
  } else {
    findings.push({
      id: 'SETUP-FARE',
      expected: 'valid fare for airport search',
      actual: `${goodFare.status}`,
      bug: 'YES — could not obtain fare for book probes',
      body: summarize(goodFare.data),
    });
  }

  // --- Auth / security light check ---
  {
    const unauth = await client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/search',
      query: { lang: 'en', currency: 'INR' },
      body: buildAirportSearchBody(),
      auth: false,
      signed: true,
      correlation: true,
    });
    findings.push({
      id: 'AUTH-001 search without Bearer',
      expected: '401 Unauthorized',
      actual: `${unauth.status} ok=${unauth.ok}`,
      bug: unauth.ok || unauth.status === 200 ? 'YES — unauthenticated search allowed' : 'no',
      body: summarize(unauth.data),
    });
  }

  // Observational: fareId "Unknown" in search results
  {
    const unknown = (goodSearch.data?.cabs || []).filter((c) => c.fareId === 'Unknown');
    findings.push({
      id: 'DATA-001 fareId \"Unknown\" in search',
      expected: 'fareId always a real id or null',
      actual: `${unknown.length}/${goodSearch.data?.cabs?.length || 0} cabs have fareId=Unknown`,
      bug: unknown.length > 0 ? 'YES — string \"Unknown\" instead of null/omit' : 'no',
      notes: 'Clients may break if they treat fareId as opaque required token',
      body: { sampleSearchId: unknown[0]?.searchId, operator: unknown[0]?.operator?.name },
    });
  }

  const bugs = findings.filter((f) => String(f.bug).startsWith('YES'));
  console.log('\n=== CAB API VALIDATION PROBE ===\n');
  console.log(`Probes: ${findings.length} | Likely bugs: ${bugs.length}\n`);

  for (const f of findings) {
    const mark = String(f.bug).startsWith('YES') ? 'BUG' : 'ok ';
    console.log(`[${mark}] ${f.id}`);
    console.log(`  expected: ${f.expected}`);
    console.log(`  actual:   ${f.actual}`);
    if (f.notes) console.log(`  notes:    ${f.notes}`);
    console.log(`  body:     ${JSON.stringify(f.body)}`);
    console.log('');
  }

  console.log('\n=== BUGS ONLY (share with API team) ===\n');
  bugs.forEach((f, i) => {
    console.log(`${i + 1}. ${f.id}: ${f.actual}`);
    console.log(`   Expected: ${f.expected}`);
    if (f.notes) console.log(`   Notes: ${f.notes}`);
    console.log(`   Response: ${JSON.stringify(f.body)}`);
    console.log('');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
