/**
 * Probe cab API validations from cabV2 doc (update-booking, webhook, status, cancel, history).
 * Run: node scripts/probe-cab-v2-doc-validations.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { CAB_QUERY, buildAirportSearchBody, buildFinalizeBody, pickCab } from '../src/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'cab-v2-doc-validations-staging.json');

const REAL_BR = process.env.CAB_BOOKING_REF || '';
const REAL_VENDOR_ID = process.env.CAB_VENDOR_BOOKING_ID || '';
const WEBHOOK_USER = process.env.CAB_WEBHOOK_USER || '';
const WEBHOOK_PASS = process.env.CAB_WEBHOOK_PASS || '';

function errCode(data) {
  return data?.error?.code || data?.code || null;
}

function errMsg(data) {
  return data?.error?.message || data?.message || null;
}

function row(id, api, how, expectHttp, expectCode, res, extra = {}) {
  const http = res.status;
  const code = errCode(res.data);
  const passHttp = Array.isArray(expectHttp) ? expectHttp.includes(http) : http === expectHttp;
  const passCode = expectCode == null ? true : code === expectCode;
  const status = passHttp && passCode ? 'PASS' : 'BUG';
  return {
    id,
    api,
    how,
    expectHttp,
    expectCode,
    actualHttp: http,
    actualCode: code,
    actualMessage: errMsg(res.data),
    status,
    body: res.data,
    ...extra,
  };
}

async function rawFetch(client, { method, path: p, query = {}, body, auth = true, partnerKey, extraHeaders = {} }) {
  return client.request({
    method,
    path: p,
    query: { ...CAB_QUERY, ...query },
    body,
    auth,
    partnerKey: partnerKey ?? client.partnerKey,
    extraHeaders,
  });
}

async function webhookFetch(baseUrl, { body, basicUser, basicPass, omitAuth = false }) {
  const url = new URL('/v1/airportServices/cabs/partner-webhook', baseUrl);
  url.searchParams.set('lang', 'en');
  const headers = { 'Content-Type': 'application/json' };
  if (!omitAuth && basicUser && basicPass) {
    headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function bookPendingCab(client) {
  const search = await rawFetch(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    body: buildAirportSearchBody(),
  });
  const cab = pickCab(search.data?.cabs);
  if (!cab?.searchId) return null;
  const fare = await rawFetch(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/fare',
    body: { searchId: cab.searchId },
  });
  const { bookingReference, priceId } = fare.data || {};
  if (!bookingReference || !priceId) return null;
  const fin = await rawFetch(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    body: buildFinalizeBody({ bookingReference, priceId }),
  });
  return fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
}

async function main() {
  const { client } = await authenticate();
  const rows = [];
  let br = REAL_BR;
  let vendorId = REAL_VENDOR_ID;

  if (!br) {
    br = await bookPendingCab(client);
  }

  // §5 update-booking
  rows.push(row(
    'UB-1',
    'POST /v1/airportServices/cabs/update-booking',
    'empty body {}',
    400,
    'VALIDATION_ERROR',
    await rawFetch(client, { method: 'POST', path: '/v1/airportServices/cabs/update-booking', body: {} }),
  ));

  rows.push(row(
    'UB-2',
    'POST /v1/airportServices/cabs/update-booking',
    'omit bookingRefId { status: CONFIRMED }',
    400,
    'VALIDATION_ERROR',
    await rawFetch(client, {
      method: 'POST',
      path: '/v1/airportServices/cabs/update-booking',
      body: { status: 'CONFIRMED', bookingId: 'X' },
    }),
  ));

  rows.push(row(
    'UB-3',
    'POST /v1/airportServices/cabs/update-booking',
    'invalid status CANCELED',
    400,
    'VALIDATION_ERROR',
    await rawFetch(client, {
      method: 'POST',
      path: '/v1/airportServices/cabs/update-booking',
      body: { bookingRefId: 'BR_NOT_REAL_000', status: 'CANCELED', bookingId: 'X' },
    }),
  ));

  rows.push(row(
    'UB-4',
    'POST /v1/airportServices/cabs/update-booking',
    'fake bookingRefId',
    404,
    'BOOKING_NOT_FOUND',
    await rawFetch(client, {
      method: 'POST',
      path: '/v1/airportServices/cabs/update-booking',
      body: { bookingRefId: 'BR_NOT_REAL_000', status: 'CONFIRMED', bookingId: 'X' },
    }),
  ));

  if (br && vendorId) {
    rows.push(row(
      'UB-5',
      'POST /v1/airportServices/cabs/update-booking',
      'PROVIDER_BOOKING_ID_MISMATCH',
      400,
      'PROVIDER_BOOKING_ID_MISMATCH',
      await rawFetch(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/update-booking',
        body: {
          bookingRefId: br,
          bookingId: 'WRONG_PROVIDER_ID',
          providerBookingId: 'WRONG_PROVIDER_ID',
          status: 'CONFIRMED',
        },
      }),
    ));
  } else {
    rows.push({
      id: 'UB-5',
      api: 'POST /v1/airportServices/cabs/update-booking',
      how: 'PROVIDER_BOOKING_ID_MISMATCH',
      status: 'NOT TESTED',
      note: 'Set CAB_BOOKING_REF + CAB_VENDOR_BOOKING_ID',
    });
  }

  // §6 partner-webhook (no partner token)
  const whEmpty = await webhookFetch(config.baseUrl, { body: {}, basicUser: WEBHOOK_USER, basicPass: WEBHOOK_PASS, omitAuth: !WEBHOOK_USER });
  rows.push({
    id: 'WH-1',
    api: 'POST /v1/airportServices/cabs/partner-webhook',
    how: WEBHOOK_USER ? 'empty body with Basic Auth' : 'empty body no webhook creds in env',
    expectHttp: 400,
    expectCode: 'VALIDATION_ERROR',
    actualHttp: whEmpty.status,
    actualCode: errCode(whEmpty.data),
    status: WEBHOOK_USER
      ? (whEmpty.status === 400 && errCode(whEmpty.data) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG')
      : 'NOT TESTED',
    note: WEBHOOK_USER ? undefined : 'Set CAB_WEBHOOK_USER + CAB_WEBHOOK_PASS',
    body: whEmpty.data,
  });

  const whBadCreds = await webhookFetch(config.baseUrl, { body: { eventName: 'TEST' }, basicUser: 'bad', basicPass: 'bad' });
  rows.push(row(
    'WH-2',
    'POST /v1/airportServices/cabs/partner-webhook',
    'wrong Basic Auth',
    [401, 403],
    'INVALID_WEBHOOK_CREDENTIALS',
    { status: whBadCreds.status, data: whBadCreds.data },
    { altCodes: ['WEBHOOK_IP_NOT_ALLOWED'] },
  ));
  if (rows.at(-1).actualCode === 'WEBHOOK_IP_NOT_ALLOWED') {
    rows.at(-1).status = whBadCreds.status === 403 ? 'PASS' : 'BUG';
    rows.at(-1).note = 'IP blocked before credential check (expected on staging)';
  }

  // §7 status — shared with §8 §9
  const readCases = [
    ['ST-1', '/v1/airportServices/cabs/<script>/status', 'invalid ref HTML'],
    ['ST-2', '/v1/airportServices/cabs/ROHAN/status', 'fake ROHAN'],
    ['DT-1', '/v1/airportServices/cabs/booking/<script>', 'invalid ref HTML'],
    ['DT-2', '/v1/airportServices/cabs/booking/ROHAN', 'fake ROHAN'],
    ['TR-1', '/v1/airportServices/cabs/tracking/<script>/location', 'invalid ref HTML'],
    ['TR-2', '/v1/airportServices/cabs/tracking/ROHAN/location', 'fake ROHAN'],
  ];
  for (const [id, p, how] of readCases) {
    const expectCode = how.includes('invalid') ? 'VALIDATION_ERROR' : 'BOOKING_NOT_FOUND';
    const expectHttp = how.includes('invalid') ? 400 : 404;
    const encoded = p.replace('<script>', encodeURIComponent('<script>'));
    rows.push(row(id, `GET ${p}`, how, expectHttp, expectCode, await rawFetch(client, { method: 'GET', path: encoded })));
  }

  // §10 history
  rows.push(row(
    'HI-1',
    'GET /v1/airportServices/cabs/booking/history',
    'omit userId',
    400,
    'VALIDATION_ERROR',
    await rawFetch(client, { method: 'GET', path: '/v1/airportServices/cabs/booking/history', query: { page: 0, perpage: 10 } }),
  ));

  const hiClamp = await rawFetch(client, {
    method: 'GET',
    path: '/v1/airportServices/cabs/booking/history',
    query: { userId: '1', page: -1, perpage: 0 },
  });
  rows.push({
    id: 'HI-2',
    api: 'GET /v1/airportServices/cabs/booking/history',
    how: 'page=-1 perpage=0 clamped not rejected',
    expectHttp: 200,
    actualHttp: hiClamp.status,
    status: hiClamp.status === 200 ? 'PASS' : 'BUG',
    body: hiClamp.data,
  });

  // §11 cancel
  rows.push(row(
    'CA-1',
    'GET /v1/airportServices/cabs/bookings/<script>/cancel',
    'invalid ref HTML',
    400,
    'VALIDATION_ERROR',
    await rawFetch(client, { method: 'GET', path: `/v1/airportServices/cabs/bookings/${encodeURIComponent('<script>')}/cancel` }),
  ));

  rows.push(row(
    'CA-2',
    'GET /v1/airportServices/cabs/bookings/ROHAN/cancel',
    'fake ROHAN',
    404,
    'BOOKING_NOT_FOUND',
    await rawFetch(client, { method: 'GET', path: '/v1/airportServices/cabs/bookings/ROHAN/cancel' }),
  ));

  const badCancelledBy = await rawFetch(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/bookings/ROHAN/cancel',
    body: { cancelledBy: 'AGENT', cancellationReason: 'test' },
  });
  rows.push(row(
    'CA-3',
    'POST /v1/airportServices/cabs/bookings/{id}/cancel',
    'invalid cancelledBy AGENT',
    400,
    'VALIDATION_ERROR',
    badCancelledBy,
  ));

  const longReason = 'x'.repeat(501);
  const longReasonRes = await rawFetch(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/bookings/ROHAN/cancel',
    body: { cancelledBy: 'USER', cancellationReason: longReason },
  });
  rows.push(row(
    'CA-4',
    'POST /v1/airportServices/cabs/bookings/{id}/cancel',
    'cancellationReason 501 chars',
    400,
    'VALIDATION_ERROR',
    longReasonRes,
  ));

  if (br) {
    const pendCancel = await rawFetch(client, {
      method: 'GET',
      path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    });
    rows.push(row(
      'CA-5',
      'GET /v1/airportServices/cabs/bookings/{id}/cancel',
      `Pending BR ${br}`,
      400,
      'BOOKING_NOT_CANCELLABLE',
      pendCancel,
    ));
  } else {
    rows.push({ id: 'CA-5', status: 'NOT TESTED', note: 'No cab BR for Pending cancel guard' });
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    fixture: { br, vendorId: vendorId || null },
    counts,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== Cab v2 doc validations (staging) ===\n');
  console.log(`PASS ${counts.PASS || 0} | BUG ${counts.BUG || 0} | NOT TESTED ${counts['NOT TESTED'] || 0}\n`);
  for (const r of rows) {
    const exp = r.expectCode ? `HTTP ${r.expectHttp} ${r.expectCode}` : `HTTP ${r.expectHttp}`;
    const act = r.actualHttp != null ? `HTTP ${r.actualHttp} ${r.actualCode || ''}`.trim() : '';
    console.log(`${r.status.padEnd(11)} ${r.id} ${r.how || r.api} | expect ${exp} | actual ${act}`);
    if (r.status === 'BUG') console.log(`            msg: ${r.actualMessage}`);
  }
  console.log(`\nReport: ${OUT}`);
  process.exit((counts.BUG || 0) > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
