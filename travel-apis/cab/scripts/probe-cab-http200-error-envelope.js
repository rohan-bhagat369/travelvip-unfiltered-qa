/**
 * Cross-cab-API scan: HTTP 200 wrapping body 4xx/5xx, real HTTP 5xx, and invalid accepted.
 * Run: node scripts/probe-cab-http200-error-envelope.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import {
  CAB_QUERY,
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
} from '../src/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'reports', 'cab-http200-error-envelope-staging.json');
const OUT_TXT = path.join(ROOT, 'reports', 'cab-http200-error-envelope-staging.txt');

function bodyStatus(data) {
  if (data == null || typeof data !== 'object') return null;
  const s = data.status ?? data.statusCode ?? data.error?.status;
  if (typeof s === 'number') return s;
  if (typeof s === 'string' && /^\d+$/.test(s)) return Number(s);
  return null;
}

function summarize(data) {
  if (data == null) return null;
  if (typeof data === 'string') return data.slice(0, 240);
  return {
    status: data.status,
    statusCode: data.statusCode,
    title: data.title,
    message: data.message,
    detail: data.detail,
    code: data.error?.code || data.code,
    bookingRefId: data.bookingRefId || data.bookingReferenceId,
    path: data.path,
  };
}

function classify(httpStatus, data, { expectSuccess = false } = {}) {
  const bs = bodyStatus(data);
  const title = String(data?.title || '');
  const msg = String(data?.message || data?.detail || '');
  const isJhipster500 =
    bs === 500 ||
    /Internal Server Error/i.test(title) ||
    /error\.http\.500/i.test(msg) ||
    /Internal Server Error/i.test(msg);

  if (httpStatus >= 500) {
    return { kind: 'BUG_HTTP_5xx', severity: 'P0', note: 'Real HTTP 5xx' };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    if (isJhipster500 || bs === 500) {
      return { kind: 'BUG_HTTP200_BODY_5xx', severity: 'P0', note: 'HTTP 200 wraps Internal Server Error / body status 500' };
    }
    if (typeof bs === 'number' && bs >= 400 && bs < 500) {
      return { kind: 'BUG_HTTP200_BODY_4xx', severity: 'P1', note: `HTTP 200 wraps body status ${bs}` };
    }
    if (expectSuccess) {
      return { kind: 'PASS_SUCCESS', severity: null, note: 'Happy path OK' };
    }
    // HTTP 200 success-shaped for a negative case
    const booked = data?.bookingRefId || data?.bookingReferenceId;
    if (booked || data?.priceId || data?.bookingReference || Array.isArray(data?.cabs)) {
      return { kind: 'BUG_ACCEPTED_INVALID', severity: 'P0', note: 'Invalid input accepted with success-shaped body' };
    }
    return { kind: 'PASS_OR_AMBIGUOUS', severity: null, note: 'HTTP 200 without clear error body' };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { kind: 'PASS_HTTP_4xx', severity: null, note: 'Proper HTTP 4xx rejection' };
  }
  return { kind: 'OTHER', severity: null, note: `HTTP ${httpStatus}` };
}

async function call(client, { name, method, path: p, query = CAB_QUERY, body, partnerKey, expectSuccess = false, mutation }) {
  const response = await client.request({
    method,
    path: p,
    query,
    body,
    correlation: true,
    partnerKey: partnerKey === true ? client.partnerKey : partnerKey || null,
  });
  const cls = classify(response.status, response.data, { expectSuccess });
  return {
    id: name,
    mutation: mutation || '',
    method,
    path: p,
    httpStatus: response.status,
    bodyStatus: bodyStatus(response.data),
    kind: cls.kind,
    severity: cls.severity,
    note: cls.note,
    body: summarize(response.data),
  };
}

async function main() {
  const { client } = await authenticate();
  const rows = [];

  // --- baseline happy search/fare (for tokens) ---
  const searchOk = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    query: CAB_QUERY,
    body: buildAirportSearchBody(),
    correlation: true,
  });
  const cab = pickCab(searchOk.data?.cabs);
  const fareOk = cab?.searchId
    ? await client.request({
        method: 'POST',
        path: '/v1/airportServices/cabs/fare',
        query: CAB_QUERY,
        body: { searchId: cab.searchId },
        correlation: true,
      })
    : null;

  rows.push({
    id: 'POS-SEARCH',
    mutation: 'valid AIRPORT DEPARTURE',
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    httpStatus: searchOk.status,
    bodyStatus: bodyStatus(searchOk.data),
    ...classify(searchOk.status, searchOk.data, { expectSuccess: true }),
    body: summarize(searchOk.data),
    extra: { cabCount: searchOk.data?.cabs?.length, searchId: cab?.searchId?.slice?.(0, 40) },
  });

  if (fareOk) {
    rows.push({
      id: 'POS-FARE',
      mutation: 'valid searchId',
      method: 'POST',
      path: '/v1/airportServices/cabs/fare',
      httpStatus: fareOk.status,
      bodyStatus: bodyStatus(fareOk.data),
      ...classify(fareOk.status, fareOk.data, { expectSuccess: true }),
      body: summarize(fareOk.data),
      extra: { priceId: !!fareOk.data?.priceId, bookingReference: !!fareOk.data?.bookingReference },
    });
  }

  const bookingReference = fareOk?.data?.bookingReference;
  const priceId = fareOk?.data?.priceId;

  // ========== SEARCH negatives ==========
  const searchNeg = [
    ['SEARCH-empty', {}],
    ['SEARCH-missing-journeyType', (() => { const b = buildAirportSearchBody(); delete b.journeyType; return b; })()],
    ['SEARCH-invalid-journeyType', { ...buildAirportSearchBody(), journeyType: 'INVALID' }],
    ['SEARCH-airport-XXX', { ...buildAirportSearchBody(), airportCode: 'XXX' }],
    ['SEARCH-past-datetime', { ...buildAirportSearchBody(), pickupDatetime: '2020-01-01T10:00:00Z' }],
    ['SEARCH-bad-datetime', { ...buildAirportSearchBody(), pickupDatetime: 'ROHAN' }],
    ['SEARCH-lat999', { ...buildAirportSearchBody(), pickup: { name: 'X', city: 'Y', latitude: 999, longitude: 999 } }],
    ['SEARCH-neg-distance', { ...buildAirportSearchBody(), distanceKm: -5 }],
    ['SEARCH-html-journeyType', { ...buildAirportSearchBody(), journeyType: '<script>alert(1)</script>' }],
    ['SEARCH-comma-airport', { ...buildAirportSearchBody(), airportCode: 'DEL,' }],
  ];
  for (const [name, body] of searchNeg) {
    rows.push(await call(client, {
      name,
      method: 'POST',
      path: '/v1/airportServices/cabs/search',
      body,
      mutation: JSON.stringify(body).slice(0, 120),
    }));
  }

  // ========== FARE negatives (user's case) ==========
  const fareNeg = [
    ['FARE-missing-searchId', {}],
    ['FARE-empty-searchId', { searchId: '' }],
    ['FARE-ROHAN', { searchId: 'ROHAN' }],
    ['FARE-garbage', { searchId: 'not-a-real-search-id' }],
    ['FARE-uuid-only', { searchId: '00000000-0000-0000-0000-000000000000' }],
    ['FARE-html', { searchId: '<script>x</script>' }],
    ['FARE-comma', { searchId: 'abc,' }],
  ];
  for (const [name, body] of fareNeg) {
    rows.push(await call(client, {
      name,
      method: 'POST',
      path: '/v1/airportServices/cabs/fare',
      body,
      mutation: JSON.stringify(body),
    }));
  }

  // ========== FINALIZE negatives ==========
  if (bookingReference && priceId) {
    const base = buildFinalizeBody({ bookingReference, priceId });
    const bookNeg = [
      ['BOOK-bad-ref', { ...base, bookingReference: 'INVALID_REF' }],
      ['BOOK-bad-priceId', { ...base, priceId: 'invalid-price-id' }],
      ['BOOK-empty-body', {}],
      ['BOOK-bad-email', { ...base, contact: { ...base.contact, email: 'not-an-email' } }],
      ['BOOK-html-name', {
        ...base,
        passengers: [{ ...base.passengers[0], profile: { ...base.passengers[0].profile, firstName: '<script>' } }],
      }],
      ['BOOK-comma-mobile', { ...base, contact: { ...base.contact, mobile: '9921862715,' } }],
    ];
    for (const [name, body] of bookNeg) {
      rows.push(await call(client, {
        name,
        method: 'POST',
        path: '/v1/airportServices/cabs/finalize-booking',
        body,
        partnerKey: true,
        mutation: name,
      }));
    }
  } else {
    rows.push({
      id: 'BOOK-setup',
      kind: 'NOT_TESTED',
      severity: null,
      note: 'No fare tokens for finalize negatives',
      httpStatus: 0,
      bodyStatus: null,
      body: null,
    });
  }

  // ========== STATUS / DETAIL / TRACKING / CANCEL ==========
  const ids = ['ROHAN', 'BR_NOT_REAL_000', 'BR', 'BR0000000000000001', '<script>', 'abc,'];
  for (const id of ids) {
    rows.push(await call(client, {
      name: `STATUS-${id}`,
      method: 'GET',
      path: `/v1/airportServices/cabs/${encodeURIComponent(id)}/status`,
      mutation: `bookingRef=${id}`,
    }));
    rows.push(await call(client, {
      name: `DETAIL-${id}`,
      method: 'GET',
      path: `/v1/airportServices/cabs/booking/${encodeURIComponent(id)}`,
      mutation: `bookingRef=${id}`,
    }));
    rows.push(await call(client, {
      name: `TRACK-${id}`,
      method: 'GET',
      path: `/v1/airportServices/cabs/tracking/${encodeURIComponent(id)}/location`,
      mutation: `bookingRef=${id}`,
    }));
    rows.push(await call(client, {
      name: `CANCEL-${id}`,
      method: 'GET',
      path: `/v1/airportServices/cabs/bookings/${encodeURIComponent(id)}/cancel`,
      partnerKey: true,
      mutation: `bookingRef=${id}`,
    }));
  }

  // ========== HISTORY ==========
  rows.push(await call(client, {
    name: 'HISTORY-ok',
    method: 'GET',
    path: '/v1/airportServices/cabs/booking/history',
    query: { ...CAB_QUERY, page: 0, perpage: 10 },
    expectSuccess: true,
    mutation: 'page=0&perpage=10',
  }));
  rows.push(await call(client, {
    name: 'HISTORY-neg-page',
    method: 'GET',
    path: '/v1/airportServices/cabs/booking/history',
    query: { ...CAB_QUERY, page: -1, perpage: 10 },
    mutation: 'page=-1',
  }));
  rows.push(await call(client, {
    name: 'HISTORY-zero-perpage',
    method: 'GET',
    path: '/v1/airportServices/cabs/booking/history',
    query: { ...CAB_QUERY, page: 0, perpage: 0 },
    mutation: 'perpage=0',
  }));
  rows.push(await call(client, {
    name: 'HISTORY-abc-page',
    method: 'GET',
    path: '/v1/airportServices/cabs/booking/history',
    query: { ...CAB_QUERY, page: 'abc', perpage: 10 },
    mutation: 'page=abc',
  }));

  // ========== LOCATIONS / AUTOCOMPLETE ==========
  rows.push(await call(client, {
    name: 'LOC-ok',
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { ...CAB_QUERY, latitude: 18.5679, longitude: 73.9143 },
    expectSuccess: true,
    mutation: 'lat/long Pune',
  }));
  rows.push(await call(client, {
    name: 'LOC-missing-coords',
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { ...CAB_QUERY },
    mutation: 'no lat/long',
  }));
  rows.push(await call(client, {
    name: 'LOC-bad-coords',
    method: 'GET',
    path: '/v1/airportServices/cabs/locations',
    query: { ...CAB_QUERY, latitude: 999, longitude: 999 },
    mutation: 'lat=999',
  }));
  rows.push(await call(client, {
    name: 'PLACE-ok',
    method: 'GET',
    path: '/v1/airportServices/cabs/places/autocomplete',
    query: { ...CAB_QUERY, searchText: 'viman nagar' },
    expectSuccess: true,
    mutation: 'searchText=viman nagar',
  }));
  rows.push(await call(client, {
    name: 'PLACE-empty',
    method: 'GET',
    path: '/v1/airportServices/cabs/places/autocomplete',
    query: { ...CAB_QUERY, searchText: '' },
    mutation: 'searchText empty',
  }));
  rows.push(await call(client, {
    name: 'PLACE-html',
    method: 'GET',
    path: '/v1/airportServices/cabs/places/autocomplete',
    query: { ...CAB_QUERY, searchText: '<script>alert(1)</script>' },
    mutation: 'searchText HTML',
  }));
  rows.push(await call(client, {
    name: 'PLACE-missing',
    method: 'GET',
    path: '/v1/airportServices/cabs/places/autocomplete',
    query: { ...CAB_QUERY },
    mutation: 'no searchText',
  }));

  // Cancel a known Confirmed BR if we can book once (optional — skip heavy book if env SKIP_BOOK=1)
  if (process.env.SKIP_BOOK !== '1' && bookingReference && priceId) {
    const fin = await client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/finalize-booking',
      query: CAB_QUERY,
      body: buildFinalizeBody({
        bookingReference,
        priceId,
      }),
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    rows.push({
      id: 'POS-BOOK',
      mutation: 'valid finalize',
      method: 'POST',
      path: '/v1/airportServices/cabs/finalize-booking',
      httpStatus: fin.status,
      bodyStatus: bodyStatus(fin.data),
      ...classify(fin.status, fin.data, { expectSuccess: true }),
      body: summarize(fin.data),
    });
    if (br) {
      const st = await call(client, {
        name: 'POS-STATUS',
        method: 'GET',
        path: `/v1/airportServices/cabs/${br}/status`,
        expectSuccess: true,
        mutation: br,
      });
      rows.push(st);
      const det = await call(client, {
        name: 'POS-DETAIL',
        method: 'GET',
        path: `/v1/airportServices/cabs/booking/${br}`,
        expectSuccess: true,
        mutation: br,
      });
      rows.push(det);
      const tr = await call(client, {
        name: 'POS-TRACK',
        method: 'GET',
        path: `/v1/airportServices/cabs/tracking/${br}/location`,
        expectSuccess: true,
        mutation: br,
      });
      rows.push(tr);
      const can = await call(client, {
        name: 'POS-CANCEL',
        method: 'GET',
        path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
        partnerKey: true,
        mutation: br,
      });
      rows.push(can);
    }
  }

  const counts = {};
  for (const r of rows) {
    counts[r.kind] = (counts[r.kind] || 0) + 1;
  }

  const p0 = rows.filter((r) => r.severity === 'P0');
  const p1 = rows.filter((r) => r.severity === 'P1');

  const report = {
    baseUrl: client.baseUrl || process.env.BASE_URL,
    generatedAt: new Date().toISOString(),
    focus: 'HTTP 200 wrapping body 4xx/5xx + real 5xx + invalid accepted across all cab APIs',
    counts,
    p0Count: p0.length,
    p1Count: p1.length,
    rows,
  };

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  const lines = [];
  lines.push('=== CAB HTTP-200 ERROR ENVELOPE SCAN (all APIs) ===');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Counts: ${JSON.stringify(counts)}`);
  lines.push(`P0: ${p0.length} | P1: ${p1.length}`);
  lines.push('');
  lines.push('--- P0: HTTP 200 + body 500 / real 5xx / invalid accepted ---');
  for (const r of p0) {
    lines.push(`[${r.kind}] ${r.id} ${r.method} ${r.path}`);
    lines.push(`  mutation: ${r.mutation || ''}`);
    lines.push(`  http=${r.httpStatus} bodyStatus=${r.bodyStatus} — ${r.note}`);
    lines.push(`  body: ${JSON.stringify(r.body)}`);
    lines.push('');
  }
  lines.push('--- P1: HTTP 200 + body 4xx (wrong status; validation message may be OK) ---');
  for (const r of p1) {
    lines.push(`[${r.kind}] ${r.id} ${r.method} ${r.path}`);
    lines.push(`  http=${r.httpStatus} bodyStatus=${r.bodyStatus} msg=${r.body?.message || r.body?.detail || ''}`);
    lines.push('');
  }
  lines.push('--- ALL ROWS ---');
  for (const r of rows) {
    lines.push(`${r.kind.padEnd(24)} ${String(r.httpStatus).padStart(3)}/${String(r.bodyStatus ?? '-').padStart(3)}  ${r.id}`);
  }
  fs.writeFileSync(OUT_TXT, lines.join('\n'), 'utf8');

  console.log(lines.join('\n'));
  console.log('\nWrote:', OUT_JSON);
  console.log('Wrote:', OUT_TXT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
