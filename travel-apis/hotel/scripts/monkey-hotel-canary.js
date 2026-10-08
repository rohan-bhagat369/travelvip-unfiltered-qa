/**
 * Hotel-only monkey testing (Canary), NO BOOKING.
 *
 * Covers:
 *  - /v1/hotels/autocomplete positive baseline
 *  - /v1/hotels/search negative fuzz
 *  - /v1/hotels/details negative fuzz
 *  - /v1/hotels/prebook negative fuzz
 *  - /v1/hotels/finalize-booking negative fuzz (no actual book)
 *  - /v1/hotels/bookings/{BR}/status with fake BR
 *  - /v1/hotels/bookings/{BR} with fake BR
 *  - /v1/hotels/bookings/{BR}/cancel with fake BR
 *  - /v1/hotels/bookings/{BR}/penalty-check with fake BR
 *
 * Output: reports/monkey-hotel-canary.json
 *
 * Run:
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/monkey-hotel-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import {
  HOTEL_QUERY,
  buildSearchBody,
  buildDetailsBody,
  extractRequestId,
  extractBookingCodes,
  extractBookingContext,
} from '../src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';

const OUT = path.join('reports', 'monkey-hotel-canary.json');

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}
function errDetails(res) {
  const d = res?.data?.error?.details || res?.data?.fieldErrors;
  if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  if (d == null) return [];
  return [String(d)];
}
function errMsg(res) {
  return String(res?.data?.error?.message || res?.data?.message || res?.data?.title || '').slice(0, 200);
}

function score(res) {
  const status = res?.status ?? 0;
  const code = errCode(res);
  if (status >= 500) return { verdict: 'BUG', actual: `HTTP ${status} (>=500, never expected)` };
  if (res?.ok || status === 200) return { verdict: 'BUG', actual: `Accepted invalid payload: HTTP ${status}` };
  if (status >= 400 && status < 500 && code) return { verdict: 'PASS', actual: `HTTP ${status} code=${code}` };
  if (status >= 400 && status < 500) return { verdict: 'PASS', actual: `HTTP ${status} (4xx, no error.code but not 500)` };
  return { verdict: 'NOT_TESTED', actual: `HTTP ${status} code=${code}` };
}

function scoreExpectNotFound(res) {
  const status = res?.status ?? 0;
  const code = errCode(res);
  if (status >= 500) return { verdict: 'BUG', actual: `HTTP ${status} (>=500)` };
  if (status >= 400 && status < 500) return { verdict: 'PASS', actual: `HTTP ${status} code=${code}` };
  if (res?.ok || status === 200) return { verdict: 'BUG', actual: `HTTP ${status} accepted fake BR` };
  return { verdict: 'NOT_TESTED', actual: `HTTP ${status} code=${code}` };
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  const hotel = new HotelService(session.client);

  const rows = [];
  const add = (row) => {
    rows.push(row);
    console.log(`[${row.verdict}] ${row.id} ${row.api} http=${row.http} code=${row.code}`);
  };

  // ── 1. Autocomplete baseline ──
  const acRes = await hotel.autocomplete('pune');
  add({
    id: 'AC-BASE', api: 'GET /v1/hotels/autocomplete',
    how: 'q=pune baseline', payload: { q: 'pune' },
    verdict: acRes?.ok ? 'PASS' : 'NOT_TESTED',
    actual: `HTTP ${acRes?.status} content=${Array.isArray(acRes?.data?.content) ? acRes.data.content.length : 0} items`,
    http: acRes?.status, code: errCode(acRes), details: errDetails(acRes),
  });

  // ── 2. Search baseline (Hilltop Mumbai) ──
  const searchBody = buildSearchBody({ entityId: '39627872', checkinDays: 28, nights: 2 });
  const searchRes = await hotel.search(searchBody);
  add({
    id: 'SEARCH-BASE', api: 'POST /v1/hotels/search',
    how: 'Hilltop Mumbai entityId=39627872 +28d/2n baseline', payload: searchBody,
    verdict: searchRes?.ok ? 'PASS' : 'NOT_TESTED',
    actual: `HTTP ${searchRes?.status} results=${searchRes?.data?.results?.length || 0}`,
    http: searchRes?.status, code: errCode(searchRes), details: errDetails(searchRes),
  });

  // ── 3. Search negatives ──
  const searchNeg = [
    { id: 'S-PAST-CHECKIN', mut: (b) => { b.checkin = '2024-01-01'; b.checkout = '2024-01-03'; }, how: 'checkin in the past' },
    { id: 'S-DDMMYYYY', mut: (b) => { b.checkin = '01-01-2027'; b.checkout = '03-01-2027'; }, how: 'dates DD-MM-YYYY format' },
    { id: 'S-SLASH', mut: (b) => { b.checkin = '2027/01/01'; b.checkout = '2027/01/03'; }, how: 'dates with slashes' },
    { id: 'S-CHECKOUT-BEFORE', mut: (b) => { b.checkout = searchBody.checkin; b.checkin = searchBody.checkout; }, how: 'checkout before checkin' },
    { id: 'S-ADULTS-0', mut: (b) => { b.rooms = [{ adults: 0, children: 0, childrenAges: [] }]; }, how: 'adults=0' },
    { id: 'S-ADULTS-STR', mut: (b) => { b.rooms = [{ adults: '1', children: 0, childrenAges: [] }]; }, how: 'adults as string "1"' },
    { id: 'S-ADULTS-7', mut: (b) => { b.rooms = [{ adults: 7, children: 0, childrenAges: [] }]; }, how: 'adults=7 (exceeds max)' },
    { id: 'S-NO-ENTITY', mut: (b) => { delete b.entityId; }, how: 'missing entityId' },
    { id: 'S-NO-TYPE', mut: (b) => { delete b.type; }, how: 'missing type' },
    { id: 'S-NAT-BAD', mut: (b) => { b.nationality = 'INDIA'; }, how: 'nationality not 2-letter' },
    { id: 'S-ROOMS-7', mut: (b) => { b.rooms = Array(7).fill({ adults: 1, children: 0, childrenAges: [] }); }, how: '>6 rooms' },
    { id: 'S-HTML-ENTITY', mut: (b) => { b.entityId = '39627872<script>'; }, how: 'entityId with HTML' },
    { id: 'S-COMMA-NAT', mut: (b) => { b.nationality = 'IN,'; }, how: 'nationality with trailing comma' },
    { id: 'S-CHILDREN-NO-AGES', mut: (b) => { b.rooms = [{ adults: 1, children: 2, childrenAges: [] }]; }, how: 'children without ages' },
    { id: 'S-CHILD-AGE-18', mut: (b) => { b.rooms = [{ adults: 1, children: 1, childrenAges: [18] }]; }, how: 'child age 18' },
    { id: 'S-INVALID-DATE', mut: (b) => { b.checkin = '2026-02-30'; }, how: 'invalid date Feb 30' },
  ];

  for (const t of searchNeg) {
    const body = JSON.parse(JSON.stringify(searchBody));
    t.mut(body);
    const res = await hotel.search(body);
    const s = score(res);
    add({
      id: t.id, api: 'POST /v1/hotels/search', how: t.how, payload: body,
      verdict: s.verdict, actual: s.actual,
      http: res?.status, code: errCode(res), details: errDetails(res),
    });
  }

  // ── 4. Details baseline + negatives ──
  const detailsBody = buildDetailsBody(searchBody);
  const detailsRes = await hotel.getDetails(searchBody);
  const requestId = detailsRes?.ok ? extractRequestId(detailsRes.data) : null;
  const bookingCodes = detailsRes?.ok ? extractBookingCodes(detailsRes.data) : [];

  add({
    id: 'DET-BASE', api: 'POST /v1/hotels/details',
    how: 'Hilltop Mumbai details baseline', payload: detailsBody,
    verdict: detailsRes?.ok ? 'PASS' : 'NOT_TESTED',
    actual: `HTTP ${detailsRes?.status} requestId=${requestId ? 'yes' : 'no'} rooms=${bookingCodes.length}`,
    http: detailsRes?.status, code: errCode(detailsRes), details: errDetails(detailsRes),
  });

  const detailsNeg = [
    { id: 'DET-PAST', mut: (b) => { b.checkin = '2024-01-01'; b.checkout = '2024-01-03'; }, how: 'details: past dates' },
    { id: 'DET-SLASH', mut: (b) => { b.checkin = '2027/01/01'; }, how: 'details: slash date format' },
    { id: 'DET-HTML', mut: (b) => { b.entityId = '<script>alert(1)</script>'; }, how: 'details: HTML entityId' },
  ];
  for (const t of detailsNeg) {
    const body = JSON.parse(JSON.stringify(detailsBody));
    t.mut(body);
    const res = await session.client.request({
      method: 'POST', path: '/v1/hotels/details',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 }, body, correlation: true,
    });
    const s = score(res);
    add({
      id: t.id, api: 'POST /v1/hotels/details', how: t.how, payload: body,
      verdict: s.verdict, actual: s.actual,
      http: res?.status, code: errCode(res), details: errDetails(res),
    });
  }

  // ── 5. Prebook negatives ──
  const prebookNeg = [
    { id: 'PB-BLANK-CODE', body: { bookingCode: '', requestId: requestId || 'req_123' }, how: 'blank bookingCode' },
    { id: 'PB-BLANK-REQ', body: { bookingCode: bookingCodes[0] || 'code_123', requestId: '' }, how: 'blank requestId' },
    { id: 'PB-BOTH-MISSING', body: { bookingCode: '', requestId: '' }, how: 'both bookingCode and requestId blank' },
    { id: 'PB-HTML-CODE', body: { bookingCode: '<script>alert(1)</script>', requestId: requestId || 'req_123' }, how: 'HTML in bookingCode' },
    { id: 'PB-COMMA-REQ', body: { bookingCode: bookingCodes[0] || 'code_123', requestId: (requestId || 'req_123') + ',' }, how: 'requestId with trailing comma' },
  ];
  for (const t of prebookNeg) {
    const res = await hotel.prebook(t.body);
    const s = score(res);
    add({
      id: t.id, api: 'POST /v1/hotels/prebook', how: t.how, payload: t.body,
      verdict: s.verdict, actual: s.actual,
      http: res?.status, code: errCode(res), details: errDetails(res),
    });
  }

  // ── 6. Finalize negatives (no actual booking) ──
  const finalizeNeg = [
    {
      id: 'FIN-HTML-FIRST',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        rooms: [{ guests: [{ title: 'Mr.', firstName: '<script>', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
        contact: { email: 'rohan@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      },
      how: 'finalize: HTML in firstName',
    },
    {
      id: 'FIN-COMMA-EMAIL',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        rooms: [{ guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
        contact: { email: 'rohan@travelvip.ai,', countryCode: '+91', mobile: '9876543210' },
      },
      how: 'finalize: email with trailing comma',
    },
    {
      id: 'FIN-COMMA-MOBILE',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        rooms: [{ guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
        contact: { email: 'rohan@travelvip.ai', countryCode: '+91', mobile: '9876543210,' },
      },
      how: 'finalize: mobile with trailing comma',
    },
    {
      id: 'FIN-DDMMYYYY',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: '01-01-2027',
        checkout: '03-01-2027',
        rooms: [{ guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
        contact: { email: 'rohan@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      },
      how: 'finalize: dates DD-MM-YYYY',
    },
    {
      id: 'FIN-NO-LEAD',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        rooms: [{ guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: false }] }],
        contact: { email: 'rohan@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      },
      how: 'finalize: no lead guest (isLead=false)',
    },
    {
      id: 'FIN-INFANT',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        rooms: [{ guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Infant', isLead: true }] }],
        contact: { email: 'rohan@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      },
      how: 'finalize: guest type Infant',
    },
    {
      id: 'FIN-SPECIALCHAR-LAST',
      body: {
        bookingContext: 'fake_context',
        bookingCode: bookingCodes[0] || 'code_123',
        requestId: requestId || 'req_123',
        checkin: searchBody.checkin,
        checkout: searchBody.checkout,
        rooms: [{ guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat!@#$', type: 'Adult', isLead: true }] }],
        contact: { email: 'rohan@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      },
      how: 'finalize: special chars in lastName',
    },
  ];

  for (const t of finalizeNeg) {
    const res = await session.client.request({
      method: 'POST', path: '/v1/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 }, body: t.body, correlation: true,
      partnerKey: session.client.partnerKey,
    });
    const s = score(res);
    add({
      id: t.id, api: 'POST /v1/hotels/finalize-booking', how: t.how, payload: t.body,
      verdict: s.verdict, actual: s.actual,
      http: res?.status, code: errCode(res), details: errDetails(res),
    });
  }

  // ── 7. Fake BR: status / detail / cancel / penalty-check ──
  const fakeBR = 'BR0000000000000001';
  const brApis = [
    { id: 'BR-STATUS', path: `/v1/hotels/bookings/${fakeBR}/status`, how: `GET status fake BR ${fakeBR}` },
    { id: 'BR-DETAIL', path: `/v1/hotels/bookings/${fakeBR}`, how: `GET detail fake BR ${fakeBR}` },
    { id: 'BR-CANCEL', path: `/v1/hotels/bookings/${fakeBR}/cancel`, how: `GET cancel fake BR ${fakeBR}` },
    { id: 'BR-PENALTY', path: `/v1/hotels/bookings/${fakeBR}/penalty-check`, how: `GET penalty-check fake BR ${fakeBR}` },
  ];
  for (const t of brApis) {
    const res = await session.client.request({
      method: 'GET', path: t.path, query: HOTEL_QUERY, correlation: true,
      partnerKey: session.client.partnerKey,
    });
    const s = scoreExpectNotFound(res);
    add({
      id: t.id, api: `GET ${t.path}`, how: t.how, payload: null,
      verdict: s.verdict, actual: s.actual,
      http: res?.status, code: errCode(res), details: errDetails(res),
    });
  }

  // ── 8. HTML / comma in BR path ──
  const brFuzzApis = [
    { id: 'BR-HTML', path: '/v1/hotels/bookings/<script>/status', how: 'GET status with HTML in BR path' },
    { id: 'BR-COMMA', path: '/v1/hotels/bookings/BR123,/status', how: 'GET status with comma in BR path' },
  ];
  for (const t of brFuzzApis) {
    const res = await session.client.request({
      method: 'GET', path: t.path, query: HOTEL_QUERY, correlation: true,
      partnerKey: session.client.partnerKey,
    });
    const s = scoreExpectNotFound(res);
    add({
      id: t.id, api: `GET ${t.path}`, how: t.how, payload: null,
      verdict: s.verdict, actual: s.actual,
      http: res?.status, code: errCode(res), details: errDetails(res),
    });
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    counts: {
      PASS: rows.filter((r) => r.verdict === 'PASS').length,
      BUG: rows.filter((r) => r.verdict === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.verdict === 'NOT_TESTED').length,
      total: rows.length,
    },
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nReport: ${OUT}`);
  console.log(JSON.stringify(out.counts, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
