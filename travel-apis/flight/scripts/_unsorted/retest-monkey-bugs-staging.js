/**
 * One-shot retest of monkey-sheet bugs on api-staging (no loops).
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/retest-monkey-bugs-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { HotelService } from '../../../hotel/src/service.js';
import { FlightService } from '../../src/service.js';
import { config } from '../../../../shared/config/env.js';
import {
  buildSearchBody,
  extractRequestId,
} from '../../../hotel/src/helpers.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../../src/helpers.js';
import { futureDate } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/retest-monkey-bugs-staging.json';
const HILLTOP = '39627872';

function code(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}
function brief(res, n = 280) {
  try {
    return JSON.stringify(res?.data).slice(0, n);
  } catch {
    return String(res?.data);
  }
}

function expectReject(row, res, { allowBodyError200 = false } = {}) {
  const http = res?.status ?? 0;
  const c = code(res);
  const bodyErr = res?.data?.error?.code || res?.data?.code;
  // PB-HTML-CODE: HTTP 200 + INTERNAL_SERVER_ERROR in body is still BUG
  if (allowBodyError200 && http === 200 && bodyErr) {
    return {
      ...row,
      http,
      code: c || bodyErr,
      status: 'BUG',
      actual: `HTTP 200 with body error ${bodyErr}`,
      snippet: brief(res),
    };
  }
  if (http >= 500) {
    return { ...row, http, code: c, status: 'BUG', actual: `HTTP ${http}`, snippet: brief(res) };
  }
  if (http >= 400 && http < 500) {
    return {
      ...row,
      http,
      code: c,
      status: 'PASS',
      actual: `HTTP ${http} code=${c}`,
      snippet: brief(res),
    };
  }
  return {
    ...row,
    http,
    code: c,
    status: 'BUG',
    actual: `Accepted invalid input HTTP ${http}`,
    snippet: brief(res),
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const flight = new FlightService(client);
  const rows = [];

  console.log('Base:', config.baseUrl);

  // ── Flight 1: S-FUZZ-3 ──
  {
    const body = buildOneWaySearchBody(20, {
      origin: 'DEL',
      destination: 'BOM',
      fareType: 'GARBAGE',
    });
    const res = await flight.search(body);
    rows.push(expectReject({
      id: 'S-FUZZ-3',
      domain: 'Flight',
      api: 'POST /v1/flights/search',
      how: 'fareType=GARBAGE',
      expected: 'HTTP 400 VALIDATION_ERROR',
    }, res));
  }

  // Build flight pricing baseline for issue-ticket cases
  let priceId = null;
  let bookingContext = null;
  let searchId = null;
  {
    const body = buildOneWaySearchBody(22, { origin: 'DEL', destination: 'BOM', maxStops: 0 });
    let searchRes = await flight.search(body);
    for (let i = 0; i < 8 && !isSearchProgressComplete(searchRes.data); i++) {
      await new Promise((r) => setTimeout(r, 1500));
      searchRes = await flight.search(body);
    }
    searchId = extractFirstSearchId(searchRes.data) || searchRes.data?.options?.[0]?.searchId;
    if (searchId) {
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      priceId = pricing.data?.priceId || null;
      bookingContext = pricing.data?.bookingContext || null;
      console.log('Flight pricing', pricing.status, !!priceId, !!bookingContext);
    } else {
      console.log('No searchId for issue-ticket cases');
    }
  }

  // ── Flight 2–3: ISSUE priceId mutations ──
  if (priceId && bookingContext) {
    const baseIssue = buildIssueTicketPayload({
      priceId,
      bookingContext,
      searchIds: [searchId],
      journeyType: 'ONE_WAY',
      passengerProfile: {
        firstName: 'Rohan',
        lastName: `Bhagat${Date.now() % 10000}`,
        dob: config.flight.passengerDob,
        gender: 'Male',
        title: 'Mr',
      },
    });
    const mk = (id, mut, how) => {
      const p = JSON.parse(JSON.stringify(baseIssue));
      mut(p);
      return { id, how, payload: p };
    };
    const cases = [
      mk('ISSUE-NO-PRICEID', (p) => { p.data.priceId = `${priceId},`; }, `priceId trailing comma`),
      mk('ISSUE-HTML-PRICEID', (p) => { p.data.priceId = '<script>alert(1)</script>'; }, 'priceId=<script>…'),
    ];
    for (const c of cases) {
      const res = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: FLIGHT_QUERY,
        body: c.payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = res.data?.bookingRefId || res.data?.bookingReferenceId || null;
      const row = expectReject({
        id: c.id,
        domain: 'Flight',
        api: 'POST /api/v2/flights/booking/issue-ticket',
        how: c.how,
        expected: 'HTTP 400 VALIDATION_ERROR (no BR)',
      }, res);
      if (br) {
        row.status = 'BUG';
        row.actual = `HTTP ${res.status} created BR=${br}`;
      }
      rows.push(row);
    }
  } else {
    for (const id of ['ISSUE-NO-PRICEID', 'ISSUE-HTML-PRICEID']) {
      rows.push({
        id,
        domain: 'Flight',
        api: 'POST /api/v2/flights/booking/issue-ticket',
        how: 'needs priceId+bookingContext',
        expected: 'HTTP 400',
        status: 'NOT TESTED',
        actual: 'no pricing baseline',
        http: null,
        code: null,
      });
    }
  }

  // ── Hotel search/details/prebook/BR ──
  const checkin = futureDate(28);
  const checkout = futureDate(29);
  const searchBase = {
    entityId: HILLTOP,
    type: 'HOTEL',
    nationality: 'IN',
    checkin,
    checkout,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };

  {
    const body = { ...searchBase, entityId: '39627872<script>' };
    const res = await hotel.search(body);
    rows.push(expectReject({
      id: 'S-HTML-ENTITY',
      domain: 'Hotel',
      api: 'POST /v1/hotels/search',
      how: 'entityId=39627872<script>',
      expected: 'HTTP 400 VALIDATION_ERROR',
    }, res));
  }

  {
    const body = {
      ...searchBase,
      checkin: '2024-01-01',
      checkout: '2024-01-03',
    };
    const res = await hotel.getDetails(body);
    rows.push(expectReject({
      id: 'DET-PAST',
      domain: 'Hotel',
      api: 'POST /v1/hotels/details',
      how: 'checkin/checkout 2024-01-01/03',
      expected: 'HTTP 400 VALIDATION_ERROR (same as search)',
    }, res));
  }

  {
    const body = { ...searchBase, entityId: '<script>alert(1)</script>' };
    const res = await hotel.getDetails(body);
    rows.push(expectReject({
      id: 'DET-HTML',
      domain: 'Hotel',
      api: 'POST /v1/hotels/details',
      how: 'entityId=<script>alert(1)</script>',
      expected: 'HTTP 400 VALIDATION_ERROR',
    }, res));
  }

  // Need a real requestId for PB-COMMA; for PB-HTML use dummy requestId
  let realRequestId = null;
  {
    const ok = await hotel.search(searchBase);
    const det = await hotel.getDetails(searchBase);
    realRequestId = extractRequestId(det.data);
    console.log('Hotel requestId', realRequestId, 'search', ok.status, 'details', det.status);
  }

  {
    const res = await hotel.prebook({
      bookingCode: '<script>alert(1)</script>',
      requestId: realRequestId || '00000000-0000-0000-0000-000000000001',
    });
    rows.push(expectReject({
      id: 'PB-HTML-CODE',
      domain: 'Hotel',
      api: 'POST /v1/hotels/prebook',
      how: 'bookingCode=<script>…',
      expected: 'HTTP 4xx VALIDATION_ERROR (not HTTP 200 + INTERNAL_SERVER_ERROR)',
    }, res, { allowBodyError200: true }));
  }

  {
    const res = await hotel.prebook({
      bookingCode: 'dummy-encrypted-code-not-real',
      requestId: realRequestId ? `${realRequestId},` : 'd30d4682-1111-2222-3333-444444444289,',
    });
    rows.push(expectReject({
      id: 'PB-COMMA-REQ',
      domain: 'Hotel',
      api: 'POST /v1/hotels/prebook',
      how: 'requestId with trailing comma',
      expected: 'HTTP 400 VALIDATION_ERROR',
    }, res));
  }

  const fakeBr = 'BR0000000000000001';
  {
    const res = await hotel.getBookingStatus(fakeBr);
    rows.push(expectReject({
      id: 'BR-STATUS',
      domain: 'Hotel',
      api: `GET /v1/hotels/bookings/${fakeBr}/status`,
      how: 'fake BR',
      expected: 'HTTP 404 BOOKING_NOT_FOUND',
    }, res));
  }
  {
    const res = await hotel.getBookingDetail(fakeBr);
    rows.push(expectReject({
      id: 'BR-DETAIL',
      domain: 'Hotel',
      api: `GET /v1/hotels/bookings/${fakeBr}`,
      how: 'fake BR',
      expected: 'HTTP 404 BOOKING_NOT_FOUND',
    }, res));
  }
  {
    const res = await client.request({
      method: 'GET',
      path: '/v1/hotels/bookings/<script>/status',
      correlation: true,
      partnerKey: client.partnerKey,
    });
    rows.push(expectReject({
      id: 'BR-HTML',
      domain: 'Hotel',
      api: 'GET /v1/hotels/bookings/<script>/status',
      how: 'HTML BR path',
      expected: 'HTTP 400 or 404',
    }, res));
  }
  {
    const res = await client.request({
      method: 'GET',
      path: '/v1/hotels/bookings/BR123,/status',
      correlation: true,
      partnerKey: client.partnerKey,
    });
    rows.push(expectReject({
      id: 'BR-COMMA',
      domain: 'Hotel',
      api: 'GET /v1/hotels/bookings/BR123,/status',
      how: 'BR with trailing comma',
      expected: 'HTTP 400 or 404',
    }, res));
  }

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== RETEST MONKEY BUGS (api-staging) ===');
  console.log('Score:', summary);
  for (const r of rows) {
    console.log(`[${r.status}] ${r.id} | ${r.api} | ${r.actual}`);
  }
  console.log('Report:', OUT);
  process.exitCode = summary.BUG > 0 || summary['NOT TESTED'] > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
